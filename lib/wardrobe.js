// lib/wardrobe.js
// The app's own rules, applied in plain code rather than trusted to the AI:
//   1. normalizeInventory:  clean up the piece list the AI returns from the photos
//   2. sanitizeClientItems: validate the piece list the browser sends back after edits
//   3. mergeDuplicates:     count a piece seen in several photos only once
//   4. checkRecommendation: reject outfits that break the rules (fake ids, saree + jeans, repeats)
//   5. withNamesInText:     replace any stray ids like "i5" in the text with the piece's name
//
// Vocabulary used throughout:
//   item / piece: one garment, e.g. { id: "i5", name: "Black skinny jeans", type: "bottom", ... }
//   seen_in:      which looks it appears in, as "p{photo}_l{look}", e.g. "p1_l3" = photo 1, look 3
//   possible_duplicate_of: set by the AI when it thinks two items are the same garment

import { ITEM_TYPES } from "./schemas.js";

const LOOK_RE = /^p(\d+)_l(\d+)$/; // matches "p1_l3"
const ID_RE = /^[A-Za-z0-9_-]{1,24}$/; // allowed characters in an item id
const MAX_ITEMS = 80; // more pieces than this is almost certainly a mistake

// Returns a trimmed string of at most `max` characters, or "" if the value isn't a string.
const str = (value, max = 200) => (typeof value === "string" ? value.trim().slice(0, max) : "");

// Formality must be a whole number from 1 (loungewear) to 5 (formal). Anything else becomes 3.
const clampFormality = (value) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3;
};

// ---------------------------------------------------------------------------
// 1. Inventory: clean up what the model returns
// ---------------------------------------------------------------------------

// The schema guarantees the JSON shape, but not the values, so this fixes or drops
// anything unusable: unknown types, repeated ids, formality outside 1-5,
// looks that point to photos that weren't uploaded, and broken duplicate flags.
export function normalizeInventory(rawItems, photoCount) {
  if (!Array.isArray(rawItems)) return [];
  const items = [];
  const usedIds = new Set();
  const idMap = new Map(); // model id -> final id

  for (const raw of rawItems.slice(0, MAX_ITEMS)) {
    const type = str(raw?.type).toLowerCase(); // enum values can come back in any case
    const name = str(raw?.name, 80);
    if (!ITEM_TYPES.includes(type) || !name) continue;

    let id = str(raw.id, 24);
    if (!ID_RE.test(id) || usedIds.has(id)) id = nextFreeId(usedIds); // repeated or odd id: pick a new one
    usedIds.add(id);
    if (raw.id && !idMap.has(raw.id)) idMap.set(raw.id, id);

    // Keep only well-formed looks from photos that were actually uploaded.
    const seenIn = Array.isArray(raw.seen_in)
      ? [...new Set(raw.seen_in.map((s) => str(s, 12).toLowerCase()))].filter((s) => {
          const m = LOOK_RE.exec(s);
          return m && Number(m[1]) >= 1 && Number(m[1]) <= photoCount;
        })
      : [];

    items.push({
      id,
      name,
      type,
      color: str(raw.color),
      pattern: str(raw.pattern),
      description: str(raw.description, 300),
      formality: clampFormality(raw.formality),
      visibility: str(raw.visibility).toLowerCase() === "partial" ? "partial" : "full",
      seen_in: seenIn,
      possible_duplicate_of: typeof raw.possible_duplicate_of === "string" ? raw.possible_duplicate_of : null,
    });
  }

  // Keep a duplicate flag only if it points to another existing item of the same type.
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const item of items) {
    const target = byId.get(idMap.get(item.possible_duplicate_of));
    item.possible_duplicate_of =
      target && target.id !== item.id && target.type === item.type ? target.id : null;
  }
  return items;
}

// Finds the next unused id of the form "i1", "i2", ...
function nextFreeId(used) {
  let n = used.size + 1;
  while (used.has(`i${n}`)) n++;
  return `i${n}`;
}

// ---------------------------------------------------------------------------
// 2. Items sent back by the browser (after the user's edits)
// ---------------------------------------------------------------------------

