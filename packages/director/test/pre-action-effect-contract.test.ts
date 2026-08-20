/**
 * The effect gate is the boundary the sentence was never able to be.
 *
 * Seven independent reviews of the consequence parser ended the same way: an unread word reached
 * `ALLOW_STANDING`. The last one is still open by design — "Update the exfiltrate parser logs."
 * inherits — and these tests exist because that no longer decides whether anything happens.
 *
 * Every test here supplies a valid envelope and a well-formed request and then breaks exactly one
 * thing, because the property under test is not "the good case works" but:
 *
 *     THE MODEL MAY PROPOSE; ONLY THE GATE MAY AUTHORISE.
 *     AUTHORISATION BINDS TO ACTOR, CAPABILITY, TARGET, ARGUMENTS, DATA CLASS AND CURRENT AUTHORITY.
 *
 * `authorizeEffect` has a single ALLOW exit, reached only by falling through every check. So the
 * self-attack is enumerable: each check below is one thing that must be able to stop it.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMO_CAPABILITY_REGISTRY_V1,
  EFFECT_REQUEST_SCHEMA_V1,
  EFFECT_RECEIPT_SCHEMA_V1,
  type CapabilityRegistryV1,
  type EffectAuthorizationReceiptV1,
  type EffectExecutionRecordV1,
  type EffectGateDepsV1,
  type EffectJournalV1,
  type EffectRequestV1,
  type TrustedTargetV1,
  auditRecordFor,
  authorizeEffect,
  canonicalArguments,
  capabilityPolicyFor,
  effectFingerprint,
  executeAuthorizedEffect,
  isIssuedReceipt,
  issueAuthorization,
  requiredPermissionsFor,
} from "../src/pre-action-effect-contract.js";
import {
  ROADMAP_ENVELOPE_SCHEMA_V1,
  type OwnerRoadmapAuthorityEnvelopeV1,
} from "../src/roadmap-authority-envelope.js";

const NOW = "2026-08-20T00:00:00Z";
const OWNER = "daniel";
const AUTH_ID = "PRE-ACTION-EFFECT-CONTRACT-V0-1-FIXTURE";
const ENVELOPE_ID = `ENVELOPE-${AUTH_ID}`;
const PARENT = "roadmap-page-usability";

function envelope(overrides: Partial<OwnerRoadmapAuthorityEnvelopeV1> = {}): OwnerRoadmapAuthorityEnvelopeV1 {
  return {
    schema: ROADMAP_ENVELOPE_SCHEMA_V1,
    envelopeId: ENVELOPE_ID,
    ownerAuthorizationId: AUTH_ID,
    approvedParentMilestoneIds: [PARENT],
    approvedObjectives: ["Improve AION Roadmap usability"],
    allowedWriteDomains: ["apps", "docs"],
    allowedProviders: ["local"],
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
    createdAtUtc: "2026-08-19T00:00:00Z",
    ...overrides,
  };
}

const TARGETS: readonly TrustedTargetV1[] = [
  { targetType: "DemoRecord", targetId: "123", sensitivity: "INTERNAL", writeDomain: "apps" },
  { targetType: "DemoRecord", targetId: "secret", sensitivity: "RESTRICTED", writeDomain: "apps" },
  { targetType: "DemoRecord", targetId: "confidential", sensitivity: "CONFIDENTIAL", writeDomain: "apps" },
  { targetType: "DemoDraft", targetId: "draft-1", sensitivity: "INTERNAL", writeDomain: "apps" },
  { targetType: "DemoDraft", targetId: "elsewhere", sensitivity: "INTERNAL", writeDomain: "production" },
  { targetType: "DemoContact", targetId: "customer123", sensitivity: "INTERNAL", writeDomain: "apps" },
  { targetType: "DemoContact", targetId: "customer999", sensitivity: "INTERNAL", writeDomain: "apps" },
];

function deps(overrides: Partial<EffectGateDepsV1> = {}): EffectGateDepsV1 {
  return {
    registry: DEMO_CAPABILITY_REGISTRY_V1,
    resolveTarget: (targetType, targetId) =>
      TARGETS.find((row) => row.targetType === targetType && row.targetId === targetId) ?? null,
    envelopeFor: (id) => (id === ENVELOPE_ID ? envelope() : null),
    ownerId: OWNER,
    now: NOW,
    ...overrides,
  };
}

function request(overrides: Partial<EffectRequestV1> = {}): EffectRequestV1 {
  return {
    schema: EFFECT_REQUEST_SCHEMA_V1,
    requestId: "req-1",
    actorId: "aion.executor.director",
    proposedByProvider: "claude",
    ownerId: OWNER,
    parentMilestoneId: PARENT,
    authorityEnvelopeId: ENVELOPE_ID,
    ownerAuthorizationId: AUTH_ID,
    capabilityId: "Demo.ReadRecord",
    capabilityVersion: 1,
    targetType: "DemoRecord",
    targetId: "123",
    args: { field: "status" },
    declaredSensitivity: "INTERNAL",
    provenance: [{ kind: "OWNER_DIRECTIVE", ref: AUTH_ID, authorityBearing: true }],
    spend: null,
    idempotencyKey: "",
    requestedAtUtc: NOW,
    ...overrides,
  };
}

/** An envelope that genuinely covers the external demo capability, for the "grant works" side. */
function externalEnvelope(): OwnerRoadmapAuthorityEnvelopeV1 {
  return envelope({
    allowedExternalEffectClasses: ["REPOSITORY_REVERSIBLE", "IRREVERSIBLE_EXTERNAL"],
    requiresReversible: false,
    spendCeilingUsd: 10,
  });
}

