/**
 * Host-wide exclusivity: two OS processes, one lock file with owner evidence.
 * Stale ≠ "pid missing". Stale requires identity mismatch or proven-dead + creation-time check.
 */
import { readFileSync, unlinkSync, existsSync, mkdirSync, openSync, writeSync, closeSync } from "node:fs";
import { dirname, join } from "node:path";
import { queryProcess, identitiesMatch } from "./process-identity.mjs";

export function lockPathForKey(root, resourceKey) {
  const safe = String(resourceKey).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
  return join(root, `${safe}.lock`);
}

export function writeLockAtomic(file, record) {
  mkdirSync(dirname(file), { recursive: true });
  try {
    const fd = openSync(file, "wx");
    writeSync(fd, JSON.stringify(record, null, 2));
    closeSync(fd);
    return { ok: true };
  } catch (error) {
    if (error && error.code === "EEXIST") return { ok: false, reason: "already-exists" };
    return { ok: false, reason: error.message };
  }
}

export function readLock(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { corrupt: true };
  }
}

export function acquireHostLock({ root, resourceKey, owner }) {
  const file = lockPathForKey(root, resourceKey);
  const existing = readLock(file);
  if (existing && !existing.corrupt) {
    return { ok: false, reason: "held", heldBy: existing, file, requiresStaleCheck: true };
  }
  const record = {
    schema: "aion.director.host-lock.v1",
    resourceKey,
    pid: owner.pid,
    creationDate: owner.creationDate || null,
    executablePath: owner.executablePath || process.execPath,
    runNonce: owner.runNonce,
    acquiredAt: new Date().toISOString(),
  };
  const w = writeLockAtomic(file, record);
  if (!w.ok) return { ok: false, reason: w.reason, file };
  return { ok: true, file, record };
}

export function staleVerdict(lockRecord, observation) {
  if (!lockRecord) return { stale: true, reason: "no-lock" };
  if (lockRecord.corrupt) return { stale: false, reason: "corrupt-needs-human" };
  if (!observation?.ok) {
    if (lockRecord.creationDate) {
      return { stale: false, reason: "pid-absent-but-reuse-unproven", action: "re-query-then-compare-creation" };
    }
    return { stale: false, reason: "pid-absent-insufficient-without-creation-time" };
  }
  const match = identitiesMatch({
    pid: lockRecord.pid,
    creationDate: lockRecord.creationDate,
    executablePath: lockRecord.executablePath,
    runNonce: lockRecord.runNonce,
  }, observation);
  if (match.ok) return { stale: false, reason: "holder-alive" };
  return { stale: true, reason: match.reason };
}

export function reclaimIfStale({ root, resourceKey }) {
  const file = lockPathForKey(root, resourceKey);
  const rec = readLock(file);
  if (!rec) return { ok: true, reason: "nothing-held" };
  const first = rec.pid ? queryProcess(rec.pid) : { ok: false };
  if (first.ok) {
    const v = staleVerdict(rec, first);
    if (!v.stale) return { ok: false, reason: v.reason, lock: rec };
    unlinkSync(file);
    return { ok: true, reason: `reclaimed:${v.reason}` };
  }
  if (!rec.creationDate) {
    return { ok: false, reason: "pid-absent-insufficient-without-creation-time", lock: rec };
  }
  const second = rec.pid ? queryProcess(rec.pid) : { ok: false };
  if (second.ok) {
    const v = staleVerdict(rec, second);
    if (!v.stale) return { ok: false, reason: v.reason, lock: rec };
  }
  unlinkSync(file);
  return { ok: true, reason: "reclaimed:pid-absent-twice-with-creation-record" };
}
