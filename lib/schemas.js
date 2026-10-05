// lib/schemas.js
// The exact JSON shape each AI call must return. They're passed to the API as
// output_config.format (structured outputs), so the answer always parses and has
// every field. What they can't enforce (number ranges, list lengths, whether an id
// is real) is checked in lib/wardrobe.js.

// A field that holds an item id or null, e.g. an outfit's empty "layer" slot.
const nullableId = { type: ["string", "null"] };

// The four kinds of piece. Footwear and accessories are deliberately left out for now.
export const ITEM_TYPES = ["top", "bottom", "one_piece", "layer"];

// Answer to the inventory call:
//   items: one entry per garment
//   looks: one entry per look (outfit photo or person in a collage), with a box around it
//          in pixels. The app uses the boxes to cut each look out of the picture and show it.
export const inventorySchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string", enum: ITEM_TYPES },
          color: { type: "string" },
          pattern: { type: "string" },
          description: { type: "string" },
          formality: { type: "integer" },
          visibility: { type: "string", enum: ["full", "partial"] },
          seen_in: { type: "array", items: { type: "string" } },
          possible_duplicate_of: nullableId,
        },
        required: [
          "id", "name", "type", "color", "pattern", "description",
          "formality", "visibility", "seen_in", "possible_duplicate_of",
        ],
        additionalProperties: false,
      },
    },
    looks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" }, // e.g. "p1_l3"
          box: {
            type: "object",
            // (x1, y1) = top-left corner, (x2, y2) = bottom-right corner, in pixels
            properties: {
              x1: { type: "integer" },
              y1: { type: "integer" },
              x2: { type: "integer" },
              y2: { type: "integer" },
            },
            required: ["x1", "y1", "x2", "y2"],
            additionalProperties: false,
          },
        },
        required: ["id", "box"],
        additionalProperties: false,
      },
    },
  },
  required: ["items", "looks"],
  additionalProperties: false,
};

// Answer to the recommend call:
//   from_wardrobe:     outfits from owned pieces; each slot holds an item id or null
//   worth_looking_for: pieces the user may not own, with owned items they'd go with
export const recommendSchema = {
  type: "object",
  properties: {
    from_wardrobe: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          items: {
            type: "object",
            properties: {
              top: nullableId,
              bottom: nullableId,
              one_piece: nullableId,
              layer: nullableId,
            },
            required: ["top", "bottom", "one_piece", "layer"],
            additionalProperties: false,
          },
          why: { type: "string" },
          styling_tip: { type: "string" },
        },
        required: ["name", "items", "why", "styling_tip"],
        additionalProperties: false,
      },
    },
    worth_looking_for: {
      type: "array",
      items: {
        type: "object",
        properties: {
          piece: { type: "string" },
          description: { type: "string" },
          search_query: { type: "string" },
          pair_with: { type: "array", items: { type: "string" } },
          closest_owned: nullableId,
          why: { type: "string" },
        },
        required: ["piece", "description", "search_query", "pair_with", "closest_owned", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["from_wardrobe", "worth_looking_for"],
  additionalProperties: false,
};
