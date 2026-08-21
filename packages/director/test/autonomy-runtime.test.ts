/**
 * The runtime entry point: AION starting itself.
 *
 * The kernel could already choose, dispatch, verify and continue; what it could not do was begin.
 * These tests are about beginning — and about the two things that go wrong when a system begins on
 * its own: it invents facts to have something to say, and it repeats work it already did.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AION_WORKSPACE_NAME_V1,
  OWNER_PORTFOLIO_V1,
  PORTFOLIO_DIRECTIONS_V1,
  createDiscoveryVerifier,
  pauseAutonomy,
  readRuntimeState,
  registerPortfolio,
  resumeAutonomy,
  runtimeStatus,
  startAutonomy,
  type RuntimeDepsV1,
} from "../src/autonomy-runtime.js";
import {
  BLOCKING_DISCOVERY_QUESTIONS_V1,
  buildDiscoveryArtifact,
  understandsBusiness,
  type BusinessDiscoveryArtifactV1,
} from "../src/business-discovery.js";
import { buildBusinessWorkspace, businessIdFor } from "../src/business-workspace.js";
import { createFileAutonomyStore } from "../src/autonomy-store.js";
import { createDurableExperienceLedger } from "../src/experience-ledger.js";

const SHA = "b5910353a7109e811bb88cbb926bd68bd3ba874f";
const NOW = "2026-08-21T17:50:08Z";
const PROVENANCE = "Owner portfolio direction 2026-08-21";

const temps: string[] = [];
function deps(over: Partial<RuntimeDepsV1> = {}): RuntimeDepsV1 {
  const root = mkdtempSync(join(tmpdir(), "aion-runtime-"));
  temps.push(root);
  const artifactRoot = join(root, "artifacts");
  mkdirSync(artifactRoot, { recursive: true });
  return {
    storeRoot: join(root, "store"),
    artifactRoot,
    now: () => NOW,
    currentSha: SHA,
    provenance: PROVENANCE,
    ...over,
  };
}
test.after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function readArtifact(d: RuntimeDepsV1, businessId: string): BusinessDiscoveryArtifactV1 {
  return JSON.parse(readFileSync(join(d.artifactRoot, `${businessId}-discovery.json`), "utf8"));
}

/* -------------------------------------------------------------------------- */
/* Registration                                                                */
/* -------------------------------------------------------------------------- */

test("the Owner's four businesses register durably, with nothing said about what they do", () => {
  const d = deps();
  const registration = registerPortfolio(d);
  const store = createFileAutonomyStore(d.storeRoot);

  for (const name of OWNER_PORTFOLIO_V1) {
    const business = store.businesses().find((b) => b.businessId === businessIdFor(name));
    assert.ok(business, `${name} was not registered`);
    assert.equal(business.canonicalName, name);
    assert.equal(business.ownerControlled, true);
    assert.equal(business.category, null, `${name}: registration must not invent a category`);
    assert.equal(business.provenance, PROVENANCE);
  }
  assert.equal(registration.created.length > 0, true);
  assert.deepEqual(registration.recovered, [], "nothing to recover on a first run");
});

test("portfolio directions are objectives on AION, not fake businesses", () => {
  const d = deps();
  registerPortfolio(d);
  const store = createFileAutonomyStore(d.storeRoot);

  const names = store.businesses().map((b) => b.canonicalName).sort();
  assert.deepEqual(names, [...OWNER_PORTFOLIO_V1, AION_WORKSPACE_NAME_V1].sort(),
    "resale and product development are directions, and a direction is not a business");

  const aionObjectives = store.objectives().filter((o) => o.businessId === businessIdFor(AION_WORKSPACE_NAME_V1));
  assert.equal(aionObjectives.length, PORTFOLIO_DIRECTIONS_V1.length);
  assert.ok(aionObjectives.some((o) => /resale/iu.test(o.ownerText)), "the resale direction is held");
  assert.ok(aionObjectives.some((o) => /product or service/iu.test(o.ownerText)));
});

