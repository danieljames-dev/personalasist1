/**
 * The autonomy kernel: standing objectives across a portfolio of Owner businesses.
 *
 * These tests are written against the properties the Owner asked for rather than the shape of the
 * implementation, because the shape is the part most likely to change. The load-bearing ones:
 * useful business work outranks speculative infrastructure; a step without verification evidence is
 * not a completion; a gate stops one branch and not the portfolio; a restart resumes rather than
 * repeats; and nothing anywhere invents a fact about a business the Owner has not described.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildStandingObjective,
  entitledValueClass,
  valueRank,
  type AutonomyStepV1,
  type StandingObjectiveV1,
  type ValueClassV1,
} from "../src/autonomy-contracts.js";
import {
  assessBusinessKnowledge,
  buildBusinessWorkspace,
  businessIdFor,
  type BusinessWorkspaceV1,
} from "../src/business-workspace.js";
import { createFileAutonomyStore, type AutonomyStoreV1 } from "../src/autonomy-store.js";
import { scheduleNext } from "../src/autonomy-scheduler.js";
import {
  autonomyStatus,
  runAutonomyKernel,
  type KernelDepsV1,
  type StepAttemptV1,
  type StepEvidenceV1,
} from "../src/autonomy-kernel.js";
import { createDurableExperienceLedger, preferenceStrength } from "../src/experience-ledger.js";
import { buildOwnerGoalIntent } from "../src/owner-goal-intake.js";

const SHA = "c4ab9c36b12c9e2ea9a514be287cf35bcf9b373c";
const NOW = "2026-08-21T16:39:24Z";

const temps: string[] = [];
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "aion-autonomy-"));
  temps.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
/* Fixtures — the Owner's real businesses, with nothing invented about them     */
/* -------------------------------------------------------------------------- */

const OWNER_BUSINESSES = ["Compassionate Choice", "LocalFinds", "Talk to Caleb", "AIService Co"];

function business(name: string, overrides: Partial<BusinessWorkspaceV1> = {}): BusinessWorkspaceV1 {
  return {
    ...buildBusinessWorkspace({ canonicalName: name, provenance: "Owner direction 2026-08-21", now: NOW }),
    ...overrides,
  };
}

function objective(businessId: string, text: string, ownerPriority: number | null = null): StandingObjectiveV1 {
  const intent = buildOwnerGoalIntent({ text, provenance: "Owner direction 2026-08-21", now: NOW, milestones: [] });
  return buildStandingObjective({ intent, businessId, now: NOW, ownerPriority });
}

function step(input: Partial<AutonomyStepV1> & Pick<AutonomyStepV1, "stepId" | "objectiveId" | "businessId">): AutonomyStepV1 {
  return {
    schema: "aion.director.autonomyStep.v1",
    title: input.stepId,
    valueClass: "REAL_USER_OR_BUSINESS_VALUE",
    evidenceRefs: [],
    effectScope: "LOCAL_SHADOW",
    status: "READY",
    dependsOn: [],
    expectedValue: 100,
    confidence: 0.8,
    ownerTimeMinutes: 0,
    requiredCapabilities: [],
    attempts: 0,
    maxAttempts: 2,
    blockedReason: null,
    effectFingerprint: `fp:${input.stepId}`,
    createdAt: NOW,
    updatedAt: NOW,
    ...input,
  } as AutonomyStepV1;
}

function seed(store: AutonomyStoreV1, businesses: BusinessWorkspaceV1[], objectives: StandingObjectiveV1[], steps: AutonomyStepV1[]) {
  for (const b of businesses) store.saveBusiness(b);
  for (const o of objectives) store.saveObjective(o);
  for (const s of steps) store.saveStep(s);
}

/** A dispatcher that succeeds, paired with a verifier that actually observes something. */
const succeeds: StepAttemptV1 = {
  provider: "local", claim: "did the thing", ownerGate: null, blocked: null,
  failure: null, latencyMs: 12, tokens: 40, costUsd: 0,
};
const observed: StepEvidenceV1[] = [{ kind: "ARTIFACT", detail: "analysis written", observed: true }];

