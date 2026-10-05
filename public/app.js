// public/app.js
// Everything that happens in the browser. The page has five screens (sections in index.html),
// and only one is visible at a time:
//
//   gate     → enter the passcode (checked with /api/verify)
//   photos   → pick photos, PDFs or Word files; file-import.js turns them into pictures
//   quiz     → 5 questions; meanwhile the pictures are shrunk and sent to /api/inventory
//   pieces   → review what the AI found: untick, change type, keep duplicates separate, add pieces
//   results  → outfits from /api/recommend, plus "Worth looking for" ideas
//
// Pictures of pieces: /api/inventory returns a box around every look (one outfit as photographed).
// The browser cuts each look out of its picture ("crops" it) and shows that wherever the piece appears.
//
// Nothing is saved on a server. Everything lives in the `state` object below until the tab closes
// (except the passcode, which is remembered in localStorage so you don't retype it).

import { QUIZ } from "./quiz-options.js";
import { CLAUDE_MAX_EDGE, CLAUDE_MAX_IMAGE_TOKENS, MAX_PICTURES } from "./config.js";
import { ACCEPT, filesToPictures } from "./file-import.js";

// ---------------------------------------------------------------------------
// Constants and state
// ---------------------------------------------------------------------------

// Vercel caps request bodies at 4.5 MB, so all pictures together stay under ~4 MB of base64.
const MAX_UPLOAD_CHARS = 4_000_000;
// Pictures inside Word files smaller than this (longest side, in pixels) are icons or logos: skipped.
const MIN_DOCUMENT_PICTURE = 100;
// Cropped look pictures are made at most this big (longest side, in pixels).
const CROP_EDGE = 600;

const LOOK_RE = /^p(\d+)_l(\d+)$/; // "p1_l3" = photo 1, look 3

// How piece types are shown on screen, and in what order.
const TYPE_LABELS = { top: "Top", bottom: "Bottom", one_piece: "One-piece", layer: "Layer" };
const GROUP_LABELS = { top: "Tops", bottom: "Bottoms", one_piece: "One-pieces", layer: "Layers" };
const TYPE_ORDER = ["one_piece", "top", "bottom", "layer"];
const SLOT_ORDER = ["one_piece", "top", "bottom", "layer"];

// Which part of a look picture to show for each type: tops and layers show the upper body,
// bottoms the lower body, one-pieces the whole person. See the .fit-* classes in styles.css.
const FIT_CLASS = { top: "fit-top", layer: "fit-top", bottom: "fit-bottom", one_piece: "fit-whole" };

// Used in the results heading: "Outfits for a casual outing".
const OCCASION_PHRASES = {
  office: "the office",
  "casual outing": "a casual outing",
  date: "a date",
  party: "a party",
  "festive or traditional event": "a festive occasion",
  travel: "a travel day",
};

// All app data lives here. Screens read from it and event handlers update it.
const state = {
  passcode: loadPasscode(),
  demo: false, // true when the server runs with --mock (answers are samples, not from your photos)
  screen: null, // which screen is showing
  pictures: [], // { id, blob, url, label }: url is a local preview link for the <img> tags
  pictureSeq: 0,
  importing: false, // true while PDFs and Word files are being read
  inventory: null, // { key, status: "loading" | "ready" | "error", error, photoCount, pictures }
  items: [], // pieces the user can edit: API items + { included, keep_separate }
  looks: new Map(), // look id → box { left, top, right, bottom } as fractions of the picture
  crops: new Map(), // look id → Promise of a cropped picture URL (or null)
  cropUrls: new Map(), // look id → finished cropped picture URL (or null), for instant redraws
  addedSeq: 0, // numbering for pieces the user adds by hand ("u1", "u2", ...)
  answers: {}, // quiz answers, e.g. { occasion: "office", mood: "bold", ... }
  quizIndex: 0, // which question is showing
  result: null, // the last answer from /api/recommend
};

// Shorthand for document.querySelector.
const $ = (selector) => document.querySelector(selector);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Escapes text before it goes into HTML, so a piece named "<b>" can't break the page.
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// The passcode is remembered in localStorage. The try/catch covers private browsing,
// where localStorage can throw.
function loadPasscode() {
  try {
    return localStorage.getItem("outfitrecco-passcode");
  } catch {
    return null;
  }
}

