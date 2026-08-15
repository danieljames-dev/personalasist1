/**
 * Durable lease list plus the host lock the in-memory array cannot provide.
 *
 * `acquireLease` over one process's array says nothing about another process.
 * Exclusive-create of a lock file under `locksDir` is the OS-arbitrated half:
 * the loser learns it lost rather than both winning.
 *
 * Reclaim does not restate the lease rules. A stale lock is investigable
 * because the holder record is written into the file. Existence is not
 * the fact: acquisition reads that record and reclaims only when
 * holderLiveness is DEAD_CONFIRMED. UNKNOWN never deletes.
 *
 * The default root is never `C:\AION\director`. This mission must not write
 * outside the sandbox; callers that omit a root get `AION_DIRECTOR_ROOT` or
 * a temp-directory scratch.
 */
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { writeAtomic } from "./atomic-write.js";
import { DEFAULT_DIRECTOR_ROOT, DIRECTOR_ROOT_ENV } from "./contracts.js";
import { CONTROL_BYTES } from "./control-bytes.js";
import { canonicalizeHostPath, isResolvedHostPath, namesReservedDevice, pathIsInside } from "./host-path.js";
import {
  acquireLease,
  LEASE_SCHEMA_V1,
  livenessFromHolderObservation,
  reclaimStaleLease,
  releaseLease,
  type LeaseV1,
} from "./leases.js";
import {
  createWindowsOrphanScanner,
  createWindowsProcessProbe,
  holderLiveness,
  hostWideTreeEvidenceFromScan,
  isUsablePid,
  livenessGrants,
  measurementApparatusPidsOfThisProcess,
  normaliseRunNonce,
  placeableInstantMs,
  processRowCouldBelongToThisRun,
  processRowPlausibilityContext,
  undecidableRowsOf,
  type HostProcessProbe,
  type HostWideTreeEvidenceV1,
  type ProcessObservationV1,
} from "./process-identity.js";
import { canonicalResource, type LeaseKindV1 } from "./resource-identity.js";
import {
  DIRECTOR_STORE_LAYOUT_V1,
  hostLockFileName,
} from "./store-contract.js";

const HOST_WIDE_KINDS: ReadonlySet<LeaseKindV1> = new Set(["PRODUCTION_WRITER", "INTEGRATION"]);

export interface NodeLeaseStoreV1 {
  list(): readonly LeaseV1[];
  save(leases: readonly LeaseV1[]): void;
  readonly root: string;
  readonly locksDir: string;
  /** Directory that holds PRODUCTION_WRITER / INTEGRATION locks. */
  readonly hostArbitrationRoot: string;
}

export interface NodeLeaseStoreOptionsV1 {
  /**
   * Test-only override of the host-wide lock directory. Production and
   * the CLI must omit this so host-wide kinds lock under
   * {@link hostArbitrationRoot}.
   */
  readonly hostArbitrationRoot?: string;
  /**
   * Process probe used when a lock file already exists. Production omits
   * this and uses {@link createWindowsProcessProbe}. Tests inject
   * UNAVAILABLE / NOT_FOUND so reclamation is deterministic.
   */
  readonly probe?: HostProcessProbe;
  /**
   * Host-wide lock reclaim consults this after the holder-pid
   * DEAD_CONFIRMED gate. One rule with the expired-lease reclaim:
   * {@link hostWideTreeEvidenceFromScan}. Production omits this and
   * uses {@link defaultHostLockTreeEvidence} (the production scanner).
   */
  readonly hostLockTreeEvidence?: (holder: {
    readonly pid: number;
    readonly startedAt?: string;
    readonly runToken?: string;
  }) => HostWideTreeEvidenceV1;
}

/**
 * Machine-scoped lock directory derived only from a validated
 * `SystemDrive`. Ignores `AION_DIRECTOR_ROOT`, `TEMP`, `TMP`, and a
 * redirected `ProgramData` that does not canonicalise to this path.
 * Never `C:\AION\`.
 */
export function derivedHostArbitrationRoot(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const driveRaw = typeof env.SystemDrive === "string" ? env.SystemDrive.trim() : "";
  const drive = /^[A-Za-z]:$/.test(driveRaw) ? driveRaw : "C:";
  return join(`${drive}\\ProgramData`, "AION", "director-d2-host-locks");
}

