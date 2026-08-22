/**
 * What each business is ready for, and what the portfolio scheduler is allowed to see.
 *
 * Two jobs that look like one and are not.
 *
 * **Readiness** turns evidence into a decision: can revenue work start here, or is the honest next
 * step finding something out? The distinction that matters is between *blocked* and *ignorant*.
 * Compassionate Choice was blocked on registration; it is not any more, and leaving it blocked
 * because the code once said so would be the failure this milestone exists to fix.
 *
 * **The portfolio summary** is what crosses the wall between businesses. It carries counts and states
 * and nothing else — no claim text, no source reference, no value. Compassionate Choice will hold
 * client information eventually, and the scheduler has no business reading it to decide what to work
 * on next. A summary that carried "the evidence" would be a leak with a friendly name.
 */

import {
  ACTIONABLE_STATES_V1,
  type BusinessEvidenceV1,
} from "./business-evidence.js";
import type { BusinessEvidenceStoreV1, OwnerQuestionV1 } from "./business-evidence-store.js";

export const REVENUE_READINESS_V1 = [
  "READY_FOR_REVENUE_DISCOVERY",
  "NEEDS_OWNER_INFORMATION",
  "NEEDS_SOURCE_VERIFICATION",
  "BLOCKED_BY_LEGAL_STATUS",
  "INSUFFICIENT_EVIDENCE",
] as const;
export type RevenueReadinessV1 = (typeof REVENUE_READINESS_V1)[number];

/**
 * Claims that decide whether a business can pursue revenue at all.
 *
 * Kept explicit rather than inferred. A business is not revenue-ready because it has *many* facts;
 * it is ready because it has *these* facts — what it is allowed to do, and where.
 */
export const REVENUE_GATING_CLAIMS_V1: Readonly<Record<string, string>> = Object.freeze({
  legalStatus: "regulatory.status",
  serviceArea: "regulatory.service-area",
});

export interface BusinessReadinessV1 {
  readonly workspaceId: string;
  readonly readiness: RevenueReadinessV1;
  readonly reason: string;
  readonly knownCount: number;
  readonly unknownCount: number;
  readonly hypothesisCount: number;
  readonly conflictedCount: number;
  readonly supersededCount: number;
  readonly unreadSourceCount: number;
  readonly openBlockingQuestions: number;
}

function live(evidence: readonly BusinessEvidenceV1[]): readonly BusinessEvidenceV1[] {
  return evidence.filter((row) => row.supersededBy === "");
}

/**
 * Judge one business.
 *
 * Order matters. A live conflict on a gating claim outranks everything, because acting on a
 * contradicted legal status is the worst available outcome. Then the gating facts themselves: if
 * AION does not know what a business may legally do, no revenue path can be honestly ranked, and
 * that is ignorance rather than blockage — `INSUFFICIENT_EVIDENCE`, with a question to ask.
 */
export function assessRevenueReadiness(
  workspaceId: string,
  evidence: readonly BusinessEvidenceV1[],
  questions: readonly OwnerQuestionV1[],
): BusinessReadinessV1 {
  const current = live(evidence);
  const counts = {
    knownCount: current.filter((row) => row.state === "KNOWN").length,
    unknownCount: current.filter((row) => row.state === "UNKNOWN").length,
    hypothesisCount: current.filter((row) => row.state === "HYPOTHESIS").length,
    conflictedCount: current.filter((row) => row.state === "CONFLICTED").length,
    supersededCount: evidence.filter((row) => row.state === "SUPERSEDED" || row.supersededBy !== "").length,
    unreadSourceCount: current.filter((row) => row.state === "UNREAD_SOURCE").length,
  };
  const openBlockingQuestions = questions.filter((q) => q.blocking && q.resolvedAtUtc === "").length;
  const base = { workspaceId, ...counts, openBlockingQuestions };

  const gating = current.filter((row) => Object.values(REVENUE_GATING_CLAIMS_V1).includes(row.claim));
  const conflictedGating = gating.filter((row) => row.state === "CONFLICTED");
  if (conflictedGating.length > 0) {
    return {
      ...base,
      readiness: "BLOCKED_BY_LEGAL_STATUS",
      reason: `contradicted ${conflictedGating.map((row) => row.claim).join(", ")}; a person must resolve it before revenue work`,
    };
  }

  const unreadGating = gating.filter((row) => row.state === "UNREAD_SOURCE");
  if (unreadGating.length > 0 && gating.every((row) => !ACTIONABLE_STATES_V1.includes(row.state))) {
    return {
      ...base,
      readiness: "NEEDS_SOURCE_VERIFICATION",
      reason: "the sources that would settle legal status are located but unreadable",
    };
  }

  const knownGating = gating.filter((row) => ACTIONABLE_STATES_V1.includes(row.state));
  const haveStatus = knownGating.some((row) => row.claim === REVENUE_GATING_CLAIMS_V1.legalStatus);
  const haveArea = knownGating.some((row) => row.claim === REVENUE_GATING_CLAIMS_V1.serviceArea);

  if (haveStatus && haveArea) {
    return {
      ...base,
      readiness: "READY_FOR_REVENUE_DISCOVERY",
      reason: "legal status and service area are known from knowledge-bearing sources",
    };
  }
  if (openBlockingQuestions > 0) {
    return {
      ...base,
      readiness: "NEEDS_OWNER_INFORMATION",
      reason: `${openBlockingQuestions} blocking question(s) only the Owner can answer`,
    };
  }
  return {
    ...base,
    readiness: "INSUFFICIENT_EVIDENCE",
    reason: haveStatus
      ? "legal status is known but the service area is not"
      : "nothing establishes what this business is permitted to do",
  };
}

