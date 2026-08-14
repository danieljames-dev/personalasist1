/**
 * The moves a mission must refuse.
 *
 * An enumerated transition table stops a model inventing a path, but it says nothing about whether a
 * legal-looking move has been earned. These cover the second half: a mission cannot declare itself
 * finished while the Owner's question is unanswered, cannot deploy by having arrived at a state name,
 * cannot launder a block away through an interruption, and cannot be steered into an outcome by a
 * string in a file. Each test names the specific way state could otherwise be moved without the work
 * behind it having happened.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  advance, legalEventsFrom, declaredTarget, awaitsOwner, needsEngineer,
  MISSION_STATES, MISSION_EVENT_KINDS, TERMINAL_STATES, RESUMABLE_STATES, NOTHING_PROVEN,
  type MissionStateV1, type MissionContextV1, type MissionAdvanceOptionsV1,
} from "../src/mission.js";
import { openGate } from "../src/gates.js";
import { schedule, type BoardV1, type WorkItemV1 } from "../src/work-items.js";

const NOW = "2026-08-13T12:00:00.000Z";

/** Everything established. Individual tests take this away one fact at a time. */
const PROVEN: Partial<MissionContextV1> = {
  unresolvedRequiredGates: 0,
  // Stated rather than defaulted: omitting this field now refuses, because a caller that has lost
  // the record must not be read as a caller asserting no deployment ever happened.
  deploymentTruth: "NOT_STARTED",
  unsatisfiedMandatoryWorkItems: 0,
  independentWorkRemains: false,
  postIntegrationVerificationPassed: true,
  postDeployVerificationPassed: true,
  deploymentDependenciesSatisfied: true,
  deploymentAuthorityPresent: true,
  productionWriterLeaseAvailable: true,
};

// ---------------------------------------------------------------------------
// Completion requires its prerequisites
// ---------------------------------------------------------------------------

test("VERIFYING + MISSION_COMPLETED does not bypass prerequisites", () => {
  // The mission this prevents: tests green, phone test never done, mission marked finished.
  const unproven = advance("VERIFYING", "MISSION_COMPLETED");
  assert.equal(unproven.ok, false, "an unstated board is not a satisfied one");
  assert.equal(unproven.to, null);

  const gated = advance("VERIFYING", "MISSION_COMPLETED", null, {
    context: { ...PROVEN, unresolvedRequiredGates: 1 },
  });
  assert.equal(gated.ok, false);
  assert.match(gated.missing.join("; "), /approval/);

  const unfinished = advance("VERIFYING", "MISSION_COMPLETED", null, {
    context: { ...PROVEN, unsatisfiedMandatoryWorkItems: 2 },
  });
  assert.equal(unfinished.ok, false);
  assert.match(unfinished.missing.join("; "), /has not finished/);

  const settled = advance("VERIFYING", "MISSION_COMPLETED", null, { context: PROVEN });
  assert.equal(settled.to, "COMPLETED", "with everything settled it does complete");
});

test("READY_FOR_INTEGRATION + MISSION_COMPLETED does not bypass prerequisites", () => {
  assert.equal(advance("READY_FOR_INTEGRATION", "MISSION_COMPLETED").ok, false);

  const gated = advance("READY_FOR_INTEGRATION", "MISSION_COMPLETED", null, {
    context: { ...PROVEN, unresolvedRequiredGates: 1 },
  });
  assert.equal(gated.ok, false);
  assert.equal(gated.to, null);

  assert.equal(advance("READY_FOR_INTEGRATION", "MISSION_COMPLETED", null, { context: PROVEN }).to, "COMPLETED");
});

test("a refusal to complete names what is outstanding, in words a person can act on", () => {
  const attempt = advance("VERIFYING", "MISSION_COMPLETED", null, {
    context: { unresolvedRequiredGates: 1, unsatisfiedMandatoryWorkItems: 3, deploymentTruth: "NOT_STARTED" },
  });
  assert.equal(attempt.missing.length, 2);
  // And with production unstated the list grows rather than the refusal changing shape, so the
  // Owner-facing prose still holds when the mission genuinely does not know what it deployed.
  const uncertain = advance("VERIFYING", "MISSION_COMPLETED", null, {
    context: { unresolvedRequiredGates: 1, unsatisfiedMandatoryWorkItems: 3 },
  });
  assert.equal(uncertain.missing.length, 3);
  assert.ok(!/[A-Z_]{8,}/.test(uncertain.missing.join(" ")), "no enums reach the Owner here either");
  assert.ok(!/[A-Z_]{8,}/.test(attempt.missing.join(" ")), `no enums reach the Owner: ${attempt.missing.join(" ")}`);
});

