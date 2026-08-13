import assert from "node:assert/strict";
import test from "node:test";
import { bridgeTargetAllowed, defectiveBridgeTarget } from "../lib/http-policy.mjs";
import { requestJson, startBridge, startLoopbackDirector } from "../lib/live-http.mjs";

const origin = "https://desktop-inlaqjq.tail177dc2.ts.net";
const cookie = "pair=paired";

test("unpaired and forged origin cannot use the bridge", async () => {
  const dir = await startLoopbackDirector(({ res }) => {
    res.writeHead(200).end(JSON.stringify({ ok: true }));
  });
  const br = await startBridge({ directorPort: dir.port });
  try {
    const unpaired = await requestJson({
      host: "127.0.0.1", port: br.port, path: "/api/director/status",
      headers: { origin },
    });
    assert.equal(unpaired.status, 401);
    const forged = await requestJson({
      host: "127.0.0.1", port: br.port, path: "/api/director/status",
      headers: { origin: "https://evil.example", cookie },
    });
    assert.equal(forged.status, 403);
    const ok = await requestJson({
      host: "127.0.0.1", port: br.port, path: "/api/director/status",
      headers: { origin, cookie },
    });
    assert.equal(ok.status, 200);
  } finally {
    br.server.close();
    dir.server.close();
  }
});

test("bridge refuses URL/host/port overrides (SSRF)", async () => {
  const dir = await startLoopbackDirector(({ res }) => res.writeHead(200).end("{}"));
  const br = await startBridge({ directorPort: dir.port });
  try {
    const viaUrl = await requestJson({
      host: "127.0.0.1", port: br.port,
      path: "/api/director/status?url=http://127.0.0.1:31415/secret",
      headers: { origin, cookie },
    });
    assert.equal(viaUrl.status, 400);
    assert.equal(viaUrl.json.code, "SSRF_REFUSED");
    const viaHost = await requestJson({
      host: "127.0.0.1", port: br.port,
      path: "/api/director/status?host=127.0.0.1&port=31415",
      headers: { origin, cookie },
    });
    assert.equal(viaHost.status, 400);
  } finally {
    br.server.close();
    dir.server.close();
  }
});

test("policy oracle rejects absolute URLs; defective open proxy would accept them", () => {
  const good = bridgeTargetAllowed({
    method: "GET", pathname: "/status", unpaired: false, forgedOrigin: false,
  });
  assert.equal(good.ok, true);
  const ssrf = bridgeTargetAllowed({
    method: "GET", pathname: "/status", absoluteUrl: true, unpaired: false,
  });
  assert.equal(ssrf.ok, false);
  assert.ok(ssrf.reasons.includes("absolute-url-ssrf"));
  const defective = defectiveBridgeTarget({ url: "http://127.0.0.1:31415/private" });
  assert.equal(defective.ok, true);
});

test("Director down becomes 503 DIRECTOR_UNAVAILABLE", async () => {
  const br = await startBridge({ directorPort: 9, directorDown: true });
  try {
    const r = await requestJson({
      host: "127.0.0.1", port: br.port, path: "/api/director/status",
      headers: { origin, cookie },
    });
    assert.equal(r.status, 503);
    assert.equal(r.json.code, "DIRECTOR_UNAVAILABLE");
  } finally {
    br.server.close();
  }
});
