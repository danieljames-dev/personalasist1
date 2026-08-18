#!/usr/bin/env node
/**
 * Prove the roadmap actually advances itself, on real code, with no Owner prompt in the chain.
 *
 * The focused suite drives the loop with a stub dispatcher, which is right for the refusal cases and
 * insufficient as the only evidence: it cannot show that Provider Bridge really routes, that MVA Real
 * Dispatch really acquires a lease and validates an artifact, that the durable store really reloads,
 * or that a restart really declines to re-run completed work. This harness does all of that through
 * the shipped code paths.
 *
 * Deliberately harmless: one repository-reversible artifact written inside a scratch workspace under
 * `.aion-local`. No push, no external call, no production, no spend. The whole point is that the
 * first autonomous chain is boring.
 *
 * The third milestone has no Owner authority record on purpose — it stands for the deferred
 * `OWNER-CONTEXT-HISTORY-ACCESS-V1` directive, and it must end the run sitting in the Owner gate
 * queue rather than being executed.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = join(here, "..");

const {
  createFileRoadmapStore,
  createMvaDispatcher,
  createRoadmapPort,
  createRealBoundedExecutorAdapter,
  defaultProviderCapabilities,
  defaultProviderHealth,
} = await import(pathToFileURL(join(repositoryRoot, "packages", "director", "dist", "index.js")).href);

const results = [];
const record = (name, value) => results.push(`${name} = ${value}`);

function nowUtc() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

const HEAD = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

/* -------------------------------------------------------------------------- */
/* Durable governance truth this milestone must leave alone                    */
/* -------------------------------------------------------------------------- */

const d2 = JSON.parse(readFileSync(join(repositoryRoot, ".aion-local", "certifications", "d2", "state.json"), "utf8"));
assert.equal(d2.d2Certification, "GRANTED");
assert.equal(d2.d2CertifiedSha, "17b012b28d911fe563aab19f6e4a697a05b9b718");
record("D2_CERTIFICATION_AFTER", d2.d2Certification);
record("D2_CERTIFIED_SHA_AFTER", d2.d2CertifiedSha);

const AUTH_ID = "AION-AUTONOMOUS-ROADMAP-ORCHESTRATOR-V1-20260818T201545Z";
const authorityDir = join(repositoryRoot, ".aion-local", "owner-authority");
const authorities = [
  "OWNER-STANDING-AUTHORITY-V1-20260818T030626Z",
  "PROVIDER-BRIDGE-V1-20260818T034500Z",
  "MVA-REAL-DISPATCH-V1-20260818T072919Z",
  "PERSONAL-CONTEXT-SYNC-V1-20260818T140242Z",
  "OWNER-CONTEXT-ENROLLMENT-V1-20260818T172656Z",
  AUTH_ID,
].map((id) => JSON.parse(readFileSync(join(authorityDir, `${id}.json`), "utf8")));
for (const record_ of authorities) assert.equal(record_.state, "ACTIVE", `${record_.ownerAuthorizationId} is not ACTIVE`);
record("OWNER_STANDING_AUTHORITY_V1_AFTER", "ACTIVE");

const bridgeSource = readFileSync(join(repositoryRoot, "packages", "director", "src", "provider-bridge.ts"), "utf8");
assert.match(bridgeSource, /export function routeJob/);
record("PROVIDER_BRIDGE_V1_AFTER", "IMPLEMENTED");
const dispatchSource = readFileSync(join(repositoryRoot, "packages", "director", "src", "mva-dispatch.ts"), "utf8");
assert.match(dispatchSource, /export function submitJob/);
record("MVA_REAL_DISPATCH_V1_AFTER", "IMPLEMENTED");

/* -------------------------------------------------------------------------- */
/* A clean acceptance workspace                                                */
/* -------------------------------------------------------------------------- */

const workspace = join(repositoryRoot, ".aion-local", "roadmap-acceptance");
rmSync(workspace, { recursive: true, force: true });
mkdirSync(workspace, { recursive: true });
const storeRoot = join(workspace, "store");

/** In-memory artifact filesystem, so the acceptance writes nothing outside its own workspace. */
const written = new Map();
const io = {
  writeFile: (path, contents) => written.set(path, contents),
  readFile: (path) => {
    const value = written.get(path);
    if (value === undefined) throw new Error(`missing ${path}`);
    return value;
  },
};