/**
 * Derive the host-fixed arbitration root, create its locks directory, and
 * confirm the directory that now exists is that derivation. `ProgramData`
 * is ignored. Creation failure, an unreadable created path, and a resolved
 * path that is not the derivation all fail closed.
 */
export function prepareHostArbitrationLocks(
  env: Readonly<Record<string, string | undefined>> = process.env,
  host: {
    readonly mkdir?: (path: string, opts: { recursive: boolean }) => void;
    readonly resolve?: (path: string) => string;
  } = {},
): { readonly ok: true; readonly root: string } | { readonly ok: false; readonly reason: string } {
  const root = derivedHostArbitrationRoot(env);
  const locks = join(root, DIRECTOR_STORE_LAYOUT_V1.locksDir);
  const mkdir = host.mkdir ?? mkdirSync;
  const resolve = host.resolve ?? ((path: string) => realpathSync.native(path));
  try {
    mkdir(locks, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `host arbitration root is not creatable (${root}): ${message}` };
  }
  let observed: string;
  try {
    observed = resolve(locks);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: `created lock directory is not the host-fixed arbitration root (${message})`,
    };
  }
  const expected = canonicalizeHostPath(
    join(derivedHostArbitrationRoot(env), DIRECTOR_STORE_LAYOUT_V1.locksDir),
  );
  if (canonicalizeHostPath(observed) !== expected) {
    return { ok: false, reason: "created lock directory is not the host-fixed arbitration root" };
  }
  return { ok: true, root };
}

function assertSafeDirectorStoreRoot(root: string): void {
  if (root === "") {
    throw new Error("lease store root is empty");
  }
  if (CONTROL_BYTES.test(root)) {
    throw new Error("lease store root contains control bytes");
  }
  if (namesReservedDevice(root)) {
    throw new Error(`lease store root names a reserved device: ${root}`);
  }
  if (!isResolvedHostPath(root)) {
    throw new Error(`lease store root is not an identifiable host path: ${root}`);
  }
  if (pathIsInside(root, DEFAULT_DIRECTOR_ROOT)) {
    throw new Error(`lease store root must not be inside ${DEFAULT_DIRECTOR_ROOT}`);
  }
}

/**
 * Machine-scoped lock directory. `ProgramData` is accepted only when it
 * canonicalises equal to the SystemDrive derivation; otherwise it is
 * ignored. Tests pass an explicit `env`; production reads `process.env`.
 */
export function hostArbitrationRoot(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return derivedHostArbitrationRoot(env);
}

export function isHostWideLeaseKind(kind: string): boolean {
  return HOST_WIDE_KINDS.has(kind as LeaseKindV1);
}

export type HostWriterLockStateV1 =
  | { readonly state: "FREE" }
  | { readonly state: "HELD"; readonly reason: string }
  | { readonly state: "UNKNOWN"; readonly reason: string };

/**
 * One answer to "is the host PRODUCTION_WRITER held?". Uses the same
 * exclusive-create/reclaim facts as {@link openExclusiveLock}: existence
 * is not the fact, DEAD_CONFIRMED is reclaimed, UNKNOWN never becomes
 * free. An unlistable locks directory is UNKNOWN, not "no writer".
 */
export function inspectHostProductionWriterLock(input: {
  readonly arbitrationRoot?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly probe?: HostProcessProbe;
  readonly hostLockTreeEvidence?: NodeLeaseStoreOptionsV1["hostLockTreeEvidence"];
} = {}): HostWriterLockStateV1 {
  const arbitrationRoot = input.arbitrationRoot ?? hostArbitrationRoot(input.env);
  const probe = input.probe ?? createWindowsProcessProbe();
  const treeEvidence = input.hostLockTreeEvidence ?? defaultHostLockTreeEvidence;
  const dir = join(arbitrationRoot, DIRECTOR_STORE_LAYOUT_V1.locksDir);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return { state: "FREE" };
    const message = error instanceof Error ? error.message : String(error);
    return {
      state: "UNKNOWN",
      reason: `host locks directory is unlistable: ${dir}: ${message}`,
    };
  }
  const locks = names.filter((name) =>
    name.startsWith("production-writer-") && name.endsWith(".lock"),
  );
  let unknown: string | null = null;
  for (const name of locks) {
    const lockPath = join(dir, name);
    const reclaim = reclaimStaleHostLockFile(lockPath, probe, treeEvidence, "PRODUCTION_WRITER");
    if (reclaim.ok) continue;
    if (reclaim.holderState === "UNKNOWN") {
      unknown = reclaim.reason;
      continue;
    }
    return { state: "HELD", reason: reclaim.reason };
  }
  if (unknown !== null) return { state: "UNKNOWN", reason: unknown };
  return { state: "FREE" };
}

