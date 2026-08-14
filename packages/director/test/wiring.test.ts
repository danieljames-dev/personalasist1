/**
 * The D2 stack is reachable, and there is one implementation of each guarantee.
 *
 * A correct module that nothing calls is the worst of both: the defects it was written to
 * fix stay live in the older copy. Declaration-matching regexes are not a physical fact:
 * they stay green while the symbol is never invoked. Call-position checks strip the
 * declaration first; the launch path is driven.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createFixedClock } from "../src/bounded-log.js";
import { HANDOFF_SCHEMA_V1 } from "../src/handoff.js";
import type { LeaseV1 } from "../src/leases.js";
import type { ExecutorProcessIdentityV1, ProcessObservationV1 } from "../src/process-identity.js";
import { requireSpawnPermit } from "../src/run-intent.js";
import {
  createNodeRunFileSystem,
  executeRun,
  launchRun,
  type SpawnFnV1,
  type SpawnHandleV1,
} from "../src/run-manager.js";

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

/** Strip `export async function name(` so a later `name(` is a call, not the declaration. */
function withoutDeclaration(source: string, name: string): string {
  return source.replace(
    new RegExp(String.raw`(?:export\s+)?(?:async\s+)?function\s+${name}\s*\(`, "g"),
    `function ${name}_decl(`,
  );
}

function calledIn(source: string, name: string): boolean {
  return new RegExp(String.raw`\b${name}\s*\(`).test(withoutDeclaration(source, name));
}

