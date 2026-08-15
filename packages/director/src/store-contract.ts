/**
 * The shape of durable Director state, frozen before anything writes it.
 *
 * Nothing in this file touches a disk. It exists so the persistence layer is designed once, in the
 * open, rather than discovered halfway through an implementation — every rule here is a failure that
 * has already been reasoned about: an id that escapes its directory, a half-written JSON document
 * read after a power cut, two Director processes each holding their own in-memory lease array and
 * therefore each believing they own the same worktree.
 *
 * ## Why interfaces and not an implementation
 *
 * The pure decision functions elsewhere in this package (leases, gates, work items) compute *policy*
 * from state they are handed. They cannot provide *exclusion*, because exclusion is a property of the
 * host, not of an array. `acquireLease` over one process's array says nothing about the array in a
 * second process, so the moment two Director processes exist the array is advisory and the OS is
 * authoritative. The contracts below name where that boundary sits, so the implementation cannot
 * quietly relocate it.
 *
 * ## Where state lives
 *
 * Under the host root from `contracts.ts` — `DEFAULT_DIRECTOR_ROOT`, overridable by
 * `AION_DIRECTOR_ROOT` — never inside a Git worktree. A worktree is a disposable checkout: `git
 * clean -xdf`, a branch switch or a worktree prune are ordinary operations there, and any one of them
 * would take mission continuity with it. The repository holds code and default policy; the host holds
 * what is actually happening.
 */
import { createHash } from "node:crypto";
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
// Path identity comes from the shared pure module, never the other way round: this file is where
// filesystem code will land, and the lease rules must stay testable without any of it.
import { resourceIsIdentifiable } from "./resource-identity.js";
// Type-only, and it must stay that way: `leases.ts` is a pure policy module and a runtime edge from
// here to there — or back — would put the store on both ends of a cycle the moment either grows.
import type { LeaseKindV1, ProcessIdentityV1, ProcessLivenessV1 } from "./leases.js";

export const DIRECTOR_STORE_SCHEMA_V1 = "aion.director.store.v1" as const;

// ---------------------------------------------------------------------------
// Host root
// ---------------------------------------------------------------------------

// `resolveDirectorRoot` (default `C:\AION\director`) was deleted. That path is
// on the never-touch list; the live store is {@link sandboxDirectorStoreRoot}
// in `lease-store.ts` (`AION_DIRECTOR_ROOT` or `%TEMP%\aion-director-d2-store`).

/** Fixed names under the root. Layout is part of the contract; a reader must find yesterday's state. */
export const DIRECTOR_STORE_LAYOUT_V1 = {
  missionsDir: "missions",
  runsDir: "RUNS",
  /** The single authoritative document for a key, replaced whole. */
  currentStateFile: "CURRENT.json",
  /** Append-only NDJSON. One event per line, never rewritten. */
  eventJournalFile: "EVENTS.ndjson",
  /** Host-wide exclusion, one file per canonical resource key, named by `hostLockFileName`. */
  locksDir: "locks",
  /** Where unreadable state is moved to, never deleted. */
  quarantineDir: "quarantine",
} as const;

// ---------------------------------------------------------------------------
// Path identity
// ---------------------------------------------------------------------------

/**
 * Path identity lives in `host-path.ts` and is re-exported here.
 *
 * Re-exported rather than moved out from under callers, because these names are part of this
 * module's published surface and an import that has to be rewritten in five files is an import
 * somebody copies wrongly. The implementation moved so the lease rules could stop importing the
 * store; where it is imported from did not have to change with it.
 */
import {
  canonicalizeHostPath,
  inspectHostPath,
  isResolvedHostPath,
  pathIsInside,
  namesReservedDevice,
  namesReservedDeviceSegment,
  IDENTITY_CLASSES,
  type HostPathClassV1,
  type HostPathV1,
} from "./host-path.js";

export {
  canonicalizeHostPath,
  inspectHostPath,
  isResolvedHostPath,
  pathIsInside,
  namesReservedDevice,
  namesReservedDeviceSegment,
  IDENTITY_CLASSES,
  type HostPathClassV1,
  type HostPathV1,
};

// ---------------------------------------------------------------------------
// Identifier validation
// ---------------------------------------------------------------------------