function savePasscode(value) {
  state.passcode = value;
  try {
    if (value) localStorage.setItem("outfitrecco-passcode", value);
    else localStorage.removeItem("outfitrecco-passcode");
  } catch {
    // Private browsing: the passcode just isn't remembered.
  }
}

// Reads a message aloud for screen-reader users (the #announcer element is visually hidden).
function announce(message) {
  $("#announcer").textContent = message;
}

// Shows an error message in the given element, or hides it when the message is empty.
function showError(element, message) {
  element.textContent = message || "";
  element.hidden = !message;
}

// Shows or hides the "Demo mode" banner.
function setDemo(on) {
  state.demo = Boolean(on);
  $("#demo-banner").hidden = !state.demo;
}

class AuthError extends Error {}

// Calls one of our API routes with the passcode attached. Returns the JSON answer,
// or throws an Error whose message can be shown to the user (AuthError for a wrong passcode).
async function api(path, body) {
  let response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-app-passcode": state.passcode || "" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  if (response.status === 401) throw new AuthError("Wrong passcode.");
  if (response.status === 413) throw new Error("The photos are too large to send. Try fewer photos.");
  if (response.status === 204) return null;
  let data = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON error page (e.g. a platform timeout).
  }
  if (!response.ok) {
    if (response.status === 504) throw new Error("That took too long. Try again, or use fewer photos.");
    throw new Error(data?.error || `Something went wrong (error ${response.status}). Try again.`);
  }
  return data;
}