/**
 * Sandbox store root. Never `DEFAULT_DIRECTOR_ROOT` (`C:\AION\director`).
 */
export function sandboxDirectorStoreRoot(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const override = env[DIRECTOR_ROOT_ENV];
  if (typeof override === "string" && override.trim() !== "") {
    const trimmed = override.trim();
    assertSafeDirectorStoreRoot(trimmed);
    return trimmed;
  }
  return join(tmpdir(), "aion-director-d2-store");
}

export function createNodeLeaseStore(root: string, options?: NodeLeaseStoreOptionsV1): NodeLeaseStoreV1 {
  const resolved = root.trim();
  assertSafeDirectorStoreRoot(resolved);
  const locksDir = join(resolved, DIRECTOR_STORE_LAYOUT_V1.locksDir);
  const arbitrationRoot = options?.hostArbitrationRoot ?? hostArbitrationRoot();
  const probe = options?.probe ?? createWindowsProcessProbe();
  const treeEvidence = options?.hostLockTreeEvidence ?? defaultHostLockTreeEvidence;
  const leasesPath = join(resolved, "leases.json");

  const list = (): LeaseV1[] => {
    let raw: string;
    try {
      raw = readFileSync(leasesPath, "utf8");
    } catch (error) {
      if (isErrno(error, "ENOENT")) return [];
      const message = error instanceof Error ? error.message : String(error);
      const wrapped = new Error(`lease store unreadable: ${leasesPath}: ${message}`);
      if (error !== null && typeof error === "object" && "code" in error) {
        (wrapped as NodeJS.ErrnoException).code = String((error as { code?: unknown }).code);
      }
      throw wrapped;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`lease store unreadable: ${leasesPath} is not parseable: ${message}`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`lease store unreadable: ${leasesPath} is not a lease array`);
    }
    return parsed.filter(isLeaseRecord);
  };

  const save = (leases: readonly LeaseV1[]): void => {
    mkdirSync(locksDir, { recursive: true });
    mkdirSync(dirname(leasesPath), { recursive: true });
    const previous = list();
    const prevIds = new Set(previous.map((item) => item.leaseId));
    const nextIds = new Set(leases.map((item) => item.leaseId));

    for (const lease of leases) {
      if (prevIds.has(lease.leaseId)) {
        // First save writes pid-null. Later persistLeaseHolder must
        // refresh the holder record so a dead process can be reclaimed.
        try {
          const lockDir = lockDirectoryFor(lease.kind);
          writeFileSync(
            lockPathFor(lockDir, lease),
            `${JSON.stringify(holderRecord(lease), null, 2)}\n`,
          );
        } catch {
          // A refresh failure must not drop the in-memory grant.
        }
        continue;
      }
      const lockDir = lockDirectoryFor(lease.kind);
      const lockPath = lockPathFor(lockDir, lease);
      try {
        mkdirSync(lockDir, { recursive: true });
      } catch (error) {
        throw hostArbitrationError(lease.kind, lockDir, error);
      }
      let fd: number;
      try {
        fd = openExclusiveLock(lockPath, lease.kind, probe, treeEvidence);
      } catch (error) {
        throw hostArbitrationError(lease.kind, lockPath, error);
      }
      try {
        writeSync(fd, `${JSON.stringify(holderRecord(lease), null, 2)}\n`);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }

    for (const lease of previous) {
      if (nextIds.has(lease.leaseId)) continue;
      try {
        unlinkSync(lockPathFor(lockDirectoryFor(lease.kind), lease));
      } catch {
        // Missing lock after release is the desired end state.
      }
    }

    writeAtomic(leasesPath, `${JSON.stringify(leases, null, 2)}\n`);
  };

  return { list, save, root: resolved, locksDir, hostArbitrationRoot: arbitrationRoot };

  function lockDirectoryFor(kind: LeaseKindV1): string {
    if (HOST_WIDE_KINDS.has(kind)) {
      return join(arbitrationRoot, DIRECTOR_STORE_LAYOUT_V1.locksDir);
    }
    return locksDir;
  }
}

