import http from "node:http";
import https from "node:https";
import {
  readFile,
  writeFile,
  mkdir,
  rename,
  stat,
  readdir,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const random = (n) => randomBytes(n).toString("base64url");
export async function createRelay({
  dataDir,
  webDir = resolve("build/portable"),
  host = "127.0.0.1",
  port = 8787,
  tls,
  publicOrigin,
} = {}) {
  const directory = resolve(dataDir ?? ".folio-relay");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const locks = new Map(),
    rates = new Map();
  const respond = (res, status, value) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  const body = async (req) => {
    let size = 0;
    const parts = [];
    for await (const part of req) {
      size += part.length;
      if (size > 8 * 1024 * 1024) {
        const e = new Error("Body too large");
        e.status = 413;
        throw e;
      }
      parts.push(part);
    }
    try {
      return JSON.parse(Buffer.concat(parts).toString("utf8"));
    } catch {
      const error = new Error("Invalid JSON");
      error.status = 400;
      throw error;
    }
  };
  const cors = (origin) =>
    !origin ||
    origin === publicOrigin ||
    origin === "https://appassets.androidplatform.net" ||
    /^chrome-extension:\/\/[a-p]{32}$/.test(origin) ||
    /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin) ||
    origin ===
      (tls ? "https" : "http") + "://" + host + (port ? ":" + port : "");
  const rate = (req, kind, limit) => {
    const key = req.socket.remoteAddress + ":" + kind;
    const now = Date.now();
    if (rates.size > 10000) rates.clear();
    const v = rates.get(key) ?? { start: now, count: 0 };
    if (now - v.start > 60000) {
      v.start = now;
      v.count = 0;
    }
    v.count++;
    rates.set(key, v);
    return v.count <= limit;
  };
  const handle = async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    const origin = req.headers.origin;
    if (!cors(origin))
      return respond(res, 403, { error: "Origin not allowed" });
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, If-Match",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/health") return respond(res, 200, { ok: true });
    if (path === "/v1/vaults" && req.method === "POST") {
      if (!rate(req, "create", 20))
        return respond(res, 429, { error: "Slow down" });
      if (
        (await readdir(directory)).filter((f) => f.endsWith(".json")).length >=
        10000
      )
        return respond(res, 507, { error: "Relay capacity reached" });
      const vault = randomBytes(16).toString("hex"),
        token = random(32);
      await writeFile(
        join(directory, vault + ".json"),
        JSON.stringify({ tokenHash: digest(token), revision: 0, packet: null }),
        { mode: 0o600, flag: "wx" },
      );
      return respond(res, 201, { vault, token });
    }
    const match = /^\/v1\/vaults\/([a-f0-9]{32})$/.exec(path);
    if (match) {
      if (!rate(req, "request", 300))
        return respond(res, 429, { error: "Slow down" });
      const id = match[1],
        file = join(directory, id + ".json");
      const previous = locks.get(id) ?? Promise.resolve();
      let unlock;
      const pending = new Promise((r) => {
        unlock = r;
      });
      locks.set(id, pending);
      await previous;
      try {
        let state;
        try {
          state = JSON.parse(await readFile(file, "utf8"));
        } catch (e) {
          if (e.code === "ENOENT")
            return respond(res, 404, { error: "Library not found" });
          throw e;
        }
        const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
        if (
          !timingSafeEqual(
            Buffer.from(state.tokenHash, "hex"),
            Buffer.from(digest(token), "hex"),
          )
        )
          return respond(res, 401, { error: "Invalid device credential" });
        if (req.method === "GET")
          return respond(res, 200, {
            revision: state.revision,
            packet: state.packet,
          });
        if (req.method === "PUT") {
          if (req.headers["if-match"] !== String(state.revision))
            return respond(res, 409, { error: "Revision changed" });
          const packet = await body(req);
          if (
            packet?.version !== 1 ||
            typeof packet.iv !== "string" ||
            !/^[-\w]{16}$/.test(packet.iv) ||
            typeof packet.data !== "string" ||
            packet.data.length < 22 ||
            !/^[-\w]+$/.test(packet.data)
          )
            return respond(res, 400, { error: "Invalid encrypted packet" });
          const next = { ...state, revision: state.revision + 1, packet };
          const temporary = file + "." + random(6) + ".tmp";
          await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
          await rename(temporary, file);
          return respond(res, 200, { revision: next.revision });
        }
        return respond(res, 405, { error: "Method not allowed" });
      } finally {
        unlock();
        if (locks.get(id) === pending) locks.delete(id);
      }
    }
    const assets = {
      "/": "index.html",
      "/index.html": "index.html",
      "/app.js": "app.js",
      "/app.css": "app.css",
      "/sw.js": "sw.js",
      "/manifest.webmanifest": "manifest.webmanifest",
      "/icon.svg": "icon.svg",
    };
    if (req.method === "GET" && assets[path]) {
      try {
        const bytes = await readFile(join(webDir, assets[path]));
        const type = path.endsWith(".js")
          ? "text/javascript"
          : path.endsWith(".css")
            ? "text/css"
            : path.endsWith(".svg")
              ? "image/svg+xml"
              : path.endsWith("webmanifest")
                ? "application/manifest+json"
                : "text/html";
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: http: blob: data:; connect-src 'self' https: http:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        );
        res.writeHead(200, {
          "Content-Type": type,
          "Cache-Control": "no-cache",
        });
        res.end(bytes);
        return;
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    respond(res, 404, { error: "Not found" });
  };
  const listener = (req, res) =>
    handle(req, res).catch((e) => {
      if (!res.headersSent)
        respond(res, e.status ?? 500, {
          error: e.status ? "Invalid request" : "Relay error",
        });
      else res.destroy();
    });
  const server = tls
    ? https.createServer(tls, listener)
    : http.createServer(listener);
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  await new Promise((r, j) => {
    server.once("error", j);
    server.listen(port, host, r);
  });
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const tls =
    process.env.FOLIO_TLS_CERT && process.env.FOLIO_TLS_KEY
      ? {
          cert: await readFile(process.env.FOLIO_TLS_CERT),
          key: await readFile(process.env.FOLIO_TLS_KEY),
        }
      : undefined;
  const host = process.env.FOLIO_HOST ?? "127.0.0.1",
    port = Number(process.env.FOLIO_PORT ?? 8787);
  await createRelay({
    host,
    port,
    dataDir: process.env.FOLIO_DATA,
    tls,
    publicOrigin: process.env.FOLIO_PUBLIC_ORIGIN,
  });
  console.log(`Folio is ready at ${tls ? "https" : "http"}://${host}:${port}`);
}
