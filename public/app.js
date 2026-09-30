import { QUIZ } from "./quiz-options.js";

// ---------------------------------------------------------------------------
// Constants and state
// ---------------------------------------------------------------------------

const MAX_PHOTOS = 10;
// Vercel caps request bodies at 4.5 MB, so all photos together stay under ~4 MB of base64.
const MAX_UPLOAD_CHARS = 4_000_000;
const MAX_EDGE = 1568; // Claude downsizes anything larger anyway

const TYPE_LABELS = { top: "Top", bottom: "Bottom", one_piece: "One-piece", layer: "Layer" };
const GROUP_LABELS = { top: "Tops", bottom: "Bottoms", one_piece: "One-pieces", layer: "Layers" };
const TYPE_ORDER = ["one_piece", "top", "bottom", "layer"];
const SLOT_ORDER = ["one_piece", "top", "bottom", "layer"];
const OCCASION_PHRASES = {
  office: "the office",
  "casual outing": "a casual outing",
  date: "a date",
  party: "a party",
  "festive or traditional event": "a festive occasion",
  travel: "a travel day",
};

const state = {
  passcode: loadPasscode(),
  screen: null,
  photos: [], // { id, file, url }
  photoSeq: 0,
  inventory: null, // { key, status: "loading" | "ready" | "error", error }
  items: [], // pieces the user can edit: API items + { included, keep_separate }
  addedSeq: 0,
  answers: {},
  quizIndex: 0,
  result: null,
};

const $ = (selector) => document.querySelector(selector);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

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

function announce(message) {
  $("#announcer").textContent = message;
}

function showError(element, message) {
  element.textContent = message || "";
  element.hidden = !message;
}

class AuthError extends Error {}

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

$("#gate-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  const value = $("#passcode").value.trim();
  if (!value) return;
  button.disabled = true;
  showError($("#gate-error"), "");
  state.passcode = value;
  try {
    await api("/api/verify", {});
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
// Photos
// ---------------------------------------------------------------------------

const fileInput = $("#file-input");
const dropzone = $("#dropzone");

fileInput.addEventListener("change", () => {
  addFiles(fileInput.files);
  fileInput.value = "";
});

for (const type of ["dragenter", "dragover"]) {
  dropzone.addEventListener(type, () => dropzone.classList.add("dragging"));
}
for (const type of ["dragleave", "drop"]) {
  dropzone.addEventListener(type, () => dropzone.classList.remove("dragging"));
}

function addFiles(fileList) {
  const files = [...fileList].filter((file) => file.type.startsWith("image/"));
  const room = MAX_PHOTOS - state.photos.length;
  let message = "";
  if (files.length < fileList.length) message = "Only image files can be added.";
  if (files.length > room) message = `You can add up to ${MAX_PHOTOS} photos, so only the first ${Math.max(room, 0)} were added.`;
  for (const file of files.slice(0, Math.max(room, 0))) {
    state.photos.push({ id: ++state.photoSeq, file, url: URL.createObjectURL(file) });
  }
  showError($("#photos-error"), message);
  renderThumbs();
}

function removePhoto(id) {
  const index = state.photos.findIndex((photo) => photo.id === id);
  if (index === -1) return;
  URL.revokeObjectURL(state.photos[index].url);
  state.photos.splice(index, 1);
  showError($("#photos-error"), "");
  renderThumbs();
}

function renderThumbs() {
  $("#thumbs").innerHTML = state.photos
    .map(
      (photo, index) => `
      <li>
        <img src="${photo.url}" alt="Photo ${index + 1}">
        <span class="photo-label">${index + 1}</span>
        <button class="remove" type="button" data-remove="${photo.id}" aria-label="Remove photo ${index + 1}">×</button>
      </li>`,
    )
    .join("");
  $("#photos-next").disabled = state.photos.length === 0;
}

$("#thumbs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (button) removePhoto(Number(button.dataset.remove));
});

$("#photos-next").addEventListener("click", () => {
  startInventory();
  state.quizIndex = 0;
  renderQuiz();
  show("quiz");
});

// Shrinks and re-encodes photos in the browser so the upload stays under Vercel's limit.
async function prepareImage(file, budget) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`Couldn't read "${file.name}". Use JPEG, PNG or WebP photos.`);
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  let edge = MAX_EDGE;
  let quality = 0.85;
  try {
    for (let attempt = 0; attempt < 12; attempt++) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.fillStyle = "#fff"; // transparent PNGs would turn black as JPEG
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      const data = await blobToBase64(blob);
      if (data.length <= budget) return { media_type: "image/jpeg", data };
      if (quality > 0.62) quality -= 0.1;
      else edge = Math.round(edge * 0.8);
    }
  } finally {
    bitmap.close?.();
  }
  throw new Error(`"${file.name}" is too large to send, even after shrinking it.`);
}

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

