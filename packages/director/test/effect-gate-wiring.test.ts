/**
 * The gate is now on the path, and this is what proves it rather than asserting it.
 *
 * V0.1 built the deterministic effect gate and left every execution path outside it behind a
 * temporary wiring exception. An independent review named that for what it was: until a real path
 * runs through `executeAuthorizedEffect`, the hard-boundary claim is aspirational.
 *
 * The bounded local executor is that path. Its two artifact writes used to be bare `writeFile` calls;
 * they are one authorised effect now. Every test below drives the *real* adapter — not the contract
 * in isolation — and the ones that matter most are the negatives: when authority is absent, narrowed,
 * revoked or pointed somewhere else, nothing is written at all.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  MVA_MILESTONE_ID,
  MVA_OWNER_AUTHORIZATION_ID,
  buildJobEnvelope,
  closedEffectGate,
  createRealBoundedExecutorAdapter,
  jobArtifactEffectRequest,
  memoryEffectJournal,
  type JobRequestV1,
} from "../src/mva-dispatch.js";
import {
  DIRECTOR_CAPABILITY_REGISTRY_V1,
  type CapabilityRegistryV1,
  type EffectGateDepsV1,
  authorizeEffect,
  executeAuthorizedEffect,
  issueAuthorization,
} from "../src/pre-action-effect-contract.js";
import {
  ROADMAP_ENVELOPE_SCHEMA_V1,
  type OwnerRoadmapAuthorityEnvelopeV1,
} from "../src/roadmap-authority-envelope.js";

const NOW = "2026-08-20T00:00:00Z";
const SHA = "17b012b28d911fe563aab19f6e4a697a05b9b718";
const ROOT = "C:\\shadow\\artifacts";
const ENVELOPE_ID = `ENVELOPE-${MVA_OWNER_AUTHORIZATION_ID}`;

function envelope(overrides: Partial<OwnerRoadmapAuthorityEnvelopeV1> = {}): OwnerRoadmapAuthorityEnvelopeV1 {
  return {
    schema: ROADMAP_ENVELOPE_SCHEMA_V1,
    envelopeId: ENVELOPE_ID,
    ownerAuthorizationId: MVA_OWNER_AUTHORIZATION_ID,
    approvedParentMilestoneIds: [MVA_MILESTONE_ID],
    approvedObjectives: [],
    allowedWriteDomains: ["artifacts"],
    allowedProviders: ["local", "codex", "grok", "claude"],
    sensitivityCeiling: "INTERNAL",
    spendCeilingUsd: 0,
    allowedExternalEffectClasses: ["REPOSITORY_REVERSIBLE"],
    requiresReversible: true,
    productionWriterPermission: "NO",
    destructiveActionPermission: "NO",
    securityChangePermission: "NO",
    oauthConsentPermission: "NO",
    sensitiveDataPermission: "NO",
    state: "ACTIVE",
    expiresAtUtc: "",
    supersededBy: "",
    alwaysGatedBoundaries: [],
    provenance: "fixture",
    version: 1,
    createdAtUtc: NOW,
    ...overrides,
  };
}

function gate(overrides: Partial<EffectGateDepsV1> = {}): EffectGateDepsV1 {
  return {
    registry: DIRECTOR_CAPABILITY_REGISTRY_V1,
    resolveTarget: (targetType: string, targetId: string) =>
      targetType === "JobArtifact"
        ? { targetType, targetId, sensitivity: "INTERNAL" as const, writeDomain: "artifacts" }
        : null,
    envelopeFor: (id: string) => (id === ENVELOPE_ID ? envelope() : null),
    ownerId: "daniel",
    now: NOW,
    ...overrides,
  };
}

function jobRequest(): JobRequestV1 {
  return {
    jobId: "job-effect-wiring",
    objective: "Write the bounded artifact",
    jobClass: "REPOSITORY_REVERSIBLE",
    repository: "C:\\AION-HQ-main-integrate",
    worktree: "C:\\AION-HQ-main-integrate",
    allowedPaths: ["packages/"],
    expectedArtifact: "result.md",
    startingSha: SHA,
    sensitiveDataClass: "INTERNAL",
  };
}

/** A recording io pair, so "did anything get written" is answerable rather than inferred. */
function recorder() {
  const writes: { path: string; contents: string }[] = [];
  const files = new Map<string, string>();
  const decisions: string[] = [];
  return {
    writes,
    decisions,
    writeFile: (path: string, contents: string) => { writes.push({ path, contents }); files.set(path, contents); },
    readFile: (path: string) => files.get(path) ?? "",
    recordDecision: (line: string) => { decisions.push(line); },
  };
}

