/**
 * The app can now finish a milestone, so these tests are about the ways it must still refuse to.
 *
 * Two defects motivated this milestone, and neither was "no adapter exists". The dispatch layer
 * silently manufactures a bounded local executor for *every* provider id when the caller supplies
 * none, so a job routed to `claude` wrote an artifact reading `EXECUTOR = claude` while nothing of
 * the sort ran; and the app supplied `verify: () => []`, so every milestone failed validation on
 * missing evidence. The first is a lie, the second is a wall. The tests below pin both: an
 * unregistered provider must never produce a success, and a passing verification must come from
 * something observed.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createRoadmapControl } from "../../apps/aion/roadmap-control.mjs";
import {
  REGISTERED_PROVIDERS_V1,
  UNREGISTERED_PROVIDERS_V1,
  createProviderRegistry,
} from "../../apps/aion/provider-registry.mjs";
import {
  VERIFIABLE_STEP_NAMES_V1,
  createVerificationRunner,
  jobIdForMilestone,
} from "../../apps/aion/verification-runner.mjs";
import {
  PROVIDER_IDS_V1,
  createFileRoadmapStore,
  createRoadmapPort,
  jobRecordPath,
  parseJobRecord,
  routeJob,
} from "../../packages/director/dist/index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const AUTH_ID = "AION-APP-LIVE-PROVIDER-EXECUTION-V1-20260819T012031Z";

/** Steps the shipped runner can actually check. A milestone that wants to finish declares these. */
const CHECKABLE_PLAN = [
  { kind: "DETERMINISTIC_CHECK", name: "durable state reconciled", required: true },
  { kind: "DETERMINISTIC_CHECK", name: "dispatch artifact validated", required: true },
  { kind: "DETERMINISTIC_CHECK", name: "executor matches selected provider", required: true },
  { kind: "DETERMINISTIC_CHECK", name: "no external effect", required: true },
  { kind: "DETERMINISTIC_CHECK", name: "zero spend", required: true },
  { kind: "DETERMINISTIC_CHECK", name: "writer released", required: true },
  { kind: "DETERMINISTIC_CHECK", name: "repository head unchanged", required: true },
];

