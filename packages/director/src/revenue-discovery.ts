/**
 * The revenue discovery operator.
 *
 * It reads business evidence, forms candidates, computes what economics it can, ranks them if
 * ranking means anything, and otherwise says what it would need to learn. The candidates are
 * hypotheses about a companion-care business, and they are labelled as hypotheses throughout — AION
 * has no market evidence for this business, and the operator's most useful current output is a
 * precise account of that.
 *
 * Two things it will not do. It will not multiply a hypothetical price by a hypothetical demand and
 * present the product as a forecast. And it will not let pending geography into current market
 * sizing: `currentGeography` comes from the evidence record for the approved service area, and a
 * candidate outside it is rejected rather than discounted.
 */

import {
  ACTIONABLE_STATES_V1,
  type BusinessEvidenceV1,
} from "./business-evidence.js";
import type { BusinessEvidenceStoreV1 } from "./business-evidence-store.js";
import { CLAIM_V1, COMPASSIONATE_CHOICE_WORKSPACE_V1 } from "./business-corpus.js";
import {
  assumptionsFor,
  compareScheduleShapes,
  computeUnitEconomics,
  type ScheduleShapeV1,
  type UnitEconomicsV1,
} from "./revenue-economics.js";
import {
  REVENUE_OPPORTUNITY_SCHEMA_V1,
  money,
  quantity,
  unknownMoney,
  unknownQuantity,
  type EvidenceKindV1,
  type RevenueOpportunityV1,
} from "./revenue-opportunity.js";
import { explainOrdering, rankCandidates, type RankingV1 } from "./revenue-scoring.js";
import {
  attemptResearch,
  isRealMarketEvidence,
  ownerResearchItem,
  type ResearchItemV1,
  revenueResearchTasks,
  type ResearchPortV1,
  type ResearchTaskV1,
} from "./revenue-research.js";

export const REVENUE_REPORT_SCHEMA_V1 = "aion.director.revenueDiscoveryReport.v1" as const;

/** The service-area evidence, or nothing. Never a default, never pending geography. */
export function currentGeography(evidence: readonly BusinessEvidenceV1[]): readonly string[] {
  const area = evidence.find(
    (row) => row.claim === CLAIM_V1.serviceArea
      && row.supersededBy === ""
      && ACTIONABLE_STATES_V1.includes(row.state),
  );
  if (area === undefined) return [];
  return area.value.split(",").map((county) => county.trim()).filter(Boolean);
}

/** Pending expansion, for display only. A caller that mixes this into `currentGeography` is wrong. */
export function pendingGeography(evidence: readonly BusinessEvidenceV1[]): readonly string[] {
  const pending = evidence.filter(
    (row) => row.claim === CLAIM_V1.serviceAreaPending && row.supersededBy === "",
  );
  return pending.map((row) => row.value);
}

/**
 * The schedule shapes worth comparing.
 *
 * Same billable hours in every row, which is what makes the comparison mean something: any
 * difference in the output comes from structure alone.
 */
export const SCHEDULE_SHAPES_V1: readonly ScheduleShapeV1[] = Object.freeze([
  {
    label: "5 x 1-hour scattered visits",
    visitsPerWeek: 5, hoursPerVisit: 1,
    travelMinutesPerVisit: 25, travelPaid: true, adminMinutesPerVisit: 6,
  },
  {
    label: "2 x 2.5-hour visits",
    visitsPerWeek: 2, hoursPerVisit: 2.5,
    travelMinutesPerVisit: 25, travelPaid: true, adminMinutesPerVisit: 6,
  },
  {
    label: "1 x 5-hour block",
    visitsPerWeek: 1, hoursPerVisit: 5,
    travelMinutesPerVisit: 25, travelPaid: true, adminMinutesPerVisit: 6,
  },
]);