function adapterWith(io: ReturnType<typeof recorder>, deps: Partial<{ effectGate: EffectGateDepsV1 }> = {}) {
  return createRealBoundedExecutorAdapter("local", {
    artifactRoot: ROOT,
    writeFile: io.writeFile,
    readFile: io.readFile,
    startingSha: SHA,
    effectGate: deps.effectGate ?? gate(),
    actorId: "aion.director.mva-dispatch",
    authorityEnvelopeId: ENVELOPE_ID,
    parentMilestoneId: MVA_MILESTONE_ID,
    journal: memoryEffectJournal(),
    recordDecision: io.recordDecision,
  });
}

const envelopeFor = () => buildJobEnvelope(jobRequest(), NOW);

/* -------------------------------------------------------------------------- */
/* A + B. The real path reaches the gate, and covered work still runs         */
/* -------------------------------------------------------------------------- */

test("the bounded executor's writes go through the effect gate", () => {
  const io = recorder();
  const result = adapterWith(io).execute(envelopeFor());

  assert.equal(result.class, "SUCCESS");
  assert.equal(io.writes.length, 2, "bootstrap and artifact should both be written");
  assert.equal(io.decisions.length, 1, "the decision must be recorded");
  const decision = JSON.parse(io.decisions[0]!) as Record<string, unknown>;
  assert.equal(decision.decision, "ALLOW");
  assert.equal(decision.reasonCode, "ALLOW_ROUTINE_IN_SCOPE");
  assert.equal(decision.capabilityId, "Director.WriteJobArtifact");
  assert.equal(decision.actorId, "aion.director.mva-dispatch");
});

/* -------------------------------------------------------------------------- */
/* C, F, G. Without authority, nothing is written at all                      */
/* -------------------------------------------------------------------------- */

test("a dispatch with no authority behind it writes nothing", () => {
  // `closedEffectGate` is what a caller gets when it supplies no envelope. It must not degrade to
  // "skip authorisation"; it degrades to "authorises nothing".
  const io = recorder();
  const result = adapterWith(io, { effectGate: closedEffectGate(NOW) }).execute(envelopeFor());

  assert.equal(result.class, "POLICY_DENIED");
  assert.deepEqual(io.writes, [], "a refused effect must not write");
  assert.equal(JSON.parse(io.decisions[0]!).decision, "DENY");
});

test("authority revoked before dispatch stops the write", () => {
  const io = recorder();
  const revoked = gate({ envelopeFor: () => envelope({ state: "REVOKED" }) });
  const result = adapterWith(io, { effectGate: revoked }).execute(envelopeFor());

  assert.equal(result.class, "POLICY_DENIED");
  assert.deepEqual(io.writes, []);
  assert.equal(JSON.parse(io.decisions[0]!).reasonCode, "DENY_REVOKED_AUTHORITY");
});

test("authority narrowed to another write domain stops the write", () => {
  const io = recorder();
  const narrowed = gate({ envelopeFor: () => envelope({ allowedWriteDomains: ["docs"] }) });
  const result = adapterWith(io, { effectGate: narrowed }).execute(envelopeFor());

  assert.equal(result.class, "POLICY_DENIED");
  assert.deepEqual(io.writes, []);
  assert.equal(JSON.parse(io.decisions[0]!).reasonCode, "DENY_TARGET_OUTSIDE_SCOPE");
});

test("a registry without the capability stops the write", () => {
  const io = recorder();
  const empty: CapabilityRegistryV1 = { policyVersion: DIRECTOR_CAPABILITY_REGISTRY_V1.policyVersion, capabilities: [] };
  const result = adapterWith(io, { effectGate: gate({ registry: empty }) }).execute(envelopeFor());

  assert.equal(result.class, "POLICY_DENIED");
  assert.deepEqual(io.writes, []);
  assert.equal(JSON.parse(io.decisions[0]!).reasonCode, "DENY_UNKNOWN_CAPABILITY");
});

