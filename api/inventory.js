// api/inventory.js  →  POST /api/inventory
// Step 1 of the app: turns wardrobe pictures into a list of pieces.
//
// Request:  { images: [{ media_type: "image/jpeg", data: "<base64>", width, height }, ...] }
//           (1 to MAX_PICTURES pictures; PDFs and Word files were already turned into pictures by the browser)
// Response: { items: [{ id, name, type, color, pattern, description, formality,
//                       visibility, seen_in, possible_duplicate_of }, ...],
//             looks: [{ id: "p1_l3", box: { left, top, right, bottom } }, ...] }
//   looks[].box is the area of the picture showing that look, as fractions (0 to 1),
//   which the browser uses to cut out a picture of each piece.
//
// On Vercel, every file in /api becomes an endpoint, and its default export handles the request.

import { MAX_PICTURES } from "../public/config.js";
import { askForJson, loadPrompt, ModelError } from "../lib/claude.js";
import { checkPasscode, readJsonPost, sendError } from "../lib/http.js";
import { inventorySchema } from "../lib/schemas.js";
import { normalizeInventory, normalizeLooks } from "../lib/wardrobe.js";

const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]; // what Claude accepts
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_SIDE = 8000; // Claude's largest accepted image side, in pixels

// This call can be big: 30 pictures may hold 60+ pieces. So it gets a higher output
// ceiling than the default (still under the ~21,000 the SDK allows without streaming)
// and most of Vercel's 300-second limit.
const MAX_TOKENS = 20_000;
const TIMEOUT_MS = 280_000;

export default async function handler(req, res) {
  // 1. Only POST, only with the right passcode.
  const body = readJsonPost(req, res);
  if (!body || !checkPasscode(req, res)) return;

  // 2. Validate the pictures before spending money on an AI call.
  const images = body.images;
  if (!Array.isArray(images) || images.length === 0) {
    return sendError(res, 400, "Add at least one photo.");
  }
  if (images.length > MAX_PICTURES) {
    return sendError(res, 400, `Add at most ${MAX_PICTURES} pictures.`);
  }
  for (const image of images) {
    if (!MEDIA_TYPES.includes(image?.media_type) || typeof image.data !== "string" || !BASE64_RE.test(image.data)) {
      return sendError(res, 400, "Photos must be JPEG, PNG, WebP or GIF.");
    }
    if (![image.width, image.height].every((n) => Number.isInteger(n) && n > 0 && n <= MAX_SIDE)) {
      return sendError(res, 400, "Each photo needs its width and height in pixels.");
    }
  }

  // 3. Build the message: each picture is preceded by a label with its number and size,
  //    e.g. "Photo 2 (1080 × 1920 pixels)". The number lets the AI refer to looks as "p2_l3"
  //    (photo 2, look 3); the size helps it give look boxes in pixels.
  //    The instructions are in prompts/inventory.md.
  const content = images.flatMap((image, index) => [
    { type: "text", text: `Photo ${index + 1} (${image.width} × ${image.height} pixels)` },
    { type: "image", source: { type: "base64", media_type: image.media_type, data: image.data } },
  ]);
  content.push({
    type: "text",
    text: `Catalog every garment in ${images.length === 1 ? "this photo" : `these ${images.length} photos`}, and give a box for every look.`,
  });

  // 4. Ask Claude, clean up its answer, and send the pieces and look boxes back to the browser.
  try {
    const result = await askForJson({
      system: loadPrompt("inventory"),
      content,
      schema: inventorySchema,
      maxTokens: MAX_TOKENS,
      timeoutMs: TIMEOUT_MS,
    });
    const items = normalizeInventory(result.items, images.length);
    if (items.length === 0) {
      return sendError(res, 422, "No clothes were found in these photos. Try clearer, well-lit photos.");
    }
    const looks = normalizeLooks(result.looks, images.map(({ width, height }) => ({ width, height })));
    return res.status(200).json({ items, looks });
  } catch (err) {
    if (err instanceof ModelError) return sendError(res, err.status, err.message);
    console.error(err);
    return sendError(res, 500, "Something went wrong while reading your photos.");
  }
}
