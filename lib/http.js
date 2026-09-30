import { createHash, timingSafeEqual } from "node:crypto";

export function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

// Accept only POST with a JSON body. Returns the parsed body, or null after sending an error.
export function readJsonPost(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendError(res, 405, "Use POST.");
    return null;
  }
  let body;
  try {
    body = req.body; // Vercel parses JSON bodies; reading it throws on malformed JSON.
  } catch {
    sendError(res, 400, "The request body isn't valid JSON.");
    return null;
  }
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      sendError(res, 400, "The request body isn't valid JSON.");
      return null;
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    sendError(res, 400, "Send a JSON object.");
    return null;
  }
  return body;
}

const digest = (value) => createHash("sha256").update(String(value)).digest();

// Every API route calls this first. Fails closed: no APP_PASSCODE configured means no access.
export function checkPasscode(req, res) {
  const expected = process.env.APP_PASSCODE;
  if (!expected) {
    sendError(res, 500, "APP_PASSCODE isn't set on the server.");
    return false;
  }
  const given = req.headers["x-app-passcode"];
  if (typeof given !== "string" || !timingSafeEqual(digest(given), digest(expected))) {
    sendError(res, 401, "Wrong passcode.");
    return false;
  }
  return true;
}
