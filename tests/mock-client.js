// A fake Anthropic client for tests and `npm run dev -- --mock`.
// It answers with the fixtures in tests/fixtures, shaped like a real Messages API response.
import { readFileSync } from "node:fs";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8");

export function createMockClient({ delayMs = 1200, responses } = {}) {
  const calls = [];
  const queue = responses ? [...responses] : null;

  return {
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
