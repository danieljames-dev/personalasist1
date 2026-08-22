/**
 * Revenue discovery.
 *
 * The tests that matter here are the ones that try to make the operator lie: a confident candidate
 * with no evidence, a huge number with no basis, pending geography leaking into current markets, a
 * fixture standing in for a market finding. If any of those succeed, everything the operator says
 * downstream is worthless, and it will say it convincingly.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createFileBusinessEvidenceStore } from "../src/business-evidence-store.js";
import { ensureOwnerQuestion } from "../src/business-intake.js";
import {
  CLAIM_V1,
  COMPASSIONATE_CHOICE_WORKSPACE_V1 as CC,
  LOCALFINDS_WORKSPACE_V1 as LF,
  corpusFor,
} from "../src/business-corpus.js";
import {
  assumptionsFor,
  compareScheduleShapes,
  computeUnitEconomics,
  type ScheduleShapeV1,
} from "../src/revenue-economics.js";
import {
  derivedEvidenceQuality,
  entitledEvidenceQuality,
  evidencedFigureShare,
  hasEvidencedPrice,
  FIGURE_EVIDENCE_KINDS_V1,
  isGroundedFigure,
  type EvidenceKindV1,
  namedFiguresOf,
  money,
  quantity,
  unknownMoney,
  unknownQuantity,
  type RevenueOpportunityV1,
} from "../src/revenue-opportunity.js";
import { explainOrdering, rankCandidates, scoreCandidate } from "../src/revenue-scoring.js";
import {
  RESEARCH_CAPABILITY_BLOCKER_V1,
  attemptResearch,
  buildResearchItem,
  isRealMarketEvidence,
  revenueResearchTasks,
  type ResearchPortV1,
} from "../src/revenue-research.js";
import {
  SCHEDULE_SHAPES_V1,
  caregiverCapacityFor,
  hasCandidateModels,
  candidateModels,
  currentGeography,
  pendingGeography,
  runRevenueDiscovery,
} from "../src/revenue-discovery.js";

const NOW = "2026-08-22T02:39:42Z";
const temps: string[] = [];
function seeded(workspaceIds: readonly string[] = [CC]) {
  const dir = mkdtempSync(join(tmpdir(), "aion-rd-"));
  temps.push(dir);
  const store = createFileBusinessEvidenceStore(dir);
  for (const ws of workspaceIds) for (const source of corpusFor(ws, NOW)) store.commitImport(ws, source, NOW);
  return store;
}

/*
 * The reference ids these fixtures may cite.
 *
 * Entitlement resolves citations against the store, so a fixture that cites nothing real is
 * unevidenced by construction — which is correct, and means the fixtures have to say which
 * references exist. Deliberately absent: "bogus", so the self-citation test still has something to
 * fail against.
 */
const KNOWN_REFS = new Map<string, EvidenceKindV1>([
  /* Capability records: real, and evidence of what the business may do, not of what anyone pays. */
  ["cc-registration", "CAPABILITY"], ["cc-service-area", "CAPABILITY"], ["e", "CAPABILITY"],
  ["e1", "CAPABILITY"],
  /* Demand: somebody asked. */
  ["d", "DEMAND"], ["d1", "DEMAND"], ["enquiry-log", "DEMAND"], ["one real enquiry", "DEMAND"],
  ["an enquiry", "DEMAND"], ["demand-1", "DEMAND"], ["enquiry-3", "DEMAND"],
  /* Price: a retrieved market fact about what something costs. */
  ["competitor-listing-7", "PRICE"], ["listing-7", "PRICE"],
  /* Cost: what a shift takes to run. Capital: what the business takes to start. Not the same. */
  ["wage-posting-2", "COST"],
  ["startup-quote-4", "CAPITAL"],
  /* Three separate operational questions, deliberately not one bucket. */
  ["owner-time-study-1", "OWNER_TIME"],
  ["shift-log-9", "WORKER_HOURS"],
  ["onboarding-timeline-3", "TIME_TO_REVENUE"],
  /* A capability fact. It grounds no financial figure at all. */
  ["care-dot-com-product-page", "CAPABILITY"],
]);

const scoreCandidateKnown = (input: RevenueOpportunityV1) => scoreCandidate(input, KNOWN_REFS);
const entitledEvidenceQualityKnown = (input: RevenueOpportunityV1) =>
  entitledEvidenceQuality(input, KNOWN_REFS);

test.after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
/* A number cannot exist without saying where it came from                     */
/* -------------------------------------------------------------------------- */

test("a financial figure must name its basis and match its state", () => {
  assert.throws(() => money({ low: 30, high: 40, state: "ESTIMATE", basis: "  " }), /basis/u);
  assert.throws(() => money({ low: null, high: null, state: "ESTIMATE", basis: "x" }), /must carry both bounds/u);
  assert.throws(() => money({ low: 1, high: 2, state: "UNKNOWN", basis: "x" }), /must not carry a value/u);
  assert.throws(() => quantity({ low: 1, high: 2, unit: "h", state: "UNKNOWN", basis: "x" }), /must not carry a value/u);

  const ok = money({ low: 30, high: 40, state: "ESTIMATE", basis: "competitor page, retrieved 2026-08-22" });
  assert.equal(ok.currency, "USD");
});

test("every figure on a generated candidate is UNKNOWN, because no market evidence exists", () => {
  const candidates = candidateModels({
    workspaceId: CC, objectiveId: "obj", geography: ["Polk"], evidenceRefs: ["e1"], now: NOW,
  });
  for (const candidate of candidates) {
    for (const { figure } of namedFiguresOf(candidate)) {
      assert.equal(figure.state, "UNKNOWN", `${candidate.title} carries a ${figure.state} figure with no research behind it`);
      assert.notEqual(figure.basis.trim(), "");
    }
    assert.equal(candidate.evidenceQuality, "NONE");
    assert.ok(candidate.confidence <= 0.3, "high confidence in an unevidenced hypothesis is the failure itself");
  }
});

/* -------------------------------------------------------------------------- */
/* Evidence gating                                                             */
/* -------------------------------------------------------------------------- */

function candidate(over: Partial<RevenueOpportunityV1> = {}): RevenueOpportunityV1 {
  const base = candidateModels({
    workspaceId: CC, objectiveId: "obj", geography: ["Polk"], evidenceRefs: [], now: NOW,
  })[0]!;
  return { ...base, ...over };
}

test("a candidate claiming strong evidence with none is downgraded to NONE", () => {
  const bluffing = candidate({ evidenceQuality: "STRONG", evidenceRefs: [], demandEvidence: [] });
  const verdict = entitledEvidenceQuality(bluffing, KNOWN_REFS);
  assert.equal(verdict.quality, "NONE");
  assert.equal(verdict.downgraded, true);
  assert.match(verdict.reason, /reasoning is not evidence/u);
});

test("capability evidence entitles a revenue candidate to nothing", () => {
  /*
   * This is the production shape: every generated candidate carries registration and service-area
   * refs and no demand evidence. Downgrading STRONG to MODERATE here — the earlier rule — left those
   * candidates rankable on facts that say nothing about whether anyone will pay.
   */
  for (const claimed of ["STRONG", "MODERATE", "WEAK"] as const) {
    const capabilityOnly = candidate({
      evidenceQuality: claimed, evidenceRefs: ["cc-registration", "cc-service-area"], demandEvidence: [],
    });
    const entitled = entitledEvidenceQuality(capabilityOnly, KNOWN_REFS);
    assert.equal(entitled.quality, "NONE", `claimed ${claimed} survived on capability evidence alone`);
    assert.equal(entitled.downgraded, true);
    assert.match(entitled.reason, /anyone will pay/u);
    assert.equal(scoreCandidate(capabilityOnly, KNOWN_REFS).score, 0);
  }
  const withDemand = candidate({
    evidenceQuality: "MODERATE", evidenceRefs: ["cc-registration", "competitor-listing-7"], demandEvidence: ["enquiry-log"],
    estimatedPrice: money({ low: 28, high: 32, state: "ESTIMATE", basis: "competitor-listing-7, retrieved 2026-08-22" }),
  });
  assert.equal(entitledEvidenceQuality(withDemand, KNOWN_REFS).quality, "WEAK",
    "real demand evidence must still count for something");
  /* MODERATE is reachable, but it has to be earned by evidencing what the thing costs. */
  const withCost = candidate({
    ...withDemand,
    evidenceRefs: [...withDemand.evidenceRefs, "wage-posting-2"],
    estimatedDirectCost: money({ low: 15, high: 17, state: "ESTIMATE", basis: "wage-posting-2" }),
  });
  assert.equal(entitledEvidenceQuality(withCost, KNOWN_REFS).quality, "MODERATE");
  /* And a claim can only ever lower the derived value, never raise it. */
  assert.equal(entitledEvidenceQuality({ ...withCost, evidenceQuality: "WEAK" }, KNOWN_REFS).quality, "WEAK");
});

test("a huge unevidenced number does not outrank a small evidenced one", () => {
  const enormous = candidate({
    opportunityId: "huge", title: "Enormous unevidenced plan",
    evidenceQuality: "STRONG", evidenceRefs: [], demandEvidence: [],
    confidence: 1, recurringPotential: "HIGH", reversibility: "REVERSIBLE",
    estimatedPrice: money({ low: 900, high: 5000, state: "HYPOTHESIS", basis: "imagined" }),
    estimatedTimeToFirstRevenue: quantity({ low: 1, high: 1, unit: "days", state: "HYPOTHESIS", basis: "imagined" }),
  });
  const modest = candidate({
    opportunityId: "modest", title: "Small evidenced plan",
    evidenceQuality: "MODERATE", evidenceRefs: ["e1", "competitor-listing-7"], demandEvidence: ["d1"],
    confidence: 0.5, recurringPotential: "MEDIUM",
    estimatedPrice: money({ low: 28, high: 32, state: "ESTIMATE", basis: "competitor-listing-7, retrieved 2026-08-22" }),
  });

  const ranking = rankCandidates([enormous, modest], KNOWN_REFS);
  assert.equal(ranking.ranked[0]!.opportunityId, "modest",
    `unevidenced enormity outranked evidenced modesty: ${ranking.ranked.map((r) => r.title).join(" > ")}`);
  assert.equal(scoreCandidate(enormous, KNOWN_REFS).score, 0, "a candidate with no evidence scores zero, not merely less");
});

test("scoring explains itself in a sentence a person can argue with", () => {
  const a = scoreCandidateKnown(candidate({
    opportunityId: "a", title: "A", evidenceQuality: "MODERATE", evidenceRefs: ["e", "competitor-listing-7"], demandEvidence: ["d"],
    estimatedPrice: money({ low: 28, high: 32, state: "ESTIMATE", basis: "competitor-listing-7, retrieved 2026-08-22" }),
  }));
  const b = scoreCandidateKnown(candidate({ opportunityId: "b", title: "B" }));
  assert.match(a.explanation, /weighted components/u);
  assert.match(b.explanation, /cannot be ranked above/u);
  assert.match(explainOrdering(a, b), /A ranks over B because its evidence is WEAK against NONE/u);
  assert.ok(a.components.every((part) => part.reason.length > 20), "a component nobody can interpret is not inspectable");
});

test("ranking is refused when nothing carries evidence", () => {
  const ranking = rankCandidates(candidateModels({
    workspaceId: CC, objectiveId: "obj", geography: ["Polk"], evidenceRefs: ["e1"], now: NOW,
  }));
  assert.equal(ranking.rankable, false);
  assert.equal(ranking.informationGainFirst, true);
  assert.match(ranking.reason, /would come from whoever wrote the hypotheses/u);
});

/* -------------------------------------------------------------------------- */
/* Unit economics and schedule density                                         */
/* -------------------------------------------------------------------------- */

test("economics refuse to compute money from unknown inputs, and say which are missing", () => {
  const result = computeUnitEconomics({
    billRatePerHour: unknownMoney("no pricing evidence"),
    wagePerHour: unknownMoney("no wage evidence"),
    payrollBurdenPct: unknownQuantity("percent", "unknown"),
    cancellationRatePct: unknownQuantity("percent", "unknown"),
    schedule: SCHEDULE_SHAPES_V1[0]!,
  });
  assert.equal(result.contributionPerBillableHour.state, "UNKNOWN");
  assert.equal(result.grossMarginPct.low, null);
  assert.ok(result.missingInputs.includes("bill rate per hour"));
  assert.ok(result.missingInputs.includes("caregiver wage per hour"));
  // Structure is still computable, which is the point of separating it from money.
  assert.ok(result.caregiverUtilisationPct.low! > 0);
  assert.match(result.note, /not assumption-free/u);
  assert.match(result.note, /ASSUMED and not measured/u);
});

test("economics produce ranges, and the range pairs worst with worst", () => {
  const result = computeUnitEconomics({
    billRatePerHour: money({ low: 28, high: 34, state: "ESTIMATE", basis: "fixture" }),
    wagePerHour: money({ low: 15, high: 18, state: "ESTIMATE", basis: "fixture" }),
    payrollBurdenPct: quantity({ low: 12, high: 18, unit: "percent", state: "ESTIMATE", basis: "fixture" }),
    cancellationRatePct: quantity({ low: 0, high: 5, unit: "percent", state: "ESTIMATE", basis: "fixture" }),
    schedule: SCHEDULE_SHAPES_V1[2]!,
  });
  assert.equal(result.missingInputs.length, 0);
  assert.ok(result.contributionPerBillableHour.low! < result.contributionPerBillableHour.high!);
  assert.equal(result.contributionPerBillableHour.state, "HYPOTHESIS",
    "an output is never surer than its weakest input, and paid hours rest on assumed overhead");
  assert.ok(result.breakEvenUtilisationPct.low! > 0);

  /*
   * The pairing this test is named for, actually checked. The pessimistic end must be the lowest
   * rate against the highest wage and burden and the highest cancellation — not an average, and not
   * a flattering mix.
   */
  const billable = result.billableHoursPerWeek;
  const paid = result.paidHoursPerWeek.low!;
  const worstRevenue = billable * 28 * (1 - 5 / 100);
  const worstCost = paid * 18 * (1 + 18 / 100);
  assert.ok(Math.abs(result.contributionPerBillableHour.low! - (worstRevenue - worstCost) / billable) < 1e-9,
    "the pessimistic end was not the worst rate against the worst cost");
});