function hostArbitrationError(kind: LeaseKindV1, path: string, error: unknown): Error {
  const code = error !== null && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  const message = error instanceof Error ? error.message : String(error);
  if (HOST_WIDE_KINDS.has(kind) && (code === "EACCES" || code === "EPERM")) {
    const wrapped = new Error(`host arbitration root is not creatable (${kind}): ${path}: ${message}`);
    (wrapped as NodeJS.ErrnoException).code = code;
    return wrapped;
  }
  if (HOST_WIDE_KINDS.has(kind) && code === "EEXIST") {
    // Reclamation already named the path and the liveness verdict.
    if (message.includes(path) || /UNKNOWN|unreadable|unparseable|already held/i.test(message)) {
      return error instanceof Error ? error : new Error(message);
    }
    const wrapped = new Error(`host-wide ${kind} lock is already held: ${path}`);
    (wrapped as NodeJS.ErrnoException).code = code;
    return wrapped;
  }
  return error instanceof Error ? error : new Error(message);
}

function isErrno(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && "code" in error
    && String((error as { code?: unknown }).code) === code;
}

/**
 * Exclusive-create the lock file. Existence is not the fact: a holder
 * record whose process is DEAD_CONFIRMED is reclaimed. UNKNOWN — including
 * an unreadable record or an UNAVAILABLE probe — leaves the file and
 * names the path.
 */
function openExclusiveLock(
  lockPath: string,
  kind: LeaseKindV1,
  probe: HostProcessProbe,
  treeEvidence: NonNullable<NodeLeaseStoreOptionsV1["hostLockTreeEvidence"]>,
): number {
  try {
    return openSync(lockPath, "wx");
  } catch (error) {
    if (!isErrno(error, "EEXIST")) throw error;
    const reclaim = reclaimStaleHostLockFile(lockPath, probe, treeEvidence, kind);
    if (!reclaim.ok) {
      const wrapped = new Error(reclaim.reason);
      (wrapped as NodeJS.ErrnoException).code = "EEXIST";
      throw wrapped;
    }
    try {
      return openSync(lockPath, "wx");
    } catch (retry) {
      if (isErrno(retry, "EEXIST")) {
        const wrapped = new Error(
          `host-wide ${kind} lock is already held: ${lockPath}`,
        );
        (wrapped as NodeJS.ErrnoException).code = "EEXIST";
        throw wrapped;
      }
      throw retry;
    }
  }
}

type LockReclaimV1 =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly holderState: "HELD" | "UNKNOWN" };

/**
 * Read the holder record and reclaim only on holderLiveness
 * DEAD_CONFIRMED: NOT_FOUND, or a same-slot occupant with a strictly
 * later start and a non-matching nonce. UNKNOWN never deletes.
 */
