// api/verify.js  →  POST /api/verify
// Checks the passcode and nothing else: 204 if it's right, 401 if it's wrong.
// The passcode screen calls this, so a wrong passcode is caught before anyone uploads photos.

import { checkPasscode, readJsonPost } from "../lib/http.js";

export default function handler(req, res) {
  const body = readJsonPost(req, res);
  if (!body || !checkPasscode(req, res)) return;
  res.status(204).end();
}