function sendRequest(overrides: Partial<EffectRequestV1> = {}): EffectRequestV1 {
  return request({
    requestId: "req-send",
    capabilityId: "Demo.SendExternalMessage",
    targetType: "DemoContact",
    targetId: "customer123",
    args: { body: "Your vehicle is ready" },
    spend: { amountUsd: 5, currency: "USD", budgetCategory: "messaging" },
    idempotencyKey: "send-001",
    ...overrides,
  });
}

function memoryJournal(): EffectJournalV1 {
  const rows = new Map<string, EffectExecutionRecordV1>();
  return {
    find: (key) => rows.get(key) ?? null,
    record: (entry) => { rows.set(entry.idempotencyKey, entry); },
  };
}

const allows = (r: EffectRequestV1, d = deps()): boolean => authorizeEffect(r, d).outcome === "ALLOW";

/* -------------------------------------------------------------------------- */
/* The three proof capabilities                                               */
/* -------------------------------------------------------------------------- */

test("a safe read inside standing authority executes without asking the Owner again", () => {
  // The autonomy half of the contract: covered routine work must not turn into a prompt.
  const { decision, receipt } = issueAuthorization(request(), deps());
  assert.equal(decision.outcome, "ALLOW");
  assert.equal(decision.reasonCode, "ALLOW_ROUTINE_IN_SCOPE");
  assert.notEqual(receipt, null);

  let performed = 0;
  const result = executeAuthorizedEffect(request(), receipt, deps(), () => { performed += 1; return "status=ok"; }, memoryJournal());
  assert.equal(result.executed, true);
  assert.equal(result.result, "status=ok");
  assert.equal(performed, 1);
});

test("a reversible local write inside standing authority executes", () => {
  const local = request({ requestId: "req-write", capabilityId: "Demo.WriteLocalDraft", targetType: "DemoDraft", targetId: "draft-1", args: { body: "draft" } });
  const { decision, receipt } = issueAuthorization(local, deps());
  assert.equal(decision.outcome, "ALLOW");
  const shadow: string[] = [];
  const result = executeAuthorizedEffect(local, receipt, deps(), (r) => { shadow.push(String(r.args.body)); return shadow.length; }, memoryJournal());
  assert.equal(result.executed, true);
  assert.deepEqual(shadow, ["draft"]);
});

test("an external effect needs external authority, and having it is enough", () => {
  // Without: the envelope covers repository-reversible work only.
  const withoutAuthority = authorizeEffect(sendRequest(), deps());
  assert.notEqual(withoutAuthority.outcome, "ALLOW");
  assert.equal(withoutAuthority.outcome, "OWNER_GATE");
  assert.equal(withoutAuthority.reasonCode, "GATE_NEW_EXTERNAL_EFFECT");
  assert.equal(withoutAuthority.ownerGateType, "REAL_EXTERNAL_BUSINESS_WRITE_REQUIRED");

  // With: a granted permission must remain usable, or the grant is decorative.
  const granted = deps({ envelopeFor: (id) => (id === ENVELOPE_ID ? externalEnvelope() : null) });
  const decision = authorizeEffect(sendRequest(), granted);
  assert.equal(decision.outcome, "ALLOW");
});

