/**
 * The D2 stack is reachable, and there is one implementation of each guarantee.
 *
 * A correct module that nothing calls is the worst of both: the defects it was written to
 * fix stay live in the older copy. Declaration-matching regexes are not a physical fact:
 * they stay green while the symbol is never invoked. Call-position checks strip the
 * declaration first; the launch path is driven.
 *
 * The reachability walk matches `import type` as well as runtime imports, so it
 * proves import-graph reachability, not call reachability.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createFixedClock } from "../src/bounded-log.js";
import { HANDOFF_SCHEMA_V1 } from "../src/handoff.js";
import type { LeaseV1 } from "../src/leases.js";
import { writerOrphanScanResult, type ExecutorProcessIdentityV1, type ProcessObservationV1 } from "../src/process-identity.js";
import { requireSpawnPermit } from "../src/run-intent.js";
import { modulesReachableFrom } from "../src/src-reachability.js";
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
  const base = specifier
    .replace(/^\.\.\/src\//, "")
    .replace(/^\.\//, "")
    .replace(/\.js$/, "");
  if (base.includes("/") || base.includes("\\")) return null;
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

test("every exported src function reachable from the run path has a non-test call site", () => {
  const files = sourceFiles();
  const exportFn = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g;
  const exported = new Map<string, string[]>();
  for (const [name, source] of files) {
    const found: string[] = [];
    exportFn.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = exportFn.exec(source)) !== null) {
      found.push(match[1]!);
    }
    exported.set(name, found);
  }

  const appsDir = join(here, "..", "..", "..", "..", "apps");
  const appSources: string[] = [];
  try {
    for (const file of walkCodeFiles(appsDir)) {
      appSources.push(readFileSync(file, "utf8"));
    }
  } catch {
    // no apps directory in this extract
  }

  const productionSources = [...files.values(), ...appSources];
  const exceptions = new Map<string, string>([
    ["modulesReachableFrom", "test-only import-graph helper"],
    ["createFixedClock", "test/injected clock constructor; production uses Date"],
    ["allExecutorAdapters", "registry enumerator for adapter tests"],
    ["adapterNamed", "registry lookup; launch path calls buildExecutorLaunch"],
    ["resolveGate", "Owner-answer API; this run only opens a gate"],
    ["describeGate", "Owner-facing formatter; not on the spawn path"],
    ["openGates", "dashboard listing; not on the spawn path"],
    ["describeVerdict", "human formatter for Git verdicts"],
    ["createNewMission", "mission-creation entry; D2 spawn path starts from an existing mission"],
    ["missionRecordFrom", "mission parse helper; not invoked by executeRun"],
    ["unclassifiedMissionStates", "table-completeness check"],
    ["declaredTarget", "transition-table helper"],
    ["legalEventsFrom", "transition-table helper"],
    ["awaitsOwner", "mission-state classifier; work-items uses it via import of the module"],
    ["needsEngineer", "mission-state classifier"],
    ["livenessGrants", "lease-layer helper; holderLiveness is what executeRun reads"],
    ["killProcessTreeStandIn", "wired as deps.killTree in apps/director-cli.mjs; r18 drives it"],
    ["isSafePathSegment", "store-contract primitive used via validatePathSegment"],
    ["validateMissionId", "store-contract alias of validatePathSegment"],
    ["validateRunId", "store-contract alias of validatePathSegment"],
    ["schedule", "work-item planner; not invoked by executeRun"],
    ["selectRunnable", "work-item planner; not invoked by executeRun"],
    ["describeBoard", "work-item dashboard; not invoked by executeRun"],
    ["unblockedByGate", "work-item gate helper; openGate is the new run-path caller"],
  ]);

  const orphans: string[] = [];
  for (const [file, names] of exported) {
    for (const name of names) {
      const key = `${file}:${name}`;
      if (exceptions.has(name) || exceptions.has(key)) continue;
      let called = false;
      for (const [otherFile, source] of files) {
        if (otherFile === file) {
          if (calledIn(source, name) && withoutDeclaration(source, name) !== source) {
            // call inside the defining module after stripping the declaration
            if (calledIn(withoutDeclaration(source, name), name)) {
              called = true;
              break;
            }
          }
          continue;
        }
        if (calledIn(source, name)) {
          called = true;
          break;
        }
      }
      if (!called) {
        for (const app of appSources) {
          if (new RegExp(String.raw`\b${name}\s*\(`).test(app)) {
            called = true;
            break;
          }
        }
      }
      if (!called) orphans.push(`${file}:${name}`);
    }
  }

  assert.deepEqual(
    orphans,
    [],
    `exported functions with no non-test call site: ${orphans.join(", ")}`,
  );
  void productionSources;
});

test("every src module is reachable by a transitive import walk from index.ts", () => {
  const files = sourceFiles();
  assert.ok(files.has("index.ts"), "src/index.ts is the package entry");

  const importsByModule = new Map<string, string[]>();
  for (const [from, source] of files) {
    importsByModule.set(from, importsOf(source).filter((target) => files.has(target)));
  }
  const reachable = modulesReachableFrom("index.ts", importsByModule);
  const orphans = [...files.keys()].filter((name) => !reachable.has(name)).sort();
  assert.deepEqual(orphans, [], `src modules not reachable from index.ts: ${orphans.join(", ")}`);
});

test("weaker: every src module is imported by some module, including tests", () => {
  const files = sourceFiles();
  const importedBy = new Map<string, string[]>();
  for (const name of files.keys()) importedBy.set(name, []);

  for (const [from, source] of files) {
    for (const target of importsOf(source)) {
      if (!files.has(target)) continue;
      importedBy.get(target)!.push(from);
    }
  }

  const testDir = join(here, "..", "..", "test");
  for (const name of readdirSync(testDir)) {
    if (!name.endsWith(".ts")) continue;
    const source = readFileSync(join(testDir, name), "utf8");
    for (const target of importsOf(source)) {
      if (!files.has(target)) continue;
      importedBy.get(target)!.push(`test/${name}`);
    }
  }

  const orphans: string[] = [];
  for (const name of files.keys()) {
    if (name === "index.ts") continue;
    if ((importedBy.get(name) ?? []).length === 0) orphans.push(name);
  }
  assert.deepEqual(orphans, [], `src modules with no importer even counting tests: ${orphans.join(", ")}`);
});

test("modulesReachableFrom reports a synthetic module that no production root imports", () => {
  const graph = new Map<string, readonly string[]>([
    ["index.ts", ["run-manager.ts", "mission-creation.ts"]],
    ["run-manager.ts", ["leases.ts"]],
    ["mission-creation.ts", []],
    ["leases.ts", []],
    ["orphan-only-tested.ts", []],
  ]);
  const reachable = modulesReachableFrom("index.ts", graph);
  assert.equal(reachable.has("index.ts"), true);
  assert.equal(reachable.has("run-manager.ts"), true);
  assert.equal(reachable.has("leases.ts"), true);
  assert.equal(reachable.has("mission-creation.ts"), true);
  assert.equal(reachable.has("orphan-only-tested.ts"), false);
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

function walkCodeFiles(root: string, out: string[] = []): string[] {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of names) {
    if (
      name === "node_modules" || name === "dist" || name === "dist-test" || name === ".git"
      || name === ".aion-local" || name === ".grok" || name === ".claude"
    ) continue;
    const full = join(root, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (name === "test" || name === "tests") continue;
      walkCodeFiles(full, out);
      continue;
    }
    if (/\.test\.(ts|js|mjs|cjs)$/i.test(name)) continue;
    if (!/\.(ts|js|mjs|cjs)$/i.test(name)) continue;
    out.push(full);
  }
  return out;
}

test("there is exactly one discovery ladder, and the launch path uses it", () => {
  const files = sourceFiles();
  const launch = files.get("run-manager.ts") ?? "";
  assert.ok(calledIn(launch, "discoverClaudeExecutor"), "launchRun must call discoverClaudeExecutor");
  assert.ok(calledIn(launch, "discoverGrokExecutor"), "launchRun must call discoverGrokExecutor");
});

test("every importer of the discovery ladder reaches spawn only through launchRun or a Director lease", () => {
  const repoRoot = join(here, "..", "..", "..", "..");
  const self = fileURLToPath(import.meta.url);
  const importers: { file: string; source: string }[] = [];
  for (const file of walkCodeFiles(repoRoot)) {
    if (file === self) continue;
    const source = readFileSync(file, "utf8");
    if (
      !/\bdiscoverClaudeExecutor\b/.test(source)
      && !/\bdiscoverGrokExecutor\b/.test(source)
    ) continue;
    importers.push({ file: relative(repoRoot, file).replaceAll("\\", "/"), source });
  }
  assert.ok(importers.some((item) => item.file.endsWith("packages/director/src/run-manager.ts")));
  for (const item of importers) {
    const reachesLaunch = /\blaunchRun\b/.test(item.source);
    const reachesLease = /\bacquireDeveloperAgentWorktreeLease\b/.test(item.source)
      || /\bacquireLease\b/.test(item.source)
      || /\bguardBridgeWithDirectorLease\b/.test(item.source);
    const isDiscoveryModule = item.file.endsWith("packages/director/src/executor-discovery.ts");
    const isIndexReexport = item.file.endsWith("packages/director/src/index.ts");
    assert.ok(
      isDiscoveryModule || isIndexReexport || reachesLaunch || reachesLease,
      `${item.file} imports the discovery ladder but does not reach spawn via launchRun or a lease`,
    );
  }
});

test("the CLI never overrides the host-fixed arbitration root", () => {
  const cli = readFileSync(join(here, "..", "..", "..", "..", "apps", "director-cli.mjs"), "utf8");
  assert.doesNotMatch(
    cli,
    /createNodeLeaseStore\([^)]*,/,
    "CLI must call createNodeLeaseStore with the store root only",
  );
  assert.doesNotMatch(cli, /hostArbitrationRoot\s*:/);
  assert.match(cli, /hostArbitrationRoot\s*\(/);
  assert.match(cli, /isHostWideLeaseKind/);
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
      hostFs.writeDurable(join(runRoot, "handoff.json"), honestHandoff);
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
    const honestHandoff = JSON.stringify({
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
      finishedAt: "2026-08-13T12:00:00.000Z",
      capacityStatus: "AVAILABLE",
      runNonce: "nonce-run-1",
      summary: "ok",
    });

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
            if (key === "status --porcelain" || key === "status --porcelain --ignored") {
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
        scanOrphans: () => writerOrphanScanResult([]),
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
    assert.ok(spawnedArgv.includes("--permission-mode"), "launchRun must use the measured Grok flags");
    assert.equal(spawnedArgv[spawnedArgv.indexOf("--permission-mode") + 1], "plan");
    assert.equal(spawnedArgv.includes("--no-plan"), false);
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
  const files = new Map<string, string>();
  const plantedHandoff = JSON.stringify({
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
    finishedAt: now,
    capacityStatus: "AVAILABLE",
    runNonce: nonce,
    summary: "ok",
  });
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
      executor: "claude",
      worktree: cwd,
      branch: "executor/oracle",
      executablePath: "C:\\Tools\\claude.exe",
      argv: ["-p", "--permission-mode", "bypassPermissions"],
      cwd,
      promptPath: `${cwd}\\PROMPT.md`,
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
        files.set(join(runRoot, "handoff.json"), plantedHandoff);
        return child;
      },
      git: {
        run(argv) {
          const key = argv.join(" ");
          if (key === "rev-parse HEAD") return { argv: [...argv], status: 0, stdout: `${headAfter}\n`, stderr: "", error: null };
          if (key === "symbolic-ref -q --short HEAD") {
            return { argv: [...argv], status: 0, stdout: "executor/oracle\n", stderr: "", error: null };
          }
          if (key === "status --porcelain" || key === "status --porcelain --ignored") return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
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
      scanOrphans: () => writerOrphanScanResult([{ pid: 7777, runNonce: nonce, creationDate: t0 }]),
      discoveryEnv: { AION_GROK_PATH: exe, AION_CLAUDE_CODE_PATH: "C:\\Tools\\claude.exe" },
      discoveryFs: {
        isFile: (path) => path === exe || path === "C:\\Tools\\claude.exe",
        readDir: () => [],
      },
    },
  );

  assert.equal(result.spawned, true, result.reason);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.ok(
    leases.some((item) => item.leaseId === "lease-pw-1"),
    "detectOrphan must be read: a live grandchild keeps the writer lease",
  );
});