test("completing after a deployment additionally requires the deployment to have been checked", () => {
  const unchecked = advance("POST_DEPLOY_VERIFY", "MISSION_COMPLETED", null, {
    context: { ...PROVEN, postDeployVerificationPassed: false },
  });
  assert.equal(unchecked.ok, false);
  assert.match(unchecked.missing.join("; "), /healthy/);

  assert.equal(advance("POST_DEPLOY_VERIFY", "MISSION_COMPLETED", null, { context: PROVEN }).to, "COMPLETED");
  // A mission that never deployed is not held to a check that never applied to it.
  assert.equal(
    advance("VERIFYING", "MISSION_COMPLETED", null, { context: { ...PROVEN, postDeployVerificationPassed: false } }).to,
    "COMPLETED",
  );
});

// ---------------------------------------------------------------------------
// The owner gate is a dependency, not a freeze
// ---------------------------------------------------------------------------

test("an open gate does not stop a mission that still has independent work", () => {
  const busy = advance("VERIFYING", "OWNER_GATE_OPENED", null, {
    context: { unresolvedRequiredGates: 1, independentWorkRemains: true },
  });
  assert.equal(busy.to, "OWNER_GATE_REQUIRED", "one open gate is not a global halt");
  assert.equal(awaitsOwner(busy.to!), true);
});

test("WAITING_FOR_OWNER is reachable, and means the gate is the last thing in the way", () => {
  // Previously only MISSION_PAUSED named this edge, and pause is intercepted before the table, so
  // nothing could ever reach it.
  const idle = advance("OWNER_GATE_REQUIRED", "INDEPENDENT_WORK_EXHAUSTED", null, {
    context: { unresolvedRequiredGates: 1, independentWorkRemains: false },
  });
  assert.equal(idle.to, "WAITING_FOR_OWNER");

  const stillBusy = advance("OWNER_GATE_REQUIRED", "INDEPENDENT_WORK_EXHAUSTED", null, {
    context: { unresolvedRequiredGates: 1, independentWorkRemains: true },
  });
  assert.equal(stillBusy.to, "OWNER_GATE_REQUIRED", "the event claims it; the board decides it");

  const workReturned = advance("WAITING_FOR_OWNER", "RUN_CREATED", null, {
    context: { unresolvedRequiredGates: 1, independentWorkRemains: true },
  });
  assert.equal(workReturned.to, "OWNER_GATE_REQUIRED", "the mission stops looking stopped again");
});

test("answering one gate while another is open does not release the mission", () => {
  const partial = advance("WAITING_FOR_OWNER", "OWNER_GATE_RESOLVED", "PLANNING", {
    context: { unresolvedRequiredGates: 1, independentWorkRemains: false },
  });
  assert.equal(partial.to, "WAITING_FOR_OWNER", "the answer is recorded; the mission is not released");
  assert.equal(partial.ok, true);
  assert.match(partial.reason, /still unresolved/);
  assert.equal(partial.resumeState, "PLANNING", "the remembered target is not consumed by the wrong gate");
});

test("gate resolution derives its target from the records and validates the resume state", () => {
  const resolved = advance("OWNER_GATE_REQUIRED", "OWNER_GATE_RESOLVED", "READY_FOR_DEPLOYMENT", {
    context: { unresolvedRequiredGates: 0, deploymentTruth: "NOT_STARTED" },
  });
  assert.equal(resolved.to, "READY_FOR_DEPLOYMENT", "the gate says where its mission continues");
  assert.equal(resolved.resumeState, null, "and the remembered target is consumed");

  // A gate file naming an outcome must not select it.
  const forged = advance("OWNER_GATE_REQUIRED", "OWNER_GATE_RESOLVED", "COMPLETED", {
    context: { unresolvedRequiredGates: 0, deploymentTruth: "NOT_STARTED" },
  });
  assert.equal(forged.ok, false);
  assert.equal(forged.to, null);

  // A target that would skip the deployment prerequisites is not honoured either.
  assert.equal(
    advance("OWNER_GATE_REQUIRED", "OWNER_GATE_RESOLVED", "DEPLOYING", { context: { unresolvedRequiredGates: 0, deploymentTruth: "NOT_STARTED" } }).ok,
    false,
  );

  // An unstated target is not guessed at.
  assert.equal(
    advance("OWNER_GATE_REQUIRED", "OWNER_GATE_RESOLVED", null, { context: { unresolvedRequiredGates: 0, deploymentTruth: "NOT_STARTED" } }).to,
    "VERIFYING",
  );
});

