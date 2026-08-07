import type { IsoTimestamp, OpaqueId, ProvenanceV1 } from "./contracts.js";
import type { KnowledgeClaimV1 } from "./knowledge.js";
import { claimBalance, settledClaims } from "./knowledge.js";

/**
 * Product Studio.
 *
 * An idea is not a product and a hunch is not a market. The purpose of this domain is to keep an
 * opportunity honest as it grows: what is actually known, what is being assumed on purpose, what
 * would have to be true, and what has been tested. AION never invents market evidence — it has no
 * way to know what customers want, and pretending otherwise would be the most expensive kind of
 * confidence.
 *
 * Scoring is deliberately arithmetic and visible. It combines only numbers the owner entered and
 * the proportion of the opportunity's claims that are actually settled, so a well-argued idea with
 * nothing behind it scores low and says why. There is no model in this file.
 */

export type OpportunityStageV1 =
  | "idea" | "exploring" | "validating" | "specified" | "building" | "launched" | "parked" | "abandoned";
export const OPPORTUNITY_STAGES: readonly OpportunityStageV1[] = [
  "idea", "exploring", "validating", "specified", "building", "launched", "parked", "abandoned",
];

export type ExperimentStatusV1 = "proposed" | "running" | "supported" | "refuted" | "inconclusive" | "abandoned";
export const EXPERIMENT_STATUSES: readonly ExperimentStatusV1[] = ["proposed", "running", "supported", "refuted", "inconclusive", "abandoned"];

/** A test of one hypothesis. The outcome is recorded whatever it is, including the boring ones. */
export interface ValidationExperimentV1 {
  id: OpaqueId;
  /** The claim this experiment is testing. An experiment without a hypothesis is just activity. */
  hypothesisId: OpaqueId | null;
  title: string;
  method: string;
  /** Written before running it, so the result cannot be reinterpreted afterwards to fit. */
  successCriteria: string;
  status: ExperimentStatusV1;
  result: string;
  createdAt: IsoTimestamp;
  completedAt: IsoTimestamp | null;
}

export interface CompetitorNoteV1 {
  id: OpaqueId;
  name: string;
  /** Owner-supplied only. AION does not look a competitor up, and says so where this is shown. */
  observation: string;
  sourceRef: string;
  notedAt: IsoTimestamp;
}

export interface OpportunityScoreV1 {
  /** Each 0-10, entered by the owner. AION never scores a market for them. */
  problemSeverity: number;
  reachability: number;
  ownerAdvantage: number;
  effort: number;
  /** 0-100, derived from the claims actually recorded. Not an opinion. */
  evidenceStrength: number;
  /** The arithmetic result, and the sentence explaining how it was reached. */
  total: number;
  explanation: string;
}

export interface ProductSpecificationV1 {
  summary: string;
  audience: string;
  mustHave: string[];
  wontHave: string[];
  successMeasure: string;
  updatedAt: IsoTimestamp;
}

export interface OpportunityV1 {
  id: OpaqueId;
  workspace: string;
  title: string;
  problem: string;
  targetCustomer: string;
  proposedSolution: string;
  distributionHypothesis: string;
  pricingHypothesis: string;
  businessModel: string;
  risks: string[];
  stage: OpportunityStageV1;
  /** Everything known, assumed, or guessed about this opportunity, each carrying its class. */
  claims: KnowledgeClaimV1[];
  competitors: CompetitorNoteV1[];
  experiments: ValidationExperimentV1[];
  specification: ProductSpecificationV1 | null;
  /** Manual owner inputs; the derived score is computed, never stored as an opinion. */
  scoreInputs: { problemSeverity: number; reachability: number; ownerAdvantage: number; effort: number };
  /** Links out to the rest of AION rather than a parallel universe of records. */
  taskIds: OpaqueId[];
  planIds: OpaqueId[];
  researchJobIds: OpaqueId[];
  projectIds: OpaqueId[];
  relationshipIds: OpaqueId[];
  launchReadiness: string;
  results: string;
  lessons: string[];
  archived: boolean;
  provenance: ProvenanceV1;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

function fail(message: string): never { throw new Error(message); }

function text(value: unknown, label: string, max: number, required = true): string {
  if (value === undefined || value === null || value === "") { if (required) fail(`${label} is required.`); return ""; }
  if (typeof value !== "string" || value.length > max) fail(`${label} is invalid.`);
  const trimmed = value.trim();
  if (required && !trimmed) fail(`${label} is required.`);
  return trimmed;
}
function list(value: unknown, label: string, max = 40, itemMax = 2000): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) fail(`${label} is invalid.`);
  return value.map((entry) => text(entry, label, itemMax));
}
function score(value: unknown, label: string): number {
  if (value === undefined || value === null) return 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 10) fail(`${label} must be a whole number between 0 and 10.`);
  return value as number;
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string, fallback?: T): T {
  if (value === undefined || value === null || value === "") { if (fallback !== undefined) return fallback; fail(`${label} is required.`); }
  if (typeof value !== "string" || !allowed.includes(value as T)) fail(`${label} must be one of: ${allowed.join(", ")}.`);
  return value as T;
}