// If the passcode stopped working (e.g. you changed it on Vercel), go back to the passcode screen.
function handleAuthError(err) {
  if (!(err instanceof AuthError)) return false;
  savePasscode(null);
  show("gate");
  showError($("#gate-error"), "Enter the passcode again.");
  return true;
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

// Shows one screen, hides the others, updates the step bar, and moves keyboard focus
// to the new heading so screen readers announce the change.
function show(screen) {
  state.screen = screen;
  for (const section of document.querySelectorAll("main > section")) {
    section.hidden = section.id !== screen;
  }
  const nav = $(".steps");
  nav.hidden = screen === "gate";
  for (const step of nav.querySelectorAll("li")) {
    if (step.dataset.step === screen) step.setAttribute("aria-current", "step");
    else step.removeAttribute("aria-current");
  }
  window.scrollTo({ top: 0 });
  const heading = document.querySelector(`#${screen} h1:not([hidden])`);
  if (heading && !heading.closest("[hidden]")) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

// ---------------------------------------------------------------------------
// Passcode
// ---------------------------------------------------------------------------

// Checks the passcode with /api/verify before letting the user in.
$("#gate-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  const value = $("#passcode").value.trim();
  if (!value) return;
  button.disabled = true;
  showError($("#gate-error"), "");
  state.passcode = value;
  try {
    const info = await api("/api/verify", {});
    setDemo(info?.mock);
    savePasscode(value);
    $("#passcode").value = "";
    show("photos");
  } catch (err) {
    state.passcode = null;
    showError($("#gate-error"), err instanceof AuthError ? "That passcode didn't work." : err.message);
  } finally {
    button.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Photos (and PDFs and Word files)
// ---------------------------------------------------------------------------

const fileInput = $("#file-input");
const dropzone = $("#dropzone");
fileInput.accept = ACCEPT;
$("#picture-limit").textContent = MAX_PICTURES;

// Picking files, or dropping them on the box (the invisible file input covers the whole box).
fileInput.addEventListener("change", () => {
  addFiles([...fileInput.files]);
  fileInput.value = ""; // lets you pick the same file again later
});

// Highlights the box while files are dragged over it.
for (const type of ["dragenter", "dragover"]) {
  dropzone.addEventListener(type, () => dropzone.classList.add("dragging"));
}
for (const type of ["dragleave", "drop"]) {
  dropzone.addEventListener(type, () => dropzone.classList.remove("dragging"));
}

// Turns the chosen files into pictures (see file-import.js) and adds them, up to MAX_PICTURES in total.
async function addFiles(files) {
  if (files.length === 0) return;
  setImporting(true);
  showError($("#photos-error"), "");
  const problems = [];
  try {
    const room = MAX_PICTURES - state.pictures.length;
    const result = await filesToPictures(files, room);
    problems.push(...result.problems);
    if (result.leftOut > 0) {
      problems.push(`You can add up to ${MAX_PICTURES} pictures in total, so ${result.leftOut} ${result.leftOut === 1 ? "was" : "were"} left out.`);
    }

    for (const picture of result.pictures) {
      // Open every picture now, so a format the browser can't read (e.g. HEIC on Chrome)
      // is reported right away rather than when the photos are sent.
      let bitmap;
      try {
        bitmap = await createImageBitmap(picture.blob);
      } catch {
        problems.push(`${picture.label}: this browser can't read that image. Use JPEG, PNG or WebP.`);
        continue;
      }
      const tiny = Math.max(bitmap.width, bitmap.height) < MIN_DOCUMENT_PICTURE;
      bitmap.close?.();
      if (tiny && picture.fromDocument) continue; // an icon or logo inside a Word file
      state.pictures.push({ id: ++state.pictureSeq, blob: picture.blob, url: URL.createObjectURL(picture.blob), label: picture.label });
    }
  } catch (err) {
    problems.push(err.message);
  } finally {
    setImporting(false);
  }
  showError($("#photos-error"), problems.join("\n"));
  renderThumbs();
}

function setImporting(on) {
  state.importing = on;
  $("#photos-status").hidden = !on;
  $("#photos-next").disabled = on || state.pictures.length === 0;
}

// Removes one picture and frees its preview link.
function removePicture(id) {
  const index = state.pictures.findIndex((picture) => picture.id === id);
  if (index === -1) return;
  URL.revokeObjectURL(state.pictures[index].url);
  state.pictures.splice(index, 1);
  showError($("#photos-error"), "");
  renderThumbs();
}

// Draws the picture previews, each with its number and a remove button.
function renderThumbs() {
  $("#thumbs").innerHTML = state.pictures
    .map(
      (picture, index) => `
      <li title="${esc(picture.label)}">
        <img src="${picture.url}" alt="Picture ${index + 1}: ${esc(picture.label)}">
        <span class="photo-label">${index + 1}</span>
        <button class="remove" type="button" data-remove="${picture.id}" aria-label="Remove picture ${index + 1}">×</button>
      </li>`,
    )
    .join("");
  $("#photos-next").disabled = state.importing || state.pictures.length === 0;
}

// One click listener on the list handles every picture's remove button ("event delegation").
$("#thumbs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (button) removePicture(Number(button.dataset.remove));
});

// "Continue to quiz": start reading the pictures in the background, then show question 1.
$("#photos-next").addEventListener("click", () => {
  startInventory();
  state.quizIndex = 0;
  renderQuiz();
  show("quiz");
});

// The size Claude will read a picture at without shrinking it (see config.js):
// longest side at most `maxEdge`, and at most CLAUDE_MAX_IMAGE_TOKENS tokens.
function fitForClaude(width, height, maxEdge) {
  let scale = Math.min(1, maxEdge / Math.max(width, height));
  const tokens = (s) => Math.ceil((width * s) / 28) * Math.ceil((height * s) / 28);
  while (tokens(scale) > CLAUDE_MAX_IMAGE_TOKENS) scale *= 0.98;
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

// Shrinks and re-encodes one picture as JPEG so the upload stays under Vercel's limit.
// It draws the picture onto a <canvas> at the size Claude reads without shrinking, then lowers
// the JPEG quality (and after that, the size) until it fits its share of the upload budget.
// Returns { media_type, data, width, height }: the API needs the exact size for the look boxes.
async function prepareImage(picture, budget) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(picture.blob);
  } catch {
    throw new Error(`Couldn't read "${picture.label}". Use JPEG, PNG or WebP photos.`);
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  let edge = CLAUDE_MAX_EDGE;
  let quality = 0.85;
  try {
    for (let attempt = 0; attempt < 14; attempt++) {
      const size = fitForClaude(bitmap.width, bitmap.height, edge);
      canvas.width = size.width;
      canvas.height = size.height;
      context.fillStyle = "#fff"; // transparent PNGs would turn black as JPEG
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      const data = await blobToBase64(blob);
      if (data.length <= budget) return { media_type: "image/jpeg", data, width: size.width, height: size.height };
      if (quality > 0.62) quality -= 0.1;
      else edge = Math.round(edge * 0.8);
    }
  } finally {
    bitmap.close?.();
  }
  throw new Error(`"${picture.label}" is too large to send, even after shrinking it.`);
}

// Converts an image file to the base64 text the Claude API expects.
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Couldn't read a photo."));
    reader.readAsDataURL(blob);
  });
}

// ---------------------------------------------------------------------------
// Inventory (runs in the background while the quiz is taken)
// ---------------------------------------------------------------------------