test("mission state agrees with the work-item scheduler rather than keeping a second opinion", () => {
  const gate = openGate({
    gateId: "gate-phone", missionId: "m1",
    type: "PHYSICAL_IPHONE_TEST_REQUIRED",
    why: "the preview has never run on a real device",
    requiredInput: "test Daily Intelligence on your iPhone",
    at: NOW,
    resumeState: "READY_FOR_DEPLOYMENT",
  });
  const item = (over: Partial<WorkItemV1> & { workItemId: string; kind: string }): WorkItemV1 => ({
    schema: "aion.director.work-item.v1",
    missionId: "m1",
    status: "PENDING",
    dependsOn: [],
    blockedByGateIds: [],
    executorRole: "TEST",
    authorityClass: "ROUTINE_LOCAL",
    requiresLease: null,
    attemptCount: 0,
    currentRunId: null,
    resultRef: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  });
  const board: BoardV1 = {
    items: [
      item({ workItemId: "w-prepare", kind: "prepare deployment" }),
      item({ workItemId: "w-deploy", kind: "deploy", blockedByGateIds: ["gate-phone"] }),
    ],
    gates: [gate],
    heldResources: [],
    availableExecutors: ["claude"],
    missionHalted: false,
  };

  const busy = schedule(board);
  assert.equal(busy.waitingOnOwnerOnly, false);
  const whileBusy = advance("VERIFYING", "OWNER_GATE_OPENED", null, {
    context: { unresolvedRequiredGates: 1, independentWorkRemains: busy.ready.length > 0 },
  });
  assert.equal(whileBusy.to, "OWNER_GATE_REQUIRED", "the scheduler is still running work, so the mission is not waiting");

  const drained = schedule({
    ...board,
    items: board.items.map((i) => (i.workItemId === "w-prepare" ? { ...i, status: "PASSED" as const } : i)),
  });
  assert.equal(drained.waitingOnOwnerOnly, true);
  const whenIdle = advance("OWNER_GATE_REQUIRED", "INDEPENDENT_WORK_EXHAUSTED", null, {
    context: { unresolvedRequiredGates: 1, independentWorkRemains: drained.ready.length > 0 },
  });
  assert.equal(whenIdle.to, "WAITING_FOR_OWNER", "now both halves agree the Owner is the bottleneck");
});

// ---------------------------------------------------------------------------
// An interruption does not launder a blocker
// ---------------------------------------------------------------------------

test("interrupt while an owner gate is open preserves the gate dependency", () => {
  const interrupted = advance("OWNER_GATE_REQUIRED", "MISSION_INTERRUPTED");
  assert.equal(interrupted.to, "INTERRUPTED");
  assert.equal(interrupted.interruptedFrom, "OWNER_GATE_REQUIRED", "what was true is written down");

  const back = advance("INTERRUPTED", "GIT_VERIFIED", null, {
    interruptedFrom: interrupted.interruptedFrom,
    context: { unresolvedRequiredGates: 1, independentWorkRemains: true },
  });
  assert.equal(back.to, "OWNER_GATE_REQUIRED", "re-reading the repository does not answer a question");
  assert.equal(awaitsOwner(back.to!), true);
});

test("an answer given while nothing was running is still honoured", () => {
  // The gate record, not the interruption, is what says the question was answered.
  const back = advance("INTERRUPTED", "GIT_VERIFIED", null, {
    interruptedFrom: "WAITING_FOR_OWNER",
    context: { unresolvedRequiredGates: 0, deploymentTruth: "NOT_STARTED" },
  });
  assert.equal(back.to, "VERIFYING");
});

