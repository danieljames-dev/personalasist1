/**
 * The orchestrator's refusals, which are the part that decides whether autonomy is safe.
 *
 * Running a milestone when everything is fine is the easy half. What these tests push on is the other
 * half: a malformed graph, an Owner gate, a missing verdict, a repeated failure, a worker that died
 * mid-flight, an effect that may or may not have landed. Each of those has a correct answer that is
 * *less* work rather than more, and a system that gets them wrong is more dangerous the more
 * autonomous it is.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MILESTONE_STATES_V1,
  ROADMAP_MILESTONE_SCHEMA_V1,
  ROADMAP_SCHEMA_V1,
  legalMilestoneTransition,
  roadmapFingerprint,
  validateMilestone,
  validateRoadmap,
  type MilestoneStateV1,
  type RoadmapEventV1,
  type RoadmapMilestoneV1,
  type RoadmapOwnerGateV1,
  type RoadmapV1,
  type TakeoverPacketV1,
} from "../src/roadmap-contracts.js";
import { readyMilestones, selectNextMilestone, validateRoadmapGraph } from "../src/roadmap-dag.js";
import {
  assessRunaway,
  evaluateVerification,
  requiredReviewLevel,
  resolveMilestoneAuthority,
  reviewSatisfied,
  type OwnerAuthorityRecordV1,
} from "../src/roadmap-policy.js";
import { createFileRoadmapStore, RoadmapIntegrityError, type RoadmapStoreV1 } from "../src/roadmap-store.js";
import {
  advanceRoadmap,
  buildTakeoverPacket,
  recoverRoadmap,
  type DispatchAttemptV1,
  type OrchestratorDepsV1,
} from "../src/roadmap-orchestrator.js";
import { createRoadmapPort } from "../src/roadmap-port.js";

const NOW = "2026-08-18T22:00:00Z";
const AUTH_ID = "TEST-MILESTONE-AUTH";

/** A store the tests fully control. Kept here rather than in src so it needs no production caller. */
function memoryStore(): RoadmapStoreV1 {
  let roadmap: RoadmapV1 | null = null;
  const milestones = new Map<string, RoadmapMilestoneV1>();
  const gates = new Map<string, RoadmapOwnerGateV1>();
  const packets = new Map<string, TakeoverPacketV1>();
  const events: RoadmapEventV1[] = [];
  return {
    loadRoadmap: () => roadmap,
    saveRoadmap(next) {
      roadmap = next;
    },
    listMilestones: () => [...milestones.values()].sort((a, b) => a.milestoneId.localeCompare(b.milestoneId)),
    loadMilestone: (id) => milestones.get(id) ?? null,
    saveMilestone(m) {
      const problem = validateMilestone(m);
      if (problem !== null) throw new Error(`invalid milestone: ${problem}`);
      milestones.set(m.milestoneId, m);
    },
    listGates: () => [...gates.values()],
    saveGate(g) {
      gates.set(g.gateId, g);
    },
    appendEvent(event) {
      const record = { schema: "aion.director.roadmapEvent.v1", sequence: events.length + 1, ...event } as RoadmapEventV1;
      events.push(record);
      return record;
    },
    listEvents: () => events,
    savePacket(p) {
      packets.set(p.milestoneId, p);
    },
    loadPacket: (id) => packets.get(id) ?? null,
  };
}

