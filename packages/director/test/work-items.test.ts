/**
 * A pending Owner gate blocks its dependents, not the machine.
 *
 * The scenario these are written from is real and current: Daily Intelligence is integrated on main,
 * production is deliberately still on the old SHA, and the Owner has not yet tested the preview on
 * his phone. That gate must stop deployment and nothing else. If it stopped everything, an Owner
 * asleep would cost a night of work the Director exists to do without him.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  assessReadiness, schedule, selectRunnable, describeBoard, unblockedByGate,
  type WorkItemV1, type BoardV1,
} from "../src/work-items.js";
import { openGate, resolveGate } from "../src/gates.js";
import { routeRole, type ExecutorRoleV1 } from "../src/executors.js";

const NOW = "2026-08-13T12:00:00.000Z";

const item = (over: Partial<WorkItemV1> & { workItemId: string; kind: string }): WorkItemV1 => ({
  schema: "aion.director.work-item.v1",
  missionId: "m1",
  status: "PENDING",
  dependsOn: [],
  blockedByGateIds: [],
  executorRole: "TEST" as ExecutorRoleV1,
  authorityClass: "ROUTINE_LOCAL",
  requiresLease: null,
  attemptCount: 0,
  currentRunId: null,
  resultRef: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const phoneGate = openGate({
  gateId: "gate-phone", missionId: "m1",
  type: "PHYSICAL_IPHONE_TEST_REQUIRED",
  why: "the multi-photo and voice paths have never run on a real device",
  requiredInput: "test Daily Intelligence on your iPhone",
  at: NOW,
  safeFrozenState: { mainSha: "1ce25ba", productionSha: "d18c792" },
  resumeState: "READY_FOR_DEPLOYMENT",
});

/** The board as it actually stands today. */
function dailyIntelligenceBoard(over: Partial<BoardV1> = {}): BoardV1 {
  return {
    items: [
      item({ workItemId: "w-truth", kind: "verify repository truth", status: "PASSED" }),
      item({ workItemId: "w-accept", kind: "verify acceptance evidence", status: "PASSED" }),
      item({ workItemId: "w-preview", kind: "verify preview", status: "PASSED" }),
      item({ workItemId: "w-prepare", kind: "prepare deployment" }),
      item({ workItemId: "w-rollback", kind: "verify rollback plan" }),
      item({
        workItemId: "w-deploy", kind: "deploy Daily Intelligence",
        dependsOn: ["w-prepare"], blockedByGateIds: ["gate-phone"],
        executorRole: "DEPLOY", authorityClass: "PRODUCTION_DEPLOY",
      }),
      item({
        workItemId: "w-close", kind: "close the release",
        dependsOn: ["w-deploy"], blockedByGateIds: ["gate-phone"],
      }),
    ],
    gates: [phoneGate],
    heldResources: [],
    availableExecutors: ["claude", "grok"],
    missionHalted: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The correction itself
// ---------------------------------------------------------------------------

test("an open phone gate does not stop unrelated work", () => {
  const board = dailyIntelligenceBoard();
  const plan = schedule(board);

  assert.ok(plan.ready.length >= 2, "preparation and rollback verification should still run");
  assert.ok(plan.continuingWithoutOwner.includes("prepare deployment"));
  assert.ok(plan.continuingWithoutOwner.includes("verify rollback plan"));
  assert.equal(plan.waitingOnOwnerOnly, false, "a busy mission is not a waiting mission");
});

test("the same gate does stop what genuinely depends on it", () => {
  const board = dailyIntelligenceBoard();
  const deploy = board.items.find((i) => i.workItemId === "w-deploy")!;
  const readiness = assessReadiness(deploy, board);

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, "OWNER_GATE_UNRESOLVED");
  assert.match(readiness.detail, /test Daily Intelligence on your iPhone/);
  assert.ok(schedule(board).blockedOnOwner.includes("deploy Daily Intelligence"));
});

test("the mission waits on the Owner only when nothing else is runnable", () => {
  const board = dailyIntelligenceBoard({
    items: dailyIntelligenceBoard().items.map((i) =>
      i.workItemId === "w-prepare" || i.workItemId === "w-rollback" ? { ...i, status: "PASSED" as const } : i),
  });
  const plan = schedule(board);

  assert.deepEqual(plan.ready, [], "independent work is exhausted");
  assert.equal(plan.waitingOnOwnerOnly, true, "now the mission really is waiting for a person");
  assert.equal(plan.idle, false, "there is outstanding work, it is simply gated");
});

test("answering the gate makes the dependent work runnable", () => {
  const board = dailyIntelligenceBoard({
    items: dailyIntelligenceBoard().items.map((i) =>
      ["w-prepare", "w-rollback"].includes(i.workItemId) ? { ...i, status: "PASSED" as const } : i),
  });
  assert.equal(schedule(board).ready.length, 0);

  const resolved = resolveGate({ gate: phoneGate, approved: true, at: NOW });
  const after = schedule({ ...board, gates: [resolved.gate] });

  assert.ok(after.ready.some((i) => i.workItemId === "w-deploy"), "deployment unblocks");
  assert.equal(after.waitingOnOwnerOnly, false);
  assert.deepEqual(
    unblockedByGate(board.items, "gate-phone").map((i) => i.workItemId),
    ["w-deploy", "w-close"],
  );
});

test("a gate cannot be crossed by routing around it through another work item", () => {
  // "close the release" also depends on the gate; finishing other work must not make it runnable.
  const board = dailyIntelligenceBoard();
  const close = board.items.find((i) => i.workItemId === "w-close")!;
  assert.equal(assessReadiness(close, board).ready, false);
  assert.equal(assessReadiness(close, board).reason, "OWNER_GATE_UNRESOLVED");
});

// ---------------------------------------------------------------------------
// Dependencies, resources, halting
// ---------------------------------------------------------------------------

test("only a genuinely finished dependency unblocks the next item", () => {
  const board = dailyIntelligenceBoard({
    items: [
      item({ workItemId: "a", kind: "first", status: "RUNNING" }),
      item({ workItemId: "b", kind: "second", dependsOn: ["a"] }),
    ],
  });
  const second = assessReadiness(board.items[1]!, board);
  assert.equal(second.ready, false);
  assert.equal(second.reason, "DEPENDENCY_NOT_SATISFIED");
  assert.match(second.detail, /needs "first" to finish first/);
});

test("two items never take the same working copy", () => {
  const lease = { kind: "WORKTREE", resource: "C:/wt-a" };
  const board = dailyIntelligenceBoard({
    items: [
      item({ workItemId: "a", kind: "implement", executorRole: "IMPLEMENT", requiresLease: lease }),
      item({ workItemId: "b", kind: "repair", executorRole: "REPAIR", requiresLease: lease }),
    ],
    heldResources: [],
  });
  const chosen = selectRunnable({
    scheduling: schedule(board),
    runningByExecutor: {},
    heldResources: [],
    routeOf: routeRole,
  });
  assert.equal(chosen.length, 1, "two writers in one worktree produce a tree neither of them built");
});

test("one writer per executor, but local verification runs freely", () => {
  const board = dailyIntelligenceBoard({
    items: [
      item({ workItemId: "a", kind: "implement", executorRole: "IMPLEMENT" }),
      item({ workItemId: "b", kind: "repair", executorRole: "REPAIR" }),
      item({ workItemId: "c", kind: "run tests", executorRole: "TEST" }),
      item({ workItemId: "d", kind: "verify git", executorRole: "GIT_VERIFY" }),
    ],
  });
  const chosen = selectRunnable({
    scheduling: schedule(board), runningByExecutor: {}, heldResources: [], routeOf: routeRole,
  });
  const kinds = chosen.map((i) => i.kind);
  assert.equal(kinds.filter((k) => k === "implement" || k === "repair").length, 1);
  assert.ok(kinds.includes("run tests"));
  assert.ok(kinds.includes("verify git"), "reading is not a writer");
});

test("a claude worktree and a grok worktree run in parallel", () => {
  const board = dailyIntelligenceBoard({
    items: [
      item({ workItemId: "a", kind: "implement", executorRole: "IMPLEMENT", requiresLease: { kind: "WORKTREE", resource: "C:/wt-claude" } }),
      item({ workItemId: "b", kind: "review", executorRole: "ADVERSARIAL_REVIEW", requiresLease: { kind: "WORKTREE", resource: "C:/wt-grok" } }),
    ],
  });
  const chosen = selectRunnable({
    scheduling: schedule(board), runningByExecutor: {}, heldResources: [], routeOf: routeRole,
  });
  assert.equal(chosen.length, 2, "different executors in different worktrees is the normal case");
});

test("a halted mission runs nothing, however ready an item looks", () => {
  for (const halted of [true]) {
    const board = dailyIntelligenceBoard({ missionHalted: halted });
    const plan = schedule(board);
    assert.deepEqual(plan.ready, []);
    assert.equal(assessReadiness(board.items[3]!, board).reason, "MISSION_HALTED");
  }
});

test("no executor capacity blocks external work but not local work", () => {
  const board = dailyIntelligenceBoard({
    items: [
      item({ workItemId: "a", kind: "implement", executorRole: "IMPLEMENT" }),
      item({ workItemId: "b", kind: "run tests", executorRole: "TEST" }),
    ],
    availableExecutors: [],
  });
  assert.equal(assessReadiness(board.items[0]!, board).reason, "EXECUTOR_UNAVAILABLE");
  assert.equal(assessReadiness(board.items[1]!, board).ready, true, "local work needs nobody");
});

// ---------------------------------------------------------------------------
// What the Owner reads
// ---------------------------------------------------------------------------

test("an open gate never makes a busy system look stopped", () => {
  const text = describeBoard(schedule(dailyIntelligenceBoard()));
  assert.match(text, /AION is still working/);
  assert.match(text, /Waiting on you/);
  assert.match(text, /Continuing meanwhile/);
  assert.ok(!/[A-Z_]{8,}/.test(text), `no enums reach the Owner: ${text}`);
});

test("when only the Owner is left, the message says so plainly", () => {
  const board = dailyIntelligenceBoard({
    items: dailyIntelligenceBoard().items.map((i) =>
      ["w-prepare", "w-rollback"].includes(i.workItemId) ? { ...i, status: "PASSED" as const } : i),
  });
  const text = describeBoard(schedule(board));
  assert.ok(!/still working/.test(text));
  assert.match(text, /Waiting on you:/);
});