test("interrupt while BLOCKED does not clear the block", () => {
  const interrupted = advance("BLOCKED", "MISSION_INTERRUPTED");
  assert.equal(interrupted.interruptedFrom, "BLOCKED");

  const back = advance("INTERRUPTED", "GIT_VERIFIED", null, { interruptedFrom: interrupted.interruptedFrom });
  assert.equal(back.to, "BLOCKED", "a dead process is not a repair");
  assert.equal(needsEngineer(back.to!), true);
});

test("interrupt while WAITING_FOR_CAPACITY does not clear the capacity dependency", () => {
  const interrupted = advance("WAITING_FOR_CAPACITY", "MISSION_INTERRUPTED");
  const back = advance("INTERRUPTED", "GIT_VERIFIED", null, { interruptedFrom: interrupted.interruptedFrom });
  assert.equal(back.to, "WAITING_FOR_CAPACITY", "quota does not return because a process died");
});

test("a second interruption does not overwrite the condition the first recorded", () => {
  const first = advance("BLOCKED", "MISSION_INTERRUPTED");
  const second = advance("INTERRUPTED", "MISSION_INTERRUPTED", null, { interruptedFrom: first.interruptedFrom });
  assert.equal(second.interruptedFrom, "BLOCKED", "otherwise interrupting twice is a way to clear a block");
  assert.equal(advance("INTERRUPTED", "GIT_VERIFIED", null, { interruptedFrom: second.interruptedFrom }).to, "BLOCKED");
});

test("an ordinary interrupted run still verifies rather than repeats", () => {
  const interrupted = advance("EXECUTOR_RUNNING", "MISSION_INTERRUPTED");
  assert.equal(interrupted.interruptedFrom, "EXECUTOR_RUNNING");
  assert.equal(advance("INTERRUPTED", "GIT_VERIFIED", null, { interruptedFrom: "EXECUTOR_RUNNING" }).to, "VERIFYING");
  assert.equal(advance("INTERRUPTED", "GIT_MISMATCH").to, "BLOCKED");
});

// ---------------------------------------------------------------------------
// A supplied string never selects a state
// ---------------------------------------------------------------------------

test("resumeState cannot select COMPLETED", () => {
  const attempt = advance("PAUSED", "MISSION_RESUMED", "COMPLETED");
  assert.equal(attempt.ok, false, "an outcome is reached by satisfying it, never by naming it");
  assert.equal(attempt.to, null);
  assert.ok(!legalEventsFrom("PAUSED", "COMPLETED").includes("MISSION_RESUMED"));
});

test("resumeState cannot select FAILED", () => {
  const attempt = advance("PAUSED", "MISSION_RESUMED", "FAILED");
  assert.equal(attempt.ok, false);
  assert.equal(attempt.to, null);
});

test("resumeState cannot select a state that sits past a check", () => {
  for (const bypass of ["DEPLOYING", "POST_DEPLOY_VERIFY"] as MissionStateV1[]) {
    const attempt = advance("PAUSED", "MISSION_RESUMED", bypass);
    assert.equal(attempt.ok, false, `${bypass} would skip the check in front of it`);
  }
});

test("an origin that did not survive the pause is verified rather than re-entered", () => {
  // Pausing mid-run is legal; claiming the run is still live afterwards is not.
  const paused = advance("EXECUTOR_RUNNING", "MISSION_PAUSED");
  assert.equal(paused.resumeState, "EXECUTOR_RUNNING");
  const resumed = advance("PAUSED", "MISSION_RESUMED", paused.resumeState);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.to, "VERIFYING", "the process is gone; look before acting");
});

test("every resumable state round-trips through a pause unchanged", () => {
  for (const state of RESUMABLE_STATES) {
    const paused = advance(state, "MISSION_PAUSED");
    assert.equal(paused.to, "PAUSED");
    const resumed = advance("PAUSED", "MISSION_RESUMED", paused.resumeState);
    assert.equal(resumed.to, state, `${state} must come back as itself`);
    assert.equal(resumed.resumeState, null);
  }
});

test("pausing a blocked mission does not clear the block either", () => {
  const paused = advance("BLOCKED", "MISSION_PAUSED");
  assert.equal(advance("PAUSED", "MISSION_RESUMED", paused.resumeState).to, "BLOCKED");
});

// ---------------------------------------------------------------------------
// Deployment is earned, not arrived at
// ---------------------------------------------------------------------------