test("schedule structure dominates: the same billable hours, very different utilisation", () => {
  const comparison = compareScheduleShapes(SCHEDULE_SHAPES_V1);
  const scattered = comparison.shapes.find((s) => s.label.includes("scattered"))!;
  const block = comparison.shapes.find((s) => s.label.includes("block"))!;

  assert.ok(block.utilisationPct > scattered.utilisationPct + 10,
    `a five-hour block should be far better utilised than five scattered hours: ${scattered.utilisationPct}% vs ${block.utilisationPct}%`);
  assert.equal(comparison.structuralSpreadIsLarge, true);
  assert.match(comparison.reason, /spread from structure alone/u);
  assert.match(comparison.reason, /Whether that outweighs a rate difference is UNKNOWN/u);
  assert.match(comparison.reason, /under the stated assumptions/u);
  // Same billable hours in every shape, so the difference is structure and nothing else.
  for (const shape of SCHEDULE_SHAPES_V1) {
    assert.equal(shape.visitsPerWeek * shape.hoursPerVisit, 5);
  }
});

test("unpaid travel flatters utilisation, which is why the paid flag exists", () => {
  const paid: ScheduleShapeV1 = { ...SCHEDULE_SHAPES_V1[0]!, travelPaid: true };
  const unpaid: ScheduleShapeV1 = { ...SCHEDULE_SHAPES_V1[0]!, travelPaid: false };
  const comparison = compareScheduleShapes([paid, unpaid]);
  assert.ok(comparison.shapes[1]!.utilisationPct > comparison.shapes[0]!.utilisationPct,
    "not paying for travel makes the numbers look better and the job worse");
});

/* -------------------------------------------------------------------------- */
/* Geography                                                                   */
/* -------------------------------------------------------------------------- */

test("current geography comes from evidence and excludes pending expansion", () => {
  const store = seeded();
  const evidence = store.evidence(CC);
  const current = currentGeography(evidence);

  assert.deepEqual([...current].sort(), ["Hardee", "Highlands", "Hillsborough", "Manatee", "Polk"]);
  const pending = pendingGeography(evidence);
  assert.ok(pending.length > 0, "the pending expansion is recorded");
  for (const entry of pending) {
    assert.ok(!current.includes(entry), "pending geography must never appear in current authority");
  }
});

test("every candidate is confined to the approved counties", () => {
  const store = seeded();
  const report = runRevenueDiscovery({ workspaceId: CC, objectiveId: "obj", store, now: NOW });
  for (const candidate of report.candidates) {
    assert.deepEqual([...candidate.geography].sort(), ["Hardee", "Highlands", "Hillsborough", "Manatee", "Polk"]);
  }
  const serialized = JSON.stringify(report.candidates);
  assert.ok(!/statewide/iu.test(serialized));
});

test("a business with no service-area evidence produces no candidates at all", () => {
  const store = seeded([LF]);
  const report = runRevenueDiscovery({ workspaceId: LF, objectiveId: "obj", store, now: NOW });
  assert.deepEqual(report.currentGeography, []);
  assert.deepEqual(report.candidates, [], "no approved geography means nothing may be planned");
  /*
   * The questions are as business-specific as the models. LocalFinds was being asked whether it had
   * companion capacity today, which reads as though AION knows what it does.
   */
  assert.deepEqual(report.ownerQuestions, [],
    "a companion-care questionnaire followed a business it does not describe");
  assert.deepEqual(report.researchTasks, []);
});

/* -------------------------------------------------------------------------- */
/* Research provenance and the capability blocker                              */
/* -------------------------------------------------------------------------- */

test("a research item must name a source, and a summary must name what it summarises", () => {
  assert.throws(() => buildResearchItem({
    taskId: "t", workspaceId: CC, sourceType: "PUBLIC_WEB", sourceRef: "  ", derivedFrom: "",
    retrievedAtUtc: NOW, geography: [], fact: "x", freshness: "CURRENT", evidenceQuality: "MODERATE",
  }), /must name its source/u);

  assert.throws(() => buildResearchItem({
    taskId: "t", workspaceId: CC, sourceType: "DERIVED_SUMMARY", sourceRef: "a summary", derivedFrom: "",
    retrievedAtUtc: NOW, geography: [], fact: "x", freshness: "CURRENT", evidenceQuality: "MODERATE",
  }), /a summary is not a source/u);
});

test("a captured fixture is never real market evidence", () => {
  const fixture = buildResearchItem({
    taskId: "t", workspaceId: CC, sourceType: "CAPTURED_FIXTURE", sourceRef: "test fixture",
    derivedFrom: "", retrievedAtUtc: NOW, geography: ["Polk"], fact: "agencies charge $30/hr",
    freshness: "CURRENT", evidenceQuality: "STRONG",
  });
  assert.equal(isRealMarketEvidence(fixture), false,
    "a fixture that counted as evidence would let the test suite manufacture the confidence this milestone lacks");

  const real = buildResearchItem({
    taskId: "t", workspaceId: CC, sourceType: "PUBLIC_WEB", sourceRef: "https://example.invalid/rates",
    derivedFrom: "", retrievedAtUtc: NOW, geography: ["Polk"], fact: "agencies charge $30/hr",
    freshness: "CURRENT", evidenceQuality: "MODERATE",
  });
  assert.equal(isRealMarketEvidence(real), true);
});

test("web research refuses without a capability, and says exactly what is missing", () => {
  const tasks = revenueResearchTasks(CC, NOW);
  const web = tasks.find((task) => task.requiresPublicWeb)!;
  const attempt = attemptResearch(web, null);

  assert.equal(attempt.attempted, false);
  assert.equal(attempt.state, "BLOCKED_BY_CAPABILITY");
  assert.equal(attempt.detail, RESEARCH_CAPABILITY_BLOCKER_V1);
  assert.match(attempt.detail, /REQUIRES_INTEGRATION with no authorizer/u);
});

test("an Owner question is never answered by research, however capable", () => {
  const ownerTask = revenueResearchTasks(CC, NOW).find((task) => task.requiresOwner)!;
  const generousPort: ResearchPortV1 = {
    fetchPublicEvidence: () => { throw new Error("research must not be attempted for an Owner question"); },
  };
  const attempt = attemptResearch(ownerTask, generousPort);
  assert.equal(attempt.state, "NEEDS_OWNER_INFORMATION");
  assert.match(attempt.detail, /no amount of research substitutes/u);
});

test("with a port, research runs and satisfies the task", () => {
  const task = revenueResearchTasks(CC, NOW).find((t) => t.requiresPublicWeb)!;
  const port: ResearchPortV1 = {
    fetchPublicEvidence: () => [buildResearchItem({
      taskId: task.taskId, workspaceId: CC, sourceType: "PUBLIC_WEB",
      sourceRef: "https://example.invalid/rates", derivedFrom: "", retrievedAtUtc: NOW,
      geography: ["Polk"], fact: "listed rate range", freshness: "CURRENT", evidenceQuality: "MODERATE",
    })],
  };
  const attempt = attemptResearch(task, port, ["Polk"]);
  assert.equal(attempt.attempted, true);
  assert.equal(attempt.state, "SATISFIED");
});

/* -------------------------------------------------------------------------- */
/* The report                                                                  */
/* -------------------------------------------------------------------------- */

test("the report is honest: candidates, no ranking, named blockers, batched Owner questions", () => {
  const store = seeded();
  const report = runRevenueDiscovery({ workspaceId: CC, objectiveId: "obj", store, now: NOW });

  assert.ok(report.candidates.length >= 3, "at least three candidate models are considered");
  assert.equal(report.marketEvidenceCount, 0, "no market evidence exists and none was invented");
  assert.equal(report.ranking.rankable, false);
  /* Called with no port at all, the operator is genuinely unable to ask, and says so. */
  assert.ok(report.capabilityBlockers.length > 0);
  assert.match(report.capabilityBlockers[0]!, /no read-only public web research route/u);
  assert.ok(report.ownerQuestions.length > 0 && report.ownerQuestions.length <= 3,
    `Owner questions should be few and decision-changing, got ${report.ownerQuestions.length}`);
  assert.match(report.nextDecision, /Nothing can be ranked yet/u);

  // Known business state comes from evidence, not from this module.
  assert.ok(report.knownBusinessState.some((row) => row.includes("REGISTERED")));
  assert.ok(report.knownBusinessState.some((row) => row.includes("Hardee")));

  // Every candidate carries a falsifiable experiment.
  for (const candidate of report.candidates) {
    assert.ok(candidate.nextValidationStep.falsifiedBy.length > 20,
      `${candidate.title} has no way to be proven wrong`);
    assert.equal(candidate.nextValidationStep.outwardEffectRequired, false);
  }
});

test("at least one candidate is visibly weaker for a named reason", () => {
  const store = seeded();
  const report = runRevenueDiscovery({ workspaceId: CC, objectiveId: "obj", store, now: NOW });
  const outing = report.candidates.find((c) => c.opportunityId === "cc-outing-companionship")!;
  assert.ok(outing.criticalUnknowns.some((u) => /transport/u.test(u)),
    "the no-transport policy is the thing that makes this candidate doubtful, and it should say so");
  assert.equal(outing.recurringPotential, "LOW");
  /*
   * Compared on the components rather than on the live scores, which are all 0 today because no
   * candidate is evidenced — `0 <= 0` would hold however the ranking arithmetic were broken.
   */
  const recurringOf = (id: string) => {
    const found = report.candidates.find((c) => c.opportunityId === id)!;
    return scoreCandidate({
      ...found,
      evidenceQuality: "MODERATE",
      demandEvidence: ["demand-1"],
      evidenceRefs: [...found.evidenceRefs, "competitor-listing-7"],
      estimatedPrice: money({ low: 28, high: 32, state: "ESTIMATE", basis: "competitor-listing-7, retrieved 2026-08-22" }),
    }, KNOWN_REFS);
  };
  const outingScore = recurringOf("cc-outing-companionship");
  const blockScore = recurringOf("cc-recurring-block");
  assert.ok(outingScore.score > 0, "the comparison is meaningless unless both sides actually score");
  assert.ok(outingScore.score < blockScore.score,
    `a one-off, transport-dependent model should not lead a recurring one (${outingScore.score} vs ${blockScore.score})`);
});

test("caregiver capacity is answerable without market data", () => {
  const small = caregiverCapacityFor(3, SCHEDULE_SHAPES_V1[2]!);
  const large = caregiverCapacityFor(12, SCHEDULE_SHAPES_V1[0]!);
  assert.equal(small.likelyNextBottleneck, false);
  assert.equal(large.likelyNextBottleneck, true);
  assert.match(large.reason, /hiring becomes the constraint/u);
  /* Twelve clients on scattered hours is strictly more paid time than three on blocks. */
  assert.ok(large.paidHoursPerWeek > small.paidHoursPerWeek,
    `12 clients on scattered visits (${large.paidHoursPerWeek}h) should cost more paid time than 3 on blocks (${small.paidHoursPerWeek}h)`);
  assert.ok(large.caregiversNeededFullTime > small.caregiversNeededFullTime);
});

test("running discovery twice produces the same report", () => {
  const store = seeded();
  const first = runRevenueDiscovery({ workspaceId: CC, objectiveId: "obj", store, now: NOW });
  const second = runRevenueDiscovery({ workspaceId: CC, objectiveId: "obj", store, now: NOW });
  assert.deepEqual(second, first, "discovery is a pure read over evidence and must be reproducible");
});

/* -------------------------------------------------------------------------- */
/* Director integration                                                        */
/* -------------------------------------------------------------------------- */

test("the Director runs revenue discovery itself, across several steps, with no prompt between them", async () => {
  const { mkdirSync, existsSync, readFileSync } = await import("node:fs");
  const { startAutonomy, runtimeStatus } = await import("../src/autonomy-runtime.js");
  const { createDurableExperienceLedger } = await import("../src/experience-ledger.js");

  const root = mkdtempSync(join(tmpdir(), "aion-rd-runtime-"));
  temps.push(root);
  const artifactRoot = join(root, "artifacts");
  mkdirSync(artifactRoot, { recursive: true });
  const deps = {
    storeRoot: join(root, "store"),
    artifactRoot,
    now: () => NOW,
    currentSha: "test",
    provenance: "Owner portfolio direction",
  };

  const run = startAutonomy(deps).run!;

  // The Director recognised readiness and scheduled revenue discovery for the one business that has it.
  assert.ok(run.completed.includes(`revenue-discovery-${CC}`),
    `revenue discovery did not run; completed ${run.completed.join(", ")}`);
  assert.ok(run.steps.length >= 3, `only ${run.steps.length} step(s) ran; multi-step autonomy is the point`);
  assert.equal(run.ownerPrompts, 0, "no Owner prompt between steps");
  assert.ok(run.businessesWorked.length >= 2, "the portfolio kept moving while Compassionate Choice was worked");

  // Revenue work outranked the discovery steps, because that business is the one that can be worked.
  const order = run.steps.map((s) => s.stepId);
  assert.equal(order[0], `revenue-discovery-${CC}`, `order was ${order.join(" -> ")}`);

  // The report is on disk and says what it does not know.
  const reportPath = join(artifactRoot, `${CC}-revenue-discovery.json`);
  assert.ok(existsSync(reportPath));
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(report.marketEvidenceCount, 0);
  assert.equal(report.ranking.rankable, false);
  /*
   * This runtime wires no research port, so the blocker is still correct — and that is the fix.
   *
   * An earlier version of this milestone handed revenue discovery a store-backed port unconditionally,
   * which made an empty store read as "we asked the market and found nothing" on a run that never
   * touched the network. An independent review named it: the asked-versus-unable distinction, which
   * the whole evidence design rests on, had been quietly erased. No port means no capability, and the
   * operator says so.
   */
  assert.ok(report.capabilityBlockers.length > 0,
    "a runtime with no research port must still report that it cannot ask");
  assert.match(report.capabilityBlockers[0]!, /no read-only public web research route/u);

  // The Experience Ledger recorded it against the right business.
  const ledger = createDurableExperienceLedger(deps.storeRoot);
  assert.ok(ledger.forBusiness(CC).length >= 1);

  // Status reports readiness, and other businesses are still waiting on the Owner rather than stuck.
  const status = runtimeStatus(deps);
  assert.equal(status.evidenceReadiness.find((e) => e.workspaceId === CC)!.readiness,
    "READY_FOR_REVENUE_DISCOVERY");
  assert.ok(status.needsOwnerInformation.length > 0);

  // Restart: no repeat, and the report survives.
  const second = startAutonomy(deps).run!;
  assert.ok(!second.completed.includes(`revenue-discovery-${CC}`),
    "revenue discovery repeated after restart");
  assert.ok(existsSync(reportPath));

  assert.equal(run.stopReason === "NOTHING_ELIGIBLE" || run.stopReason === "STEP_BUDGET_REACHED", true,
    `the run must stop cleanly, got ${run.stopReason}`);
});


