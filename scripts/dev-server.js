// scripts/dev-server.js
// A small local server so you can run the app without Vercel. It does what Vercel does:
//   - serves the files in /public (the website)
//   - sends /api/<name> requests to the matching file in /api
//
//   npm run dev             → real AI calls, using ANTHROPIC_API_KEY and APP_PASSCODE from .env
//   npm run dev -- --mock   → canned AI answers from tests/fixtures: free, no API key needed

import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)); // the project folder
const publicDir = join(root, "public");
const port = Number(process.env.PORT) || 3000;
const mock = process.argv.includes("--mock");

// Friendly checks for the two most common setup problems.
if (!existsSync(join(root, "node_modules", "@anthropic-ai", "sdk"))) {
  console.error("Dependencies aren't installed. Run `npm install` in the project folder, then try again.");
  process.exit(1);
}
if (typeof process.loadEnvFile !== "function") {
  console.error(`Node.js ${process.versions.node} is too old. Install Node.js 20.12 or newer.`);
  process.exit(1);
}

// Load ANTHROPIC_API_KEY and APP_PASSCODE from .env into process.env (Vercel does this from its settings).
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));

if (mock) {
  // Replace the real Claude client with a fake one that returns the test fixtures.
  const { setClient } = await import("../lib/claude.js");
  const { createMockClient } = await import("../tests/mock-client.js");
  setClient(createMockClient());
  process.env.APP_PASSCODE ||= "test";
  console.log('Mock mode: canned AI answers. Passcode is "%s".', process.env.APP_PASSCODE);
} else if (!process.env.ANTHROPIC_API_KEY || !process.env.APP_PASSCODE) {
  console.warn("Warning: set ANTHROPIC_API_KEY and APP_PASSCODE in .env, or use `npm run dev -- --mock`.");
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

const MAX_BODY = 4.5 * 1024 * 1024; // same request size limit as Vercel

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // --- API requests: /api/inventory → api/inventory.js, and so on ---
  if (url.pathname.startsWith("/api/")) {
    const name = url.pathname.slice(5).replace(/[^a-z-]/g, "");
    const file = join(root, "api", `${name}.js`);
    if (!existsSync(file)) return send(res, 404, "Not found");

    // Read the whole request body, refusing anything over the size limit.
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) return send(res, 413, "Request Entity Too Large");
      chunks.push(chunk);
    }

    // Give req and res the same helpers Vercel provides: req.body, res.status(), res.json().
    const raw = Buffer.concat(chunks).toString("utf8");
    let parsed;
    let parseError = false;
    try {
      parsed = raw ? JSON.parse(raw) : undefined;
    } catch {
      parseError = true;
    }
    Object.defineProperty(req, "body", {
      get() {
        if (parseError) throw new Error("Invalid JSON"); // Vercel also throws on malformed JSON
        return parsed;
      },
    });
    res.status = (code) => ((res.statusCode = code), res);
    res.json = (data) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
      return res;
    };

    // Run the route's handler.
    const { default: handler } = await import(pathToFileURL(file).href);
    try {
      await handler(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) send(res, 500, "Server error");
    }
    return;
  }

  // --- Everything else: a file from /public ("/" means index.html) ---
  const path = normalize(join(publicDir, url.pathname === "/" ? "index.html" : url.pathname));
  if (!path.startsWith(publicDir) || !existsSync(path) || !statSync(path).isFile()) {
    return send(res, 404, "Not found");
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" });
  res.end(readFileSync(path));
}).listen(port, () => console.log(`OutfitRecco running at http://localhost:${port}`));

function send(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain" });
  res.end(text);
}