function reclaimStaleHostLockFile(
  lockPath: string,
  probe: HostProcessProbe,
  treeEvidence: NonNullable<NodeLeaseStoreOptionsV1["hostLockTreeEvidence"]>,
  kind: LeaseKindV1,
): LockReclaimV1 {
  let raw: string;
  try {
    raw = readFileSync(lockPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      holderState: "UNKNOWN",
      reason: `host lock record is unreadable (holder liveness UNKNOWN): ${lockPath}: ${message}`,
    };
  }

  const parsed = parseLockHolderRecord(raw);
  if (!parsed.ok) {
    if (parsed.reason === "lock file has no usable holder pid") {
      return {
        ok: false,
        holderState: "UNKNOWN",
        reason: `host-wide lock is already held (holder liveness UNKNOWN; no usable pid): ${lockPath}`,
      };
    }
    return {
      ok: false,
      holderState: "UNKNOWN",
      reason: `host lock record is unparseable (holder liveness UNKNOWN): ${lockPath}: ${parsed.reason}`,
    };
  }

  let observation: ProcessObservationV1;
  try {
    observation = probe.observe(parsed.pid);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      holderState: "UNKNOWN",
      reason: `host lock holder probe threw (holder liveness UNKNOWN): ${lockPath}: ${message}`,
    };
  }

  const liveness = livenessOfLockHolder(parsed, observation);
  if (!livenessGrants(liveness).reclaim) {
    return {
      ok: false,
      holderState: liveness === "ALIVE" ? "HELD" : "UNKNOWN",
      reason: `host-wide lock is already held (holder liveness ${liveness}): ${lockPath}`,
    };
  }

  if (HOST_WIDE_KINDS.has(kind)) {
    const token = normaliseRunNonce(parsed.runToken ?? "");
    const treeRefused = {
      ok: false as const,
      holderState: "UNKNOWN" as const,
      reason: `host-wide ${kind} lock is held by a run whose process tree is not proven clear`,
    };
    if (token === null) return treeRefused;
    let verdict: HostWideTreeEvidenceV1;
    try {
      verdict = treeEvidence({
        pid: parsed.pid,
        ...(parsed.startedAt !== undefined ? { startedAt: parsed.startedAt } : {}),
        ...(parsed.runToken !== undefined ? { runToken: parsed.runToken } : {}),
      });
    } catch {
      verdict = "UNKNOWN";
    }
    if (verdict !== "CLEAR") return treeRefused;
  }

  try {
    unlinkSync(lockPath);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return { ok: true };
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      holderState: "UNKNOWN",
      reason: `host lock could not be unlinked after DEAD_CONFIRMED (holder liveness UNKNOWN): ${lockPath}: ${message}`,
    };
  }
  return { ok: true };
}

type ParsedLockHolderV1 = {
  readonly ok: true;
  readonly pid: number;
  readonly startedAt?: string;
  readonly runToken?: string;
};

function parseLockHolderRecord(raw: string): ParsedLockHolderV1 | { readonly ok: false; readonly reason: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "lock file is not JSON" };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "lock file is not an object" };
  }
  const row = value as {
    pid?: unknown;
    identity?: { pid?: unknown; startedAt?: unknown; runToken?: unknown };
  };
  if (!isUsablePid(row.pid)) {
    return { ok: false, reason: "lock file has no usable holder pid" };
  }
  const identity = row.identity !== null && typeof row.identity === "object" ? row.identity : undefined;
  const startedAt = typeof identity?.startedAt === "string" ? identity.startedAt : undefined;
  const runToken = typeof identity?.runToken === "string" ? identity.runToken : undefined;
  return {
    ok: true,
    pid: row.pid,
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(runToken !== undefined ? { runToken } : {}),
  };
}

function livenessOfLockHolder(
  recorded: { readonly pid: number; readonly startedAt?: string; readonly runToken?: string },
  observation: ProcessObservationV1,
): "ALIVE" | "DEAD_CONFIRMED" | "UNKNOWN" {
  if (observation.outcome === "NOT_FOUND") return "DEAD_CONFIRMED";
  if (observation.outcome === "UNAVAILABLE") return "UNKNOWN";
  if (recorded.startedAt === undefined) return "UNKNOWN";
  return holderLiveness({
    pid: recorded.pid,
    creationDate: recorded.startedAt,
    executablePath: "C:\\unobserved-lock-holder",
    runNonce: recorded.runToken ?? "",
  }, observation);
}

/**
 * Production default for {@link NodeLeaseStoreOptionsV1.hostLockTreeEvidence}.
 * A missing runToken is UNKNOWN — nothing to scan by. A throw or an
 * incomplete scan is UNKNOWN. Live sightings are LIVE. Only a completed
 * scan with zero live sightings is CLEAR.
 */
function defaultHostLockTreeEvidence(holder: {
  readonly pid: number;
  readonly startedAt?: string;
  readonly runToken?: string;
}): HostWideTreeEvidenceV1 {
  const token = normaliseRunNonce(holder.runToken ?? "");
  if (token === null) return "UNKNOWN";
  try {
    const scanned = createWindowsOrphanScanner()({
      runNonce: token,
      createdNotBefore: holder.startedAt ?? "",
      holderPid: holder.pid,
      apparatusPids: [...measurementApparatusPidsOfThisProcess()],
    });
    const ctx = processRowPlausibilityContext({
      runNonce: token,
      createdNotBefore: holder.startedAt ?? "",
      holderPid: holder.pid,
      observedPids: [holder.pid],
      apparatusPids: measurementApparatusPidsOfThisProcess(),
      rows: scanned.snapshot,
    });
    if (undecidableRowsOf(scanned.snapshot, ctx).length > 0) {
      return hostWideTreeEvidenceFromScan({ performed: false, liveSightings: [] });
    }
    const live = scanned.snapshot.filter((row) => processRowCouldBelongToThisRun(row, ctx));
    return hostWideTreeEvidenceFromScan({ performed: true, liveSightings: live });
  } catch {
    return "UNKNOWN";
  }
}

