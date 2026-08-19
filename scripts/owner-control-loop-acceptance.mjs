#!/usr/bin/env node
/**
 * The whole loop, end to end: the Owner types a sentence and AION finishes the work.
 *
 * Owner text → classification → durable `OwnerGoalIntentV1` → roadmap milestone → deterministic
 * authority inheritance → `RoadmapPortV1` → MVA Real Dispatch → Provider Bridge → the local worker →
 * real verification evidence → durable completion. No implementation prompt from the Owner, no
 * provider chosen by hand, and no second Founder phrase for the routine child.
 *
 * It runs the shipped app code with only the storage roots moved into a scratch workspace, so the
 * acceptance leaves the repository and the production roadmap alone. Proving the wiring must not
 * consume real planned work.
 *
 * Harmless by construction: one artifact in a temp directory, zero spend, no external effect, no
 * push, no production, no network.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = join(here, "..");

const { createGoalControl, createRoadmapControl } = await import(
  pathToFileURL(join(repositoryRoot, "apps", "aion", "roadmap-control.mjs")).href
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

/* -------------------------------------------------------------------------- */
/* Durable governance truth this milestone must leave alone                    */
/* -------------------------------------------------------------------------- */

const d2 = JSON.parse(readFileSync(join(repositoryRoot, ".aion-local", "certifications", "d2", "state.json"), "utf8"));
assert.equal(d2.d2Certification, "GRANTED");
record("D2_CERTIFICATION_AFTER", d2.d2Certification);

const authorityDir = join(repositoryRoot, ".aion-local", "owner-authority");
let active = 0;
for (const name of readdirSync(authorityDir)) {
  if (!name.endsWith(".json")) continue;
  const row = JSON.parse(readFileSync(join(authorityDir, name), "utf8"));
  assert.equal(row.state, "ACTIVE", `${row.ownerAuthorizationId} is not ACTIVE`);
  active += 1;
}
record("OWNER_STANDING_AUTHORITY_V1_AFTER", "ACTIVE");
record("OWNER_AUTHORITY_RECORDS", active);

/* -------------------------------------------------------------------------- */
/* Scratch workspace                                                           */
/* -------------------------------------------------------------------------- */

const workspace = mkdtempSync(join(tmpdir(), "aion-owner-loop-"));
const paths = {
  storeRoot: join(workspace, "roadmap"),
  jobStoreRoot: join(workspace, "mva-dispatch"),
  artifactRoot: join(workspace, "mva-dispatch", "artifacts"),
  goalStoreRoot: join(workspace, "owner-goals"),
};

const roadmap = () => createRoadmapControl({ repositoryRoot, ...paths });
const goals = () => createGoalControl({ repositoryRoot, ...paths });
const jobFor = (milestoneId) => {
  const path = jobRecordPath(paths.jobStoreRoot, jobIdForMilestone(milestoneId));
  return existsSync(path) ? parseJobRecord(readFileSync(path, "utf8")) : null;
};

