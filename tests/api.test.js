import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setClient } from "../lib/claude.js";
import { createMockClient } from "./mock-client.js";
import inventoryHandler from "../api/inventory.js";
import recommendHandler from "../api/recommend.js";
import verifyHandler from "../api/verify.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const PASS = "open-sesame";
const QUIZ = { occasion: "casual outing", mood: "playful", weather: "hot and humid", time: "afternoon", priority: "comfort" };
const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function call(handler, { body, passcode = PASS, method = "POST" } = {}) {
  const req = { method, headers: passcode ? { "x-app-passcode": passcode } : {}, body };
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, body: data }); return this; },
      end() { resolve({ status: this.statusCode, body: null }); return this; },
    };
    Promise.resolve(handler(req, res));
  });
}

beforeEach(() => {
  process.env.APP_PASSCODE = PASS;
});

test("every route refuses a wrong or missing passcode", async () => {
  setClient(createMockClient({ delayMs: 0 }));
  for (const handler of [verifyHandler, inventoryHandler, recommendHandler]) {
    assert.equal((await call(handler, { body: {}, passcode: "wrong" })).status, 401);
    assert.equal((await call(handler, { body: {}, passcode: null })).status, 401);
  }
  assert.equal((await call(verifyHandler, { body: {} })).status, 204);
});

test("routes fail closed when APP_PASSCODE isn't set", async () => {
  delete process.env.APP_PASSCODE;
  const res = await call(verifyHandler, { body: {} });
  assert.equal(res.status, 500);
  assert.match(res.body.error, /APP_PASSCODE/);
});

test("routes only accept POST", async () => {
  assert.equal((await call(verifyHandler, { method: "GET" })).status, 405);
});

test("inventory validates photos", async () => {
  setClient(createMockClient({ delayMs: 0 }));
  assert.equal((await call(inventoryHandler, { body: { images: [] } })).status, 400);
  assert.equal((await call(inventoryHandler, { body: { images: [{ media_type: "image/bmp", data: PIXEL }] } })).status, 400);
  assert.equal((await call(inventoryHandler, { body: { images: [{ media_type: "image/png", data: "not base64!" }] } })).status, 400);
  const eleven = Array.from({ length: 11 }, () => ({ media_type: "image/png", data: PIXEL }));
  assert.equal((await call(inventoryHandler, { body: { images: eleven } })).status, 400);
});

test("inventory sends labelled photos with the schema and returns clean items", async () => {
  const mock = createMockClient({ delayMs: 0 });
  setClient(mock);
  const res = await call(inventoryHandler, {
    body: { images: [{ media_type: "image/png", data: PIXEL }, { media_type: "image/jpeg", data: PIXEL }] },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.items.length, 22);

  const params = mock.calls[0];
  assert.equal(params.output_config.format.type, "json_schema");
  assert.equal(params.messages[0].content.filter((b) => b.type === "image").length, 2);
  assert.equal(params.messages[0].content[0].text, "Photo 1");
  assert.match(params.system, /catalog clothing/i);
});

test("recommend merges duplicates before asking the model and returns checked outfits", async () => {
  const mock = createMockClient({ delayMs: 0 });
  setClient(mock);
  const items = fixture("inventory-response").items;
  const res = await call(recommendHandler, { body: { quiz: QUIZ, items } });

  assert.equal(res.status, 200);
  assert.equal(res.body.outfits.length, 3);
  assert.equal(res.body.ideas.length, 2);
  assert.equal(mock.calls.length, 1, "valid answer needs no retry");

  const sent = mock.calls[0].messages[0].content;
  assert.match(sent, /<quiz>\noccasion: casual outing/);
  assert.ok(!sent.includes('"i7"') && !sent.includes('"i19"'), "duplicate jeans are merged away");
  assert.equal(res.body.items.length, 18);

  const lilac = res.body.outfits.find((o) => o.items.top === "i13");
  assert.equal(lilac.worn_before, true, "lilac top + denim shorts were worn together in look 7");
});

test("recommend retries once with the problems listed, then uses the fixed answer", async () => {
  const bad = {
    from_wardrobe: [{ name: "Saree and jeans", items: { top: null, bottom: "i5", one_piece: "i1", layer: null }, why: "w", styling_tip: "s" }],
    worth_looking_for: [],
  };
  const good = fixture("recommend-response");
  const mock = createMockClient({ delayMs: 0, responses: [bad, good] });
  setClient(mock);

  const res = await call(recommendHandler, { body: { quiz: QUIZ, items: fixture("inventory-response").items } });
  assert.equal(res.status, 200);
  assert.equal(mock.calls.length, 2);
  assert.match(mock.calls[1].messages[0].content, /<problems>\n- Outfit 1 \("Saree and jeans"\) combines a one_piece/);
  assert.equal(res.body.outfits.length, 3);
});

test("recommend returns 502 when both attempts are unusable", async () => {
  const bad = { from_wardrobe: [{ name: "x", items: { top: "nope", bottom: null, one_piece: null, layer: null }, why: "", styling_tip: "" }], worth_looking_for: [] };
  setClient(createMockClient({ delayMs: 0, responses: [bad, bad] }));
  const res = await call(recommendHandler, { body: { quiz: QUIZ, items: fixture("inventory-response").items } });
  assert.equal(res.status, 502);
});

test("recommend replaces ids that slip into the text", async () => {
  const answer = fixture("recommend-response");
  answer.from_wardrobe[1].why = "i11 balances i22.";
  setClient(createMockClient({ delayMs: 0, responses: [answer] }));
  const res = await call(recommendHandler, { body: { quiz: QUIZ, items: fixture("inventory-response").items } });
  assert.equal(res.body.outfits[1].why, "Olive sleeveless knit polo top balances Cream cargo pants.");
});

test("recommend validates the quiz and the wardrobe", async () => {
  setClient(createMockClient({ delayMs: 0 }));
  const items = fixture("inventory-response").items;
  assert.equal((await call(recommendHandler, { body: { quiz: { ...QUIZ, mood: "sneaky" }, items } })).status, 400);
  const topsOnly = items.filter((i) => i.type === "top");
  assert.equal((await call(recommendHandler, { body: { quiz: QUIZ, items: topsOnly } })).status, 422);
});

test("model errors come back as friendly messages", async () => {
  const overloaded = Object.assign(new Error("overloaded"), { status: 529 });
  setClient(createMockClient({ delayMs: 0, responses: [overloaded] }));
  const res = await call(inventoryHandler, { body: { images: [{ media_type: "image/png", data: PIXEL }] } });
  assert.equal(res.status, 503);
  assert.match(res.body.error, /overloaded/);
});
