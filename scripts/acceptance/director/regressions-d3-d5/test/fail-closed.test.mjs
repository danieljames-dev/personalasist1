import assert from "node:assert/strict";
import test from "node:test";
import { mapDirectorFailure, MAX_REQUEST_BYTES } from "../lib/http-policy.mjs";
import { loadDashboardSnapshot } from "../lib/dashboard-presentation.mjs";
import { requestJson, startBridge, startLoopbackDirector } from "../lib/live-http.mjs";

const origin = "https://desktop-inlaqjq.tail177dc2.ts.net";
const cookie = "pair=paired";

test("timeout and malformed Director responses map to bounded failures", () => {
  assert.equal(mapDirectorFailure("timeout").status, 504);
  assert.equal(mapDirectorFailure("malformed").status, 502);
  assert.equal(mapDirectorFailure("down").code, "DIRECTOR_UNAVAILABLE");
  assert.equal(mapDirectorFailure("oversized").status, 413);
});

test("oversized POST is rejected before it becomes Director state", async () => {
  const dir = await startLoopbackDirector(({ res }) => res.writeHead(200).end("{}"));
  const br = await startBridge({ directorPort: dir.port });
  try {
    const huge = "x".repeat(MAX_REQUEST_BYTES + 50);
    const r = await requestJson({
      host: "127.0.0.1", port: br.port, method: "POST", path: "/api/director/pause",
      headers: { origin, cookie },
      body: huge,
    });
    assert.ok(r.status === 413 || r.status === 0);
  } finally {
    br.server.close();
    dir.server.close();
  }
});

test("dashboard truth is loaded from durable snapshot after process restart", () => {
  const missing = loadDashboardSnapshot(null);
  assert.equal(missing.ok, false);
  const durable = {
    missionId: "daily-intelligence-finalization",
    presentation: "WORKING",
    ownerActionRequired: true,
    revision: 7,
  };
  const loaded = loadDashboardSnapshot(durable);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.snapshot.revision, 7);
  assert.equal(loaded.snapshot.presentation, "WORKING");
});
