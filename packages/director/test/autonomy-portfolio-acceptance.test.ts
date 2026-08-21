/**
 * Portfolio acceptance: four standing objectives, three Owner businesses, and AION itself.
 *
 * This is the scenario the milestone is judged by, so it is written as one run rather than a set of
 * unit checks — the question is whether AION keeps working sensibly across a portfolio without
 * anyone typing anything, and that is only visible end to end.
 *
 * The objectives are the Owner's real ones. What the businesses *do* is not represented anywhere,
 * because nobody has told us: Compassionate Choice's objective is discovery, and it is expressed
 * without a single operational fact. That is the point being proven, not a limitation of the fixture.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildStandingObjective, type AutonomyStepV1 } from "../src/autonomy-contracts.js";
import { buildBusinessWorkspace } from "../src/business-workspace.js";
import { createFileAutonomyStore } from "../src/autonomy-store.js";
import { autonomyStatus, runAutonomyKernel, type StepAttemptV1 } from "../src/autonomy-kernel.js";
import { createDurableExperienceLedger } from "../src/experience-ledger.js";
import { buildOwnerGoalIntent } from "../src/owner-goal-intake.js";

const SHA = "c4ab9c36b12c9e2ea9a514be287cf35bcf9b373c";
const NOW = "2026-08-21T16:39:24Z";
const PROVENANCE = "Owner portfolio direction 2026-08-21";

const temps: string[] = [];
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "aion-portfolio-"));
  temps.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** The Owner's words, verbatim. Intake decides what they mean; this fixture does not. */
const OBJECTIVES = [
  { business: "AION", text: "improve aion itself when a demonstrated defect or real blocker appears" },
  { business: "Compassionate Choice", text: "understand this business and identify the highest-value next actions" },
  { business: "LocalFinds", text: "find and evaluate resale opportunities" },
  { business: "AIService Co", text: "research which service offers are worth testing" },
] as const;