test("registering twice recovers instead of duplicating", () => {
  const d = deps();
  const first = registerPortfolio(d);
  const second = registerPortfolio(d);
  const store = createFileAutonomyStore(d.storeRoot);

  assert.equal(store.businesses().length, OWNER_PORTFOLIO_V1.length + 1);
  assert.equal(store.objectives().length, first.objectives.length);
  assert.deepEqual(second.created, [], `second registration created ${second.created.join(", ")}`);
  assert.ok(second.recovered.length > 0);

  // Ids are a pure function of the Owner's own name, which is what makes this hold.
  assert.equal(businessIdFor("Compassionate Choice"), "compassionate-choice");
});

/* -------------------------------------------------------------------------- */
/* Nothing invented                                                            */
/* -------------------------------------------------------------------------- */

test("a discovery artifact records questions, not a business model", () => {
  const d = deps();
  startAutonomy(d);
  const artifact = readArtifact(d, "compassionate-choice");

  assert.equal(artifact.canonicalName, "Compassionate Choice");
  assert.deepEqual(artifact.hypotheses, [], "a name is not evidence for a hypothesis about a business");
  assert.deepEqual(artifact.opportunities, [], "no opportunity can be claimed before anything is known");
  assert.equal(artifact.known.length, 1);
  assert.match(artifact.known[0]!.fact, /is an Owner-controlled business/u);
  assert.equal(artifact.known[0]!.evidence, "OWNER_STATED");
  assert.equal(artifact.status, "NEED_OWNER_INFORMATION");

  const serialized = JSON.stringify(artifact).toLowerCase();
  for (const invented of ["hospice", "funeral", "marketplace", "consult", "saas", "agency", "revenue of"]) {
    assert.ok(!serialized.includes(invented), `artifact contains an invented business fact: ${invented}`);
  }
});

test("writing an artifact is never the same as understanding the business", () => {
  const business = buildBusinessWorkspace({ canonicalName: "LocalFinds", provenance: PROVENANCE, now: NOW });
  const artifact = buildDiscoveryArtifact({ business, now: NOW });
  const verdict = understandsBusiness(artifact);
  assert.equal(verdict.understood, false);
  assert.match(verdict.reason, /records questions, not knowledge/u);
});

test("a fact without provenance is refused outright", () => {
  const business = buildBusinessWorkspace({ canonicalName: "Talk to Caleb", provenance: PROVENANCE, now: NOW });
  assert.throws(
    () => buildDiscoveryArtifact({
      business,
      now: NOW,
      additionalKnown: [{ fact: "sells subscriptions", provenance: "", observedAtUtc: NOW, evidence: "OWNER_STATED" }],
    }),
    /no provenance/u,
  );
});

test("blocking and nice-to-know unknowns are distinguished, and only blocking ones are asked", () => {
  const d = deps();
  startAutonomy(d);
  const artifact = readArtifact(d, "localfinds");

  const blocking = artifact.unknown.filter((u) => u.blocking);
  const optional = artifact.unknown.filter((u) => !u.blocking);
  assert.ok(blocking.length > 0 && optional.length > 0, "both kinds exist, or the distinction is decorative");
  assert.deepEqual(artifact.ownerInformationRequest, blocking.map((u) => u.question));
  assert.ok(artifact.ownerInformationRequest.length <= 5, "a question list that grows becomes a questionnaire");
  for (const question of BLOCKING_DISCOVERY_QUESTIONS_V1.filter((q) => q.blocking)) {
    assert.ok(question.whyItMatters.length > 20, "a question AION cannot justify is one it should not ask");
  }
});

/* -------------------------------------------------------------------------- */
/* The run                                                                     */
/* -------------------------------------------------------------------------- */

