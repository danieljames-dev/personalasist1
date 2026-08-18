/**
 * The durable record of what one synchronization actually did.
 *
 * A receipt exists so that "the source is synced" is a checkable claim rather than a feeling. Its
 * most important field is {@link SyncOutcomeV1}, and its most important property is that `COMPLETED`
 * is unreachable whenever anything was refused, truncated or errored. A partial read reported as a
 * complete one is worse than a failed read: the Owner stops looking for the missing half.
 *
 * Counts are separated rather than summed — files considered, files read, files the extractor could
 * not support, entries the boundary refused — because a single "processed 12 files" hides exactly
 * the distinction that matters when the context later turns out to be thin.
 */

import type { ExtractionSkipV1 } from "./extraction.js";
import type { PathDenialReasonV1 } from "./path-boundary.js";

export const SYNC_OUTCOMES_V1 = [
  /** Everything in the approved scope was read and extracted. */
  "COMPLETED",
  /** The source fingerprint was unchanged, so nothing was re-read. */
  "SKIPPED_UNCHANGED",
  /** Some of the approved scope was read; something else was refused, truncated or errored. */
  "PARTIAL",
  /** Nothing usable was read. */
  "FAILED",
  /** The source was not eligible to be read at all — inactive, revoked, expired or unregistered. */
  "DENIED",
] as const;
export type SyncOutcomeV1 = (typeof SYNC_OUTCOMES_V1)[number];

export interface RecordedDenialV1 {
  readonly entry: string;
  readonly reason: PathDenialReasonV1;
  readonly detail: string;
}

export interface SyncReceiptV1 {
  readonly schema: string;
  readonly receiptId: string;
  readonly sourceId: string;
  readonly milestoneId: string;
  readonly ownerAuthorizationId: string;
  readonly outcome: SyncOutcomeV1;
  readonly denialReason: string | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly fingerprintBefore: string | null;
  readonly fingerprintAfter: string | null;
  readonly sourceVersionBefore: number;
  readonly sourceVersionAfter: number;
  readonly filesConsidered: number;
  readonly filesRead: number;
  readonly filesUnsupported: number;
  readonly denials: readonly RecordedDenialV1[];
  /**
   * Refusals that were an attempt to leave the approved root, as opposed to an ordinary bound.
   *
   * Counted separately because a non-zero value here is a security observation, while a non-zero
   * depth refusal is just a folder being deeper than the Owner approved.
   */
  readonly boundaryEscapeAttempts: number;
  readonly truncatedBy: "MAX_FILES" | "MAX_BYTES" | null;
  readonly factsExtracted: number;
  readonly factsCreated: number;
  readonly factsUpdated: number;
  readonly factsSuperseded: number;
  readonly factsUnchanged: number;
  readonly conflictsDetected: number;
  readonly conflictsConfirmed: number;
  readonly skips: readonly ExtractionSkipV1[];
  readonly errors: readonly string[];
}

/** The refusal reasons that mean something tried to leave the approved root. */
export const ESCAPE_REASONS: readonly PathDenialReasonV1[] = [
  "TRAVERSAL_ESCAPE",
  "ABSOLUTE_ENTRY",
  "RESOLVED_OUTSIDE_ROOT",
  "SYMLINK_NOT_ALLOWED",
  "UNSAFE_PATH_SHAPE",
  "CONTROL_BYTES",
];

/**
 * Whether this receipt is allowed to say `COMPLETED`.
 *
 * Exported so the assertion can be made from outside the sync engine as well as inside it: a caller
 * reading a stored receipt can re-derive whether the outcome was earned, instead of trusting it.
 */
export function receiptEarnsCompleted(receipt: SyncReceiptV1): boolean {
  return (
    receipt.errors.length === 0 &&
    receipt.truncatedBy === null &&
    receipt.denials.length === 0 &&
    receipt.skips.every((skip) => skip.reason === "UNSUPPORTED_CONTENT")
  );
}

export function validateSyncReceipt(candidate: unknown): string | null {
  if (candidate === null || typeof candidate !== "object") return "receipt is not an object";
  const receipt = candidate as Partial<SyncReceiptV1>;
  if (typeof receipt.receiptId !== "string" || receipt.receiptId.trim() === "") return "receiptId is empty";
  if (typeof receipt.sourceId !== "string" || receipt.sourceId.trim() === "") return "sourceId is empty";
  if (typeof receipt.outcome !== "string" || !SYNC_OUTCOMES_V1.includes(receipt.outcome as SyncOutcomeV1)) {
    return "outcome is not supported";
  }
  if (typeof receipt.startedAt !== "string" || typeof receipt.completedAt !== "string") return "receipt is missing times";
  if (!Array.isArray(receipt.denials) || !Array.isArray(receipt.skips) || !Array.isArray(receipt.errors)) {
    return "receipt lists are malformed";
  }
  if (receipt.outcome === "COMPLETED" && !receiptEarnsCompleted(receipt as SyncReceiptV1)) {
    return "receipt claims COMPLETED while recording refusals, truncation or errors";
  }
  return null;
}
