import assert from "node:assert/strict";
import test from "node:test";
import net from "node:net";
import { bindHostAllowed, DIRECTOR_BIND_HOST } from "../lib/http-policy.mjs";
import { lanAddresses, requestJson, startLoopbackDirector } from "../lib/live-http.mjs";

test("policy refuses any bind host other than 127.0.0.1", () => {
  assert.equal(bindHostAllowed("127.0.0.1"), true);
  assert.equal(bindHostAllowed("0.0.0.0"), false);
  assert.equal(bindHostAllowed("::"), false);
  assert.equal(bindHostAllowed("192.168.1.10"), false);
  assert.equal(DIRECTOR_BIND_HOST, "127.0.0.1");
});

test("live Director mock listens on 127.0.0.1 and answers loopback", async () => {
  const dir = await startLoopbackDirector(({ res }) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, bind: "127.0.0.1" }));
  });
  try {
    assert.equal(dir.host, "127.0.0.1");
    const r = await requestJson({ host: "127.0.0.1", port: dir.port, path: "/status" });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
  } finally {
    dir.server.close();
  }
});

test("LAN addresses cannot open the loopback-only Director port", async () => {
  const dir = await startLoopbackDirector(({ res }) => {
    res.writeHead(200).end("{}");
  });
  try {
    const lans = lanAddresses();
    for (const ip of lans.slice(0, 3)) {
      const refused = await new Promise((resolve) => {
        const s = net.connect({ host: ip, port: dir.port });
        const done = (v) => { try { s.destroy(); } catch { /* ignore */ } resolve(v); };
        s.setTimeout(800);
        s.on("connect", () => done(false));
        s.on("error", () => done(true));
        s.on("timeout", () => done(true));
      });
      assert.equal(refused, true, `LAN ${ip}:${dir.port} must not reach loopback bind`);
    }
  } finally {
    dir.server.close();
  }
});
