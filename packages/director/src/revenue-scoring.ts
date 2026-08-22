/**
 * Ranking revenue candidates, and refusing to rank when nothing is known.
 *
 * The rule that shapes everything here: **a large speculative figure must not outrank a smaller
 * evidenced one.** The obvious implementation — expected value times confidence — fails it, because
 * confidence is a self-report. A candidate can be entirely invented and entirely confident. So
 * evidence quality gates the score before value enters it, and a candidate with no evidence cannot
 * reach the top band however large its numbers are.
 *
 * The second rule: the operator is allowed to say it cannot rank. When every candidate is
 * unevidenced, ordering them is theatre — the ordering would come from whoever wrote the
 * hypotheses. `rankCandidates` reports `rankable: false` and the caller is expected to go and learn
 * something instead.
 */

import {
  entitledEvidenceQuality,
  evidencedFigureShare,
  isGroundedFigure,
  FIGURE_EVIDENCE_KINDS_V1,
  type EvidenceQualityV1,
  type FigureStateV1,
  type KnownRefsV1,
  type RevenueOpportunityV1,
} from "./revenue-opportunity.js";

/** The plain banding, for counts that belong to the candidate rather than to the world. */
function bandOf(value: number, low: number, high: number): number {
  if (value <= low) return 1;
  if (value >= high) return 0;
  return 1 - (value - low) / (high - low);
}

/** Weight of each evidence quality. `NONE` is zero, not small: it is the whole point. */
const EVIDENCE_WEIGHT_V1: Readonly<Record<EvidenceQualityV1, number>> = Object.freeze({
  STRONG: 1,
  MODERATE: 0.6,
  WEAK: 0.25,
  NONE: 0,
});

export interface ScoreComponentV1 {
  readonly name: string;
  readonly value: number;
  readonly weight: number;
  readonly reason: string;
}

export interface CandidateScoreV1 {
  readonly opportunityId: string;
  readonly title: string;
  readonly score: number;
  readonly effectiveEvidenceQuality: EvidenceQualityV1;
  readonly downgraded: boolean;
  readonly components: readonly ScoreComponentV1[];
  /** One sentence a person can argue with. */
  readonly explanation: string;
}

export interface RankingV1 {
  readonly rankable: boolean;
  readonly ranked: readonly CandidateScoreV1[];
  readonly reason: string;
  /** Filled when ranking is refused: what to go and learn. */
  readonly informationGainFirst: boolean;
}

/*
 * A component scores only on a figure that is grounded.
 *
 * `band()` previously read the number and ignored its state, so an imagined "1 day to first revenue"
 * and an imagined "$0 capital" earned full marks. That let a fabricated candidate accumulate value
 * credit from figures it had invented, which is the same substitution the evidence multiplier exists
 * to stop — just entering through the components instead.
 */
/**
 * A figure scores for being grounded, not for being flattering.
 *
 * The magnitude used to decide the component, and nothing anywhere verifies a magnitude against the
 * source it cites. So an invented `$0–$0` capital requirement citing a real startup quote scored a
 * full 1.0 while an honest `$500–$900` reading of *the same quote* scored 0.91 — and the fiction
 * ranked first. Optimism was the lever, and it was free.
 *
 * What AION can actually check is whether a figure is traceable to a source of the right kind. So
 * that is what it scores. Magnitude can come back as a signal the day a figure's value can be
 * checked against the source it names; until then, rewarding a smaller number is rewarding whoever
 * was willing to write a smaller number.
 */
function groundedComponent(
  figure: { low: number | null; high: number | null; state: FigureStateV1; basis: string },
  candidate: RevenueOpportunityV1,
  knownRefs: KnownRefsV1,
  figureName: string,
): number {
  const grounded = isGroundedFigure(
    figure, candidate, knownRefs, FIGURE_EVIDENCE_KINDS_V1[figureName] ?? [],
  );
  return grounded ? 1 : 0;
}

/**
 * Score one candidate.
 *
 * Every component is named, weighted and explained, so the ranking can be argued with rather than
 * believed. The evidence gate is applied as a multiplier at the end rather than as one component
 * among many — a component would let a strong showing elsewhere compensate for having no evidence,
 * which is precisely the substitution this is built to prevent.
 */
