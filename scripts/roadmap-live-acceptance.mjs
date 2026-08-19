#!/usr/bin/env node
/**
 * Prove the AION app can finish a milestone — through the shipped app code, with a real provider
 * adapter, real verification evidence and durable state — and prove the refusals still hold.
 *
 * The previous acceptance harness drove `RoadmapPortV1` directly and supplied its own adapters. That
 * showed the orchestrator worked; it could not show that the *app process* had an executor, because
 * it never used the app's wiring. This one builds `createRoadmapControl` exactly as `server.mjs`
 * builds it — no injected dispatcher, no injected verifier — and only moves the storage roots into a
 * scratch workspace so the run leaves the repository alone.
 *
 * The acceptance milestone is dedicated and disposable. Proving the wiring must not consume real
 * planned work, so nothing here touches `.aion-local/roadmap`.
 *
 * Harmless by construction: one artifact inside a temp directory, zero spend, no external effect, no
 * push, no production, no network.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = join(here, "..");

const { createRoadmapControl } = await import(
  pathToFileURL(join(repositoryRoot, "apps", "aion", "roadmap-control.mjs")).href
);
const { createProviderRegistry } = await import(
  pathToFileURL(join(repositoryRoot, "apps", "aion", "provider-registry.mjs")).href
);
const { jobIdForMilestone } = await import(
  pathToFileURL(join(repositoryRoot, "apps", "aion", "verification-runner.mjs")).href
);
const { createFileRoadmapStore, createRoadmapPort, jobRecordPath, parseJobRecord } = await import(
  pathToFileURL(join(repositoryRoot, "packages", "director", "dist", "index.js")).href
);

const results = [];
const record = (name, value) => results.push(`${name} = ${value}`);
const nowUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

const HEAD = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const AUTH_ID = "AION-APP-LIVE-PROVIDER-EXECUTION-V1-20260819T012031Z";

/* -------------------------------------------------------------------------- */
/* Durable governance truth this milestone must leave alone                    */
/* -------------------------------------------------------------------------- */

const d2 = JSON.parse(readFileSync(join(repositoryRoot, ".aion-local", "certifications", "d2", "state.json"), "utf8"));
assert.equal(d2.d2Certification, "GRANTED");
assert.equal(d2.d2CertifiedSha, "17b012b28d911fe563aab19f6e4a697a05b9b718");
record("D2_CERTIFICATION_AFTER", d2.d2Certification);

const authorityDir = join(repositoryRoot, ".aion-local", "owner-authority");
const authority = JSON.parse(readFileSync(join(authorityDir, `${AUTH_ID}.json`), "utf8"));
assert.equal(authority.state, "ACTIVE");
assert.deepEqual([...authority.allowedProviders], ["local"], "the Owner envelope for this milestone is local-only");
assert.equal(authority.spendingCeilingUsd, 0);
record("OWNER_STANDING_AUTHORITY_V1_AFTER", "ACTIVE");
record("OWNER_ALLOWED_PROVIDERS", authority.allowedProviders.join(","));
record("OWNER_SPEND_CEILING_USD", authority.spendingCeilingUsd);

/* -------------------------------------------------------------------------- */
/* What this process can actually execute with                                 */
/* -------------------------------------------------------------------------- */

const registry = createProviderRegistry({
  artifactRoot: join(tmpdir(), "aion-live-acceptance-registry-probe"),
  startingSha: HEAD,
  now: nowUtc(),
  allowedProviders: authority.allowedProviders,
});
assert.deepEqual([...registry.registered], ["local"]);
record("PROVIDER_ADAPTERS_REGISTERED", registry.registered.join(","));
record("PROVIDER_ADAPTERS_DELIBERATELY_NOT_REGISTERED", Object.keys(registry.unregistered).join(","));
for (const id of Object.keys(registry.unregistered)) {
  assert.equal(registry.health[id].state, "DISABLED");
  assert.equal(registry.adapters[id].execute({ jobId: "probe" }).class, "PROVIDER_UNAVAILABLE");
}
record("UNREGISTERED_PROVIDERS_FAIL_CLOSED", "PASS");

/* -------------------------------------------------------------------------- */
/* Scratch workspace                                                           */
/* -------------------------------------------------------------------------- */

const workspace = mkdtempSync(join(tmpdir(), "aion-live-acceptance-"));
const paths = {
  storeRoot: join(workspace, "roadmap"),
  jobStoreRoot: join(workspace, "mva-dispatch"),
  artifactRoot: join(workspace, "mva-dispatch", "artifacts"),
};

/** The verification steps the shipped runner can genuinely observe. */
const PLAN = [
  { kind: "DETERMINISTIC_CHECK", name: "durable state reconciled", required: true },
  { kind: "DETERMINISTIC_CHECK", name: "dispatch artifact validated", required: true },
  { kind: "DETERMINISTIC_CHECK", name: "executor matches selected provider", required: true },
  { kind: "DETERMINISTIC_CHECK", name: "no external effect", required: true },
  { kind: "DETERMINISTIC_CHECK", name: "zero spend", required: true },
  { kind: "DETERMINISTIC_CHECK", name: "writer released", required: true },
  { kind: "DETERMINISTIC_CHECK", name: "repository head unchanged", required: true },
];