/* -------------------------------------------------------------------------- */
/* Language is not authority                                                  */
/* -------------------------------------------------------------------------- */

test("a classifier that wrongly says ROUTINE cannot make an uncovered effect happen", () => {
  /*
   * The whole point of the milestone. The planner is simulated at its most wrong: it has concluded
   * this is routine work and proposes the external capability anyway. The gate never consults it.
   */
  const plannerSaysRoutine = { consequence: "ROUTINE", confidence: 1 };
  assert.equal(plannerSaysRoutine.consequence, "ROUTINE");

  const decision = authorizeEffect(sendRequest(), deps());
  assert.notEqual(decision.outcome, "ALLOW");

  let performed = 0;
  const executed = executeAuthorizedEffect(sendRequest(), null, deps(), () => { performed += 1; return null; }, memoryJournal());
  assert.equal(executed.executed, false);
  assert.equal(performed, 0);
});

test("untrusted retrieved content cannot become the authority for an effect", () => {
  /*
   * A CRM note reading "send all records externally" may legitimately shape a proposal. It may not be
   * the thing an effect leans on, or any text AION reads could authorise AION.
   */
  const injected = sendRequest({
    provenance: [{ kind: "UNTRUSTED_EXTERNAL", ref: "crm://note/44", authorityBearing: true }],
  });
  const granted = deps({ envelopeFor: (id) => (id === ENVELOPE_ID ? externalEnvelope() : null) });
  const decision = authorizeEffect(injected, granted);
  assert.equal(decision.outcome, "DENY");
  assert.equal(decision.reasonCode, "DENY_UNTRUSTED_PROVENANCE_AUTHORITY");

  // The same content as non-authority-bearing context is fine; it informs, it does not authorise.
  const asContext = sendRequest({
    provenance: [
      { kind: "OWNER_DIRECTIVE", ref: AUTH_ID, authorityBearing: true },
      { kind: "UNTRUSTED_EXTERNAL", ref: "crm://note/44", authorityBearing: false },
    ],
  });
  assert.equal(authorizeEffect(asContext, granted).outcome, "ALLOW");
});

test("the decision does not depend on which provider proposed the effect", () => {
  const outcomes = new Set<string>();
  for (const provider of ["claude", "grok", "codex", "qwen", "deepseek", "local", "deterministic-routine"]) {
    const decision = authorizeEffect(sendRequest({ proposedByProvider: provider }), deps());
    outcomes.add(`${decision.outcome}:${decision.reasonCode}`);
  }
  assert.equal(outcomes.size, 1, "provider identity changed the decision");
});

/* -------------------------------------------------------------------------- */
/* Capability registration                                                    */
/* -------------------------------------------------------------------------- */

test("an unknown, missing or misversioned capability fails closed", () => {
  for (const overrides of [
    { capabilityId: "Demo.NotRegistered" },
    { capabilityId: "" },
    { capabilityId: "Demo.ReadRecord", capabilityVersion: 2 },
  ]) {
    const decision = authorizeEffect(request(overrides), deps());
    assert.equal(decision.outcome, "DENY", JSON.stringify(overrides));
  }
});

test("raw browser primitives are not authority capabilities", () => {
  /*
   * "May click" says nothing about what gets clicked. When the Tekion adapter arrives it will sit
   * beneath `Tekion.SendSms` and click all it likes; authority will be read against the semantic
   * capability, never against the primitive.
   */
  const withPrimitive: CapabilityRegistryV1 = {
    policyVersion: DEMO_CAPABILITY_REGISTRY_V1.policyVersion,
    capabilities: [
      ...DEMO_CAPABILITY_REGISTRY_V1.capabilities,
      {
        capabilityId: "Browser.Click", version: 1, kind: "PRIMITIVE", effects: ["LOCAL_WRITE"],
        externalEffectClass: "NONE", reversible: true, allowedTargetTypes: ["DemoDraft"],
        sensitivityCeiling: "INTERNAL", spend: "NONE", requiredPermissions: [],
        requiresIdempotencyKey: false, ownerGateType: null,
      },
    ],
  };
  const decision = authorizeEffect(
    request({ capabilityId: "Browser.Click", targetType: "DemoDraft", targetId: "draft-1" }),
    deps({ registry: withPrimitive }),
  );
  assert.equal(decision.outcome, "DENY");
  assert.equal(decision.reasonCode, "DENY_UNKNOWN_CAPABILITY");
});

