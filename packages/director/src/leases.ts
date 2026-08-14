/**
 * One owner at a time for anything that cannot survive two.
 *
 * Two executors in one worktree is not a merge conflict, it is a corrupted run: one checks out a
 * branch while the other is mid-build, and both report success against a tree neither of them
 * actually produced. A lease is the smallest thing that prevents it — a durable claim on a named
 * resource, held by a run, with a heartbeat.
 *
 * ## Expiry is a question, never a permission
 *
 * The tempting design is: lease expires, next run takes it. That is exactly how the corrupted case
 * happens, because a heartbeat stops for two reasons — the process died, or the process is busy and
 * the machine is loaded. An expired lease therefore means *go and look*, and reclaiming requires
 * positive evidence that the holder is gone. The check belongs to the caller, because only the host
 * can see processes; what lives here is the rule that the evidence is required.
 *
 * ## "I could not tell" is an answer, and it is not "dead"
 *
 * Liveness is therefore three-valued. A boolean forces the one honest outcome — the probe failed, the
 * process is protected, the host was too loaded to answer — into either "alive" or "dead", and
 * whichever way that flag falls, one of them hands a live run's worktree to a second executor.
 * `UNKNOWN` grants nothing; only `DEAD_CONFIRMED` against an already-expired lease permits a reclaim.
 *
 * ## A PID is a slot, not a process
 *
 * The OS reuses PIDs, quickly on a machine that spawns executors all day. "PID 4812 is alive" is
 * therefore not "the holder is alive", and worse, "PID 4812 is alive but it is now `node.exe`" reads
 * as evidence about a holder that has actually been gone for an hour. So a lease may carry a stronger
 * identity — the process start time, or a token the run writes at launch — and when it carries one,
 * the observation must match it before any conclusion is drawn from it.
 *
 * ## One spelling per resource
 *
 * `C:/wt-a` and `C:\wt-a` are one directory. Compared as raw strings they are two leases, both
 * uncontested, and the corrupted run this module exists to prevent happens with the rule working
 * exactly as written. Resource identity is therefore canonical, using the same path canonicaliser the
 * store uses for lock file names, so a lease and its lock can never disagree about what was claimed.
 *
 * ## A resource nobody can pin down is refused, not granted
 *
 * `../wt-a` names a different directory to every process with a different working directory, and an
 * empty resource names none. Either one would take a lease that excludes nobody — the second
 * executor arrives, its claim canonicalises to some other string, and both hold what looks like an
 * uncontested lease on one worktree. Such a claim is therefore refused at the point it is made.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
// One canonicaliser for the whole package, taken from the pure path module rather than from the
// store: these rules must stay decidable — and testable — with no persistence layer in the process,
// and `store-contract.ts` is where filesystem code lands. A private copy here would drift from the
// store's idea of which directory a path names, and that alias collision comes back as a lease held
// under one spelling and a lock file created under another.
import { canonicalResource, resourceIsIdentifiable, type LeaseKindV1 } from "./resource-identity.js";

export const LEASE_SCHEMA_V1 = "aion.director.lease.v1" as const;

/**
 * The kinds of thing that can only have one owner.
 *
 * `PRODUCTION_WRITER` is the strictest: the running production process is the only writer of the
 * Owner's business state, and a second one would race it over a single JSON document.
 */

/**
 * What the caller learned by looking at the host.
 *
 * `UNKNOWN` is the important member and the reason this is not a boolean: a probe that failed, a
 * process on another account, or an access-denied answer is not evidence of death, and the only safe
 * handling is to leave the lease alone and let a person look.
 */
export type ProcessLivenessV1 = "ALIVE" | "DEAD_CONFIRMED" | "UNKNOWN";

/**
 * Who is holding, in more than a PID.
 *
 * Every field beyond `pid` is optional because the host may not offer it, but any field that *is*
 * recorded becomes mandatory to match later — recording a start time and then reclaiming without
 * checking it would be worse than never recording one, since the record implies it was used.
 */
export interface ProcessIdentityV1 {
  pid: number | null;
  /** Process start instant. A reused PID belongs to a process that started later. */
  startedAt?: IsoTimestamp;
  /** A token the run writes at launch and the probe reads back. Survives PID reuse outright. */
  runToken?: string;
}