function deps(store: AutonomyStoreV1, root: string, over: Partial<KernelDepsV1> = {}): KernelDepsV1 {
  return {
    store,
    ledger: createDurableExperienceLedger(root),
    now: () => NOW,
    currentSha: SHA,
    dispatch: () => succeeds,
    verify: () => observed,
    availableCapabilities: [],
    outwardAuthorized: false,
    ...over,
  };
}

/* -------------------------------------------------------------------------- */
/* Business fact discipline                                                    */
/* -------------------------------------------------------------------------- */

test("a business the Owner named carries no invented facts about what it does", () => {
  for (const name of OWNER_BUSINESSES) {
    const workspace = business(name);
    assert.equal(workspace.canonicalName, name, "the Owner's own name, unaltered");
    assert.equal(workspace.ownerControlled, true);
    assert.equal(workspace.category, null, `${name}: category must stay null until the Owner says otherwise`);
    const knowledge = assessBusinessKnowledge(workspace);
    assert.equal(knowledge.knowsWhatItDoes, false);
    assert.match(knowledge.reason, /discovery is the only sound first step/u);
  }
});

test("the workspace record has no field that invites a guess", () => {
  const keys = Object.keys(business("Compassionate Choice")).sort();
  assert.deepEqual(keys, [
    "businessId", "canonicalName", "category", "createdAt",
    "ownerControlled", "provenance", "schema", "status", "updatedAt",
  ], "adding a business-model or customer field here would create a form, and forms get filled in");
});

test("a business needs provenance before it exists", () => {
  assert.throws(() => buildBusinessWorkspace({ canonicalName: "X", provenance: "  ", now: NOW }), /provenance/u);
  assert.equal(businessIdFor("Talk to Caleb"), "talk-to-caleb");
});

test("an objective never gains success criteria the Owner did not state", () => {
  const bare = objective("localfinds", "understand this business and identify the highest-value next actions");
  assert.deepEqual(bare.successCriteria, [], "intake found none, so the objective has none");
  assert.equal(bare.ownerPriority, null, "absent priority stays absent rather than becoming zero");
  assert.equal(bare.ownerText, "understand this business and identify the highest-value next actions");
});

/* -------------------------------------------------------------------------- */
/* The priority rule                                                           */
/* -------------------------------------------------------------------------- */

test("useful business work beats speculative infrastructure when both are eligible", () => {
  const root = tempRoot();
  const store = createFileAutonomyStore(root);
  seed(store,
    [business("LocalFinds"), business("AION", { businessId: "aion", canonicalName: "AION" })],
    [objective("localfinds", "find resale opportunities"), objective("aion", "improve aion")],
    [
      step({ stepId: "infra", objectiveId: "aion:" + objective("aion", "improve aion").goalId, businessId: "aion", valueClass: "SPECULATIVE_INFRASTRUCTURE", expectedValue: 10_000, confidence: 1 }),
      step({ stepId: "biz", objectiveId: "localfinds:" + objective("localfinds", "find resale opportunities").goalId, businessId: "localfinds", valueClass: "REAL_USER_OR_BUSINESS_VALUE", expectedValue: 1, confidence: 0.1 }),
    ]);

  const schedule = scheduleNext({
    businesses: store.businesses(), objectives: store.objectives(), steps: store.steps(),
    availableCapabilities: [], completedFingerprints: [],
  });
  assert.equal(schedule.selected?.step.stepId, "biz",
    "a 10,000-point infrastructure task must not outrank a 1-point business task");
  assert.match(schedule.selectionReason, /REAL_USER_OR_BUSINESS_VALUE/u);
});

test("proven and measured classes collapse to speculative without evidence", () => {
  const claimed = entitledValueClass({ valueClass: "PROVEN_CAPABILITY_BLOCKER", evidenceRefs: [] });
  assert.equal(claimed.valueClass, "SPECULATIVE_INFRASTRUCTURE");
  assert.equal(claimed.downgraded, true);
  assert.match(claimed.reason, /no evidence/u);

  const backed = entitledValueClass({
    valueClass: "PROVEN_CAPABILITY_BLOCKER",
    evidenceRefs: ["CAMPAIGN-03-V0-4-FINDING-4.md"],
  });
  assert.equal(backed.valueClass, "PROVEN_CAPABILITY_BLOCKER");
  assert.equal(backed.downgraded, false);
});