// Anything from the browser can be tampered with, so it's validated again here.
// Returns { items } when everything is fine, or { error } with a message to show.
export function sanitizeClientItems(input) {
  if (!Array.isArray(input)) return { error: "items must be an array." };
  if (input.length > MAX_ITEMS) return { error: `Send at most ${MAX_ITEMS} pieces.` };

  const items = [];
  const ids = new Set();
  for (const raw of input) {
    const id = str(raw?.id, 24);
    const type = str(raw?.type).toLowerCase();
    const name = str(raw?.name, 80);
    if (!ID_RE.test(id) || ids.has(id)) return { error: "Every piece needs a unique id." };
    if (!ITEM_TYPES.includes(type)) return { error: `"${name || id}" has an unknown type.` };
    if (!name) return { error: "Every piece needs a name." };
    ids.add(id);
    items.push({
      id,
      name,
      type,
      color: str(raw.color),
      pattern: str(raw.pattern),
      description: str(raw.description, 300),
      formality: clampFormality(raw.formality),
      seen_in: Array.isArray(raw.seen_in) ? raw.seen_in.map((s) => str(s, 12)).filter(Boolean) : [],
      possible_duplicate_of: typeof raw.possible_duplicate_of === "string" ? raw.possible_duplicate_of : null,
      keep_separate: raw.keep_separate === true,
    });
  }
  return { items };
}

// ---------------------------------------------------------------------------
// 3. Duplicates: merged by default unless the user chose "Keep separate"
// ---------------------------------------------------------------------------

// Example: the AI lists "Black skinny jeans" (i5, look 2) and "Black slim jeans"
// (i7, look 3, possible_duplicate_of: "i5"). Unless the user tapped "Keep separate" on i7,
// i7 disappears and i5 becomes { ..., seen_in: ["p1_l2", "p1_l3"], merged_ids: ["i7"] }.
// Without this, the AI would think you own two pairs and suggest them too often.
export function mergeDuplicates(items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const order = new Map(items.map((item, index) => [item.id, index]));

  // Follows the chain of duplicate flags (c → b → a) to the piece everything merges into.
  const rootOf = (item) => {
    const path = [item];
    let current = item;
    while (current.possible_duplicate_of && !current.keep_separate) {
      const target = byId.get(current.possible_duplicate_of);
      // Only merge into an existing piece of the same type.
      if (!target || target.type !== current.type) break;
      const loopStart = path.indexOf(target);
      if (loopStart !== -1) {
        // Flags that point at each other: everything in the loop merges into the earliest-listed piece.
        return path.slice(loopStart).reduce((a, b) => (order.get(a.id) <= order.get(b.id) ? a : b));
      }
      path.push(target);
      current = target;
    }
    return current;
  };

  // Build the result: one entry per kept piece, collecting the looks of everything merged into it.
  const merged = new Map();
  for (const item of items) {
    const root = rootOf(item);
    if (!merged.has(root.id)) {
      merged.set(root.id, { ...stripClientFields(root), seen_in: [...root.seen_in], merged_ids: [] });
    }
    if (root.id !== item.id) {
      const target = merged.get(root.id);
      target.merged_ids.push(item.id);
      target.seen_in = [...new Set([...target.seen_in, ...item.seen_in])];
    }
  }
  return [...merged.values()];
}

// The duplicate fields are only needed for merging, so they're removed before the AI sees the items.
function stripClientFields({ possible_duplicate_of, keep_separate, ...rest }) {
  return rest;
}

// An outfit needs a one-piece, or a top plus a bottom. Checked before paying for an AI call.
export function canMakeOutfit(items) {
  const has = (type) => items.some((item) => item.type === type);
  return has("one_piece") || (has("top") && has("bottom"));
}

// ---------------------------------------------------------------------------
// 4. Recommendations: check the model's answer against the rules
// ---------------------------------------------------------------------------

const SLOTS = ["top", "bottom", "one_piece", "layer"];