function modulesCalling(files: Map<string, string>, name: string): string[] {
  const hits: string[] = [];
  for (const [file, source] of files) {
    if (calledIn(source, name)) hits.push(file);
  }
  return hits.sort();
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

test("index.ts does not export a launch path that bypasses the adapter", async () => {
  const director = await import("../src/index.js");
  assert.equal(
    "executeRun" in director,
    false,
    "executeRun must not be a public entry; launchRun is the only launch path",
  );
  assert.equal(typeof director.launchRun, "function");
});

test("there is exactly one argv builder: the adapter, reached through launchRun", () => {
  const files = sourceFiles();
  const executors = files.get("executors.ts") ?? "";

  assert.ok(
    modulesCalling(files, "buildExecutorLaunch").includes("run-manager.ts"),
    "the live launch path must call the adapter directly",
  );
  assert.doesNotMatch(
    executors,
    /dontAsk/,
    "the old capability-driven argv list must not remain beside the adapter",
  );
  assert.doesNotMatch(executors, /argv\.push/);
});

test("deleted discovery and launch-plan names are not on the public surface of index.ts", async () => {
  const director = await import("../src/index.js");
  const removed = [
    "selectExecutor",
    "buildLaunchPlan",
    "capabilitiesFromHelp",
    "isDirectlySpawnableWindowsExe",
    "readCapacity",
    "capacityFallback",
  ];
  for (const name of removed) {
    assert.equal(name in director, false, `${name} must not be exported`);
  }
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
  assert.ok(calledIn(launch, "discoverClaudeExecutor"), "launchRun must call discoverClaudeExecutor");
  assert.ok(calledIn(launch, "discoverGrokExecutor"), "launchRun must call discoverGrokExecutor");
});

test("there is exactly one handoff parser call on the run path", () => {
  const files = sourceFiles();
  const runManager = files.get("run-manager.ts") ?? "";

  assert.equal(
    countCalls(withoutDeclaration(runManager, "parseHandoff"), /\bparseHandoff\s*\(/g),
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
    countCalls(withoutDeclaration(runManager, "findHandoffContradictions"), /\bfindHandoffContradictions\s*\(/g),
    1,
    "the running conjunction must call findHandoffContradictions",
  );
  assert.ok(
    /handoff\.status/.test(runManager),
    "the running verdict must read handoff status",
  );
});

test("there is exactly one Git verdict path, and it consumes the collector", () => {
  const files = sourceFiles();
  const gitTruth = files.get("git-truth.ts") ?? "";
  assert.ok(
    /GitSnapshotV1\s*\|\s*GitObservationV1|GitObservationV1\s*\|\s*GitSnapshotV1/.test(gitTruth),
    "verifyGitTruth must accept the collector observation",
  );

  const runManager = files.get("run-manager.ts") ?? "";
  assert.ok(calledIn(runManager, "collectGitTruth"));
  assert.equal(
    countCalls(withoutDeclaration(runManager, "verifyGitTruth"), /\bverifyGitTruth\s*\(/g),
    1,
    "executeRun must judge the collected observation",
  );
});

test("launchRun is the discovery entry: it finds the binary, builds argv, and consumes a minted permit", async () => {
  // Was: assert.match(runManager, /\bexport\s+async\s+function\s+launchRun\b/).
  // That matched the declaration. launchRun had zero call sites.
  const dir = mkdtempSync(join(tmpdir(), "aion-launch-run-"));
  const promptPath = join(dir, "PROMPT.md");
  const runRoot = join(dir, "run");
  const exe = "C:\\Tools\\grok.exe";
  writeFileSync(promptPath, "do the work\n");
  try {
    let spawnedExe: string | null = null;
    let spawnedArgv: readonly string[] = [];
    const spawn: SpawnFnV1 = (executable, argv, options, permit) => {
      requireSpawnPermit(permit);
      spawnedExe = executable;
      spawnedArgv = argv;
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);
      const child: SpawnHandleV1 = {
        pid: 4812,
        stdout: Readable.from([""]),
        stderr: Readable.from([""]),
        kill() { /* unused */ },
        exit: Promise.resolve({ code: 0, signal: null }),
        get exited() {
          return true;
        },
      };
      return child;
    };

    const hostFs = createNodeRunFileSystem();
    hostFs.mkdirp(runRoot);
    hostFs.writeDurable(join(runRoot, "handoff.json"), JSON.stringify({
      schema: HANDOFF_SCHEMA_V1,
      executor: "grok",
      missionId: "mission-1",
      runId: "run-1",
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
      startedAt: "2026-08-13T12:00:00.000Z",
      finishedAt: "2026-08-13T12:00:30.000Z",
      capacityStatus: "AVAILABLE",
      summary: "ok",
    }));

    const result = await launchRun(
      {
        runId: "run-1",
        missionId: "mission-1",
        workItemId: "work-1",
        executor: "grok",
        worktree: dir,
        branch: "executor/oracle",
        cwd: dir,
        runNonce: "nonce-run-1",
        runRoot,
        promptPath,
        timeoutMs: 30_000,
        lease: { kind: "WORKTREE", resource: dir, leaseId: "lease-launch-1" },
        authorisedProductionMutated: false,
        role: "ADVERSARIAL_REVIEW",
      },
      {
        clock: createFixedClock("2026-08-13T12:00:00.000Z"),
        fs: hostFs,
        spawn,
        git: {
          run(argv) {
            const key = argv.join(" ");
            if (key === "rev-parse HEAD") {
              return { argv: [...argv], status: 0, stdout: `${"b".repeat(40)}\n`, stderr: "", error: null };
            }
            if (key === "symbolic-ref -q --short HEAD") {
              return { argv: [...argv], status: 0, stdout: "executor/oracle\n", stderr: "", error: null };
            }
            if (key === "status --porcelain") {
              return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
            }
            if (argv[0] === "rev-parse" && argv.includes("@{upstream}")) {
              return { argv: [...argv], status: 128, stdout: "", stderr: "fatal: no upstream configured\n", error: null };
            }
            if (argv[0] === "merge-base" && argv[1] === "--is-ancestor") {
              return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
            }
            throw new Error(`unexpected git argv: ${JSON.stringify(argv)}`);
          },
        },
        probe: {
          observe: () => ({
            outcome: "FOUND",
            reason: "injected",
            pid: 4812,
            creationDate: "2026-08-13T12:00:01.000Z",
            executablePath: exe,
            runNonce: "nonce-run-1",
          }),
        },
        capacity: {
          tryAcquire: () => ({ ok: true, reason: "capacity-acquired" }),
          release() { /* unused */ },
        },
        leases: {
          list: () => [],
          save() { /* unused */ },
        },
        wait: async () => undefined,
        killTree: () => undefined,
        scanOrphans: () => [],
        discoveryEnv: { AION_GROK_PATH: exe },
        discoveryFs: {
          isFile: (path) => path === exe,
          readDir: () => [],
        },
      },
    );

    assert.equal(result.spawned, true, result.reason);
    assert.equal(spawnedExe, exe, "launchRun must use the discovered executable, not a caller-supplied one");
    assert.ok(spawnedArgv.includes("--prompt-file"), "launchRun must use the adapter argv");
    assert.ok(spawnedArgv.includes("--no-plan"), "launchRun must use the measured Grok flags");
    assert.ok(spawnedArgv.includes(promptPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
          if (value === undefined) {
            const error = new Error(`ENOENT ${path}`);
            (error as NodeJS.ErrnoException).code = "ENOENT";
            throw error;
          }
          return value;
        },
        writeDurable(path, utf8) {
          files.set(path, utf8);
        },
        mkdirp(path) {
          dirs.add(path);
        },
      },
      spawn: (_exe, _argv, _options, permit) => {
        requireSpawnPermit(permit);
        return child;
      },
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
          if (argv[0] === "merge-base" && argv[1] === "--is-ancestor") {
            return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
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