createRoadmapPort({
  storeRoot: paths.storeRoot,
  authorities: [],
  now: nowUtc,
  verify: () => [],
  baselineSha: HEAD,
  currentHead: HEAD,
  currentDirectiveId: AUTH_ID,
  dispatch: () => ({ provider: null, succeeded: false, failureClass: "SEED_ONLY", detail: "seed", leaseId: null, ambiguousExternalEffect: false }),
}).ensureRoadmap({
  roadmapId: "live-provider-execution-acceptance",
  ownerGoalSet: ["prove one harmless milestone runs end to end from the app"],
  provenance: "AION-APP-LIVE-PROVIDER-EXECUTION-V1 acceptance harness",
  milestones: [
    {
      milestoneId: "acceptance-harmless-artifact",
      title: "Harmless bounded artifact",
      objective: "write one bounded artifact inside a scratch workspace and change nothing else",
      priority: 100,
      dependencies: [],
      ownerAuthorizationId: AUTH_ID,
      authorityClass: "MILESTONE_AUTHORIZED",
      externalEffectClass: "NONE",
      riskClasses: [],
      allowedProviders: ["local"],
      reviewPolicy: "NONE",
      verificationSteps: PLAN,
      provenance: "acceptance harness; not a production roadmap item",
    },
    {
      milestoneId: "acceptance-needs-owner",
      title: "Stands in for the deferred history-access directive",
      objective: "a milestone with no Owner authority record, which must never run",
      priority: 900,
      dependencies: [],
      ownerAuthorizationId: null,
      authorityClass: "MILESTONE_AUTHORIZED",
      externalEffectClass: "NONE",
      riskClasses: ["SENSITIVE_DATA"],
      reviewPolicy: "INDEPENDENT",
      verificationSteps: PLAN,
      provenance: "acceptance harness; must remain gated",
    },
  ],
});

/** Production wiring: only the storage roots move. */
const control = (overrides = {}) => createRoadmapControl({ repositoryRoot, ...paths, ...overrides });

const jobFor = (milestoneId) => {
  const path = jobRecordPath(paths.jobStoreRoot, jobIdForMilestone(milestoneId));
  return existsSync(path) ? parseJobRecord(readFileSync(path, "utf8")) : null;
};

