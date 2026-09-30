import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-sonnet-5-5";

// Prompts live in /prompts so they can be edited and tested on their own.
export function loadPrompt(name) {
  return readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), "utf8");
}

export class ModelError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

let client = null;

// Tests and the local mock server swap in a fake client.
export function setClient(fake) {
  client = fake;
}

function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new ModelError("ANTHROPIC_API_KEY isn't set on the server.", 500);
    }
    // Two model calls must fit inside Vercel's 300-second function limit.
    client = new Anthropic({ timeout: 120_000, maxRetries: 1 });
  }
  return client;
}

// Calls Claude with a JSON schema and returns the parsed object.
export async function askForJson({ system, content, schema, maxTokens = 16_000 }) {
  let response;
  try {
    response = await getClient().messages.create({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content }],
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema },
      },
    });
  } catch (err) {
    throw toModelError(err);
  }

  if (response.stop_reason === "refusal") {
    throw new ModelError("The AI declined to process these photos.", 422);
  }
  if (response.stop_reason === "max_tokens") {
    throw new ModelError("The AI's answer was cut off. Try fewer photos.");
  }
  const text = response.content.find((block) => block.type === "text")?.text;
  if (!text) throw new ModelError("The AI returned an empty answer.");
  try {
    return JSON.parse(text);
  } catch {
    throw new ModelError("The AI returned malformed JSON.");
  }
}

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