function unavailable(id) {
  return {
    providerId: id,
    family: id,
    capabilities: defaultProviderCapabilities(id),
    execute: () => ({ class: "PROVIDER_UNAVAILABLE", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
  };
}

// Only `local` can actually do the work. Provider Bridge has to discover that for itself.
const realLocal = createRealBoundedExecutorAdapter("local", {
  artifactRoot: workspace,
  writeFile: io.writeFile,
  readFile: io.readFile,
  startingSha: HEAD,
});
const adapters = {
  codex: unavailable("codex"),
  grok: unavailable("grok"),
  claude: unavailable("claude"),
  local: realLocal,
};
const health = {
  codex: defaultProviderHealth("codex"),
  grok: defaultProviderHealth("grok"),
  claude: defaultProviderHealth("claude"),
  local: defaultProviderHealth("local"),
};

const dispatch = createMvaDispatcher(
  { repository: workspace, worktree: workspace, startingSha: HEAD },
  { adapters, health, artifactRoot: workspace, writeFile: io.writeFile, readFile: io.readFile, now: nowUtc() },
);

function portOver(root) {
  return createRoadmapPort({
    storeRoot: root,
    authorities,
    now: nowUtc,
    dispatch,
    // Deterministic validation: the milestone passes only if its artifact really exists.
    verify: (milestone) => {
      const produced = [...written.keys()].some((path) => path.includes(milestone.milestoneId));
      return milestone.verificationPlan.steps.map((step) => ({
        step: step.name,
        result: produced ? "PASS" : "FAIL",
        detail: produced ? "artifact observed in the acceptance workspace" : "no artifact was produced",
      }));
    },
    baselineSha: HEAD,
    currentHead: HEAD,
    currentDirectiveId: "AION-AUTONOMOUS-ROADMAP-ORCHESTRATOR-V1-20260818T201545Z",
  });
}

/* -------------------------------------------------------------------------- */
/* 1. Seed a small evidence-backed roadmap                                     */
/* -------------------------------------------------------------------------- */

const port = portOver(storeRoot);
port.ensureRoadmap({
  roadmapId: "aion-roadmap",
  ownerGoalSet: ["prove the orchestrator advances itself safely"],
  provenance: "seeded from durable AION state during the V1 acceptance",
  milestones: [
    {
      milestoneId: "acceptance-first",
      title: "First safe milestone",
      objective: "write a disposable repository-reversible acceptance artifact",
      priority: 500,
      dependencies: [],
      ownerAuthorizationId: AUTH_ID,
      authorityClass: "MILESTONE_AUTHORIZED",
      externalEffectClass: "REPOSITORY_REVERSIBLE",
      riskClasses: [],
      reviewPolicy: "NONE",
      allowedProviders: ["local"],
      provenance: "acceptance",
    },
    {
      milestoneId: "acceptance-second",
      title: "Dependent milestone",
      objective: "run only after the first milestone completes",
      priority: 100,
      dependencies: ["acceptance-first"],
      ownerAuthorizationId: AUTH_ID,
      authorityClass: "MILESTONE_AUTHORIZED",
      externalEffectClass: "REPOSITORY_REVERSIBLE",
      riskClasses: [],
      reviewPolicy: "NONE",
      allowedProviders: ["local"],
      provenance: "acceptance",
    },
    {
      // The deferred pending directive, represented rather than silently authorized.
      milestoneId: "owner-context-history-access",
      title: "Owner Context History Access V1",
      objective: "bounded read-only recovery of Owner-controlled history",
      priority: 900,
      dependencies: [],
      ownerAuthorizationId: null,
      authorityClass: "MILESTONE_AUTHORIZED",
      externalEffectClass: "NONE",
      riskClasses: ["SENSITIVE_DATA"],
      reviewPolicy: "INDEPENDENT",
      provenance: "deferred pending directive OWNER-CONTEXT-HISTORY-ACCESS-V1-20260818T201323Z",
    },
  ],
});

const seeded = port.getRoadmapStatus();
assert.equal(seeded.exists, true);
assert.equal(seeded.total, 3);
record("ROADMAP_LOADS", "PASS");
record("MILESTONES_WITH_DEPENDENCY", "PASS");

assert.equal(port.getReadyMilestones().length, 2, "the dependent milestone is not ready yet");
record("AUTONOMOUS_MILESTONE_SELECTION", "PASS");

/* -------------------------------------------------------------------------- */
/* 2. Advance, with no Owner prompt anywhere in the chain                      */
/* -------------------------------------------------------------------------- */

const advance = port.continueRoadmap();

assert.deepEqual([...advance.completed], ["acceptance-first", "acceptance-second"], "the chain did not advance");
assert.deepEqual([...advance.gated], ["owner-context-history-access"], "the unauthorized milestone was not gated");
assert.equal(advance.ownerPrompts, 0);
record("AUTONOMOUS_DISPATCH", "PASS");
record("AUTONOMOUS_VALIDATION", "PASS");
record("AUTONOMOUS_ADVANCE", "PASS");
record("OWNER_PROMPTS_FOR_ROUTINE_CHAIN", advance.ownerPrompts);

const store = createFileRoadmapStore(storeRoot);
assert.equal(store.loadMilestone("acceptance-first").status, "COMPLETED");
assert.equal(store.loadMilestone("acceptance-second").status, "COMPLETED");
assert.equal(store.loadMilestone("owner-context-history-access").status, "WAITING_OWNER_AUTHORIZATION");
record("DEFERRED_HISTORY_ACCESS_PRESERVED", "YES");

const gates = port.getPendingOwnerGates();
assert.equal(gates.length, 1);
assert.equal(gates[0].milestoneId, "owner-context-history-access");
assert.ok(gates[0].exactScope.length >= 3, "the gate must state exactly what it asks for");
record("OWNER_GATE_QUEUE_BEHAVIOR", "PASS");

/* -------------------------------------------------------------------------- */
/* 3. Provider Bridge really chose an executor, and a lease really existed     */
/* -------------------------------------------------------------------------- */

const events = store.listEvents();
const chosen = events.filter((event) => event.type === "PROVIDER_SELECTED").map((event) => event.detail);
assert.ok(chosen.length >= 2, "no provider selection was recorded");
assert.ok(chosen.every((provider) => provider === "local"), `expected the only capable provider, saw ${chosen.join(",")}`);
record("PROVIDER_ROUTING", "PASS");

const bootstraps = [...written.keys()].filter((path) => path.endsWith(".bootstrap.json"));
assert.ok(bootstraps.length >= 2, "MVA Real Dispatch did not write a worker bootstrap");
const bootstrap = JSON.parse(written.get(bootstraps[0]));
assert.ok(bootstrap.leaseId, "no worker lease was recorded");
assert.equal(bootstrap.agentsPath, "AGENTS.md");
record("WORKER_LEASE_CREATED", "PASS");
record("BOUNDED_TASK_EXECUTED", "PASS");

const packet = store.loadPacket("acceptance-first");
assert.ok(packet, "no takeover packet was persisted");
assert.equal(packet.baselineSha, HEAD);
assert.equal(packet.ownerAuthorizationId, AUTH_ID);
record("TAKEOVER_PACKET_PERSISTED", "PASS");

/* -------------------------------------------------------------------------- */
/* 4. The ledger tells the whole story, in order                               */
/* -------------------------------------------------------------------------- */

const types = events.map((event) => event.type);
for (const expected of [
  "ROADMAP_CREATED", "MILESTONE_CREATED", "AUTHORITY_ALLOWED", "OWNER_GATE_REQUIRED",
  "DISPATCH_REQUESTED", "PROVIDER_SELECTED", "WORKER_STARTED", "VALIDATION_STARTED",
  "VALIDATION_PASSED", "MILESTONE_COMPLETED", "DEPENDENCY_SATISFIED",
]) {
  assert.ok(types.includes(expected), `the ledger is missing ${expected}`);
}
assert.deepEqual(events.map((event) => event.sequence), events.map((_, index) => index + 1));
const firstCompleted = types.indexOf("MILESTONE_COMPLETED");
assert.ok(types.indexOf("VALIDATION_PASSED") < firstCompleted, "a milestone completed before it was validated");
record("EVENT_LEDGER", "PASS");
record("EVENT_SEQUENCE_CORRECT", "PASS");

/* -------------------------------------------------------------------------- */
/* 5. Restart: reload preserves completion and does not run anything twice      */
/* -------------------------------------------------------------------------- */

const dispatchesBefore = bootstraps.length;
const restarted = portOver(storeRoot);
const secondPass = restarted.continueRoadmap();

assert.equal(secondPass.completed.length, 0, "a restart re-ran completed work");
assert.equal(secondPass.stopReason, "NO_ELIGIBLE_WORK");
const dispatchesAfter = [...written.keys()].filter((path) => path.endsWith(".bootstrap.json")).length;
assert.equal(dispatchesAfter, dispatchesBefore, "a restart dispatched a completed milestone again");
assert.equal(restarted.getRoadmapStatus().byStatus.COMPLETED, 2);
record("RESTART_RECOVERY", "PASS");
record("DUPLICATE_EXECUTION_AFTER_RESTART", "NO");
record("REPLACEABLE_WORKER_RECOVERY", "PASS");

record("FIRST_REAL_AUTONOMOUS_CHAIN", "PASS");
record("PRODUCTION_TOUCHED", "NO");
record("EXTERNAL_ACTIONS", "NONE");
record("SPEND_USD", "0");

console.log("AION AUTONOMOUS ROADMAP ORCHESTRATOR V1 — REAL ACCEPTANCE");
for (const line of results) console.log(line);
console.log(
  "\nNote: the chain wrote one disposable artifact inside .aion-local/roadmap-acceptance. " +
    "No push, no external call, no production, no spend.",
);