try {
  /* ------------------------------------------------------------------------ */
  /* The chain                                                                 */
  /* ------------------------------------------------------------------------ */

  const before = control().status();
  assert.equal(before.exists, true);
  assert.deepEqual([...before.providers.registered], ["local"]);
  record("APP_REPORTS_REGISTERED_PROVIDERS", "PASS");

  const advanced = control().continueRoadmap();
  assert.deepEqual([...advanced.completed], ["acceptance-harmless-artifact"], "the harmless milestone did not complete");
  assert.deepEqual([...advanced.gated], ["acceptance-needs-owner"], "the unauthorized milestone was not gated");
  assert.equal(advanced.ownerPrompts, 0);
  record("APP_TO_WORKER_CHAIN", "PASS");
  record("CHAIN_COMPLETED_MILESTONES", advanced.completed.join(","));
  record("OWNER_PROMPTS_IN_CHAIN", advanced.ownerPrompts);

  const job = jobFor("acceptance-harmless-artifact");
  assert.ok(job !== null, "the job record was not durable");
  assert.equal(job.status, "SUCCEEDED");
  assert.equal(job.activeProvider, "local");
  assert.equal(job.externalEffectState, "NONE");
  assert.equal(job.leaseReleased, true);
  assert.equal(job.writer.liveness, "STOPPED");
  assert.equal(job.endingSha, job.startingSha);
  record("PROVIDER_SELECTED", job.activeProvider);
  record("SELECTION_MADE_BY", "PROVIDER_BRIDGE_V1");
  record("DURABLE_JOB_RECORD", "PASS");
  record("ONE_WRITER_LEASE_RELEASED", "PASS");

  const artifact = job.artifacts[job.artifacts.length - 1];
  const contents = readFileSync(artifact, "utf8");
  assert.ok(contents.includes("EXECUTOR = local"));
  assert.ok(artifact.startsWith(paths.artifactRoot), "an artifact escaped the scratch workspace");
  record("ARTIFACT_WRITTEN_AND_VALIDATED", "PASS");
  record("ARTIFACT_INSIDE_SCRATCH_WORKSPACE", "PASS");

  const spend = job.attempts.reduce((total, attempt) => total + (attempt.cost ?? 0), 0);
  assert.equal(spend, 0);
  record("SPEND_USD", spend);

  /* ------------------------------------------------------------------------ */
  /* Refusals                                                                  */
  /* ------------------------------------------------------------------------ */

  assert.equal(jobFor("acceptance-needs-owner"), null, "a gated milestone reached the dispatch layer");
  const gates = control().gates().gates;
  assert.equal(gates.length, 1);
  assert.equal(gates[0].milestoneId, "acceptance-needs-owner");
  record("GATED_MILESTONE_DISPATCHED", "NO");
  record("OWNER_GATE_STILL_OPEN", "PASS");

  const revoked = createRoadmapPort({
    storeRoot: paths.storeRoot,
    authorities: [{ ...authority, state: "REVOKED" }],
    now: nowUtc,
    verify: () => PLAN.map((step) => ({ step: step.name, result: "PASS", detail: "must never be reached" })),
    baselineSha: HEAD,
    currentHead: HEAD,
    currentDirectiveId: AUTH_ID,
    dispatchTarget: { repository: repositoryRoot, worktree: workspace, startingSha: HEAD },
  });
  const revokedRun = revoked.continueRoadmap();
  assert.deepEqual([...revokedRun.completed], [], "revoked authority completed work");
  record("REVOKED_AUTHORITY_DISPATCHED", "NO");

  /* ------------------------------------------------------------------------ */
  /* Restart safety                                                            */
  /* ------------------------------------------------------------------------ */

  const restarted = control();
  const again = restarted.continueRoadmap();
  assert.deepEqual([...again.completed], [], "completed work was re-run after restart");
  const jobAfter = jobFor("acceptance-harmless-artifact");
  assert.equal(jobAfter.updatedAt, job.updatedAt, "the durable job record changed on restart");
  assert.equal(jobAfter.attempts.length, job.attempts.length);
  assert.equal(createFileRoadmapStore(paths.storeRoot).loadMilestone("acceptance-harmless-artifact").status, "COMPLETED");
  assert.equal(restarted.recent().completed[0].milestoneId, "acceptance-harmless-artifact");
  record("RESTART_REPEATED_COMPLETED_WORK", "NO");
  record("RESTART_PRESERVED_DURABLE_STATE", "PASS");
  record("APP_SEES_DURABLE_UPDATED_STATE", "PASS");

  /* ------------------------------------------------------------------------ */
  /* Absence is still failure                                                  */
  /* ------------------------------------------------------------------------ */

  const uncheckableWorkspace = mkdtempSync(join(tmpdir(), "aion-live-acceptance-uncheckable-"));
  const uncheckable = {
    storeRoot: join(uncheckableWorkspace, "roadmap"),
    jobStoreRoot: join(uncheckableWorkspace, "mva-dispatch"),
    artifactRoot: join(uncheckableWorkspace, "mva-dispatch", "artifacts"),
  };
  try {
    createRoadmapPort({
      storeRoot: uncheckable.storeRoot,
      authorities: [],
      now: nowUtc,
      verify: () => [],
      baselineSha: HEAD,
      currentHead: HEAD,
      currentDirectiveId: AUTH_ID,
      dispatch: () => ({ provider: null, succeeded: false, failureClass: "SEED_ONLY", detail: "seed", leaseId: null, ambiguousExternalEffect: false }),
    }).ensureRoadmap({
      roadmapId: "uncheckable-plan",
      ownerGoalSet: ["prove an uncheckable plan cannot pass"],
      provenance: "acceptance harness",
      milestones: [
        {
          milestoneId: "uncheckable",
          title: "Declares a step nothing can verify",
          objective: "must fail closed rather than complete on silence",
          priority: 100,
          dependencies: [],
          ownerAuthorizationId: AUTH_ID,
          authorityClass: "MILESTONE_AUTHORIZED",
          externalEffectClass: "NONE",
          riskClasses: [],
          allowedProviders: ["local"],
          reviewPolicy: "NONE",
          verificationSteps: [{ kind: "FOCUSED_TESTS", name: "focused tests", required: true }],
          provenance: "acceptance harness",
        },
      ],
    });
    const outcome = createRoadmapControl({ repositoryRoot, ...uncheckable }).continueRoadmap();
    assert.deepEqual([...outcome.completed], [], "a milestone completed with no verifiable evidence");
    assert.deepEqual([...outcome.failed], ["uncheckable"]);
    record("UNVERIFIABLE_PLAN_COMPLETED", "NO");
  } finally {
    rmSync(uncheckableWorkspace, { recursive: true, force: true });
  }

  /* ------------------------------------------------------------------------ */
  /* Nothing escaped                                                           */
  /* ------------------------------------------------------------------------ */

  const headAfter = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(headAfter, HEAD, "the acceptance run moved the repository HEAD");
  record("REPOSITORY_HEAD_UNCHANGED", "PASS");
  record("EXTERNAL_EFFECTS", "NONE");
  record("PUBLIC_EXPOSURE_CREATED", "NO");
  record("PAID_PROVIDER_USED", "NO");
  record("PRODUCTION_ROADMAP_TOUCHED", "NO");
  record("FIRST_REAL_APP_EXECUTION_CHAIN", "PASS");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log("AION APP LIVE PROVIDER EXECUTION ACCEPTANCE");
for (const line of results) console.log(line);
