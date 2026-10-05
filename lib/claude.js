// lib/claude.js
// The only file that talks to the Claude API. Both API routes call askForJson(),
// which sends a prompt, forces the answer into a JSON schema, and returns the parsed object.

import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Settings: everything you might want to tune lives here.
// ---------------------------------------------------------------------------

// Which Claude model to use. Override it with ANTHROPIC_MODEL in .env (or in Vercel's settings).
const DEFAULT_MODEL = "claude-sonnet-5-5";

// How hard the model thinks before answering: "low", "medium", "high", "xhigh" or "max".
// Higher is slower and costs more. "medium" is a good balance for this app.
const EFFORT = "medium";

// max_tokens is required by the API: it's the most the model may write in one answer,
// counting its internal thinking plus the JSON. It's a ceiling, not a target. You only
// pay for the tokens actually used. A typical answer here needs a few thousand tokens.
// If an answer hits the ceiling it's cut off, and askForJson() reports an error.
// Keep it under ~21,000: above that the SDK refuses to run without streaming.
const MAX_TOKENS = 16_000;

// How long one API call may take before giving up, and how many times to retry
// on a network error or overload. Two calls must fit inside Vercel's 300-second limit.
const TIMEOUT_MS = 120_000;
const MAX_RETRIES = 1;

// ---------------------------------------------------------------------------

// Reads a system prompt from the /prompts folder, e.g. loadPrompt("inventory").
// Keeping prompts in Markdown files means you can edit them without touching code.
export function loadPrompt(name) {
  return readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), "utf8");
}

// An error with an HTTP status and a message that's safe to show in the app.
export class ModelError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

let client = null;

// Tests and `npm run dev -- --mock` swap in a fake client, so no real API calls are made.
export function setClient(fake) {
  client = fake;
}

// True when the fake client is in use. /api/verify reports this so the app can show
// a "Demo mode" banner: the answers then come from tests/fixtures, not from your photos.
export function isUsingFakeClient() {
  return client?.isFake === true;
}

// Creates the real Anthropic client the first time it's needed.
// The SDK reads ANTHROPIC_API_KEY from the environment by itself.
function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new ModelError("ANTHROPIC_API_KEY isn't set on the server.", 500);
    }
    client = new Anthropic({ timeout: TIMEOUT_MS, maxRetries: MAX_RETRIES });
  }
  return client;
}

// Sends one request and returns the parsed JSON answer.
//   system:    the system prompt (from /prompts)
//   content:   the user message (text, or a list of text and image blocks)
//   schema:    the JSON schema the answer must follow (from lib/schemas.js)
//   maxTokens: optional, overrides MAX_TOKENS for this call
//   timeoutMs: optional, overrides TIMEOUT_MS for this call
export async function askForJson({ system, content, schema, maxTokens = MAX_TOKENS, timeoutMs = TIMEOUT_MS }) {
  let response;
  try {
    response = await getClient().messages.create(
      {
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content }],
        output_config: {
          effort: EFFORT,
          // Structured outputs: the API guarantees the answer is JSON matching this schema.
          format: { type: "json_schema", schema },
        },
      },
      { timeout: timeoutMs },
    );
  } catch (err) {
    throw toModelError(err);
  }

  // stop_reason says why the model stopped writing.
  if (response.stop_reason === "refusal") {
    throw new ModelError("The AI declined to process these photos.", 422);
  }
  if (response.stop_reason === "max_tokens") {
    throw new ModelError("The AI's answer was cut off. Try fewer photos.");
  }

  // The response holds a "thinking" block first, then a "text" block with the JSON.
  const text = response.content.find((block) => block.type === "text")?.text;
  if (!text) throw new ModelError("The AI returned an empty answer.");
  try {
    return JSON.parse(text);
  } catch {
    throw new ModelError("The AI returned malformed JSON.");
  }
}

// Turns SDK errors into short messages the app can show, with a sensible HTTP status.
function toModelError(err) {
  if (err instanceof ModelError) return err;
  const status = err?.status;
  if (status === 401 || status === 403) {
    return new ModelError("The server's Anthropic API key was rejected.", 500);
  }
  if (status === 429) return new ModelError("Too many requests right now. Try again in a minute.", 429);
  if (status === 529 || status === 503) {
    return new ModelError("The AI is overloaded right now. Try again shortly.", 503);
  }
  if (status === 400) return new ModelError(`The AI couldn't process this request: ${err.message}`, 400);
  console.error("Anthropic call failed:", err);
  return new ModelError("Couldn't reach the AI. Try again.");
}