function makeStep(input: Partial<AutonomyStepV1> & Pick<AutonomyStepV1, "stepId" | "objectiveId" | "businessId">): AutonomyStepV1 {
  return {
    schema: "aion.director.autonomyStep.v1",
    title: input.stepId,
    valueClass: "REAL_USER_OR_BUSINESS_VALUE",
    evidenceRefs: [],
    effectScope: "LOCAL_SHADOW",
    status: "READY",
    dependsOn: [],
    expectedValue: 100,
    confidence: 0.7,
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

/**
 * Builds the portfolio. Returns the artifact directory so verification can read the world rather
 * than believe the dispatcher.
 */
function portfolio(root: string) {
  const store = createFileAutonomyStore(root);
  const artifacts = join(root, "artifacts");
  const ids: Record<string, string> = {};

  for (const entry of OBJECTIVES) {
    const workspace = buildBusinessWorkspace({ canonicalName: entry.business, provenance: PROVENANCE, now: NOW });
    store.saveBusiness(workspace);
    const intent = buildOwnerGoalIntent({ text: entry.text, provenance: PROVENANCE, now: NOW, milestones: [] });
    const objective = buildStandingObjective({ intent, businessId: workspace.businessId, now: NOW });
    store.saveObjective(objective);
    ids[workspace.businessId] = objective.objectiveId;
  }

  const steps: AutonomyStepV1[] = [
    // AION's own work, with no measured blocker behind it. It claims to be fixing a proven blocker
    // and names no evidence, so it is entitled to nothing better than speculative infrastructure.
    makeStep({
      stepId: "aion-refactor-scheduler", objectiveId: ids.aion!, businessId: "aion",
      valueClass: "PROVEN_CAPABILITY_BLOCKER", evidenceRefs: [],
      expectedValue: 5_000, confidence: 1, ownerTimeMinutes: 0,
    }),
    // Compassionate Choice: discovery, expressed with no knowledge of what the business does.
    makeStep({
      stepId: "cc-discovery", objectiveId: ids["compassionate-choice"]!, businessId: "compassionate-choice",
      expectedValue: 400, confidence: 0.8, ownerTimeMinutes: 15,
    }),
    // LocalFinds: a mock resale opportunity, prerequisites and economics.
    makeStep({
      stepId: "lf-opportunity", objectiveId: ids.localfinds!, businessId: "localfinds",
      expectedValue: 300, confidence: 0.9, ownerTimeMinutes: 0,
    }),
    // AIService Co: an offer-research step that would need to talk to someone, and so gates.
    makeStep({
      stepId: "ai-outreach", objectiveId: ids["aiservice-co"]!, businessId: "aiservice-co",
      expectedValue: 900, confidence: 0.9, ownerTimeMinutes: 0,
    }),
  ];
  for (const step of steps) store.saveStep(step);
  return { store, artifacts, ids };
}

/**
 * A dispatcher that writes a real artifact for local work and gates on outreach.
 *
 * Nothing here contacts anybody, buys anything, or spends anything: the "work" is a file on disk,
 * which is exactly what the verifier then goes and looks for.
 */
function dispatcher(artifacts: string) {
  return (step: AutonomyStepV1): StepAttemptV1 => {
    if (step.stepId === "ai-outreach") {
      return {
        provider: "local", claim: "drafted outreach",
        ownerGate: "contacting a prospect needs fresh Owner authority",
        blocked: null, failure: null, latencyMs: 5, tokens: 10, costUsd: 0,
      };
    }
    const body = step.stepId === "lf-opportunity"
      ? JSON.stringify({
        // The resale economics structure, carried as inputs rather than as answers. The thresholds
        // the Owner mentioned are hypotheses; nothing here treats them as settled.
        prerequisites: ["resale certificate", "sales tax registration", "local permit check"],
        acquisitionCost: 0, fees: 0, shippingAndTravel: 0, holdingAndTax: 0,
        risk: "UNKNOWN", expectedProfit: null, roi: null, expectedDaysToSell: null,
        decision: "PASS", decisionReason: "mock opportunity: no real comps were consulted",
      }, null, 2)
      : JSON.stringify({
        // Discovery, with nothing filled in. Every field a later step must actually go and learn.
        businessModel: "UNKNOWN", productsOrServices: "UNKNOWN", customers: "UNKNOWN",
        workflows: "UNKNOWN", revenueWork: "UNKNOWN", repetitiveWork: "UNKNOWN",
        bottlenecks: "UNKNOWN", prerequisites: "UNKNOWN",
        nextActions: ["ask the Owner what this business actually does"],
      }, null, 2);
    writeFileSync(join(artifacts, `${step.stepId}.json`), body);
    return {
      provider: "local", claim: "wrote analysis", ownerGate: null, blocked: null,
      failure: null, latencyMs: 20, tokens: 60, costUsd: 0,
    };
  };
}

/** Verification reads the filesystem. A claim with no file behind it is not a completion. */
function verifier(artifacts: string) {
  return (step: AutonomyStepV1) => {
    const path = join(artifacts, `${step.stepId}.json`);
    return [{ kind: "ARTIFACT", detail: path, observed: existsSync(path) }];
  };
}

test("the portfolio runs itself: four objectives, three businesses, one gate, no prompts", () => {
  const root = tempRoot();
  const { store, artifacts } = portfolio(root);
  mkdirSync(artifacts, { recursive: true });

  const run = runAutonomyKernel({
    store,
    ledger: createDurableExperienceLedger(root),
    now: () => NOW,
    currentSha: SHA,
    dispatch: dispatcher(artifacts),
    verify: verifier(artifacts),
    availableCapabilities: [],
    outwardAuthorized: false,
  });

  /* Objectives coexist durably, each keeping its business. */
  assert.equal(store.businesses().length, 4);
  assert.equal(store.objectives().length, 4);
  for (const objective of store.objectives()) {
    assert.ok(store.businesses().some((b) => b.businessId === objective.businessId));
  }

  /* Useful business work outranks AION's own unevidenced infrastructure work. The AION step has the
   * largest number attached to it by a wide margin and still goes last. */
  const order = run.steps.map((s) => s.stepId);
  assert.ok(order.indexOf("aion-refactor-scheduler") > order.indexOf("cc-discovery"),
    `AION's speculative work must not lead: order was ${order.join(" -> ")}`);
  assert.ok(order.indexOf("aion-refactor-scheduler") > order.indexOf("lf-opportunity"));

  /* One completion leads to the next, across businesses, with nobody asked anything. */
  assert.equal(run.ownerPrompts, 0);
  assert.ok(run.businessesWorked.length >= 3, `worked ${run.businessesWorked.join(", ")}`);
  assert.deepEqual([...run.completed].sort(), ["aion-refactor-scheduler", "cc-discovery", "lf-opportunity"]);

  /* The gated branch stops, and only it. */
  assert.deepEqual(run.gated, ["ai-outreach"]);
  const gatedObjective = store.objectives().find((o) => o.businessId === "aiservice-co")!;
  assert.equal(gatedObjective.status, "BLOCKED");
  assert.match(gatedObjective.blockedReason ?? "", /fresh Owner authority/u);
  for (const other of store.objectives().filter((o) => o.businessId !== "aiservice-co")) {
    assert.notEqual(other.status, "BLOCKED", `${other.businessId} must not be blocked by another business`);
  }

  /* Every completion is backed by a file that actually exists. */
  for (const outcome of store.outcomes().filter((o) => o.verdict === "COMPLETED")) {
    assert.ok(outcome.evidence.length > 0, `${outcome.stepId} completed with no evidence`);
  }

  /* Experience and telemetry carry the business that produced them. */
  const ledger = createDurableExperienceLedger(root);
  assert.equal(ledger.forBusiness("compassionate-choice").length, 1);
  assert.equal(ledger.forBusiness("localfinds").length, 1);
  const telemetryBusinesses = new Set(store.telemetry().map((row) => row.businessId));
  assert.equal(telemetryBusinesses.size, 4);

  /* Nothing left the machine and nothing was spent. */
  assert.equal(store.telemetry().reduce((sum, row) => sum + row.costUsd, 0), 0);
});

test("Compassionate Choice's discovery artifact invents nothing about the business", () => {
  const root = tempRoot();
  const { store, artifacts } = portfolio(root);
  mkdirSync(artifacts, { recursive: true });
  runAutonomyKernel({
    store, ledger: createDurableExperienceLedger(root), now: () => NOW, currentSha: SHA,
    dispatch: dispatcher(artifacts), verify: verifier(artifacts),
    availableCapabilities: [], outwardAuthorized: false,
  });

  const analysis = JSON.parse(readFileSync(join(artifacts, "cc-discovery.json"), "utf8"));
  for (const field of ["businessModel", "productsOrServices", "customers", "workflows"]) {
    assert.equal(analysis[field], "UNKNOWN", `${field} must stay UNKNOWN until the Owner says otherwise`);
  }
  assert.deepEqual(analysis.nextActions, ["ask the Owner what this business actually does"]);

  const business = store.businesses().find((b) => b.businessId === "compassionate-choice")!;
  assert.equal(business.category, null, "running a discovery step must not backfill a category");
});

test("a restart continues the portfolio without repeating a business's completed work", () => {
  const root = tempRoot();
  const { artifacts } = portfolio(root);
  mkdirSync(artifacts, { recursive: true });

  const first = createFileAutonomyStore(root);
  const before = runAutonomyKernel({
    store: first, ledger: createDurableExperienceLedger(root), now: () => NOW, currentSha: SHA,
    dispatch: dispatcher(artifacts), verify: verifier(artifacts),
    // Two steps, not one: the AIService Co outreach step carries the highest evidence-weighted
    // value, so it is selected first and gates. A one-step run would end with nothing completed
    // and therefore nothing to prove about restarts.
    availableCapabilities: [], outwardAuthorized: false, maxSteps: 2,
  });
  assert.equal(before.completed.length, 1, `first pass completed: ${before.completed.join(", ")}`);
  const done = before.completed[0]!;

  // A different process object over the same directory: everything it knows, it read from disk.
  const second = createFileAutonomyStore(root);
  const resumed = runAutonomyKernel({
    store: second, ledger: createDurableExperienceLedger(root), now: () => NOW, currentSha: SHA,
    dispatch: dispatcher(artifacts), verify: verifier(artifacts),
    availableCapabilities: [], outwardAuthorized: false,
  });

  assert.ok(!resumed.completed.includes(done), `${done} was completed before the restart and must not repeat`);
  assert.equal(second.outcomes().filter((o) => o.stepId === done).length, 1);
  const resumedOutcome = second.outcomes().find((o) => o.stepId === resumed.completed[0]);
  assert.ok(resumedOutcome?.businessId, "business association survived the restart");
});

test("status after the run tells the Owner what is happening and what is stuck", () => {
  const root = tempRoot();
  const { store, artifacts } = portfolio(root);
  mkdirSync(artifacts, { recursive: true });
  runAutonomyKernel({
    store, ledger: createDurableExperienceLedger(root), now: () => NOW, currentSha: SHA,
    dispatch: dispatcher(artifacts), verify: verifier(artifacts),
    availableCapabilities: [], outwardAuthorized: false,
  });

  const status = autonomyStatus(store, []);
  assert.equal(status.businesses.length, 4);
  assert.equal(status.blocked.length, 1);
  assert.equal(status.blocked[0]!.businessId, "aiservice-co");
  assert.equal(status.recentlyCompleted.length, 3);
  assert.equal(status.workingOn, null, "everything safe is done, so there is nothing in flight");
});
