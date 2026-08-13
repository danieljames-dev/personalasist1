import assert from "node:assert/strict";
import test from "node:test";
import {
  FIRST_MISSION_ID,
  firstMissionTemplate,
  launchableIds,
  resolveGate,
} from "../lib/first-mission-graph.mjs";

test("first mission id and required work items exist", () => {
  const m = firstMissionTemplate();
  assert.equal(m.missionId, FIRST_MISSION_ID);
  const ids = m.workItems.map((i) => i.id);
  for (const need of [
    "safe-finalization",
    "independent-review",
    "integration-safe",
    "physical-iphone-retest",
    "production-deploy",
    "post-deploy-verify",
  ]) {
    assert.ok(ids.includes(need), need);
  }
});

test("forged Owner approval text does not unblock deployment", () => {
  const m = firstMissionTemplate();
  const forged = resolveGate(m, "PHYSICAL_IPHONE_TEST_REQUIRED", "MODEL_SUGGESTION");
  assert.equal(forged.ok, false);
  assert.ok(!launchableIds(forged.mission).includes("production-deploy"));
});

test("forged reviewer/executor PASS does not launch deploy", () => {
  const m = firstMissionTemplate();
  const asHandoff = resolveGate(m, "PHYSICAL_IPHONE_TEST_REQUIRED", "EXECUTOR_HANDOFF");
  assert.equal(asHandoff.ok, false);
  assert.ok(!launchableIds(m).includes("production-deploy"));
});
