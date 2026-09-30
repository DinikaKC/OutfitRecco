import { checkPasscode, readJsonPost } from "../lib/http.js";

// POST {} with the x-app-passcode header → 204 if the passcode is right.
// Lets the app check the passcode before anyone uploads photos.
export default function handler(req, res) {
  const body = readJsonPost(req, res);
  if (!body || !checkPasscode(req, res)) return;
  res.status(204).end();
}