// Goes through each suggested outfit and keeps it only if:
//   - every id exists in the wardrobe and sits in the slot matching its type
//   - it's one one-piece, OR a top plus a bottom (a layer is optional either way)
//   - it isn't a repeat of an earlier outfit
// Returns { outfits, ideas, errors }. The errors are written so they can be sent back
// to the AI for a second attempt (see api/recommend.js).
export function checkRecommendation(result, items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const errors = [];
  const outfits = [];
  const seenCombos = new Set();

  (Array.isArray(result?.from_wardrobe) ? result.from_wardrobe : []).forEach((outfit, index) => {
    const label = `Outfit ${index + 1} ("${str(outfit?.name, 60)}")`;
    const slots = {};
    let problem = null;

    // Look up each slot's id and check it's a real item of the right type.
    for (const slot of SLOTS) {
      const id = outfit?.items?.[slot] || null;
      if (id === null) continue;
      const item = byId.get(id);
      if (!item) problem ??= `${label} uses "${id}", which isn't in the inventory.`;
      else if (item.type !== slot) problem ??= `${label} puts "${item.name}" (a ${item.type}) in the ${slot} slot.`;
      else slots[slot] = id;
    }

    // Check the outfit's shape.
    if (!problem) {
      if (slots.one_piece && (slots.top || slots.bottom)) {
        problem = `${label} combines a one_piece with a top or bottom.`;
      } else if (!slots.one_piece && !(slots.top && slots.bottom)) {
        problem = `${label} needs either a one_piece, or both a top and a bottom.`;
      }
    }

    // Same pieces in a different order still count as a repeat.
    const combo = Object.values(slots).sort().join("+");
    if (!problem && seenCombos.has(combo)) problem = `${label} repeats an earlier outfit.`;

    if (problem) {
      errors.push(problem);
      return;
    }
    seenCombos.add(combo);
    outfits.push({
      name: str(outfit.name, 60),
      items: Object.fromEntries(SLOTS.map((slot) => [slot, slots[slot] ?? null])),
      why: str(outfit.why, 500),
      styling_tip: str(outfit.styling_tip, 300),
      worn_before: wornTogether(byId.get(slots.top), byId.get(slots.bottom)),
    });
  });

  // Ideas are suggestions, so unknown ids are dropped rather than treated as errors.
  const ideas = (Array.isArray(result?.worth_looking_for) ? result.worth_looking_for : [])
    .slice(0, 2)
    .map((idea) => ({
      piece: str(idea?.piece, 80),
      description: str(idea?.description, 300),
      search_query: str(idea?.search_query, 80) || str(idea?.piece, 80),
      pair_with: Array.isArray(idea?.pair_with) ? [...new Set(idea.pair_with)].filter((id) => byId.has(id)) : [],
      closest_owned: byId.has(idea?.closest_owned) ? idea.closest_owned : null,
      why: str(idea?.why, 500),
    }))
    .filter((idea) => idea.piece);

  return { outfits: outfits.slice(0, 3), ideas, errors };
}

// True when the top and bottom were already worn together in one of the uploaded looks.
// The results page shows this as "You've worn these together before".
function wornTogether(top, bottom) {
  if (!top || !bottom) return false;
  return top.seen_in.some((look) => bottom.seen_in.includes(look));
}

// ---------------------------------------------------------------------------
// 5. Text clean-up
// ---------------------------------------------------------------------------

// The prompt asks the AI to use names, not ids, but this is a safety net:
// "Pair i13 with i14" becomes "Pair Lilac crop top with Denim shorts".
export function replaceIdsWithNames(text, items) {
  if (!text || items.length === 0) return text;
  const names = new Map(items.map((item) => [item.id, item.name]));
  // Ids only contain letters, digits, "_" and "-", so they're safe inside a regex.
  const pattern = new RegExp(`\\b(${[...names.keys()].join("|")})\\b`, "g");
  return text.replace(pattern, (id) => names.get(id));
}

// Applies replaceIdsWithNames to every piece of text the user will read.
export function withNamesInText({ outfits, ideas }, items) {
  const fix = (text) => replaceIdsWithNames(text, items);
  return {
    outfits: outfits.map((o) => ({ ...o, name: fix(o.name), why: fix(o.why), styling_tip: fix(o.styling_tip) })),
    ideas: ideas.map((i) => ({ ...i, piece: fix(i.piece), description: fix(i.description), why: fix(i.why) })),
  };
}