export function buildOpportunity(input: Record<string, unknown>, context: { id: OpaqueId; workspace: string; now: IsoTimestamp }): OpportunityV1 {
  return {
    id: context.id,
    workspace: context.workspace,
    title: text(input.title, "Opportunity title", 200),
    problem: text(input.problem, "Problem", 4000, false),
    targetCustomer: text(input.targetCustomer, "Target customer", 2000, false),
    proposedSolution: text(input.proposedSolution, "Proposed solution", 4000, false),
    distributionHypothesis: text(input.distributionHypothesis, "Distribution hypothesis", 2000, false),
    pricingHypothesis: text(input.pricingHypothesis, "Pricing hypothesis", 2000, false),
    businessModel: text(input.businessModel, "Business model", 2000, false),
    risks: list(input.risks, "Risk"),
    stage: oneOf(input.stage, OPPORTUNITY_STAGES, "Opportunity stage", "idea"),
    claims: [], competitors: [], experiments: [], specification: null,
    scoreInputs: {
      problemSeverity: score(input.problemSeverity, "Problem severity"),
      reachability: score(input.reachability, "Reachability"),
      ownerAdvantage: score(input.ownerAdvantage, "Owner advantage"),
      effort: score(input.effort, "Effort"),
    },
    taskIds: [], planIds: [], researchJobIds: [], projectIds: [], relationshipIds: [],
    launchReadiness: "", results: "", lessons: [],
    archived: false,
    provenance: { sourceType: "owner", sourceRef: "owner-entry", recordedAt: context.now },
    createdAt: context.now,
    updatedAt: context.now,
  };
}

const EDITABLE = [
  "title", "problem", "targetCustomer", "proposedSolution", "distributionHypothesis",
  "pricingHypothesis", "businessModel", "risks", "stage",
  "problemSeverity", "reachability", "ownerAdvantage", "effort",
  "launchReadiness", "results", "lessons",
];

export function applyOpportunityEdit(opportunity: OpportunityV1, change: Record<string, unknown>, now: IsoTimestamp): OpportunityV1 {
  const unexpected = Object.keys(change).filter((key) => !EDITABLE.includes(key));
  if (unexpected.length) fail(`An opportunity edit accepts only ${EDITABLE.join(", ")}; unexpected field(s): ${unexpected.join(", ")}.`);
  const next = structuredClone(opportunity);
  if ("title" in change) next.title = text(change.title, "Opportunity title", 200);
  if ("problem" in change) next.problem = text(change.problem, "Problem", 4000, false);
  if ("targetCustomer" in change) next.targetCustomer = text(change.targetCustomer, "Target customer", 2000, false);
  if ("proposedSolution" in change) next.proposedSolution = text(change.proposedSolution, "Proposed solution", 4000, false);
  if ("distributionHypothesis" in change) next.distributionHypothesis = text(change.distributionHypothesis, "Distribution hypothesis", 2000, false);
  if ("pricingHypothesis" in change) next.pricingHypothesis = text(change.pricingHypothesis, "Pricing hypothesis", 2000, false);
  if ("businessModel" in change) next.businessModel = text(change.businessModel, "Business model", 2000, false);
  if ("risks" in change) next.risks = list(change.risks, "Risk");
  if ("stage" in change) next.stage = oneOf(change.stage, OPPORTUNITY_STAGES, "Opportunity stage");
  for (const key of ["problemSeverity", "reachability", "ownerAdvantage", "effort"] as const) {
    if (key in change) next.scoreInputs[key] = score(change[key], key);
  }
  if ("launchReadiness" in change) next.launchReadiness = text(change.launchReadiness, "Launch readiness", 4000, false);
  if ("results" in change) next.results = text(change.results, "Results", 8000, false);
  if ("lessons" in change) next.lessons = list(change.lessons, "Lesson");
  next.updatedAt = now;
  return next;
}

export function buildCompetitorNote(input: Record<string, unknown>, context: { id: OpaqueId; now: IsoTimestamp }): CompetitorNoteV1 {
  return {
    id: context.id,
    name: text(input.name, "Competitor name", 200),
    observation: text(input.observation, "Competitor observation", 4000),
    // A note with no source is an impression, and it says so rather than reading like research.
    sourceRef: text(input.sourceRef, "Competitor source", 500, false) || "owner-impression (not researched)",
    notedAt: context.now,
  };
}

export function buildExperiment(input: Record<string, unknown>, context: { id: OpaqueId; now: IsoTimestamp }): ValidationExperimentV1 {
  return {
    id: context.id,
    hypothesisId: input.hypothesisId === undefined || input.hypothesisId === null ? null : text(input.hypothesisId, "Hypothesis reference", 200),
    title: text(input.title, "Experiment title", 200),
    method: text(input.method, "Experiment method", 4000),
    successCriteria: text(input.successCriteria, "Success criteria", 2000),
    status: "proposed",
    result: "",
    createdAt: context.now,
    completedAt: null,
  };
}

