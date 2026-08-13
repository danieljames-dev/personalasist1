import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSafeSync } from "../lib/spawn-safe.mjs";
import { acquireHostLock, reclaimIfStale, staleVerdict } from "../lib/host-lock.mjs";
import { queryProcess } from "../lib/process-identity.mjs";

const worker = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "lock-contender.mjs");

function runWorker(root, key, mode) {
  return spawnSafeSync(process.execPath, [worker, root, key, mode, `nonce-${mode}`], { timeout: 20_000 });
}

test("two OS processes: second acquire fails on the same resource key", () => {
  const root = mkdtempSync(join(tmpdir(), "aion-lock-"));
  const a = runWorker(root, "worktree:wt-a", "acquire-exit");
  assert.equal(a.status, 0, `${a.stderr}\n${a.stdout}`);
  const b = runWorker(root, "worktree:wt-a", "acquire-exit");
  assert.notEqual(b.status, 0, "second process must not take the lock");
  const parsed = JSON.parse((b.stdout || "").trim().split(/\r?\n/).at(-1));
  assert.equal(parsed.ok, false);
});

test("slash spelling is irrelevant once both sides use the same typed key", () => {
  const root = mkdtempSync(join(tmpdir(), "aion-lock-"));
  const a = runWorker(root, "worktree:fs:1:2:c:/wt-a", "acquire-exit");
  const b = runWorker(root, "worktree:fs:1:2:c:/wt-a", "acquire-exit");
  assert.equal(a.status, 0);
  assert.notEqual(b.status, 0);
});

test("PRODUCTION_WRITER singleton conflicts across processes", () => {
  const root = mkdtempSync(join(tmpdir(), "aion-lock-"));
  const a = runWorker(root, "singleton:production-writer:default", "acquire-exit");
  const b = runWorker(root, "singleton:production-writer:default", "acquire-exit");
  assert.equal(a.status, 0);
  assert.notEqual(b.status, 0);
});

test("different worktree keys may both proceed", () => {
  const root = mkdtempSync(join(tmpdir(), "aion-lock-"));
  const a = runWorker(root, "worktree:wt-a", "acquire-exit");
  const b = runWorker(root, "worktree:wt-b", "acquire-exit");
  assert.equal(a.status, 0);
  assert.equal(b.status, 0);
});

test("crash without cleanup does not make a missing PID automatically ownable without creation evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "aion-lock-"));
  const crashed = runWorker(root, "worktree:wt-crash", "acquire-crash");
  assert.equal(crashed.status, 99);
  const rec = JSON.parse((crashed.stdout || "").trim().split(/\r?\n/).at(-1));
  assert.equal(rec.ok, true);
  const live = queryProcess(process.pid);
  const noCreation = staleVerdict({ pid: 999999, runNonce: "x" }, { ok: false });
  assert.equal(noCreation.stale, false);
  const aliveSelf = staleVerdict({
    pid: process.pid,
    creationDate: live.creationDate,
    executablePath: process.execPath,
    runNonce: null,
  }, live);
  assert.equal(aliveSelf.stale, false);
});

test("reclaim requires identity evidence, not lock-file-exists-forever", async () => {
  const root = mkdtempSync(join(tmpdir(), "aion-lock-"));
  const self = queryProcess(process.pid);
  const first = acquireHostLock({
    root,
    resourceKey: "worktree:self",
    owner: { pid: process.pid, creationDate: self.creationDate, executablePath: process.execPath, runNonce: "self" },
  });
  assert.equal(first.ok, true);
  const denied = reclaimIfStale({ root, resourceKey: "worktree:self" });
  assert.equal(denied.ok, false);
  assert.match(denied.reason, /holder-alive|alive/i);
});