export interface LeaseV1 {
  schema: typeof LEASE_SCHEMA_V1;
  leaseId: OpaqueId;
  kind: LeaseKindV1;
  /** The thing being held, as the caller spelled it: a path, a branch name, a role. */
  resource: string;
  /**
   * The canonical form of `resource`, which is what identity is actually decided on.
   *
   * Optional because leases written before canonicalisation existed have no key on disk; every
   * comparison recomputes from `resource` rather than trusting this, so an old record still matches.
   * Stored because the store's lock file is named from a digest of exactly this string, and a lease
   * that cannot show which key its lock was derived from cannot be matched to that lock by hand.
   */
  resourceKey?: string;
  missionId: OpaqueId;
  runId: OpaqueId;
  /** OS process holding it, so a stale claim can be checked rather than assumed. */
  pid: number | null;
  /** Recorded when the host could supply more than a PID. Checked on every reclaim attempt. */
  processIdentity?: ProcessIdentityV1;
  acquiredAt: IsoTimestamp;
  heartbeatAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
}

/** How long a lease stands without a heartbeat before it must be questioned. */
export const LEASE_TTL_MS = 10 * 60 * 1000;

export interface LeaseAttemptV1 {
  ok: boolean;
  lease: LeaseV1 | null;
  /** Set when refused, naming who holds it. */
  heldBy: { missionId: string; runId: string; pid: number | null; processIdentity: ProcessIdentityV1 | null } | null;
  reason: string;
  /** True when the holder looks stale and the caller should verify before reclaiming. */
  requiresStalenessCheck: boolean;
}

// Identity lives in its own pure module so the lease rules and the lock-file rules cannot disagree
// about one claim — they did: a WORKTREE key of `wt-a` was refused a lease and granted a lock file.
export {
  canonicalResource,
  resourceIsIdentifiable,
  IDENTITY_MODEL,
  type LeaseKindV1,
  type ResourceIdentityModelV1,
} from "./resource-identity.js";

function sameResource(a: LeaseV1, kind: LeaseKindV1, resource: string): boolean {
  return a.kind === kind && canonicalResource(a.kind, a.resource) === canonicalResource(kind, resource);
}

/**
 * How much a comparison of two process identities is actually worth.
 *
 * `UNVERIFIABLE` is deliberately distinct from `MATCH`: two records agreeing on nothing but a PID
 * have agreed on a slot number, which is the exact confusion PID reuse creates.
 */
export type IdentityMatchV1 = "MATCH" | "MISMATCH" | "UNVERIFIABLE";

export function processIdentityMatches(
  recorded: ProcessIdentityV1 | null | undefined,
  observed: ProcessIdentityV1 | null | undefined,
): IdentityMatchV1 {
  if (!recorded || !observed) return "UNVERIFIABLE";

  if (recorded.runToken !== undefined && observed.runToken !== undefined) {
    if (recorded.runToken !== observed.runToken) return "MISMATCH";
  }
  if (recorded.startedAt !== undefined && observed.startedAt !== undefined) {
    // Compared as instants, because two encodings of one moment are not two processes.
    if (Date.parse(recorded.startedAt) !== Date.parse(observed.startedAt)) return "MISMATCH";
  }
  if (recorded.pid !== null && observed.pid !== null && recorded.pid !== observed.pid) return "MISMATCH";

  const strongAgreement =
    (recorded.runToken !== undefined && observed.runToken !== undefined) ||
    (recorded.startedAt !== undefined && observed.startedAt !== undefined);
  return strongAgreement ? "MATCH" : "UNVERIFIABLE";
}

/** Whether a lease recorded anything a probe can be held to beyond a PID. */
function hasStrongIdentity(identity: ProcessIdentityV1 | undefined): identity is ProcessIdentityV1 {
  return identity !== undefined && (identity.runToken !== undefined || identity.startedAt !== undefined);
}

/**
 * Try to take a lease.
 *
 * A live holder refuses outright. An apparently expired holder refuses too, but says so differently:
 * the caller is told to establish whether the process is really gone. Nothing here reclaims on the
 * strength of a clock.
 */
