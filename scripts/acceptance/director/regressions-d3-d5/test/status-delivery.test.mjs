import assert from "node:assert/strict";
import test from "node:test";
import { evaluateDelivery, recommendStatusDelivery } from "../lib/status-delivery.mjs";

test("polling satisfies restart, stale, disconnect, and bounded use", () => {
  for (const s of ["restart", "stale", "disconnect", "bounded"]) {
    assert.equal(evaluateDelivery("POLLING", s).ok, true, s);
  }
});

test("SSE is not bounded for v0.1 phone connections", () => {
  assert.equal(evaluateDelivery("SSE", "bounded").ok, false);
});

test("recommend polling for v0.1", () => {
  const r = recommendStatusDelivery();
  assert.equal(r.recommendation, "POLLING");
  assert.equal(r.pollingSatisfies, true);
  assert.ok(r.intervalMs >= 1000);
});
