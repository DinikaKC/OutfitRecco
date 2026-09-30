// Local server that mimics Vercel: serves /public and runs /api/*.js handlers.
//   npm run dev          → uses your .env (real API calls)
//   npm run dev -- --mock → canned AI answers, no API key or credits needed
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const publicDir = join(root, "public");
const port = Number(process.env.PORT) || 3000;
const mock = process.argv.includes("--mock");

if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));

if (mock) {
  const { setClient } = await import("../lib/claude.js");
  const { createMockClient } = await import("../tests/mock-client.js");
  setClient(createMockClient());
  process.env.APP_PASSCODE ||= "test";
  console.log('Mock mode: canned AI answers. Passcode is "%s".', process.env.APP_PASSCODE);
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

const MAX_BODY = 4.5 * 1024 * 1024; // Vercel's request body limit

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    const name = url.pathname.slice(5).replace(/[^a-z-]/g, "");
    const file = join(root, "api", `${name}.js`);
    if (!existsSync(file)) return send(res, 404, "Not found");

    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) return send(res, 413, "Request Entity Too Large");
      chunks.push(chunk);
    }
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
        if (parseError) throw new Error("Invalid JSON");
        return parsed;
      },
    });
    res.status = (code) => ((res.statusCode = code), res);
    res.json = (data) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
      return res;
    };

    const { default: handler } = await import(pathToFileURL(file).href);
    try {
      await handler(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) send(res, 500, "Server error");
    }
    return;
  }

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