// Sends the pictures to /api/inventory without waiting for the answer, so it runs while
// the user takes the quiz. The `key` records which pictures were sent: if the user changes
// them, the old answer is ignored and a new request is made.
function startInventory({ force = false } = {}) {
  const key = state.pictures.map((picture) => picture.id).join(",");
  const current = state.inventory;
  if (!force && current && current.key === key && current.status !== "error") return;

  // The crops belong to the previous pictures, so throw them away.
  clearCrops();
  const pictures = [...state.pictures];
  state.inventory = { key, status: "loading", error: null, photoCount: pictures.length, pictures };
  state.items = [];
  state.looks = new Map();

  (async () => {
    try {
      // Split the size budget evenly between the pictures, then shrink each one.
      const budget = Math.floor(MAX_UPLOAD_CHARS / pictures.length);
      const images = [];
      for (const picture of pictures) images.push(await prepareImage(picture, budget));
      const data = await api("/api/inventory", { images });
      if (state.inventory?.key !== key) return; // pictures changed meanwhile
      // Every piece starts ticked, with duplicates merged (keep_separate: false).
      state.items = data.items.map((item) => ({ ...item, included: true, keep_separate: false }));
      state.looks = new Map((data.looks ?? []).map((look) => [look.id, look.box]));
      state.inventory.status = "ready";
    } catch (err) {
      if (state.inventory?.key !== key) return;
      if (handleAuthError(err)) {
        state.inventory = null;
        return;
      }
      state.inventory.status = "error";
      state.inventory.error = err.message;
    }
    // If the user is already waiting on the pieces screen, show the result now.
    if (state.screen === "pieces") renderPieces();
  })();
}

// ---------------------------------------------------------------------------
// Pictures of pieces: crop each look out of its picture
// ---------------------------------------------------------------------------

// How many different looks the AI found in one picture.
function looksInPicture(photoNumber) {
  const ids = new Set([...state.looks.keys(), ...state.items.flatMap((item) => item.seen_in ?? [])]);
  return [...ids].filter((id) => LOOK_RE.exec(id)?.[1] === String(photoNumber)).length;
}

// Returns (a promise of) a picture URL for one look, cropped from the picture it's in,
// or null when there's nothing sensible to show. Results are cached per look.
function lookPicture(lookId) {
  if (!state.crops.has(lookId)) {
    const promise = cropLook(lookId)
      .catch(() => null)
      .then((url) => {
        state.cropUrls.set(lookId, url);
        return url;
      });
    state.crops.set(lookId, promise);
  }
  return state.crops.get(lookId);
}

async function cropLook(lookId) {
  const match = LOOK_RE.exec(lookId || "");
  const picture = match && state.inventory?.pictures?.[Number(match[1]) - 1];
  if (!picture) return null;

  let box = state.looks.get(lookId);
  if (!box) {
    // No box from the AI: show the whole picture, but only if this look is the only one in it.
    if (looksInPicture(Number(match[1])) > 1) return null;
    box = { left: 0, top: 0, right: 1, bottom: 1 };
  }

  const bitmap = await createImageBitmap(picture.blob);
  try {
    // Add a little margin around the box, in case the AI drew it slightly tight.
    const padX = (box.right - box.left) * 0.04;
    const padY = (box.bottom - box.top) * 0.02;
    const left = Math.max(0, box.left - padX) * bitmap.width;
    const top = Math.max(0, box.top - padY) * bitmap.height;
    const width = Math.min(1, box.right + padX) * bitmap.width - left;
    const height = Math.min(1, box.bottom + padY) * bitmap.height - top;
    const scale = Math.min(1, CROP_EDGE / Math.max(width, height));

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, left, top, width, height, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    return URL.createObjectURL(blob);
  } finally {
    bitmap.close?.();
  }
}

// Frees all cropped pictures (when the pictures change or the user starts over).
function clearCrops() {
  for (const url of state.cropUrls.values()) if (url) URL.revokeObjectURL(url);
  state.crops = new Map();
  state.cropUrls = new Map();
}