export function acquireLease(input: {
  existing: readonly LeaseV1[];
  leaseId: OpaqueId;
  kind: LeaseKindV1;
  resource: string;
  missionId: OpaqueId;
  runId: OpaqueId;
  pid?: number | null;
  /** Supplied when the host can name the process by more than its slot number. */
  processIdentity?: ProcessIdentityV1;
  now: IsoTimestamp;
  ttlMs?: number;
}): LeaseAttemptV1 {
  // Refused before anything is compared: a claim on `../wt-a` or on `""` would be recorded, would
  // look uncontested to every other spelling of the same directory, and would hand the caller an
  // exclusion it does not have. There is no safe key to grant here, so nothing is granted.
  if (!resourceIsIdentifiable(input.kind, input.resource)) {
    return {
      ok: false,
      lease: null,
      heldBy: null,
      reason: "the resource does not name one identifiable place; resolve it against a base before claiming it",
      requiresStalenessCheck: false,
    };
  }

  const held = input.existing.find((lease) => sameResource(lease, input.kind, input.resource));
  if (held) {
    const expired = Date.parse(held.expiresAt) < Date.parse(input.now);
    if (held.runId === input.runId) {
      return { ok: true, lease: held, heldBy: null, reason: "already held by this run", requiresStalenessCheck: false };
    }
    return {
      ok: false,
      lease: null,
      heldBy: {
        missionId: held.missionId,
        runId: held.runId,
        pid: held.pid,
        // Handed back so the caller can probe the holder it must match, not merely a PID.
        processIdentity: held.processIdentity ?? null,
      },
      reason: expired
        ? "the holder's heartbeat has stopped; confirm the process is gone before taking this"
        : "another run holds this",
      requiresStalenessCheck: expired,
    };
  }

  const ttl = input.ttlMs ?? LEASE_TTL_MS;
  const identity = input.processIdentity;
  return {
    ok: true,
    heldBy: null,
    reason: "acquired",
    requiresStalenessCheck: false,
    lease: {
      schema: LEASE_SCHEMA_V1,
      leaseId: input.leaseId,
      kind: input.kind,
      resource: input.resource,
      resourceKey: canonicalResource(input.kind, input.resource),
      missionId: input.missionId,
      runId: input.runId,
      pid: input.pid ?? identity?.pid ?? null,
      // exactOptionalPropertyTypes: absent stays absent, so a lease never claims an identity of
      // `undefined` that a later `in` check would report as present.
      ...(identity ? { processIdentity: identity } : {}),
      acquiredAt: input.now,
      heartbeatAt: input.now,
      expiresAt: new Date(Date.parse(input.now) + ttl).toISOString(),
    },
  };
}

export function heartbeat(lease: LeaseV1, now: IsoTimestamp, ttlMs = LEASE_TTL_MS): LeaseV1 {
  return {
    ...lease,
    heartbeatAt: now,
    expiresAt: new Date(Date.parse(now) + ttlMs).toISOString(),
  };
}

export function releaseLease(existing: readonly LeaseV1[], leaseId: OpaqueId): LeaseV1[] {
  return existing.filter((lease) => lease.leaseId !== leaseId);
}

/** Why a reclaim was refused, in a form a caller can branch on instead of matching prose. */
export type ReclaimRefusalV1 =
  | "NOT_EXPIRED"
  | "HOLDER_ALIVE"
  | "LIVENESS_UNKNOWN"
  | "IDENTITY_MISMATCH"
  | "IDENTITY_UNVERIFIABLE"
  | "HOLDER_UNOBSERVED"
  | "HOLDER_UNOBSERVABLE";

/**
 * What a probe reported about a specific pid. A liveness enum is not this.
 * `NOT_FOUND` of the recorded holder pid is sufficient evidence the holder is gone.
 */
export interface HolderObservationV1 {
  readonly outcome: "NOT_FOUND" | "FOUND" | "UNAVAILABLE";
  readonly pid?: number;
}

export interface ReclaimResultV1 {
  ok: boolean;
  remaining: LeaseV1[];
  reason: string;
  refusal: ReclaimRefusalV1 | null;
}