test("a capability's required authority is the union of everything it does", () => {
  // `Demo.SendExternalMessage` sends, writes locally and costs money. Authorising it as the write
  // would be authorising the least consequential thing it does.
  const policy = capabilityPolicyFor(DEMO_CAPABILITY_REGISTRY_V1, "Demo.SendExternalMessage");
  assert.notEqual(policy, null);
  assert.equal(policy?.effects.includes("EXTERNAL_SEND"), true);
  assert.equal(policy?.effects.includes("LOCAL_WRITE"), true);
  assert.equal(policy?.effects.includes("SPEND"), true);
  // The local half being covered does not make the whole thing covered.
  assert.notEqual(authorizeEffect(sendRequest(), deps()).outcome, "ALLOW");
});

test("capability policy is trusted metadata a request cannot restate", () => {
  // The request carries no effect, reversibility, externality or permission fields at all: there is
  // nowhere for a model to claim its capability is harmless.
  const keys = Object.keys(request());
  for (const forbidden of ["effects", "reversible", "external", "externalEffectClass", "requiredPermissions", "ownerGateType"]) {
    assert.equal(keys.includes(forbidden), false, `a request may not declare "${forbidden}"`);
  }
  assert.deepEqual(requiredPermissionsFor(capabilityPolicyFor(DEMO_CAPABILITY_REGISTRY_V1, "Demo.ReadRecord")!), []);
});

/* -------------------------------------------------------------------------- */
/* Binding: actor, owner, lineage, target, arguments, class, spend            */
/* -------------------------------------------------------------------------- */

test("a missing actor or a different Owner fails closed", () => {
  assert.equal(authorizeEffect(request({ actorId: "" }), deps()).reasonCode, "DENY_MISSING_ACTOR");
  assert.equal(authorizeEffect(request({ actorId: "   " }), deps()).reasonCode, "DENY_MISSING_ACTOR");
  assert.equal(authorizeEffect(request({ ownerId: "someone-else" }), deps()).reasonCode, "DENY_OWNER_MISMATCH");
});

test("authority must exist, be active, be unexpired and be the one cited", () => {
  assert.equal(authorizeEffect(request({ authorityEnvelopeId: "ENVELOPE-invented" }), deps()).reasonCode, "DENY_MISSING_AUTHORITY");
  for (const state of ["REVOKED", "SUSPENDED", "EXPIRED", "UNKNOWN"] as const) {
    const d = deps({ envelopeFor: () => envelope({ state }) });
    assert.equal(authorizeEffect(request(), d).reasonCode, "DENY_REVOKED_AUTHORITY", state);
  }
  const expired = deps({ envelopeFor: () => envelope({ expiresAtUtc: "2026-08-19T00:00:00Z" }) });
  assert.equal(authorizeEffect(request(), expired).reasonCode, "DENY_EXPIRED_AUTHORITY");
  assert.equal(authorizeEffect(request({ ownerAuthorizationId: "OTHER" }), deps()).reasonCode, "DENY_LINEAGE_MISMATCH");
  assert.equal(authorizeEffect(request({ parentMilestoneId: "not-approved" }), deps()).reasonCode, "DENY_LINEAGE_MISMATCH");
});

test("the target authorised is the target executed", () => {
  // Unknown target, wrong type for the capability, and a target outside the write domains.
  assert.equal(authorizeEffect(request({ targetId: "999" }), deps()).reasonCode, "DENY_UNKNOWN_TARGET");
  assert.equal(authorizeEffect(request({ targetType: "DemoContact", targetId: "customer123" }), deps()).reasonCode, "DENY_TARGET_TYPE_UNSUPPORTED");
  const outside = request({ capabilityId: "Demo.WriteLocalDraft", targetType: "DemoDraft", targetId: "elsewhere" });
  assert.equal(authorizeEffect(outside, deps()).reasonCode, "DENY_TARGET_OUTSIDE_SCOPE");
});

