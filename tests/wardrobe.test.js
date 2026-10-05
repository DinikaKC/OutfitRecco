import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canMakeOutfit,
  checkRecommendation,
  mergeDuplicates,
  normalizeInventory,
  normalizeLooks,
  replaceIdsWithNames,
  sanitizeClientItems,
} from "../lib/wardrobe.js";

// The real inventory the AI returned for the example collage.
const realInventory = JSON.parse(readFileSync(new URL("./fixtures/inventory-response.json", import.meta.url)));

const item = (id, type, extra = {}) => ({
  id, name: `Item ${id}`, type, color: "", pattern: "", description: "",
  formality: 2, seen_in: [], possible_duplicate_of: null, keep_separate: false, ...extra,
});

test("normalizeLooks turns pixel boxes into fractions of the picture", () => {
  const looks = normalizeLooks(realInventory.looks, [{ width: 1080, height: 1920 }]);
  assert.equal(looks.length, 11);
  assert.deepEqual(looks[0], {
    id: "p1_l1",
    box: { left: 0.0685, top: 0.062, right: 0.213, bottom: 0.2672 },
  });
});

test("normalizeLooks clamps, fixes swapped corners and drops unusable boxes", () => {
  const sizes = [{ width: 1000, height: 2000 }, { width: 500, height: 500 }];
  const looks = normalizeLooks(
    [
      { id: "P1_L1", box: { x1: -50, y1: 100, x2: 400, y2: 2500 } }, // off the edges: clamped
      { id: "p1_l2", box: { x1: 900, y1: 1800, x2: 500, y2: 1000 } }, // corners swapped: fixed
      { id: "p1_l3", box: { x1: 10, y1: 10, x2: 12, y2: 12 } }, // too small: dropped
      { id: "p3_l1", box: { x1: 0, y1: 0, x2: 10, y2: 10 } }, // photo 3 doesn't exist: dropped
      { id: "p1_l1", box: { x1: 0, y1: 0, x2: 500, y2: 500 } }, // repeat: dropped
      { id: "junk", box: { x1: 0, y1: 0, x2: 100, y2: 100 } }, // bad id: dropped
      { id: "p2_l1", box: { x1: 0, y1: 0, x2: 250, y2: 500 } },
    ],
    sizes,
  );
  assert.deepEqual(looks, [
    { id: "p1_l1", box: { left: 0, top: 0.05, right: 0.4, bottom: 1 } },
    { id: "p1_l2", box: { left: 0.5, top: 0.5, right: 0.9, bottom: 0.9 } },
    { id: "p2_l1", box: { left: 0, top: 0, right: 0.5, bottom: 1 } },
  ]);
  assert.deepEqual(normalizeLooks(undefined, sizes), []);
});

test("normalizeInventory keeps the real collage output intact", () => {
  const items = normalizeInventory(realInventory.items, 1);
  assert.equal(items.length, 22);
  assert.equal(items.find((i) => i.id === "i7").possible_duplicate_of, "i5");
  assert.equal(items.find((i) => i.id === "i1").type, "one_piece");
});

test("normalizeInventory fixes case, clamps formality and drops bad flags and looks", () => {
  const items = normalizeInventory(
    [
      { id: "i1", name: "Tee", type: "TOP", formality: 9, visibility: "Partial", seen_in: ["p1_l1", "p7_l1", "junk"], possible_duplicate_of: null },
      { id: "i2", name: "Jeans", type: "bottom", formality: 0, visibility: "full", seen_in: ["P1_L2"], possible_duplicate_of: "i1" },
      { id: "i3", name: "Hat", type: "accessory", formality: 2, seen_in: [] },
      { id: "i4", name: "Tee 2", type: "top", formality: 2, seen_in: [], possible_duplicate_of: "i99" },
    ],
    1,
  );
  assert.equal(items.length, 3, "unknown types are dropped");
  assert.deepEqual(items[0], {
    id: "i1", name: "Tee", type: "top", color: "", pattern: "", description: "",
    formality: 5, visibility: "partial", seen_in: ["p1_l1"], possible_duplicate_of: null,
  });
  assert.equal(items[1].formality, 1);
  assert.deepEqual(items[1].seen_in, ["p1_l2"]);
  assert.equal(items[1].possible_duplicate_of, null, "a bottom can't duplicate a top");
  assert.equal(items[2].possible_duplicate_of, null, "unknown target is cleared");
});

test("normalizeInventory gives repeated ids a fresh id", () => {
  const items = normalizeInventory(
    [
      { id: "i1", name: "A", type: "top", seen_in: [] },
      { id: "i1", name: "B", type: "top", seen_in: [] },
    ],
    1,
  );
  assert.notEqual(items[0].id, items[1].id);
});

test("mergeDuplicates merges flagged items by default and combines their looks", () => {
  const clean = sanitizeClientItems(normalizeInventory(realInventory.items, 1));
  const merged = mergeDuplicates(clean.items);
  const ids = merged.map((i) => i.id);

  for (const dup of ["i7", "i18", "i19", "i21"]) assert.ok(!ids.includes(dup), `${dup} should be merged`);
  assert.equal(merged.length, 18);

  const jeans = merged.find((i) => i.id === "i5");
  assert.deepEqual(jeans.seen_in.sort(), ["p1_l2", "p1_l3", "p1_l9"]);
  assert.deepEqual(jeans.merged_ids.sort(), ["i19", "i7"]);
  assert.ok(!("keep_separate" in jeans) && !("possible_duplicate_of" in jeans));
});

