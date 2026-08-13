import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyDirectorRoute,
  defectiveGenericMutation,
  FORBIDDEN_GENERIC_MUTATIONS,
} from "../lib/http-policy.mjs";
import { requestJson, startBridge, startLoopbackDirector } from "../lib/live-http.mjs";

const origin = "https://desktop-inlaqjq.tail177dc2.ts.net";
const cookie = "pair=paired";

test("generic mutation routes are refused by policy", () => {
  for (const key of FORBIDDEN_GENERIC_MUTATIONS) {
    const [method, pathname] = key.split(" ");
    const r = classifyDirectorRoute(method, pathname);
    assert.equal(r.allowed, false, key);
    assert.equal(r.reason, "generic-mutation-forbidden");
  }
});

test("live bridge cannot clear gates, rewrite deploy truth, drop leases, or mark review PASS", async () => {
  const dir = await startLoopbackDirector(({ res }) => res.writeHead(200).end("{}"));
  const br = await startBridge({ directorPort: dir.port });
  try {
    const attempts = [
      "/api/director/gates/clear",
      "/api/director/deploymentTruth",
      "/api/director/leases/release",
      "/api/director/review/pass",
      "/api/director/authorizeProduction",
      "/api/director/state",
      "/api/director/mission/complete",
    ];
    for (const path of attempts) {
      const r = await requestJson({
        host: "127.0.0.1", port: br.port, method: "POST", path,
        headers: { origin, cookie },
        body: { state: "COMPLETED", deploymentTruth: "VERIFIED_TARGET_PRODUCTION" },
      });
      assert.equal(r.status, 404, path);
      assert.equal(r.json.code, "GENERIC_MUTATION_REFUSED");
    }
  } finally {
    br.server.close();
    dir.server.close();
  }
});

test("defective generic merge would honor a forged COMPLETED write (oracle bites)", () => {
  const ctx = { state: "VERIFYING", deploymentTruth: "MAY_HAVE_WRITTEN" };
  const bad = defectiveGenericMutation(ctx, { state: "COMPLETED", deploymentTruth: "VERIFIED_TARGET_PRODUCTION" });
  assert.equal(bad.ctx.state, "COMPLETED");
  assert.equal(classifyDirectorRoute("POST", "/state").allowed, false);
});