/**
 * Reclaim an expired lease, but only on evidence.
 *
 * Every path out of here is a refusal except one: the lease has expired, the caller looked at the
 * host and came back with `DEAD_CONFIRMED`, and that finding is bound to an observation of the
 * recorded holder pid (or, when the lease recorded a start time or a run token, to a matching
 * identity). A liveness enum with nothing observed is not a probe. `ALIVE` refuses however long
 * the heartbeat has been silent, because a busy machine is not a dead run, and `UNKNOWN` refuses
 * because a failed probe is not a death certificate.
 *
 * When the lease records a pid the observation is read, not merely checked for presence.
 * `NOT_FOUND` of that pid is sufficient. `UNAVAILABLE` is an unanswered probe and is not a death
 * certificate. `FOUND` means the slot is occupied: that grants only when a recorded strong identity
 * plus an `observedIdentity` of the same pid produce a genuine different-process verdict — the
 * occupant is not the holder. A pid-only lease cannot tell a reused slot from the holder still
 * running, so `FOUND` refuses.
 */
export function reclaimStaleLease(input: {
  existing: readonly LeaseV1[];
  kind: LeaseKindV1;
  resource: string;
  /** The caller's finding after actually looking. Absent means nobody looked, which is `UNKNOWN`. */
  holderLiveness?: ProcessLivenessV1;
  /**
   * @deprecated Pass `holderLiveness`. Kept so callers written against the two-valued API keep
   * compiling and keep their meaning (`true` was "alive", `false` was "I confirmed it is gone"), but
   * a boolean cannot express `UNKNOWN` and every new call site must say which of the three it means.
   */
  holderProcessAlive?: boolean;
  /** What the probe actually saw, checked against the identity the lease recorded. */
  observedIdentity?: ProcessIdentityV1;
  /**
   * Host observation of a specific pid. Required (or `observedIdentity` about the
   * same pid) when the held lease records a pid and the caller asserts `DEAD_CONFIRMED`.
   * The outcome is what decides: `NOT_FOUND` of that pid is sufficient; `UNAVAILABLE`
   * and `FOUND` are not, unless `FOUND` is independently a different occupant.
   */
  holderObservation?: HolderObservationV1;
  now: IsoTimestamp;
}): ReclaimResultV1 {
  const held = input.existing.find((lease) => sameResource(lease, input.kind, input.resource));
  if (!held) return { ok: true, remaining: [...input.existing], reason: "nothing held", refusal: null };

  const unchanged = [...input.existing];
  const granted: ReclaimResultV1 = {
    ok: true,
    remaining: input.existing.filter((lease) => lease.leaseId !== held.leaseId),
    reason: "holder confirmed gone; lease reclaimed",
    refusal: null,
  };
  const liveness: ProcessLivenessV1 =
    input.holderLiveness ??
    (input.holderProcessAlive === undefined ? "UNKNOWN" : input.holderProcessAlive ? "ALIVE" : "DEAD_CONFIRMED");

  if (Date.parse(held.expiresAt) >= Date.parse(input.now)) {
    return { ok: false, remaining: unchanged, reason: "the lease has not expired", refusal: "NOT_EXPIRED" };
  }
  if (liveness === "ALIVE") {
    return {
      ok: false,
      remaining: unchanged,
      reason: "the holding process is still alive; a silent heartbeat is not a dead run",
      refusal: "HOLDER_ALIVE",
    };
  }
  if (liveness === "UNKNOWN") {
    return {
      ok: false,
      remaining: unchanged,
      reason: "the holder could not be checked; an unanswered probe is not evidence the run is gone",
      refusal: "LIVENESS_UNKNOWN",
    };
  }

  // DEAD_CONFIRMED from here. A label with nothing to observe is not a death certificate.
  const recordedPid = held.pid;
  if (!isRecordedHolderPid(recordedPid) && !hasStrongIdentity(held.processIdentity)) {
    return {
      ok: false,
      remaining: unchanged,
      reason: "the lease recorded no holder pid and no process identity; a label is not an observation",
      refusal: "HOLDER_UNOBSERVABLE",
    };
  }
  if (isRecordedHolderPid(recordedPid)) {
    const observation = input.holderObservation;
    const observedId = input.observedIdentity;
    const observationAboutPid =
      (observation !== undefined && observation.pid === recordedPid)
      || (observedId !== undefined && observedId.pid === recordedPid);
    if (!observationAboutPid) {
      return {
        ok: false,
        remaining: unchanged,
        reason: "the recorded holder pid was not observed; a liveness label is not a probe",
        refusal: "HOLDER_UNOBSERVED",
      };
    }
    if (observation !== undefined && observation.pid === recordedPid) {
      if (observation.outcome === "NOT_FOUND") {
        return granted;
      }
      if (observation.outcome === "UNAVAILABLE") {
        return {
          ok: false,
          remaining: unchanged,
          reason: "the holder probe could not answer; an unanswered probe is not evidence the run is gone",
          refusal: "LIVENESS_UNKNOWN",
        };
      }
      if (observation.outcome === "FOUND") {
        if (occupantIsNotRecordedHolder(held.processIdentity, observedId, recordedPid)) {
          return granted;
        }
        return {
          ok: false,
          remaining: unchanged,
          reason: "the recorded pid is occupied and the occupant cannot be shown to be a different process",
          refusal: "IDENTITY_UNVERIFIABLE",
        };
      }
      return {
        ok: false,
        remaining: unchanged,
        reason: "the holder observation outcome was not examined; an unexamined probe is not evidence the run is gone",
        refusal: "LIVENESS_UNKNOWN",
      };
    }
  }

  // The remaining question is whether the death was the holder's.
  if (hasStrongIdentity(held.processIdentity)) {
    const verdict = processIdentityMatches(held.processIdentity, input.observedIdentity);
    if (verdict === "MISMATCH") {
      return {
        ok: false,
        remaining: unchanged,
        reason: "the process examined is not the one that took this lease; a reused PID proves nothing about the holder",
        refusal: "IDENTITY_MISMATCH",
      };
    }
    if (verdict === "UNVERIFIABLE") {
      return {
        ok: false,
        remaining: unchanged,
        reason: "this lease recorded a stronger process identity; a PID-only observation cannot confirm the holder is gone",
        refusal: "IDENTITY_UNVERIFIABLE",
      };
    }
  }

  return granted;
}