// HTML for a piece's picture. If the crop is ready it's shown straight away; otherwise
// the <img> gets a data-look attribute and fillPictures() adds the picture when it's ready.
// When there's no picture at all (e.g. a piece you added by hand), the frame shows the name instead.
function piecePicture(item, className) {
  const lookId = item?.seen_in?.[0];
  const fit = FIT_CLASS[item?.type] ?? "fit-whole";
  const fallback = `<span class="pic-fallback">${esc(item?.name ?? "")}</span>`;
  if (!lookId || state.cropUrls.get(lookId) === null) {
    return `<span class="pic ${className} no-pic">${fallback}</span>`;
  }
  const url = state.cropUrls.get(lookId);
  const src = url ? `src="${url}"` : `data-look="${esc(lookId)}"`;
  return `<span class="pic ${className}"><img ${src} class="${fit}" alt="${esc(item.name)}">${fallback}</span>`;
}

// Fills in every picture inside `root` that's still waiting for its crop.
function fillPictures(root) {
  for (const img of root.querySelectorAll("img[data-look]")) {
    lookPicture(img.dataset.look).then((url) => {
      if (url) img.src = url;
      else img.closest(".pic")?.classList.add("no-pic");
      img.removeAttribute("data-look");
    });
  }
}

// ---------------------------------------------------------------------------
// Quiz
// ---------------------------------------------------------------------------

// Shows the current question and its answer buttons. aria-pressed marks the chosen answer.
function renderQuiz() {
  const question = QUIZ[state.quizIndex];
  $("#quiz-count").textContent = `Question ${state.quizIndex + 1} of ${QUIZ.length}`;
  $("#quiz-question").textContent = question.question;
  $("#quiz-options").innerHTML = question.options
    .map(
      (option) => `
      <button class="option" type="button" data-value="${esc(option.value)}"
        aria-pressed="${state.answers[question.key] === option.value}">${esc(option.label)}</button>`,
    )
    .join("");
}

// Tapping an answer saves it and moves to the next question after a short pause,
// so you can see what you picked. After the last question, go to the pieces screen.
$("#quiz-options").addEventListener("click", (event) => {
  const button = event.target.closest(".option");
  if (!button) return;
  const question = QUIZ[state.quizIndex];
  state.answers[question.key] = button.dataset.value;
  for (const option of $("#quiz-options").children) {
    option.setAttribute("aria-pressed", option === button);
  }
  setTimeout(() => {
    if (state.quizIndex < QUIZ.length - 1) {
      state.quizIndex++;
      renderQuiz();
      $("#quiz-question").focus({ preventScroll: true });
    } else {
      goToPieces();
    }
  }, 180);
});

// Back goes to the previous question, or to the photos from question 1.
$("#quiz-back").addEventListener("click", () => {
  if (state.quizIndex === 0) {
    show("photos");
    return;
  }
  state.quizIndex--;
  renderQuiz();
});

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

// Opens the pieces screen. It shows a loading message until /api/inventory answers.
function goToPieces() {
  showError($("#recommend-error"), "");
  if (!state.inventory) startInventory();
  renderPieces();
  show("pieces");
}

// Mirrors the server: a flagged duplicate belongs to the piece it points to,
// unless the user chose "Keep separate".
function rootOf(item, byId) {
  const visited = new Set([item.id]);
  let current = item;
  while (current.possible_duplicate_of && !current.keep_separate) {
    const target = byId.get(current.possible_duplicate_of);
    if (!target || target.type !== current.type || visited.has(target.id)) break;
    visited.add(target.id);
    current = target;
  }
  return current;
}

// Turns ["p1_l3", "p1_l7"] into readable text: "Looks 3, 7" for a single collage,
// or "Photo 2" / "Photo 1, looks 3, 7" when several pictures were uploaded.
function describeLooks(seenIn) {
  const photoCount = state.inventory?.photoCount ?? state.pictures.length;
  const looks = (seenIn || [])
    .map((look) => LOOK_RE.exec(look))
    .filter(Boolean)
    .map((match) => ({ photo: Number(match[1]), look: Number(match[2]) }));
  if (looks.length === 0) return "";
  if (photoCount <= 1) {
    return `${looks.length > 1 ? "Looks" : "Look"} ${looks.map((l) => l.look).join(", ")}`;
  }
  const multiLook = new Set(
    state.items.flatMap((item) => item.seen_in || []).map((s) => LOOK_RE.exec(s))
      .filter((m) => m && Number(m[2]) > 1).map((m) => Number(m[1])),
  );
  const byPhoto = new Map();
  for (const { photo, look } of looks) byPhoto.set(photo, [...(byPhoto.get(photo) || []), look]);
  return [...byPhoto]
    .map(([photo, nums]) =>
      multiLook.has(photo) ? `Photo ${photo}, ${nums.length > 1 ? "looks" : "look"} ${nums.join(", ")}` : `Photo ${photo}`,
    )
    .join("; ");
}

