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
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";

export const LEASE_SCHEMA_V1 = "aion.director.lease.v1" as const;

/**
 * The kinds of thing that can only have one owner.
 *
 * `PRODUCTION_WRITER` is the strictest: the running production process is the only writer of the
 * Owner's business state, and a second one would race it over a single JSON document.
 */
export type LeaseKindV1 =
  | "WORKTREE"
  | "BRANCH"
  | "INTEGRATION"
  | "PREVIEW"
  | "PRODUCTION_WRITER";

export interface LeaseV1 {
  schema: typeof LEASE_SCHEMA_V1;
  leaseId: OpaqueId;
  kind: LeaseKindV1;
  /** The thing being held: a path, a branch name, a role. */
  resource: string;
  missionId: OpaqueId;
  runId: OpaqueId;
  /** OS process holding it, so a stale claim can be checked rather than assumed. */
  pid: number | null;
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
  heldBy: { missionId: string; runId: string; pid: number | null } | null;
  reason: string;
  /** True when the holder looks stale and the caller should verify before reclaiming. */
  requiresStalenessCheck: boolean;
}

function sameResource(a: LeaseV1, kind: LeaseKindV1, resource: string): boolean {
  return a.kind === kind && a.resource.toLowerCase() === resource.toLowerCase();
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
  now: IsoTimestamp;
  ttlMs?: number;
}): LeaseAttemptV1 {
  const held = input.existing.find((lease) => sameResource(lease, input.kind, input.resource));
  if (held) {
    const expired = Date.parse(held.expiresAt) < Date.parse(input.now);
    if (held.runId === input.runId) {
      return { ok: true, lease: held, heldBy: null, reason: "already held by this run", requiresStalenessCheck: false };
    }
    return {
      ok: false,
      lease: null,
      heldBy: { missionId: held.missionId, runId: held.runId, pid: held.pid },
      reason: expired
        ? "the holder's heartbeat has stopped; confirm the process is gone before taking this"
        : "another run holds this",
      requiresStalenessCheck: expired,
    };
  }

  const ttl = input.ttlMs ?? LEASE_TTL_MS;
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
      missionId: input.missionId,
      runId: input.runId,
      pid: input.pid ?? null,
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

/**
 * Reclaim an expired lease, but only on evidence.
 *
 * `holderProcessAlive` is supplied by the caller after actually looking. A `true` here refuses the
 * reclaim however long the heartbeat has been silent, because a busy machine is not a dead one.
 */
export function reclaimStaleLease(input: {
  existing: readonly LeaseV1[];
  kind: LeaseKindV1;
  resource: string;
  holderProcessAlive: boolean;
  now: IsoTimestamp;
}): { ok: boolean; remaining: LeaseV1[]; reason: string } {
  const held = input.existing.find((lease) => sameResource(lease, input.kind, input.resource));
  if (!held) return { ok: true, remaining: [...input.existing], reason: "nothing held" };

  if (Date.parse(held.expiresAt) >= Date.parse(input.now)) {
    return { ok: false, remaining: [...input.existing], reason: "the lease has not expired" };
  }
  if (input.holderProcessAlive) {
    return {
      ok: false,
      remaining: [...input.existing],
      reason: "the holding process is still alive; a silent heartbeat is not a dead run",
    };
  }
  return {
    ok: true,
    remaining: input.existing.filter((lease) => lease.leaseId !== held.leaseId),
    reason: "holder confirmed gone; lease reclaimed",
  };
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
  return a.kind === b.kind && a.resource.toLowerCase() === b.resource.toLowerCase();
}