test("one bounded start does verified work for several businesses with no prompt between them", () => {
  const d = deps();
  const result = startAutonomy(d);

  assert.equal(result.started, true);
  const run = result.run!;
  assert.equal(run.ownerPrompts, 0);

  // Every business completed its discovery step against a real artifact read back from disk. What
  // it learned is that it needs the Owner — but the step itself is finished work, not a gate.
  for (const name of OWNER_PORTFOLIO_V1) {
    const id = businessIdFor(name);
    assert.ok(run.completed.includes(`discover-${id}`),
      `${name} did not complete; completed ${run.completed.join(", ")}`);
    assert.ok(existsSync(join(d.artifactRoot, `${id}-discovery.json`)), `${name} produced no artifact`);
  }
  assert.ok(run.businessesWorked.length >= 2, "at least two businesses were worked in one run");
  for (const outcome of createFileAutonomyStore(d.storeRoot).outcomes().filter((o) => o.verdict === "COMPLETED")) {
    assert.ok(outcome.evidence.length > 0, `${outcome.stepId} completed with no evidence`);
  }

  // And the branches that can only advance on Daniel are parked, with the questions attached.
  assert.equal(result.parked.length, OWNER_PORTFOLIO_V1.length);
});

test("a branch that blocks mid-run does not stop the rest of the portfolio", () => {
  const d = deps();
  const run = startAutonomy(d).run!;
  const store = createFileAutonomyStore(d.storeRoot);

  // AION's own self-improvement step has no step model, so it blocks when it is finally reached.
  // It is reached last, because it is speculative infrastructure and the rule puts it there.
  assert.ok(run.blocked.length >= 1, "nothing blocked, so nothing is being proven about isolation");
  const blockedIndex = run.steps.findIndex((s) => s.outcome === "BLOCKED");
  assert.ok(run.steps.slice(0, blockedIndex).every((s) => s.outcome === "COMPLETED"));
  assert.ok(run.completed.length >= 2, "business work completed either side of the blocked branch");

  // And after the pass, every business waiting on Daniel is parked with its questions.
  const parked = store.objectives().filter((o) => o.status === "BLOCKED" && /needs Owner information/u.test(o.blockedReason ?? ""));
  assert.ok(parked.length >= 2, "several businesses are waiting on the Owner");
  for (const objective of parked) {
    assert.match(objective.blockedReason ?? "", /because /u, "a question with no reason is a question AION should not ask");
  }
});

test("the run stops cleanly at its bound", () => {
  const d = deps({ maxSteps: 2 });
  const run = startAutonomy(d).run!;
  assert.equal(run.stopReason, "STEP_BUDGET_REACHED");
  assert.equal(run.steps.length, 2);
});

test("the ledger and telemetry record which business each outcome came from", () => {
  const d = deps();
  startAutonomy(d);
  const ledger = createDurableExperienceLedger(d.storeRoot);
  const store = createFileAutonomyStore(d.storeRoot);

  for (const name of OWNER_PORTFOLIO_V1) {
    const id = businessIdFor(name);
    assert.equal(ledger.forBusiness(id).length, 1, `${name} produced no ledger entry`);
    assert.ok(store.telemetry().some((row) => row.businessId === id), `${name} produced no telemetry`);
  }
  // Telemetry carries classes and ids, not the artifact.
  assert.doesNotMatch(JSON.stringify(store.telemetry()), /Owner-controlled business/u);
});

/* -------------------------------------------------------------------------- */
/* Pause, resume, restart, duplication                                         */
/* -------------------------------------------------------------------------- */

test("pause survives the process that set it, and resume releases it", () => {
  const d = deps();
  startAutonomy(d);

  const paused = pauseAutonomy(d, "Owner stopped it");
  assert.equal(paused.paused, true);
  assert.equal(readRuntimeState(d.storeRoot).pausedReason, "Owner stopped it",
    "a pause that only exists in memory is not a stop");

  const blocked = startAutonomy(d);
  assert.equal(blocked.started, false);
  assert.match(blocked.reason, /paused: Owner stopped it/u);
  assert.equal(blocked.run, null);

  resumeAutonomy(d);
  assert.equal(readRuntimeState(d.storeRoot).paused, false);
  assert.equal(startAutonomy(d).started, true);
});