test("an unresolvable target stops the write", () => {
  const io = recorder();
  const blind = gate({ resolveTarget: () => null });
  const result = adapterWith(io, { effectGate: blind }).execute(envelopeFor());

  assert.equal(result.class, "POLICY_DENIED");
  assert.deepEqual(io.writes, []);
  assert.equal(JSON.parse(io.decisions[0]!).reasonCode, "DENY_UNKNOWN_TARGET");
});

/* -------------------------------------------------------------------------- */
/* D + E. The dispatched effect is the authorised one                         */
/* -------------------------------------------------------------------------- */

test("the request this path builds cannot be swapped between authorisation and dispatch", () => {
  /*
   * The adapter derives its request from the job envelope, so a caller cannot hand it a different
   * target. This proves the layer beneath still refuses if anything ever could: authorise the real
   * artifact write, then try to dispatch a different target and a different argument set with the
   * receipt that was issued.
   */
  const base = jobArtifactEffectRequest({
    envelope: envelopeFor(),
    providerId: "local",
    parentMilestoneId: MVA_MILESTONE_ID,
    actorId: "aion.director.mva-dispatch",
    ownerId: "daniel",
    authorityEnvelopeId: ENVELOPE_ID,
    artifactPath: `${ROOT}\\result.md`,
    now: NOW,
  });
  const { decision, receipt } = issueAuthorization(base, gate());
  assert.equal(decision.outcome, "ALLOW");

  let performed = 0;
  const journal = memoryEffectJournal();

  const otherTarget = { ...base, targetId: `${ROOT}\\somewhere-else.md` };
  const swapped = executeAuthorizedEffect(otherTarget, receipt, gate(), () => { performed += 1; return null; }, journal);
  assert.equal(swapped.executed, false);
  assert.equal(swapped.decision.reasonCode, "DENY_REQUEST_CHANGED_AFTER_AUTHORIZATION");

  const otherArgs = { ...base, args: { jobId: "another-job", expectedArtifact: "result.md" } };
  const rewritten = executeAuthorizedEffect(otherArgs, receipt, gate(), () => { performed += 1; return null; }, journal);
  assert.equal(rewritten.executed, false);
  assert.equal(rewritten.decision.reasonCode, "DENY_REQUEST_CHANGED_AFTER_AUTHORIZATION");

  assert.equal(performed, 0, "a substituted effect was dispatched");
});

test("the effect request carries the job's own authority, not the provider's word for it", () => {
  const request = jobArtifactEffectRequest({
    envelope: envelopeFor(),
    providerId: "grok",
    parentMilestoneId: MVA_MILESTONE_ID,
    actorId: "aion.director.mva-dispatch",
    ownerId: "daniel",
    authorityEnvelopeId: ENVELOPE_ID,
    artifactPath: `${ROOT}\\result.md`,
    now: NOW,
  });
  assert.equal(request.ownerAuthorizationId, MVA_OWNER_AUTHORIZATION_ID);
  assert.equal(request.parentMilestoneId, MVA_MILESTONE_ID);
  assert.equal(request.capabilityId, "Director.WriteJobArtifact");
  assert.equal(request.proposedByProvider, "grok");
  // Provider identity is audit, never authority: every provider gets the same decision.
  const outcomes = new Set(
    ["local", "codex", "grok", "claude"].map((id) =>
      authorizeEffect({ ...request, proposedByProvider: id }, gate()).outcome),
  );
  assert.equal(outcomes.size, 1);
});

/* -------------------------------------------------------------------------- */
/* Audit privacy on the wired path                                            */
/* -------------------------------------------------------------------------- */

test("the decision log records the effect without copying the artifact", () => {
  const io = recorder();
  adapterWith(io).execute(envelopeFor());

  const line = io.decisions[0]!;
  const artifact = io.writes.find((w) => w.path.endsWith("result.md"));
  assert.notEqual(artifact, undefined);
  assert.ok(artifact!.contents.length > 0);
  assert.equal(line.includes(artifact!.contents), false, "the decision log copied the artifact body");
  assert.match(JSON.parse(line).argumentFingerprint as string, /^[0-9a-f]{64}$/);
});