const DEPLOYABLE: Partial<MissionContextV1> = {
  unresolvedRequiredGates: 0,
  // Stated rather than defaulted: omitting this field now refuses, because a caller that has lost
  // the record must not be read as a caller asserting no deployment ever happened.
  deploymentTruth: "NOT_STARTED",
  postIntegrationVerificationPassed: true,
  deploymentDependenciesSatisfied: true,
  deploymentAuthorityPresent: true,
  productionWriterLeaseAvailable: true,
};

test("DEPLOY_STARTED refuses while the physical gate is unresolved", () => {
  const attempt = advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED", null, {
    context: { ...DEPLOYABLE, unresolvedRequiredGates: 1 },
  });
  assert.equal(attempt.ok, false, "the phone test is exactly what the gate is for");
  assert.equal(attempt.to, null);
  assert.match(attempt.missing.join("; "), /approval/);
  assert.ok(!legalEventsFrom("READY_FOR_DEPLOYMENT", null, {
    context: { ...DEPLOYABLE, unresolvedRequiredGates: 1 },
  }).includes("DEPLOY_STARTED"), "and it is not advertised as available either");
});

test("each deployment prerequisite is required on its own", () => {
  const withheld: Array<[string, Partial<MissionContextV1>]> = [
    ["the owner gate", { unresolvedRequiredGates: 1 }],
    ["post-integration verification", { postIntegrationVerificationPassed: false }],
    ["work-item dependencies", { deploymentDependenciesSatisfied: false }],
    ["deployment authority", { deploymentAuthorityPresent: false }],
    ["the production writer lease", { productionWriterLeaseAvailable: false }],
  ];
  for (const [name, over] of withheld) {
    const attempt = advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED", null, {
      context: { ...DEPLOYABLE, ...over },
    });
    assert.equal(attempt.ok, false, `${name} must be required`);
    assert.equal(attempt.missing.length, 1, `only ${name} is missing, so only it is reported`);
  }

  const permitted = advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED", null, { context: DEPLOYABLE });
  assert.equal(permitted.to, "DEPLOYING");
});

test("an unstated board never deploys", () => {
  // Two layers now, checked in this order. An unstated board does not say what production contains,
  // and that alone refuses — omitting the field used to be read as "no deployment has ever happened",
  // which was the one deployment fact that failed open.
  const nothing = advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED");
  assert.equal(nothing.ok, false);
  assert.equal(NOTHING_PROVEN.deploymentTruth, "UNRECORDED", "absence is its own value, not a borrowed one");
  assert.match(nothing.reason, /nothing on record says what this mission has done to production/);

  // With production stated but nothing else, every remaining prerequisite is still named on its own,
  // so a caller learns the whole list rather than being sent back one item at a time.
  const stated = advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED", null, {
    context: { deploymentTruth: "NOT_STARTED" },
  });
  assert.equal(stated.ok, false);
  assert.equal(stated.missing.length, 5, "nothing supplied is nothing established");
  assert.equal(NOTHING_PROVEN.deploymentAuthorityPresent, false);
});

// ---------------------------------------------------------------------------
// Integration is verified before it is deployable
// ---------------------------------------------------------------------------

test("INTEGRATING requires VERIFYING before deployment readiness", () => {
  assert.equal(advance("INTEGRATING", "INTEGRATION_COMPLETED").to, "VERIFYING",
    "merged code is code nobody has verified in its merged form");
  assert.equal(advance("INTEGRATING", "DEPLOY_STARTED").ok, false);
  assert.equal(advance("INTEGRATING", "GIT_MISMATCH").to, "BLOCKED");
});

test("post-integration verification is proved by the board, not announced by the event", () => {
  const claimed = advance("VERIFYING", "POST_INTEGRATION_VERIFIED");
  assert.equal(claimed.ok, false);
  assert.match(claimed.missing.join("; "), /integrated code/);

  const proved = advance("VERIFYING", "POST_INTEGRATION_VERIFIED", null, {
    context: { postIntegrationVerificationPassed: true },
  });
  assert.equal(proved.to, "READY_FOR_DEPLOYMENT");
});

// ---------------------------------------------------------------------------
// The table contains only real states
// ---------------------------------------------------------------------------

