/**
 * Live loopback Director + CC bridge for property tests.
 * Binds 127.0.0.1 only. Isolated ephemeral ports.
 */
import http from "node:http";
import { networkInterfaces } from "node:os";
import {
  ALLOWED_DIRECTOR_PATHS,
  MAX_REQUEST_BYTES,
  bindHostAllowed,
  classifyDirectorRoute,
  mapDirectorFailure,
  normalizePath,
} from "./http-policy.mjs";

export function lanAddresses() {
  const out = [];
  const ifs = networkInterfaces();
  for (const list of Object.values(ifs)) {
    for (const n of list || []) {
      if (n.family === "IPv4" && !n.internal) out.push(n.address);
    }
  }
  return out;
}

export function startLoopbackDirector(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      let n = 0;
      req.on("data", (c) => {
        n += c.length;
        if (n > MAX_REQUEST_BYTES) {
          req.destroy();
          if (!res.headersSent) {
            res.writeHead(413, { "content-type": "application/json" });
            res.end(JSON.stringify({ code: "REQUEST_TOO_LARGE" }));
          }
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        const route = classifyDirectorRoute(req.method, url.pathname);
        if (!route.allowed) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, reason: route.reason }));
          return;
        }
        const body = Buffer.concat(chunks).toString("utf8");
        handler({ req, res, url, body, route });
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!bindHostAllowed(addr.address)) {
        server.close();
        reject(new Error("bound-non-loopback"));
        return;
      }
      resolve({ server, host: addr.address, port: addr.port });
    });
    server.on("error", reject);
  });
}

export function startBridge({ directorPort, pairedToken = "paired", directorDown = false }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (!url.pathname.startsWith("/api/director/")) {
        res.writeHead(404).end();
        return;
      }
      const origin = req.headers.origin || "";
      const cookie = req.headers.cookie || "";
      const paired = cookie.includes(`pair=${pairedToken}`);
      const forged = origin && origin !== "https://desktop-inlaqjq.tail177dc2.ts.net";
      if (!paired) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: "UNPAIRED" }));
        return;
      }
      if (forged) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: "FORGED_ORIGIN" }));
        return;
      }
      if (url.searchParams.has("url") || url.searchParams.has("host") || url.searchParams.has("port")) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: "SSRF_REFUSED" }));
        return;
      }
      const suffix = url.pathname.slice("/api/director".length) || "/";
      if (suffix.includes("..") || /^https?:/i.test(suffix)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: "SSRF_REFUSED" }));
        return;
      }
      const method = req.method || "GET";
      const route = classifyDirectorRoute(method, suffix);
      if (!route.allowed) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: "GENERIC_MUTATION_REFUSED", reason: route.reason }));
        return;
      }
      if (directorDown) {
        const mapped = mapDirectorFailure("down");
        res.writeHead(mapped.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: mapped.code }));
        return;
      }
      const chunks = [];
      let n = 0;
      req.on("data", (c) => {
        n += c.length;
        if (n > MAX_REQUEST_BYTES) {
          const mapped = mapDirectorFailure("oversized");
          res.writeHead(mapped.status, { "content-type": "application/json" });
          res.end(JSON.stringify({ code: mapped.code }));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => {
        const payload = Buffer.concat(chunks);
        const dreq = http.request({
          host: "127.0.0.1",
          port: directorPort,
          path: suffix,
          method,
          timeout: 1500,
          headers: { "content-type": "application/json", "content-length": payload.length },
        }, (dres) => {
          const bufs = [];
          dres.on("data", (x) => bufs.push(x));
          dres.on("end", () => {
            res.writeHead(dres.statusCode || 502, { "content-type": "application/json" });
            res.end(Buffer.concat(bufs));
          });
        });
        dreq.on("timeout", () => {
          dreq.destroy();
          const mapped = mapDirectorFailure("timeout");
          if (!res.headersSent) {
            res.writeHead(mapped.status, { "content-type": "application/json" });
            res.end(JSON.stringify({ code: mapped.code }));
          }
        });
        dreq.on("error", () => {
          const mapped = mapDirectorFailure("down");
          if (!res.headersSent) {
            res.writeHead(mapped.status, { "content-type": "application/json" });
            res.end(JSON.stringify({ code: mapped.code }));
          }
        });
        dreq.end(payload);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, host: addr.address, port: addr.port });
    });
    server.on("error", reject);
  });
}

export function requestJson({ host, port, method = "GET", path, headers = {}, body = null }) {
  return new Promise((resolve) => {
    const payload = body == null ? null : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    const req = http.request({
      host,
      port,
      method,
      path,
      timeout: 2000,
      headers: {
        ...headers,
        ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {}),
      },
    }, (res) => {
      const bufs = [];
      res.on("data", (c) => bufs.push(c));
      res.on("end", () => {
        const text = Buffer.concat(bufs).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* raw */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on("error", (error) => resolve({ status: 0, error: error.code || error.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, error: "TIMEOUT" });
    });
    req.end(payload);
  });
}

export { ALLOWED_DIRECTOR_PATHS };