/* -------------------------------------------------------------------------- */
/* Holes found by independent review, and now pinned shut                      */
/* -------------------------------------------------------------------------- */

test("the figure contract is the same for quantities as for money", () => {
  /* Quantities used to escape the bounds check entirely, which is the bare number, readmitted. */
  for (const state of ["KNOWN", "ESTIMATE", "HYPOTHESIS"] as const) {
    assert.throws(() => quantity({ low: null, high: null, unit: "h", state, basis: "x" }),
      /must carry both bounds/u, `a ${state} quantity with no value was accepted`);
    assert.throws(() => money({ low: 10, high: null, state, basis: "x" }),
      /must carry both bounds/u, `a half-open ${state} figure was accepted`);
  }
  assert.throws(() => money({ low: 90, high: 10, state: "ESTIMATE", basis: "x" }), /backwards/u);
  assert.throws(() => quantity({ low: 9, high: 1, unit: "h", state: "ESTIMATE", basis: "x" }), /backwards/u);
  /* And the honest default still constructs, through the same validators. */
  assert.equal(unknownMoney("nothing is known").state, "UNKNOWN");
  assert.equal(unknownQuantity("h", "nothing is known").state, "UNKNOWN");
});

test("a huge candidate with real capability refs still cannot outrank an evidenced one", () => {
  /*
   * The earlier version of this test gave the huge candidate *empty* refs, which forced NONE by a
   * different rule and would have passed even if capability-only entitlement were broken. This is
   * the shape production actually produces.
   */
  const enormous = candidate({
    opportunityId: "huge", title: "Enormous plan with a certificate",
    evidenceQuality: "MODERATE", evidenceRefs: ["cc-registration", "cc-service-area"], demandEvidence: [],
    confidence: 1, recurringPotential: "HIGH", reversibility: "REVERSIBLE",
    estimatedPrice: money({ low: 900, high: 5000, state: "HYPOTHESIS", basis: "imagined" }),
    estimatedTimeToFirstRevenue: quantity({ low: 1, high: 1, unit: "days", state: "HYPOTHESIS", basis: "imagined" }),
    estimatedCapitalRequired: money({ low: 0, high: 0, state: "HYPOTHESIS", basis: "imagined" }),
  });
  const modest = candidate({
    opportunityId: "modest", title: "Small evidenced plan",
    evidenceQuality: "WEAK", evidenceRefs: ["cc-registration", "competitor-listing-7"], demandEvidence: ["one real enquiry"],
    confidence: 0.3, recurringPotential: "LOW", reversibility: "PARTIALLY_REVERSIBLE",
    estimatedPrice: money({ low: 28, high: 32, state: "ESTIMATE", basis: "competitor-listing-7, retrieved 2026-08-22" }),
  });
  const ranking = rankCandidates([enormous, modest], KNOWN_REFS);
  assert.equal(ranking.ranked[0]!.opportunityId, "modest",
    `capability-only enormity outranked evidenced modesty: ${ranking.ranked.map((r) => r.title).join(" > ")}`);
  assert.equal(scoreCandidate(enormous, KNOWN_REFS).score, 0);
  assert.ok(scoreCandidate(modest, KNOWN_REFS).score > 0);
});

test("cancellation rate changes the answer instead of being collected and ignored", () => {
  const withRate = (pct: number) => computeUnitEconomics({
    schedule: SCHEDULE_SHAPES_V1[2]!,
    billRatePerHour: money({ low: 30, high: 30, state: "ESTIMATE", basis: "t" }),
    wagePerHour: money({ low: 15, high: 15, state: "ESTIMATE", basis: "t" }),
    payrollBurdenPct: quantity({ low: 12, high: 12, unit: "%", state: "ESTIMATE", basis: "t" }),
    cancellationRatePct: quantity({ low: pct, high: pct, unit: "%", state: "ESTIMATE", basis: "t" }),
  });
  const none = withRate(0);
  const heavy = withRate(50);
  assert.equal(none.missingInputs.length, 0);
  assert.ok(heavy.revenuePerWeek.low! < none.revenuePerWeek.low!,
    "a 50% cancellation rate produced the same revenue as none, so it was never read");
  assert.ok(heavy.contributionPerBillableHour.low! < none.contributionPerBillableHour.low!,
    "cancellations must reduce contribution: the hour is lost from revenue and kept in cost");
});

test("a summary of a fixture is not market evidence", () => {
  /* Requiring an upstream reference was not enough — nothing checked that the upstream was real. */
  const summary = buildResearchItem({
    taskId: "t", workspaceId: CC, sourceType: "DERIVED_SUMMARY",
    sourceRef: "model summary", derivedFrom: "some-fixture-id",
    retrievedAtUtc: "2026-08-22T00:00:00Z", geography: ["Polk"],
    fact: "rates are $30/hr", freshness: "CURRENT", evidenceQuality: "STRONG",
  });
  assert.equal(isRealMarketEvidence(summary), false,
    "an attributed summary counted as evidence, which readmits fixtures through the back door");
});