function milestone(overrides: Partial<RoadmapMilestoneV1> & { milestoneId: string }): RoadmapMilestoneV1 {
  return {
    schema: ROADMAP_MILESTONE_SCHEMA_V1,
    title: `Milestone ${overrides.milestoneId}`,
    objective: `do the ${overrides.milestoneId} work`,
    status: "PLANNED",
    priority: 100,
    dependencies: [],
    requiredCapabilities: ["CODING"],
    requiredContextCategories: [],
    authorityClass: "MILESTONE_AUTHORIZED",
    ownerAuthorizationId: AUTH_ID,
    sensitivityClass: "INTERNAL",
    allowedProviders: ["claude", "local"],
    spendCapUsd: 0,
    externalEffectClass: "REPOSITORY_REVERSIBLE",
    reversibilityClass: "REVERSIBLE",
    riskClasses: [],
    verificationPlan: { steps: [{ kind: "FOCUSED_TESTS", name: "focused tests", required: true }], declaredAt: NOW },
    independentReviewPolicy: "NONE",
    retryPolicy: { maxAttempts: 3, maxIdenticalFailures: 2, maxIdenticalPatches: 2, maxProviderSwitches: 4 },
    leaseTtlMs: 60_000,
    expectedArtifacts: [],
    completionCriteria: ["it is done"],
    attempts: 0,
    blockedReason: null,
    provenance: "test",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function authorityRecord(overrides: Partial<OwnerAuthorityRecordV1> = {}): OwnerAuthorityRecordV1 {
  return {
    schemaVersion: "aion.ownerStandingAuthority.v1",
    ownerAuthorizationId: AUTH_ID,
    milestoneId: "m1",
    allowedExternalEffects: ["CONTROLLED_PUSH"],
    allowedProviders: ["codex", "grok", "claude", "local"],
    spendingCeilingUsd: 0,
    productionWriterPermission: "NO",
    sensitiveDataPermission: "NO",
    destructiveActionPermission: "NO",
    state: "ACTIVE",
    expiresAtUtc: "",
    supersededBy: "",
    ...overrides,
  };
}

function roadmapOf(store: RoadmapStoreV1, ids: readonly string[]): RoadmapV1 {
  const roadmap: RoadmapV1 = {
    schema: ROADMAP_SCHEMA_V1,
    roadmapId: "test-roadmap",
    ownerGoalSet: ["prove the loop"],
    version: 1,
    state: "ACTIVE",
    currentMilestoneId: null,
    milestoneIds: [...ids],
    pendingOwnerGateIds: [],
    roadmapFingerprint: "seed",
    provenance: "test",
    createdAt: NOW,
    updatedAt: NOW,
  };
  store.saveRoadmap(roadmap);
  return roadmap;
}

const OK_DISPATCH: DispatchAttemptV1 = {
  provider: "local",
  succeeded: true,
  failureClass: "NONE",
  detail: "done",
  leaseId: "lease-1",
  ambiguousExternalEffect: false,
};

function deps(store: RoadmapStoreV1, overrides: Partial<OrchestratorDepsV1> = {}): OrchestratorDepsV1 {
  return {
    store,
    authorities: [authorityRecord()],
    now: () => NOW,
    dispatch: () => OK_DISPATCH,
    verify: (m) => m.verificationPlan.steps.map((s) => ({ step: s.name, result: "PASS" as const, detail: "ok" })),
    baselineSha: "ec00341",
    currentHead: "ec00341",
    currentDirectiveId: "TEST-DIRECTIVE",
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Contracts and state machine                                                 */
/* -------------------------------------------------------------------------- */

test("all fourteen milestone states exist and terminal ones are dead ends", () => {
  for (const required of [
    "PLANNED", "READY", "WAITING_DEPENDENCY", "WAITING_OWNER_AUTHORIZATION", "DISPATCHING", "RUNNING",
    "VALIDATING", "WAITING_REVIEW", "COMPLETED", "BLOCKED", "FAILED", "SUPERSEDED", "CANCELLED",
    "RECOVERY_REQUIRED",
  ]) {
    assert.ok(MILESTONE_STATES_V1.includes(required as MilestoneStateV1), `missing state ${required}`);
  }
  for (const terminal of ["COMPLETED", "CANCELLED", "SUPERSEDED"] as const) {
    for (const state of MILESTONE_STATES_V1) {
      assert.equal(legalMilestoneTransition(terminal, state), false, `${terminal} must not reach ${state}`);
    }
  }
});

test("illegal transitions are refused and legal ones permitted", () => {
  assert.equal(legalMilestoneTransition("READY", "DISPATCHING"), true);
  assert.equal(legalMilestoneTransition("VALIDATING", "COMPLETED"), true);
  assert.equal(legalMilestoneTransition("PLANNED", "COMPLETED"), false, "a milestone cannot skip execution");
  assert.equal(legalMilestoneTransition("PLANNED", "RUNNING"), false);
  assert.equal(legalMilestoneTransition("RECOVERY_REQUIRED", "RUNNING"), false, "ambiguity must not resolve by retrying");
});

test("malformed roadmap and milestone records are refused", () => {
  assert.match(String(validateRoadmap(null)), /not an object/);
  assert.match(String(validateRoadmap({ schema: "wrong" })), /schema/);
  assert.match(String(validateMilestone({ ...milestone({ milestoneId: "m1" }), status: "NOPE" })), /status/);
  assert.match(String(validateMilestone({ ...milestone({ milestoneId: "m1" }), completionCriteria: [] })), /completionCriteria/);
  const noPlan = { ...milestone({ milestoneId: "m1" }), verificationPlan: { steps: [], declaredAt: NOW } };
  assert.match(String(validateMilestone(noPlan)), /no steps/);
});

test("a milestone cannot depend on itself and the fingerprint tracks shape", () => {
  const self = { ...milestone({ milestoneId: "m1" }), dependencies: ["m1"] };
  assert.match(String(validateMilestone(self)), /depends on itself/);
  const a = milestone({ milestoneId: "m1" });
  const b = milestone({ milestoneId: "m2", dependencies: ["m1"] });
  const before = roadmapFingerprint([a, b]);
  assert.equal(roadmapFingerprint([b, a]), before, "order must not change the fingerprint");
  assert.notEqual(roadmapFingerprint([a, { ...b, status: "COMPLETED" }]), before);
});

/* -------------------------------------------------------------------------- */
/* DAG                                                                          */
/* -------------------------------------------------------------------------- */

test("the graph rejects cycles, duplicates, missing dependencies and contradictory readiness", () => {
  const cycle = validateRoadmapGraph([
    milestone({ milestoneId: "a", dependencies: ["b"] }),
    milestone({ milestoneId: "b", dependencies: ["a"] }),
  ]);
  assert.equal(cycle.ok, false);
  assert.ok(cycle.problems.some((p) => p.kind === "DEPENDENCY_CYCLE"));

  const duplicate = validateRoadmapGraph([milestone({ milestoneId: "a" }), milestone({ milestoneId: "a" })]);
  assert.ok(duplicate.problems.some((p) => p.kind === "DUPLICATE_MILESTONE_ID"));

  const missing = validateRoadmapGraph([milestone({ milestoneId: "a", dependencies: ["ghost"] })]);
  assert.ok(missing.problems.some((p) => p.kind === "MISSING_DEPENDENCY"));

  const contradictory = validateRoadmapGraph([
    milestone({ milestoneId: "a" }),
    milestone({ milestoneId: "b", dependencies: ["a"], status: "READY" }),
  ]);
  assert.ok(contradictory.problems.some((p) => p.kind === "CONTRADICTORY_READINESS"));

  const healthy = validateRoadmapGraph([
    milestone({ milestoneId: "a", status: "COMPLETED" }),
    milestone({ milestoneId: "b", dependencies: ["a"], status: "READY" }),
  ]);
  assert.equal(healthy.ok, true);
});

test("readiness follows dependencies, and a dead-end dependency is never ready", () => {
  const all = [
    milestone({ milestoneId: "done", status: "COMPLETED" }),
    milestone({ milestoneId: "child", dependencies: ["done"] }),
    milestone({ milestoneId: "waiting", dependencies: ["child"] }),
    milestone({ milestoneId: "cancelled", status: "CANCELLED" }),
    milestone({ milestoneId: "orphan", dependencies: ["cancelled"] }),
  ];
  const ready = readyMilestones(all).map((m) => m.milestoneId);
  assert.deepEqual(ready.sort(), ["child"]);
  assert.equal(ready.includes("waiting"), false, "a milestone whose parent has not run is not ready");
  assert.equal(ready.includes("orphan"), false, "a cancelled dependency can never complete");
});

test("in-flight milestones are never selected again", () => {
  for (const status of ["DISPATCHING", "RUNNING", "VALIDATING", "WAITING_REVIEW"] as const) {
    assert.equal(readyMilestones([milestone({ milestoneId: "m", status })]).length, 0, `${status} must not be re-selected`);
  }
});

test("selection is deterministic: priority, then unblocking weight, then id", () => {
  const all = [
    milestone({ milestoneId: "low", priority: 1 }),
    milestone({ milestoneId: "high", priority: 900 }),
    milestone({ milestoneId: "mid", priority: 100 }),
  ];
  assert.equal(selectNextMilestone(readyMilestones(all), all)?.milestoneId, "high");

  const blocking = [
    milestone({ milestoneId: "aaa", priority: 100 }),
    milestone({ milestoneId: "bbb", priority: 100 }),
    milestone({ milestoneId: "child", priority: 1, dependencies: ["bbb"] }),
  ];
  assert.equal(selectNextMilestone(readyMilestones(blocking), blocking)?.milestoneId, "bbb", "unblocking work wins ties");
  assert.equal(selectNextMilestone([], all), null);
});

/* -------------------------------------------------------------------------- */
/* Authority                                                                    */
/* -------------------------------------------------------------------------- */

test("authority allows a covered milestone and refuses everything it cannot prove", () => {
  const covered = milestone({ milestoneId: "m1" });
  assert.equal(resolveMilestoneAuthority(covered, [authorityRecord()], NOW).outcome, "ALLOW_STANDING");

  assert.equal(
    resolveMilestoneAuthority({ ...covered, ownerAuthorizationId: null }, [authorityRecord()], NOW).outcome,
    "REQUIRE_FRESH_OWNER_APPROVAL",
  );
  assert.equal(resolveMilestoneAuthority(covered, [], NOW).outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
  assert.equal(resolveMilestoneAuthority(covered, [authorityRecord({ state: "REVOKED" })], NOW).outcome, "DENY");
  assert.equal(
    resolveMilestoneAuthority(covered, [authorityRecord({ state: "SUSPENDED" })], NOW).outcome,
    "REQUIRE_FRESH_OWNER_APPROVAL",
  );
  assert.equal(
    resolveMilestoneAuthority(covered, [authorityRecord({ expiresAtUtc: "2026-01-01T00:00:00Z" })], NOW).outcome,
    "REQUIRE_FRESH_OWNER_APPROVAL",
  );
  assert.equal(
    resolveMilestoneAuthority(covered, [authorityRecord({ supersededBy: "OTHER" })], NOW).outcome,
    "REQUIRE_FRESH_OWNER_APPROVAL",
  );
});

test("high consequence, sensitive data, spend and external effects always need a fresh decision", () => {
  const base = milestone({ milestoneId: "m1" });
  const records = [authorityRecord()];
  assert.equal(
    resolveMilestoneAuthority({ ...base, authorityClass: "HIGH_CONSEQUENCE" }, records, NOW).outcome,
    "REQUIRE_FRESH_OWNER_APPROVAL",
  );
  assert.equal(
    resolveMilestoneAuthority({ ...base, sensitivityClass: "CONFIDENTIAL" }, records, NOW).outcome,
    "REQUIRE_FRESH_OWNER_APPROVAL",
  );
  assert.equal(resolveMilestoneAuthority({ ...base, spendCapUsd: 5 }, records, NOW).outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
  assert.equal(
    resolveMilestoneAuthority({ ...base, externalEffectClass: "IRREVERSIBLE_EXTERNAL" }, records, NOW).outcome,
    "REQUIRE_FRESH_OWNER_APPROVAL",
  );
  assert.equal(
    resolveMilestoneAuthority({ ...base, allowedProviders: ["codex", "grok", "claude", "local"] },
      [authorityRecord({ allowedProviders: ["local"] })], NOW).outcome,
    "REQUIRE_FRESH_OWNER_APPROVAL",
  );
});

/* -------------------------------------------------------------------------- */
/* Verification and review                                                      */
/* -------------------------------------------------------------------------- */

test("missing required evidence fails closed; absence is never a pass", () => {
  const plan = {
    steps: [
      { kind: "FOCUSED_TESTS" as const, name: "focused", required: true },
      { kind: "FULL_REPOSITORY_VERIFY" as const, name: "verify", required: true },
      { kind: "INTEGRATION_TESTS" as const, name: "optional", required: false },
    ],
    declaredAt: NOW,
  };
  const missing = evaluateVerification(plan, [{ step: "focused", result: "PASS", detail: "" }]);
  assert.equal(missing.passed, false);
  assert.deepEqual(missing.missing, ["verify"]);
  assert.match(missing.reason, /missing/);

  const failing = evaluateVerification(plan, [
    { step: "focused", result: "PASS", detail: "" },
    { step: "verify", result: "FAIL", detail: "" },
  ]);
  assert.equal(failing.passed, false);
  assert.deepEqual(failing.failed, ["verify"]);

  const passing = evaluateVerification(plan, [
    { step: "focused", result: "PASS", detail: "" },
    { step: "verify", result: "PASS", detail: "" },
  ]);
  assert.equal(passing.passed, true);
  assert.equal(evaluateVerification(plan, []).passed, false, "no evidence at all is a failure");
});

test("review escalates by risk and can never be talked down", () => {
  assert.equal(requiredReviewLevel(milestone({ milestoneId: "m" })), "NONE");
  assert.equal(requiredReviewLevel(milestone({ milestoneId: "m", riskClasses: ["ONE_WRITER_SEMANTICS"] })), "INDEPENDENT");
  assert.equal(requiredReviewLevel(milestone({ milestoneId: "m", riskClasses: ["AUTHORITY_OR_GOVERNANCE"] })), "INDEPENDENT");
  assert.equal(requiredReviewLevel(milestone({ milestoneId: "m", riskClasses: ["PRODUCTION_OR_EXTERNAL"] })), "ADVERSARIAL");
  assert.equal(
    requiredReviewLevel(milestone({ milestoneId: "m", independentReviewPolicy: "NONE", reversibilityClass: "IRREVERSIBLE" })),
    "ADVERSARIAL",
    "declaring NONE cannot lower the bar for irreversible work",
  );
  assert.equal(
    requiredReviewLevel(milestone({ milestoneId: "m", independentReviewPolicy: "ADVERSARIAL" })),
    "ADVERSARIAL",
    "an explicitly high policy is kept",
  );
});

test("a missing reviewer verdict is not a pass, and a weaker review does not satisfy a stronger one", () => {
  assert.equal(reviewSatisfied("NONE", null).satisfied, true);
  assert.equal(reviewSatisfied("INDEPENDENT", null).satisfied, false);
  assert.match(reviewSatisfied("INDEPENDENT", null).reason, /no verdict/);
  assert.equal(
    reviewSatisfied("ADVERSARIAL", { level: "FOCUSED", reviewer: "x", passed: true, detail: "" }).satisfied,
    false,
  );
  assert.equal(
    reviewSatisfied("INDEPENDENT", { level: "INDEPENDENT", reviewer: "x", passed: false, detail: "" }).satisfied,
    false,
  );
  assert.equal(
    reviewSatisfied("INDEPENDENT", { level: "ADVERSARIAL", reviewer: "x", passed: true, detail: "" }).satisfied,
    true,
  );
});

/* -------------------------------------------------------------------------- */
/* Runaway control                                                              */
/* -------------------------------------------------------------------------- */

test("retries stop on budget, identical failures, identical patches, ping-pong and no progress", () => {
  const m = milestone({ milestoneId: "m" });
  const base = {
    attempts: 0,
    failureSignatures: [] as string[],
    patchSignatures: [] as string[],
    providerTrail: [] as ("claude" | "local")[],
    progressSignatures: [] as string[],
    ambiguousExternalEffect: false,
  };
  assert.equal(assessRunaway(m, base).stop, false);
  assert.equal(assessRunaway(m, { ...base, attempts: 3 }).nextState, "BLOCKED");
  assert.match(String(assessRunaway(m, { ...base, failureSignatures: ["e", "e"] }).reason), /same failure/);
  assert.match(String(assessRunaway(m, { ...base, patchSignatures: ["p", "p"] }).reason), /same patch/);
  assert.match(
    String(assessRunaway(m, { ...base, providerTrail: ["claude", "local", "claude", "local"] }).reason),
    /ping-pong/,
  );
  assert.match(String(assessRunaway(m, { ...base, progressSignatures: ["same", "same"] }).reason), /no observable progress/);
});

test("an ambiguous external effect routes to RECOVERY_REQUIRED, never to another attempt", () => {
  const assessment = assessRunaway(milestone({ milestoneId: "m" }), {
    attempts: 0,
    failureSignatures: [],
    patchSignatures: [],
    providerTrail: [],
    progressSignatures: [],
    ambiguousExternalEffect: true,
  });
  assert.equal(assessment.stop, true);
  assert.equal(assessment.nextState, "RECOVERY_REQUIRED");
  assert.match(assessment.reason, /may have landed/);
});

/* -------------------------------------------------------------------------- */
/* The loop                                                                     */
/* -------------------------------------------------------------------------- */

test("a safe authorised chain runs end to end with zero Owner prompts", () => {
  const store = memoryStore();
  store.saveMilestone(milestone({ milestoneId: "first", priority: 500 }));
  store.saveMilestone(milestone({ milestoneId: "second", dependencies: ["first"], priority: 100 }));
  roadmapOf(store, ["first", "second"]);

  const result = advanceRoadmap(deps(store));

  assert.deepEqual([...result.completed], ["first", "second"], "the dependent milestone ran after its parent");
  assert.equal(result.ownerPrompts, 0);
  assert.equal(result.stopReason, "NO_ELIGIBLE_WORK");
  assert.equal(store.loadMilestone("first")?.status, "COMPLETED");
  assert.equal(store.loadMilestone("second")?.status, "COMPLETED");

  const types = store.listEvents().map((e) => e.type);
  for (const expected of [
    "AUTHORITY_ALLOWED", "DISPATCH_REQUESTED", "PROVIDER_SELECTED", "WORKER_STARTED",
    "VALIDATION_STARTED", "VALIDATION_PASSED", "MILESTONE_COMPLETED", "DEPENDENCY_SATISFIED",
  ]) {
    assert.ok(types.includes(expected as RoadmapEventV1["type"]), `ledger is missing ${expected}`);
  }
  const sequences = store.listEvents().map((e) => e.sequence);
  assert.deepEqual(sequences, sequences.map((_, i) => i + 1), "event sequence must be contiguous");
});

test("an Owner-gated milestone waits while independent safe work continues", () => {
  const store = memoryStore();
  store.saveMilestone(milestone({ milestoneId: "gated", priority: 900, sensitivityClass: "CONFIDENTIAL" }));
  store.saveMilestone(milestone({ milestoneId: "safe", priority: 100 }));
  roadmapOf(store, ["gated", "safe"]);

  const result = advanceRoadmap(deps(store));

  assert.deepEqual([...result.gated], ["gated"]);
  assert.deepEqual([...result.completed], ["safe"], "an unrelated safe milestone still ran");
  assert.equal(store.loadMilestone("gated")?.status, "WAITING_OWNER_AUTHORIZATION");
  assert.equal(result.ownerPrompts, 0, "gates are persisted, not asked interactively");

  const gates = store.listGates();
  assert.equal(gates.length, 1);
  assert.equal(gates[0]?.milestoneId, "gated");
  assert.equal(gates[0]?.status, "OPEN");
  assert.ok((gates[0]?.exactScope.length ?? 0) >= 3, "a gate states exactly what it is asking for");
});

test("a denied milestone is blocked and never dispatched", () => {
  const store = memoryStore();
  store.saveMilestone(milestone({ milestoneId: "denied" }));
  roadmapOf(store, ["denied"]);
  let dispatched = 0;
  const result = advanceRoadmap(
    deps(store, {
      authorities: [authorityRecord({ state: "REVOKED" })],
      dispatch: () => {
        dispatched += 1;
        return OK_DISPATCH;
      },
    }),
  );
  assert.deepEqual([...result.blocked], ["denied"]);
  assert.equal(dispatched, 0, "a denied milestone must never reach the dispatcher");
  assert.equal(store.loadMilestone("denied")?.status, "BLOCKED");
  assert.ok(store.listEvents().some((e) => e.type === "AUTHORITY_DENIED"));
});

test("a malformed graph stops the loop before anything is dispatched", () => {
  const store = memoryStore();
  store.saveMilestone(milestone({ milestoneId: "a", dependencies: ["b"] }));
  store.saveMilestone(milestone({ milestoneId: "b", dependencies: ["a"] }));
  roadmapOf(store, ["a", "b"]);
  let dispatched = 0;
  const result = advanceRoadmap(deps(store, { dispatch: () => { dispatched += 1; return OK_DISPATCH; } }));
  assert.equal(result.stopReason, "MALFORMED_GRAPH");
  assert.equal(dispatched, 0);
});

test("a failed dispatch marks the milestone failed and blocks its child", () => {
  const store = memoryStore();
  store.saveMilestone(milestone({ milestoneId: "parent", priority: 500 }));
  store.saveMilestone(milestone({ milestoneId: "child", dependencies: ["parent"] }));
  roadmapOf(store, ["parent", "child"]);

  const result = advanceRoadmap(
    deps(store, {
      dispatch: () => ({ provider: "local", succeeded: false, failureClass: "FAILED", detail: "worker died", leaseId: null, ambiguousExternalEffect: false }),
    }),
  );

  assert.deepEqual([...result.failed], ["parent"]);
  assert.equal(store.loadMilestone("parent")?.status, "FAILED");
  assert.equal(store.loadMilestone("child")?.status, "PLANNED", "the child never became ready");
  assert.equal(result.completed.length, 0);
});

test("a dispatch with an ambiguous effect goes to RECOVERY_REQUIRED rather than FAILED", () => {
  const store = memoryStore();
  store.saveMilestone(milestone({ milestoneId: "m" }));
  roadmapOf(store, ["m"]);
  advanceRoadmap(
    deps(store, {
      dispatch: () => ({ provider: "local", succeeded: false, failureClass: "AMBIGUOUS_EFFECT_BLOCKED", detail: "unclear", leaseId: null, ambiguousExternalEffect: true }),
    }),
  );
  assert.equal(store.loadMilestone("m")?.status, "RECOVERY_REQUIRED");
});

test("failed verification blocks completion, and a missing verdict blocks it too", () => {
  const failing = memoryStore();
  failing.saveMilestone(milestone({ milestoneId: "m" }));
  roadmapOf(failing, ["m"]);
  advanceRoadmap(deps(failing, { verify: () => [] }));
  assert.equal(failing.loadMilestone("m")?.status, "FAILED");
  assert.ok(failing.listEvents().some((e) => e.type === "VALIDATION_FAILED"));

  const unreviewed = memoryStore();
  unreviewed.saveMilestone(milestone({ milestoneId: "m", riskClasses: ["AUTHORITY_OR_GOVERNANCE"] }));
  roadmapOf(unreviewed, ["m"]);
  advanceRoadmap(deps(unreviewed));
  assert.equal(unreviewed.loadMilestone("m")?.status, "BLOCKED", "no verdict is not a pass");
  assert.ok(unreviewed.listEvents().some((e) => e.type === "REVIEW_FAILED"));
});

test("a risky milestone completes when an adequate independent verdict is recorded", () => {
  const store = memoryStore();
  store.saveMilestone(milestone({ milestoneId: "m", riskClasses: ["PERSISTENCE_OR_RECOVERY"] }));
  roadmapOf(store, ["m"]);
  const result = advanceRoadmap(
    deps(store, { review: () => ({ level: "INDEPENDENT", reviewer: "grok", passed: true, detail: "checked" }) }),
  );
  assert.deepEqual([...result.completed], ["m"]);
  assert.ok(store.listEvents().some((e) => e.type === "REVIEW_REQUIRED"));
  assert.ok(store.listEvents().some((e) => e.type === "REVIEW_PASSED"));
});

test("a trivial milestone is not sent for expensive review", () => {
  const store = memoryStore();
  store.saveMilestone(milestone({ milestoneId: "docs" }));
  roadmapOf(store, ["docs"]);
  let reviews = 0;
  advanceRoadmap(deps(store, { review: () => { reviews += 1; return null; } }));
  assert.equal(reviews, 0, "no risk classes means no review call");
  assert.equal(store.loadMilestone("docs")?.status, "COMPLETED");
});

test("an exhausted retry budget blocks instead of dispatching again", () => {
  const store = memoryStore();
  store.saveMilestone(milestone({ milestoneId: "m", attempts: 3 }));
  roadmapOf(store, ["m"]);
  let dispatched = 0;
  const result = advanceRoadmap(
    deps(store, {
      historyFor: () => ({ attempts: 3, failureSignatures: [], patchSignatures: [], providerTrail: [], progressSignatures: [], ambiguousExternalEffect: false }),
      dispatch: () => { dispatched += 1; return OK_DISPATCH; },
    }),
  );
  assert.deepEqual([...result.blocked], ["m"]);
  assert.equal(dispatched, 0);
});

test("the loop stops at its step ceiling rather than spinning", () => {
  const store = memoryStore();
  for (let i = 0; i < 5; i += 1) store.saveMilestone(milestone({ milestoneId: `m${i}` }));
  roadmapOf(store, ["m0", "m1", "m2", "m3", "m4"]);
  const result = advanceRoadmap(deps(store, { maxSteps: 2 }));
  assert.equal(result.stopReason, "STEP_LIMIT_REACHED");
  assert.equal(result.steps, 2);
});

test("a paused roadmap runs nothing", () => {
  const store = memoryStore();
  store.saveMilestone(milestone({ milestoneId: "m" }));
  const roadmap = roadmapOf(store, ["m"]);
  store.saveRoadmap({ ...roadmap, state: "PAUSED" });
  const result = advanceRoadmap(deps(store));
  assert.equal(result.stopReason, "ROADMAP_NOT_ACTIVE");
  assert.equal(store.loadMilestone("m")?.status, "PLANNED");
});

test("no roadmap means no work rather than an invented one", () => {
  assert.equal(advanceRoadmap(deps(memoryStore())).stopReason, "NO_ROADMAP");
});

/* -------------------------------------------------------------------------- */
/* Restart recovery and takeover                                                */
/* -------------------------------------------------------------------------- */

test("restart recovers in-flight work and never re-runs a completed milestone", () => {
  const store = memoryStore();
  store.saveMilestone(milestone({ milestoneId: "done", status: "COMPLETED" }));
  store.saveMilestone(milestone({ milestoneId: "stuck", status: "RUNNING" }));
  roadmapOf(store, ["done", "stuck"]);

  const recovered = recoverRoadmap(deps(store));
  assert.deepEqual([...recovered], ["stuck"]);
  assert.equal(store.loadMilestone("stuck")?.status, "FAILED");
  assert.equal(store.loadMilestone("done")?.status, "COMPLETED", "a completed milestone is never reopened");
  assert.ok(store.listEvents().some((e) => e.type === "RECOVERY_STARTED"));
  assert.ok(store.listEvents().some((e) => e.type === "RECOVERY_COMPLETED"));
});

test("restart blocks recovery when the interrupted work had an external effect", () => {
  const store = memoryStore();
  store.saveMilestone(milestone({ milestoneId: "pushy", status: "RUNNING", externalEffectClass: "IRREVERSIBLE_EXTERNAL" }));
  roadmapOf(store, ["pushy"]);
  recoverRoadmap(deps(store));
  assert.equal(store.loadMilestone("pushy")?.status, "RECOVERY_REQUIRED");
});

test("a completed chain is not executed twice when the loop runs again", () => {
  const store = memoryStore();
  store.saveMilestone(milestone({ milestoneId: "first", priority: 500 }));
  store.saveMilestone(milestone({ milestoneId: "second", dependencies: ["first"] }));
  roadmapOf(store, ["first", "second"]);
  let dispatches = 0;
  const counting = deps(store, { dispatch: () => { dispatches += 1; return OK_DISPATCH; } });

  advanceRoadmap(counting);
  assert.equal(dispatches, 2);
  const second = advanceRoadmap(counting);
  assert.equal(dispatches, 2, "a second pass must not re-dispatch completed milestones");
  assert.equal(second.completed.length, 0);
  assert.equal(second.stopReason, "NO_ELIGIBLE_WORK");
});

test("the takeover packet carries everything a fresh worker needs", () => {
  const store = memoryStore();
  const m = milestone({ milestoneId: "m", riskClasses: ["ONE_WRITER_SEMANTICS"], expectedArtifacts: ["out.txt"] });
  store.saveMilestone(m);
  const roadmap = roadmapOf(store, ["m"]);
  const packet = buildTakeoverPacket(m, roadmap, deps(store, { knownDefects: ["a known flake"] }));

  assert.equal(packet.milestoneId, "m");
  assert.equal(packet.baselineSha, "ec00341");
  assert.equal(packet.currentDirectiveId, "TEST-DIRECTIVE");
  assert.equal(packet.ownerAuthorizationId, AUTH_ID);
  assert.equal(packet.reviewRequirement, "INDEPENDENT");
  assert.deepEqual([...packet.verificationRequirements], ["focused tests"]);
  assert.deepEqual([...packet.knownDefects], ["a known flake"]);
  assert.ok(packet.nextExactAction.includes("m"));
  // Nothing in the packet points back at a conversation.
  assert.equal(JSON.stringify(packet).toLowerCase().includes("chat"), false);
});

/* -------------------------------------------------------------------------- */
/* Durable store                                                                */
/* -------------------------------------------------------------------------- */

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "aion-roadmap-"));
}

test("roadmap, milestones, gates, packets and events survive a reload", () => {
  const root = scratch();
  try {
    const store = createFileRoadmapStore(root);
    store.saveMilestone(milestone({ milestoneId: "a", status: "COMPLETED" }));
    store.saveMilestone(milestone({ milestoneId: "b", dependencies: ["a"] }));
    roadmapOf(store, ["a", "b"]);
    store.saveGate({
      schema: "aion.director.ownerGate.v1",
      gateId: "gate-b",
      milestoneId: "b",
      reason: "needs a decision",
      authorityRequested: AUTH_ID,
      exactScope: ["one thing only"],
      riskClasses: [],
      relatedDirectiveId: null,
      status: "OPEN",
      createdAt: NOW,
    });
    store.appendEvent({ type: "ROADMAP_CREATED", roadmapId: "test-roadmap", milestoneId: null, detail: "seed", at: NOW });
    store.appendEvent({ type: "MILESTONE_READY", roadmapId: "test-roadmap", milestoneId: "b", detail: "ok", at: NOW });

    const reopened = createFileRoadmapStore(root);
    assert.equal(reopened.loadRoadmap()?.roadmapId, "test-roadmap");
    assert.deepEqual(reopened.listMilestones().map((m) => m.milestoneId), ["a", "b"]);
    assert.equal(reopened.loadMilestone("a")?.status, "COMPLETED");
    assert.equal(reopened.listGates().length, 1);
    assert.deepEqual(reopened.listEvents().map((e) => e.sequence), [1, 2]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a corrupt record raises rather than quietly shrinking the graph", () => {
  const root = scratch();
  try {
    const store = createFileRoadmapStore(root);
    store.saveMilestone(milestone({ milestoneId: "good" }));
    mkdirSync(join(root, "milestones"), { recursive: true });
    writeFileSync(join(root, "milestones", "broken.json"), "{ not json", "utf8");
    assert.throws(() => createFileRoadmapStore(root).listMilestones(), RoadmapIntegrityError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a tampered event ledger is detected instead of read as a shorter history", () => {
  const root = scratch();
  try {
    const store = createFileRoadmapStore(root);
    for (const detail of ["one", "two", "three"]) {
      store.appendEvent({ type: "MILESTONE_READY", roadmapId: "r", milestoneId: "m", detail, at: NOW });
    }
    assert.equal(store.listEvents().length, 3);

    const path = join(root, "events.jsonl");
    const lines = readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "");
    writeFileSync(path, `${[lines[0], lines[2]].join("\n")}\n`, "utf8");
    assert.throws(() => createFileRoadmapStore(root).listEvents(), RoadmapIntegrityError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* -------------------------------------------------------------------------- */
/* Port                                                                         */
/* -------------------------------------------------------------------------- */

test("the port reports status, gates and workers, and can pause the roadmap", () => {
  const store = memoryStore();
  store.saveMilestone(milestone({ milestoneId: "safe", priority: 100 }));
  store.saveMilestone(milestone({ milestoneId: "gated", priority: 900, sensitivityClass: "CONFIDENTIAL" }));
  roadmapOf(store, ["safe", "gated"]);
  const port = createRoadmapPort({ ...deps(store), dispatch: () => OK_DISPATCH });

  assert.equal(port.getRoadmapStatus().exists, true);
  assert.equal(port.getRoadmapStatus().readyCount, 2);
  assert.equal(port.getReadyMilestones().length, 2);
  assert.equal(port.getPendingOwnerGates().length, 0);

  const result = port.continueRoadmap();
  assert.deepEqual([...result.completed], ["safe"]);
  assert.equal(port.getPendingOwnerGates().length, 1);
  assert.equal(port.getCurrentMilestone()?.milestoneId, "safe");
  assert.equal(port.getActiveWorkers().length, 0, "nothing is left in flight after a clean pass");

  assert.equal(port.pauseRoadmap()?.state, "PAUSED");
  assert.equal(port.continueRoadmap().stopReason, "ROADMAP_NOT_ACTIVE");
  assert.equal(port.resumeRoadmap()?.state, "ACTIVE");
});

test("the port seeds a roadmap once and never re-seeds over existing state", () => {
  const store = memoryStore();
  const port = createRoadmapPort({ ...deps(store), dispatch: () => OK_DISPATCH });
  const seed = {
    roadmapId: "seeded",
    ownerGoalSet: ["finish owner context"],
    provenance: "durable AION state",
    milestones: [
      {
        milestoneId: "history-access",
        title: "Owner Context History Access",
        objective: "ingest approved history",
        priority: 500,
        dependencies: [],
        ownerAuthorizationId: null,
        authorityClass: "MILESTONE_AUTHORIZED" as const,
        externalEffectClass: "NONE" as const,
        riskClasses: ["SENSITIVE_DATA" as const],
        reviewPolicy: "INDEPENDENT" as const,
        provenance: "deferred pending directive",
      },
    ],
  };
  const first = port.ensureRoadmap(seed);
  assert.equal(first.roadmapId, "seeded");
  assert.equal(store.listMilestones().length, 1);

  store.saveMilestone({ ...store.listMilestones()[0]!, status: "COMPLETED" });
  const again = port.ensureRoadmap(seed);
  assert.equal(again.roadmapId, "seeded");
  assert.equal(store.loadMilestone("history-access")?.status, "COMPLETED", "re-seeding must not reset progress");
});

test("the port cannot satisfy its own Owner gate", () => {
  const port = createRoadmapPort({ ...deps(memoryStore()), dispatch: () => OK_DISPATCH });
  const surface = Object.keys(port);
  for (const forbidden of ["approveGate", "satisfyGate", "setAuthority", "forceComplete", "grantAuthority"]) {
    assert.equal(surface.includes(forbidden), false, `the port must not expose ${forbidden}`);
  }
});

/* -------------------------------------------------------------------------- */
/* Durable governance truth this milestone must not disturb                     */
/* -------------------------------------------------------------------------- */

test("Provider Bridge V1 and MVA Real Dispatch V1 are still the routing and dispatch layers", async () => {
  const bridge = await import("../src/provider-bridge.js");
  const dispatch = await import("../src/mva-dispatch.js");
  assert.equal(typeof bridge.routeJob, "function");
  assert.equal(typeof bridge.executeWithFailover, "function");
  assert.equal(typeof dispatch.submitJob, "function");

  // The orchestrator must not have grown its own router.
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
  const orchestrator = readFileSync(join(srcDir, "roadmap-orchestrator.ts"), "utf8");
  assert.equal(orchestrator.includes("routeJob("), false, "the roadmap must not choose providers itself");
  assert.ok(orchestrator.includes("submitJob("), "dispatch goes through MVA Real Dispatch");
});