test("the value ordering is the policy the Owner stated", () => {
  const order: ValueClassV1[] = [
    "REAL_USER_OR_BUSINESS_VALUE", "PROVEN_CAPABILITY_BLOCKER",
    "MEASURED_RELIABILITY_DEFECT", "SPECULATIVE_INFRASTRUCTURE",
  ];
  const ranks = order.map(valueRank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
});

test("a large unevidenced estimate does not beat a smaller evidenced one", () => {
  const root = tempRoot();
  const store = createFileAutonomyStore(root);
  const obj = objective("localfinds", "find resale opportunities");
  seed(store, [business("LocalFinds")], [obj], [
    step({ stepId: "dreamy", objectiveId: obj.objectiveId, businessId: "localfinds", expectedValue: 50_000, confidence: 0.01 }),
    step({ stepId: "grounded", objectiveId: obj.objectiveId, businessId: "localfinds", expectedValue: 900, confidence: 0.9 }),
  ]);
  const schedule = scheduleNext({
    businesses: store.businesses(), objectives: store.objectives(), steps: store.steps(),
    availableCapabilities: [], completedFingerprints: [],
  });
  assert.equal(schedule.selected?.step.stepId, "grounded", "confidence discounts the estimate; fiction does not win");
});

/* -------------------------------------------------------------------------- */
/* Verification is mandatory                                                   */
/* -------------------------------------------------------------------------- */

test("a step that claims success with no observed evidence is not a completion", () => {
  const root = tempRoot();
  const store = createFileAutonomyStore(root);
  const obj = objective("localfinds", "find resale opportunities");
  seed(store, [business("LocalFinds")], [obj], [
    step({ stepId: "s1", objectiveId: obj.objectiveId, businessId: "localfinds", maxAttempts: 1 }),
  ]);

  const run = runAutonomyKernel(deps(store, root, { verify: () => [] }));
  assert.deepEqual(run.completed, []);
  assert.deepEqual(run.failed, ["s1"]);
  assert.match(run.steps[0]!.detail, /no verification evidence was observed/u);
  assert.equal(store.outcomes()[0]!.verdict, "FAILED");
});

test("evidence that was looked for but not observed is still not evidence", () => {
  const root = tempRoot();
  const store = createFileAutonomyStore(root);
  const obj = objective("localfinds", "find resale opportunities");
  seed(store, [business("LocalFinds")], [obj], [
    step({ stepId: "s1", objectiveId: obj.objectiveId, businessId: "localfinds", maxAttempts: 1 }),
  ]);
  const run = runAutonomyKernel(deps(store, root, {
    verify: () => [{ kind: "ARTIFACT", detail: "expected file", observed: false }],
  }));
  assert.deepEqual(run.failed, ["s1"]);
});

/* -------------------------------------------------------------------------- */
/* Self-continue, gate isolation, bounds                                       */
/* -------------------------------------------------------------------------- */

test("finishing one business's step leads to another business's step with no prompt", () => {
  const root = tempRoot();
  const store = createFileAutonomyStore(root);
  const cc = objective("compassionate-choice", "understand this business and identify next actions");
  const lf = objective("localfinds", "find resale opportunities");
  seed(store, [business("Compassionate Choice"), business("LocalFinds")], [cc, lf], [
    step({ stepId: "cc-1", objectiveId: cc.objectiveId, businessId: "compassionate-choice", expectedValue: 200 }),
    step({ stepId: "lf-1", objectiveId: lf.objectiveId, businessId: "localfinds", expectedValue: 100 }),
  ]);

  const run = runAutonomyKernel(deps(store, root));
  assert.deepEqual(run.completed, ["cc-1", "lf-1"]);
  assert.deepEqual([...run.businessesWorked].sort(), ["compassionate-choice", "localfinds"]);
  assert.equal(run.ownerPrompts, 0, "ordinary in-scope work needs no Owner prompt");
  assert.equal(run.stopReason, "NOTHING_ELIGIBLE");
});

test("a gate on one business does not stop the others", () => {
  const root = tempRoot();
  const store = createFileAutonomyStore(root);
  const cc = objective("compassionate-choice", "contact a customer");
  const lf = objective("localfinds", "analyse a resale opportunity");
  const tc = objective("talk-to-caleb", "understand this business");
  seed(store,
    [business("Compassionate Choice"), business("LocalFinds"), business("Talk to Caleb")],
    [cc, lf, tc],
    [
      step({ stepId: "cc-send", objectiveId: cc.objectiveId, businessId: "compassionate-choice", expectedValue: 999 }),
      step({ stepId: "lf-1", objectiveId: lf.objectiveId, businessId: "localfinds", expectedValue: 100 }),
      step({ stepId: "tc-1", objectiveId: tc.objectiveId, businessId: "talk-to-caleb", expectedValue: 50 }),
    ]);

  const run = runAutonomyKernel(deps(store, root, {
    dispatch: (s) => s.stepId === "cc-send"
      ? { ...succeeds, ownerGate: "sending a message to a real person needs Owner authority" }
      : succeeds,
  }));

  assert.deepEqual(run.gated, ["cc-send"]);
  assert.deepEqual(run.completed, ["lf-1", "tc-1"], "the rest of the portfolio kept working");
  const blocked = store.objectives().find((o) => o.objectiveId === cc.objectiveId)!;
  assert.equal(blocked.status, "BLOCKED");
  assert.match(blocked.blockedReason ?? "", /Owner authority/u);
});

test("an outward step is never eligible while outward effects are unauthorized", () => {
  const root = tempRoot();
  const store = createFileAutonomyStore(root);
  const obj = objective("compassionate-choice", "contact a customer");
  seed(store, [business("Compassionate Choice")], [obj], [
    step({ stepId: "outward", objectiveId: obj.objectiveId, businessId: "compassionate-choice", effectScope: "OUTWARD" }),
  ]);
  const schedule = scheduleNext({
    businesses: store.businesses(), objectives: store.objectives(), steps: store.steps(),
    availableCapabilities: [], completedFingerprints: [],
  });
  assert.equal(schedule.selected, null);
  assert.equal(schedule.rejected[0]!.reason, "OUTWARD_EFFECT_NOT_AUTHORIZED");
});

test("the step budget and the circuit breaker both stop the loop", () => {
  const root = tempRoot();
  const store = createFileAutonomyStore(root);
  const obj = objective("localfinds", "find resale opportunities");
  seed(store, [business("LocalFinds")], [obj],
    Array.from({ length: 5 }, (_, i) => step({ stepId: `s${i}`, objectiveId: obj.objectiveId, businessId: "localfinds" })));

  const budget = runAutonomyKernel(deps(store, root, { maxSteps: 2 }));
  assert.equal(budget.stopReason, "STEP_BUDGET_REACHED");
  assert.equal(budget.completed.length, 2);

  const root2 = tempRoot();
  const store2 = createFileAutonomyStore(root2);
  seed(store2, [business("LocalFinds")], [obj],
    // maxAttempts stays high on purpose: a step that exhausts its retries blocks its objective, and
    // a blocked objective ends the run as NOTHING_ELIGIBLE before the breaker is ever consulted.
    Array.from({ length: 5 }, (_, i) => step({ stepId: `f${i}`, objectiveId: obj.objectiveId, businessId: "localfinds", maxAttempts: 9 })));
  const breaker = runAutonomyKernel(deps(store2, root2, { verify: () => [], circuitBreakerFailures: 2 }));
  assert.equal(breaker.stopReason, "CIRCUIT_BREAKER_OPEN");
});

test("retries are bounded and exhaustion blocks the step rather than looping", () => {
  const root = tempRoot();
  const store = createFileAutonomyStore(root);
  const obj = objective("localfinds", "find resale opportunities");
  seed(store, [business("LocalFinds")], [obj], [
    step({ stepId: "flaky", objectiveId: obj.objectiveId, businessId: "localfinds", maxAttempts: 2 }),
  ]);
  const run = runAutonomyKernel(deps(store, root, { verify: () => [], circuitBreakerFailures: 99 }));
  assert.equal(run.failed.length, 2, "two attempts, then no more");
  assert.equal(store.steps().find((s) => s.stepId === "flaky")!.status, "BLOCKED");
  assert.equal(run.stopReason, "NOTHING_ELIGIBLE");
});

/* -------------------------------------------------------------------------- */
/* Restart and duplicate work                                                  */
/* -------------------------------------------------------------------------- */

test("a restart resumes at the right step, keeps business context, and repeats nothing", () => {
  const root = tempRoot();
  const first = createFileAutonomyStore(root);
  const cc = objective("compassionate-choice", "understand this business");
  const lf = objective("localfinds", "analyse a resale opportunity");
  seed(first, [business("Compassionate Choice"), business("LocalFinds")], [cc, lf], [
    step({ stepId: "cc-1", objectiveId: cc.objectiveId, businessId: "compassionate-choice", expectedValue: 300 }),
    step({ stepId: "lf-1", objectiveId: lf.objectiveId, businessId: "localfinds", expectedValue: 200 }),
  ]);
  const before = runAutonomyKernel(deps(first, root, { maxSteps: 1 }));
  assert.deepEqual(before.completed, ["cc-1"]);

  // A new process: nothing carried in memory, everything read from disk.
  const after = createFileAutonomyStore(root);
  assert.equal(after.objectives().find((o) => o.objectiveId === cc.objectiveId)!.lastVerifiedStepId, "cc-1");
  assert.equal(after.steps().find((s) => s.stepId === "cc-1")!.status, "COMPLETED");

  const resumed = runAutonomyKernel(deps(after, root));
  assert.deepEqual(resumed.completed, ["lf-1"], "resumes at the next step, does not redo cc-1");
  assert.equal(after.outcomes().filter((o) => o.stepId === "cc-1").length, 1, "one outcome, not two");
  assert.equal(after.outcomes().find((o) => o.stepId === "lf-1")!.businessId, "localfinds",
    "business association survives the restart");
});

test("two steps naming the same effect only ever happen once", () => {
  const root = tempRoot();
  const store = createFileAutonomyStore(root);
  const a = objective("localfinds", "analyse a resale opportunity");
  const b = objective("talk-to-caleb", "understand this business");
  seed(store, [business("LocalFinds"), business("Talk to Caleb")], [a, b], [
    step({ stepId: "one", objectiveId: a.objectiveId, businessId: "localfinds", effectFingerprint: "fp:shared" }),
    step({ stepId: "two", objectiveId: b.objectiveId, businessId: "talk-to-caleb", effectFingerprint: "fp:shared" }),
  ]);
  const run = runAutonomyKernel(deps(store, root));
  assert.equal(run.completed.length, 1, "the second step is the same effect and must not run");
  const rejected = scheduleNext({
    businesses: store.businesses(), objectives: store.objectives(), steps: store.steps(),
    availableCapabilities: [], completedFingerprints: ["fp:shared"],
  }).rejected;
  assert.ok(rejected.some((r) => r.reason === "ALREADY_DONE"));
});

/* -------------------------------------------------------------------------- */
/* Experience, telemetry, memory freshness                                     */
/* -------------------------------------------------------------------------- */

test("the ledger records which business and objective produced each outcome", () => {
  const root = tempRoot();
  const store = createFileAutonomyStore(root);
  const obj = objective("aiservice-co", "understand this business");
  seed(store, [business("AIService Co")], [obj], [
    step({ stepId: "ai-1", objectiveId: obj.objectiveId, businessId: "aiservice-co" }),
  ]);
  runAutonomyKernel(deps(store, root));

  const ledger = createDurableExperienceLedger(root);
  const entries = ledger.forBusiness("aiservice-co");
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.context?.objectiveId, obj.objectiveId);
  assert.equal(entries[0]!.outcome, "HELD");
  assert.equal(entries[0]!.provenance, "BUILDER_VERIFICATION",
    "AION checking its own work is builder verification, not a real incident");
});