test("mergeDuplicates respects Keep separate", () => {
  const merged = mergeDuplicates([
    item("i11", "top", { seen_in: ["p1_l6"] }),
    item("i21", "top", { seen_in: ["p1_l11"], possible_duplicate_of: "i11", keep_separate: true }),
  ]);
  assert.deepEqual(merged.map((i) => i.id), ["i11", "i21"]);
});

test("mergeDuplicates follows chains, ignores removed targets and survives loops", () => {
  const chain = mergeDuplicates([
    item("a", "bottom"),
    item("b", "bottom", { possible_duplicate_of: "a" }),
    item("c", "bottom", { possible_duplicate_of: "b" }),
  ]);
  assert.deepEqual(chain.map((i) => i.id), ["a"]);
  assert.deepEqual(chain[0].merged_ids, ["b", "c"]);

  const orphan = mergeDuplicates([item("b", "bottom", { possible_duplicate_of: "gone" })]);
  assert.deepEqual(orphan.map((i) => i.id), ["b"]);

  const loop = mergeDuplicates([
    item("x", "top", { possible_duplicate_of: "y" }),
    item("y", "top", { possible_duplicate_of: "x" }),
  ]);
  assert.deepEqual(loop.map((i) => i.id), ["x"], "a loop merges into the first-listed piece");

  const typeChanged = mergeDuplicates([item("a", "top"), item("b", "layer", { possible_duplicate_of: "a" })]);
  assert.equal(typeChanged.length, 2, "items only merge within the same type");
});

test("sanitizeClientItems rejects bad input", () => {
  assert.ok(sanitizeClientItems("nope").error);
  assert.ok(sanitizeClientItems([item("i1", "top"), item("i1", "top")]).error, "duplicate ids");
  assert.ok(sanitizeClientItems([item("i1", "shoe")]).error, "unknown type");
  assert.ok(sanitizeClientItems([{ ...item("i1", "top"), name: " " }]).error, "empty name");
  assert.ok(sanitizeClientItems([item("bad id!", "top")]).error, "unsafe id");
});

test("canMakeOutfit needs a one-piece or a top and a bottom", () => {
  assert.equal(canMakeOutfit([item("a", "top")]), false);
  assert.equal(canMakeOutfit([item("a", "top"), item("b", "bottom")]), true);
  assert.equal(canMakeOutfit([item("a", "one_piece")]), true);
});

const wardrobe = [
  item("t1", "top", { seen_in: ["p1_l1"] }),
  item("t2", "top", { seen_in: ["p1_l2"] }),
  item("b1", "bottom", { seen_in: ["p1_l1"] }),
  item("d1", "one_piece"),
  item("l1", "layer"),
];
const outfit = (items, name = "Look") => ({
  name, why: "w", styling_tip: "s",
  items: { top: null, bottom: null, one_piece: null, layer: null, ...items },
});

test("checkRecommendation accepts valid outfits and marks looks worn before", () => {
  const { outfits, errors } = checkRecommendation(
    {
      from_wardrobe: [
        outfit({ one_piece: "d1", layer: "l1" }),
        outfit({ top: "t2", bottom: "b1" }),
        outfit({ top: "t1", bottom: "b1" }),
      ],
      worth_looking_for: [],
    },
    wardrobe,
  );
  assert.deepEqual(errors, []);
  assert.equal(outfits.length, 3);
  assert.deepEqual(outfits.map((o) => o.worn_before), [false, false, true]);
});

test("checkRecommendation rejects broken outfits with clear reasons", () => {
  const { outfits, errors } = checkRecommendation(
    {
      from_wardrobe: [
        outfit({ one_piece: "d1", top: "t1" }, "Saree with jeans"),
        outfit({ top: "t1" }, "Missing bottom"),
        outfit({ top: "zz", bottom: "b1" }, "Made up"),
        outfit({ top: "b1", bottom: "t1" }, "Swapped"),
        outfit({ top: "t2", bottom: "b1" }, "Good"),
        outfit({ bottom: "b1", top: "t2" }, "Repeat"),
      ],
      worth_looking_for: [],
    },
    wardrobe,
  );
  assert.equal(outfits.length, 1);
  assert.equal(outfits[0].name, "Good");
  assert.equal(errors.length, 5);
  assert.match(errors[0], /combines a one_piece/);
  assert.match(errors[1], /needs either a one_piece/);
  assert.match(errors[2], /isn't in the inventory/);
  assert.match(errors[3], /in the top slot/);
  assert.match(errors[4], /repeats/);
});

test("checkRecommendation cleans ideas instead of failing on them", () => {
  const { ideas, errors } = checkRecommendation(
    {
      from_wardrobe: [],
      worth_looking_for: [
        { piece: "Linen trousers", description: "d", search_query: "", pair_with: ["t1", "nope", "t1"], closest_owned: "nope", why: "w" },
        { piece: "Skirt", description: "d", search_query: "skirt", pair_with: [], closest_owned: "b1", why: "w" },
        { piece: "Extra", description: "d", search_query: "x", pair_with: [], closest_owned: null, why: "w" },
      ],
    },
    wardrobe,
  );
  assert.deepEqual(errors, []);
  assert.equal(ideas.length, 2);
  assert.deepEqual(ideas[0].pair_with, ["t1"]);
  assert.equal(ideas[0].closest_owned, null);
  assert.equal(ideas[0].search_query, "Linen trousers");
});

test("replaceIdsWithNames swaps stray ids for names", () => {
  const items = [item("i1", "top"), item("i10", "bottom")];
  items[0].name = "Lilac crop top";
  items[1].name = "Denim shorts";
  assert.equal(
    replaceIdsWithNames("Pair i1 with i10, not i2.", items),
    "Pair Lilac crop top with Denim shorts, not i2.",
  );
});
