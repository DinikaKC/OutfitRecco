// api/inventory.js  →  POST /api/inventory
// Step 1 of the app: turns wardrobe photos into a list of pieces.
//
// Request:  { images: [{ media_type: "image/jpeg", data: "<base64>" }, ...] }  (1 to 15 photos)
// Response: { items: [{ id, name, type, color, pattern, description, formality,
//                       visibility, seen_in, possible_duplicate_of }, ...] }
//
// On Vercel, every file in /api becomes an endpoint, and its default export handles the request.

import { askForJson, loadPrompt, ModelError } from "../lib/claude.js";
import { checkPasscode, readJsonPost, sendError } from "../lib/http.js";
import { inventorySchema } from "../lib/schemas.js";
import { normalizeInventory } from "../lib/wardrobe.js";

const MAX_PHOTOS = 15;
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]; // what Claude accepts
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export default async function handler(req, res) {
  // 1. Only POST, only with the right passcode.
  const body = readJsonPost(req, res);
  if (!body || !checkPasscode(req, res)) return;

  // 2. Validate the photos before spending money on an AI call.
  const images = body.images;
  if (!Array.isArray(images) || images.length === 0) {
    return sendError(res, 400, "Add at least one photo.");
  }
  if (images.length > MAX_PHOTOS) {
    return sendError(res, 400, `Add at most ${MAX_PHOTOS} photos.`);
  }
  for (const image of images) {
    if (!MEDIA_TYPES.includes(image?.media_type) || typeof image.data !== "string" || !BASE64_RE.test(image.data)) {
      return sendError(res, 400, "Photos must be JPEG, PNG, WebP or GIF.");
    }
  }

  // 3. Build the message: each photo is preceded by a "Photo N" label, so the AI can
  //    refer to looks as "p1_l3" (photo 1, look 3). The instructions are in prompts/inventory.md.
  const content = images.flatMap((image, index) => [
    { type: "text", text: `Photo ${index + 1}` },
    { type: "image", source: { type: "base64", media_type: image.media_type, data: image.data } },
  ]);
  content.push({
    type: "text",
    text: `Catalog every garment in ${images.length === 1 ? "this photo" : `these ${images.length} photos`}.`,
  });

  // 4. Ask Claude, clean up its answer, and send the pieces back to the browser.
  try {
    const result = await askForJson({ system: loadPrompt("inventory"), content, schema: inventorySchema });
    const items = normalizeInventory(result.items, images.length);
    if (items.length === 0) {
      return sendError(res, 422, "No clothes were found in these photos. Try clearer, well-lit photos.");
    }
    return res.status(200).json({ items });
  } catch (err) {
    if (err instanceof ModelError) return sendError(res, err.status, err.message);
    console.error(err);
    return sendError(res, 500, "Something went wrong while reading your photos.");
  }
}