function lockPathFor(locksDir: string, lease: LeaseV1): string {
  // The lock file name must use the same key conflicts() compares on.
  // If conflicts() ignores the resource for a kind, the file name ignores
  // it too. PREVIEW is SINGLETON but conflicts() compares its token, so
  // it keeps per-token naming.
  const resourceKey = HOST_WIDE_KINDS.has(lease.kind)
    ? lease.kind
    : (lease.resourceKey ?? canonicalResource(lease.kind, lease.resource));
  const named = hostLockFileName({ kind: lease.kind, resourceKey });
  if (!named.ok || named.fileName === null) {
    const error = new Error(`host lock REJECTED: ${named.reason}`);
    (error as NodeJS.ErrnoException).code = "REJECTED";
    throw error;
  }
  return join(locksDir, named.fileName);
}

function holderRecord(lease: LeaseV1): Record<string, unknown> {
  return {
    leaseId: lease.leaseId,
    kind: lease.kind,
    resource: lease.resource,
    resourceKey: lease.resourceKey ?? canonicalResource(lease.kind, lease.resource),
    missionId: lease.missionId,
    runId: lease.runId,
    pid: lease.pid,
    ...(lease.processIdentity !== undefined ? { identity: lease.processIdentity } : {}),
    acquiredAt: lease.acquiredAt,
    heartbeatAt: lease.heartbeatAt,
    expiresAt: lease.expiresAt,
  };
}

function isLeaseRecord(value: unknown): value is LeaseV1 {
  if (value === null || typeof value !== "object") return false;
  const row = value as Partial<LeaseV1>;
  if (row.schema !== LEASE_SCHEMA_V1 || typeof row.leaseId !== "string" || typeof row.kind !== "string") {
    return false;
  }
  if (typeof row.expiresAt !== "string" || placeableInstantMs(row.expiresAt) === null) {
    return false;
  }
  return true;
}

let developerAgentInvocationSeq = 0;

function nextDeveloperAgentInvocationId(): string {
  developerAgentInvocationSeq += 1;
  return `dev-agent-${process.pid}-${developerAgentInvocationSeq}`;
}

/**
 * Second launch path (developer-agent) must take a WORKTREE lease from
 * the same store and refuse when a host PRODUCTION_WRITER lock is held.
 * Discovery of the binary is not a spawn permit. Each invocation mints
 * its own runId/leaseId and records this process as the holder so a
 * second concurrent agent conflicts instead of adopting, and so an
 * expired row can be reclaimed from a pid observation.
 */