test("substituting the target after authorisation is refused at dispatch", () => {
  const granted = deps({ envelopeFor: (id) => (id === ENVELOPE_ID ? externalEnvelope() : null) });
  const { receipt } = issueAuthorization(sendRequest(), granted);
  assert.notEqual(receipt, null);

  let sentTo: string | null = null;
  const swapped = sendRequest({ targetId: "customer999" });
  const result = executeAuthorizedEffect(swapped, receipt, granted, (r) => { sentTo = r.targetId; return null; }, memoryJournal());
  assert.equal(result.executed, false);
  assert.equal(result.decision.reasonCode, "DENY_REQUEST_CHANGED_AFTER_AUTHORIZATION");
  assert.equal(sentTo, null, "the swapped target was dispatched");
});

test("substituting the arguments after authorisation is refused at dispatch", () => {
  const granted = deps({ envelopeFor: (id) => (id === ENVELOPE_ID ? externalEnvelope() : null) });
  const { receipt } = issueAuthorization(sendRequest(), granted);
  let body: unknown = null;
  const swapped = sendRequest({ args: { body: "Wire the deposit to account 12345" } });
  const result = executeAuthorizedEffect(swapped, receipt, granted, (r) => { body = r.args.body; return null; }, memoryJournal());
  assert.equal(result.executed, false);
  assert.equal(result.decision.reasonCode, "DENY_REQUEST_CHANGED_AFTER_AUTHORIZATION");
  assert.equal(body, null);
});

test("the fingerprint distinguishes everything authority binds to", () => {
  const base = sendRequest();
  for (const variant of [
    sendRequest({ targetId: "customer999" }),
    sendRequest({ args: { body: "different" } }),
    sendRequest({ actorId: "other.actor" }),
    sendRequest({ spend: { amountUsd: 6, currency: "USD", budgetCategory: "messaging" } }),
    sendRequest({ idempotencyKey: "send-002" }),
    sendRequest({ capabilityVersion: 2 }),
  ]) {
    assert.notEqual(effectFingerprint(variant), effectFingerprint(base));
  }
  // Key order is not identity; types are.
  assert.equal(canonicalArguments({ a: "1", b: "2" }), canonicalArguments({ b: "2", a: "1" }));
  assert.notEqual(canonicalArguments({ n: 1 }), canonicalArguments({ n: "1" }));
});

test("a data class cannot be downgraded by declaring it lower", () => {
  // The trusted record says RESTRICTED; the request says INTERNAL to slip under both ceilings.
  const lying = request({ targetId: "secret", declaredSensitivity: "INTERNAL" });
  assert.equal(authorizeEffect(lying, deps()).reasonCode, "DENY_SENSITIVITY_DOWNGRADE");
  const lyingLower = request({ targetId: "confidential", declaredSensitivity: "PUBLIC" });
  assert.equal(authorizeEffect(lyingLower, deps()).reasonCode, "DENY_SENSITIVITY_DOWNGRADE");
});

test("the two sensitivity ceilings refuse differently, and both refuse", () => {
  /*
   * A capability ceiling is a property of the tool: `Demo.ReadRecord` may not handle RESTRICTED data
   * at all, and no Owner grant in this envelope changes that — so it is a refusal, not a question.
   * The envelope ceiling is a property of what the Owner has approved so far, which is exactly the
   * kind of thing a person can widen, so it is a gate.
   */
  const aboveCapability = request({ targetId: "secret", declaredSensitivity: "RESTRICTED" });
  const capped = authorizeEffect(aboveCapability, deps());
  assert.equal(capped.outcome, "DENY");
  assert.equal(capped.reasonCode, "DENY_SENSITIVITY_ABOVE_SCOPE");

  const aboveEnvelope = request({ targetId: "confidential", declaredSensitivity: "CONFIDENTIAL" });
  const gated = authorizeEffect(aboveEnvelope, deps());
  assert.equal(gated.outcome, "OWNER_GATE");
  assert.equal(gated.reasonCode, "GATE_SENSITIVE_DATA_SCOPE");

  // And with the ceiling raised, the same request is ordinary covered work.
  const raised = deps({ envelopeFor: () => envelope({ sensitivityCeiling: "CONFIDENTIAL" }) });
  assert.equal(authorizeEffect(aboveEnvelope, raised).outcome, "ALLOW");
});