// Draws the pieces screen: a loading message, an error with "Try again", or the piece list.
// Pieces are grouped by type. Duplicates appear inside the piece they're merged into,
// with a "Keep separate" button.
function renderPieces() {
  const inventory = state.inventory;
  $("#pieces-loading").hidden = inventory?.status !== "loading";
  $("#pieces-error").hidden = inventory?.status !== "error";
  $("#pieces-ready").hidden = inventory?.status !== "ready";
  if (inventory?.status === "error") {
    $("#pieces-error .error").textContent = inventory.error;
    return;
  }
  if (inventory?.status !== "ready") return;

  // Split the pieces into "primaries" (shown as rows) and "children" (duplicates merged into a row).
  const byId = new Map(state.items.map((item) => [item.id, item]));
  const children = new Map();
  const primaries = [];
  for (const item of state.items) {
    const root = rootOf(item, byId);
    if (root === item) primaries.push(item);
    else children.set(root.id, [...(children.get(root.id) || []), item]);
  }

  $("#piece-groups").innerHTML = TYPE_ORDER.map((type) => {
    const group = primaries.filter((item) => item.type === type);
    if (group.length === 0) return "";
    const count = group.filter((item) => item.included).length;
    return `
      <section class="piece-group">
        <h2>${GROUP_LABELS[type]}<span class="count">${count} of ${group.length} selected</span></h2>
        <ul class="piece-list">${group.map((item) => pieceRow(item, children.get(item.id) || [], byId)).join("")}</ul>
      </section>`;
  }).join("");
  fillPictures($("#piece-groups"));

  $("#add-type").innerHTML = TYPE_ORDER.map((type) => `<option value="${type}">${TYPE_LABELS[type]}</option>`).join("");
}

// HTML for one piece: checkbox, picture, name, where it was seen, type dropdown,
// plus a box for each duplicate merged into it (or for "Kept separate from ...").
function pieceRow(item, merged, byId) {
  const meta = [describeLooks(item.seen_in), item.visibility === "partial" ? "Partly hidden in the photo" : "", item.id.startsWith("u") ? "Added by you" : ""]
    .filter(Boolean)
    .join(". ");
  const keptFrom = item.keep_separate && byId.get(item.possible_duplicate_of);
  return `
    <li class="piece${item.included ? "" : " off"}">
      <div class="piece-row">
        <input type="checkbox" id="chk-${esc(item.id)}" data-toggle="${esc(item.id)}" ${item.included ? "checked" : ""}>
        ${piecePicture(item, "thumb")}
        <label for="chk-${esc(item.id)}">
          <span class="piece-name">${esc(item.name)}</span>
          ${meta ? `<span class="piece-meta">${esc(meta)}</span>` : ""}
        </label>
        <select data-type="${esc(item.id)}" aria-label="Type of ${esc(item.name)}">
          ${TYPE_ORDER.map((type) => `<option value="${type}" ${type === item.type ? "selected" : ""}>${TYPE_LABELS[type]}</option>`).join("")}
        </select>
      </div>
      ${merged
        .map(
          (dup) => `
        <div class="merged">
          ${piecePicture(dup, "mini")}
          <span class="merged-text">Also seen as ${esc(dup.name)}${describeLooks(dup.seen_in) ? ` (${esc(describeLooks(dup.seen_in).toLowerCase())})` : ""}. Counted as the same piece.</span>
          <button class="btn" type="button" data-keep="${esc(dup.id)}">Keep separate</button>
        </div>`,
        )
        .join("")}
      ${keptFrom
        ? `<div class="merged">
            <span class="merged-text">Kept separate from ${esc(keptFrom.name)}.</span>
            <button class="small-link" type="button" data-merge="${esc(item.id)}">Merge back</button>
          </div>`
        : ""}
    </li>`;
}

// Ticking/unticking a piece, or changing its type in the dropdown.
$("#piece-groups").addEventListener("change", (event) => {
  const toggle = event.target.closest("[data-toggle]");
  const typeSelect = event.target.closest("[data-type]");
  if (toggle) {
    const item = state.items.find((i) => i.id === toggle.dataset.toggle);
    item.included = toggle.checked;
    renderPieces();
    document.getElementById(`chk-${item.id}`)?.focus();
  } else if (typeSelect) {
    const item = state.items.find((i) => i.id === typeSelect.dataset.type);
    item.type = typeSelect.value;
    renderPieces();
    announce(`${item.name} moved to ${GROUP_LABELS[item.type]}.`);
  }
});

