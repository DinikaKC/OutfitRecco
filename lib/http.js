// lib/http.js
// Small helpers shared by every API route: reading the request body,
// sending errors, and checking the passcode.

import { createHash, timingSafeEqual } from "node:crypto";

// Sends { error: "..." } with the given HTTP status. The app shows this message to the user.
export function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

// Accepts only POST requests with a JSON object as the body.
// Returns the parsed body, or null after it has already sent an error response.
export function readJsonPost(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendError(res, 405, "Use POST.");
    return null;
  }
  let body;
  try {
    body = req.body; // Vercel parses JSON bodies itself; reading req.body throws on malformed JSON.
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

// Hashing both values gives equal-length buffers, which timingSafeEqual needs.
const digest = (value) => createHash("sha256").update(String(value)).digest();

// Every API route calls this first. The browser sends the passcode in the
// "x-app-passcode" header; it must match APP_PASSCODE from .env / Vercel settings.
// Fails closed: if APP_PASSCODE isn't set, nobody gets in.
// timingSafeEqual stops attackers from guessing the passcode by measuring response times.
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
