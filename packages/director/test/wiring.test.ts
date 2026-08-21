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
import { fileURLToPath, pathToFileURL } from "node:url";
import { createFixedClock } from "../src/bounded-log.js";
import {
  argvGrantsWritePermission,
  executorArgvFor,
} from "../src/executor-adapters.js";
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

function stripCommentsAndStrings(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (c === "/" && n === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i += 1;
      out += " ";
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i + 1 < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      out += " ";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      out += " ";
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function calledIn(source: string, name: string): boolean {
  return new RegExp(String.raw`\b${name}\s*\(`).test(
    stripCommentsAndStrings(withoutDeclaration(source, name)),
  );
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
    ["modulesReachableFrom", "cannot have a production caller: test-only import-graph helper"],
    ["createFixedClock", "cannot have a production caller: test/injected clock; production uses Date"],
    ["allExecutorAdapters", "cannot have a production caller: adapter-test registry enumerator"],
    ["adapterNamed", "cannot have a production caller: launch path calls buildExecutorLaunch"],
    ["describeGate", "cannot have a production caller yet: Owner-facing formatter, not on spawn"],
    ["openGates", "cannot have a production caller yet: dashboard listing, not on spawn"],
    ["describeVerdict", "cannot have a production caller yet: human formatter for Git verdicts"],
    ["missionRecordFrom", "cannot have a production caller yet: reader for a persisted mission file"],
    ["unclassifiedMissionStates", "cannot have a production caller: table-completeness check"],
    ["declaredTarget", "cannot have a production caller: transition-table helper"],
    ["legalEventsFrom", "cannot have a production caller yet: dashboard enumerator of advance"],
    ["awaitsOwner", "cannot have a production caller yet: mission-state classifier"],
    ["needsEngineer", "cannot have a production caller yet: mission-state classifier"],

    ["killProcessTreeStandIn", "cannot have a call-site: wired as a function value on deps.killTree"],
    ["measurementApparatusPidsOfThisProcess", "derived pid-number view; production exclusion uses measurementApparatusIdentitiesOfThisProcess"],
    ["isSafePathSegment", "cannot have a production caller: used via validatePathSegment"],
    ["validateMissionId", "cannot have a production caller: alias of validatePathSegment"],
    ["validateRunId", "cannot have a production caller: alias of validatePathSegment"],
    ["schedule", "cannot have a production caller yet: OWNER_DECISION_D2_WORK_ITEM_BOARD"],
    ["selectRunnable", "cannot have a production caller yet: OWNER_DECISION_D2_WORK_ITEM_BOARD"],
    ["describeBoard", "cannot have a production caller yet: OWNER_DECISION_D2_WORK_ITEM_BOARD"],
    ["unblockedByGate", "cannot have a production caller yet: OWNER_DECISION_D2_WORK_ITEM_BOARD"],
    ["assessReadiness", "cannot have a production caller yet: OWNER_DECISION_D2_WORK_ITEM_BOARD (only reached from schedule; in-degree is not reachability from a live root)"],
    ["directorExecuteJobWithFailover", "OWNER_DECISION_PROVIDER_BRIDGE_V1: spawn path still uses launchRun; this is the V1 Director port"],
    ["directorSubmitMvaJob", "OWNER_DECISION_MVA_REAL_DISPATCH_V1: spawn path still uses launchRun; this is the V1 Director dispatch port"],

    /*
     * AION-BUSINESS-DISCOVERY-RUNTIME-V1 removed most of what was here.
     *
     * The previous milestone shipped the autonomy kernel with nothing calling it, and listed seven
     * symbols as having no production caller "yet". `autonomy-runtime.ts` is that caller:
     * `registerPortfolio` builds workspaces and objectives, `startAutonomy` runs the kernel and
     * constructs the durable ledger, and `assessBusinessKnowledge` decides which businesses need a
     * discovery objective. Those entries were deleted because they became false, not to make this
     * test pass — the reachability is real and this rule now proves it.
     *
     * Two remain true.
     */
    ["preferenceStrength", "cannot have a production caller yet: reads the ledger to decide when repeated outcomes may move a provider preference, and empirical routing is deliberately deferred until real mission data exists"],
    ["createExperienceLedger", "cannot have a production caller: the in-memory ledger is the harness constructor, kept beside its durable sibling so the two cannot drift"],


  ]);
  const ownerDecisionDeadModules = new Map<string, string>([
    ["work-items.ts", "OWNER_DECISION_D2_WORK_ITEM_BOARD: whether schedule/selectRunnable belong on the D2 spawn path or a later mission board"],
    ["src-reachability.ts", "OWNER_DECISION_TEST_HELPER: modulesReachableFrom is a test-only import-graph helper that lives in src/"],
    ["mission.ts", "OWNER_DECISION_D2_MISSION_STATE_MACHINE: whether mission advance gates the CLI exit contract or remains run-root documentation. The CLI writes mission.json; nothing in the repo reads it."],
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
        if (ownerDecisionDeadModules.has(otherFile)) continue;
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

  const emptyReasons = [...exceptions.entries()].filter(([, reason]) => reason.trim() === "").map(([name]) => name);
  assert.deepEqual(emptyReasons, [], `exception allowlist entries must name why the symbol cannot yet have a caller: ${emptyReasons.join(", ")}`);

  const moduleHasExternalCaller = new Map<string, boolean>();
  for (const [file, names] of exported) {
    let external = false;
    for (const name of names) {
      for (const [otherFile, source] of files) {
        if (otherFile === file) continue;
        if (calledIn(source, name)) {
          external = true;
          break;
        }
      }
      if (external) break;
      for (const app of appSources) {
        if (new RegExp(String.raw`\b${name}\s*\(`).test(app)) {
          external = true;
          break;
        }
      }
      if (external) break;
    }
    moduleHasExternalCaller.set(file, external);
  }

  const laundered: string[] = [];
  for (const [file, names] of exported) {
    const exceptedHere = names.filter((name) => exceptions.has(name) || exceptions.has(`${file}:${name}`));
    if (exceptedHere.length === 0) continue;
    if (moduleHasExternalCaller.get(file) === true) continue;
    const decision = ownerDecisionDeadModules.get(file);
    if (decision !== undefined) {
      assert.match(decision, /^OWNER_DECISION/, `${file} dead-module entry must be a named Owner decision`);
      continue;
    }
    laundered.push(`${file} (${exceptedHere.join(", ")})`);
  }
  assert.deepEqual(
    laundered,
    [],
    `excepted symbols live in a module with zero external production callers: ${laundered.join("; ")}`,
  );
  void productionSources;
});

test("an exported symbol whose only production call site discards the return is dead or excepted", () => {
  const files = sourceFiles();
  const exportFn = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g;
  const appsDir = join(here, "..", "..", "..", "..", "apps");
  const appSources: string[] = [];
  try {
    for (const file of walkCodeFiles(appsDir)) {
      appSources.push(readFileSync(file, "utf8"));
    }
  } catch {
    // no apps directory in this extract
  }

  // Named reasons: a call is not consumption when the return is unused.
  // Void recorders are excepted because their fact is the side effect.
  const discardedReturnExceptions = new Map<string, string>([
    ["rememberMeasurementApparatusPid", "void recorder: the fact is the side-effect membership entry"],
    ["rememberSampledDescendantPids", "void recorder: the fact is the side-effect pid set"],
    ["rememberInTreePids", "void recorder: the fact is the side-effect pid set"],
    ["createNewMission", "OWNER_DECISION_D2_MISSION_STATE_MACHINE: CLI ignores a refused mint and still launches"],
    ["advance", "OWNER_DECISION_D2_MISSION_STATE_MACHINE: CLI writes the verdict to mission.json, which has no reader, and still launches"],
    ["writeAtomic", "void writer: failure throws; the return is not a fact"],
    ["artifactPathWithinRoot", "consumed via boolean control flow; heuristic cannot see the use"],
    ["livenessGrants", "consumed via .reclaim property read after the call"],
    ["resourceIsIdentifiable", "consumed in boolean position; heuristic cannot see the use"],
    ["isSpawnPermitSpent", "consumed in boolean position; heuristic cannot see the use"],
  ]);

  const discarded: string[] = [];
  for (const [file, source] of files) {
    exportFn.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = exportFn.exec(source)) !== null) {
      const name = match[1]!;
      if (discardedReturnExceptions.has(name)) continue;
      const production = [
        ...[...files.entries()].filter(([other]) => other !== file).map(([, src]) => src),
        ...appSources,
      ];
      const callSites: string[] = [];
      for (const src of production) {
        if (calledIn(src, name)) callSites.push(src);
      }
      if (callSites.length === 0) continue;
      const allDiscarded = callSites.every((src) => returnIsDiscarded(src, name));
      if (allDiscarded) discarded.push(`${file}:${name}`);
    }
  }

  assert.deepEqual(
    discarded,
    [],
    `exported functions whose only production call sites discard the return: ${discarded.join(", ")}`,
  );
});