/**
 * Why an id was refused.
 *
 * A reason rather than a bare `false`: mission and run ids reach the store from prompts, HTTP bodies
 * and recovered files, and "rejected" without a rule is a bug report nobody can act on.
 */
export type IdRuleV1 =
  | "EMPTY"
  | "TOO_LONG"
  | "SEPARATOR"
  | "TRAVERSAL"
  | "RESERVED_DEVICE_NAME"
  | "ILLEGAL_CHARACTER"
  | "TRAILING_DOT_OR_SPACE";

export interface IdValidationV1 {
  ok: boolean;
  rule: IdRuleV1 | null;
  reason: string;
}

/**
 * Long enough for a timestamped run id, short enough that root + mission + run + filename stays
 * clear of the classic 260-character Windows path limit.
 */
export const MAX_ID_SEGMENT_LENGTH = 64;

/**
 * Windows refuses these names in any directory, with or without an extension, and a create against
 * one opens a device instead of failing — `NUL` swallows writes and reports success, which would look
 * exactly like a mission whose state saves and never comes back. The predicate is
 * {@link namesReservedDeviceSegment} — one Windows rule, one spelling.
 */
/** Everything a single path segment may contain. Anything outside it is refused, not sanitised. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * A value usable as exactly one directory or file name, under the store root and nowhere else.
 *
 * Rejection rather than escaping is deliberate: sanitising an id changes which mission a caller is
 * addressing without telling anyone, and two different ids can sanitise to the same directory.
 */
export function validatePathSegment(value: string): IdValidationV1 {
  if (value === "") return { ok: false, rule: "EMPTY", reason: "an empty id addresses the parent directory" };
  if (value.length > MAX_ID_SEGMENT_LENGTH) {
    return { ok: false, rule: "TOO_LONG", reason: `ids are limited to ${MAX_ID_SEGMENT_LENGTH} characters` };
  }
  if (value.includes("/") || value.includes("\\")) {
    return { ok: false, rule: "SEPARATOR", reason: "an id is one path segment and may not contain a separator" };
  }
  if (value === "." || value === ".." || value.includes("..")) {
    return { ok: false, rule: "TRAVERSAL", reason: "an id may not walk out of the store root" };
  }
  // Windows silently strips a trailing dot or space, so `run1.` and `run1` open the same directory.
  if (/[. ]$/.test(value)) {
    return { ok: false, rule: "TRAILING_DOT_OR_SPACE", reason: "a trailing dot or space resolves to a different name on Windows" };
  }
  if (namesReservedDeviceSegment(value)) {
    return { ok: false, rule: "RESERVED_DEVICE_NAME", reason: `${value} names a Windows device, not a file` };
  }
  if (!SAFE_SEGMENT.test(value)) {
    return { ok: false, rule: "ILLEGAL_CHARACTER", reason: "ids are ASCII letters, digits, dot, dash and underscore, starting alphanumeric" };
  }
  return { ok: true, rule: null, reason: "safe path segment" };
}

/** The boolean form, for call sites that only branch. */
export function isSafePathSegment(value: string): boolean {
  return validatePathSegment(value).ok;
}

/** Named wrappers, so a refusal message says which id the Owner has to fix. */
export function validateMissionId(missionId: string): IdValidationV1 {
  return validatePathSegment(missionId);
}

export function validateRunId(runId: string): IdValidationV1 {
  return validatePathSegment(runId);
}

// ---------------------------------------------------------------------------
// Keys and revisions
// ---------------------------------------------------------------------------

/**
 * Where a document lives. Both ids are validated before a key is built, never after, so no path is
 * ever assembled from an unchecked string.
 */
export interface StateKeyV1 {
  missionId: OpaqueId;
  /** Absent for mission-level state; present for per-run state. */
  runId?: OpaqueId;
  /** Document name within the key, from `DIRECTOR_STORE_LAYOUT_V1`. */
  document: string;
}

/**
 * A revision is a counter, not a hash or a timestamp.
 *
 * Content hashes make an idempotent rewrite look like no write at all, and timestamps collide at
 * filesystem resolution — two writes in the same millisecond would each believe they were first.
 */
export interface StateSnapshotV1<T> {
  schema: typeof DIRECTOR_STORE_SCHEMA_V1;
  /** 1 for the first write, incremented by exactly one per accepted replace. */
  revision: number;
  updatedAt: IsoTimestamp;
  value: T;
}

