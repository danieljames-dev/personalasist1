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
import test from "node:test";
import { fileURLToPath } from "node:url";

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
});
