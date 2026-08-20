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
import { readFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
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
  authorityIsWithin,
  effectAuthoritiesFromOwnerRecords,
  effectAuthorityEnvelopeId,
  effectAuthorityFromOwnerRecord,
} from "../src/job-frozen-authority.js";
import {
  ROADMAP_ENVELOPE_SCHEMA_V1,
  type OwnerRoadmapAuthorityEnvelopeV1,
} from "../src/roadmap-authority-envelope.js";

const repositoryRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
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

/**
 * The milestone -> authority resolution the control plane performs, in fixture form.
 *
 * Static in these suites because they exercise one milestone; Campaign 01 and the discovery harness
 * are where the multi-milestone matrix lives.
 */
function authorityForMilestoneFixture() {
  return {
    ownerAuthorizationId: MVA_OWNER_AUTHORIZATION_ID,
    envelopeId: ENVELOPE_ID,
    parentMilestoneId: MVA_MILESTONE_ID,
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
    authorityForMilestone: () => authorityForMilestoneFixture(),
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
    ownerAuthorizationId: MVA_OWNER_AUTHORIZATION_ID,
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
    ownerAuthorizationId: MVA_OWNER_AUTHORIZATION_ID,
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

/* -------------------------------------------------------------------------- */
/* Authority provenance: execution resolves authority, it does not make it    */
/* -------------------------------------------------------------------------- */

/*
 * V0.2 let the executing job publish the authority record that then authorised it. An independent
 * review classified that as SELF_ASSERTED_JOB_AUTHORITY and was right: the approved parent was the
 * job's own milestone id, so the lineage closed on itself and the gate was checking a mirror.
 *
 *     AUTHORITY MUST EXIST BEFORE EXECUTION.
 *
 * Authority now comes from `effectAuthorityFromOwnerRecord`, whose only input is a durable Owner
 * record. Nothing about a job reaches it. These tests pin that from both sides: the projection
 * narrows and never widens, and the execution path has no way to produce one.
 */

test("the execution path cannot create or publish authority", () => {
  const source = readFileSync(join(repositoryRoot, "packages", "director", "src", "mva-dispatch.ts"), "utf8");
  // The publication hook is gone, not renamed.
  assert.equal(source.includes("publishFrozenAuthority"), false);
  assert.equal(source.includes("jobFrozenAuthority"), false);
  // And the dispatch module cannot build an authority envelope at all.
  assert.equal(source.includes("effectAuthorityFromOwnerRecord"), false);
  assert.equal(source.includes("OwnerRoadmapAuthorityEnvelopeV1"), false);
});

test("authority is projected from an Owner record and never from a job", () => {
  const record = {
    ownerAuthorizationId: "OWNER-RECORD-V1",
    milestoneId: "OWNER-MILESTONE-V1",
    allowedWriteDomains: [".aion-local", "apps", "governance"],
    allowedProviders: ["local"],
    state: "ACTIVE",
    createdAtUtc: NOW,
  };
  const projected = effectAuthorityFromOwnerRecord(record);
  assert.notEqual(projected, null);
  // The approved parent is the Owner's milestone, not anything a job supplies.
  assert.deepEqual(projected!.approvedParentMilestoneIds, ["OWNER-MILESTONE-V1"]);
  assert.equal(projected!.ownerAuthorizationId, "OWNER-RECORD-V1");
  // Narrowed on every axis: only artifact domains survive, and no permission is carried across.
  assert.deepEqual(projected!.allowedWriteDomains, [".aion-local"]);
  assert.equal(projected!.sensitivityCeiling, "INTERNAL");
  assert.equal(projected!.spendCeilingUsd, 0);
  assert.equal(projected!.requiresReversible, true);
  assert.deepEqual(projected!.allowedExternalEffectClasses, ["REPOSITORY_REVERSIBLE"]);
  for (const permission of ["productionWriterPermission", "destructiveActionPermission",
    "securityChangePermission", "oauthConsentPermission", "sensitiveDataPermission"] as const) {
    assert.equal(projected![permission], "NO", permission);
  }
});

test("a record that authorises no artifact write projects nothing", () => {
  // Absence of authority must read as absence, never as a permissive default.
  for (const record of [
    null, undefined, {}, { ownerAuthorizationId: "X" }, { milestoneId: "M" },
    { ownerAuthorizationId: "X", milestoneId: "M", allowedWriteDomains: [] },
    { ownerAuthorizationId: "X", milestoneId: "M", allowedWriteDomains: ["production"] },
  ]) {
    assert.equal(effectAuthorityFromOwnerRecord(record as never), null, JSON.stringify(record));
  }
});

test("a revoked, suspended or stateless Owner record authorises nothing", () => {
  const base = {
    ownerAuthorizationId: "OWNER-RECORD-V1", milestoneId: "OWNER-MILESTONE-V1",
    allowedWriteDomains: [".aion-local"], allowedProviders: ["local"], createdAtUtc: NOW,
  };
  assert.equal(effectAuthorityFromOwnerRecord({ ...base, state: "REVOKED" })!.state, "REVOKED");
  assert.equal(effectAuthorityFromOwnerRecord({ ...base, state: "SUSPENDED" })!.state, "REVOKED");
  assert.equal(effectAuthorityFromOwnerRecord({ ...base })!.state, "REVOKED", "an absent state is not ACTIVE");
});

test("a child may narrow authority and may not widen it", () => {
  const parent = effectAuthorityFromOwnerRecord({
    ownerAuthorizationId: "OWNER-RECORD-V1", milestoneId: "OWNER-MILESTONE-V1",
    allowedWriteDomains: [".aion-local", "artifacts"], allowedProviders: ["local"],
    state: "ACTIVE", createdAtUtc: NOW,
  })!;

  // Narrowing is fine.
  assert.equal(authorityIsWithin({ ...parent, allowedWriteDomains: [".aion-local"] }, parent), true);
  assert.equal(authorityIsWithin({ ...parent, sensitivityCeiling: "PUBLIC" }, parent), true);
  assert.equal(authorityIsWithin(parent, parent), true);

  // Every widening axis is refused.
  for (const widened of [
    { ...parent, allowedWriteDomains: [...parent.allowedWriteDomains, "production"] },
    { ...parent, sensitivityCeiling: "RESTRICTED" as const },
    { ...parent, spendCeilingUsd: 100 },
    { ...parent, requiresReversible: false },
    { ...parent, allowedExternalEffectClasses: ["IRREVERSIBLE_EXTERNAL" as const] },
    { ...parent, approvedParentMilestoneIds: ["SOME-OTHER-MILESTONE"] },
    { ...parent, destructiveActionPermission: "YES" as const },
    { ...parent, oauthConsentPermission: "YES" as const },
    { ...parent, ownerAuthorizationId: "A-DIFFERENT-AUTHORIZATION" },
  ]) {
    assert.equal(authorityIsWithin(widened, parent), false, JSON.stringify(Object.keys(widened)));
  }
});

test("a job naming an authority that does not exist writes nothing", () => {
  /*
   * Recovery and restart go through the same door: a job carries the *id* of the authorization it
   * acts under, and that id is resolved against durable records. It is a reference, never a
   * permission — so nothing can be reconstructed from job text, a cached objective or a provider
   * response.
   */
  const records = [{
    ownerAuthorizationId: MVA_OWNER_AUTHORIZATION_ID, milestoneId: MVA_MILESTONE_ID,
    allowedWriteDomains: [".aion-local"], allowedProviders: ["local"], state: "ACTIVE", createdAtUtc: NOW,
  }];
  const authorities = effectAuthoritiesFromOwnerRecords(records);
  const resolveReference = (ownerAuthorizationId: string) => {
    const found = authorities.get(effectAuthorityEnvelopeId(ownerAuthorizationId));
    return found === undefined ? null : { envelopeId: found.envelopeId, parentMilestoneId: found.approvedParentMilestoneIds[0]! };
  };

  const io = recorder();
  const gateWithRecords: EffectGateDepsV1 = {
    ...gate(),
    envelopeFor: (id: string) => authorities.get(id) ?? null,
    resolveTarget: (targetType: string, targetId: string) =>
      targetType === "JobArtifact" ? { targetType, targetId, sensitivity: "INTERNAL" as const, writeDomain: ".aion-local" } : null,
  };
  const adapter = createRealBoundedExecutorAdapter("local", {
    artifactRoot: ROOT, writeFile: io.writeFile, readFile: io.readFile, startingSha: SHA,
    effectGate: gateWithRecords, actorId: "aion.director.mva-dispatch",
    // This test builds its own record set, so it resolves against that rather than the outer fixture.
    authorityForMilestone: (milestoneId: string) => {
      if (milestoneId !== MVA_MILESTONE_ID) return null;
      const projected = authorities.get(effectAuthorityEnvelopeId(MVA_OWNER_AUTHORIZATION_ID));
      if (projected === undefined) return null;
      return {
        ownerAuthorizationId: projected.ownerAuthorizationId,
        envelopeId: projected.envelopeId,
        parentMilestoneId: projected.approvedParentMilestoneIds[0] ?? "",
      };
    },
    journal: memoryEffectJournal(), recordDecision: io.recordDecision,
  });

  // The job cites an authorization nobody granted: the reference resolves to nothing.
  const unknown = { ...envelopeFor(), ownerAuthorizationId: "INVENTED-AUTHORIZATION-V9" };
  assert.equal(adapter.execute(unknown).class, "POLICY_DENIED");
  assert.deepEqual(io.writes, []);

  // The same job citing the real authorization writes, because the record exists and is ACTIVE.
  const known = { ...envelopeFor(), ownerAuthorizationId: MVA_OWNER_AUTHORIZATION_ID, milestoneId: MVA_MILESTONE_ID };
  assert.equal(adapter.execute(known).class, "SUCCESS");
  assert.equal(io.writes.length, 2);
});

/* -------------------------------------------------------------------------- */
/* The control plane pins the authorization; the job does not choose it       */
/* -------------------------------------------------------------------------- */

/*
 * V0.3 resolved whatever authorization id the job envelope carried. A verification pass showed what
 * that permits — every one of these executed and wrote two files:
 *
 *     Job A executing under Authority B
 *     a child using a sibling's authority
 *     a persisted envelope edited on disk to name another valid record
 *
 * The gate was not wrong about what it checked; it checked that the citation matched the record
 * cited, and found them consistent. Nothing bound a job to *its own* authority.
 *
 *     THE CONTROL PLANE, NOT THE JOB, DETERMINES THE AUTHORIZATION FOR A DISPATCH.
 *
 * Each test below observes whether files were written, not whether a symbol exists — the defect these
 * replace was invisible to a green suite, and a test that only checks structure would have stayed
 * green through it.
 */

const AUTH_A = "AUTH-PINNING-A";
const AUTH_B = "AUTH-PINNING-B";
const AUTH_REVOKED = "AUTH-PINNING-REVOKED";

function ownerRecord(id: string, milestone: string, state = "ACTIVE") {
  return {
    ownerAuthorizationId: id, milestoneId: milestone,
    allowedWriteDomains: [".aion-local"], allowedProviders: ["local"],
    state, createdAtUtc: NOW,
  };
}

const PINNING_RECORDS = [
  ownerRecord(AUTH_A, "MILESTONE-PINNING-A"),
  ownerRecord(AUTH_B, "MILESTONE-PINNING-B"),
  ownerRecord(AUTH_REVOKED, "MILESTONE-PINNING-R", "REVOKED"),
];

/** An adapter pinned to one authorization, exactly as the control plane builds it. */
function pinnedAdapter(io: ReturnType<typeof recorder>, pinned: string, envelopeId?: string) {
  const authorities = effectAuthoritiesFromOwnerRecords(PINNING_RECORDS);
  const pinnedEnvelope = authorities.get(effectAuthorityEnvelopeId(pinned));
  return createRealBoundedExecutorAdapter("local", {
    artifactRoot: ROOT, writeFile: io.writeFile, readFile: io.readFile, startingSha: SHA,
    effectGate: {
      ...gate(),
      envelopeFor: (id: string) => authorities.get(id) ?? null,
      resolveTarget: (targetType: string, targetId: string) =>
        targetType === "JobArtifact" ? { targetType, targetId, sensitivity: "INTERNAL" as const, writeDomain: ".aion-local" } : null,
    },
    actorId: "aion.director.mva-dispatch",
    // These tests deliberately force one authority for the dispatch, which is how they reproduce the
    // substitution attempts; resolution per milestone is covered by the Finding 1 tests below.
    authorityForMilestone: () => pinnedEnvelope === undefined ? null : ({
      ownerAuthorizationId: pinnedEnvelope.ownerAuthorizationId,
      envelopeId: envelopeId ?? pinnedEnvelope.envelopeId,
      parentMilestoneId: pinnedEnvelope.approvedParentMilestoneIds[0] ?? "",
    }),
    journal: memoryEffectJournal(), recordDecision: io.recordDecision,
  });
}

/** A job envelope claiming to act under some authorization. */
function jobClaiming(ownerAuthorizationId: string, milestoneId = "MILESTONE-PINNING-A") {
  return { ...envelopeFor(), ownerAuthorizationId, milestoneId };
}

test("a job whose authority matches the pin writes", () => {
  const io = recorder();
  const result = pinnedAdapter(io, AUTH_A).execute(jobClaiming(AUTH_A));
  assert.equal(result.class, "SUCCESS");
  assert.equal(io.writes.length, 2, "legitimate work must still happen");
});

test("a job claiming another valid authority writes nothing", () => {
  // The headline defect: Authority B is real, active and would permit an artifact write for its own
  // jobs. It is not this job's, and that is now the whole answer.
  const io = recorder();
  const result = pinnedAdapter(io, AUTH_A).execute(jobClaiming(AUTH_B));
  assert.equal(result.class, "POLICY_DENIED");
  assert.deepEqual(io.writes, [], "a substituted authority produced a write");
  assert.equal(JSON.parse(io.decisions[0]!).reasonCode, "DENY_AUTHORIZATION_NOT_PINNED");
});

test("a child claiming a sibling's authority writes nothing", () => {
  const io = recorder();
  const child = { ...jobClaiming(AUTH_B, "MILESTONE-PINNING-A"), jobId: "child-of-a" };
  assert.equal(pinnedAdapter(io, AUTH_A).execute(child).class, "POLICY_DENIED");
  assert.deepEqual(io.writes, []);
});

test("a recovered job whose persisted envelope was altered writes nothing", () => {
  /*
   * The recovery path reloads `record.envelope` from disk. A self-consistent edit — both the
   * authorization and the milestone swapped, so the citation matches the record it names — is exactly
   * what V0.3 accepted. Reconciliation against the pin is what refuses it.
   */
  const io = recorder();
  const persisted = JSON.stringify({ ...envelopeFor(), ownerAuthorizationId: AUTH_B, milestoneId: "MILESTONE-PINNING-B" });
  const reloaded = JSON.parse(persisted) as ReturnType<typeof envelopeFor>;
  assert.equal(pinnedAdapter(io, AUTH_A).execute(reloaded).class, "POLICY_DENIED");
  assert.deepEqual(io.writes, [], "a tampered persisted envelope produced a write");
});

test("a revoked or unpinnable authority writes nothing", () => {
  for (const [label, pinned] of [["revoked", AUTH_REVOKED], ["not a record", "AUTH-NOBODY-GRANTED"]] as const) {
    const io = recorder();
    const result = pinnedAdapter(io, pinned).execute(jobClaiming(pinned));
    assert.equal(result.class, "POLICY_DENIED", label);
    assert.deepEqual(io.writes, [], label);
  }
});

test("a job request cannot influence the authorization at all", () => {
  /*
   * The other half: even before pinning, `buildJobEnvelope` stamps the authorization from a constant
   * it owns. A request asking for another one is ignored rather than honoured.
   */
  const hostile = { ...jobRequest(), ownerAuthorizationId: AUTH_B, milestoneId: "MILESTONE-PINNING-B" } as never;
  const built = buildJobEnvelope(hostile, NOW);
  assert.notEqual(built.ownerAuthorizationId, AUTH_B, "a request chose its own authorization");
  assert.equal(built.ownerAuthorizationId, MVA_OWNER_AUTHORIZATION_ID);
  assert.equal(built.milestoneId, MVA_MILESTONE_ID);
});

test("the dispatch module has no way to select an authorization", () => {
  // Behavioural checks above are the point; this pins that the removed seam has not returned under
  // another name, which is how the previous version of this defect was reintroduced once already.
  const source = readFileSync(join(repositoryRoot, "packages", "director", "src", "mva-dispatch.ts"), "utf8");
  assert.equal(source.includes("resolveAuthorityReference"), false);
  assert.equal(source.includes("publishFrozenAuthority"), false);
  assert.equal(source.includes("OwnerRoadmapAuthorityEnvelopeV1"), false);
});

/* -------------------------------------------------------------------------- */
/* Finding 1: authority belongs to the milestone, not to the dispatch path     */
/* -------------------------------------------------------------------------- */

/*
 * Discovery Campaign 01 measured what the previous design cost: seven over-grants and fourteen
 * writes, plus twenty-four mirror under-grants. The clearest case was a job whose own Owner authority
 * permitted *no* write domain writing two artifacts under a broader record, with the gate recording
 * ALLOW_ROUTINE_IN_SCOPE.
 *
 * The gate was never wrong. It enforced the record it was handed; the wrong record was handed to it,
 * because one module-level authorization served every milestone. Authority is now resolved per
 * milestone from durable Owner records, and a job that cites an authorization its milestone does not
 * hold is refused.
 *
 * Every test below judges by observed writes.
 */

const LINEAGE_RECORDS = [
  { id: "LIN-AUTH-LOCAL", milestone: "LIN-MILESTONE-LOCAL", domains: [".aion-local"] },
  { id: "LIN-AUTH-BOTH", milestone: "LIN-MILESTONE-BOTH", domains: [".aion-local", "docs"] },
  { id: "LIN-AUTH-DOCS", milestone: "LIN-MILESTONE-DOCS", domains: ["docs"] },
  { id: "LIN-AUTH-NONE", milestone: "LIN-MILESTONE-NONE", domains: [] },
];

function lineageAuthorities() {
  return effectAuthoritiesFromOwnerRecords(LINEAGE_RECORDS.map((r) => ({
    ownerAuthorizationId: r.id, milestoneId: r.milestone, allowedWriteDomains: r.domains,
    allowedProviders: ["local"], state: "ACTIVE", createdAtUtc: NOW,
  })));
}

/** The control plane's resolution: milestone -> its own authorization -> the projected envelope. */
function lineageResolver(authorities: ReturnType<typeof lineageAuthorities>, overrides: { revoked?: boolean } = {}) {
  return (milestoneId: string) => {
    const record = LINEAGE_RECORDS.find((r) => r.milestone === milestoneId);
    if (record === undefined) return null;
    const projected = authorities.get(effectAuthorityEnvelopeId(record.id));
    if (projected === undefined) return null;
    return { ownerAuthorizationId: projected.ownerAuthorizationId, envelopeId: projected.envelopeId, parentMilestoneId: projected.approvedParentMilestoneIds[0] ?? "" };
  };
}

function lineageRun(input: { milestone: string; claims: string; revoked?: boolean }) {
  const authorities = lineageAuthorities();
  const io = recorder();
  const adapter = createRealBoundedExecutorAdapter("local", {
    artifactRoot: ROOT, writeFile: io.writeFile, readFile: io.readFile, startingSha: SHA,
    effectGate: {
      ...gate(),
      envelopeFor: (id: string) => {
        const found = authorities.get(id);
        if (found === undefined) return null;
        return input.revoked === true ? { ...found, state: "REVOKED" as const } : found;
      },
      resolveTarget: (targetType: string, targetId: string) =>
        targetType === "JobArtifact" ? { targetType, targetId, sensitivity: "INTERNAL" as const, writeDomain: ".aion-local" } : null,
    },
    actorId: "aion.director.mva-dispatch",
    authorityForMilestone: lineageResolver(authorities),
    journal: memoryEffectJournal(),
    recordDecision: io.recordDecision,
  });
  const envelope = { ...envelopeFor(), milestoneId: input.milestone, ownerAuthorizationId: input.claims };
  const result = adapter.execute(envelope);
  return { outcome: String(result.class), writes: io.writes.length, decisions: io.decisions };
}

test("a milestone writes under its own authority", () => {
  const run = lineageRun({ milestone: "LIN-MILESTONE-LOCAL", claims: "LIN-AUTH-LOCAL" });
  assert.equal(run.outcome, "SUCCESS");
  assert.equal(run.writes, 2, "correct lineage must still do its work");
});

test("a milestone whose authority permits no write domain writes nothing", () => {
  /*
   * Campaign 01's smallest counterexample, verbatim. Before the repair this wrote two artifacts under
   * a broader record and logged ALLOW_ROUTINE_IN_SCOPE.
   */
  const claiming = lineageRun({ milestone: "LIN-MILESTONE-NONE", claims: "LIN-AUTH-LOCAL" });
  assert.equal(claiming.writes, 0, "a no-domain milestone obtained a write by citing a broader record");
  assert.equal(claiming.outcome, "POLICY_DENIED");

  const honest = lineageRun({ milestone: "LIN-MILESTONE-NONE", claims: "LIN-AUTH-NONE" });
  assert.equal(honest.writes, 0, "a no-domain milestone wrote under its own record");
});

test("a job cannot borrow another milestone's authority, broader or narrower", () => {
  for (const [milestone, claims] of [
    ["LIN-MILESTONE-DOCS", "LIN-AUTH-LOCAL"],   // a docs-only milestone reaching for a local-write record
    ["LIN-MILESTONE-LOCAL", "LIN-AUTH-BOTH"],   // claims a broader sibling
    ["LIN-MILESTONE-LOCAL", "LIN-AUTH-DOCS"],   // claims an unrelated sibling
    ["LIN-MILESTONE-BOTH", "LIN-AUTH-LOCAL"],   // claims a narrower sibling
  ] as const) {
    const run = lineageRun({ milestone, claims });
    assert.equal(run.writes, 0, `${milestone} wrote while citing ${claims}`);
    assert.equal(run.outcome, "POLICY_DENIED");
  }
});

test("a milestone with no durable authority at all writes nothing", () => {
  const run = lineageRun({ milestone: "LIN-MILESTONE-UNKNOWN", claims: "LIN-AUTH-LOCAL" });
  assert.equal(run.writes, 0);
  assert.equal(run.outcome, "POLICY_DENIED");
  const reasons = run.decisions.map((line) => JSON.parse(line).reasonCode as string);
  assert.ok(reasons.includes("DENY_MILESTONE_HAS_NO_AUTHORITY"), `observed [${reasons.join(", ")}]`);
});

test("a substituted authority is refused observably, naming both sides", () => {
  // BOTH projects to a real artifact-write authority, so the refusal is about the substitution rather
  // than about the milestone having no artifact authority at all — those are different refusals.
  const run = lineageRun({ milestone: "LIN-MILESTONE-BOTH", claims: "LIN-AUTH-LOCAL" });
  const decision = JSON.parse(run.decisions[0]!) as Record<string, unknown>;
  assert.equal(decision.reasonCode, "DENY_AUTHORIZATION_NOT_PINNED");
  assert.equal(decision.milestoneId, "LIN-MILESTONE-BOTH");
  assert.equal(decision.envelopeOwnerAuthorizationId, "LIN-AUTH-LOCAL");
  assert.equal(decision.authorizationForMilestone, "LIN-AUTH-BOTH");
});

test("a recovered envelope cannot substitute authority after a disk round trip", () => {
  const authorities = lineageAuthorities();
  const io = recorder();
  const adapter = createRealBoundedExecutorAdapter("local", {
    artifactRoot: ROOT, writeFile: io.writeFile, readFile: io.readFile, startingSha: SHA,
    effectGate: {
      ...gate(),
      envelopeFor: (id: string) => authorities.get(id) ?? null,
      resolveTarget: (targetType: string, targetId: string) =>
        targetType === "JobArtifact" ? { targetType, targetId, sensitivity: "INTERNAL" as const, writeDomain: ".aion-local" } : null,
    },
    actorId: "aion.director.mva-dispatch",
    authorityForMilestone: lineageResolver(authorities),
    journal: memoryEffectJournal(),
    recordDecision: io.recordDecision,
  });
  const tampered = JSON.parse(JSON.stringify({
    ...envelopeFor(), milestoneId: "LIN-MILESTONE-NONE", ownerAuthorizationId: "LIN-AUTH-LOCAL",
  })) as ReturnType<typeof envelopeFor>;
  assert.equal(String(adapter.execute(tampered).class), "POLICY_DENIED");
  assert.deepEqual(io.writes, [], "a tampered persisted envelope produced a write");
});

test("revoked current authority refuses even with correct lineage", () => {
  const run = lineageRun({ milestone: "LIN-MILESTONE-LOCAL", claims: "LIN-AUTH-LOCAL", revoked: true });
  assert.equal(run.writes, 0);
  const reasons = run.decisions.map((line) => JSON.parse(line).reasonCode as string);
  assert.ok(reasons.includes("DENY_REVOKED_AUTHORITY"), `observed [${reasons.join(", ")}]`);
});

test("no module constant selects authority for dispatch any more", () => {
  /*
   * The seam removed, asserted by name so it cannot return quietly. `MVA_OWNER_AUTHORIZATION_ID` still
   * exists as the identity of the MVA milestone itself — that is metadata — but it no longer chooses
   * whose authority governs a write.
   */
  const source = readFileSync(join(repositoryRoot, "packages", "director", "src", "mva-dispatch.ts"), "utf8");
  assert.equal(source.includes("pinnedOwnerAuthorizationId"), false);
  const orchestrator = readFileSync(join(repositoryRoot, "packages", "director", "src", "roadmap-orchestrator.ts"), "utf8");
  assert.ok(orchestrator.includes("originMilestoneId: milestone.milestoneId"), "the orchestrator must carry milestone identity");
  assert.ok(orchestrator.includes("originOwnerAuthorizationId"), "the orchestrator must carry the milestone's authorization");
});