// "Keep separate" and "Merge back" just flip keep_separate. The server does the actual merging.
$("#piece-groups").addEventListener("click", (event) => {
  const keep = event.target.closest("[data-keep]");
  const merge = event.target.closest("[data-merge]");
  const id = keep?.dataset.keep ?? merge?.dataset.merge;
  if (!id) return;
  const item = state.items.find((i) => i.id === id);
  item.keep_separate = Boolean(keep);
  renderPieces();
  announce(keep ? `${item.name} is now a separate piece.` : `${item.name} merged back.`);
});

// "Add a missing piece": pieces added by hand get ids "u1", "u2", ... so they can't clash with the AI's "i1", "i2".
$("#add-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("#add-name").value.trim();
  if (!name) return;
  let id;
  do id = `u${++state.addedSeq}`;
  while (state.items.some((item) => item.id === id));
  state.items.push({
    id, name, type: $("#add-type").value, color: "", pattern: "", description: "",
    formality: 3, visibility: "full", seen_in: [], possible_duplicate_of: null,
    included: true, keep_separate: false,
  });
  $("#add-name").value = "";
  renderPieces();
  announce(`Added ${name}.`);
});

// Reads the pictures again after an error.
$("#pieces-retry").addEventListener("click", () => {
  startInventory({ force: true });
  renderPieces();
});

// The pieces to send to /api/recommend: ticked ones only, without the browser-only "included" flag.
function selectedItems() {
  const byId = new Map(state.items.map((item) => [item.id, item]));
  // A merged duplicate is dropped along with its piece when that piece is unticked.
  return state.items
    .filter((item) => item.included && rootOf(item, byId).included)
    .map(({ included, ...item }) => item);
}