/** `null` means "must not exist yet"; any number means "must be exactly this revision". */
export type ExpectedRevisionV1 = number | null;

// ---------------------------------------------------------------------------
// Current state: atomic whole-document replace
// ---------------------------------------------------------------------------

export type StateReadV1<T> =
  | { outcome: "OK"; snapshot: StateSnapshotV1<T> }
  | { outcome: "ABSENT" }
  /** Never thrown, never repaired in place: a reader that guesses at damaged state invents history. */
  | { outcome: "MALFORMED"; quarantinedTo: string; detail: string };

export type StateWriteV1<T> =
  | { outcome: "WRITTEN"; snapshot: StateSnapshotV1<T> }
  /** Someone else wrote first; the current snapshot comes back so the caller rebases rather than clobbers. */
  | { outcome: "STALE_REVISION"; current: StateSnapshotV1<T> }
  /** The writer does not hold the host lock for this key. Refused rather than queued. */
  | { outcome: "NOT_LOCK_HOLDER"; heldBy: HostLockHolderV1 | null }
  | { outcome: "REJECTED"; validation: IdValidationV1 };

/**
 * Whole-document replace with a durability contract, not a convenience wrapper over `writeFile`.
 *
 * An implementation must: serialise fully in memory; write to a temporary file **in the destination
 * directory** (a cross-volume rename is a copy, and a copy is interruptible); flush the file; rename
 * over the target, which is the only step readers can observe; then flush the directory where the
 * platform supports it. A reader therefore sees the old document or the new one, never the 4 KB
 * prefix a truncating write leaves behind after a power cut.
 */
export interface CurrentStateStoreV1<T> {
  read(key: StateKeyV1): Promise<StateReadV1<T>>;
  /**
   * Replace the document. `expectedRevision` is compared against what is on disk *after* the lock is
   * held, because a check performed before acquiring proves nothing about the moment of the write.
   */
  replace(input: {
    key: StateKeyV1;
    value: T;
    expectedRevision: ExpectedRevisionV1;
    now: IsoTimestamp;
  }): Promise<StateWriteV1<T>>;
}

// ---------------------------------------------------------------------------
// Event journal: append only
// ---------------------------------------------------------------------------

export interface JournalEntryV1<E> {
  /** Dense from 1 within a key. A gap is corruption, not a skipped event. */
  sequence: number;
  recordedAt: IsoTimestamp;
  event: E;
}

export type JournalAppendV1 =
  | { outcome: "APPENDED"; sequence: number }
  | { outcome: "NOT_LOCK_HOLDER"; heldBy: HostLockHolderV1 | null }
  | { outcome: "REJECTED"; validation: IdValidationV1 };

export interface JournalReadV1<E> {
  entries: readonly JournalEntryV1<E>[];
  /**
   * Bytes of an unterminated final line that were skipped.
   *
   * A crash mid-append leaves a partial JSON line, and that is expected rather than exceptional: the
   * journal is recoverable precisely because a torn tail discards one event instead of failing the
   * whole file. Reported so a caller can log it; never a reason to refuse the read.
   */
  truncatedTailBytes: number;
}

/**
 * The record of what happened, which the current state is only a projection of.
 *
 * Append-only and never rewritten, because the reason a mission is trusted after a reboot is that its
 * history was not editable by the thing that crashed. Entries are newline-delimited JSON so a torn
 * write costs the last line and nothing before it.
 */
export interface EventJournalV1<E> {
  append(input: { key: StateKeyV1; event: E; now: IsoTimestamp }): Promise<JournalAppendV1>;
  read(input: { key: StateKeyV1; fromSequence?: number; limit?: number }): Promise<JournalReadV1<E>>;
}

// ---------------------------------------------------------------------------
// Host-wide exclusion
// ---------------------------------------------------------------------------

/** Extension of every file under `locksDir`, so a stray file there is obvious rather than ambiguous. */
export const HOST_LOCK_FILE_SUFFIX = ".lock";

/**
 * Digest length in hex characters, i.e. 128 bits of SHA-256.
 *
 * Long enough that two different resources sharing a lock file is not a thing that happens on a host
 * — a collision would silently merge two exclusion domains — and short enough that root + `locks` +
 * name stays clear of the 260-character Windows path limit.
 */
export const HOST_LOCK_DIGEST_HEX_LENGTH = 32;

