#!/usr/bin/env node
/**
 * Thin launch path for @aion/director. Calls launchRun only.
 * Bind nothing but 127.0.0.1 if anything is bound. Spend USD 0.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const directorEntry = join(here, "..", "packages", "director", "dist", "index.js");

function parseArgs(argv) {
  const values = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key?.startsWith("--")) throw new Error(`unexpected token: ${key}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${key}`);
    values.set(key.slice(2), value);
    i += 1;
  }
  return values;
}

function required(values, key) {
  const value = values.get(key);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`missing --${key}`);
  }
  return value;
}

function nowIso() {
  return new Date().toISOString();
}

const HELP = `AION Director CLI

Usage:
  node apps/director-cli.mjs --run-id ID --mission-id ID --work-item-id ID
    --executor grok|claude --role ROLE --worktree PATH --cwd PATH
    --run-root PATH --prompt-path PATH --lease-kind KIND --lease-resource RES
    --lease-id ID --run-nonce TOKEN [--orphan-scan empty|windows]

Goes through launchRun only. Does not export or call executeRun.
`;

export async function runDirectorCli(argv, io = console) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    io.log(HELP);
    return 0;
  }

  const values = parseArgs(argv);
  const director = await import(pathToFileURL(directorEntry).href);

  const runRoot = required(values, "run-root");
  mkdirSync(runRoot, { recursive: true });

  const orphanScan = values.get("orphan-scan") ?? "windows";
  const storeRoot = process.env.AION_DIRECTOR_STORE ?? join(runRoot, "director-store");

  const deps = {
    clock: { now: nowIso },
    fs: director.createNodeRunFileSystem(),
    spawn: director.createNodeSpawner(),
    git: director.createNodeGitRunner({ worktreePath: required(values, "worktree") }),
    probe: director.createWindowsProcessProbe(),
    capacity: {
      tryAcquire() {
        return { ok: true, reason: "cli-capacity" };
      },
      release() {
        // unused
      },
    },
    leases: director.createNodeLeaseStore(storeRoot),
    wait: director.createNodeWait(),
    killTree: director.killProcessTreeStandIn,
    discoveryEnv: { ...process.env },
    discoveryFs: director.createNodeFileSystemProbe(),
    ...(orphanScan === "empty" ? { scanOrphans: () => [] } : {}),
  };

  const result = await director.launchRun({
    runId: required(values, "run-id"),
    missionId: required(values, "mission-id"),
    workItemId: required(values, "work-item-id"),
    executor: required(values, "executor"),
    worktree: required(values, "worktree"),
    branch: values.get("branch") ?? null,
    cwd: required(values, "cwd"),
    runNonce: required(values, "run-nonce"),
    runRoot,
    promptPath: required(values, "prompt-path"),
    timeoutMs: Number(values.get("timeout-ms") ?? 30_000),
    lease: {
      kind: required(values, "lease-kind"),
      resource: required(values, "lease-resource"),
      leaseId: required(values, "lease-id"),
    },
    authorisedProductionMutated: false,
    role: required(values, "role"),
    childEnv: {
      AION_HANDOFF_PATH: join(runRoot, "handoff.json"),
      ...(process.env.AION_HANDOFF_JSON !== undefined
        ? { AION_HANDOFF_JSON: process.env.AION_HANDOFF_JSON }
        : {}),
    },
  }, deps);

  io.log(JSON.stringify({
    ok: result.ok,
    spawned: result.spawned,
    reason: result.reason,
    resultPath: result.resultPath,
    spendUsd: result.handoff?.spendUsd ?? 0,
  }));
  return result.ok ? 0 : 1;
}

const invoked = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url).toLowerCase() === String(process.argv[1]).toLowerCase();

if (invoked) {
  runDirectorCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }, (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
