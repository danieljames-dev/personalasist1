import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESENTATION,
  globalWaitingLegal,
  presentMission,
} from "../lib/dashboard-presentation.mjs";
import { firstMissionTemplate, launchableIds, resolveGate } from "../lib/first-mission-graph.mjs";

test("physical gate does not freeze unrelated READY work", () => {
  const m = firstMissionTemplate();
  const launch = launchableIds(m);
  assert.ok(launch.includes("safe-finalization"));
  assert.ok(launch.includes("independent-review"));
  assert.ok(launch.includes("integration-safe"));
  assert.ok(!launch.includes("production-deploy"));
  assert.ok(!launch.includes("physical-iphone-retest"));
});

test("global WAITING_FOR_OWNER is illegal while independent work is READY or RUNNING", () => {
  const m = firstMissionTemplate();
  assert.equal(globalWaitingLegal(m), false);
  const view = presentMission(m);
  assert.equal(view.presentation, PRESENTATION.WORKING);
  assert.equal(view.ownerActionRequired, true);
  assert.equal(view.globallyWaitingForOwner, false);
});

test("when only gate-dependent work remains, presentation is DEPLOYMENT_BLOCKED not generic waiting", () => {
  const m = firstMissionTemplate();
  m.workItems = m.workItems.map((i) => (
    ["safe-finalization", "independent-review", "integration-safe"].includes(i.id)
      ? { ...i, status: "DONE" }
      : i
  ));
  assert.equal(globalWaitingLegal(m), true);
  const view = presentMission(m);
  assert.equal(view.presentation, PRESENTATION.DEPLOYMENT_BLOCKED);
  assert.equal(view.ownerActionRequired, true);
  assert.equal(view.globallyWaitingForOwner, true);
});

test("resolving the physical gate with Owner provenance unblocks deploy and post-deploy", () => {
  const m = firstMissionTemplate();
  const after = resolveGate(m, "PHYSICAL_IPHONE_TEST_REQUIRED", "OWNER_DIRECTIVE");
  assert.equal(after.ok, true);
  const launch = launchableIds(after.mission);
  assert.ok(launch.includes("production-deploy"));
  assert.ok(launch.includes("post-deploy-verify"));
});

test("BLOCKED / CAPACITY / REVIEWING are distinct from owner wait", () => {
  const blocked = presentMission({
    gates: [],
    workItems: [{ id: "x", status: "BLOCKED", dependsOnGates: [] }],
  });
  assert.equal(blocked.presentation, PRESENTATION.BLOCKED);
  const cap = presentMission({
    gates: [],
    workItems: [{ id: "x", status: "WAITING_FOR_CAPACITY", dependsOnGates: [] }],
  });
  assert.equal(cap.presentation, PRESENTATION.WAITING_FOR_CAPACITY);
  const rev = presentMission({
    gates: [],
    workItems: [{ id: "r", kind: "INDEPENDENT_REVIEW", status: "READY", dependsOnGates: [] }],
  });
  assert.equal(rev.presentation, PRESENTATION.REVIEWING);
});