function head() {
  return execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function withScratch(run) {
  const root = mkdtempSync(join(tmpdir(), "aion-live-exec-"));
  try {
    return run({
      root,
      storeRoot: join(root, "roadmap"),
      jobStoreRoot: join(root, "mva-dispatch"),
      artifactRoot: join(root, "mva-dispatch", "artifacts"),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * A control wired exactly as production wires it: no injected dispatch, no injected verify.
 *
 * Only the storage roots move, so the test never writes into the repository. Everything that decides
 * an outcome — adapters, routing, authority, verification — is the shipped path.
 */
function liveControl(paths, overrides = {}) {
  return createRoadmapControl({
    repositoryRoot,
    storeRoot: paths.storeRoot,
    jobStoreRoot: paths.jobStoreRoot,
    artifactRoot: paths.artifactRoot,
    ...overrides,
  });
}

function seedPort(paths, extra = {}) {
  return createRoadmapPort({
    storeRoot: paths.storeRoot,
    authorities: [],
    now: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    verify: () => [],
    baselineSha: "seed",
    currentHead: "seed",
    currentDirectiveId: "seed",
    dispatch: () => ({ provider: null, succeeded: false, failureClass: "SEED_ONLY", detail: "seed", leaseId: null, ambiguousExternalEffect: false }),
    ...extra,
  });
}

function milestone(overrides = {}) {
  return {
    milestoneId: "live-acceptance",
    title: "Live acceptance",
    objective: "write one bounded artifact and change nothing else",
    priority: 100,
    dependencies: [],
    ownerAuthorizationId: AUTH_ID,
    authorityClass: "MILESTONE_AUTHORIZED",
    externalEffectClass: "NONE",
    riskClasses: [],
    allowedProviders: ["local"],
    reviewPolicy: "NONE",
    verificationSteps: CHECKABLE_PLAN,
    provenance: "focused live-execution test",
    ...overrides,
  };
}

function seed(paths, milestones = [milestone()]) {
  seedPort(paths).ensureRoadmap({
    roadmapId: "live-acceptance-roadmap",
    ownerGoalSet: ["prove one harmless milestone can run end to end"],
    provenance: "focused live-execution test",
    milestones,
  });
}

function jobRecord(paths, milestoneId) {
  const path = jobRecordPath(paths.jobStoreRoot, jobIdForMilestone(milestoneId));
  if (!existsSync(path)) return null;
  return parseJobRecord(readFileSync(path, "utf8"));
}

/* -------------------------------------------------------------------------- */
/* Registration: what runs, and what is honestly declared as not running       */
/* -------------------------------------------------------------------------- */

test("exactly one provider has a real executor, and the rest say why they do not", () => {
  const registry = createProviderRegistry({ artifactRoot: join(tmpdir(), "unused-registry"), startingSha: "abc123" });
  assert.deepEqual([...registry.registered], ["local"]);
  assert.deepEqual([...REGISTERED_PROVIDERS_V1], ["local"]);
  for (const id of ["codex", "grok", "claude"]) {
    assert.equal(registry.registered.includes(id), false, `${id} must not be reported as registered`);
    assert.ok(typeof registry.unregistered[id] === "string" && registry.unregistered[id].length > 0,
      `${id} must state why it is unregistered`);
    assert.ok(UNREGISTERED_PROVIDERS_V1[id].includes("not authorized"));
  }
  // Every id still has an adapter and a health row: a missing entry fails closed as "unknown",
  // and unknown is exactly the state that later reads as "we did not check".
  for (const id of PROVIDER_IDS_V1) {
    assert.ok(registry.adapters[id] !== undefined, `${id} has no adapter`);
    assert.ok(registry.health[id] !== undefined, `${id} has no health row`);
  }
});

test("an unregistered provider refuses instead of fabricating a success", () => {
  const registry = createProviderRegistry({ artifactRoot: join(tmpdir(), "unused-registry"), startingSha: "abc123" });
  for (const id of ["codex", "grok", "claude"]) {
    const result = registry.adapters[id].execute({ jobId: "j", expectedArtifact: "a.txt" });
    assert.equal(result.class, "PROVIDER_UNAVAILABLE");
    assert.equal(result.artifact, undefined, "an unregistered provider must not claim an artifact");
    assert.equal(result.costUsd, 0);
    assert.equal(result.externalEffectState, "NONE");
    assert.equal(registry.adapters[id].probeHealth(), "DISABLED");
  }
});

test("unregistered providers are ineligible in health, so routing never reaches them", () => {
  const registry = createProviderRegistry({ artifactRoot: join(tmpdir(), "unused-registry"), startingSha: "abc123" });
  for (const id of ["codex", "grok", "claude"]) {
    assert.equal(registry.health[id].state, "DISABLED");
    assert.equal(registry.health[id].manuallyDisabled, true);
  }
  assert.equal(registry.health.local.state, "AVAILABLE");
  assert.equal(registry.health.local.manuallyDisabled, false);

  const envelope = {
    requiredCapabilities: ["CODING"], writePermission: true, sensitiveDataClass: "INTERNAL",
    sensitiveDataAllowedProviders: ["codex", "grok", "claude", "local"],
    spendCapUsd: 0, remainingSpendUsd: 0, preferredProvider: null,
  };
  const routed = routeJob(envelope, registry.health, {}, {}, "2026-08-19T00:00:00Z");
  assert.equal(routed.selected, "local", "routing must land on the only provider with an executor");
  for (const id of ["codex", "grok", "claude"]) {
    assert.equal(routed.ineligible[id], "Owner disabled provider");
  }
});

test("health is what decides eligibility: disable local and the job has nowhere to go", () => {
  const registry = createProviderRegistry({ artifactRoot: join(tmpdir(), "unused-registry"), startingSha: "abc123" });
  const health = { ...registry.health, local: { ...registry.health.local, state: "DISABLED", manuallyDisabled: true } };
  const envelope = {
    requiredCapabilities: ["CODING"], writePermission: true, sensitiveDataClass: "INTERNAL",
    sensitiveDataAllowedProviders: ["local"], spendCapUsd: 0, remainingSpendUsd: 0, preferredProvider: null,
  };
  const routed = routeJob(envelope, health, {}, {}, "2026-08-19T00:00:00Z");
  assert.equal(routed.selected, null);
  assert.equal(routed.reason, "NO_ELIGIBLE_PROVIDER");
});

/* -------------------------------------------------------------------------- */
/* The chain, end to end                                                       */
/* -------------------------------------------------------------------------- */

test("Continue runs a harmless authorized milestone through the real stack to COMPLETED", () => {
  withScratch((paths) => {
    seed(paths);
    const result = liveControl(paths).continueRoadmap();

    assert.deepEqual([...result.completed], ["live-acceptance"]);
    assert.deepEqual([...result.failed], []);
    assert.deepEqual([...result.blocked], []);
    assert.equal(result.ownerPrompts, 0);

    const record = jobRecord(paths, "live-acceptance");
    assert.ok(record !== null, "the job record must be durable, not in memory");
    assert.equal(record.status, "SUCCEEDED");
    assert.equal(record.activeProvider, "local");
    assert.equal(record.externalEffectState, "NONE");
    assert.equal(record.leaseReleased, true);
    assert.equal(record.writer.liveness, "STOPPED");
    assert.equal(record.endingSha, record.startingSha, "a harmless milestone moved no sha");

    const artifact = record.artifacts[record.artifacts.length - 1];
    const contents = readFileSync(artifact, "utf8");
    assert.ok(contents.includes("EXECUTOR = local"), "the artifact names the provider that ran");
    assert.ok(artifact.startsWith(paths.artifactRoot), "the artifact stayed inside the artifact root");
  });
});

test("the panel states which providers are registered and which are deliberately not", () => {
  withScratch((paths) => {
    seed(paths);
    const status = liveControl(paths).status();
    assert.deepEqual([...status.providers.registered], ["local"]);
    const ids = status.providers.unregistered.map((row) => row.providerId).sort();
    assert.deepEqual(ids, ["claude", "codex", "grok"]);
    for (const row of status.providers.unregistered) {
      assert.ok(row.reason.length > 0, `${row.providerId} is unregistered with no stated reason`);
    }
  });
});

test("provider choice never originates in the browser", () => {
  const control = liveControl({ storeRoot: join(tmpdir(), "x"), jobStoreRoot: join(tmpdir(), "y"), artifactRoot: join(tmpdir(), "z") });
  assert.equal(control.continueRoadmap.length, 0, "Continue accepts no caller-supplied argument");
  const server = readFileSync(join(repositoryRoot, "apps", "aion", "server.mjs"), "utf8");
  const call = /case "roadmap\.continue":[\s\S]{0,200}?continueRoadmap\(([^)]*)\)/.exec(server);
  assert.ok(call !== null, "roadmap.continue is not routed to continueRoadmap");
  assert.equal(call[1].trim(), "", "the server must not forward request data into Continue");
  const client = readFileSync(join(repositoryRoot, "apps", "aion", "public", "app.js"), "utf8");
  for (const id of PROVIDER_IDS_V1.filter((row) => row !== "local")) {
    assert.equal(new RegExp(`provider["'\\s:=]+${id}`, "i").test(client), false, `the page names ${id} as a choice`);
  }
});

/* -------------------------------------------------------------------------- */
/* Refusals                                                                     */
/* -------------------------------------------------------------------------- */

test("a gated milestone is never dispatched: no job record is created for it", () => {
  withScratch((paths) => {
    seed(paths, [milestone({ milestoneId: "needs-owner", ownerAuthorizationId: null })]);
    const result = liveControl(paths).continueRoadmap();
    assert.deepEqual([...result.gated], ["needs-owner"]);
    assert.deepEqual([...result.completed], []);
    assert.equal(jobRecord(paths, "needs-owner"), null, "a gated milestone reached the dispatch layer");
  });
});

test("revoked and suspended authority never dispatch", () => {
  for (const state of ["REVOKED", "SUSPENDED"]) {
    withScratch((paths) => {
      const record = JSON.parse(
        readFileSync(join(repositoryRoot, ".aion-local", "owner-authority", `${AUTH_ID}.json`), "utf8"),
      );
      seed(paths);
      const port = createRoadmapPort({
        storeRoot: paths.storeRoot,
        authorities: [{ ...record, state }],
        now: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        verify: () => CHECKABLE_PLAN.map((s) => ({ step: s.name, result: "PASS", detail: "should never be reached" })),
        baselineSha: head(),
        currentHead: head(),
        currentDirectiveId: AUTH_ID,
        dispatchTarget: { repository: repositoryRoot, worktree: paths.root, startingSha: head() },
      });
      const advanced = port.continueRoadmap();
      assert.deepEqual([...advanced.completed], [], `${state} authority completed work`);
      assert.equal(jobRecord(paths, "live-acceptance"), null, `${state} authority reached dispatch`);
    });
  }
});

test("sensitivity and spend stay gated even though a provider is now available", () => {
  withScratch((paths) => {
    seed(paths);
    const store = createFileRoadmapStore(paths.storeRoot);
    const loaded = store.loadMilestone("live-acceptance");
    store.saveMilestone({ ...loaded, sensitivityClass: "CONFIDENTIAL" });
    const sensitive = liveControl(paths).continueRoadmap();
    assert.deepEqual([...sensitive.gated], ["live-acceptance"]);
    assert.equal(jobRecord(paths, "live-acceptance"), null);
  });

  withScratch((paths) => {
    seed(paths);
    const store = createFileRoadmapStore(paths.storeRoot);
    const loaded = store.loadMilestone("live-acceptance");
    store.saveMilestone({ ...loaded, spendCapUsd: 25 });
    const spending = liveControl(paths).continueRoadmap();
    assert.deepEqual([...spending.gated], ["live-acceptance"]);
    assert.equal(jobRecord(paths, "live-acceptance"), null);
  });
});

test("a missing reviewer verdict still fails closed now that dispatch succeeds", () => {
  withScratch((paths) => {
    seed(paths, [milestone({ reviewPolicy: "INDEPENDENT" })]);
    const result = liveControl(paths).continueRoadmap();
    assert.deepEqual([...result.completed], [], "a milestone completed without the review it required");
    assert.deepEqual([...result.blocked], ["live-acceptance"]);

    const stuck = liveControl(paths).recent().stuck;
    assert.equal(stuck.length, 1);
    assert.match(stuck[0].blockedReason, /no verdict was recorded/);
    // The work did run — this is a review failure, not a dispatch failure, and the record says so.
    assert.equal(jobRecord(paths, "live-acceptance").status, "SUCCEEDED");
  });
});

test("an ambiguous external effect is not retried", () => {
  withScratch((paths) => {
    seed(paths);
    let dispatches = 0;
    const ambiguous = () => {
      dispatches += 1;
      return { provider: "local", succeeded: false, failureClass: "AMBIGUOUS_EFFECT_BLOCKED", detail: "effect may have landed", leaseId: null, ambiguousExternalEffect: true };
    };
    liveControl(paths, { dispatch: ambiguous }).continueRoadmap();
    assert.equal(createFileRoadmapStore(paths.storeRoot).loadMilestone("live-acceptance").status, "RECOVERY_REQUIRED");
    liveControl(paths, { dispatch: ambiguous }).continueRoadmap();
    assert.equal(dispatches, 1, "an ambiguous effect was dispatched a second time");
  });
});

test("a provider failure is surfaced truthfully rather than swallowed", () => {
  withScratch((paths) => {
    seed(paths);
    const result = liveControl(paths, {
      dispatch: () => ({ provider: "local", succeeded: false, failureClass: "QUOTA_EXHAUSTED", detail: "provider is out of quota", leaseId: null, ambiguousExternalEffect: false }),
    }).continueRoadmap();
    assert.deepEqual([...result.failed], ["live-acceptance"]);
    const stuck = liveControl(paths).recent().stuck;
    assert.equal(stuck[0].blockedReason, "provider is out of quota");
  });
});

/* -------------------------------------------------------------------------- */
/* Verification evidence is observed, never assumed                            */
/* -------------------------------------------------------------------------- */

test("the runner produces no evidence for a step it cannot check, and the milestone fails", () => {
  withScratch((paths) => {
    seed(paths, [milestone({
      verificationSteps: [{ kind: "FOCUSED_TESTS", name: "focused tests", required: true }],
    })]);
    const result = liveControl(paths).continueRoadmap();
    assert.deepEqual([...result.completed], [], "an uncheckable step was treated as satisfied");
    assert.deepEqual([...result.failed], ["live-acceptance"]);
    assert.match(liveControl(paths).recent().stuck[0].blockedReason, /required verification evidence is missing/);
    assert.equal(VERIFIABLE_STEP_NAMES_V1.includes("focused tests"), false);
  });
});

test("no durable job record means every check reports FAIL, never PASS", () => {
  withScratch((paths) => {
    const verify = createVerificationRunner({
      repositoryRoot,
      jobStoreRoot: paths.jobStoreRoot,
      registeredProviders: ["local"],
    });
    const evidence = verify({
      milestoneId: "never-ran",
      verificationPlan: { steps: CHECKABLE_PLAN, declaredAt: "2026-08-19T00:00:00Z" },
    });
    assert.equal(evidence.length, CHECKABLE_PLAN.length);
    for (const row of evidence) {
      assert.equal(row.result, "FAIL", `${row.step} passed with no job record`);
      assert.match(row.detail, /no durable job record/);
    }
  });
});

test("an artifact that names a different executor than the one selected fails verification", () => {
  withScratch((paths) => {
    seed(paths);
    liveControl(paths).continueRoadmap();
    const record = jobRecord(paths, "live-acceptance");
    const artifact = record.artifacts[record.artifacts.length - 1];
    writeFileSync(artifact, readFileSync(artifact, "utf8").replace("EXECUTOR = local", "EXECUTOR = claude"), "utf8");

    const verify = createVerificationRunner({
      repositoryRoot,
      jobStoreRoot: paths.jobStoreRoot,
      registeredProviders: ["local"],
    });
    const evidence = verify({
      milestoneId: "live-acceptance",
      verificationPlan: { steps: CHECKABLE_PLAN, declaredAt: "2026-08-19T00:00:00Z" },
    });
    const executorRow = evidence.find((row) => row.step === "executor matches selected provider");
    assert.equal(executorRow.result, "FAIL");
    assert.match(executorRow.detail, /does not name local as the executor/);
  });
});

test("a provider with no registered executor cannot satisfy the executor check", () => {
  withScratch((paths) => {
    seed(paths);
    liveControl(paths).continueRoadmap();
    const verify = createVerificationRunner({
      repositoryRoot,
      jobStoreRoot: paths.jobStoreRoot,
      registeredProviders: [],
    });
    const row = verify({
      milestoneId: "live-acceptance",
      verificationPlan: { steps: CHECKABLE_PLAN, declaredAt: "2026-08-19T00:00:00Z" },
    }).find((entry) => entry.step === "executor matches selected provider");
    assert.equal(row.result, "FAIL");
    assert.match(row.detail, /has no registered executor/);
  });
});

test("a deleted artifact fails reconciliation rather than passing on the record alone", () => {
  withScratch((paths) => {
    seed(paths);
    liveControl(paths).continueRoadmap();
    const record = jobRecord(paths, "live-acceptance");
    rmSync(record.artifacts[record.artifacts.length - 1], { force: true });

    const verify = createVerificationRunner({
      repositoryRoot,
      jobStoreRoot: paths.jobStoreRoot,
      registeredProviders: ["local"],
    });
    const evidence = verify({
      milestoneId: "live-acceptance",
      verificationPlan: { steps: CHECKABLE_PLAN, declaredAt: "2026-08-19T00:00:00Z" },
    });
    const reconciled = evidence.find((row) => row.step === "durable state reconciled");
    assert.equal(reconciled.result, "FAIL");
    assert.match(reconciled.detail, /not on disk/);
  });
});

/* -------------------------------------------------------------------------- */
/* Restart                                                                      */
/* -------------------------------------------------------------------------- */

test("completed work is not re-run after a restart, and the app sees the durable truth", () => {
  withScratch((paths) => {
    seed(paths);
    liveControl(paths).continueRoadmap();
    const first = jobRecord(paths, "live-acceptance");
    assert.equal(first.status, "SUCCEEDED");

    // A fresh control instance is what a restarted server has: no memory, only the store.
    const restarted = liveControl(paths);
    const again = restarted.continueRoadmap();
    assert.deepEqual([...again.completed], [], "completed work was re-run after restart");
    assert.equal(again.stopReason, "NO_ELIGIBLE_WORK");

    const second = jobRecord(paths, "live-acceptance");
    assert.equal(second.updatedAt, first.updatedAt, "the durable job record was rewritten on restart");
    assert.equal(second.attempts.length, first.attempts.length);
    assert.equal(restarted.recent().completed[0].milestoneId, "live-acceptance");
    assert.equal(createFileRoadmapStore(paths.storeRoot).loadMilestone("live-acceptance").status, "COMPLETED");
  });
});

test("a milestone left mid-flight by a dead worker is recovered, not resumed blindly", () => {
  withScratch((paths) => {
    seed(paths);
    const store = createFileRoadmapStore(paths.storeRoot);
    const loaded = store.loadMilestone("live-acceptance");
    store.saveMilestone({ ...loaded, status: "RUNNING", blockedReason: null });

    liveControl(paths).continueRoadmap();
    // Recovery moves it to FAILED first; the same pass may then retry it, which is legitimate for
    // repository-reversible work. What must never happen is completing on the strength of the
    // interrupted attempt alone.
    const after = createFileRoadmapStore(paths.storeRoot).loadMilestone("live-acceptance");
    assert.notEqual(after.status, "RUNNING", "an interrupted milestone stayed in flight");
    if (after.status === "COMPLETED") {
      assert.equal(jobRecord(paths, "live-acceptance").status, "SUCCEEDED", "completed without a successful job");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Nothing widened                                                             */
/* -------------------------------------------------------------------------- */

test("no second dispatch path and no route around the port", () => {
  for (const file of ["roadmap-control.mjs", "provider-registry.mjs", "verification-runner.mjs", "server.mjs"]) {
    const source = readFileSync(join(repositoryRoot, "apps", "aion", file), "utf8");
    assert.equal(source.includes("routeJob("), false, `${file} routes providers itself`);
    assert.equal(source.includes("executeWithFailover("), false, `${file} runs its own failover`);
    if (file !== "roadmap-control.mjs") {
      assert.equal(source.includes("submitJob("), false, `${file} calls dispatch directly`);
    }
  }
  const source = readFileSync(join(repositoryRoot, "apps", "aion", "roadmap-control.mjs"), "utf8");
  assert.equal(source.includes("submitJob("), false, "the app calls dispatch instead of the port");
  // Matched as code — `name(`, `name:` or `name =` — rather than as a word, because the module's own
  // comments name these operations in order to say it does not have them, and a check that cannot
  // tell prose from a definition would force the documentation to go quiet about the guarantee.
  for (const forbidden of ["approveGate", "grantAuthority", "setAuthority", "forceComplete", "bypassReview", "bypassVerification"]) {
    const asCode = new RegExp(`\\b${forbidden}\\s*[(:=]`);
    assert.equal(asCode.test(source), false, `${forbidden} appeared as code on the app surface`);
  }
  const surface = Object.keys(liveControl({ storeRoot: join(tmpdir(), "x"), jobStoreRoot: join(tmpdir(), "y"), artifactRoot: join(tmpdir(), "z") }));
  for (const forbidden of ["approveGate", "grantAuthority", "setAuthority", "forceComplete", "bypassReview", "bypassVerification", "registerProvider"]) {
    assert.equal(surface.includes(forbidden), false, `${forbidden} is reachable on the control object`);
  }
});

test("the verification runner performs no writes and no shell", () => {
  const source = readFileSync(join(repositoryRoot, "apps", "aion", "verification-runner.mjs"), "utf8");
  for (const forbidden of ["writeFileSync", "rmSync", "mkdirSync", "execSync", "spawnSync", "unlinkSync"]) {
    assert.equal(source.includes(forbidden), false, `the verifier uses ${forbidden}`);
  }
});