function isRecordedHolderPid(pid: number | null): pid is number {
  return typeof pid === "number" && Number.isInteger(pid) && pid > 0;
}

/**
 * True when the occupant of `recordedPid` is proven to be a different process than the holder.
 * Same-slot `MISMATCH` is PID reuse. A different observed pid, or no strong recorded identity,
 * cannot distinguish reuse from the holder still running.
 */
function occupantIsNotRecordedHolder(
  recorded: ProcessIdentityV1 | undefined,
  observed: ProcessIdentityV1 | undefined,
  recordedPid: number,
): boolean {
  if (!hasStrongIdentity(recorded) || observed === undefined) return false;
  if (observed.pid !== recordedPid) return false;
  if (recorded.pid !== null && recorded.pid !== recordedPid) return false;
  return processIdentityMatches(recorded, observed) === "MISMATCH";
}

/** Leases a run holds, for release when it ends. */
export function leasesForRun(existing: readonly LeaseV1[], runId: OpaqueId): LeaseV1[] {
  return existing.filter((lease) => lease.runId === runId);
}

/**
 * Whether two resources may be worked simultaneously.
 *
 * Different worktrees are genuinely parallel — Claude implementing while Grok reviews is the normal
 * case and the reason leases are per-resource rather than global. Integration and production
 * writing are singular regardless of path.
 */
export function conflicts(a: { kind: LeaseKindV1; resource: string }, b: { kind: LeaseKindV1; resource: string }): boolean {
  if (a.kind === "INTEGRATION" && b.kind === "INTEGRATION") return true;
  if (a.kind === "PRODUCTION_WRITER" && b.kind === "PRODUCTION_WRITER") return true;
  if (a.kind !== b.kind) return false;
  // `../wt-a` cannot be shown to be a different directory from `C:/repos/wt-a`, so "no conflict" is
  // a claim the text does not support. The safe error is to schedule them one after the other.
  if (!resourceIsIdentifiable(a.kind, a.resource) || !resourceIsIdentifiable(b.kind, b.resource)) return true;
  return canonicalResource(a.kind, a.resource) === canonicalResource(b.kind, b.resource);
}