test("POST_DEPLOY_VERIFIED is an event and never a state", () => {
  assert.ok(!(MISSION_STATES as readonly string[]).includes("POST_DEPLOY_VERIFIED"));
  assert.ok((MISSION_EVENT_KINDS as readonly string[]).includes("POST_DEPLOY_VERIFIED"));
  // The row that used to be keyed on it was unreachable, so completion after a deployment ran through
  // POST_DEPLOY_VERIFY alone; that is now the only path, and it is checked.
  assert.equal(advance("POST_DEPLOY_VERIFY", "POST_DEPLOY_VERIFIED").to, "POST_DEPLOY_VERIFY");
  assert.equal(advance("DEPLOYING", "DEPLOY_COMPLETED").to, "POST_DEPLOY_VERIFY");
  assert.equal(advance("POST_DEPLOY_VERIFY", "MISSION_FAILED").to, "FAILED");
});

test("every declared destination is a real state", () => {
  for (const state of MISSION_STATES) {
    for (const event of MISSION_EVENT_KINDS) {
      const fixed = declaredTarget(state, event);
      if (fixed !== null) assert.ok((MISSION_STATES as readonly string[]).includes(fixed), `${state} + ${event}`);
    }
  }
});

// ---------------------------------------------------------------------------
// What is advertised is what happens
// ---------------------------------------------------------------------------

const SITUATIONS: Array<{ label: string; resumeState: MissionStateV1 | null; options: MissionAdvanceOptionsV1 }> = [
  { label: "nothing established", resumeState: null, options: {} },
  { label: "everything established", resumeState: "VERIFYING", options: { context: PROVEN } },
  {
    label: "a gate open while the board is busy",
    resumeState: "PLANNING",
    options: { context: { unresolvedRequiredGates: 1, independentWorkRemains: true } },
  },
  {
    label: "a gate open with nothing else runnable",
    resumeState: "PLANNING",
    options: { context: { unresolvedRequiredGates: 1, independentWorkRemains: false } },
  },
  { label: "returning from an interruption that found a block", resumeState: null, options: { interruptedFrom: "BLOCKED" } },
  { label: "a resume target that names an outcome", resumeState: "COMPLETED", options: { context: PROVEN } },
];

test("legalEventsFrom agrees with advance, for every state and every situation", () => {
  for (const state of MISSION_STATES) {
    for (const situation of SITUATIONS) {
      const advertised = legalEventsFrom(state, situation.resumeState, situation.options);
      const succeeding = MISSION_EVENT_KINDS.filter(
        (event) => advance(state, event, situation.resumeState, situation.options).ok,
      );
      assert.deepEqual(
        [...advertised].sort(),
        [...succeeding].sort(),
        `${state} under ${situation.label}: a dashboard must not offer a move that would be refused`,
      );

      for (const event of advertised) {
        const moved = advance(state, event, situation.resumeState, situation.options);
        assert.equal(moved.ok, true, `${state} + ${event} under ${situation.label}`);
        assert.notEqual(moved.to, null, `${state} + ${event} must land somewhere`);
        const fixed = declaredTarget(state, event);
        if (fixed !== null) {
          assert.equal(moved.to, fixed, `${state} + ${event} must land where the table says`);
        }
        assert.deepEqual(moved.missing, [], `${state} + ${event} succeeded, so nothing is outstanding`);
      }
    }
  }
});

test("a prerequisite changes what is advertised, because the context is the same one advance uses", () => {
  assert.ok(!legalEventsFrom("VERIFYING").includes("MISSION_COMPLETED"));
  assert.ok(legalEventsFrom("VERIFYING", null, { context: PROVEN }).includes("MISSION_COMPLETED"));
  assert.ok(!legalEventsFrom("READY_FOR_DEPLOYMENT").includes("DEPLOY_STARTED"));
  assert.ok(legalEventsFrom("READY_FOR_DEPLOYMENT", null, { context: DEPLOYABLE }).includes("DEPLOY_STARTED"));
});

test("a terminal mission advertises nothing under any situation", () => {
  for (const state of TERMINAL_STATES) {
    for (const situation of SITUATIONS) {
      assert.deepEqual(legalEventsFrom(state, situation.resumeState, situation.options), []);
      assert.equal(advance(state, "MISSION_INTERRUPTED", situation.resumeState, situation.options).ok, false);
    }
  }
});