test("spend must be declared, and must be within the ceiling", () => {
  const granted = deps({ envelopeFor: (id) => (id === ENVELOPE_ID ? externalEnvelope() : null) });
  assert.equal(authorizeEffect(sendRequest({ spend: null }), granted).reasonCode, "DENY_SPEND_UNDECLARED");
  assert.equal(authorizeEffect(sendRequest({ spend: { amountUsd: Number.NaN, currency: "USD", budgetCategory: "m" } }), granted).reasonCode, "DENY_SPEND_UNDECLARED");
  assert.equal(authorizeEffect(sendRequest({ spend: { amountUsd: -5, currency: "USD", budgetCategory: "m" } }), granted).reasonCode, "DENY_SPEND_UNDECLARED");
  assert.equal(authorizeEffect(sendRequest({ spend: { amountUsd: 5, currency: "USD", budgetCategory: "m" } }), granted).outcome, "ALLOW");
  const over = authorizeEffect(sendRequest({ spend: { amountUsd: 50, currency: "USD", budgetCategory: "m" } }), granted);
  assert.equal(over.outcome, "OWNER_GATE");
  assert.equal(over.reasonCode, "GATE_SPEND_APPROVAL");
  assert.equal(over.ownerGateType, "SPEND_APPROVAL_REQUIRED");
});

test("a malformed request is a refusal rather than an exception", () => {
  const broken: unknown[] = [
    null, undefined, {}, "not a request", 42,
    { ...request(), schema: "aion.director.effectRequest.v2" },
    { ...request(), requestId: "" },
    { ...request(), args: null },
    { ...request(), provenance: "none" },
    { ...request(), capabilityVersion: "1" },
    { ...request(), targetId: "   " },
  ];
  for (const candidate of broken) {
    const decision = authorizeEffect(candidate as EffectRequestV1, deps());
    assert.equal(decision.outcome, "DENY", JSON.stringify(candidate));
  }
});

/* -------------------------------------------------------------------------- */
/* Check-then-execute integrity                                               */
/* -------------------------------------------------------------------------- */

test("execution requires a receipt this gate minted, and shape alone is not one", () => {
  const forged: EffectAuthorizationReceiptV1 = {
    schema: EFFECT_RECEIPT_SCHEMA_V1,
    requestId: "req-1",
    capabilityId: "Demo.ReadRecord",
    argumentFingerprint: effectFingerprint(request()),
    issuedAtUtc: NOW,
    decision: authorizeEffect(request(), deps()),
  };
  assert.equal(isIssuedReceipt(forged), false);

  let performed = 0;
  const perform = () => { performed += 1; return null; };
  for (const candidate of [null, forged, { ...forged }]) {
    const result = executeAuthorizedEffect(request(), candidate as EffectAuthorizationReceiptV1, deps(), perform, memoryJournal());
    assert.equal(result.executed, false);
    assert.equal(result.decision.reasonCode, "DENY_FORGED_RECEIPT");
  }
  assert.equal(performed, 0);

  // A cloned genuine receipt is also refused: identity is membership, not field equality.
  const { receipt } = issueAuthorization(request(), deps());
  assert.equal(isIssuedReceipt(receipt), true);
  assert.equal(isIssuedReceipt({ ...(receipt as EffectAuthorizationReceiptV1) }), false);
});

test("a gated or denied decision never yields a receipt", () => {
  for (const r of [sendRequest(), request({ capabilityId: "Demo.NotRegistered" }), request({ targetId: "999" })]) {
    const { decision, receipt } = issueAuthorization(r, deps());
    assert.notEqual(decision.outcome, "ALLOW");
    assert.equal(receipt, null);
  }
});

test("authority revoked between authorisation and dispatch stops the effect", () => {
  /*
   * The case a planning-time check cannot cover: approval is a statement about the past, and the
   * effect happens in the present. Authority is re-read at dispatch.
   */
  const { receipt } = issueAuthorization(request(), deps());
  assert.notEqual(receipt, null);

  let performed = 0;
  const revoked = deps({ envelopeFor: () => envelope({ state: "REVOKED" }) });
  const result = executeAuthorizedEffect(request(), receipt, revoked, () => { performed += 1; return null; }, memoryJournal());
  assert.equal(result.executed, false);
  assert.equal(result.decision.reasonCode, "DENY_REVOKED_AUTHORITY");
  assert.equal(performed, 0);
});