function startInventory({ force = false } = {}) {
  const key = state.photos.map((photo) => photo.id).join(",");
  const current = state.inventory;
  if (!force && current && current.key === key && current.status !== "error") return;

  state.inventory = { key, status: "loading", error: null, photoCount: state.photos.length };
  state.items = [];
  const photos = [...state.photos];

  (async () => {
    try {
      const budget = Math.floor(MAX_UPLOAD_CHARS / photos.length);
      const images = [];
      for (const photo of photos) images.push(await prepareImage(photo.file, budget));
      const data = await api("/api/inventory", { images });
      if (state.inventory?.key !== key) return; // photos changed meanwhile
      state.items = data.items.map((item) => ({ ...item, included: true, keep_separate: false }));
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
    if (state.screen === "pieces") renderPieces();
  })();
}

// ---------------------------------------------------------------------------
// Quiz
// ---------------------------------------------------------------------------

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

function describeLooks(seenIn) {
  const photoCount = state.inventory?.photoCount ?? state.photos.length;
  const looks = (seenIn || [])
    .map((look) => /^p(\d+)_l(\d+)$/.exec(look))
    .filter(Boolean)
    .map((match) => ({ photo: Number(match[1]), look: Number(match[2]) }));
  if (looks.length === 0) return "";
  if (photoCount <= 1) {
    return `${looks.length > 1 ? "Looks" : "Look"} ${looks.map((l) => l.look).join(", ")}`;
  }
  const multiLook = new Set(
    state.items.flatMap((item) => item.seen_in || []).map((s) => /^p(\d+)_l(\d+)$/.exec(s))
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

function photoFor(item) {
  if ((state.inventory?.photoCount ?? 0) <= 1) return null;
  const match = /^p(\d+)_/.exec(item.seen_in?.[0] || "");
  return match ? state.photos[Number(match[1]) - 1]?.url ?? null : null;
}

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

  $("#add-type").innerHTML = TYPE_ORDER.map((type) => `<option value="${type}">${TYPE_LABELS[type]}</option>`).join("");
}

function pieceRow(item, merged, byId) {
  const meta = [describeLooks(item.seen_in), item.visibility === "partial" ? "Partly hidden in the photo" : "", item.id.startsWith("u") ? "Added by you" : ""]
    .filter(Boolean)
    .join(". ");
  const keptFrom = item.keep_separate && byId.get(item.possible_duplicate_of);
  return `
    <li class="piece${item.included ? "" : " off"}">
      <div class="piece-row">
        <input type="checkbox" id="chk-${esc(item.id)}" data-toggle="${esc(item.id)}" ${item.included ? "checked" : ""}>
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
          <span>Also seen as ${esc(dup.name)}${describeLooks(dup.seen_in) ? ` (${esc(describeLooks(dup.seen_in).toLowerCase())})` : ""}. Counted as the same piece.</span>
          <button class="btn" type="button" data-keep="${esc(dup.id)}">Keep separate</button>
        </div>`,
        )
        .join("")}
      ${keptFrom
        ? `<div class="merged">
            <span>Kept separate from ${esc(keptFrom.name)}.</span>
            <button class="small-link" type="button" data-merge="${esc(item.id)}">Merge back</button>
          </div>`
        : ""}
    </li>`;
}

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

$("#pieces-retry").addEventListener("click", () => {
  startInventory({ force: true });
  renderPieces();
});

function selectedItems() {
  const byId = new Map(state.items.map((item) => [item.id, item]));
  // A merged duplicate is dropped along with its piece when that piece is unticked.
  return state.items
    .filter((item) => item.included && rootOf(item, byId).included)
    .map(({ included, ...item }) => item);
}

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

function renderResults() {
  const { outfits, ideas, items } = state.result;
  const byId = new Map(items.map((item) => [item.id, item]));
  const labelFor = (key) => QUIZ.find((q) => q.key === key).options.find((o) => o.value === state.answers[key])?.label ?? "";

  $("#results-title").textContent = `Outfits for ${OCCASION_PHRASES[state.answers.occasion] ?? state.answers.occasion}`;
  const summary = ["mood", "weather", "time", "priority"].map(labelFor).filter(Boolean);
  $("#results-summary").textContent = summary.length
    ? `${summary[0]}${summary.length > 1 ? `, ${summary.slice(1).map((s) => s.toLowerCase()).join(", ")}` : ""}.`
    : "";

  const outfitsEl = $("#outfits");
  outfitsEl.innerHTML = outfits.length
    ? outfits.map((outfit, index) => outfitTag(outfit, index, byId)).join("")
    : `<p class="empty">None of your selected pieces suit this well. The ideas below could fill the gap.</p>`;
  outfitsEl.classList.remove("enter");
  void outfitsEl.offsetWidth; // restart the entrance animation
  outfitsEl.classList.add("enter");

  $("#ideas").innerHTML = ideas.length
    ? ideas.map((idea) => ideaCard(idea, byId)).join("")
    : `<p class="empty">No extra ideas this time.</p>`;

  $("#results-loading").hidden = true;
  $("#results-ready").hidden = false;
  show("results");
  announce(`${outfits.length} outfit${outfits.length === 1 ? "" : "s"} ready.`);
}

function outfitTag(outfit, index, byId) {
  const pieces = SLOT_ORDER.filter((slot) => outfit.items[slot]).map((slot) => {
    const item = byId.get(outfit.items[slot]);
    const photo = photoFor(item);
    const where = describeLooks(item.seen_in);
    return `
      <li>
        <span class="slot">${TYPE_LABELS[slot]}</span>
        <span class="piece-label">
          ${photo ? `<img src="${photo}" alt="">` : ""}
          <span>${esc(item.name)}${where ? `<span class="where">${esc(where)}</span>` : ""}</span>
        </span>
      </li>`;
  });
  return `
    <article class="tag" style="--i:${index}">
      <div class="tag-body">
        <h3>${esc(outfit.name)}</h3>
        ${outfit.worn_before ? `<span class="worn">You've worn these together before</span>` : ""}
        <ul class="outfit-pieces">${pieces.join("")}</ul>
        <p class="why">${esc(outfit.why)}</p>
        ${outfit.styling_tip ? `<p class="tip"><strong>Styling tip:</strong> ${esc(outfit.styling_tip)}</p>` : ""}
      </div>
    </article>`;
}

function ideaCard(idea, byId) {
  const pairNames = idea.pair_with.map((id) => byId.get(id)?.name).filter(Boolean);
  const closest = byId.get(idea.closest_owned)?.name;
  const query = encodeURIComponent(idea.search_query);
  return `
    <article class="idea">
      <h3>${esc(idea.piece)}</h3>
      <p class="description">${esc(idea.description)}</p>
      ${idea.why ? `<p class="why">${esc(idea.why)}</p>` : ""}
      <dl>
        ${pairNames.length ? `<div><dt>Wear it with</dt><dd>${esc(pairNames.join(", "))}</dd></div>` : ""}
        ${closest ? `<div><dt>Closest thing you own</dt><dd>${esc(closest)}</dd></div>` : ""}
      </dl>
      <div class="search-links">
        <a href="https://www.google.com/search?tbm=isch&q=${query}" target="_blank" rel="noopener">Find similar on Google</a>
        <a href="https://www.pinterest.com/search/pins/?q=${query}" target="_blank" rel="noopener">Find similar on Pinterest</a>
      </div>
    </article>`;
}

$("#change-answers").addEventListener("click", () => {
  state.quizIndex = 0;
  renderQuiz();
  show("quiz");
});

$("#edit-pieces").addEventListener("click", goToPieces);

$("#start-over").addEventListener("click", () => {
  if (!window.confirm("Start over? Your photos, pieces and answers will be cleared.")) return;
  for (const photo of state.photos) URL.revokeObjectURL(photo.url);
  Object.assign(state, { photos: [], inventory: null, items: [], answers: {}, quizIndex: 0, result: null });
  renderThumbs();
  show("photos");
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

renderThumbs();
show(state.passcode ? "photos" : "gate");
