/**
 * The D2 stack is reachable, and there is one implementation of each guarantee.
 *
 * A correct module that nothing calls is the worst of both: the defects it was written to
 * fix stay live in the older copy. This file reads the source and builds the import graph
 * so a later split cannot ship as a green suite.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createFixedClock } from "../src/bounded-log.js";
import { HANDOFF_SCHEMA_V1 } from "../src/handoff.js";
import type { LeaseV1 } from "../src/leases.js";
import type { ExecutorProcessIdentityV1, ProcessObservationV1 } from "../src/process-identity.js";
import { executeRun, type SpawnHandleV1 } from "../src/run-manager.js";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "..", "src");

const FROM_IMPORT = /from\s+["'](\.[^"']+)["']/g;

function sourceFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const name of readdirSync(srcDir)) {
    if (!name.endsWith(".ts")) continue;
    files.set(name, readFileSync(join(srcDir, name), "utf8"));
  }
  return files;
}

function specifierToFile(specifier: string): string | null {
  const base = specifier.replace(/^\.\//, "").replace(/\.js$/, "");
  return `${base}.ts`;
}

function importsOf(source: string): string[] {
  const found: string[] = [];
  FROM_IMPORT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FROM_IMPORT.exec(source)) !== null) {
    const file = specifierToFile(match[1] ?? "");
    if (file !== null) found.push(file);
  }
  return found;
}

function countCalls(source: string, pattern: RegExp): number {
  const copy = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  return (source.match(copy) ?? []).length;
}

test("every src module is imported by a non-test module, or is the package entry", () => {
  const files = sourceFiles();
  assert.ok(files.has("index.ts"), "src/index.ts is the package entry");

  const importedBy = new Map<string, string[]>();
  for (const name of files.keys()) importedBy.set(name, []);

  for (const [from, source] of files) {
    for (const target of importsOf(source)) {
      if (!files.has(target)) continue;
      importedBy.get(target)!.push(from);
    }
  }

  const orphans: string[] = [];
  for (const name of files.keys()) {
    if (name === "index.ts") continue;
    if ((importedBy.get(name) ?? []).length === 0) orphans.push(name);
  }
  assert.deepEqual(orphans, [], `unreachable src modules: ${orphans.join(", ")}`);
});

test("there is exactly one argv builder: the adapter, reached through buildLaunchPlan", () => {
  const files = sourceFiles();
  const executors = files.get("executors.ts") ?? "";
  const adapters = files.get("executor-adapters.ts") ?? "";

  assert.match(adapters, /\bexport\s+function\s+buildExecutorLaunch\b/);
  assert.match(executors, /\bexport\s+function\s+buildLaunchPlan\b/);
  assert.match(executors, /\bbuildExecutorLaunch\s*\(/, "buildLaunchPlan must delegate to the adapter");
  assert.doesNotMatch(
    executors,
    /dontAsk/,
    "the old capability-driven argv list must not remain beside the adapter",
  );
  assert.doesNotMatch(executors, /argv\.push/);
});

test("there is exactly one discovery ladder, and the launch path uses it", () => {
  const files = sourceFiles();
  const readers: string[] = [];
  for (const [name, source] of files) {
    if (source.includes("AION_CLAUDE_CODE_PATH")) readers.push(name);
  }
  assert.deepEqual(
    readers,
    ["executor-discovery.ts"],
    `AION_CLAUDE_CODE_PATH must be read only by the D2 ladder, saw ${readers.join(", ")}`,
  );

  const launch = files.get("run-manager.ts") ?? "";
  assert.match(launch, /discoverClaudeExecutor/);
  assert.match(launch, /discoverGrokExecutor/);
});

test("there is exactly one handoff parser call on the run path", () => {
  const files = sourceFiles();
  const runManager = files.get("run-manager.ts") ?? "";
  const handoff = files.get("handoff.ts") ?? "";

  assert.match(handoff, /\bexport\s+function\s+parseHandoff\b/);
  assert.equal(
    countCalls(runManager, /\bparseHandoff\s*\(/g),
    1,
    "run-manager must parse the handoff once",
  );
  assert.doesNotMatch(runManager, /structuralHandoff/);
});

test("there is exactly one handoff-vs-reality verdict, and it is the one that runs", () => {
  const files = sourceFiles();
  for (const [name, source] of files) {
    assert.doesNotMatch(
      source,
      /\bfunction\s+handoffIsTrustworthy\b/,
      `${name} must not keep a second handoff-vs-reality predicate`,
    );
  }

  const runManager = files.get("run-manager.ts") ?? "";
  assert.equal(
    countCalls(runManager, /\bfindHandoffContradictions\s*\(/g),
    1,
    "the running conjunction must call findHandoffContradictions",
  );
  assert.match(runManager, /handoff\.status/, "the running verdict must read handoff status");
});

test("there is exactly one Git verdict path, and it consumes the collector", () => {
  const files = sourceFiles();
  const gitTruth = files.get("git-truth.ts") ?? "";
  assert.match(gitTruth, /\bexport\s+function\s+verifyGitTruth\b/);
  assert.match(
    gitTruth,
    /GitSnapshotV1\s*\|\s*GitObservationV1|GitObservationV1\s*\|\s*GitSnapshotV1/,
    "verifyGitTruth must accept the collector observation",
  );

  const runManager = files.get("run-manager.ts") ?? "";
  assert.match(runManager, /\bcollectGitTruth\s*\(/);
  assert.equal(
    countCalls(runManager, /\bverifyGitTruth\s*\(/g),
    1,
    "executeRun must judge the collected observation",
  );
});

test("the executor launch path is discovery → adapters → intent → spawn → log → Git → conjunction", () => {
  const files = sourceFiles();
  const runManager = files.get("run-manager.ts") ?? "";
  assert.match(runManager, /\bexport\s+async\s+function\s+launchRun\b/);
  assert.match(runManager, /\bexport\s+async\s+function\s+executeRun\b/);
  assert.match(runManager, /\bdiscoverClaudeExecutor\b/);
  assert.match(runManager, /\bdiscoverGrokExecutor\b/);
  assert.match(runManager, /\bbuildExecutorLaunch\s*\(/);
  assert.match(runManager, /\bpersistRunIntent\s*\(/);
  assert.match(runManager, /deps\.spawn\s*\(/);
  assert.match(runManager, /\bcreateBoundedLog\s*\(/);
  assert.match(runManager, /\bcollectGitTruth\s*\(/);
  assert.match(runManager, /\bverifyGitTruth\s*\(/);
  assert.match(runManager, /\bevaluateSuccessConjunction\s*\(/);
  assert.match(runManager, /\bproveWriterExit\s*\(/);
});

test("a live nonce-bearing grandchild leaves productionWriterLeaseReleasedByThisRun false", async () => {
  // Was: assert.match(runManager, /\bdetectOrphan\s*\(/). That passed while every
  // call discarded the verdict. Drive executeRun; if detectOrphan's answer is
  // ignored, a live grandchild plus a landed release sets the field.
  const now = "2026-08-13T12:00:00.000Z";
  const later = "2026-08-13T12:00:30.000Z";
  const headAfter = "b".repeat(40);
  const cwd = "C:\\wt";
  const runRoot = "C:\\AION\\director\\RUNS\\run-1";
  const exe = "C:\\Tools\\grok.exe";
  const nonce = "nonce-run-1";
  const t0 = "2026-08-13T12:00:01.000Z";
  const recorded: ExecutorProcessIdentityV1 = {
    pid: 4812,
    creationDate: t0,
    executablePath: exe,
    runNonce: nonce,
  };
  const found: ProcessObservationV1 = {
    outcome: "FOUND",
    reason: "injected",
    pid: recorded.pid,
    creationDate: recorded.creationDate,
    executablePath: recorded.executablePath,
    runNonce: recorded.runNonce,
  };
  let observeIndex = 0;
  const files = new Map<string, string>([
    [join(runRoot, "handoff.json"), JSON.stringify({
      schema: HANDOFF_SCHEMA_V1,
      executor: "grok",
      missionId: "mission-1",
      runId: "run-1",
      workItemId: "work-1",
      branch: "executor/oracle",
      headBefore: "a".repeat(40),
      headAfter,
      status: "PASS",
      tests: [{ suite: "director", total: 1, passed: 1, failed: 0, skipped: 0 }],
      productionMutated: false,
      spendUsd: 0,
      requiresOwner: false,
      nextRecommendedGate: null,
      artifacts: ["notes.md"],
      startedAt: now,
      finishedAt: later,
      capacityStatus: "AVAILABLE",
      summary: "ok",
    })],
  ]);
  const dirs = new Set([cwd, runRoot]);
  let leases: LeaseV1[] = [];

  const child: SpawnHandleV1 = {
    pid: recorded.pid,
    stdout: Readable.from([""]),
    stderr: Readable.from([""]),
    kill() { /* already exited */ },
    exit: Promise.resolve({ code: 0, signal: null }),
    get exited() {
      return true;
    },
  };

  const result = await executeRun(
    {
      runId: "run-1",
      missionId: "mission-1",
      workItemId: "work-1",
      executor: "grok",
      worktree: cwd,
      branch: "executor/oracle",
      executablePath: exe,
      argv: ["--prompt-file", `${cwd}\\PROMPT.md`, "--cwd", cwd, "--no-plan"],
      cwd,
      runNonce: nonce,
      runRoot,
      timeoutMs: 30_000,
      lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-1" },
      authorisedProductionMutated: false,
    },
    {
      clock: createFixedClock(now),
      fs: {
        isDirectory: (path) => dirs.has(path),
        isFile: (path) => files.has(path),
        readUtf8(path) {
          const value = files.get(path);
          if (value === undefined) throw new Error(`ENOENT ${path}`);
          return value;
        },
        writeDurable(path, utf8) {
          files.set(path, utf8);
        },
        mkdirp(path) {
          dirs.add(path);
        },
      },
      spawn: () => child,
      git: {
        run(argv) {
          const key = argv.join(" ");
          if (key === "rev-parse HEAD") return { argv: [...argv], status: 0, stdout: `${headAfter}\n`, stderr: "", error: null };
          if (key === "symbolic-ref -q --short HEAD") {
            return { argv: [...argv], status: 0, stdout: "executor/oracle\n", stderr: "", error: null };
          }
          if (key === "status --porcelain") return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
          if (argv[0] === "rev-parse" && argv.includes("@{upstream}")) {
            return { argv: [...argv], status: 128, stdout: "", stderr: "fatal: no upstream configured\n", error: null };
          }
          throw new Error(`unexpected git argv: ${JSON.stringify(argv)}`);
        },
      },
      probe: {
        observe() {
          observeIndex += 1;
          return observeIndex === 1 ? found : { outcome: "NOT_FOUND", reason: "parent gone" };
        },
      },
      capacity: {
        tryAcquire: () => ({ ok: true, reason: "capacity-acquired" }),
        release() { /* unused */ },
      },
      leases: {
        list: () => [...leases],
        save: (next) => {
          leases = [...next];
        },
      },
      wait: async () => undefined,
      killTree: () => undefined,
      scanOrphans: () => [{ pid: 7777, runNonce: nonce, creationDate: t0 }],
    },
  );

  assert.equal(result.spawned, true, result.reason);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.ok(
    leases.some((item) => item.leaseId === "lease-pw-1"),
    "detectOrphan must be read: a live grandchild keeps the writer lease",
  );
});
