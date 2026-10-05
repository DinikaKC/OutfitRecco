// api/verify.js  →  POST /api/verify
// Checks the passcode: 401 if it's wrong, otherwise 200 with { mock: true | false }.
// The app calls this on the passcode screen (so a wrong passcode is caught before anyone
// uploads photos) and on start-up. "mock" is true only when running `npm run dev -- --mock`;
// the app then shows a "Demo mode" banner, because the answers don't come from your photos.

import { isUsingFakeClient } from "../lib/claude.js";
import { checkPasscode, readJsonPost } from "../lib/http.js";

export default function handler(req, res) {
  const body = readJsonPost(req, res);
  if (!body || !checkPasscode(req, res)) return;
  res.status(200).json({ mock: isUsingFakeClient() });
}
