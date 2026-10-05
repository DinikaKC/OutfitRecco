import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { docxToPictures, fileKind, readZip } from "../public/file-import.js";

// tests/fixtures/wardrobe.docx is a small Word file made for these tests. In document order it has:
// a green 200×200 PNG, a red 300×400 PNG and a blue JPEG in a table, then the red PNG again.
// Its header also has a grey 64×64 logo, which belongs to the header, not the document body.
// Pictures are stored uncompressed and everything else is compressed, so both ZIP methods are covered.
const docx = readFileSync(new URL("./fixtures/wardrobe.docx", import.meta.url));

// Reads width and height from a PNG's header.
const pngSize = (bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
};

test("readZip lists files and reads both compressed and stored entries", async () => {
  const zip = readZip(docx);
  assert.ok(zip.has("word/document.xml"));
  const xml = new TextDecoder().decode(await zip.get("word/document.xml")());
  assert.match(xml, /<w:document/);
  const png = await zip.get("word/media/image2.png")();
  assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]); // "PNG"
});

test("docxToPictures returns the document's pictures in order, once each, without header pictures", async () => {
  const pictures = await docxToPictures(docx, "wardrobe.docx");
  assert.equal(pictures.length, 3);
  assert.deepEqual(pictures.map((p) => p.blob.type), ["image/png", "image/png", "image/jpeg"]);
  assert.deepEqual(pictures.map((p) => p.label), [
    "wardrobe.docx, picture 1",
    "wardrobe.docx, picture 2",
    "wardrobe.docx, picture 3",
  ]);
  const sizes = await Promise.all(pictures.slice(0, 2).map(async (p) => pngSize(new Uint8Array(await p.blob.arrayBuffer()))));
  assert.deepEqual(sizes, [[200, 200], [300, 400]]);
  assert.ok(pictures.every((p) => p.fromDocument));
});

test("docxToPictures explains files it can't open", async () => {
  await assert.rejects(docxToPictures(new TextEncoder().encode("not a zip"), "x.docx"), /couldn't be opened as a Word file/);
});

test("fileKind recognises photos, PDFs and Word files by type or extension", () => {
  assert.equal(fileKind({ name: "a.JPG", type: "" }), "image");
  assert.equal(fileKind({ name: "a", type: "image/webp" }), "image");
  assert.equal(fileKind({ name: "look.pdf", type: "" }), "pdf");
  assert.equal(fileKind({ name: "x", type: "application/pdf" }), "pdf");
  assert.equal(fileKind({ name: "w.docx", type: "" }), "docx");
  assert.equal(fileKind({ name: "old.doc", type: "" }), "doc");
  assert.equal(fileKind({ name: "notes.txt", type: "text/plain" }), "other");
});