export function acquireDeveloperAgentWorktreeLease(input: {
  readonly repositoryRoot: string;
  readonly now: string;
  readonly missionId?: string;
  /**
   * Correlation label only. Never the identity {@link acquireLease}
   * compares: two callers passing the same string are still two
   * invocations. The minted `dev-agent-${pid}-${seq}` is the runId.
   */
  readonly runId?: string;
  readonly store?: NodeLeaseStoreV1;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly probe?: HostProcessProbe;
  readonly hostLockTreeEvidence?: NodeLeaseStoreOptionsV1["hostLockTreeEvidence"];
}): { ok: true; store: NodeLeaseStoreV1; lease: LeaseV1 } | { ok: false; reason: string } {
  const store = input.store ?? createNodeLeaseStore(sandboxDirectorStoreRoot(input.env));
  const probe = input.probe ?? createWindowsProcessProbe();
  const host = inspectHostProductionWriterLock({
    arbitrationRoot: store.hostArbitrationRoot,
    ...(input.env !== undefined ? { env: input.env } : {}),
    probe,
    ...(input.hostLockTreeEvidence !== undefined ? { hostLockTreeEvidence: input.hostLockTreeEvidence } : {}),
  });
  if (host.state === "UNKNOWN") {
    return { ok: false, reason: `PRODUCTION_WRITER host lock is UNKNOWN: ${host.reason}` };
  }
  if (host.state === "HELD") {
    return { ok: false, reason: `a PRODUCTION_WRITER lease is held on this host: ${host.reason}` };
  }
  let existing: readonly LeaseV1[];
  try {
    existing = store.list();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `lease store unreadable: ${message}` };
  }
  if (existing.some((row) => row.kind === "PRODUCTION_WRITER")) {
    return { ok: false, reason: "a PRODUCTION_WRITER lease is held in this store" };
  }
  const invocation = nextDeveloperAgentInvocationId();
  const processIdentity = developerAgentHolderIdentity(probe, process.pid);
  const mint = (rows: readonly LeaseV1[]) => acquireLease({
    existing: rows,
    leaseId: invocation,
    kind: "WORKTREE",
    resource: input.repositoryRoot,
    missionId: input.missionId ?? "dev-agent",
    runId: invocation,
    pid: process.pid,
    processIdentity,
    now: input.now,
  });
  let attempt = mint(existing);
  if ((!attempt.ok || attempt.lease === null) && attempt.requiresStalenessCheck === true) {
    const reclaimed = reclaimDeveloperAgentStaleHolder({
      existing,
      resource: input.repositoryRoot,
      heldBy: attempt.heldBy,
      probe,
      now: input.now,
    });
    if (reclaimed.ok) {
      try {
        store.save(reclaimed.remaining);
        existing = store.list();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: `lease persist failed: ${message}` };
      }
      attempt = mint(existing);
    }
  }
  if (!attempt.ok || attempt.lease === null) {
    return { ok: false, reason: attempt.reason };
  }
  try {
    store.save([
      ...existing.filter((row) => row.leaseId !== attempt.lease!.leaseId),
      attempt.lease,
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `lease persist failed: ${message}` };
  }
  return { ok: true, store, lease: attempt.lease };
}

function developerAgentHolderIdentity(
  probe: HostProcessProbe,
  pid: number,
): { pid: number; startedAt?: string } {
  try {
    const observation = probe.observe(pid);
    if (observation.outcome === "FOUND" && typeof observation.creationDate === "string" && observation.creationDate !== "") {
      return { pid, startedAt: observation.creationDate };
    }
  } catch {
    // A failed probe is not a clock reading. Omit startedAt.
  }
  return { pid };
}

function reclaimDeveloperAgentStaleHolder(input: {
  readonly existing: readonly LeaseV1[];
  readonly resource: string;
  readonly heldBy: {
    readonly pid: number | null;
    readonly processIdentity: LeaseV1["processIdentity"] | null;
  } | null;
  readonly probe: HostProcessProbe;
  readonly now: string;
}): { ok: boolean; remaining: readonly LeaseV1[] } {
  const recordedPid = input.heldBy?.pid ?? null;
  if (!isUsablePid(recordedPid)) return { ok: false, remaining: input.existing };
  let observation: ProcessObservationV1;
  try {
    observation = input.probe.observe(recordedPid);
  } catch {
    observation = { outcome: "UNAVAILABLE", reason: "probe threw", pid: recordedPid };
  }
  const result = reclaimStaleLease({
    existing: input.existing,
    kind: "WORKTREE",
    resource: input.resource,
    holderLiveness: livenessFromHolderObservation(observation),
    now: input.now,
    holderObservation: { outcome: observation.outcome, pid: recordedPid },
    ...(observation.outcome === "FOUND"
      ? {
        observedIdentity: {
          pid: observation.pid,
          ...(observation.creationDate !== undefined ? { startedAt: observation.creationDate } : {}),
          ...(typeof observation.runNonce === "string" ? { runToken: observation.runNonce } : {}),
        },
      }
      : {}),
  });
  return { ok: result.ok, remaining: result.remaining };
}

export function releaseDeveloperAgentWorktreeLease(
  store: NodeLeaseStoreV1,
  lease: LeaseV1,
): void {
  try {
    store.save(releaseLease(store.list(), lease));
  } catch {
    // Best-effort release. An unlistable store is not a successful release.
  }
}