// "Get outfits": quick check that an outfit is possible, then call /api/recommend.
// On an error, go back to the pieces screen and show the message there.
$("#get-outfits").addEventListener("click", async () => {
  const items = selectedItems();
  const has = (type) => items.some((item) => item.type === type);
  if (!has("one_piece") && !(has("top") && has("bottom"))) {
    showError($("#recommend-error"), "Select at least one one-piece, or at least one top and one bottom.");
    return;
  }
  showError($("#recommend-error"), "");
  $("#results-loading").hidden = false;
  $("#results-ready").hidden = true;
  show("results");
  try {
    state.result = await api("/api/recommend", { quiz: state.answers, items });
    renderResults();
  } catch (err) {
    if (handleAuthError(err)) return;
    show("pieces");
    showError($("#recommend-error"), err.message);
  }
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

// Draws the results: a heading from the quiz answers, one tag per outfit, one card per idea.
function renderResults() {
  const { outfits, ideas, items, skipped = 0 } = state.result;
  const byId = new Map(items.map((item) => [item.id, item]));
  const labelFor = (key) => QUIZ.find((q) => q.key === key).options.find((o) => o.value === state.answers[key])?.label ?? "";

  $("#results-title").textContent = `Outfits for ${OCCASION_PHRASES[state.answers.occasion] ?? state.answers.occasion}`;
  const summary = ["mood", "weather", "time", "priority"].map(labelFor).filter(Boolean);
  $("#results-summary").textContent = summary.length
    ? `${summary[0]}${summary.length > 1 ? `, ${summary.slice(1).map((s) => s.toLowerCase()).join(", ")}` : ""}.`
    : "";

  // No outfits can mean two different things: the AI's outfits broke the rules (skipped),
  // or nothing in the selected pieces suits the situation.
  const empty = skipped > 0
    ? "The AI's outfits didn't follow the outfit rules, so none could be shown. Try again."
    : "None of your selected pieces suit this well. The ideas below could fill the gap.";
  const outfitsEl = $("#outfits");
  outfitsEl.innerHTML = outfits.length
    ? outfits.map((outfit, index) => outfitTag(outfit, index, byId)).join("")
    : `<p class="empty">${empty}</p>`;
  outfitsEl.classList.remove("enter");
  void outfitsEl.offsetWidth; // restart the entrance animation
  outfitsEl.classList.add("enter");

  $("#ideas").innerHTML = ideas.length
    ? ideas.map((idea) => ideaCard(idea, byId)).join("")
    : `<p class="empty">No extra ideas this time.</p>`;

  fillPictures($("#results"));
  $("#results-loading").hidden = true;
  $("#results-ready").hidden = false;
  show("results");
  announce(`${outfits.length} outfit${outfits.length === 1 ? "" : "s"} ready.`);
}

// HTML for one outfit, styled as a swing tag: a board with a picture of each piece,
// the pieces by slot, why it works, and a styling tip.
function outfitTag(outfit, index, byId) {
  const slots = SLOT_ORDER.filter((slot) => outfit.items[slot] && byId.has(outfit.items[slot]));
  const board = slots
    .map((slot) => {
      const item = byId.get(outfit.items[slot]);
      return `<figure class="board-piece">${piecePicture(item, "board-pic")}<figcaption>${TYPE_LABELS[slot]}</figcaption></figure>`;
    })
    .join("");
  const pieces = slots.map((slot) => {
    const item = byId.get(outfit.items[slot]);
    const where = describeLooks(item.seen_in);
    return `
      <li>
        <span class="slot">${TYPE_LABELS[slot]}</span>
        <span class="piece-label">${esc(item.name)}${where ? `<span class="where">${esc(where)}</span>` : ""}</span>
      </li>`;
  });
  return `
    <article class="tag" style="--i:${index}">
      <div class="tag-body">
        <h3>${esc(outfit.name)}</h3>
        ${outfit.worn_before ? `<span class="worn">You've worn these together before</span>` : ""}
        <div class="board" style="--n:${slots.length}">${board}</div>
        <ul class="outfit-pieces">${pieces.join("")}</ul>
        <p class="why">${esc(outfit.why)}</p>
        ${outfit.styling_tip ? `<p class="tip"><strong>Styling tip:</strong> ${esc(outfit.styling_tip)}</p>` : ""}
      </div>
    </article>`;
}

// HTML for one "Worth looking for" idea, with Google and Pinterest search links.
function ideaCard(idea, byId) {
  const pairNames = idea.pair_with.map((id) => byId.get(id)?.name).filter(Boolean);
  const closest = byId.get(idea.closest_owned);
  const query = encodeURIComponent(idea.search_query);
  return `
    <article class="idea">
      <h3>${esc(idea.piece)}</h3>
      <p class="description">${esc(idea.description)}</p>
      ${idea.why ? `<p class="why">${esc(idea.why)}</p>` : ""}
      <dl>
        ${pairNames.length ? `<div><dt>Wear it with</dt><dd>${esc(pairNames.join(", "))}</dd></div>` : ""}
        ${closest
          ? `<div><dt>Closest thing you own</dt><dd class="with-pic">${piecePicture(closest, "mini")}<span>${esc(closest.name)}</span></dd></div>`
          : ""}
      </dl>
      <div class="search-links">
        <a href="https://www.google.com/search?tbm=isch&q=${query}" target="_blank" rel="noopener">Find similar on Google</a>
        <a href="https://www.pinterest.com/search/pins/?q=${query}" target="_blank" rel="noopener">Find similar on Pinterest</a>
      </div>
    </article>`;
}

// Retake the quiz with the same pieces (your previous answers stay selected).
$("#change-answers").addEventListener("click", () => {
  state.quizIndex = 0;
  renderQuiz();
  show("quiz");
});

$("#edit-pieces").addEventListener("click", goToPieces);

// Clear everything except the passcode.
$("#start-over").addEventListener("click", () => {
  if (!window.confirm("Start over? Your photos, pieces and answers will be cleared.")) return;
  for (const picture of state.pictures) URL.revokeObjectURL(picture.url);
  clearCrops();
  Object.assign(state, {
    pictures: [], inventory: null, items: [], looks: new Map(), answers: {}, quizIndex: 0, result: null,
  });
  renderThumbs();
  show("photos");
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

// With a remembered passcode, go straight to the photos and check the passcode quietly
// (which also tells us whether the server is in demo mode). A wrong passcode brings
// the passcode screen back.
async function start() {
  renderThumbs();
  if (!state.passcode) {
    show("gate");
    return;
  }
  show("photos");
  try {
    const info = await api("/api/verify", {});
    setDemo(info?.mock);
  } catch (err) {
    handleAuthError(err); // other errors (e.g. offline) can wait until the user continues
  }
}

start();