try {
  // A roadmap has to exist before a goal can be added to it. Seeding is a host-side act by design —
  // nothing in the browser can create a roadmap.
  createRoadmapPort({
    storeRoot: paths.storeRoot,
    authorities: [],
    now: nowUtc,
    verify: () => [],
    baselineSha: HEAD,
    currentHead: HEAD,
    currentDirectiveId: "acceptance",
    dispatch: () => ({ provider: null, succeeded: false, failureClass: "SEED", detail: "seed", leaseId: null, ambiguousExternalEffect: false }),
  }).ensureRoadmap({
    roadmapId: "owner-control-loop-acceptance",
    ownerGoalSet: ["prove a typed goal runs to completion without another Founder phrase"],
    provenance: "AION-OWNER-GOAL-INTAKE-AND-ROADMAP-AUTHORITY-V1 acceptance harness",
    milestones: [],
  });

  /* ------------------------------------------------------------------------ */
  /* A question stays a question                                              */
  /* ------------------------------------------------------------------------ */

  const question = goals().submit("What is AION working on?");
  assert.equal(question.actionable, false);
  assert.equal(question.milestoneId, null);
  assert.equal(roadmap().status().total, 0, "a question created roadmap work");
  record("QUESTIONS_CREATE_ROADMAP_WORK", "NO");

  /* ------------------------------------------------------------------------ */
  /* An objective becomes governed work                                       */
  /* ------------------------------------------------------------------------ */

  const OWNER_TEXT = "Improve the Roadmap page so I can immediately see what needs my attention.";
  const submitted = goals().submit(OWNER_TEXT);
  assert.equal(submitted.actionable, true);
  assert.equal(submitted.created, true);
  assert.ok(submitted.milestoneId);
  record("ACTIONABLE_GOALS_CREATE_ROADMAP_WORK", "PASS");
  record("OWNER_GOAL_CLASSIFICATION", submitted.classification);

  const goalFiles = readdirSync(join(paths.goalStoreRoot, "goals"));
  const stored = JSON.parse(readFileSync(join(paths.goalStoreRoot, "goals", goalFiles.find((n) => n.endsWith(".json"))), "utf8"));
  assert.ok(goalFiles.length >= 2, "the question was not recorded alongside the objective");
  record("OWNER_GOAL_INTENT_PERSISTED", "PASS");

  const milestone = createFileRoadmapStore(paths.storeRoot).loadMilestone(submitted.milestoneId);
  assert.equal(milestone.status, "PLANNED");
  assert.ok(milestone.provenance.includes(OWNER_TEXT), "the milestone lost the Owner's exact words");
  assert.ok(milestone.authorityEnvelopeId, "the milestone claims no envelope");
  record("MILESTONE_TRACES_TO_OWNER_TEXT", "PASS");
  record("CLAIMED_ENVELOPE", milestone.authorityEnvelopeId);
  void stored;

  // Repeating the same goal, from a fresh control, must converge rather than accumulate.
  const repeat = goals().submit(OWNER_TEXT);
  assert.equal(repeat.created, false);
  assert.equal(repeat.milestoneId, submitted.milestoneId);
  assert.equal(roadmap().status().total, 1, "a repeated goal duplicated roadmap work");
  record("DUPLICATE_GOAL_CREATES_DUPLICATE_WORK", "NO");

  /* ------------------------------------------------------------------------ */
  /* Inherited authority runs it, with no Owner prompt                        */
  /* ------------------------------------------------------------------------ */

  assert.equal(submitted.canBeginAutomatically, true, "a covered goal was reported as needing an Owner decision");
  record("ROUTINE_CHILD_AUTHORITY_INHERITANCE", "PASS");

  const advanced = roadmap().continueRoadmap();
  assert.deepEqual([...advanced.completed], [submitted.milestoneId], `the goal milestone did not complete: ${advanced.detail}`);
  assert.deepEqual([...advanced.gated], [], "an inherited routine child was gated");
  assert.equal(advanced.ownerPrompts, 0);
  record("ROUTINE_CHILD_OWNER_PROMPTS", advanced.ownerPrompts);
  record("OWNER_NATURAL_LANGUAGE_TO_AUTONOMOUS_EXECUTION", "PASS");

  const job = jobFor(submitted.milestoneId);
  assert.ok(job !== null, "no durable job record");
  assert.equal(job.status, "SUCCEEDED");
  assert.equal(job.activeProvider, "local");
  assert.equal(job.externalEffectState, "NONE");
  assert.equal(job.attempts.reduce((total, attempt) => total + (attempt.cost ?? 0), 0), 0);
  record("PROVIDER_SELECTED", job.activeProvider);
  record("OWNER_MANUAL_PROVIDER_SELECTION_REQUIRED", "NO");
  record("SPEND_USD", 0);

  /* ------------------------------------------------------------------------ */
  /* Restart changes nothing                                                  */
  /* ------------------------------------------------------------------------ */

  const restarted = roadmap();
  const again = restarted.continueRoadmap();
  assert.deepEqual([...again.completed], [], "completed work was re-run after restart");
  assert.equal(jobFor(submitted.milestoneId).updatedAt, job.updatedAt, "the job record changed on restart");
  assert.equal(createFileRoadmapStore(paths.storeRoot).loadMilestone(submitted.milestoneId).status, "COMPLETED");
  const afterRestart = goals().submit(OWNER_TEXT);
  assert.equal(afterRestart.created, false, "the same goal recreated work after restart");
  assert.equal(roadmap().status().total, 1);
  record("RESTART_REPEATED_COMPLETED_WORK", "NO");
  record("RESTART_DUPLICATED_GOAL", "NO");

  /* ------------------------------------------------------------------------ */
  /* Boundaries still hold                                                    */
  /* ------------------------------------------------------------------------ */

  const store = createFileRoadmapStore(paths.storeRoot);
  const seedGate = (id, patch) => {
    store.saveMilestone({
      ...store.loadMilestone(submitted.milestoneId),
      ...patch,
      milestoneId: id,
      status: "PLANNED",
      attempts: 0,
      blockedReason: null,
    });
    const roadmapNow = store.loadRoadmap();
    store.saveRoadmap({ ...roadmapNow, milestoneIds: store.listMilestones().map((m) => m.milestoneId) });
    const outcome = roadmap().continueRoadmap();
    return { gated: outcome.gated.includes(id), dispatched: jobFor(id) !== null };
  };

  const gateChecks = [
    ["SPEND_EXPANSION_REQUIRES_OWNER_GATE", "gate-spend", { spendCapUsd: 25 }],
    ["SENSITIVE_DATA_EXPANSION_REQUIRES_OWNER_GATE", "gate-sensitive", { sensitivityClass: "CONFIDENTIAL" }],
    ["WRITE_DOMAIN_EXPANSION_REQUIRES_OWNER_GATE", "gate-write", { writeDomains: ["private"] }],
    ["IRREVERSIBLE_EXTERNAL_EFFECT_GATE", "gate-irreversible", { externalEffectClass: "IRREVERSIBLE_EXTERNAL", reversibilityClass: "IRREVERSIBLE" }],
    ["OAUTH_REQUIRES_OWNER_GATE", "gate-oauth", { riskClasses: ["SECURITY_OR_PRIVACY"] }],
    ["NEW_OBJECTIVE_REQUIRES_OWNER_GATE", "gate-new-objective", { derivedFromObjective: "something the Owner never approved" }],
    ["FORGED_ENVELOPE_FAILS_CLOSED", "gate-forged", { authorityEnvelopeId: "ENVELOPE-invented-by-aion" }],
  ];
  for (const [label, id, patch] of gateChecks) {
    const outcome = seedGate(id, patch);
    assert.equal(outcome.dispatched, false, `${label}: the milestone was dispatched`);
    record(label, "PASS");
  }

  record("AION_CAN_BROADEN_OWN_AUTHORITY", "NO");
  record("OWNER_REPEATED_FOUNDER_AUTH_REQUIRED_FOR_ROUTINE_CHILDREN", "NO");
  record("OWNER_MANUAL_CLAUDE_PROMPT_REQUIRED_FOR_ROUTINE_WORK", "NO");

  const headAfter = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(headAfter, HEAD, "the acceptance run moved HEAD");
  record("REPOSITORY_HEAD_UNCHANGED", "PASS");
  record("PRODUCTION_ROADMAP_TOUCHED", "NO");
  record("EXTERNAL_EFFECTS", "NONE");
  record("PUBLIC_EXPOSURE_CREATED", "NO");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log("AION OWNER CONTROL LOOP ACCEPTANCE");
for (const line of results) console.log(line);