test("telemetry keeps task and business context without the payload", () => {
  const root = tempRoot();
  const store = createFileAutonomyStore(root);
  const obj = objective("localfinds", "analyse a resale opportunity");
  seed(store, [business("LocalFinds")], [obj], [step({ stepId: "lf-1", objectiveId: obj.objectiveId, businessId: "localfinds" })]);
  runAutonomyKernel(deps(store, root));

  const row = store.telemetry()[0]!;
  assert.equal(row.businessId, "localfinds");
  assert.equal(row.taskType, "REAL_USER_OR_BUSINESS_VALUE");
  assert.equal(row.provider, "local");
  assert.equal(row.verifiedSuccess, true);
  assert.equal(row.costUsd, 0);
  const serialized = JSON.stringify(row);
  assert.doesNotMatch(serialized, /did the thing/u, "the provider's claim is not telemetry");
  assert.doesNotMatch(serialized, /analysis written/u, "evidence detail is not telemetry either");
});

test("memory freshness distinguishes superseded, expired and contradicted", () => {
  const root = tempRoot();
  const ledger = createDurableExperienceLedger(root);
  const base = {
    attempted: "a", observed: "b", learned: "c", outcome: "HELD" as const,
    provenance: "BUILDER_VERIFICATION" as const, observedAtSha: SHA, scenarioId: "s", violations: [],
  };
  ledger.record({ ...base, entryId: "old", observedAtUtc: NOW });
  ledger.record({ ...base, entryId: "new", observedAtUtc: NOW });
  ledger.record({ ...base, entryId: "expiring", observedAtUtc: NOW, expiresAtUtc: "2026-08-20T00:00:00Z" });
  ledger.record({ ...base, entryId: "left", observedAtUtc: NOW });
  ledger.record({ ...base, entryId: "right", observedAtUtc: NOW });

  assert.equal(ledger.supersede("old", "new"), true);
  assert.equal(ledger.supersede("old", "new"), false, "a correction cannot be re-attributed later");
  assert.equal(ledger.markContradiction("left", "right"), true);

  const freshness = ledger.freshnessAgainst(SHA, NOW);
  assert.equal(freshness.get("old"), "SUPERSEDED");
  assert.equal(freshness.get("expiring"), "EXPIRED");
  assert.equal(freshness.get("left"), "CONTRADICTED");
  assert.equal(freshness.get("right"), "CONTRADICTED");
  assert.equal(freshness.get("new"), "CURRENT");
  assert.deepEqual(ledger.usable(SHA, NOW).map((e) => e.entryId), ["new"]);

  // The record survives a new process reading the same directory.
  assert.equal(createDurableExperienceLedger(root).entries().length, 5);
});

