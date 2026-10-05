// public/file-import.js
// Turns whatever the user picks into a list of pictures (image Blobs) the rest of the app can use:
//
//   Photos (JPEG, PNG, WebP, GIF, ...)  → used as they are
//   PDF                                 → one picture per page, drawn with pdf.js
//   Word (.docx)                        → every picture inside the document, in document order
//   Old Word (.doc)                     → a clear error: browsers can't read that format
//
// Everything happens in the browser. Files are never uploaded as-is: only the pictures
// taken from them are (after app.js shrinks them), and file names are never sent to the AI.

// pdf.js (Mozilla's PDF reader) is loaded from a CDN only when someone picks a PDF.
// The "legacy" build works in older browsers too, including older iPhones.
const PDFJS_VERSION = "6.4.299";
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build`;
const PDF_RENDER_EDGE = 2576; // draw pages this big (longest side, in pixels); app.js shrinks them later

// Image formats a browser can decode, by file extension. Word can also hold EMF, WMF and TIFF
// pictures, which browsers can't draw, so those are skipped.
const IMAGE_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

// For the file picker's "accept" attribute.
export const ACCEPT = [
  "image/*",
  ".pdf",
  "application/pdf",
  ".docx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc",
  "application/msword",
].join(",");

// Works out what kind of file this is, from its MIME type or, failing that, its extension.
export function fileKind(file) {
  const name = (file.name || "").toLowerCase();
  const type = file.type || "";
  if (type.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/.test(name)) return "image";
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || name.endsWith(".docx")) {
    return "docx";
  }
  if (type === "application/msword" || name.endsWith(".doc")) return "doc";
  return "other";
}

// Converts the chosen files into at most `room` pictures.
// Returns { pictures: [{ blob, label, fromDocument? }], problems: ["message", ...], leftOut: number }.
// `label` is for the user only (e.g. "lookbook.pdf, page 2"); it's never sent to the server.
// `leftOut` counts pictures that didn't fit in `room`.
export async function filesToPictures(files, room) {
  const pictures = [];
  const problems = [];
  let leftOut = 0;

  for (const file of files) {
    const space = Math.max(room - pictures.length, 0);
    try {
      let found = [];
      const kind = fileKind(file);
      if (kind === "image") found = [{ blob: file, label: file.name }];
      else if (kind === "pdf") found = await pdfToPictures(file, space);
      else if (kind === "docx") found = await docxToPictures(await file.arrayBuffer(), file.name);
      else if (kind === "doc") {
        throw new Error("older Word files (.doc) can't be read. Open it in Word and save it as .docx or PDF.");
      } else {
        throw new Error("only photos, PDFs and Word (.docx) files can be added.");
      }

      if (found.length === 0 && !found.skippedPages) throw new Error("no pictures were found in it.");
      leftOut += (found.skippedPages ?? 0) + Math.max(found.length - space, 0);
      pictures.push(...found.slice(0, space));
    } catch (err) {
      problems.push(`${file.name}: ${err.message}`);
    }
  }
  return { pictures, problems, leftOut };
}

// ---------------------------------------------------------------------------
// PDF: draw each page onto a canvas with pdf.js
// ---------------------------------------------------------------------------

let pdfjsPromise = null;

function loadPdfJs() {
  pdfjsPromise ??= import(`${PDFJS_BASE}/pdf.min.mjs`).then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;
    return pdfjs;
  });
  return pdfjsPromise;
}

// Returns one picture per page (up to `room` pages). The returned list also carries
// `skippedPages`: how many pages didn't fit.
async function pdfToPictures(file, room) {
  let pdfjs;
  try {
    pdfjs = await loadPdfJs();
  } catch {
    pdfjsPromise = null; // let a later attempt try again
    throw new Error("the PDF reader couldn't be loaded. Check your internet connection and try again.");
  }

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (err) {
    loadingTask.destroy();
    if (err?.name === "PasswordException") throw new Error("it's password-protected. Remove the password and try again.");
    throw new Error("it couldn't be opened as a PDF.");
  }

  try {
    const pictures = [];
    const pageCount = Math.min(pdf.numPages, room);
    for (let n = 1; n <= pageCount; n++) {
      const page = await pdf.getPage(n);
      const size = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: PDF_RENDER_EDGE / Math.max(size.width, size.height) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise; // pdf.js paints a white page background
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      pictures.push({ blob, label: pdf.numPages > 1 ? `${file.name}, page ${n}` : file.name });
      page.cleanup();
    }
    pictures.skippedPages = pdf.numPages - pageCount;
    return pictures;
  } finally {
    await loadingTask.destroy(); // frees the PDF's memory and its background worker
  }
}

// ---------------------------------------------------------------------------
// Word (.docx): a .docx file is a ZIP archive. Pictures live in word/media/,
// and word/document.xml says where each one appears.
// ---------------------------------------------------------------------------

// Returns the document's pictures as [{ blob, label }], in the order they appear,
// each picture once. Works in the browser and in Node (used by the tests).
export async function docxToPictures(buffer, fileName = "document.docx") {
  let zip;
  try {
    zip = readZip(buffer);
  } catch {
    // Password-protected Word files aren't ZIPs, so they end up here too.
    throw new Error("it couldn't be opened as a Word file. If it's password-protected, remove the password.");
  }
  const text = async (path) => (zip.has(path) ? new TextDecoder().decode(await zip.get(path)()) : "");

  // 1. word/_rels/document.xml.rels maps ids like "rId5" to files like "media/image1.png".
  const rels = await text("word/_rels/document.xml.rels");
  const imageFiles = new Map();
  for (const tag of rels.match(/<Relationship\b[^>]*>/g) ?? []) {
    const id = attribute(tag, "Id");
    const target = attribute(tag, "Target");
    if (id && target && /\/image$/.test(attribute(tag, "Type") ?? "") && attribute(tag, "TargetMode") !== "External") {
      imageFiles.set(id, resolvePath("word/", target));
    }
  }

  // 2. word/document.xml mentions those ids where pictures appear, e.g. <a:blip r:embed="rId5"/>.
  //    Older documents use <v:imagedata r:id="rId5"/>. Only ids that point to pictures count.
  const documentXml = await text("word/document.xml");
  const ordered = [];
  for (const match of documentXml.matchAll(/\br:(?:embed|id)="([^"]+)"/g)) {
    const path = imageFiles.get(match[1]);
    if (path && zip.has(path) && !ordered.includes(path)) ordered.push(path);
  }

  // 3. Read each picture the browser can draw.
  const pictures = [];
  for (const path of ordered) {
    const type = IMAGE_TYPES[path.split(".").pop().toLowerCase()];
    if (!type) continue; // EMF, WMF, TIFF, SVG...
    const bytes = await zip.get(path)();
    pictures.push({
      blob: new Blob([bytes], { type }),
      label: `${fileName}, picture ${pictures.length + 1}`,
      fromDocument: true, // app.js skips tiny ones (icons, logos)
    });
  }
  return pictures;
}

// Reads one attribute's value from an XML tag, e.g. attribute('<x Id="rId5">', "Id") → "rId5".
function attribute(tag, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match ? match[1] : null;
}

// Resolves "media/image1.png" (relative to word/) or "/word/media/image1.png" to "word/media/image1.png".
function resolvePath(base, target) {
  const parts = (target.startsWith("/") ? target.slice(1) : base + target).split("/");
  const resolved = [];
  for (const part of parts) {
    if (part === "..") resolved.pop();
    else if (part && part !== ".") resolved.push(part);
  }
  return resolved.join("/");
}

// A minimal ZIP reader, enough for Word files. Returns a Map of file name → async function
// that returns that file's bytes. Uses the browser's built-in DecompressionStream, so no library is needed.
export function readZip(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The "end of central directory" record sits at the end of the file (before an optional comment).
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("Not a ZIP file.");

  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (offset === 0xffffffff) throw new Error("ZIP64 files aren't supported.");

  // The central directory lists every file: its name, size, compression and where its data starts.
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("Damaged ZIP file.");
    const method = view.getUint16(offset + 10, true); // 0 = stored, 8 = deflate
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeader = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    files.set(name, () => readEntry(localHeader, method, compressedSize));
    offset += 46 + nameLength + extraLength + commentLength;
  }

  async function readEntry(localHeader, method, size) {
    const start = localHeader + 30 + view.getUint16(localHeader + 26, true) + view.getUint16(localHeader + 28, true);
    const data = bytes.slice(start, start + size);
    if (method === 0) return data;
    if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error(`Unsupported ZIP compression (${method}).`);
  }

  return files;
}