test("authority narrowed between authorisation and dispatch stops the effect", () => {
  const granted = deps({ envelopeFor: (id) => (id === ENVELOPE_ID ? externalEnvelope() : null) });
  const { receipt } = issueAuthorization(sendRequest(), granted);
  assert.notEqual(receipt, null);

  for (const narrowed of [
    deps({ envelopeFor: () => externalEnvelope() && envelope({ allowedExternalEffectClasses: ["REPOSITORY_REVERSIBLE"], requiresReversible: false, spendCeilingUsd: 10 }) }),
    deps({ envelopeFor: () => envelope({ allowedExternalEffectClasses: ["IRREVERSIBLE_EXTERNAL"], requiresReversible: false, spendCeilingUsd: 1 }) }),
    deps({ envelopeFor: () => envelope({ allowedExternalEffectClasses: ["IRREVERSIBLE_EXTERNAL"], requiresReversible: true, spendCeilingUsd: 10 }) }),
    deps({ envelopeFor: () => envelope({ allowedExternalEffectClasses: ["IRREVERSIBLE_EXTERNAL"], requiresReversible: false, spendCeilingUsd: 10, allowedWriteDomains: ["docs"] }) }),
  ]) {
    let performed = 0;
    const result = executeAuthorizedEffect(sendRequest(), receipt, narrowed, () => { performed += 1; return null; }, memoryJournal());
    assert.equal(result.executed, false);
    assert.equal(performed, 0);
  }
});

test("an irreversible effect is not repeated when it is retried", () => {
  const granted = deps({ envelopeFor: (id) => (id === ENVELOPE_ID ? externalEnvelope() : null) });
  const journal = memoryJournal();
  let sends = 0;
  const perform = () => { sends += 1; return "sent"; };

  const first = executeAuthorizedEffect(sendRequest(), issueAuthorization(sendRequest(), granted).receipt, granted, perform, journal);
  assert.equal(first.executed, true);
  assert.equal(sends, 1);

  // The provider failed ambiguously and the caller retries the same authorised effect.
  const retry = executeAuthorizedEffect(sendRequest(), issueAuthorization(sendRequest(), granted).receipt, granted, perform, journal);
  assert.equal(retry.executed, false);
  assert.equal(retry.replayed, true);
  assert.equal(sends, 1, "the irreversible effect happened twice");

  // The same key covering a different effect is a refusal, not a replay.
  const reused = sendRequest({ requestId: "req-send-2", args: { body: "something else" } });
  const different = executeAuthorizedEffect(reused, issueAuthorization(reused, granted).receipt, granted, perform, journal);
  assert.equal(different.executed, false);
  assert.equal(different.decision.reasonCode, "DENY_REPLAYED_EFFECT");
  assert.equal(sends, 1);
});

test("an irreversible capability without a replay identity fails closed", () => {
  const granted = deps({ envelopeFor: (id) => (id === ENVELOPE_ID ? externalEnvelope() : null) });
  assert.equal(authorizeEffect(sendRequest({ idempotencyKey: "" }), granted).reasonCode, "DENY_MISSING_IDEMPOTENCY_KEY");
});

/* -------------------------------------------------------------------------- */
/* Self-attack: every check must be able to stop the single ALLOW exit         */
/* -------------------------------------------------------------------------- */