test("self-report never becomes strong evidence, however often it repeats", () => {
  const synthetic = Array.from({ length: 9 }, (_, i) => ({
    entryId: `s${i}`, outcome: "HELD" as const, provenance: "SYNTHETIC_SCENARIO" as const,
  })) as never[];
  const weak = preferenceStrength(synthetic);
  assert.equal(weak.strong, false);
  assert.match(weak.reason, /self-report is never strong evidence/u);

  const real = Array.from({ length: 2 }, (_, i) => ({
    entryId: `r${i}`, outcome: "HELD" as const, provenance: "BUILDER_VERIFICATION" as const,
  })) as never[];
  assert.equal(preferenceStrength(real).strong, true, "repeated observable outcomes may move a preference");
});

/* -------------------------------------------------------------------------- */
/* Observability                                                               */
/* -------------------------------------------------------------------------- */

test("status answers what, for whom, why, what is blocked and what is next", () => {
  const root = tempRoot();
  const store = createFileAutonomyStore(root);
  const cc = objective("compassionate-choice", "contact a customer");
  const lf = objective("localfinds", "analyse a resale opportunity");
  seed(store, [business("Compassionate Choice"), business("LocalFinds")], [cc, lf], [
    step({ stepId: "cc-send", objectiveId: cc.objectiveId, businessId: "compassionate-choice", expectedValue: 999 }),
    step({ stepId: "lf-1", objectiveId: lf.objectiveId, businessId: "localfinds", expectedValue: 100 }),
  ]);
  runAutonomyKernel(deps(store, root, {
    maxSteps: 1,
    dispatch: () => ({ ...succeeds, ownerGate: "needs Owner authority" }),
  }));

  const status = autonomyStatus(store, []);
  assert.equal(status.businesses.length, 2);
  assert.equal(status.workingOn?.businessId, "localfinds");
  assert.match(status.workingOn?.whySelected ?? "", /REAL_USER_OR_BUSINESS_VALUE/u);
  assert.equal(status.blocked[0]?.businessId, "compassionate-choice");
  assert.match(status.blocked[0]?.reason ?? "", /Owner authority/u);
  assert.ok(status.nextUp.length >= 1);
});
