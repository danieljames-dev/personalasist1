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
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { writeAtomic } from "./atomic-write.js";
import { DIRECTOR_ROOT_ENV } from "./contracts.js";
import {
  LEASE_SCHEMA_V1,
  type LeaseV1,
} from "./leases.js";
import { canonicalResource } from "./resource-identity.js";
import {
  DIRECTOR_STORE_LAYOUT_V1,
  hostLockFileName,
} from "./store-contract.js";

export interface NodeLeaseStoreV1 {
  list(): readonly LeaseV1[];
  save(leases: readonly LeaseV1[]): void;
  readonly root: string;
  readonly locksDir: string;
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

export function createNodeLeaseStore(root: string): NodeLeaseStoreV1 {
  const resolved = root.trim();
  if (resolved === "") {
    throw new Error("lease store root is empty");
  }
  const locksDir = join(resolved, DIRECTOR_STORE_LAYOUT_V1.locksDir);
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
      const lockPath = lockPathFor(locksDir, lease);
      const fd = openSync(lockPath, "wx");
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
        unlinkSync(lockPathFor(locksDir, lease));
      } catch {
        // Missing lock after release is the desired end state.
      }
    }

    writeAtomic(leasesPath, `${JSON.stringify(leases, null, 2)}\n`);
  };

  return { list, save, root: resolved, locksDir };
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
  return row.schema === LEASE_SCHEMA_V1 && typeof row.leaseId === "string" && typeof row.kind === "string";
}


