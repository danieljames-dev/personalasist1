/**
 * One bounded pass over one approved source, and a receipt that cannot flatter it.
 *
 * The order below is not arbitrary. Authorization is checked before the filesystem is touched, so an
 * inactive or revoked source produces zero reads rather than reads that are discarded afterwards.
 * The fingerprint is computed from directory metadata, so an unchanged source costs a stat walk and
 * no file reads at all. Every refusal the boundary makes is carried into the receipt, so coverage is
 * reported rather than implied.
 *
 * ## Why `COMPLETED` is hard to get
 *
 * `COMPLETED` means: everything inside the approved scope was read, nothing was refused, nothing was
 * truncated, nothing errored. Anything less is `PARTIAL`, and the outcome is re-derived from the
 * receipt's own contents by {@link receiptEarnsCompleted} immediately before it is returned — so a
 * future edit that adds a new failure path cannot accidentally leave the success label behind. A
 * sync that half-worked and said `COMPLETED` would end the Owner's search for the missing half.
 *
 * ## Why the fingerprint uses metadata, not content
 *
 * Hashing content would mean reading every file on every sync, including the ones the answer is
 * "nothing changed". Metadata (path, size, modification time) costs a stat. The trade is that a file
 * touched but not edited re-syncs; that is benign, because extraction is deterministic and
 * reconciliation recognises the identical fingerprint and records the fact as unchanged. It is also
 * why `mtime` never becomes freshness evidence: it is a change detector, not a truth detector.
 */

import {
  PERSONAL_CONTEXT_MILESTONE_ID,
  PERSONAL_CONTEXT_OWNER_AUTHORIZATION_ID,
  PERSONAL_CONTEXT_RECEIPT_SCHEMA_V1,
  type ContextSourceV1,
  type PersonalContextFactV1,
} from "./contracts.js";
import { sourceReadable } from "./enrollment.js";
import { extractFactsFromFile, type ExtractionSkipV1 } from "./extraction.js";
import { readRepositoryIdentity } from "./git-identity.js";
import { digestOf } from "./hash.js";
import {
  enumerateApprovedFiles,
  type ApprovedFileV1,
  type PersonalContextFsV1,
} from "./path-boundary.js";
import { reconcileFacts } from "./reconcile.js";
import {
  ESCAPE_REASONS,
  receiptEarnsCompleted,
  type RecordedDenialV1,
  type SyncOutcomeV1,
  type SyncReceiptV1,
} from "./receipts.js";
import type { PersonalContextStoreV1 } from "./store.js";

export interface SyncDepsV1 {
  readonly store: PersonalContextStoreV1;
  readonly fs: PersonalContextFsV1;
  readonly now: string;
}

/** Stable across processes: sorted path, size and modification time for every approved file. */
export function computeSourceFingerprint(files: readonly ApprovedFileV1[]): string {
  return digestOf(
    [...files]
      .map((file) => `${file.relativePath}:${file.size}:${file.mtimeMs}`)
      .sort(),
  );
}