/**
 * Records how an experiment turned out.
 *
 * A refuted or inconclusive result is a first-class outcome with the same weight as a supported
 * one. Nothing here lets a result be edited into a different result later, because an experiment
 * whose conclusion can drift is not evidence of anything.
 */
export function completeExperiment(experiment: ValidationExperimentV1, status: unknown, result: string, now: IsoTimestamp): ValidationExperimentV1 {
  if (experiment.completedAt) fail("That experiment already has a recorded result. Record a new experiment rather than changing a finished one.");
  const next = structuredClone(experiment);
  next.status = oneOf(status, EXPERIMENT_STATUSES, "Experiment status");
  if (next.status === "proposed") fail("Completing an experiment needs an actual outcome, not the proposed state.");
  next.result = text(result, "Experiment result", 8000, false);
  if (next.status !== "running") next.completedAt = now;
  return next;
}

export function buildSpecification(input: Record<string, unknown>, now: IsoTimestamp): ProductSpecificationV1 {
  return {
    summary: text(input.summary, "Specification summary", 8000),
    audience: text(input.audience, "Specification audience", 2000, false),
    mustHave: list(input.mustHave, "Must-have", 60),
    wontHave: list(input.wontHave, "Won't-have", 60),
    successMeasure: text(input.successMeasure, "Success measure", 2000, false),
    updatedAt: now,
  };
}

/**
 * Scores an opportunity from numbers the owner entered and evidence AION can actually count.
 *
 * The arithmetic is stated in the explanation because a score whose derivation is hidden is just
 * an opinion wearing a number. Evidence strength is the share of live claims that are settled, so
 * an opportunity built entirely from assumptions cannot score well no matter how good it sounds.
 */
export function scoreOpportunity(opportunity: OpportunityV1): OpportunityScoreV1 {
  const { problemSeverity, reachability, ownerAdvantage, effort } = opportunity.scoreInputs;
  const live = opportunity.claims.filter((claim) => claim.enabled && !claim.supersededBy);
  const settled = settledClaims(live).length;
  const evidenceStrength = live.length ? Math.round((settled / live.length) * 100) : 0;
  // Value is what the opportunity could be worth; effort is subtracted because a good idea that
  // takes a year is not the same opportunity as a good idea that takes a weekend.
  const value = problemSeverity + reachability + ownerAdvantage;
  const raw = Math.max(0, value - Math.round(effort / 2));
  const total = Math.round((raw / 25) * evidenceStrength);
  const explanation = live.length === 0
    ? `0 of a possible 100. Severity ${problemSeverity} + reach ${reachability} + advantage ${ownerAdvantage}, less half of effort ${effort}, gives ${raw} of 25 — but nothing has been recorded about this opportunity yet, so evidence strength is 0 and the score is 0. This is an idea, not a finding.`
    : `${total} of a possible 100. Severity ${problemSeverity} + reach ${reachability} + advantage ${ownerAdvantage}, less half of effort ${effort}, gives ${raw} of 25, scaled by evidence strength ${evidenceStrength}% (${settled} settled of ${live.length} live claims). Raising the score means confirming claims, not rewording them.`;
  return { problemSeverity, reachability, ownerAdvantage, effort, evidenceStrength, total, explanation };
}

/**
 * The honest summary of an opportunity: what is settled, what is not, and what would change the
 * answer. Deliberately blunt, because a studio that flatters an idea is worse than no studio.
 */
export function opportunityAssessment(opportunity: OpportunityV1): { score: OpportunityScoreV1; balance: ReturnType<typeof claimBalance>; openQuestions: string[]; caution: string } {
  const balance = claimBalance(opportunity.claims);
  const openQuestions = opportunity.claims
    .filter((claim) => claim.enabled && !claim.supersededBy && (claim.class === "assumption" || claim.class === "hypothesis"))
    .map((claim) => `${claim.class}: ${claim.statement}`);
  const untestedHypotheses = opportunity.claims.filter((claim) => claim.class === "hypothesis" && claim.enabled
    && !opportunity.experiments.some((experiment) => experiment.hypothesisId === claim.id && experiment.completedAt));
  const caution = [
    balance.summary,
    untestedHypotheses.length ? `${untestedHypotheses.length} hypothesis(es) have no completed experiment behind them.` : "",
    opportunity.competitors.some((note) => note.sourceRef.startsWith("owner-impression"))
      ? "Some competitor notes are impressions rather than researched observations, and are labelled that way."
      : "",
    "AION did not gather market evidence for this and cannot. Everything above came from you or from a research job you approved.",
  ].filter(Boolean).join(" ");
  return { score: scoreOpportunity(opportunity), balance, openQuestions, caution };
}