export function scoreCandidate(
  candidate: RevenueOpportunityV1,
  knownRefs: KnownRefsV1 = new Map(),
): CandidateScoreV1 {
  const entitled = entitledEvidenceQuality(candidate, knownRefs);
  const evidenceWeight = EVIDENCE_WEIGHT_V1[entitled.quality];

  const components: ScoreComponentV1[] = [
    {
      name: "evidenced figures",
      value: evidencedFigureShare(candidate, knownRefs),
      weight: 0.25,
      reason: "share of this candidate's numbers that rest on something other than reasoning",
    },
    {
      name: "time to first revenue, evidenced",
      value: groundedComponent(candidate.estimatedTimeToFirstRevenue, candidate, knownRefs, "estimatedTimeToFirstRevenue"),
      weight: 0.15,
      reason: "how long until revenue, where somebody other than this candidate has said so",
    },
    {
      name: "Owner time, evidenced",
      value: groundedComponent(candidate.estimatedOwnerTime, candidate, knownRefs, "estimatedOwnerTime"),
      weight: 0.15,
      reason: "how much Owner time this takes, where something outside the candidate says so",
    },
    {
      name: "capital required, evidenced",
      value: groundedComponent(candidate.estimatedCapitalRequired, candidate, knownRefs, "estimatedCapitalRequired"),
      weight: 0.1,
      reason: "what it costs to start, where a real quote rather than the author says so",
    },
    {
      name: "recurring",
      /* UNKNOWN scores 0, not LOW's 0.2: a missing answer is not a weak answer. */
      value: candidate.recurringPotential === "HIGH" ? 1
        : candidate.recurringPotential === "MEDIUM" ? 0.6
          : candidate.recurringPotential === "LOW" ? 0.2 : 0,
      weight: 0.15,
      reason: "recurring revenue compounds; one-off revenue has to be re-earned",
    },
    {
      name: "reversible",
      /* IRREVERSIBLE and UNKNOWN both score 0, for different reasons that point the same way. */
      value: candidate.reversibility === "REVERSIBLE" ? 1
        : candidate.reversibility === "PARTIALLY_REVERSIBLE" ? 0.5 : 0,
      weight: 0.1,
      reason: "a reversible move can be wrong cheaply",
    },
    {
      name: "few compliance constraints",
      /* The constraint count is a property of the candidate itself, so it needs no external source. */
      value: bandOf(candidate.complianceConstraints.length, 0, 5),
      weight: 0.1,
      reason: "each constraint is a way the model can turn out to be unavailable",
    },
  ];

  const weighted = components.reduce((sum, part) => sum + part.value * part.weight, 0);
  const score = Number((weighted * evidenceWeight).toFixed(4));

  const explanation = evidenceWeight === 0
    ? `${candidate.title}: scores 0 — ${entitled.reason}. A candidate with no evidence cannot be ranked above one that has some, whatever its numbers say.`
    : `${candidate.title}: ${score.toFixed(3)} = ${weighted.toFixed(3)} weighted components × ${evidenceWeight} for ${entitled.quality} evidence`
      + `${entitled.downgraded ? ` (downgraded — ${entitled.reason})` : ""}`;

  return {
    opportunityId: candidate.opportunityId,
    title: candidate.title,
    score,
    effectiveEvidenceQuality: entitled.quality,
    downgraded: entitled.downgraded,
    components,
    explanation,
  };
}

/**
 * Rank a set, or decline to.
 *
 * Declining is the expected outcome while AION has no market evidence, and it is a result rather
 * than a failure: the next move is to learn something, not to sort fiction.
 */
export function rankCandidates(
  candidates: readonly RevenueOpportunityV1[],
  knownRefs: KnownRefsV1 = new Map(),
): RankingV1 {
  const scored = candidates.map((candidate) => scoreCandidate(candidate, knownRefs))
    .sort((a, b) => b.score - a.score || a.opportunityId.localeCompare(b.opportunityId));

  const evidenced = scored.filter((row) => row.effectiveEvidenceQuality !== "NONE");
  if (evidenced.length === 0) {
    return {
      rankable: false,
      ranked: scored,
      reason: `no candidate carries any evidence, so any ordering would come from whoever wrote the hypotheses rather than from the world`,
      informationGainFirst: true,
    };
  }
  if (evidenced.length === 1) {
    return {
      rankable: true,
      ranked: scored,
      reason: `only ${evidenced[0]!.title} carries evidence; it leads by default rather than by comparison`,
      informationGainFirst: true,
    };
  }
  return {
    rankable: true,
    ranked: scored,
    reason: `${evidenced.length} candidates carry evidence and were compared on the named components`,
    informationGainFirst: false,
  };
}

/**
 * Compare two candidates in words.
 *
 * Exists so "A ranks over B because…" is a function rather than a paragraph somebody writes later
 * and gets wrong.
 */
export function explainOrdering(a: CandidateScoreV1, b: CandidateScoreV1): string {
  if (a.effectiveEvidenceQuality !== b.effectiveEvidenceQuality) {
    return `${a.title} ranks over ${b.title} because its evidence is ${a.effectiveEvidenceQuality} against ${b.effectiveEvidenceQuality}`;
  }
  const biggest = a.components
    .map((part, index) => ({
      name: part.name,
      delta: part.value * part.weight - (b.components[index]?.value ?? 0) * part.weight,
    }))
    .sort((left, right) => right.delta - left.delta)[0];
  return `${a.title} ranks over ${b.title} mainly on ${biggest?.name ?? "the weighted components"}`
    + ` (${a.score.toFixed(3)} against ${b.score.toFixed(3)})`;
}