function isoOrNull(milliseconds: number): string | null {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function receipt(partial: Omit<SyncReceiptV1, "schema">): SyncReceiptV1 {
  return { schema: PERSONAL_CONTEXT_RECEIPT_SCHEMA_V1, ...partial };
}

function deniedReceipt(
  sourceId: string,
  reason: string,
  at: string,
  sourceVersion: number,
): SyncReceiptV1 {
  return receipt({
    receiptId: digestOf([sourceId, at, reason]),
    sourceId,
    milestoneId: PERSONAL_CONTEXT_MILESTONE_ID,
    ownerAuthorizationId: PERSONAL_CONTEXT_OWNER_AUTHORIZATION_ID,
    outcome: "DENIED",
    denialReason: reason,
    startedAt: at,
    completedAt: at,
    fingerprintBefore: null,
    fingerprintAfter: null,
    sourceVersionBefore: sourceVersion,
    sourceVersionAfter: sourceVersion,
    filesConsidered: 0,
    filesRead: 0,
    filesUnsupported: 0,
    denials: [],
    boundaryEscapeAttempts: 0,
    truncatedBy: null,
    factsExtracted: 0,
    factsCreated: 0,
    factsUpdated: 0,
    factsSuperseded: 0,
    factsUnchanged: 0,
    conflictsDetected: 0,
    conflictsConfirmed: 0,
    skips: [],
    errors: [],
  });
}

/**
 * Synchronize one registered source.
 *
 * Returns the receipt it also persists, so a caller has the outcome without a second read. The
 * source row is updated in the same pass: attempted time always, successful time and fingerprint
 * only when something was actually read.
 */
export function syncSource(sourceId: string, deps: SyncDepsV1): SyncReceiptV1 {
  const startedAt = deps.now;
  const source = deps.store.loadSource(sourceId);

  if (source === null) {
    const denied = deniedReceipt(sourceId, "SOURCE_NOT_REGISTERED", startedAt, 0);
    deps.store.saveReceipt(denied);
    return denied;
  }

  const readable = sourceReadable(source, deps.now);
  if (!readable.readable) {
    const denied = deniedReceipt(sourceId, readable.reason ?? "SOURCE_NOT_READABLE", startedAt, source.version);
    deps.store.saveReceipt(denied);
    // The attempt is still recorded on the source: a revoked source that someone keeps trying to read
    // is worth being able to see.
    deps.store.saveSource({ ...source, lastAttemptedSync: startedAt, updatedAt: startedAt });
    return denied;
  }

  const enumeration = enumerateApprovedFiles(source, deps.fs);
  const denials: RecordedDenialV1[] = enumeration.denials.map((entry) => ({
    entry: entry.entry,
    reason: entry.reason,
    detail: entry.detail,
  }));
  const boundaryEscapeAttempts = denials.filter((entry) => ESCAPE_REASONS.includes(entry.reason)).length;
  const rootFailure = denials.some((entry) => entry.reason === "ROOT_NOT_IDENTIFIABLE" || entry.reason === "ROOT_UNRESOLVABLE");

  const fingerprintBefore = source.fingerprint;
  const fingerprintAfter = computeSourceFingerprint(enumeration.files);

  if (!rootFailure && fingerprintBefore !== null && fingerprintBefore === fingerprintAfter) {
    const skipped = receipt({
      receiptId: digestOf([sourceId, startedAt, fingerprintAfter, "SKIPPED"]),
      sourceId,
      milestoneId: PERSONAL_CONTEXT_MILESTONE_ID,
      ownerAuthorizationId: PERSONAL_CONTEXT_OWNER_AUTHORIZATION_ID,
      outcome: "SKIPPED_UNCHANGED",
      denialReason: null,
      startedAt,
      completedAt: deps.now,
      fingerprintBefore,
      fingerprintAfter,
      sourceVersionBefore: source.version,
      sourceVersionAfter: source.version,
      filesConsidered: enumeration.files.length,
      filesRead: 0,
      filesUnsupported: 0,
      denials,
      boundaryEscapeAttempts,
      truncatedBy: enumeration.truncatedBy,
      factsExtracted: 0,
      factsCreated: 0,
      factsUpdated: 0,
      factsSuperseded: 0,
      factsUnchanged: 0,
      conflictsDetected: 0,
      conflictsConfirmed: 0,
      skips: [],
      errors: [],
    });
    deps.store.saveReceipt(skipped);
    deps.store.saveSource({
      ...source,
      lastAttemptedSync: startedAt,
      lastSuccessfulSync: startedAt,
      updatedAt: startedAt,
    });
    return skipped;
  }

  // Repository identity is captured before any content is read, so every fact from this pass can name
  // the commit it was observed at. A source that is not a checkout simply reports nulls.
  const repository = readRepositoryIdentity(source, deps.fs);

  const extracted: PersonalContextFactV1[] = [];
  const skips: ExtractionSkipV1[] = [];
  const errors: string[] = [];
  let filesRead = 0;
  let filesUnsupported = 0;
  let newestModified = 0;

  for (const file of enumeration.files) {
    let contents: string;
    try {
      contents = deps.fs.readFileSync(file.resolvedPath);
    } catch (error) {
      errors.push(`${file.relativePath}: could not be read (${String(error)})`);
      continue;
    }
    filesRead += 1;
    newestModified = Math.max(newestModified, file.mtimeMs);

    const result = extractFactsFromFile({
      source,
      sourceReference: file.relativePath,
      contents,
      sourceModifiedAt: isoOrNull(file.mtimeMs),
      sourceCommit: repository.head,
      now: deps.now,
    });
    if (!result.recognized) filesUnsupported += 1;
    extracted.push(...result.facts);
    skips.push(...result.skips);
  }

  const reconciled = reconcileFacts(deps.store.listFacts(), extracted);
  try {
    deps.store.saveFacts(reconciled.facts);
  } catch (error) {
    errors.push(`facts could not be persisted (${String(error)})`);
  }

  const hardSkips = skips.filter((skip) => skip.reason !== "UNSUPPORTED_CONTENT");
  let outcome: SyncOutcomeV1;
  if (rootFailure || (enumeration.files.length === 0 && denials.length > 0)) {
    outcome = "FAILED";
  } else if (errors.length > 0 || denials.length > 0 || enumeration.truncatedBy !== null || hardSkips.length > 0) {
    outcome = "PARTIAL";
  } else {
    outcome = "COMPLETED";
  }

  const draft = receipt({
    receiptId: digestOf([sourceId, startedAt, fingerprintAfter]),
    sourceId,
    milestoneId: PERSONAL_CONTEXT_MILESTONE_ID,
    ownerAuthorizationId: PERSONAL_CONTEXT_OWNER_AUTHORIZATION_ID,
    outcome,
    denialReason: null,
    startedAt,
    completedAt: deps.now,
    fingerprintBefore,
    fingerprintAfter: rootFailure ? null : fingerprintAfter,
    sourceVersionBefore: source.version,
    sourceVersionAfter: rootFailure ? source.version : source.version + 1,
    filesConsidered: enumeration.files.length,
    filesRead,
    filesUnsupported,
    denials,
    boundaryEscapeAttempts,
    truncatedBy: enumeration.truncatedBy,
    factsExtracted: extracted.length,
    factsCreated: reconciled.created.length,
    factsUpdated: reconciled.updated.length,
    factsSuperseded: reconciled.superseded.length,
    factsUnchanged: reconciled.unchanged.length,
    conflictsDetected: reconciled.conflicts.length,
    conflictsConfirmed: reconciled.conflicts.filter((row) => row.state === "CONFIRMED").length,
    skips,
    errors,
  });

  // Re-derive the success label from what the receipt actually records. A future edit that adds a new
  // failure path but forgets the outcome branch above still cannot produce a flattering receipt.
  const final: SyncReceiptV1 =
    draft.outcome === "COMPLETED" && !receiptEarnsCompleted(draft) ? { ...draft, outcome: "PARTIAL" } : draft;

  deps.store.saveReceipt(final);

  const updatedSource: ContextSourceV1 = {
    ...source,
    lastAttemptedSync: startedAt,
    lastSuccessfulSync: final.outcome === "FAILED" ? source.lastSuccessfulSync : startedAt,
    fingerprint: rootFailure ? source.fingerprint : fingerprintAfter,
    version: rootFailure ? source.version : source.version + 1,
    sourceModifiedAt: isoOrNull(newestModified) ?? source.sourceModifiedAt,
    repositoryHead: repository.head,
    repositoryRemote: repository.remote,
    updatedAt: startedAt,
  };
  deps.store.saveSource(updatedSource);

  return final;
}

/** Synchronize every registered source that is currently readable, newest receipt last. */
export function syncAllSources(deps: SyncDepsV1): readonly SyncReceiptV1[] {
  return deps.store.listSources().map((source) => syncSource(source.sourceId, deps));
}