test("a restart resumes from durable state and repeats no completed step", () => {
  const d = deps({ maxSteps: 1 });
  const first = startAutonomy(d).run!;
  assert.equal(first.steps.length, 1);
  const firstStep = first.steps[0]!.stepId;

  // A second runtime over the same directories: nothing is carried in memory.
  const resumed = startAutonomy({ ...d, maxSteps: 4 }).run!;
  assert.ok(!resumed.steps.some((s) => s.stepId === firstStep),
    `${firstStep} ran before the restart and must not run again`);

  const store = createFileAutonomyStore(d.storeRoot);
  const outcomes = store.outcomes().filter((o) => o.stepId === firstStep);
  assert.equal(outcomes.length, 1, "one outcome per committed step, across restarts");
  assert.ok(outcomes[0]!.businessId, "business association survived");
});

test("starting repeatedly never duplicates a business, objective, step or ledger entry", () => {
  const d = deps();
  startAutonomy(d);
  startAutonomy(d);
  startAutonomy(d);

  const store = createFileAutonomyStore(d.storeRoot);
  assert.equal(store.businesses().length, OWNER_PORTFOLIO_V1.length + 1);

  const objectiveIds = store.objectives().map((o) => o.objectiveId);
  assert.equal(new Set(objectiveIds).size, objectiveIds.length, "duplicate objective");

  const stepIds = store.steps().map((s) => s.stepId);
  assert.equal(new Set(stepIds).size, stepIds.length, "duplicate step");

  for (const name of OWNER_PORTFOLIO_V1) {
    const entries = createDurableExperienceLedger(d.storeRoot).forBusiness(businessIdFor(name));
    assert.equal(entries.length, 1, `${name} recorded ${entries.length} entries for one committed step`);
  }
});

/* -------------------------------------------------------------------------- */
/* Verification and status                                                     */
/* -------------------------------------------------------------------------- */

test("verification reads the artifact back and rejects one that is not sound", () => {
  const d = deps();
  registerPortfolio(d);
  const verify = createDiscoveryVerifier(d);
  const step = createFileAutonomyStore(d.storeRoot).steps()[0]!;

  assert.equal(verify(step)[0]!.observed, false, "no artifact yet, so nothing is observed");

  writeFileSync(join(d.artifactRoot, `${step.businessId}-discovery.json`), JSON.stringify({ schema: "something.else" }));
  assert.equal(verify(step)[0]!.observed, false, "a file that is not a discovery artifact is not evidence");

  startAutonomy(d);
  assert.equal(verify(step)[0]!.observed, true);
});

test("status tells the Owner what is running, what is stuck, and what only he can answer", () => {
  const d = deps();
  startAutonomy(d);
  const status = runtimeStatus(d);

  assert.equal(status.paused, false);
  assert.equal(status.runs, 1);
  assert.equal(status.businesses.length, OWNER_PORTFOLIO_V1.length + 1);
  assert.equal(status.needsOwnerInformation.length, OWNER_PORTFOLIO_V1.length);
  const compassionate = status.needsOwnerInformation.find((n) => n.businessId === "compassionate-choice")!;
  assert.ok(compassionate.questions.length > 0);
  assert.match(compassionate.questions[0]!, /What does this business actually do/u);
  assert.ok(status.blocked.length > 0);

  pauseAutonomy(d, "Owner stopped it");
  assert.equal(runtimeStatus(d).paused, true);
});

test("speculative self-improvement does not outrank business work", () => {
  const d = deps();
  const run = startAutonomy(d).run!;
  const aionId = businessIdFor(AION_WORKSPACE_NAME_V1);
  const businessSteps = run.steps.filter((s) => s.businessId !== aionId);
  assert.ok(businessSteps.length >= 2, "business work ran");
  // AION's own objectives have no discovery step model, so nothing was manufactured for them to do.
  assert.ok(!run.completed.some((id) => id.includes(aionId)),
    "AION must not invent work for itself while portfolio work is available");
});
