/**
 * Durable lease list plus the host lock the in-memory array cannot provide.
 *
 * `acquireLease` over one process's array says nothing about another process.
 * Exclusive-create of a lock file under `locksDir` is the OS-arbitrated half:
 * the loser learns it lost rather than both winning.
 *
 * Reclaim does not restate the lease rules. A stale lock is investigable
 * because the holder record is written into the file.
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
  unlinkSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { writeAtomic } from "./atomic-write.js";
import { DIRECTOR_ROOT_ENV } from "./contracts.js";
import { CONTROL_BYTES } from "./control-bytes.js";
import {
  acquireLease,
  LEASE_SCHEMA_V1,
  releaseLease,
  type LeaseV1,
} from "./leases.js";
import { placeableInstantMs } from "./process-identity.js";
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
}

/**
 * Machine-scoped lock directory. Ignores `AION_DIRECTOR_ROOT`, `TEMP`,
 * and `TMP`. Never `C:\AION\`.
 */
export function hostArbitrationRoot(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const programData = typeof env.ProgramData === "string" ? env.ProgramData.trim() : "";
  if (programData !== "" && !CONTROL_BYTES.test(programData)) {
    return join(programData, "AION", "director-d2-host-locks");
  }
  const driveRaw = typeof env.SystemDrive === "string" ? env.SystemDrive.trim() : "";
  const drive = /^[A-Za-z]:$/.test(driveRaw) ? driveRaw : "C:";
  return join(`${drive}\\ProgramData`, "AION", "director-d2-host-locks");
}

export function isHostWideLeaseKind(kind: string): boolean {
  return HOST_WIDE_KINDS.has(kind as LeaseKindV1);
}

/** Whether a PRODUCTION_WRITER lock file exists under the host-fixed root. */
export function hostProductionWriterHeld(
  env: Readonly<Record<string, string | undefined>> = process.env,
  arbitrationRoot: string = hostArbitrationRoot(env),
): boolean {
  const dir = join(arbitrationRoot, DIRECTOR_STORE_LAYOUT_V1.locksDir);
  try {
    return readdirSync(dir).some((name) =>
      name.startsWith("production-writer-") && name.endsWith(".lock"),
    );
  } catch {
    return false;
  }
}

/**
 * Sandbox store root. Never `DEFAULT_DIRECTOR_ROOT` (`C:\AION\director`).
 */
export function sandboxDirectorStoreRoot(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const override = env[DIRECTOR_ROOT_ENV];
  if (typeof override === "string" && override.trim() !== "") return override.trim();
  return join(tmpdir(), "aion-director-d2-store");
}

export function createNodeLeaseStore(root: string, options?: NodeLeaseStoreOptionsV1): NodeLeaseStoreV1 {
  const resolved = root.trim();
  if (resolved === "") {
    throw new Error("lease store root is empty");
  }
  const locksDir = join(resolved, DIRECTOR_STORE_LAYOUT_V1.locksDir);
  const arbitrationRoot = options?.hostArbitrationRoot ?? hostArbitrationRoot();
  const leasesPath = join(resolved, "leases.json");

  const list = (): LeaseV1[] => {
    try {
      const raw = readFileSync(leasesPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isLeaseRecord);
    } catch {
      return [];
    }
  };

  const save = (leases: readonly LeaseV1[]): void => {
    mkdirSync(locksDir, { recursive: true });
    mkdirSync(dirname(leasesPath), { recursive: true });
    const previous = list();
    const prevIds = new Set(previous.map((item) => item.leaseId));
    const nextIds = new Set(leases.map((item) => item.leaseId));

    for (const lease of leases) {
      if (prevIds.has(lease.leaseId)) continue;
      const lockDir = lockDirectoryFor(lease.kind);
      const lockPath = lockPathFor(lockDir, lease);
      try {
        mkdirSync(lockDir, { recursive: true });
      } catch (error) {
        throw hostArbitrationError(lease.kind, lockDir, error);
      }
      let fd: number;
      try {
        fd = openSync(lockPath, "wx");
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
    const wrapped = new Error(`host-wide ${kind} lock is already held`);
    (wrapped as NodeJS.ErrnoException).code = code;
    return wrapped;
  }
  return error instanceof Error ? error : new Error(message);
}

function lockPathFor(locksDir: string, lease: LeaseV1): string {
  const resourceKey = lease.resourceKey ?? canonicalResource(lease.kind, lease.resource);
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

/**
 * Second launch path (developer-agent) must take a WORKTREE lease from
 * the same store and refuse when a host PRODUCTION_WRITER lock is held.
 * Discovery of the binary is not a spawn permit.
 */
export function acquireDeveloperAgentWorktreeLease(input: {
  readonly repositoryRoot: string;
  readonly now: string;
  readonly missionId?: string;
  readonly runId?: string;
  readonly store?: NodeLeaseStoreV1;
}): { ok: true; store: NodeLeaseStoreV1; lease: LeaseV1 } | { ok: false; reason: string } {
  if (hostProductionWriterHeld()) {
    return { ok: false, reason: "a PRODUCTION_WRITER lease is held on this host" };
  }
  const store = input.store ?? createNodeLeaseStore(sandboxDirectorStoreRoot());
  const existing = store.list();
  if (existing.some((row) => row.kind === "PRODUCTION_WRITER")) {
    return { ok: false, reason: "a PRODUCTION_WRITER lease is held in this store" };
  }
  const attempt = acquireLease({
    existing,
    leaseId: "devagent1",
    kind: "WORKTREE",
    resource: input.repositoryRoot,
    missionId: input.missionId ?? "dev-agent",
    runId: input.runId ?? "dev-agent-run",
    now: input.now,
  });
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

export function releaseDeveloperAgentWorktreeLease(
  store: NodeLeaseStoreV1,
  lease: LeaseV1,
): void {
  try {
    store.save(releaseLease(store.list(), lease));
  } catch {
    // Best-effort release.
  }
}