test("an Owner question is not its own answer", () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-owner-answer-"));
  try {
    const store = createFileBusinessEvidenceStore(dir);
    for (const source of corpusFor(CC, NOW)) store.commitImport(CC, source, NOW);

    /* A question marked resolved but pointing at no evidence must produce nothing. */
    const { question } = ensureOwnerQuestion(store, {
      workspaceId: CC,
      missingFact: "Is the business currently accepting new clients, and is there any available companion capacity today?",
      whyItMatters: "it decides whether the first experiment is demand-side or supply-side",
      blocking: true,
      evidenceNeeded: "an Owner statement",
    }, NOW);
    store.saveQuestion({ ...question, resolvedAtUtc: NOW, resolutionEvidenceId: "does-not-exist" });
    const report = runRevenueDiscovery({ workspaceId: CC, objectiveId: "o", store, now: NOW });
    assert.equal(report.marketEvidenceCount, 0,
      "a resolved question with an unresolvable answer manufactured evidence out of the question text");
    for (const question of report.ownerQuestions) {
      assert.notEqual(question, "", "an empty question is not a question");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* -------------------------------------------------------------------------- */
/* Holes found by the second independent review                                */
/* -------------------------------------------------------------------------- */

test("a dummy demand reference does not unlock the score", () => {
  /*
   * Attaching any non-empty string to `demandEvidence` used to honour the claimed quality outright,
   * which handed the ranking invariant back to whoever wrote the candidate.
   */
  const allHypothesis = candidate({
    opportunityId: "huge", title: "Enormous plan with a demand string",
    evidenceQuality: "STRONG", evidenceRefs: ["cc-registration"], demandEvidence: ["an enquiry"],
    confidence: 1, recurringPotential: "HIGH", reversibility: "REVERSIBLE",
    estimatedPrice: money({ low: 900, high: 5000, state: "HYPOTHESIS", basis: "imagined" }),
    estimatedTimeToFirstRevenue: quantity({ low: 1, high: 1, unit: "days", state: "HYPOTHESIS", basis: "imagined" }),
    estimatedCapitalRequired: money({ low: 0, high: 0, state: "HYPOTHESIS", basis: "imagined" }),
  });
  const entitled = entitledEvidenceQuality(allHypothesis, KNOWN_REFS);
  assert.equal(entitled.quality, "NONE", "a demand string unlocked a STRONG claim with no evidenced figure");
  assert.match(entitled.reason, /interest at an unknown price/u);
  assert.equal(scoreCandidate(allHypothesis, KNOWN_REFS).score, 0);

  const grounded = candidate({
    opportunityId: "modest", title: "Small evidenced plan",
    evidenceQuality: "WEAK", evidenceRefs: ["cc-registration", "competitor-listing-7"], demandEvidence: ["one real enquiry"],
    confidence: 0.3, recurringPotential: "LOW", reversibility: "PARTIALLY_REVERSIBLE",
    estimatedPrice: money({ low: 28, high: 32, state: "ESTIMATE", basis: "competitor-listing-7, retrieved 2026-08-22" }),
  });
  assert.ok(scoreCandidate(grounded, KNOWN_REFS).score > 0, "a genuinely evidenced figure must still score");
  assert.equal(rankCandidates([allHypothesis, grounded], KNOWN_REFS).ranked[0]!.opportunityId, "modest");

  /* Whitespace is not a reference. */
  assert.equal(entitledEvidenceQualityKnown(candidate({
    evidenceQuality: "STRONG", evidenceRefs: ["e"], demandEvidence: ["   "],
  })).quality, "NONE");
});

test("an imagined figure earns no component credit", () => {
  /* band() read the number and ignored its state, so invented speed and cost scored full marks. */
  const imagined = candidate({
    evidenceQuality: "WEAK", evidenceRefs: ["e", "competitor-listing-7"], demandEvidence: ["d"],
    estimatedPrice: money({ low: 30, high: 30, state: "ESTIMATE", basis: "real" }),
    estimatedTimeToFirstRevenue: quantity({ low: 1, high: 1, unit: "days", state: "HYPOTHESIS", basis: "imagined" }),
    estimatedCapitalRequired: money({ low: 0, high: 0, state: "HYPOTHESIS", basis: "imagined" }),
  });
  const components = scoreCandidate(imagined, KNOWN_REFS).components;
  assert.equal(components.find((c) => c.name === "time to first revenue, evidenced")!.value, 0,
    "a HYPOTHESIS time-to-revenue scored as though it were observed");
  assert.equal(components.find((c) => c.name === "capital required, evidenced")!.value, 0,
    "a HYPOTHESIS capital figure scored as though it were observed");
});

test("cancellation is required outright and reaches break-even", () => {
  const base = {
    schedule: SCHEDULE_SHAPES_V1[2]!,
    billRatePerHour: money({ low: 30, high: 30, state: "ESTIMATE", basis: "t" }),
    wagePerHour: money({ low: 15, high: 15, state: "ESTIMATE", basis: "t" }),
    payrollBurdenPct: quantity({ low: 12, high: 12, unit: "%", state: "ESTIMATE", basis: "t" }),
  };
  const none = computeUnitEconomics({
    ...base, cancellationRatePct: quantity({ low: 0, high: 0, unit: "%", state: "ESTIMATE", basis: "t" }),
  });
  const heavy = computeUnitEconomics({
    ...base, cancellationRatePct: quantity({ low: 50, high: 50, unit: "%", state: "ESTIMATE", basis: "t" }),
  });
  assert.ok(heavy.breakEvenUtilisationPct.low! > none.breakEvenUtilisationPct.low!,
    "break-even ignored cancellations while every neighbouring figure applied them");
});

test("an Owner answer about capacity is not market evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-owner-market-"));
  try {
    const store = createFileBusinessEvidenceStore(dir);
    for (const source of corpusFor(CC, NOW)) store.commitImport(CC, source, NOW);
    const before = runRevenueDiscovery({ workspaceId: CC, objectiveId: "o", store, now: NOW });

    const answer = store.evidence(CC).find((row) => row.value.trim() !== "")!;
    const { question } = ensureOwnerQuestion(store, {
      workspaceId: CC,
      missingFact: "Does the business currently carry general liability insurance?",
      whyItMatters: "it decides whether client-facing validation can proceed",
      blocking: true,
      evidenceNeeded: "an Owner statement",
    }, NOW);
    store.saveQuestion({ ...question, resolvedAtUtc: NOW, resolutionEvidenceId: answer.evidenceId });

    const after = runRevenueDiscovery({ workspaceId: CC, objectiveId: "o", store, now: NOW });
    assert.equal(after.marketEvidenceCount, before.marketEvidenceCount,
      "an operational Owner answer inflated the market evidence count");
    assert.ok(after.ownerEvidenceCount > before.ownerEvidenceCount,
      "the Owner answer should still be counted, just not as market evidence");
    assert.ok(!after.ownerQuestions.includes(question.missingFact),
      "an answered question was asked again");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a refused ranking explains nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-no-order-"));
  try {
    const store = createFileBusinessEvidenceStore(dir);
    for (const source of corpusFor(CC, NOW)) store.commitImport(CC, source, NOW);
    const report = runRevenueDiscovery({ workspaceId: CC, objectiveId: "o", store, now: NOW });
    assert.equal(report.ranking.rankable, false);
    assert.doesNotMatch(report.orderingExplanation, /ranks over/u,
      "a refused ranking still produced a confident ordering sentence among zeros");
    assert.match(report.orderingExplanation, /no ordering to explain/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the schedule numbers state the assumptions they rest on", () => {
  /*
   * Travel, admin and the caregiver week are not observations of this business. The direction of the
   * fragmentation penalty survives any plausible value; the percentages do not.
   */
  const comparison = compareScheduleShapes(SCHEDULE_SHAPES_V1);
  assert.ok(comparison.assumptions.length >= 3);
  assert.ok(comparison.assumptions.every((a) => /ASSUMED|policy choice/u.test(a)));
  assert.match(comparison.reason, /under the stated assumptions/u);
  assert.doesNotMatch(comparison.reason, /no plausible rate difference offsets/u);

  const capacity = caregiverCapacityFor(10, SCHEDULE_SHAPES_V1[0]!);
  assert.ok(capacity.assumptions.some((a) => /30-hour caregiver week/u.test(a)));
  assert.match(capacity.reason, /on the stated assumptions/u);
});

test("research is never run unscoped", () => {
  const port: ResearchPortV1 = {
    fetchPublicEvidence: (query) => {
      assert.ok(query.geography.length > 0, "a port was called with no geography at all");
      return [];
    },
  };
  const task = revenueResearchTasks(CC, NOW).find((t) => t.requiresPublicWeb)!;
  const unscoped = attemptResearch(task, port, []);
  assert.equal(unscoped.attempted, false, "an unscoped retrieval was attempted");
  assert.match(unscoped.detail, /not run unscoped/u);
  assert.equal(attemptResearch(task, port, ["Polk"]).attempted, true);
});

/* -------------------------------------------------------------------------- */
/* Holes found by the third independent review                                 */
/* -------------------------------------------------------------------------- */

test("an evidenced stopwatch reading is not an evidenced price", () => {
  /*
   * `evidencedFigureShare` counted any of the seven figures, so one ESTIMATE owner-time reading was
   * enough to entitle a STRONG claim — an operational measurement standing in for knowing what
   * anyone pays.
   */
  const operationalOnly = candidate({
    opportunityId: "huge", title: "Enormous plan with a stopwatch",
    evidenceQuality: "STRONG", evidenceRefs: ["cc-registration", "competitor-listing-7"], demandEvidence: ["an enquiry"],
    confidence: 1, recurringPotential: "HIGH", reversibility: "REVERSIBLE",
    estimatedPrice: money({ low: 900, high: 5000, state: "HYPOTHESIS", basis: "imagined" }),
    estimatedOwnerTime: quantity({ low: 10, high: 10, unit: "minutes", state: "ESTIMATE", basis: "timed it" }),
  });
  assert.equal(hasEvidencedPrice(operationalOnly, KNOWN_REFS), false);
  assert.equal(entitledEvidenceQuality(operationalOnly, KNOWN_REFS).quality, "NONE",
    "an operational measurement entitled a revenue claim");
  assert.equal(scoreCandidate(operationalOnly, KNOWN_REFS).score, 0);

  const priced = candidate({
    opportunityId: "modest", title: "Small evidenced plan",
    evidenceQuality: "WEAK", evidenceRefs: ["cc-registration", "competitor-listing-7"], demandEvidence: ["an enquiry"],
    recurringPotential: "LOW", reversibility: "PARTIALLY_REVERSIBLE",
    estimatedPrice: money({ low: 28, high: 32, state: "ESTIMATE", basis: "competitor-listing-7, retrieved 2026-08-22" }),
  });
  assert.equal(hasEvidencedPrice(priced, KNOWN_REFS), true);
  assert.equal(rankCandidates([operationalOnly, priced], KNOWN_REFS).ranked[0]!.opportunityId, "modest",
    "a speculative price with an evidenced stopwatch outranked an evidenced price");
});

test("schedule-derived hours are HYPOTHESIS and never claim nothing was assumed", () => {
  const result = computeUnitEconomics({
    schedule: SCHEDULE_SHAPES_V1[0]!,
    billRatePerHour: unknownMoney("no rate evidence"),
    wagePerHour: unknownMoney("no wage evidence"),
    payrollBurdenPct: unknownQuantity("%", "no burden evidence"),
    cancellationRatePct: unknownQuantity("%", "no cancellation evidence"),
  });
  assert.equal(result.paidHoursPerWeek.state, "HYPOTHESIS",
    "hours computed from unmeasured travel and admin minutes were labelled ESTIMATE");
  assert.equal(result.caregiverUtilisationPct.state, "HYPOTHESIS");
  assert.match(result.paidHoursPerWeek.basis, /assuming/u);
  assert.doesNotMatch(result.note, /Nothing was assumed/u);
});

test("the schedule comparison claims nothing about rates it has no evidence for", () => {
  const comparison = compareScheduleShapes(SCHEDULE_SHAPES_V1);
  assert.equal(comparison.structuralSpreadIsLarge, true);
  assert.doesNotMatch(comparison.reason, /defensible/u,
    "the operator asserted how big a rate difference is defensible with no rate evidence at all");
  assert.match(comparison.reason, /UNKNOWN/u);
});

test("no Owner answer counts as market evidence, however the question was worded", () => {
  /*
   * The Owner knows this business; he is not a source on what competitors charge. What actually got
   * counted was whatever row `resolutionEvidenceId` pointed at, so attaching a registration record
   * to a market-worded question would have raised the market count.
   */
  const dir = mkdtempSync(join(tmpdir(), "aion-owner-mkt-"));
  try {
    const store = createFileBusinessEvidenceStore(dir);
    for (const source of corpusFor(CC, NOW)) store.commitImport(CC, source, NOW);
    const before = runRevenueDiscovery({ workspaceId: CC, objectiveId: "o", store, now: NOW });

    const marketTask = revenueResearchTasks(CC, NOW).find((task) => task.requiresPublicWeb)!;
    const answer = store.evidence(CC).find((row) => row.value.trim() !== "")!;
    const { question } = ensureOwnerQuestion(store, {
      workspaceId: CC, missingFact: marketTask.question,
      whyItMatters: marketTask.decisionAffected, blocking: true, evidenceNeeded: "an Owner statement",
    }, NOW);
    store.saveQuestion({ ...question, resolvedAtUtc: NOW, resolutionEvidenceId: answer.evidenceId });

    const after = runRevenueDiscovery({ workspaceId: CC, objectiveId: "o", store, now: NOW });
    assert.equal(after.marketEvidenceCount, before.marketEvidenceCount,
      "a business record raised the market count by being attached to a market-worded question");
    assert.ok(after.ownerEvidenceCount > before.ownerEvidenceCount,
      "the Owner answer must still be counted, in its own column");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retrieved evidence from outside the approved counties is rejected", () => {
  const task = revenueResearchTasks(CC, NOW).find((t) => t.requiresPublicWeb)!;
  const item = (area: string) => buildResearchItem({
    taskId: task.taskId, workspaceId: CC, sourceType: "PUBLIC_WEB",
    sourceRef: `https://example.invalid/${area}`, derivedFrom: "", retrievedAtUtc: NOW,
    geography: [area], fact: `rates in ${area}`, freshness: "CURRENT", evidenceQuality: "MODERATE",
  });
  const port: ResearchPortV1 = { fetchPublicEvidence: () => [item("Polk"), item("Miami-Dade")] };

  const attempt = attemptResearch(task, port, ["Polk", "Hardee"]);
  assert.equal(attempt.items.length, 1, "an out-of-area fact was admitted as evidence for the five counties");
  assert.equal(attempt.items[0]!.geography[0], "Polk");
  assert.match(attempt.detail, /outside the authorized area/u);

  /* And an entirely out-of-area result satisfies nothing. */
  const allElsewhere: ResearchPortV1 = { fetchPublicEvidence: () => [item("Miami-Dade")] };
  assert.equal(attemptResearch(task, allElsewhere, ["Polk"]).state, "OPEN");
});

/* -------------------------------------------------------------------------- */
/* Holes found by the fourth independent review                                */
/* -------------------------------------------------------------------------- */

test("an evidenced wage or margin is not an evidenced price", () => {
  /* The gate was drawn too wide three times; each time the same substitution walked through it. */
  const wageOnly = candidate({
    opportunityId: "huge", title: "Enormous plan with a known wage",
    evidenceQuality: "STRONG", evidenceRefs: ["cc-registration", "competitor-listing-7"], demandEvidence: ["an enquiry"],
    confidence: 1, recurringPotential: "HIGH", reversibility: "REVERSIBLE",
    estimatedPrice: money({ low: 900, high: 5000, state: "HYPOTHESIS", basis: "imagined" }),
    estimatedDirectCost: money({ low: 15, high: 17, state: "ESTIMATE", basis: "a real wage posting" }),
  });
  assert.equal(hasEvidencedPrice(wageOnly, KNOWN_REFS), false, "a wage was accepted as knowing what anyone pays");
  assert.equal(entitledEvidenceQuality(wageOnly, KNOWN_REFS).quality, "NONE");
  assert.equal(scoreCandidate(wageOnly, KNOWN_REFS).score, 0);

  const marginOnly = candidate({
    opportunityId: "margin", title: "Enormous plan with a known margin",
    evidenceQuality: "STRONG", evidenceRefs: ["e", "competitor-listing-7"], demandEvidence: ["d"],
    estimatedPrice: money({ low: 900, high: 5000, state: "HYPOTHESIS", basis: "imagined" }),
    estimatedGrossMarginPct: quantity({ low: 40, high: 45, unit: "%", state: "ESTIMATE", basis: "a benchmark" }),
  });
  assert.equal(hasEvidencedPrice(marginOnly, KNOWN_REFS), false, "a ratio was accepted as a price");
  assert.equal(scoreCandidate(marginOnly, KNOWN_REFS).score, 0);

  const priced = candidate({
    opportunityId: "modest", title: "Small evidenced price",
    evidenceQuality: "WEAK", evidenceRefs: ["e", "competitor-listing-7"], demandEvidence: ["d"], recurringPotential: "LOW",
    estimatedPrice: money({ low: 28, high: 32, state: "ESTIMATE", basis: "competitor-listing-7, retrieved 2026-08-22" }),
  });
  assert.equal(rankCandidates([wageOnly, marginOnly, priced], KNOWN_REFS).ranked[0]!.opportunityId, "modest");
});

test("an UNKNOWN attribute scores zero, not a weak known value", () => {
  const known = scoreCandidateKnown(candidate({
    evidenceQuality: "WEAK", evidenceRefs: ["e", "competitor-listing-7"], demandEvidence: ["d"], recurringPotential: "LOW",
    estimatedPrice: money({ low: 28, high: 32, state: "ESTIMATE", basis: "competitor-listing-7" }),
  }));
  const unknown = scoreCandidateKnown(candidate({
    evidenceQuality: "WEAK", evidenceRefs: ["e", "competitor-listing-7"], demandEvidence: ["d"], recurringPotential: "UNKNOWN",
    estimatedPrice: money({ low: 28, high: 32, state: "ESTIMATE", basis: "competitor-listing-7" }),
  }));
  assert.equal(unknown.components.find((c) => c.name === "recurring")!.value, 0,
    "an unanswered recurrence question scored as though the answer were LOW");
  assert.ok(unknown.score < known.score, "a missing answer must not score the same as a weak one");
});

test("the structural spread field claims nothing about the market", () => {
  const comparison = compareScheduleShapes(SCHEDULE_SHAPES_V1);
  /* The field is about the calendar. The market question stays unanswered, in the field name too. */
  assert.equal(comparison.structuralSpreadIsLarge, true);
  assert.equal("structureDominates" in comparison, false,
    "the old name asserted in JSON the market claim the prose had stopped making");
});

test("an item that also describes an unauthorized area is rejected", () => {
  const task = revenueResearchTasks(CC, NOW).find((t) => t.requiresPublicWeb)!;
  const mixed = buildResearchItem({
    taskId: task.taskId, workspaceId: CC, sourceType: "PUBLIC_WEB",
    sourceRef: "https://example.invalid/statewide", derivedFrom: "", retrievedAtUtc: NOW,
    geography: ["Polk", "Miami-Dade"], fact: "statewide average rate",
    freshness: "CURRENT", evidenceQuality: "MODERATE",
  });
  const port: ResearchPortV1 = { fetchPublicEvidence: () => [mixed] };
  const attempt = attemptResearch(task, port, ["Polk", "Hardee"]);
  assert.equal(attempt.items.length, 0,
    "a statewide figure got in wearing one approved county as a badge");
  assert.equal(attempt.state, "OPEN");
});

/* -------------------------------------------------------------------------- */
/* Holes found by the fifth independent review                                 */
/* -------------------------------------------------------------------------- */

test("a figure resting on assumed overhead is never labelled KNOWN", () => {
  /*
   * `weakest` says an output is never surer than its worst input, and the call site left out the
   * worst input: paid hours, which rest on unmeasured travel and admin minutes.
   */
  const known = (low: number, high: number, unit?: string) => unit === undefined
    ? money({ low, high, state: "KNOWN", basis: "an invoice" })
    : quantity({ low, high, unit, state: "KNOWN", basis: "an invoice" });
  const result = computeUnitEconomics({
    schedule: SCHEDULE_SHAPES_V1[0]!,
    billRatePerHour: known(30, 30) as ReturnType<typeof money>,
    wagePerHour: known(15, 15) as ReturnType<typeof money>,
    payrollBurdenPct: known(12, 12, "%") as ReturnType<typeof quantity>,
    cancellationRatePct: known(0, 0, "%") as ReturnType<typeof quantity>,
  });
  assert.equal(result.revenuePerWeek.state, "KNOWN",
    "revenue is billable hours times a rate, and billable hours are exact");
  for (const [name, figure] of [
    ["labourCostPerWeek", result.labourCostPerWeek],
    ["contributionPerBillableHour", result.contributionPerBillableHour],
    ["contributionPerVisit", result.contributionPerVisit],
    ["grossMarginPct", result.grossMarginPct],
    /* breakEvenUtilisationPct is deliberately absent: the overhead cancels out of that identity. */
  ] as const) {
    assert.equal(figure.state, "HYPOTHESIS",
      `${name} was labelled ${figure.state} while resting on assumed travel and admin minutes`);
    assert.match(figure.basis, /assume/u,
      `${name} is a HYPOTHESIS whose written reason never mentions the assumption that made it one`);
    assert.match(figure.basis, /ASSUMED and not measured/u);
  }
  /* And the figure that is genuinely KNOWN must not claim an assumption it does not carry. */
  assert.doesNotMatch(result.revenuePerWeek.basis, /ASSUMED and not measured/u);
});

test("the margin range does not flatter itself past what is possible", () => {
  /* Dividing the worst contribution by the best revenue mixed two ends that cannot co-occur. */
  const result = computeUnitEconomics({
    schedule: SCHEDULE_SHAPES_V1[2]!,
    billRatePerHour: money({ low: 20, high: 50, state: "ESTIMATE", basis: "a spread of listings" }),
    wagePerHour: money({ low: 15, high: 15, state: "ESTIMATE", basis: "a posting" }),
    payrollBurdenPct: quantity({ low: 0, high: 0, unit: "%", state: "ESTIMATE", basis: "t" }),
    cancellationRatePct: quantity({ low: 0, high: 0, unit: "%", state: "ESTIMATE", basis: "t" }),
  });
  assert.ok(result.grossMarginPct.high! <= 100,
    `a gross margin of ${result.grossMarginPct.high}% is not a possible state of the world`);
  assert.ok(result.grossMarginPct.low! <= result.grossMarginPct.high!);
  assert.ok(Math.abs(result.grossMarginPct.high!
    - (result.contributionPerBillableHour.high! * result.billableHoursPerWeek / result.revenuePerWeek.high!) * 100) < 1e-6,
    "the optimistic end was clamped or re-paired rather than divided by the revenue that produced it");
  /* And each end is the contribution over the revenue that actually produced it. */
  assert.ok(Math.abs(result.grossMarginPct.low!
    - (result.contributionPerBillableHour.low! * result.billableHoursPerWeek / result.revenuePerWeek.low!) * 100) < 1e-6);
});

/* -------------------------------------------------------------------------- */
/* Holes found by the seventh independent review                               */
/* -------------------------------------------------------------------------- */

test("the assumption list reads the travel policy instead of asserting it", () => {
  const unpaid = SCHEDULE_SHAPES_V1.map((shape) => ({ ...shape, travelPaid: false }));
  const assumptions = assumptionsFor(unpaid);
  assert.ok(assumptions.some((a) => /travel treated as unpaid/u.test(a)),
    "an unpaid shape was computed one way and described the other");
  assert.ok(!assumptions.some((a) => /treated as paid time/u.test(a)));
  assert.ok(assumptionsFor(SCHEDULE_SHAPES_V1).some((a) => /treated as paid time/u.test(a)));
});

test("break-even claims no assumption it does not carry", () => {
  /*
   * Travel and admin cancel out of wage x (1 + burden) / (rate x (1 - cancel)). Forcing HYPOTHESIS
   * on it was the round-six error running in the opposite direction.
   */
  const inputs = {
    billRatePerHour: money({ low: 30, high: 30, state: "KNOWN", basis: "an invoice" }),
    wagePerHour: money({ low: 15, high: 15, state: "KNOWN", basis: "a payslip" }),
    payrollBurdenPct: quantity({ low: 12, high: 12, unit: "%", state: "KNOWN", basis: "a return" }),
    cancellationRatePct: quantity({ low: 0, high: 0, unit: "%", state: "KNOWN", basis: "the diary" }),
  };
  const scattered = computeUnitEconomics({ ...inputs, schedule: SCHEDULE_SHAPES_V1[0]! });
  const block = computeUnitEconomics({ ...inputs, schedule: SCHEDULE_SHAPES_V1[2]! });
  assert.equal(scattered.breakEvenUtilisationPct.low, block.breakEvenUtilisationPct.low,
    "break-even moved with the schedule, so it does depend on the overhead after all");
  assert.equal(scattered.breakEvenUtilisationPct.state, "KNOWN",
    "a figure the overhead cancels out of was labelled a hypothesis about the overhead");
  assert.doesNotMatch(scattered.breakEvenUtilisationPct.basis, /assume/u);
});

test("a percentage input must actually be a percentage", () => {
  const withBurden = (burden: ReturnType<typeof quantity>) => computeUnitEconomics({
    schedule: SCHEDULE_SHAPES_V1[2]!,
    billRatePerHour: money({ low: 30, high: 30, state: "ESTIMATE", basis: "t" }),
    wagePerHour: money({ low: 15, high: 15, state: "ESTIMATE", basis: "t" }),
    payrollBurdenPct: burden,
    cancellationRatePct: quantity({ low: 0, high: 0, unit: "%", state: "ESTIMATE", basis: "t" }),
  });
  /* A caller who read "fraction" and passed 0.18 must be told, not silently flattered. */
  assert.throws(() => withBurden(quantity({ low: 0.18, high: 0.18, unit: "fraction", state: "ESTIMATE", basis: "t" })),
    /must be a percentage/u);
  assert.doesNotThrow(() => withBurden(quantity({ low: 18, high: 18, unit: "percent", state: "ESTIMATE", basis: "t" })));
});

/* -------------------------------------------------------------------------- */
/* Holes found by the eighth independent review                                */
/* -------------------------------------------------------------------------- */

test("an evidenced price must cite a reference the candidate carries", () => {
  /*
   * Trusting the state alone left the invariant resting on a label: the same invented price could be
   * relabelled ESTIMATE with a basis reading "imagined" and it would rank.
   */
  const relabelled = candidate({
    opportunityId: "huge", title: "Enormous plan, relabelled",
    evidenceQuality: "STRONG", evidenceRefs: ["cc-registration", "competitor-listing-7"], demandEvidence: ["an enquiry"],
    confidence: 1, recurringPotential: "HIGH", reversibility: "REVERSIBLE",
    estimatedPrice: money({ low: 900, high: 5000, state: "ESTIMATE", basis: "imagined" }),
  });
  assert.equal(hasEvidencedPrice(relabelled, KNOWN_REFS), false,
    "an ESTIMATE label with prose for a basis passed as evidenced");
  assert.equal(scoreCandidate(relabelled, KNOWN_REFS).score, 0);

  const cited = candidate({
    opportunityId: "cited", title: "Priced against a reference",
    evidenceQuality: "WEAK", evidenceRefs: ["competitor-listing-7"], demandEvidence: ["an enquiry"],
    recurringPotential: "LOW",
    estimatedPrice: money({ low: 28, high: 32, state: "ESTIMATE", basis: "competitor-listing-7, retrieved 2026-08-22" }),
  });
  assert.equal(hasEvidencedPrice(cited, KNOWN_REFS), true, "a price citing a carried reference must still count");
  assert.equal(rankCandidates([relabelled, cited], KNOWN_REFS).ranked[0]!.opportunityId, "cited");
});

test("the companion-care models refuse to describe another business", () => {
  /*
   * These constraints are transcribed from a §400.509 certificate. Reusing them for the next ready
   * business would plan a homemaker service for a business that is not one.
   */
  assert.throws(() => candidateModels({
    workspaceId: LF, objectiveId: "o", geography: ["Polk"], evidenceRefs: [], now: NOW,
  }), /do not transfer to/u);
  assert.doesNotThrow(() => candidateModels({
    workspaceId: CC, objectiveId: "o", geography: ["Polk"], evidenceRefs: [], now: NOW,
  }));
});

test("a cancellation rate must be a percentage too", () => {
  /* The guard covered both fields; only one was pinned, so deleting the other stayed green. */
  const withCancellation = (rate: ReturnType<typeof quantity>) => computeUnitEconomics({
    schedule: SCHEDULE_SHAPES_V1[2]!,
    billRatePerHour: money({ low: 30, high: 30, state: "ESTIMATE", basis: "t" }),
    wagePerHour: money({ low: 15, high: 15, state: "ESTIMATE", basis: "t" }),
    payrollBurdenPct: quantity({ low: 12, high: 12, unit: "%", state: "ESTIMATE", basis: "t" }),
    cancellationRatePct: rate,
  });
  assert.throws(() => withCancellation(
    quantity({ low: 0.05, high: 0.05, unit: "fraction", state: "ESTIMATE", basis: "t" })),
    /cancellation rate must be a percentage/u);
  assert.doesNotThrow(() => withCancellation(
    quantity({ low: 5, high: 5, unit: "percent", state: "ESTIMATE", basis: "t" })));
});

/* -------------------------------------------------------------------------- */
/* Holes found by the ninth independent review                                 */
/* -------------------------------------------------------------------------- */

test("a candidate citing its own invented reference is not evidenced", () => {
  /*
   * Self-consistency is not traceability: two invented fields agreeing prove nothing. The refs have
   * to exist in the store the ranker was given.
   */
  const selfCiting = candidate({
    opportunityId: "huge", title: "Enormous plan citing itself",
    evidenceQuality: "STRONG", evidenceRefs: ["bogus"], demandEvidence: ["bogus"],
    confidence: 1, recurringPotential: "HIGH", reversibility: "REVERSIBLE",
    estimatedPrice: money({ low: 900, high: 5000, state: "ESTIMATE", basis: "bogus" }),
  });
  const asPrice = new Map<string, EvidenceKindV1>([["bogus", "PRICE"]]);
  assert.equal(hasEvidencedPrice(selfCiting, asPrice), true,
    "the guard must still pass when the reference genuinely exists and is price evidence");
  assert.equal(hasEvidencedPrice(selfCiting, new Map()), false,
    "a reference that exists nowhere was accepted as a citation");
  const elsewhere = new Map<string, EvidenceKindV1>([["real-ref", "PRICE"]]);
  assert.equal(entitledEvidenceQuality(selfCiting, elsewhere).quality, "NONE");
  assert.match(entitledEvidenceQuality(selfCiting, elsewhere).reason, /do not exist/u);
  assert.equal(scoreCandidate(selfCiting, elsewhere).score, 0);

  const real = candidate({
    opportunityId: "cited", title: "Priced against a real listing",
    evidenceQuality: "WEAK", evidenceRefs: ["listing-7"], demandEvidence: ["enquiry-3"],
    recurringPotential: "LOW",
    estimatedPrice: money({ low: 28, high: 32, state: "ESTIMATE", basis: "listing-7, retrieved 2026-08-22" }),
  });
  const known = new Map<string, EvidenceKindV1>([["listing-7", "PRICE"], ["enquiry-3", "DEMAND"]]);
  assert.equal(rankCandidates([selfCiting, real], known).ranked[0]!.opportunityId, "cited");
});

test("a one-letter reference does not cite itself out of a word", () => {
  /* `"imagined".includes("e")` was true, so a basis cited a reference by containing one letter. */
  const sneaky = candidate({
    evidenceQuality: "STRONG", evidenceRefs: ["e"], demandEvidence: ["e"],
    estimatedPrice: money({ low: 900, high: 5000, state: "ESTIMATE", basis: "imagined" }),
  });
  assert.equal(hasEvidencedPrice(sneaky, new Map([["e", "PRICE" as EvidenceKindV1]])), false,
    "a substring match let a letter stand in for a citation");
});

test("status surfaces the questions revenue discovery registered", async () => {
  const { mkdirSync } = await import("node:fs");
  const { startAutonomy, runtimeStatus } = await import("../src/autonomy-runtime.js");
  const root = mkdtempSync(join(tmpdir(), "aion-rd-status-"));
  temps.push(root);
  mkdirSync(join(root, "artifacts"), { recursive: true });
  const d = {
    storeRoot: join(root, "store"), artifactRoot: join(root, "artifacts"),
    now: () => NOW, currentSha: "test", provenance: "Owner portfolio direction",
  };
  startAutonomy(d);
  const evidenceStore = createFileBusinessEvidenceStore(join(d.storeRoot, "business-evidence"));
  const open = evidenceStore.questions(CC)
    .filter((question) => question.resolvedAtUtc === "")
    .map((question) => question.missingFact);
  assert.ok(open.some((q) => /general liability insurance/u.test(q)),
    "revenue discovery's Owner questions never reached the Owner-question plane");

  const status = runtimeStatus(d);
  const forCC = status.needsOwnerInformation.find((row) => row.businessId === CC);
  assert.ok(forCC !== undefined, "status showed no Owner information needed for Compassionate Choice");
  assert.ok(forCC.questions.some((q) => /general liability insurance/u.test(q)),
    "status reported the discovery artifact's questions and not the ones actually open");
});

test("a candidate row without a price or an experiment is not a sound report", async () => {
  const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
  const { startAutonomy, createDiscoveryVerifier } = await import("../src/autonomy-runtime.js");
  const { createFileAutonomyStore } = await import("../src/autonomy-store.js");
  const root = mkdtempSync(join(tmpdir(), "aion-rd-verify-"));
  temps.push(root);
  mkdirSync(join(root, "artifacts"), { recursive: true });
  const d = {
    storeRoot: join(root, "store"), artifactRoot: join(root, "artifacts"),
    now: () => NOW, currentSha: "test", provenance: "Owner portfolio direction",
  };
  startAutonomy(d);
  const reportPath = join(d.artifactRoot, `${CC}-revenue-discovery.json`);
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as { candidates: unknown[] };

  const verifier = createDiscoveryVerifier(d);
  const store = createFileAutonomyStore(d.storeRoot);
  const step = store.steps().find((row) => row.stepId.startsWith("revenue-discovery-"))!;

  assert.equal(verifier(step)[0]!.observed, true, "the real report must verify");

  /*
   * Each required field is dropped on its own.
   *
   * Both hollow fixtures used to omit everything at once, so removing any one check from the
   * verifier left the test green — the same vacuity the percentage guard had when only one of its
   * two fields was pinned.
   */
  const soundRow = report.candidates[0] as Record<string, unknown>;
  const withoutField = (path: string): Record<string, unknown> => {
    const copy = JSON.parse(JSON.stringify(soundRow)) as Record<string, unknown>;
    const [head, tail] = path.split(".");
    if (tail === undefined) delete copy[head!];
    else delete (copy[head!] as Record<string, unknown>)[tail];
    return copy;
  };

  for (const row of [
    {}, { opportunityId: "x", title: "y" },
    withoutField("opportunityId"), withoutField("title"),
    withoutField("estimatedPrice.state"), withoutField("estimatedPrice.basis"),
    withoutField("nextValidationStep.falsifiedBy"),
  ]) {
    writeFileSync(reportPath, `${JSON.stringify({ ...report, candidates: [row] }, null, 2)}\n`);
    assert.equal(verifier(step)[0]!.observed, false,
      `a candidate row missing a required field verified as a sound report: ${JSON.stringify(row).slice(0, 90)}`);
  }
});

/* -------------------------------------------------------------------------- */
/* Holes found by the tenth independent review                                 */
/* -------------------------------------------------------------------------- */

test("a capability record cannot be reclassified as demand or as a price", () => {
  /*
   * Knowing an id exists was not enough: a registration certificate is a real, store-known id, and
   * copying it into `demandEvidence` and into the price's basis made an invented figure look
   * evidenced. A record does not change what it is evidence of by being listed under a new heading.
   */
  const launderer = candidate({
    opportunityId: "huge", title: "Enormous plan citing a certificate as a price",
    evidenceQuality: "STRONG",
    evidenceRefs: ["cc-registration"], demandEvidence: ["cc-registration"],
    confidence: 1, recurringPotential: "HIGH", reversibility: "REVERSIBLE",
    estimatedPrice: money({ low: 900, high: 5000, state: "ESTIMATE", basis: "cc-registration" }),
  });
  assert.equal(hasEvidencedPrice(launderer, KNOWN_REFS), false,
    "a capability record was accepted as a price citation");
  const entitled = entitledEvidenceQuality(launderer, KNOWN_REFS);
  assert.equal(entitled.quality, "NONE");
  assert.match(entitled.reason, /anyone will pay/u,
    "the capability record was accepted as demand evidence");
  assert.equal(scoreCandidate(launderer, KNOWN_REFS).score, 0);
});

test("a fixture id never becomes a citable reference", () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-fixture-ref-"));
  try {
    const store = createFileBusinessEvidenceStore(dir);
    for (const source of corpusFor(CC, NOW)) store.commitImport(CC, source, NOW);
    const task = revenueResearchTasks(CC, NOW).find((t) => t.requiresPublicWeb)!;
    const fixture = buildResearchItem({
      taskId: task.taskId, workspaceId: CC, sourceType: "CAPTURED_FIXTURE",
      sourceRef: "test fixture", derivedFrom: "", retrievedAtUtc: NOW,
      geography: ["Polk"], fact: "rates are $30/hr", freshness: "CURRENT", evidenceQuality: "STRONG",
    });
    const port: ResearchPortV1 = { fetchPublicEvidence: () => [fixture] };
    const report = runRevenueDiscovery({
      workspaceId: CC, objectiveId: "o", store, now: NOW, researchPort: port,
    });
    assert.equal(report.marketEvidenceCount, 0);
    assert.equal(report.ranking.rankable, false,
      "a captured fixture became a citable price reference");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every figure must be grounded, not merely labelled ESTIMATE", () => {
  /* The price gate rejected this relabelling; the other components still credited it. */
  const relabelled = candidate({
    evidenceQuality: "WEAK", evidenceRefs: ["cc-registration", "competitor-listing-7"],
    demandEvidence: ["an enquiry"],
    estimatedPrice: money({ low: 28, high: 32, state: "ESTIMATE", basis: "competitor-listing-7" }),
    estimatedTimeToFirstRevenue: quantity({ low: 1, high: 1, unit: "days", state: "ESTIMATE", basis: "imagined" }),
    estimatedCapitalRequired: money({ low: 0, high: 0, state: "ESTIMATE", basis: "imagined" }),
  });
  const components = scoreCandidate(relabelled, KNOWN_REFS).components;
  assert.equal(components.find((c) => c.name === "time to first revenue, evidenced")!.value, 0,
    "an ESTIMATE label with prose for a basis earned full component credit");
  assert.equal(components.find((c) => c.name === "capital required, evidenced")!.value, 0);

  /*
   * And citing the *wrong kind* of reference does not rescue it either.
   *
   * An earlier version of this test asserted the opposite — that a rate listing cited in the capital
   * figure should score — which pinned the hole open as though it were the rule. A listing of what
   * competitors charge says nothing whatever about what this plan costs to start.
   */
  const wrongKind = candidate({
    ...relabelled,
    estimatedCapitalRequired: money({ low: 0, high: 0, state: "ESTIMATE", basis: "competitor-listing-7" }),
  });
  assert.equal(
    scoreCandidate(wrongKind, KNOWN_REFS).components.find((c) => c.name === "capital required, evidenced")!.value, 0,
    "a price listing was accepted as evidence that a plan needs no capital");

  /*
   * A wage does not ground a capital figure either.
   *
   * This assertion previously required the opposite, which is the same mistake as the rate-listing
   * one directly above: what a shift costs to run is not what a business costs to start.
   */
  const wageForCapital = candidate({
    ...relabelled,
    evidenceRefs: [...relabelled.evidenceRefs, "wage-posting-2"],
    estimatedCapitalRequired: money({ low: 0, high: 0, state: "ESTIMATE", basis: "wage-posting-2" }),
  });
  assert.equal(
    scoreCandidate(wageForCapital, KNOWN_REFS).components.find((c) => c.name === "capital required, evidenced")!.value, 0,
    "a caregiver wage was accepted as evidence that a plan needs no capital");

  /*
   * Genuine startup-cost evidence grounds it — and the magnitude buys nothing on top.
   *
   * The earlier version of this used `$0–$0` citing a real quote and asserted only "> 0", which is
   * the attack shape itself: an invented optimistic number wearing a real citation. Nothing here or
   * anywhere else checks a magnitude against the source it names, so a flattering figure must not
   * outscore an honest reading of the same quote.
   */
  const withQuote = (low: number, high: number) => candidate({
    ...relabelled,
    evidenceRefs: [...relabelled.evidenceRefs, "startup-quote-4"],
    estimatedCapitalRequired: money({ low, high, state: "ESTIMATE", basis: "startup-quote-4" }),
  });
  const honest = withQuote(500, 900);
  const fiction = withQuote(0, 0);
  assert.ok(scoreCandidate(honest, KNOWN_REFS)
    .components.find((c) => c.name === "capital required, evidenced")!.value > 0,
    "real startup-cost evidence must still ground a capital figure");
  assert.equal(scoreCandidate(fiction, KNOWN_REFS).score, scoreCandidate(honest, KNOWN_REFS).score,
    "an invented $0 outscored an honest reading of the same quote; optimism was a free lever");
});

/* -------------------------------------------------------------------------- */
/* Holes found by the eleventh independent review                              */
/* -------------------------------------------------------------------------- */

test("a reference must be evidence of the figure it is cited for", () => {
  /*
   * The price gate checked the kind and every other figure checked only that the id existed, so a
   * certificate grounded a capital claim and a wage posting grounded a price.
   */
  const base = {
    evidenceQuality: "WEAK" as const,
    evidenceRefs: ["cc-registration", "competitor-listing-7", "wage-posting-2"],
    demandEvidence: ["an enquiry"],
  };
  const priceFromWage = candidate({
    ...base,
    estimatedPrice: money({ low: 900, high: 5000, state: "ESTIMATE", basis: "wage-posting-2" }),
  });
  assert.equal(hasEvidencedPrice(priceFromWage, KNOWN_REFS), false,
    "a caregiver-wage posting was accepted as evidence of a selling price");

  const capitalFromCertificate = candidate({
    ...base,
    estimatedPrice: money({ low: 28, high: 32, state: "ESTIMATE", basis: "competitor-listing-7" }),
    estimatedCapitalRequired: money({ low: 0, high: 0, state: "ESTIMATE", basis: "cc-registration" }),
  });
  assert.equal(scoreCandidate(capitalFromCertificate, KNOWN_REFS)
    .components.find((c) => c.name === "capital required, evidenced")!.value, 0,
    "a registration certificate was accepted as evidence that a plan needs no capital");
});

test("a wage question does not produce price evidence", () => {
  const tasks = revenueResearchTasks(CC, NOW);
  const byKind = new Map(tasks.map((task) => [task.evidenceKind, task.question]));
  assert.ok(byKind.has("PRICE"), "no task asks what anyone charges");
  assert.ok(byKind.has("COST"), "the wage question must be filed as cost, not price");
  assert.match(byKind.get("COST")!, /caregivers earn/u);
  assert.match(byKind.get("PRICE")!, /charge per hour/u);
  /* Nothing AION can currently ask produces demand evidence. That is why nothing is rankable. */
  assert.equal(tasks.some((task) => task.evidenceKind === "DEMAND"), false);
});

test("port output is re-validated rather than trusted", () => {
  const task = revenueResearchTasks(CC, NOW).find((t) => t.requiresPublicWeb)!;
  const good = buildResearchItem({
    taskId: task.taskId, workspaceId: CC, sourceType: "PUBLIC_WEB",
    sourceRef: "https://example.invalid/rates", derivedFrom: "", retrievedAtUtc: NOW,
    geography: ["Polk"], fact: "rates run $28-32", freshness: "CURRENT", evidenceQuality: "MODERATE",
  });
  /* Empty fact, empty source, and someone else's workspace: all construction errors elsewhere. */
  const junk = [
    { ...good, fact: "" },
    { ...good, sourceRef: "" },
    { ...good, workspaceId: LF },
  ];
  const port: ResearchPortV1 = { fetchPublicEvidence: () => [...junk, good] };
  const attempt = attemptResearch(task, port, ["Polk"]);
  assert.equal(attempt.items.length, 1,
    "an item with no fact, no source, or another business's id was counted as market evidence");
  assert.equal(attempt.items[0]!.fact, "rates run $28-32");
});

/* -------------------------------------------------------------------------- */
/* Holes found by the twelfth independent review                               */
/* -------------------------------------------------------------------------- */

test("a retrieved item cannot bring its own id", () => {
  /*
   * `...input` came last in the constructor, so a port returning full ResearchItemV1 objects
   * overwrote the content digest with whatever id it liked — and that id is what knownRefs holds.
   */
  const task = revenueResearchTasks(CC, NOW).find((t) => t.requiresPublicWeb)!;
  const honest = buildResearchItem({
    taskId: task.taskId, workspaceId: CC, sourceType: "PUBLIC_WEB",
    sourceRef: "https://example.invalid/rates", derivedFrom: "", retrievedAtUtc: NOW,
    geography: ["Polk"], fact: "rates run $28-32", freshness: "CURRENT", evidenceQuality: "MODERATE",
  });
  const forged = { ...honest, itemId: "an-id-of-my-choosing" };
  const port: ResearchPortV1 = { fetchPublicEvidence: () => [forged] };
  const attempt = attemptResearch(task, port, ["Polk"]);
  assert.equal(attempt.items.length, 1);
  assert.notEqual(attempt.items[0]!.itemId, "an-id-of-my-choosing",
    "the port chose its own reference id, which is the id the ranker resolves citations against");
  assert.equal(attempt.items[0]!.itemId, honest.itemId,
    "the id must be the digest of the content, every time");
});

test("a fixture cannot be relabelled into being evidence", () => {
  /*
   * Every field on a retrieved row was treated as untrusted except the one that decides whether the
   * row is a fixture.
   */
  const task = revenueResearchTasks(CC, NOW).find((t) => t.requiresPublicWeb)!;
  assert.throws(() => buildResearchItem({
    taskId: task.taskId, workspaceId: CC,
    sourceType: "TEST_DOUBLE" as unknown as Parameters<typeof buildResearchItem>[0]["sourceType"],
    sourceRef: "a test", derivedFrom: "", retrievedAtUtc: NOW,
    geography: ["Polk"], fact: "rates are $30/hr", freshness: "CURRENT", evidenceQuality: "STRONG",
  }), /unknown research source type/u);

  /* A genuine fixture is still constructible, and still counts for nothing. */
  const fixture = buildResearchItem({
    taskId: task.taskId, workspaceId: CC, sourceType: "CAPTURED_FIXTURE",
    sourceRef: "a test", derivedFrom: "", retrievedAtUtc: NOW,
    geography: ["Polk"], fact: "rates are $30/hr", freshness: "CURRENT", evidenceQuality: "STRONG",
  });
  assert.equal(isRealMarketEvidence(fixture), false);
});

/* -------------------------------------------------------------------------- */
/* Holes found by the thirteenth independent review                            */
/* -------------------------------------------------------------------------- */

test("a fictional price wearing a real citation does not outrank an honest one", () => {
  /*
   * The citation gate proved a source existed; it never proved the numbers came from it. Passing it
   * used to hand back the *claimed* adjective, so STRONG on a $900-$5000 price token-citing a
   * $28-$32 listing beat the candidate that cited the same listing honestly.
   */
  const shared = {
    evidenceRefs: ["competitor-listing-7"], demandEvidence: ["an enquiry"],
    recurringPotential: "HIGH" as const, reversibility: "REVERSIBLE" as const,
  };
  const fiction = candidate({
    ...shared, opportunityId: "fiction", title: "Fiction wearing a citation",
    evidenceQuality: "STRONG", confidence: 1,
    estimatedPrice: money({ low: 900, high: 5000, state: "ESTIMATE", basis: "competitor-listing-7" }),
  });
  const honest = candidate({
    ...shared, opportunityId: "honest", title: "The same listing, read honestly",
    evidenceQuality: "WEAK", confidence: 0.3,
    estimatedPrice: money({ low: 28, high: 32, state: "ESTIMATE", basis: "competitor-listing-7" }),
  });
  assert.equal(entitledEvidenceQuality(fiction, KNOWN_REFS).quality, "WEAK",
    "a claimed STRONG survived on a citation that proves only that a source exists");
  assert.equal(scoreCandidate(fiction, KNOWN_REFS).score, scoreCandidate(honest, KNOWN_REFS).score,
    "the two differ only in numbers nobody has evidenced and an adjective; they must score the same");
});

test("a port cannot smuggle a row in through a field nobody validated", () => {
  const task = revenueResearchTasks(CC, NOW).find((t) => t.requiresPublicWeb)!;
  const good = {
    taskId: task.taskId, workspaceId: CC, sourceType: "PUBLIC_WEB" as const,
    sourceRef: "https://example.invalid/rates", derivedFrom: "", retrievedAtUtc: NOW,
    geography: ["Polk"], fact: "rates run $28-32",
    freshness: "CURRENT" as const, evidenceQuality: "MODERATE" as const,
  };
  type Input = Parameters<typeof buildResearchItem>[0];
  for (const [name, bad] of [
    ["a lowercase quality", { ...good, evidenceQuality: "none" }],
    ["a padded quality", { ...good, evidenceQuality: "STRONG " }],
    ["an invented quality", { ...good, evidenceQuality: "CERTAIN" }],
    ["a missing quality", { ...good, evidenceQuality: undefined }],
    ["an invented freshness", { ...good, freshness: "FRESH" }],
    ["no geography at all", { ...good, geography: [] }],
    ["a geography that is not an array", { ...good, geography: "Polk" }],
    ["a non-string area", { ...good, geography: [7] }],
  ] as const) {
    assert.throws(() => buildResearchItem(bad as unknown as Input), `${name} was accepted`);
  }
});

test("a malformed row is counted, not thrown out of the run", () => {
  /* The geography filter used to call .length and .toLowerCase() on whatever arrived. */
  const task = revenueResearchTasks(CC, NOW).find((t) => t.requiresPublicWeb)!;
  const port: ResearchPortV1 = {
    fetchPublicEvidence: () => ([
      { taskId: task.taskId, workspaceId: CC, sourceType: "PUBLIC_WEB", sourceRef: "x",
        derivedFrom: "", retrievedAtUtc: NOW, fact: "something", freshness: "CURRENT",
        evidenceQuality: "MODERATE" },
    ] as unknown as ReturnType<ResearchPortV1["fetchPublicEvidence"]>),
  };
  const attempt = attemptResearch(task, port, ["Polk"]);
  assert.equal(attempt.items.length, 0);
  assert.match(attempt.detail, /malformed/u,
    "a row with no geography took the run down instead of being reported");
});

test("a second ready business is reported, not crashed into", () => {
  /*
   * Readiness is workspace-agnostic; the candidate models belong to one certificate. A business
   * AION has no models for is a result — "nothing to discover with yet" — not a failed step.
   */
  assert.equal(hasCandidateModels(CC), true);
  assert.equal(hasCandidateModels(LF), false);
  assert.throws(() => candidateModels({
    workspaceId: LF, objectiveId: "o", geography: ["Polk"], evidenceRefs: [], now: NOW,
  }), /do not transfer to/u);
});

/* -------------------------------------------------------------------------- */
/* Holes found by the fourteenth independent review                            */
/* -------------------------------------------------------------------------- */

test("the same enquiry listed twice is one source", () => {
  /*
   * `.length` counted mentions, so repeating one reference reached STRONG and a 1.0 multiplier.
   *
   * The fixture grounds four of the seven figures so the share test passes and cost is grounded —
   * otherwise both candidates land on MODERATE for an unrelated reason and the Set is never
   * exercised. Duplicate versus distinct is the only difference between these two.
   */
  const grounded = {
    evidenceQuality: "STRONG" as const,
    evidenceRefs: ["competitor-listing-7", "wage-posting-2", "startup-quote-4"],
    estimatedPrice: money({ low: 28, high: 32, state: "ESTIMATE", basis: "competitor-listing-7" }),
    estimatedDirectCost: money({ low: 15, high: 17, state: "ESTIMATE", basis: "wage-posting-2" }),
    /* A margin cites both sides, because it is one divided by the other. */
    estimatedGrossMarginPct: quantity({
      low: 40, high: 45, unit: "%", state: "ESTIMATE",
      basis: "competitor-listing-7 over wage-posting-2",
    }),
    estimatedCapitalRequired: money({ low: 500, high: 900, state: "ESTIMATE", basis: "startup-quote-4" }),
  };
  const twice = candidate({ ...grounded, demandEvidence: ["an enquiry", "an enquiry"] });
  const distinct = candidate({ ...grounded, demandEvidence: ["an enquiry", "enquiry-3"] });

  assert.equal(entitledEvidenceQuality(distinct, KNOWN_REFS).quality, "STRONG",
    "two distinct demand sources with grounded price, cost and capital should reach STRONG");
  assert.equal(entitledEvidenceQuality(twice, KNOWN_REFS).quality, "MODERATE",
    "one enquiry listed twice was counted as two independent demand sources");
  assert.ok(scoreCandidate(twice, KNOWN_REFS).score < scoreCandidate(distinct, KNOWN_REFS).score);
});

test("the derivation is fail-closed when called on its own", () => {
  /*
   * It leaned on entitledEvidenceQuality having checked price and demand first, and returned WEAK
   * with a reason asserting "an evidenced price and some demand" whether or not there was any.
   */
  const nothing = candidate({ evidenceQuality: "STRONG", evidenceRefs: [], demandEvidence: [] });
  const derived = derivedEvidenceQuality(nothing, KNOWN_REFS);
  assert.equal(derived.quality, "NONE");
  assert.match(derived.reason, /neither an evidenced price nor any demand/u);

  const priceOnly = candidate({
    evidenceQuality: "STRONG", evidenceRefs: ["competitor-listing-7"], demandEvidence: [],
    estimatedPrice: money({ low: 28, high: 32, state: "ESTIMATE", basis: "competitor-listing-7" }),
  });
  assert.equal(derivedEvidenceQuality(priceOnly, KNOWN_REFS).quality, "NONE");
  assert.match(derivedEvidenceQuality(priceOnly, KNOWN_REFS).reason, /no demand evidence/u);
});

test("an Owner statement from a port is not market evidence", () => {
  /* Excluding fixtures and summaries left this vocabulary member walking straight in. */
  const task = revenueResearchTasks(CC, NOW).find((t) => t.requiresPublicWeb)!;
  const asOwner = buildResearchItem({
    taskId: task.taskId, workspaceId: CC, sourceType: "OWNER_STATEMENT",
    sourceRef: "a port claiming to be the Owner", derivedFrom: "", retrievedAtUtc: NOW,
    geography: ["Polk"], fact: "rates are $90/hr", freshness: "CURRENT", evidenceQuality: "STRONG",
  });
  assert.equal(isRealMarketEvidence(asOwner), false,
    "a port returning an OWNER_STATEMENT row was counted as market evidence");
  const port: ResearchPortV1 = { fetchPublicEvidence: () => [asOwner] };
  assert.equal(attemptResearch(task, port, ["Polk"]).state, "OPEN",
    "the task was satisfied by a row that is not market evidence");
});

test("a business with no service area does not take the run down", () => {
  /*
   * buildResearchItem now requires a geography, and Owner-answer ingestion passes the workspace's
   * service area — empty for a business that has none.
   */
  const dir = mkdtempSync(join(tmpdir(), "aion-no-area-"));
  try {
    const store = createFileBusinessEvidenceStore(dir);
    for (const source of corpusFor(LF, NOW)) store.commitImport(LF, source, NOW);
    const answer = store.evidence(LF).find((row) => row.value.trim() !== "");
    if (answer !== undefined) {
      const { question } = ensureOwnerQuestion(store, {
        workspaceId: LF, missingFact: "What does this business actually sell?",
        whyItMatters: "everything downstream depends on it", blocking: true,
        evidenceNeeded: "an Owner statement",
      }, NOW);
      store.saveQuestion({ ...question, resolvedAtUtc: NOW, resolutionEvidenceId: answer.evidenceId });
    }
    assert.equal(currentGeography(store.evidence(LF)).length, 0, "the fixture must have no approved area");
    assert.doesNotThrow(() => runRevenueDiscovery({ workspaceId: LF, objectiveId: "o", store, now: NOW }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a ready business with no models is reported rather than silently skipped", async () => {
  const { mkdirSync } = await import("node:fs");
  const { startAutonomy, runtimeStatus } = await import("../src/autonomy-runtime.js");
  const root = mkdtempSync(join(tmpdir(), "aion-no-models-"));
  temps.push(root);
  mkdirSync(join(root, "artifacts"), { recursive: true });
  const d = {
    storeRoot: join(root, "store"), artifactRoot: join(root, "artifacts"),
    now: () => NOW, currentSha: "test", provenance: "Owner portfolio direction",
  };
  const run = startAutonomy(d).run!;

  /* Compassionate Choice is ready AND has models, so it is scheduled and does not appear here. */
  const status = runtimeStatus(d);
  assert.ok(run.completed.includes(`revenue-discovery-${CC}`));
  assert.equal(status.readyWithoutRevenueModels.includes(CC), false);

  /*
   * Now make a second business genuinely ready.
   *
   * The seeded corpus gives only Compassionate Choice a service area, so the interesting case did
   * not exist and this test asserted nothing about it — a hardcoded empty list would have satisfied
   * it. LocalFinds is given the two claims readiness actually gates on.
   */
  const evidenceStore = createFileBusinessEvidenceStore(join(d.storeRoot, "business-evidence"));
  evidenceStore.commitImport(LF, {
    sourceClass: "OWNER_STATEMENT",
    reference: "Owner statement, for this test only",
    readable: true,
    content: "localfinds-ready-fixture",
    observedAtUtc: NOW,
    claims: [
      { subject: "LocalFinds", claim: CLAIM_V1.status, value: "REGISTERED", asserted: "KNOWN" },
      { subject: "LocalFinds", claim: CLAIM_V1.serviceArea, value: "Polk", asserted: "KNOWN" },
    ],
  }, NOW);

  const after = runtimeStatus(d);
  const lf = after.evidenceReadiness.find((entry) => entry.workspaceId === LF)!;
  assert.equal(lf.readiness, "READY_FOR_REVENUE_DISCOVERY", "the fixture must actually make it ready");
  assert.equal(hasCandidateModels(LF), false);
  assert.ok(after.readyWithoutRevenueModels.includes(LF),
    "a ready business with no models was skipped without being reported anywhere");

  /*
   * And a second run refuses to *schedule* it — checked on the step store, not on `completed`.
   *
   * Asserting the step is absent from `run.completed` was satisfied by a step that was created,
   * dispatched, threw inside `candidateModels` and was recorded FAILED. "Never scheduled" and
   * "scheduled and failed" are exactly the two outcomes this gate exists to distinguish, and only
   * the step store can tell them apart.
   */
  const { createFileAutonomyStore } = await import("../src/autonomy-store.js");
  const second = startAutonomy(d).run;
  const steps = createFileAutonomyStore(d.storeRoot).steps();
  assert.equal(steps.some((step) => step.stepId === `revenue-discovery-${LF}`), false,
    "a revenue-discovery step was created for a business AION has no models for");
  assert.equal(second?.failed.length ?? 0, 0,
    "a step failed; the gate is supposed to prevent scheduling, not to be caught by the kernel");
});

/* -------------------------------------------------------------------------- */
/* Holes found by the seventeenth independent review                           */
/* -------------------------------------------------------------------------- */

test("a margin needs both sides, not whichever it cites first", () => {
  /*
   * A gross margin is price over cost. Grounding it on a rate listing alone counted that one listing
   * twice — once for the price it evidences and once for a margin it says nothing about — and four
   * "grounded" figures from three sources is what tipped the share test into STRONG.
   */
  const refs = ["competitor-listing-7", "wage-posting-2"];
  const priceOnly = candidate({
    evidenceQuality: "STRONG", evidenceRefs: refs, demandEvidence: ["an enquiry", "enquiry-3"],
    estimatedPrice: money({ low: 28, high: 32, state: "ESTIMATE", basis: "competitor-listing-7" }),
    estimatedDirectCost: money({ low: 15, high: 17, state: "ESTIMATE", basis: "wage-posting-2" }),
    estimatedGrossMarginPct: quantity({ low: 40, high: 45, unit: "%", state: "ESTIMATE", basis: "competitor-listing-7" }),
  });
  assert.equal(
    isGroundedFigure(priceOnly.estimatedGrossMarginPct, priceOnly, KNOWN_REFS, ["PRICE", "COST"]), false,
    "a rate listing alone was accepted as evidence of a margin");

  const bothSides = candidate({
    ...priceOnly,
    estimatedGrossMarginPct: quantity({
      low: 40, high: 45, unit: "%", state: "ESTIMATE",
      basis: "competitor-listing-7 over wage-posting-2",
    }),
  });
  assert.equal(
    isGroundedFigure(bothSides.estimatedGrossMarginPct, bothSides, KNOWN_REFS, ["PRICE", "COST"]), true,
    "citing both sides must still ground a margin");
  assert.ok(evidencedFigureShare(bothSides, KNOWN_REFS) > evidencedFigureShare(priceOnly, KNOWN_REFS));
});

/* -------------------------------------------------------------------------- */
/* Holes found by the nineteenth independent review                            */
/* -------------------------------------------------------------------------- */

test("one operational source does not evidence three different questions", () => {
  /*
   * `OPERATIONAL` was a bucket, so one Care.com page cited three times would have evidenced how long
   * the Owner spends, how many hours the work takes, and how soon revenue arrives. They are three
   * questions with three sources.
   */
  const priced = {
    evidenceQuality: "WEAK" as const,
    evidenceRefs: ["competitor-listing-7", "care-dot-com-product-page", "owner-time-study-1"],
    demandEvidence: ["an enquiry"],
    estimatedPrice: money({ low: 28, high: 32, state: "ESTIMATE", basis: "competitor-listing-7" }),
  };
  const oneSourceForAll = candidate({
    ...priced,
    estimatedOwnerTime: quantity({ low: 10, high: 10, unit: "minutes", state: "ESTIMATE", basis: "care-dot-com-product-page" }),
    estimatedWorkerHours: quantity({ low: 1, high: 1, unit: "hours", state: "ESTIMATE", basis: "care-dot-com-product-page" }),
    estimatedTimeToFirstRevenue: quantity({ low: 1, high: 1, unit: "days", state: "ESTIMATE", basis: "care-dot-com-product-page" }),
  });
  const components = scoreCandidate(oneSourceForAll, KNOWN_REFS).components;
  assert.equal(components.find((c) => c.name === "Owner time, evidenced")!.value, 0,
    "a supplier product page was accepted as evidence of how long the Owner spends");
  assert.equal(components.find((c) => c.name === "time to first revenue, evidenced")!.value, 0,
    "a supplier product page was accepted as evidence of how soon revenue arrives");

  /*
   * The case that actually pins the split: a genuine owner-time study cited on time-to-revenue.
   * Merging the three kinds back into one bucket would ground this; keeping them apart cannot.
   */
  const rightFamilyWrongQuestion = candidate({
    ...priced,
    estimatedTimeToFirstRevenue: quantity({ low: 1, high: 1, unit: "days", state: "ESTIMATE", basis: "owner-time-study-1" }),
    estimatedWorkerHours: quantity({ low: 1, high: 1, unit: "hours", state: "ESTIMATE", basis: "owner-time-study-1" }),
  });
  assert.equal(
    isGroundedFigure(rightFamilyWrongQuestion.estimatedTimeToFirstRevenue, rightFamilyWrongQuestion,
      KNOWN_REFS, FIGURE_EVIDENCE_KINDS_V1["estimatedTimeToFirstRevenue"]!), false,
    "an owner-time study was accepted as evidence of how soon revenue arrives");
  assert.equal(
    isGroundedFigure(rightFamilyWrongQuestion.estimatedWorkerHours, rightFamilyWrongQuestion,
      KNOWN_REFS, FIGURE_EVIDENCE_KINDS_V1["estimatedWorkerHours"]!), false,
    "an owner-time study was accepted as evidence of how many hours the work takes");
  /* And each right-question source does ground its own figure. */
  const properly = candidate({
    ...priced,
    evidenceRefs: [...priced.evidenceRefs, "shift-log-9", "onboarding-timeline-3"],
    estimatedWorkerHours: quantity({ low: 1, high: 1, unit: "hours", state: "ESTIMATE", basis: "shift-log-9" }),
    estimatedTimeToFirstRevenue: quantity({ low: 30, high: 45, unit: "days", state: "ESTIMATE", basis: "onboarding-timeline-3" }),
  });
  assert.equal(
    isGroundedFigure(properly.estimatedWorkerHours, properly, KNOWN_REFS,
      FIGURE_EVIDENCE_KINDS_V1["estimatedWorkerHours"]!), true);
  assert.equal(
    isGroundedFigure(properly.estimatedTimeToFirstRevenue, properly, KNOWN_REFS,
      FIGURE_EVIDENCE_KINDS_V1["estimatedTimeToFirstRevenue"]!), true);

  /* The right source for the right question still counts. */
  const rightSource = candidate({
    ...priced,
    estimatedOwnerTime: quantity({ low: 10, high: 10, unit: "minutes", state: "ESTIMATE", basis: "owner-time-study-1" }),
  });
  assert.equal(scoreCandidate(rightSource, KNOWN_REFS)
    .components.find((c) => c.name === "Owner time, evidenced")!.value, 1,
    "a genuine owner-time study must still ground owner time");
  assert.ok(scoreCandidate(rightSource, KNOWN_REFS).score > scoreCandidate(oneSourceForAll, KNOWN_REFS).score);
});

test("no research task claims to evidence an operational figure", () => {
  /* Nothing AION can currently ask answers owner time, worker hours, or time to revenue. */
  const kinds = new Set(revenueResearchTasks(CC, NOW).map((task) => task.evidenceKind));
  for (const kind of ["OWNER_TIME", "WORKER_HOURS", "TIME_TO_REVENUE"] as const) {
    assert.equal(kinds.has(kind), false,
      `a task claims to produce ${kind} evidence; nothing AION can ask actually answers that`);
  }
});

test("an Owner answer that could not be recorded is still asked about", () => {
  /*
   * A resolved question whose item cannot be built was stripped from ownerQuestions while
   * contributing nothing — the report said neither "we learned this" nor "we still need to ask".
   */
  const dir = mkdtempSync(join(tmpdir(), "aion-unbuildable-"));
  try {
    /*
     * Compassionate Choice, with the service area withheld.
     *
     * The questions are its questions, so the mechanism has to be exercised on it — and the item
     * build fails exactly when there is no approved area to attach to the answer.
     */
    const store = createFileBusinessEvidenceStore(dir);
    for (const source of corpusFor(CC, NOW)) {
      store.commitImport(CC, {
        ...source,
        claims: source.claims.filter((claim) => claim.claim !== CLAIM_V1.serviceArea),
      }, NOW);
    }
    const answer = store.evidence(CC).find((row) => row.value.trim() !== "");
    assert.ok(answer !== undefined, "the fixture needs at least one evidence row to point at");
    assert.equal(currentGeography(store.evidence(CC)).length, 0, "and no approved service area");

    const ownerTask = revenueResearchTasks(CC, NOW).find((task) => task.requiresOwner)!;
    const { question } = ensureOwnerQuestion(store, {
      workspaceId: CC, missingFact: ownerTask.question,
      whyItMatters: ownerTask.decisionAffected, blocking: true, evidenceNeeded: "an Owner statement",
    }, NOW);
    store.saveQuestion({ ...question, resolvedAtUtc: NOW, resolutionEvidenceId: answer!.evidenceId });

    const report = runRevenueDiscovery({ workspaceId: CC, objectiveId: "o", store, now: NOW });
    assert.equal(report.ownerEvidenceCount, 0, "nothing was recorded, so nothing should be counted");
    assert.ok(report.ownerQuestions.includes(ownerTask.question),
      "the question was dropped as answered while nothing was actually learned from it");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* -------------------------------------------------------------------------- */
/* Holes found by the twenty-first independent review                          */
/* -------------------------------------------------------------------------- */

test("retrieved research is kept where it can be audited", () => {
  /*
   * The items lived only inside the ephemeral attempts array, so the sole trace of a retrieval was a
   * number nobody could check. Nothing read `researchItems` or `itemIds`, so removing the retention
   * left the suite green.
   */
  const dir = mkdtempSync(join(tmpdir(), "aion-retain-"));
  try {
    const store = createFileBusinessEvidenceStore(dir);
    for (const source of corpusFor(CC, NOW)) store.commitImport(CC, source, NOW);

    const priceTask = revenueResearchTasks(CC, NOW).find((task) => task.evidenceKind === "PRICE")!;
    const port: ResearchPortV1 = {
      fetchPublicEvidence: (query) => query.question !== priceTask.question ? [] : [buildResearchItem({
        taskId: priceTask.taskId, workspaceId: CC, sourceType: "PUBLIC_WEB",
        sourceRef: "https://example.invalid/rates", derivedFrom: "", retrievedAtUtc: NOW,
        geography: ["Polk"], fact: "comparable agencies list $28-$32/hr, 2-hour minimum",
        freshness: "CURRENT", evidenceQuality: "MODERATE",
      })],
    };
    const report = runRevenueDiscovery({
      workspaceId: CC, objectiveId: "o", store, now: NOW, researchPort: port,
    });

    assert.equal(report.marketEvidenceCount, 1, "the retrieval should have counted");
    const retained = report.researchItems.find((item) => item.sourceRef.includes("example.invalid"));
    assert.ok(retained !== undefined, "the count went up and the item behind it was thrown away");
    assert.equal(retained.fact, "comparable agencies list $28-$32/hr, 2-hour minimum");
    assert.deepEqual(retained.geography, ["Polk"]);
    assert.equal(retained.sourceType, "PUBLIC_WEB");

    const task = report.researchTasks.find((row) => row.taskId === priceTask.taskId)!;
    assert.deepEqual(task.itemIds, [retained.itemId],
      "a satisfied task must name what satisfied it");
    assert.equal(task.state, "SATISFIED");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the verifier enforces the figure contract, not the shape of a string", async () => {
  const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
  const { startAutonomy, createDiscoveryVerifier } = await import("../src/autonomy-runtime.js");
  const { createFileAutonomyStore } = await import("../src/autonomy-store.js");
  /*
   * JSON.stringify and back is a construction path around `money()`. Checking that `state` and
   * `basis` are non-empty strings verified `{ state: "KNOWN", basis: "because I said so" }` with no
   * bounds at all.
   */
  const dir = mkdtempSync(join(tmpdir(), "aion-contract-"));
  temps.push(dir);
  const artifactRoot = join(dir, "artifacts");
  mkdirSync(artifactRoot, { recursive: true });
  const d = {
    storeRoot: join(dir, "store"), artifactRoot,
    now: () => NOW, currentSha: "test", provenance: "Owner portfolio direction",
  };
  startAutonomy(d);
  const reportPath = join(artifactRoot, `${CC}-revenue-discovery.json`);
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as { candidates: Record<string, unknown>[] };
  const sound = report.candidates[0]!;
  const verifier = createDiscoveryVerifier(d);
  const step = createFileAutonomyStore(d.storeRoot).steps().find((row) => row.stepId.startsWith("revenue-discovery-"))!;

  const withPrice = (price: unknown) => ({ ...sound, estimatedPrice: price });
  for (const [name, price] of [
    ["no bounds on a KNOWN price", { state: "KNOWN", basis: "because I said so", currency: "USD" }],
    ["an empty basis", { low: 28, high: 32, state: "ESTIMATE", basis: "   ", currency: "USD" }],
    ["an UNKNOWN carrying a value", { low: 28, high: 32, state: "UNKNOWN", basis: "x", currency: "USD" }],
    ["a backwards range", { low: 90, high: 10, state: "ESTIMATE", basis: "x", currency: "USD" }],
    ["a half-open range", { low: 28, high: null, state: "ESTIMATE", basis: "x", currency: "USD" }],
    ["no price at all", undefined],
  ] as const) {
    writeFileSync(reportPath, `${JSON.stringify({ ...report, candidates: [withPrice(price)] }, null, 2)}\n`);
    assert.equal(verifier(step)[0]!.observed, false, `${name} verified as a sound report`);
  }

  /* And the genuine report still verifies. */
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  assert.equal(verifier(step)[0]!.observed, true, "the real report must still verify");
});

test("the verifier checks every figure, not only the price", () => {
  /* The price was re-validated and the other six were taken on trust, through the same JSON path. */
  const dir = mkdtempSync(join(tmpdir(), "aion-allfigures-"));
  temps.push(dir);
  return (async () => {
    const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
    const { startAutonomy, createDiscoveryVerifier } = await import("../src/autonomy-runtime.js");
    const { createFileAutonomyStore } = await import("../src/autonomy-store.js");
    const artifactRoot = join(dir, "artifacts");
    mkdirSync(artifactRoot, { recursive: true });
    const d = {
      storeRoot: join(dir, "store"), artifactRoot,
      now: () => NOW, currentSha: "test", provenance: "Owner portfolio direction",
    };
    startAutonomy(d);
    const reportPath = join(artifactRoot, `${CC}-revenue-discovery.json`);
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as { candidates: Record<string, unknown>[] };
    const sound = report.candidates[0]!;
    const verifier = createDiscoveryVerifier(d);
    const step = createFileAutonomyStore(d.storeRoot).steps()
      .find((row) => row.stepId.startsWith("revenue-discovery-"))!;

    for (const name of [
      "estimatedDirectCost", "estimatedGrossMarginPct", "estimatedOwnerTime",
      "estimatedWorkerHours", "estimatedCapitalRequired", "estimatedTimeToFirstRevenue",
    ]) {
      const asQuantity = ["estimatedGrossMarginPct", "estimatedOwnerTime",
        "estimatedWorkerHours", "estimatedTimeToFirstRevenue"].includes(name);
      const broken = {
        ...sound,
        [name]: asQuantity
          ? { state: "KNOWN", basis: "because I said so", unit: "hours" }
          : { state: "KNOWN", basis: "because I said so" },
      };
      writeFileSync(reportPath, `${JSON.stringify({ ...report, candidates: [broken] }, null, 2)}
`);
      assert.equal(verifier(step)[0]!.observed, false,
        `${name} with no bounds verified as a sound report`);
    }
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}
`);
    assert.equal(verifier(step)[0]!.observed, true, "the real report must still verify");
  })();
});

test("a validator hands back a copy, not the caller's object", () => {
  /* A validator that returns its input validates a moment, not a value. */
  const input = { low: 1, high: 2, unit: "hours", state: "ESTIMATE" as const, basis: "a shift log" };
  const validated = quantity(input);
  assert.notEqual(validated, input, "quantity() returned the caller's own object");
  assert.deepEqual(validated, input);
  const cash = { low: 1, high: 2, state: "ESTIMATE" as const, basis: "a listing" };
  assert.notEqual(money(cash) as unknown, cash as unknown);
});

test("economics treat an absent bound as absent, not as present", () => {
  /* `=== null` said a figure with no `low` at all had one. */
  const noLow = { high: 32, unit: "", state: "ESTIMATE", basis: "a listing" } as unknown as ReturnType<typeof money>;
  const result = computeUnitEconomics({
    schedule: SCHEDULE_SHAPES_V1[2]!,
    billRatePerHour: noLow,
    wagePerHour: money({ low: 15, high: 17, state: "ESTIMATE", basis: "a posting" }),
    payrollBurdenPct: quantity({ low: 12, high: 12, unit: "%", state: "ESTIMATE", basis: "a return" }),
    cancellationRatePct: quantity({ low: 0, high: 0, unit: "%", state: "ESTIMATE", basis: "the diary" }),
  });
  assert.ok(result.missingInputs.includes("bill rate per hour"),
    "a rate with no low bound was treated as a rate AION knows");
  assert.equal(result.revenuePerWeek.low, null);
});
