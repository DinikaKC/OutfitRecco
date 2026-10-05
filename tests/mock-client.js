// tests/mock-client.js
// A fake Anthropic client for the tests and for `npm run dev -- --mock`.
// It answers with the saved example answers in tests/fixtures, shaped like a real API response,
// so you can click through the app without an API key. The fixtures are ONLY used here:
// the real app always gets its pieces and outfits from Claude.
//
//   delayMs:   pretend the AI takes this long (so loading screens show)
//   responses: a list of answers to return in order (tests use this to simulate bad answers)
import { readFileSync } from "node:fs";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8");

export function createMockClient({ delayMs = 1200, responses } = {}) {
  const calls = [];
  const queue = responses ? [...responses] : null;

  return {
    isFake: true, // lets /api/verify tell the app it's in demo mode
    calls,
    messages: {
      async create(params) {
        calls.push(params);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        let body;
        if (queue) {
          body = queue.shift();
          if (body instanceof Error) throw body;
        } else {
          const isInventory = "items" in params.output_config.format.schema.properties;
          body = fixture(isInventory ? "inventory-response" : "recommend-response");
        }
        return {
          stop_reason: "end_turn",
          content: [
            { type: "thinking", thinking: "…", signature: "mock" },
            { type: "text", text: typeof body === "string" ? body : JSON.stringify(body) },
          ],
        };
      },
    },
  };
}