/** Why a lock file name could not be derived. A refusal here means no lock, never a guessed name. */
export type HostLockNameRuleV1 = "UNIDENTIFIED_RESOURCE" | "UNSAFE_DERIVED_NAME";

export interface HostLockNameV1 {
  ok: boolean;
  /** One safe segment to create under `locksDir`, or `null` when refused. */
  fileName: string | null;
  rule: HostLockNameRuleV1 | null;
  reason: string;
}

/**
 * Turn a canonical resource key into a lock file name, by digest and never by the key itself.
 *
 * A resource key is host text — `C:\wt-a`, a branch name, whatever an Owner typed — and host text is
 * not a file name. Using it directly needs separators stripped, `..` handled, `NUL` and `COM1`
 * refused, case folded and length capped, and every one of those transformations maps two different
 * resources onto one name: `C:/wt-a` and `C:_wt-a` become the same lock, so two runs in two
 * directories each create the file the other one is excluded by. The digest has none of those
 * problems, is fixed length, and is the same on every platform.
 *
 * The readable half deliberately stays out of the name and lives in the file's holder record
 * instead, which is where somebody investigating a stale lock is already looking; a truncated path
 * baked into a file name is a thing later code will try to parse back.
 *
 * `resourceKey` must already be canonical — `canonicalResource` in `leases.ts` decides that, because
 * which spellings are equal is lease policy (a branch is case-folded, a path is resolved) and the
 * store must not hold a second opinion about it.
 */
export function hostLockFileName(input: { kind: LeaseKindV1; resourceKey: string }): HostLockNameV1 {
  const key = input.resourceKey.trim();
  if (key === "") {
    return { ok: false, fileName: null, rule: "UNIDENTIFIED_RESOURCE", reason: "an empty resource key names nothing to exclude" };
  }
  // Defence in depth, whatever kind it came from. Tested positively: a key that is path-shaped must
  // be an identifiable host path. The old test asked only whether the shape was `ESCAPING`, which let
  // through every rooted-looking value the UNC anchor defect produced — `//../../x` was accepted and
  // given a lock file, so two claims climbing out of different bases shared one exclusion domain.
  // A non-path key (a Git ref, a role token) has no separators and is left to its own rules.
  // Kind-aware, and the same answer the lease layer gives. Testing only for a leftover `..` let a
  // relative WORKTREE key like `wt-a` — refused a lease — still name a lock file, so the two layers
  // disagreed about one claim and the weaker one was reachable.
  if (!resourceIsIdentifiable(input.kind, key)) {
    return {
      ok: false,
      fileName: null,
      rule: "UNIDENTIFIED_RESOURCE",
      reason: "the resource key still contains unresolved parent traversal and does not name one place",
    };
  }

  // `\n` separates the fields because a lease kind is a closed union with no newline in it, so no
  // pair of (kind, key) can be re-split into another pair and share a digest.
  const digest = createHash("sha256").update(`${input.kind}\n${key}`, "utf8").digest("hex").slice(0, HOST_LOCK_DIGEST_HEX_LENGTH);
  const fileName = `${input.kind.toLowerCase().replace(/_/g, "-")}-${digest}${HOST_LOCK_FILE_SUFFIX}`;

  // The derivation cannot produce an unsafe segment, so this is an assertion rather than a filter:
  // if it ever fires, the naming scheme changed and the lock directory is no longer trustworthy.
  const validation = validatePathSegment(fileName);
  if (!validation.ok) {
    return { ok: false, fileName: null, rule: "UNSAFE_DERIVED_NAME", reason: `derived lock name is unsafe: ${validation.reason}` };
  }
  return { ok: true, fileName, rule: null, reason: "derived from a digest of kind and canonical resource key" };
}

export interface HostLockHolderV1 {
  missionId: OpaqueId;
  runId: OpaqueId;
  /**
   * What was claimed, as the caller spelled it, and the canonical key the file name was derived
   * from. Both live in the content because the name is a digest: without them a stale lock is an
   * unreadable hash, and the first person to meet one would delete it to find out what it was.
   */
  resource: string;
  resourceKey: string;
  /** Weak on its own — the OS reuses PIDs — so identity carries the stronger fields when known. */
  identity: ProcessIdentityV1;
  acquiredAt: IsoTimestamp;
  heartbeatAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
}