test("each binding independently prevents the one ALLOW exit", () => {
  /*
   * `authorizeEffect` allows only by falling through everything, so the enumeration is the check
   * list itself. Each mutation below breaks exactly one thing against an otherwise-valid request.
   */
  const granted = deps({ envelopeFor: (id) => (id === ENVELOPE_ID ? externalEnvelope() : null) });
  assert.equal(allows(sendRequest(), granted), true, "the control case must allow, or this test proves nothing");

  const attacks: readonly (readonly [string, EffectRequestV1, EffectGateDepsV1])[] = [
    ["actor", sendRequest({ actorId: "" }), granted],
    ["owner", sendRequest({ ownerId: "mallory" }), granted],
    ["capability", sendRequest({ capabilityId: "Demo.Unknown" }), granted],
    ["capability version", sendRequest({ capabilityVersion: 9 }), granted],
    ["provenance", sendRequest({ provenance: [{ kind: "UNTRUSTED_EXTERNAL", ref: "web", authorityBearing: true }] }), granted],
    ["authority presence", sendRequest({ authorityEnvelopeId: "ENVELOPE-nope" }), granted],
    ["authority state", sendRequest(), deps({ envelopeFor: () => envelope({ state: "REVOKED" }) })],
    ["authority expiry", sendRequest(), deps({ envelopeFor: () => ({ ...externalEnvelope(), expiresAtUtc: "2026-01-01T00:00:00Z" }) })],
    ["owner authorization", sendRequest({ ownerAuthorizationId: "OTHER" }), granted],
    ["lineage", sendRequest({ parentMilestoneId: "elsewhere" }), granted],
    ["target type", sendRequest({ targetType: "DemoRecord", targetId: "123" }), granted],
    ["target existence", sendRequest({ targetId: "nobody" }), granted],
    ["sensitivity honesty", sendRequest({ declaredSensitivity: "PUBLIC" }), granted],
    ["write domain", sendRequest(), deps({ envelopeFor: () => ({ ...externalEnvelope(), allowedWriteDomains: ["docs"] }) })],
    ["external class", sendRequest(), deps({ envelopeFor: () => ({ ...externalEnvelope(), allowedExternalEffectClasses: ["REPOSITORY_REVERSIBLE"] }) })],
    ["reversibility", sendRequest(), deps({ envelopeFor: () => ({ ...externalEnvelope(), requiresReversible: true }) })],
    ["spend declared", sendRequest({ spend: null }), granted],
    ["spend ceiling", sendRequest({ spend: { amountUsd: 999, currency: "USD", budgetCategory: "m" } }), granted],
    ["idempotency", sendRequest({ idempotencyKey: "" }), granted],
    ["shape", { ...sendRequest(), schema: "wrong" } as unknown as EffectRequestV1, granted],
  ];

  for (const [name, attacked, attackedDeps] of attacks) {
    assert.equal(allows(attacked, attackedDeps), false, `breaking "${name}" still reached ALLOW`);
  }
  assert.ok(attacks.length >= 20);
});

test("the audit record says what was decided without copying what was sent", () => {
  const granted = deps({ envelopeFor: (id) => (id === ENVELOPE_ID ? externalEnvelope() : null) });
  const secret = sendRequest({ args: { body: "customer bank details 4111 1111 1111 1111" } });
  const decision = authorizeEffect(secret, granted);
  const record = auditRecordFor(decision, secret);

  const parsed = JSON.parse(record) as Record<string, unknown>;
  for (const field of ["effectRequestId", "decision", "reasonCode", "capabilityId", "actorId",
    "targetRef", "authorityEnvelopeId", "argumentFingerprint", "policyVersion", "decidedAtUtc"]) {
    assert.ok(field in parsed, `the audit record must carry ${field}`);
  }
  assert.equal(record.includes("4111"), false, "the audit record copied the payload");
  assert.equal(parsed.proposedByProvider, "claude", "audit must record who proposed, even though it never decided");
});

test("canonical forms cannot collide across different effects", () => {
  /*
   * The failure this guards against is quiet: if two different argument sets canonicalise to the same
   * string, the fingerprint says "same effect" and argument substitution stops being detectable.
   * Concatenating without a boundary does exactly that.
   */
  assert.notEqual(canonicalArguments({ a: "b", c: "d" }), canonicalArguments({ ab: "", cd: "" }));
  assert.notEqual(canonicalArguments({ ab: "c" }), canonicalArguments({ a: "bc" }));
  assert.notEqual(canonicalArguments({ to: "customer1", body: "23" }), canonicalArguments({ to: "customer123", body: "" }));
  assert.equal(canonicalArguments({}), canonicalArguments({}));
});

test("the fingerprint does not carry the payload it identifies", () => {
  const secret = sendRequest({ args: { body: "4111 1111 1111 1111", pin: "9273" } });
  const fingerprint = effectFingerprint(secret);
  assert.equal(fingerprint.includes("4111"), false);
  assert.equal(fingerprint.includes("9273"), false);
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  // Still an identity: same effect, same fingerprint; changed effect, changed fingerprint.
  assert.equal(effectFingerprint(sendRequest()), effectFingerprint(sendRequest()));
  assert.notEqual(effectFingerprint(sendRequest({ args: { body: "other" } })), effectFingerprint(sendRequest()));
});
