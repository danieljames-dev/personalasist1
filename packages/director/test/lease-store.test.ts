/**
 * Host-wide exclusion: two stores, one lock file, the OS decides.
 */
import assert from "node:assert/strict";
import { writerOrphanScanResult } from "../src/process-identity.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFixedClock } from "../src/bounded-log.js";
import { HANDOFF_SCHEMA_V1 } from "../src/handoff.js";
import { acquireLease } from "../src/leases.js";
import {
  acquireDeveloperAgentWorktreeLease,
  createNodeLeaseStore,
  releaseDeveloperAgentWorktreeLease,
  sandboxDirectorStoreRoot,
} from "../src/lease-store.js";
import {
  createNodeRunFileSystem,
  executeRun,
  type SpawnFnV1,
  type SpawnHandleV1,
} from "../src/run-manager.js";
import { requireSpawnPermit } from "../src/run-intent.js";
import { Readable } from "node:stream";

const NOW = "2026-08-13T12:00:00.000Z";

test("two stores on one root refuse the second acquire of the same worktree", () => {
  const root = mkdtempSync(join(tmpdir(), "aion-lease-store-"));
  try {
    const a = createNodeLeaseStore(root);
    const b = createNodeLeaseStore(root);
    const first = acquireLease({
      existing: a.list(),
      leaseId: "lease-a",
      kind: "WORKTREE",
      resource: "C:\\wt-shared",
      missionId: "m1",
      runId: "run-a",
      now: NOW,
    });
    assert.equal(first.ok, true, first.reason);
    assert.ok(first.lease);
    a.save([first.lease]);

    const second = acquireLease({
      existing: b.list(),
      leaseId: "lease-b",
      kind: "WORKTREE",
      resource: "C:\\wt-shared",
      missionId: "m2",
      runId: "run-b",
      now: NOW,
    });
    if (second.ok && second.lease) {
      assert.throws(() => b.save([second.lease!]), /EEXIST|host lock|already/);
    } else {
      assert.equal(second.ok, false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("after the first store releases, the second store acquires", () => {
  const root = mkdtempSync(join(tmpdir(), "aion-lease-store-rel-"));
  try {
    const a = createNodeLeaseStore(root);
    const b = createNodeLeaseStore(root);
    const first = acquireLease({
      existing: a.list(),
      leaseId: "lease-a",
      kind: "WORKTREE",
      resource: "C:\\wt-shared",
      missionId: "m1",
      runId: "run-a",
      now: NOW,
    });
    assert.ok(first.lease);
    a.save([first.lease]);
    a.save([]);
    const second = acquireLease({
      existing: b.list(),
      leaseId: "lease-b",
      kind: "WORKTREE",
      resource: "C:\\wt-shared",
      missionId: "m2",
      runId: "run-b",
      now: NOW,
    });
    assert.equal(second.ok, true, second.reason);
    assert.ok(second.lease);
    b.save([second.lease]);
    assert.equal(b.list().length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a lock name that cannot be derived is REJECTED, never locked under a fallback", () => {
  const root = mkdtempSync(join(tmpdir(), "aion-lease-store-rej-"));
  try {
    const store = createNodeLeaseStore(root);
    const bogus = {
      schema: "aion.director.lease.v1" as const,
      leaseId: "lease-bad",
      kind: "WORKTREE" as const,
      resource: "../wt-a",
      missionId: "m1",
      runId: "run-a",
      pid: null,
      acquiredAt: NOW,
      heartbeatAt: NOW,
      expiresAt: "2026-08-13T12:10:00.000Z",
    };
    assert.throws(() => store.save([bogus]), /REJECTED/);
    assert.equal(store.list().length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("two executeRun runtimes on one store root spawn into a worktree only once", async () => {
  const root = mkdtempSync(join(tmpdir(), "aion-lease-runtime-"));
  const wt = mkdtempSync(join(tmpdir(), "aion-wt-"));
  try {
    const storeA = createNodeLeaseStore(root);
    const storeB = createNodeLeaseStore(root);
    let spawns = 0;
    const child = (): SpawnHandleV1 => ({
      pid: 4812,
      stdout: Readable.from([""]),
      stderr: Readable.from([""]),
      kill() {
        // unused
      },
      exit: Promise.resolve({ code: 0, signal: null }),
      get exited() {
        return true;
      },
    });
    const spawn: SpawnFnV1 = (_exe, _argv, _options, permit) => {
      requireSpawnPermit(permit);
      spawns += 1;
      return child();
    };
    const fs = createNodeRunFileSystem();
    writeFileSync(join(wt, "PROMPT.md"), "prompt\n");
    const handoffFor = (runId: string) => ({
      schema: HANDOFF_SCHEMA_V1,
      executor: "grok",
      missionId: "mission-1",
      runId,
      workItemId: "work-1",
      branch: "executor/oracle",
      headBefore: "a".repeat(40),
      headAfter: "b".repeat(40),
      status: "PASS",
      tests: [{ suite: "director", total: 1, passed: 1, failed: 0, skipped: 0 }],
      productionMutated: false,
      spendUsd: 0,
      requiresOwner: false,
      nextRecommendedGate: null,
      artifacts: [],
      startedAt: NOW,
      finishedAt: NOW,
      capacityStatus: "AVAILABLE",
      runNonce: `nonce-${runId}`,
      summary: "ok",
    });
    const run = (runId: string, store: typeof storeA) => {
      const runRoot = join(root, runId);
      fs.mkdirp(runRoot);
      return executeRun(
        {
          runId,
          missionId: "mission-1",
          workItemId: "work-1",
          executor: "claude",
          worktree: wt,
          branch: "executor/oracle",
          executablePath: "C:\\Tools\\claude.exe",
          argv: ["-p", "--permission-mode", "bypassPermissions"],
          cwd: wt,
          promptPath: `${wt}\\PROMPT.md`,
          runNonce: `nonce-${runId}`,
          runRoot,
          timeoutMs: 5_000,
          lease: { kind: "WORKTREE", resource: wt, leaseId: `lease-${runId}` },
          authorisedProductionMutated: false,
          role: "IMPLEMENT",
        },
        {
          clock: createFixedClock(NOW),
          fs,
          spawn,
          git: {
            inspectedWorktree: wt,
            run(argv) {
              const key = argv.join(" ");
              if (key === "rev-parse HEAD") {
                return { argv: [...argv], status: 0, stdout: `${"b".repeat(40)}\n`, stderr: "", error: null };
              }
              if (key === "symbolic-ref -q --short HEAD") {
                return { argv: [...argv], status: 0, stdout: "executor/oracle\n", stderr: "", error: null };
              }
              if (argv[0] === "status" && argv.includes("--porcelain")) {
                return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
              }
              if (argv[0] === "merge-base" && argv[1] === "--is-ancestor") {
                return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
              }
              return { argv: [...argv], status: 128, stdout: "", stderr: "fatal\n", error: null };
            },
          },
          probe: {
            observe: (pid) => ({ outcome: "NOT_FOUND" as const, reason: "gone", pid }),
          },
          capacity: {
            tryAcquire: () => ({ ok: true, reason: "ok" }),
            release() {
              // unused
            },
          },
          leases: store,
          wait: async () => undefined,
          killTree: () => undefined,
          scanOrphans: () => writerOrphanScanResult([]),
          resolveArtifactPath: (absolutePath) => absolutePath,
          discoveryEnv: { AION_GROK_PATH: "C:\\Tools\\grok.exe", AION_CLAUDE_CODE_PATH: "C:\\Tools\\claude.exe" },
          discoveryFs: {
            isFile: (path) => (path === "C:\\Tools\\grok.exe" || path === "C:\\Tools\\claude.exe") || /(?:^|[\\\\/])PROMPT\.md$/i.test(path),
            readDir: () => [],
          },
        },
      );
    };
    const [first, second] = await Promise.all([run("run-a", storeA), run("run-b", storeB)]);
    assert.equal(spawns, 1, `expected one spawn, got ${spawns}; ${first.reason} / ${second.reason}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(wt, { recursive: true, force: true });
  }
});

test("sandboxDirectorStoreRoot never defaults to C:\\AION\\director", () => {
  const root = sandboxDirectorStoreRoot({});
  assert.equal(root.toLowerCase().startsWith("c:\\aion\\"), false);
});

test("developer-agent release trusts empty scanner verdict over null-nonce helper descendants", () => {
  const root = mkdtempSync(join(tmpdir(), "aion-dev-agent-release-"));
  const wt = join(root, "wt");
  const holderStartedAt = "2026-08-13T12:00:00.000Z";
  const probe = {
    observe: (pid: number) => ({
      outcome: "FOUND" as const,
      reason: "injected-holder",
      pid,
      creationDate: holderStartedAt,
      executablePath: "C:\\Tools\\node.exe",
    }),
  };
  try {
    const store = createNodeLeaseStore(root);
    const acquired = acquireDeveloperAgentWorktreeLease({
      repositoryRoot: wt,
      now: NOW,
      store,
      probe,
    });
    assert.equal(acquired.ok, true, acquired.ok ? undefined : acquired.reason);
    if (!acquired.ok) return;
    const holderPid = acquired.lease.pid ?? 5000;
    const released = releaseDeveloperAgentWorktreeLease(acquired.store, acquired.lease, {
      scanOrphans: () => ({
        snapshot: [
          {
            pid: holderPid + 1,
            parentPid: holderPid,
            parentPresent: true,
            parentName: "node.exe",
            parentCreationDate: holderStartedAt,
            creationDate: "2026-08-13T12:00:01.000Z",
            executablePath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
            runNonce: null,
            nonceReadable: false,
          },
          {
            pid: holderPid + 2,
            parentPid: holderPid + 1,
            parentPresent: true,
            parentName: "powershell.exe",
            parentCreationDate: "2026-08-13T12:00:01.000Z",
            creationDate: "2026-08-13T12:00:02.000Z",
            executablePath: "C:\\Windows\\System32\\conhost.exe",
            runNonce: null,
            nonceReadable: false,
          },
        ],
        killable: [{ pid: holderPid + 1 }, { pid: holderPid + 2 }],
        liveSightings: [{ pid: holderPid + 1 }, { pid: holderPid + 2 }],
        undecidable: [],
      }),
    });
    assert.equal(released.ok, true, released.reason);
    assert.equal(store.list().length, 0);

    const second = acquireDeveloperAgentWorktreeLease({
      repositoryRoot: wt,
      now: "2026-08-13T12:01:00.000Z",
      store,
      probe,
    });
    assert.equal(second.ok, true, second.ok ? undefined : second.reason);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("developer-agent release still retains the lease for live nonce or undecidable evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "aion-dev-agent-retain-"));
  const wt = join(root, "wt");
  const holderStartedAt = "2026-08-13T12:00:00.000Z";
  const probe = {
    observe: (pid: number) => ({
      outcome: "FOUND" as const,
      reason: "injected-holder",
      pid,
      creationDate: holderStartedAt,
      executablePath: "C:\\Tools\\node.exe",
    }),
  };
  try {
    const store = createNodeLeaseStore(root);
    const acquired = acquireDeveloperAgentWorktreeLease({
      repositoryRoot: wt,
      now: NOW,
      store,
      probe,
    });
    assert.equal(acquired.ok, true, acquired.ok ? undefined : acquired.reason);
    if (!acquired.ok) return;
    const nonce = acquired.lease.processIdentity?.runToken ?? "";
    const holderPid = acquired.lease.pid ?? 5000;
    const matchingNonce = releaseDeveloperAgentWorktreeLease(acquired.store, acquired.lease, {
      scanOrphans: () => ({
        snapshot: [{
          pid: holderPid + 1,
          parentPid: holderPid,
          parentPresent: true,
          parentCreationDate: holderStartedAt,
          creationDate: "2026-08-13T12:00:01.000Z",
          runNonce: nonce,
          nonceReadable: true,
        }],
        killable: [],
        liveSightings: [],
        undecidable: [],
      }),
    });
    assert.equal(matchingNonce.ok, false);
    assert.equal(store.list().length, 1);

    const undecidableEvidence = releaseDeveloperAgentWorktreeLease(acquired.store, acquired.lease, {
      scanOrphans: () => ({
        snapshot: [{
          pid: holderPid + 2,
          parentPid: holderPid + 99,
          parentPresent: false,
          creationDate: "2026-08-13T12:00:01.000Z",
          runNonce: null,
          nonceReadable: false,
        }],
        killable: [],
        liveSightings: [],
        undecidable: [],
      }),
    });
    assert.equal(undecidableEvidence.ok, false);
    assert.equal(store.list().length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