export type HostLockResultV1 =
  | { outcome: "ACQUIRED"; holder: HostLockHolderV1 }
  /** The lock existed, was expired, and the previous holder was confirmed gone. */
  | { outcome: "RECLAIMED"; holder: HostLockHolderV1; reclaimedFrom: HostLockHolderV1 }
  | { outcome: "HELD"; heldBy: HostLockHolderV1; expired: boolean }
  /** Expired but the holder could not be proven dead. The correct answer to "is it gone?" is often "I cannot tell". */
  | { outcome: "REFUSED_UNPROVEN"; heldBy: HostLockHolderV1; liveness: ProcessLivenessV1 }
  /** No name could be derived, so nothing was created. A lock nobody can name excludes nobody. */
  | { outcome: "REJECTED"; name: HostLockNameV1 };

/**
 * The only thing in this package that can actually stop two processes.
 *
 * Backed by an exclusive-create of a file under `DIRECTOR_STORE_LAYOUT_V1.locksDir` — exclusive
 * create is the primitive the OS arbitrates, so the loser learns it lost rather than both winning.
 * The file's content is the holder record, which is what makes a stale lock investigable instead of
 * merely old.
 *
 * Reclaim delegates to the lease rules rather than restating them: expiry alone grants nothing, a
 * confirmed-dead holder plus an expired lock grants a reclaim, `UNKNOWN` grants nothing, and a
 * recorded strong identity must match the observed one.
 */
export interface HostLockManagerV1 {
  /**
   * `resource` is canonicalised by the caller's lease rules (`canonicalResource`) and the file name
   * comes from `hostLockFileName`, which is a digest. Host path text never becomes a file name here:
   * an implementation that sanitises the path into a name maps two directories onto one lock.
   * A resource whose name cannot be derived is `REJECTED`, never locked under a fallback name.
   */
  acquire(input: {
    kind: LeaseKindV1;
    resource: string;
    holder: HostLockHolderV1;
    /** Supplied by the caller after actually looking at the host; the store never guesses. */
    holderLiveness?: ProcessLivenessV1;
    observedIdentity?: ProcessIdentityV1;
    now: IsoTimestamp;
  }): Promise<HostLockResultV1>;
  /** Extends the lock in place. Fails if the caller is no longer the recorded holder. */
  renew(input: { kind: LeaseKindV1; resource: string; holder: HostLockHolderV1; now: IsoTimestamp }): Promise<HostLockResultV1>;
  /** Releasing a lock someone else now holds must be a no-op, never a delete. */
  release(input: { kind: LeaseKindV1; resource: string; holder: HostLockHolderV1 }): Promise<{ released: boolean; reason: string }>;
  /** The single place OS process inspection is allowed to live. */
  probeLiveness(identity: ProcessIdentityV1): Promise<ProcessLivenessV1>;
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

export type RecoveryActionV1 =
  /** Move the unreadable document into `quarantineDir` under a timestamped name. Never delete it. */
  | "QUARANTINE"
  /** Rebuild current state by replaying the journal, which is the durable record. */
  | "REPLAY_JOURNAL"
  /** Nothing to recover; treat as a first run. */
  | "TREAT_AS_ABSENT"
  /** Stop and ask. Used when journal and current state disagree about a completed run. */
  | "ESCALATE_TO_OWNER";

export interface RecoveryPlanV1 {
  action: RecoveryActionV1;
  reason: string;
  /** Set when `QUARANTINE` has already run, so the damaged bytes can still be read by a person. */
  quarantinedTo?: string;
}

/**
 * What a reader does when the bytes do not parse.
 *
 * Never delete, never repair in place, never continue with a partial parse. A truncated `CURRENT.json`
 * usually means the machine died mid-write, and the journal still holds every event that produced it;
 * an implementation that "fixes" the document instead loses the evidence and reports a mission state
 * nobody wrote. Escalation is the answer when replay and current state disagree, because that
 * disagreement is the one case where continuing could double-execute finished work.
 */
export interface MalformedStateRecoveryV1<T> {
  plan(input: { key: StateKeyV1; detail: string; journalAvailable: boolean }): RecoveryPlanV1;
  recover(input: { key: StateKeyV1; plan: RecoveryPlanV1; now: IsoTimestamp }): Promise<StateReadV1<T>>;
}