/* -------------------------------------------------------------------------- */
/* The minimized portfolio summary                                             */
/* -------------------------------------------------------------------------- */

/**
 * What crosses the wall.
 *
 * Numbers and enum values. No claim text, no value, no source reference, no subject — nothing that
 * carries content from inside a workspace. The scheduler can rank on this and cannot read anything
 * with it, which is the point.
 */
export interface PortfolioSummaryEntryV1 {
  readonly workspaceId: string;
  readonly readiness: RevenueReadinessV1;
  readonly knowledgeCompleteness: number;
  readonly blockingConflicts: number;
  readonly openBlockingQuestions: number;
  readonly researchReady: boolean;
  readonly informationGainValue: number;
  /** An enum, never a sentence copied out of the evidence. */
  readonly blocker: RevenueReadinessV1 | "NONE";
}

/** Fields a portfolio entry may contain. Asserted by a test, so a leak cannot be added quietly. */
export const PORTFOLIO_SUMMARY_FIELDS_V1: readonly string[] = Object.freeze([
  "workspaceId", "readiness", "knowledgeCompleteness", "blockingConflicts",
  "openBlockingQuestions", "researchReady", "informationGainValue", "blocker",
]);

/**
 * How much is worth learning here.
 *
 * Highest when AION knows least about a business it is allowed to work on — because that is where a
 * cheap question changes a decision. A business already revenue-ready has low information gain: the
 * next move is to act, not to ask.
 */
function informationGain(readiness: BusinessReadinessV1): number {
  if (readiness.readiness === "READY_FOR_REVENUE_DISCOVERY") return 0.1;
  if (readiness.readiness === "BLOCKED_BY_LEGAL_STATUS") return 0.9;
  const known = readiness.knownCount;
  const open = readiness.unknownCount + readiness.openBlockingQuestions;
  if (known + open === 0) return 0.5;
  return Math.min(1, 0.4 + (open / (known + open)) * 0.5);
}

function knowledgeCompleteness(readiness: BusinessReadinessV1): number {
  const total = readiness.knownCount + readiness.unknownCount + readiness.conflictedCount
    + readiness.unreadSourceCount;
  return total === 0 ? 0 : Number((readiness.knownCount / total).toFixed(2));
}

export function portfolioSummary(
  store: BusinessEvidenceStoreV1,
  workspaceIds: readonly string[],
): readonly PortfolioSummaryEntryV1[] {
  return workspaceIds.map((workspaceId) => {
    // Each workspace is read on its own. Nothing here holds two workspaces' evidence at once.
    const readiness = assessRevenueReadiness(
      workspaceId,
      store.evidence(workspaceId),
      store.questions(workspaceId),
    );
    return {
      workspaceId,
      readiness: readiness.readiness,
      knowledgeCompleteness: knowledgeCompleteness(readiness),
      blockingConflicts: readiness.conflictedCount,
      openBlockingQuestions: readiness.openBlockingQuestions,
      researchReady: readiness.readiness !== "BLOCKED_BY_LEGAL_STATUS",
      informationGainValue: Number(informationGain(readiness).toFixed(2)),
      blocker: readiness.readiness === "READY_FOR_REVENUE_DISCOVERY" ? "NONE" : readiness.readiness,
    };
  });
}