function hypothesisCandidate(input: {
  workspaceId: string;
  objectiveId: string;
  id: string;
  title: string;
  mechanism: string;
  buyer: string;
  service: string;
  geography: readonly string[];
  evidenceRefs: readonly string[];
  compliance: readonly string[];
  recurring: RevenueOpportunityV1["recurringPotential"];
  repeatability: RevenueOpportunityV1["repeatability"];
  automation: RevenueOpportunityV1["automationPotential"];
  criticalUnknowns: readonly string[];
  experimentTitle: string;
  testsUncertainty: string;
  falsifiedBy: string;
  now: string;
}): RevenueOpportunityV1 {
  return {
    schema: REVENUE_OPPORTUNITY_SCHEMA_V1,
    opportunityId: input.id,
    workspaceId: input.workspaceId,
    objectiveId: input.objectiveId,
    title: input.title,
    revenueMechanism: input.mechanism,
    targetBuyerHypothesis: input.buyer,
    serviceHypothesis: input.service,
    geography: input.geography,
    evidenceRefs: input.evidenceRefs,
    // Empty, and that is the finding. No demand evidence exists for this business.
    demandEvidence: [],
    deliveryCapabilityEvidence: input.evidenceRefs,
    complianceConstraints: input.compliance,
    /* Every figure UNKNOWN. Not a placeholder — the honest state before any market research. */
    estimatedPrice: unknownMoney("no local pricing evidence has been gathered"),
    estimatedDirectCost: unknownMoney("no local wage evidence has been gathered"),
    estimatedGrossMarginPct: unknownQuantity("percent", "derived from price and cost, both unknown"),
    estimatedOwnerTime: unknownQuantity("minutes per week", "depends on scheduling load, not yet observed"),
    estimatedWorkerHours: unknownQuantity("hours per week per client", "depends on the package shape chosen"),
    estimatedCapitalRequired: unknownMoney("no capital requirement has been established"),
    estimatedTimeToFirstRevenue: unknownQuantity("days", "depends on client acquisition, which is unevidenced"),
    recurringPotential: input.recurring,
    repeatability: input.repeatability,
    automationPotential: input.automation,
    reversibility: "REVERSIBLE",
    // Deliberately low. High confidence in an unevidenced hypothesis is the failure mode itself.
    confidence: 0.2,
    evidenceQuality: "NONE",
    criticalUnknowns: input.criticalUnknowns,
    nextValidationStep: {
      title: input.experimentTitle,
      testsUncertainty: input.testsUncertainty,
      falsifiedBy: input.falsifiedBy,
      outwardEffectRequired: false,
      ownerTimeMinutes: 20,
      readiness: "NEEDS_MORE_RESEARCH",
    },
    readiness: "NEEDS_MORE_RESEARCH",
    status: "CANDIDATE",
    rejectionReason: "",
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * Candidate revenue models for a §400.509 companion service.
 *
 * These are hypotheses drawn from the *documented service scope*, not from market research. Each one
 * is a thing the business is legally permitted to sell; none is a thing anyone has evidence people
 * will buy, and every figure on them is `UNKNOWN`.
 *
 * **These models are specific to a §400.509 companion service and to no other business.** The
 * compliance constraints below are transcribed from that certificate, not read from the store — the
 * doc comment claimed otherwise, which would have been a citation nobody could follow. And because
 * they are certificate-specific, calling this for another workspace would plan a homemaker service
 * for a business that is not one: it throws instead.
 */
/**
 * Whether AION has candidate revenue models for a business at all.
 *
 * Asked before the models are built rather than discovered by exception. `assessRevenueReadiness` is
 * workspace-agnostic — legal status plus a service area makes any business ready — so a second ready
 * business would have reached `candidateModels`, thrown, and failed the Director step. "We have no
 * models for this business yet" is a result and should be reported as one, not as a crash.
 */
export function hasCandidateModels(workspaceId: string): boolean {
  return workspaceId === COMPASSIONATE_CHOICE_WORKSPACE_V1;
}

export function candidateModels(input: {
  workspaceId: string;
  objectiveId: string;
  geography: readonly string[];
  evidenceRefs: readonly string[];
  now: string;
}): readonly RevenueOpportunityV1[] {
  if (!hasCandidateModels(input.workspaceId)) {
    throw new Error(
      `these candidate models describe a §400.509 companion service and do not transfer to ${input.workspaceId};`
      + " a business without its own evidenced models has no revenue candidates yet, which is a result, not a gap",
    );
  }
  const compliance = [
    "no hands-on personal care under §400.509",
    "service limited to the counties on the certificate",
    "registration number required in all advertising",
  ];
  const base = { ...input, compliance, evidenceRefs: input.evidenceRefs, geography: input.geography };

  return [
    hypothesisCandidate({
      ...base,
      id: "cc-recurring-block",
      title: "Recurring weekly companionship block",
      mechanism: "recurring private-pay package, one longer visit per week",
      buyer: "an adult child arranging regular company and household help for a parent",
      service: "companionship, meal preparation, laundry, errands, in one block",
      recurring: "HIGH", repeatability: "HIGH", automation: "LOW",
      criticalUnknowns: [
        "what families in these counties actually pay per hour",
        "whether a longer minimum block is acceptable to buyers",
        "whether caregiver capacity exists for a fixed weekly slot",
      ],
      experimentTitle: "Compare block-length acceptance against scattered visits at equal weekly cost",
      testsUncertainty: "whether buyers accept a longer minimum visit, which is what makes the economics work",
      falsifiedBy: "buyers consistently preferring several short visits at the same weekly spend",
      now: input.now,
    }),
    hypothesisCandidate({
      ...base,
      id: "cc-family-relief",
      title: "Family-relief check-in plan",
      mechanism: "recurring lower-hour plan bought by a remote family member",
      buyer: "an out-of-area adult child who cannot check in themselves",
      service: "short regular visits, wellbeing observation, household tasks, reporting back",
      recurring: "HIGH", repeatability: "HIGH", automation: "MEDIUM",
      criticalUnknowns: [
        "whether short visits can ever be margin-positive given travel",
        "whether remote families are reachable without paid acquisition",
      ],
      experimentTitle: "Model the shortest visit length that clears contribution margin",
      testsUncertainty: "whether the product this buyer wants is one the schedule can afford to deliver",
      falsifiedBy: "no visit length short enough to sell being long enough to be profitable",
      now: input.now,
    }),
    hypothesisCandidate({
      ...base,
      id: "cc-continuity-premium",
      title: "Consistent assigned companion, at a premium",
      mechanism: "premium recurring package guaranteeing the same caregiver each visit",
      buyer: "a family whose main complaint about agencies is rotating strangers",
      service: "the same companion, same slot, every week",
      recurring: "HIGH", repeatability: "MEDIUM", automation: "LOW",
      criticalUnknowns: [
        "whether continuity commands a real price premium here",
        "whether staffing depth allows a continuity guarantee at all",
        "what happens to the guarantee when a caregiver leaves",
      ],
      experimentTitle: "Establish whether continuity is priced by comparable agencies",
      testsUncertainty: "whether continuity is a differentiator buyers pay for or one they assume",
      falsifiedBy: "comparable agencies offering continuity as standard at no premium",
      now: input.now,
    }),
    hypothesisCandidate({
      ...base,
      id: "cc-outing-companionship",
      title: "Appointment and outing companionship",
      mechanism: "per-occasion booking around appointments and errands",
      buyer: "a family needing someone present for an appointment they cannot attend",
      service: "accompaniment and company; no transport provided by the business",
      recurring: "LOW", repeatability: "MEDIUM", automation: "LOW",
      criticalUnknowns: [
        "whether this is viable at all when the business does not provide transport",
        "whether occasional bookings can fill a caregiver's week",
      ],
      experimentTitle: "Check whether the no-transport policy makes this unsellable",
      testsUncertainty: "whether buyers want accompaniment without a ride, which is the only version on offer",
      falsifiedBy: "buyer demand being predominantly for transport the business has chosen not to provide",
      now: input.now,
    }),
  ];
}

/* -------------------------------------------------------------------------- */
/* The report                                                                  */
/* -------------------------------------------------------------------------- */

export interface RevenueDiscoveryReportV1 {
  readonly schema: typeof REVENUE_REPORT_SCHEMA_V1;
  readonly workspaceId: string;
  readonly generatedAtUtc: string;
  readonly knownBusinessState: readonly string[];
  readonly currentGeography: readonly string[];
  readonly pendingGeography: readonly string[];
  /** Real market evidence only. Owner answers about this business are counted separately. */
  readonly marketEvidenceCount: number;
  /** Operational facts the Owner has supplied. Useful, but not evidence about the market. */
  readonly ownerEvidenceCount: number;
  /**
   * Every research item behind the counts, retrieved or supplied by the Owner.
   *
   * Kept so the counts can be argued with rather than believed: source, geography, fact, freshness
   * and quality all travel with the number they produced.
   */
  readonly researchItems: readonly ResearchItemV1[];
  readonly candidates: readonly RevenueOpportunityV1[];
  readonly scheduleComparison: ReturnType<typeof compareScheduleShapes>;
  readonly unitEconomics: readonly UnitEconomicsV1[];
  /** Whether staffing becomes the constraint before demand does. Arithmetic, not market data. */
  readonly caregiverCapacityAtTenClients: ReturnType<typeof caregiverCapacityFor>;
  /** Why the leading candidate leads, when there is more than one. */
  readonly orderingExplanation: string;
  readonly ranking: RankingV1;
  readonly criticalUnknowns: readonly string[];
  readonly researchTasks: readonly ResearchTaskV1[];
  readonly capabilityBlockers: readonly string[];
  readonly ownerQuestions: readonly string[];
  readonly nextDecision: string;
}

/**
 * Run discovery for a business.
 *
 * The order matters: geography first, because a candidate outside the approved counties is not a
 * worse candidate but an illegal one; then candidates; then whatever economics the inputs allow;
 * then ranking, which will decline while nothing is evidenced; then the research that would change
 * that.
 */
export function runRevenueDiscovery(input: {
  workspaceId: string;
  objectiveId: string;
  store: BusinessEvidenceStoreV1;
  now: string;
  researchPort?: ResearchPortV1 | null;
}): RevenueDiscoveryReportV1 {
  const evidence = input.store.evidence(input.workspaceId);
  const live = evidence.filter((row) => row.supersededBy === "");
  const geography = currentGeography(evidence);

  const knownBusinessState = live
    .filter((row) => ACTIONABLE_STATES_V1.includes(row.state))
    .map((row) => `${row.claim}: ${row.value}`);

  /*
   * Models, then geography — in that order, because they answer different questions.
   *
   * `geography.length === 0` was standing in for "AION has models for this business", so a ready
   * non-Compassionate-Choice workspace with a service area went straight into `candidateModels` and
   * threw. Having an approved area says where a business may work; it says nothing about whether
   * anyone has written down what it could sell.
   */
  const candidates = !hasCandidateModels(input.workspaceId) || geography.length === 0
    ? []
    : candidateModels({
      workspaceId: input.workspaceId,
      objectiveId: input.objectiveId,
      geography,
      evidenceRefs: live
        .filter((row) => ACTIONABLE_STATES_V1.includes(row.state))
        .map((row) => row.evidenceId),
      now: input.now,
    });

  /* Economics with the inputs that exist, which is currently none of the money ones. */
  const unitEconomics = SCHEDULE_SHAPES_V1.map((schedule) => {
    const economics = computeUnitEconomics({
      billRatePerHour: unknownMoney("no local pricing evidence"),
      wagePerHour: unknownMoney("no local wage evidence"),
      payrollBurdenPct: unknownQuantity("percent", "not established for this business"),
      cancellationRatePct: unknownQuantity("percent", "no operating history observed"),
      schedule,
    });
    return economics;
  });

  /*
   * Staffing, answered without market data.
   *
   * Ten clients is an arbitrary planning figure and is labelled as one, but the arithmetic is not:
   * it says whether hiring becomes the constraint before demand does, which decides whether the
   * milestone after this one is revenue or recruiting.
   */
  const capacityAtTenClients = caregiverCapacityFor(10, SCHEDULE_SHAPES_V1[2]!);

  const tasks = revenueResearchTasks(input.workspaceId, input.now);
  const port = input.researchPort ?? null;
  const attempts = tasks.map((task) => {
    const attempt = attemptResearch(task, port, geography);
    return attempt;
  });
  const resolvedTasks = tasks.map((task, index) => ({
    ...task,
    state: attempts[index]!.state,
    blockedReason: attempts[index]!.state === "BLOCKED_BY_CAPABILITY" ? attempts[index]!.detail : "",
    /* The ids of what was actually retrieved, so a satisfied task can be traced to its answer. */
    itemIds: attempts[index]!.items.map((item) => item.itemId),
  }));

  const capabilityBlockers = [...new Set(
    attempts.filter((a) => a.state === "BLOCKED_BY_CAPABILITY").map((a) => a.detail),
  )];
  /*
   * Resolved Owner questions are evidence — but only the answer is, and the answer is not on the
   * question.
   *
   * `missingFact` is the *prompt* ("Is the business accepting new clients?"). An earlier version
   * recorded that string as the fact, which manufactured a MODERATE-quality evidence item whose
   * content was the question — the count went up while nothing had been learned. The answer lives in
   * the evidence store under `resolutionEvidenceId`, written there by Owner intake. A question whose
   * answer cannot be resolved yields no item at all: an unresolvable pointer is not a fact.
   */
  const evidenceById = new Map(input.store.evidence(input.workspaceId).map((row) => [row.evidenceId, row]));
  const resolvedQuestions = input.store.questions(input.workspaceId)
    .filter((question) => question.resolvedAtUtc !== "");
  const ownerAnswered = resolvedQuestions
    .map((question) => {
      const answer = evidenceById.get(question.resolutionEvidenceId);
      if (answer === undefined || answer.value.trim() === "") return null;
      /*
       * A business with no approved area yet still has answers worth keeping.
       *
       * `buildResearchItem` now requires a geography, and this call passes the workspace's current
       * service area — which is empty for a business that has none. The throw propagated out of
       * revenue discovery and would have failed the Director step, which is precisely the failure
       * mode the malformed-row counting was added to remove. An item that cannot be built is one
       * item skipped, not a run lost.
       */
      try {
        const item = ownerResearchItem({
          taskId: question.questionId,
          workspaceId: input.workspaceId,
          answer: `${answer.subject}: ${answer.value}`,
          geography,
          now: question.resolvedAtUtc,
        });
        return item;
      } catch {
        return null;
      }
    })
    .filter((item): item is ResearchItemV1 => item !== null);

  /*
   * A question counts as answered only if an answer was actually built from it.
   *
   * This read the evidence row directly, so a resolved question whose item could not be constructed
   * — an empty service area makes `ownerResearchItem` throw, and that throw is caught above — was
   * stripped from `ownerQuestions` while contributing nothing to `ownerEvidenceCount` or
   * `knownRefs`. The report then said neither "we learned this" nor "we still need to ask", which is
   * the one outcome that is never true.
   */
  const answeredQuestionIds = new Set(ownerAnswered.map((item) => item.taskId));
  const answeredFacts = new Set(resolvedQuestions
    .filter((question) => answeredQuestionIds.has(question.questionId))
    .map((question) => question.missingFact));

  const ownerQuestions = resolvedTasks
    .filter((task) => task.state === "NEEDS_OWNER_INFORMATION")
    .sort((a, b) => b.informationGain - a.informationGain)
    .map((task) => task.question)
    .filter((question) => !answeredFacts.has(question));


  /*
   * Market evidence and Owner evidence are counted separately, because they are not the same thing.
   *
   * An Owner answer about capacity or insurance is real evidence and is genuinely useful, but it is
   * an operational fact about this business, not a fact about the market. Adding it to
   * `marketEvidenceCount` made the market look better understood every time an operational question
   * closed. Only an Owner answer to a question that would otherwise have needed the public web
   * counts as market evidence. Fixtures and summaries count as neither, which is why these are
   * filters and not lengths.
   */
  const realOf = (items: readonly ResearchItemV1[]) => items.filter((item) => {
    const real = isRealMarketEvidence(item);
    return real;
  }).length;
  /*
   * No Owner answer counts as market evidence, whatever question it closed.
   *
   * A previous version tried to let an answer to a market-worded question count, on the reasoning
   * that the Owner is currently the only source who can answer anything. But what actually gets
   * counted is whatever row `resolutionEvidenceId` points at, and nothing here can check that the
   * row is about the market rather than about this business — so a registration record could raise
   * the market count by being attached to a market-worded question. The Owner knows this business;
   * he is not a source on what competitors charge. Owner answers are counted, in their own column.
   */
  const marketEvidenceCount = attempts.reduce((sum, attempt) => sum + realOf(attempt.items), 0);
  /*
   * Owner answers are counted by being Owner answers.
   *
   * This used `realOf`, which asks whether something is *market* evidence — and an Owner statement
   * deliberately is not, so the Owner column read zero however many questions he had answered. Each
   * item here has already been through `buildResearchItem`, so it carries a source, a date and a
   * fact; there is nothing further to qualify it against.
   */
  const ownerEvidenceCount = ownerAnswered.length;
  /*
   * The reference ids that actually exist, handed to the ranker.
   *
   * Without this the ranker could only compare a candidate against itself, and a candidate that
   * cites its own invented id was indistinguishable from one citing a real record.
   */
  const knownRefs = new Map<string, EvidenceKindV1>();

  /*
   * Business evidence is CAPABILITY evidence, and nothing here promotes it.
   *
   * Registration, service area, provider type: every one is a fact about what the business may do.
   * They were handed over as bare ids, so copying one into `demandEvidence` reclassified it by
   * assertion. The store knows what these records are; the ranker is told, and the gates ask.
   */
  for (const row of input.store.evidence(input.workspaceId)) knownRefs.set(row.evidenceId, "CAPABILITY");

  /*
   * A retrieved fact is evidence of whatever its question asked about.
   *
   * Filing every retrieval as PRICE meant a caregiver-wage posting could ground a selling price, and
   * a Care.com product page could too. The task carries the kind; the item inherits it. Fixtures and
   * derived summaries are excluded before this point and so are never citable at all.
   */
  for (const [index, attempt] of attempts.entries()) {
    const kind = tasks[index]!.evidenceKind;
    for (const item of attempt.items) {
      if (!isRealMarketEvidence(item)) continue;
      knownRefs.set(item.itemId, kind);
    }
  }

  /* An Owner answer is a fact about this business, which is capability, not demand and not price. */
  for (const item of ownerAnswered) knownRefs.set(item.itemId, "CAPABILITY");
  const ranking = rankCandidates(candidates, knownRefs);

  /*
   * Everything retrieved, kept.
   *
   * The items lived only inside the ephemeral `attempts` array, so the sole surviving trace of a
   * successful retrieval was a number — `marketEvidenceCount` — that nobody could audit. A reader
   * could not see the source, the geography, the fact, or whether a fixture had slipped through, and
   * the provenance rules exist precisely so that those things can be looked at.
   */
  const researchItems = [...attempts.flatMap((attempt) => attempt.items), ...ownerAnswered];

  const criticalUnknowns = [...new Set(candidates.flatMap((c) => c.criticalUnknowns))];

  /* Why the leader leads, as a sentence rather than a paragraph somebody writes later. */
  /*
   * A refused ranking gets no explanation of its order.
   *
   * When every candidate scores 0 the sort falls back to opportunity id, and explaining *that* order
   * produced a confident "A ranks over B (0.000 against 0.000)" sentence underneath a report whose
   * whole point is that it will not rank. The explanation is the theatre the ranker refuses.
   */
  const orderingExplanation = !ranking.rankable
    ? `there is no ordering to explain: ${ranking.reason}`
    : ranking.ranked.length >= 2
      ? explainOrdering(ranking.ranked[0]!, ranking.ranked[1]!)
      : "fewer than two candidates; there is no ordering to explain";

  const nextDecision = ranking.rankable
    ? `Run the validation experiment for ${ranking.ranked[0]?.title ?? "the leading candidate"}.`
    : capabilityBlockers.length > 0
      ? `Nothing can be ranked yet. The highest-information research needs a capability AION does not have,`
        + ` so the next decision is the Owner's: ${ownerQuestions.length} question(s) that do not need the web,`
        + ` or authorize read-only public research.`
      : `Nothing can be ranked yet; answer the open research tasks first.`;

  return {
    schema: REVENUE_REPORT_SCHEMA_V1,
    workspaceId: input.workspaceId,
    generatedAtUtc: input.now,
    knownBusinessState,
    currentGeography: geography,
    pendingGeography: pendingGeography(evidence),
    marketEvidenceCount,
    ownerEvidenceCount,
    researchItems,
    candidates,
    scheduleComparison: compareScheduleShapes(SCHEDULE_SHAPES_V1),
    unitEconomics,
    caregiverCapacityAtTenClients: capacityAtTenClients,
    orderingExplanation,
    ranking,
    criticalUnknowns,
    researchTasks: resolvedTasks,
    capabilityBlockers,
    ownerQuestions,
    nextDecision,
  };
}

/**
 * How much caregiver capacity a candidate would need, and whether staffing is the next constraint.
 *
 * Answerable without market data, because it is arithmetic about the calendar rather than a claim
 * about the world — which currently makes it one of the few things worth saying.
 */
export function caregiverCapacityFor(clients: number, schedule: ScheduleShapeV1): {
  readonly paidHoursPerWeek: number;
  readonly caregiversNeededFullTime: number;
  readonly likelyNextBottleneck: boolean;
  readonly assumptions: readonly string[];
  readonly reason: string;
} {
  const billable = clients * schedule.visitsPerWeek * schedule.hoursPerVisit;
  const overhead = clients * schedule.visitsPerWeek
    * ((schedule.travelPaid ? schedule.travelMinutesPerVisit : 0) + schedule.adminMinutesPerVisit) / 60;
  const paid = billable + overhead;
  /*
   * An ASSUMED 30-hour caregiver week. Nobody has measured this workforce, and the number changes
   * the headcount directly — 25 hours or 35 would move it by a fifth either way. It is stated in the
   * result rather than left in a comment, because a reader cannot otherwise tell an assumption from
   * a finding.
   */
  const assumedWeeklyHours = 30;
  const caregivers = paid / assumedWeeklyHours;
  return {
    paidHoursPerWeek: Number(paid.toFixed(1)),
    caregiversNeededFullTime: Number(caregivers.toFixed(2)),
    likelyNextBottleneck: caregivers > 1,
    assumptions: [
      `an ASSUMED ${assumedWeeklyHours}-hour caregiver week, not measured for this workforce`,
      ...assumptionsFor([schedule]),
    ],
    reason: caregivers > 1
      ? `on the stated assumptions, ${clients} clients on this shape needs about ${caregivers.toFixed(1)} caregivers;`
        + ` hiring becomes the constraint before demand does`
      : `on the stated assumptions, ${clients} clients on this shape fits within one caregiver's week;`
        + ` demand is the constraint, not staffing`,
  };
}