function returnIsDiscarded(source: string, name: string): boolean {
  const stripped = stripCommentsAndStrings(withoutDeclaration(source, name));
  const call = new RegExp(String.raw`\b${name}\s*\(`, "g");
  let match: RegExpExecArray | null;
  let sawCall = false;
  let anyConsumed = false;
  while ((match = call.exec(stripped)) !== null) {
    sawCall = true;
    const before = stripped.slice(Math.max(0, match.index - 80), match.index);
    const consumed = /(?:return|await|if|while|switch|throw|yield|void|=|\(|,|\?|:|&&|\|\||\?\?)\s*$/.test(before)
      || /(?:const|let|var)\s+[A-Za-z0-9_$]+\s*=\s*$/.test(before)
      || /\.\s*$/.test(before);
    if (consumed) anyConsumed = true;
  }
  return sawCall && !anyConsumed;
}

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

test("there is exactly one argv builder: the adapter, reached through launchRun", async () => {
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

  const assistantUrl = pathToFileURL(join(here, "..", "..", "..", "local-assistant", "dist", "developer-bridge.js")).href;
  const { ClaudeCodeCliDeveloperAgentBridgeV1 } = await import(assistantUrl) as {
    ClaudeCodeCliDeveloperAgentBridgeV1: new (root: string, exe?: string) => {
      argvForMode(mode: "read-only" | "workspace-write"): readonly string[];
    };
  };
  const root = mkdtempSync(join(tmpdir(), "aion-wiring-bridge-"));
  try {
    const bridge = new ClaudeCodeCliDeveloperAgentBridgeV1(root, join(root, "claude.exe"));
    const readOnly = bridge.argvForMode("read-only");
    const write = bridge.argvForMode("workspace-write");
    assert.equal(argvGrantsWritePermission(readOnly), false);
    const adapterWrite = executorArgvFor("claude", {
      promptPath: join(root, "PROMPT.md"),
      cwd: root,
      role: "IMPLEMENT",
    });
    assert.ok(adapterWrite !== null);
    assert.equal(
      write[write.indexOf("--permission-mode") + 1],
      adapterWrite[adapterWrite.indexOf("--permission-mode") + 1],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
    const isDiscoveryModule = item.file.endsWith("packages/director/src/executor-discovery.ts");
    const isIndexReexport = item.file.endsWith("packages/director/src/index.ts");
    // developer-agent.mjs is the second spawn path. Identifier-in-file is
    // not a lease: the C10 behavioural test constructs both bridges and
    // asserts every registry member refuses while PRODUCTION_WRITER is held.
    const isDeveloperAgentFactory = item.file.endsWith("apps/aion/developer-agent.mjs");
    assert.ok(
      isDiscoveryModule || isIndexReexport || reachesLaunch || isDeveloperAgentFactory,
      `${item.file} imports the discovery ladder but does not reach spawn via launchRun or the guarded developer-agent factory`,
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
  assert.match(cli, /prepareHostArbitrationLocks/);
  assert.match(cli, /isHostWideLeaseKind/);
  assert.doesNotMatch(cli, /hostProgramDataIsHostFixed/);
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
          inspectedWorktree: dir,
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
            if (argv[0] === "rev-parse" && argv.includes("@{upstream}")) {
              return { argv: [...argv], status: 128, stdout: "", stderr: "fatal: no upstream configured\n", error: null };
            }
            if (argv[0] === "merge-base" && argv[1] === "--is-ancestor") {
              return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
            }
                  if (argv[0] === "rev-parse" && typeof argv[1] === "string" && argv[1].startsWith("refs/heads/")) {
        return this.run(["rev-parse", "HEAD"]);
      }
      if (key === "ls-tree -r -l HEAD") {
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
          isFile: (path) => (path === exe) || /(?:^|[\\\\/])PROMPT\.md$/i.test(path),
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
    ...(recorded.executablePath !== undefined ? { executablePath: recorded.executablePath } : {}),
    runNonce: recorded.runNonce,
  };
  let observeIndex = 0;
  const files = new Map<string, string>([[`${cwd}\\PROMPT.md`, "prompt\n"]]);
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
        isFile: (path) => (files.has(path)) || /(?:^|[\\\\/])PROMPT\.md$/i.test(path),
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
        inspectedWorktree: cwd,
        run(argv) {
          const key = argv.join(" ");
          if (key === "rev-parse HEAD") return { argv: [...argv], status: 0, stdout: `${headAfter}\n`, stderr: "", error: null };
          if (key === "symbolic-ref -q --short HEAD") {
            return { argv: [...argv], status: 0, stdout: "executor/oracle\n", stderr: "", error: null };
          }
          if (argv[0] === "status" && argv.includes("--porcelain")) return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
          if (argv[0] === "rev-parse" && argv.includes("@{upstream}")) {
            return { argv: [...argv], status: 128, stdout: "", stderr: "fatal: no upstream configured\n", error: null };
          }
          if (argv[0] === "merge-base" && argv[1] === "--is-ancestor") {
            return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
          }
                if (argv[0] === "rev-parse" && typeof argv[1] === "string" && argv[1].startsWith("refs/heads/")) {
        return this.run(["rev-parse", "HEAD"]);
      }
      if (key === "ls-tree -r -l HEAD") {
        return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
      }
      throw new Error(`unexpected git argv: ${JSON.stringify(argv)}`);
        },
      },
      probe: {
        observe() {
          observeIndex += 1;
          return observeIndex === 1 ? found : { outcome: "NOT_FOUND", reason: "parent gone", pid: 4812 };
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
        isFile: (path) => (path === exe || path === "C:\\Tools\\claude.exe") || /(?:^|[\\\\/])PROMPT\.md$/i.test(path),
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

/* -------------------------------------------------------------------------- */
/* The pre-action effect boundary is architectural, not a file name           */
/* -------------------------------------------------------------------------- */

/*
 * A gate nothing is required to use is documentation.
 *
 * V0.1 built the deterministic effect gate and left every execution path outside it, behind a
 * temporary wiring exception. The exception is gone; this is what replaces it, and it has to keep
 * holding for paths that do not exist yet.
 *
 * The line drawn here is between *capability dispatch* and *internal bookkeeping*, which is the
 * distinction the contract cares about:
 *
 *   - `ProviderAdapterV1.execute` is where AION acts on a target on the Owner's behalf. That is a
 *     capability effect, and it must cross the gate.
 *   - Writing a lease file, a roadmap record or a run journal is AION's own durable state. It has no
 *     target, no Owner-facing consequence, and gating it would make every internal function call an
 *     authorisation question — the failure mode section 6 of the milestone warns against.
 *
 * So the rule is: a module that declares a provider adapter *and* writes through it must reach
 * `executeAuthorizedEffect`. A new adapter that writes without doing so fails here, which is the
 * property that could not be asserted while the exception existed.
 */

/** Modules that declare a `ProviderAdapterV1` whose `execute` performs a write. */
function effectDispatchingModules(files: Map<string, string>): string[] {
  const found: string[] = [];
  for (const [name, source] of files) {
    const code = stripCommentsAndStrings(source);
    const declaresAdapter = /:\s*ProviderAdapterV1\s*[){]/.test(code) || /ProviderAdapterV1\s*=/.test(code);
    if (!declaresAdapter) continue;
    // A write reached from inside the adapter: the deps-injected writer, or a direct filesystem call.
    const writes = /\bwriteFile\s*\(/.test(code)
      || /\bwriteAtomic\s*\(/.test(code)
      || /\bwriteFileSync\s*\(/.test(code);
    if (writes) found.push(name);
  }
  return found.sort();
}

test("a provider adapter that writes must cross the pre-action effect gate", () => {
  const files = sourceFiles();
  const dispatching = effectDispatchingModules(files);

  assert.ok(
    dispatching.includes("mva-dispatch.ts"),
    "the bounded executor writes artifacts; if this stops being detected the rule has gone blind",
  );

  const unwired = dispatching.filter((name) => !calledIn(files.get(name) ?? "", "executeAuthorizedEffect"));
  assert.deepEqual(
    unwired,
    [],
    `effect-dispatching modules that never reach the effect gate: ${unwired.join(", ")}`,
  );
});

test("the rule detects a newly introduced unwired effect path", () => {
  /*
   * The assertion above passes both when the rule works and when it has quietly stopped matching
   * anything. This introduces exactly the shape a future author would add — an adapter that writes,
   * with no authorisation — and requires the rule to catch it.
   */
  const files = sourceFiles();
  files.set("future-sms-adapter.ts", [
    "import type { ProviderAdapterV1 } from './provider-bridge.js';",
    "export function createSmsAdapter(deps: { writeFile: (p: string, c: string) => void }): ProviderAdapterV1 {",
    "  return { providerId: 'local', family: 'x', capabilities: {} as never, execute(envelope) {",
    "    deps.writeFile('/tmp/out.txt', envelope.objective);",
    "    return { class: 'SUCCESS', leaseOutcome: 'RELEASED', writerLiveness: 'STOPPED' };",
    "  } };",
    "}",
  ].join("\n"));

  const dispatching = effectDispatchingModules(files);
  assert.ok(dispatching.includes("future-sms-adapter.ts"), "an adapter that writes must be detected");
  const unwired = dispatching.filter((name) => !calledIn(files.get(name) ?? "", "executeAuthorizedEffect"));
  assert.deepEqual(unwired, ["future-sms-adapter.ts"], "an unwired writing adapter must fail the rule");
});

test("internal bookkeeping is not dragged into the effect gate", () => {
  /*
   * The other half of section 6: a rule that gated every write would make lease and roadmap
   * persistence require Owner authority, which is both wrong and unusable. These modules write, and
   * are correctly outside the boundary because they declare no capability dispatch.
   */
  const files = sourceFiles();
  const dispatching = effectDispatchingModules(files);
  for (const internal of ["lease-store.ts", "roadmap-store.ts", "run-intent.ts", "atomic-write.ts"]) {
    assert.ok(files.has(internal), `${internal} should exist`);
    assert.equal(dispatching.includes(internal), false, `${internal} is internal state, not capability dispatch`);
  }
});

/* -------------------------------------------------------------------------- */
/* Outward effects in apps/ are inventoried, not discovered later             */
/* -------------------------------------------------------------------------- */

/*
 * The rule above covers provider adapters inside the Director package. It does not cover the app
 * layer, and the app layer is where the real outward effects currently live: `server.mjs` refreshes
 * an OAuth token and calls the Gmail API, guarded by whether credentials happen to be READY. A
 * credential check is not an authority check — nothing there asks whether the Owner authorised *this
 * effect on this target right now*.
 *
 * Wiring Gmail through the gate is not this milestone's to do; it is OAuth and real external effect,
 * both explicitly out of scope. What is in scope is that it cannot stay invisible. Every outward
 * effect site in `apps/` is counted and declared below with its status, so adding a new one — or
 * growing an existing file's count — fails here until somebody classifies it.
 *
 * That is the difference between an inventory and an exception: an exception says "ignore this", the
 * inventory says "this exists, here is what it is, and you cannot add another quietly".
 */

type EffectRouteStatusV1 =
  /** Reaches the pre-action effect gate before acting. */
  | "GATED"
  /** Real outward effect, deliberately not yet wired; must be gated before it is relied upon. */
  | "NOT_ACTIVATED_FOR_REAL_EFFECTS"
  /** Talks only to the local machine or a local model; no Owner-facing consequence. */
  | "LOCAL_ONLY"
  /** Demonstration script, not a run path. */
  | "DEMO";

const OUTWARD_EFFECT_INVENTORY: ReadonlyMap<string, { readonly sites: number; readonly status: EffectRouteStatusV1; readonly note: string }> =
  new Map([
    ["apps/aion/server.mjs", { sites: 5, status: "NOT_ACTIVATED_FOR_REAL_EFFECTS" as const,
      note: "Gmail OAuth refresh and message reads, reachable only with Owner-provisioned credentials. MUST be routed through the effect gate before it is treated as authorised; a credential check is not an authority check." }],
    ["apps/aion/research-fetch.mjs", { sites: 1, status: "NOT_ACTIVATED_FOR_REAL_EFFECTS" as const,
      note: "outbound research fetch; read-only externally but still leaves the machine" }],
    ["apps/aion/vast-ai.mjs", { sites: 1, status: "NOT_ACTIVATED_FOR_REAL_EFFECTS" as const,
      note: "paid GPU provider API; spend-capable, must be gated before use" }],
    ["apps/aion/brain-runtime.mjs", { sites: 3, status: "LOCAL_ONLY" as const,
      note: "local model runtime over localhost" }],
    ["apps/aion/code-sandbox.mjs", { sites: 1, status: "LOCAL_ONLY" as const,
      note: "bounded local child process for sandboxed code" }],
    ["apps/aion/private-network.mjs", { sites: 1, status: "LOCAL_ONLY" as const,
      note: "local network probe against the host machine only" }],
    ["apps/aion/verification.mjs", { sites: 1, status: "LOCAL_ONLY" as const,
      note: "spawns local verification commands" }],
    ["apps/aion-demo.mjs", { sites: 3, status: "DEMO" as const, note: "demonstration script, not reachable from any run path" }],
    ["apps/aion-sales-demo.mjs", { sites: 9, status: "DEMO" as const, note: "demonstration script, not reachable from any run path" }],
    ["apps/aion-v12-demo.mjs", { sites: 3, status: "DEMO" as const, note: "demonstration script, not reachable from any run path" }],
    ["apps/aion-v13-demo.mjs", { sites: 3, status: "DEMO" as const, note: "demonstration script, not reachable from any run path" }],
    ["apps/aion-v13-r1-demo.mjs", { sites: 3, status: "DEMO" as const, note: "demonstration script, not reachable from any run path" }],
  ]);

const OUTWARD_EFFECT_CALL = /\b(?:globalThis\.)?fetch\(|\bexecFile\(|\bspawn\(|\bexecSync\(/g;

test("app runtime code reaches the network only through the trusted transports", () => {
  /*
   * This replaces a count-based inventory, and the reason is the defect that inventory missed.
   *
   * The old rule recorded how many outward call sites each file had and failed when the number moved.
   * It could not tell a guarded call from an unguarded one, so `server.mjs` sat at its declared count
   * of five while four of them consulted nothing — including a second OAuth token exchange. Counting
   * call sites is not the same as checking them.
   *
   * The rule now is about the call: runtime modules reach the network through `outwardFetch` (a
   * declared, gated route) or `loopbackFetch` (checked to stay on this machine). A bare `fetch` in
   * runtime code fails here, which is what forces the author of the next outward call to choose a
   * route rather than to update a number.
   */
  const runtimeDir = join(here, "..", "..", "..", "..", "apps", "aion");
  const transportModule = "outward-effect-guard.mjs";
  const offenders: string[] = [];

  for (const file of walkCodeFiles(runtimeDir)) {
    if (!file.endsWith(".mjs")) continue;
    if (file.endsWith(transportModule)) continue;
    const name = file.split(String.fromCharCode(92)).pop() ?? file;
    const source = stripCommentsAndStrings(readFileSync(file, "utf8"));
    const direct = (source.match(/(^|[^.\w])fetch\s*\(/gm) ?? []).length
      + (source.match(/globalThis\.fetch\s*\(/g) ?? []).length;
    if (direct > 0) offenders.push(`${name} (${direct} direct call site${direct === 1 ? "" : "s"})`);
  }

  assert.deepEqual(
    offenders.sort(),
    [],
    `app runtime modules reaching the network directly: ${offenders.join(", ")}. Use outwardFetch with a declared route, or loopbackFetch for a local address.`,
  );

  // And the transports themselves still exist to be used.
  const transport = readFileSync(join(runtimeDir, transportModule), "utf8");
  assert.ok(transport.includes("export async function outwardFetch"), "the outward transport must exist");
  assert.ok(transport.includes("export async function loopbackFetch"), "the local transport must exist");
});

test("no outward effect route claims to be gated before it is", () => {
  /*
   * The inventory would be worth nothing if a future edit could mark a route `GATED` without wiring
   * it. Anything claiming that status has to actually reach the gate.
   */
  const repoRoot = join(here, "..", "..", "..", "..");
  for (const [name, entry] of OUTWARD_EFFECT_INVENTORY) {
    if (entry.status !== "GATED") continue;
    const source = readFileSync(join(repoRoot, name), "utf8");
    assert.ok(
      calledIn(source, "executeAuthorizedEffect"),
      `${name} is declared GATED but never reaches executeAuthorizedEffect`,
    );
  }
  // And the un-gated ones are recorded as such, with a reason someone can act on.
  for (const [name, entry] of OUTWARD_EFFECT_INVENTORY) {
    if (entry.status === "GATED") continue;
    assert.ok(entry.note.trim().length > 20, `${name} needs a real note, not a placeholder`);
  }
});
