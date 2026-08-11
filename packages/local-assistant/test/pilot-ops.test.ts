import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  startPilot,
  recordFriction,
  recordPilotDay,
  recordFeatureUse,
  loadPilotState,
  pilotCheckpointSummary,
} from "../src/pilot-ops.js";

test("pilot friction and day metrics persist under private pilot dir", () => {
  const root = mkdtempSync(join(tmpdir(), "aion-pilot-"));
  try {
    startPilot(root, "2026-08-11T10:00:00.000Z");
    recordFriction(root, {
      id: "f1",
      at: "2026-08-11T10:01:00.000Z",
      problem: "wrong classification",
      impact: "medium",
      smallestFix: "Owner correction route",
    });
    recordFriction(root, {
      id: "f2",
      at: "2026-08-11T10:02:00.000Z",
      problem: "wrong classification",
      impact: "medium",
      smallestFix: "Owner correction route",
    });
    recordPilotDay(root, {
      day: "2026-08-11",
      briefGenerated: true,
      ownerMustDo: 0,
      aionCanDo: 3,
      waitingOn: 0,
      attentionItems: 0,
      gmailNewScanned: 5,
      draftsPrepared: 2,
      emailsSent: 0,
      corrections: 1,
      ownerPrompts: 4,
      at: "2026-08-11T10:05:00.000Z",
    });
    recordFeatureUse(root, "executive.daily", "2026-08-11T10:05:00.000Z");
    const state = loadPilotState(root);
    assert.equal(state.days.length, 1);
    assert.equal(state.friction[0]!.frequency, 2);
    const sum = pilotCheckpointSummary(state);
    assert.equal(sum.daysUsed, 1);
    assert.equal(sum.gmailRefreshed, 5);
    assert.equal(sum.drafts, 2);
    assert.equal(sum.topFeatures[0]!.feature, "executive.daily");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
