// JSON schemas for structured outputs (output_config.format).
// Structured outputs don't support min/max constraints, so ranges and counts are enforced in code.

const nullableId = { type: ["string", "null"] };

export const ITEM_TYPES = ["top", "bottom", "one_piece", "layer"];

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
  },
  required: ["items"],
  additionalProperties: false,
};

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
