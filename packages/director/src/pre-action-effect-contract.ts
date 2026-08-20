/**
 * Pre-action effect contract — the deterministic gate between a proposal and a real effect.
 *
 * Seven independent reviews of the natural-language consequence model ended the same way: a word the
 * parser had never read reached `ALLOW_STANDING`, and the fix moved the leak rather than closing the
 * class. The last one is still open — "Update the exfiltrate parser logs." inherits — and it is not
 * going to be closed by a better grammar, because the property being asked of the grammar is that it
 * understand every sentence anyone will ever write.
 *
 * So the grammar stops being the boundary. It remains genuinely useful for planning, routing, roadmap
 * classification and deciding when to ask the Owner something — but a sentence is a *proposal*, and a
 * proposal is not authority. Immediately before a real effect executes, this module decides against
 * the effect itself: who is acting, which registered capability, which exact target, which exact
 * arguments, which data class, and what the Owner's authority currently permits.
 *
 *     LANGUAGE INTERPRETATION IS NOT AUTHORITY.
 *
 * The decision here is reproducible from the request, the trusted registry and current authority
 * state. No model judgement participates. If a classifier wrongly calls something routine, the effect
 * still has to survive this gate, and an unregistered or malformed one cannot.
 *
 * Deliberately *not* in this version: real capabilities, real external services, production
 * envelopes. The three demo capabilities exist to prove the shape.
 */

import { createHash } from "node:crypto";

import type { OwnerRoadmapAuthorityEnvelopeV1 } from "./roadmap-authority-envelope.js";
import type { ExternalEffectClassV1 } from "./roadmap-contracts.js";
import type { OwnerGateTypeV1 } from "./gates.js";
import type { SensitivityClassV1 } from "./provider-bridge.js";

export const EFFECT_REQUEST_SCHEMA_V1 = "aion.director.effectRequest.v1" as const;
export const EFFECT_DECISION_SCHEMA_V1 = "aion.director.effectDecision.v1" as const;
export const EFFECT_RECEIPT_SCHEMA_V1 = "aion.director.effectReceipt.v1" as const;
export const EFFECT_POLICY_VERSION_V1 = 1 as const;

/* -------------------------------------------------------------------------- */
/* Effects and outcomes                                                       */
/* -------------------------------------------------------------------------- */

/**
 * What a capability actually does, declared by trusted code rather than by the caller.
 *
 * A capability that does more than one of these declares all of them, and the required authority is
 * the union — a send-and-archive is not authorised as the archive.
 */
export const EFFECT_KINDS_V1 = [
  "READ",
  "LOCAL_WRITE",
  "EXTERNAL_SEND",
  "EXTERNAL_PUBLISH",
  "DESTRUCTIVE",
  "SPEND",
  "OAUTH_CONSENT",
  "SECURITY_CHANGE",
  "PRODUCTION_WRITE",
] as const;
export type EffectKindV1 = (typeof EFFECT_KINDS_V1)[number];

export type EffectOutcomeV1 = "ALLOW" | "DENY" | "OWNER_GATE";

/**
 * Why the gate decided what it decided.
 *
 * Codes rather than prose because an audit asks "which rule refused this", and because a reason a
 * machine cannot compare is a reason nobody checks.
 */
export const EFFECT_REASON_CODES_V1 = [
  "ALLOW_ROUTINE_IN_SCOPE",
  "DENY_MALFORMED_REQUEST",
  "DENY_UNKNOWN_CAPABILITY",
  "DENY_CAPABILITY_VERSION_MISMATCH",
  "DENY_MISSING_ACTOR",
  "DENY_OWNER_MISMATCH",
  "DENY_MISSING_AUTHORITY",
  "DENY_REVOKED_AUTHORITY",
  "DENY_EXPIRED_AUTHORITY",
  "DENY_LINEAGE_MISMATCH",
  "DENY_UNKNOWN_TARGET",
  "DENY_TARGET_TYPE_UNSUPPORTED",
  "DENY_TARGET_OUTSIDE_SCOPE",
  "DENY_ARGUMENT_MISMATCH",
  "DENY_SENSITIVITY_DOWNGRADE",
  "DENY_SENSITIVITY_ABOVE_SCOPE",
  "DENY_SPEND_UNDECLARED",
  "DENY_SPEND_ABOVE_LIMIT",
  "DENY_UNTRUSTED_PROVENANCE_AUTHORITY",
  "DENY_MISSING_IDEMPOTENCY_KEY",
  "DENY_FORGED_RECEIPT",
  "DENY_REQUEST_CHANGED_AFTER_AUTHORIZATION",
  "DENY_REPLAYED_EFFECT",
  "GATE_NEW_EXTERNAL_EFFECT",
  "GATE_IRREVERSIBLE_EFFECT",
  "GATE_DESTRUCTIVE_ACTION",
  "GATE_OAUTH_CONSENT",
  "GATE_SENSITIVE_DATA_SCOPE",
  "GATE_SECURITY_CHANGE",
  "GATE_PRODUCTION_WRITE",
  "GATE_SPEND_APPROVAL",
] as const;
export type EffectReasonCodeV1 = (typeof EFFECT_REASON_CODES_V1)[number];

/* -------------------------------------------------------------------------- */
/* Capability registry — trusted metadata, never model-supplied                */
/* -------------------------------------------------------------------------- */

/**
 * Whether a capability is something the Owner grants authority over, or plumbing beneath one.
 *
 * `click`, `type`, `navigate` and `evaluate` are primitives. They must never become the unit an Owner
 * authorises, because "may click" says nothing about what gets clicked — the Tekion adapter will sit
 * *beneath* `Tekion.SendSms`, and the gate will read the semantic capability. Only `SEMANTIC`
 * capabilities are authorisable; a primitive reaching this gate is an unregistered capability.
 */
export type CapabilityKindV1 = "SEMANTIC" | "PRIMITIVE";

/** The permissions an envelope can carry, named so a capability can require them by name. */
export type AuthorityPermissionV1 =
  | "destructiveActionPermission"
  | "securityChangePermission"
  | "oauthConsentPermission"
  | "sensitiveDataPermission"
  | "productionWriterPermission";

export interface CapabilityPolicyV1 {
  readonly capabilityId: string;
  readonly version: number;
  readonly kind: CapabilityKindV1;
  /** Every effect this capability has. Authority required is the union across all of them. */
  readonly effects: readonly EffectKindV1[];
  readonly externalEffectClass: ExternalEffectClassV1;
  readonly reversible: boolean;
  readonly allowedTargetTypes: readonly string[];
  /** The most sensitive data this capability may touch, whatever the Owner's ceiling allows. */
  readonly sensitivityCeiling: SensitivityClassV1;
  readonly spend: "NONE" | "REQUIRED";
  readonly requiredPermissions: readonly AuthorityPermissionV1[];
  readonly requiresIdempotencyKey: boolean;
  /** The Owner gate to open when authority is absent rather than contradicted. */
  readonly ownerGateType: OwnerGateTypeV1 | null;
}

export interface CapabilityRegistryV1 {
  readonly policyVersion: number;
  readonly capabilities: readonly CapabilityPolicyV1[];
}

/**
 * The three capabilities V0.1 proves the architecture with.
 *
 * None of them reaches a real service. `Demo.SendExternalMessage` deliberately declares *two* effects
 * and costs money, so aggregation and spend binding are exercised by a capability rather than by a
 * test-only special case.
 */
export const DEMO_CAPABILITY_REGISTRY_V1: CapabilityRegistryV1 = Object.freeze({
  policyVersion: EFFECT_POLICY_VERSION_V1,
  capabilities: Object.freeze([
    Object.freeze({
      capabilityId: "Demo.ReadRecord",
      version: 1,
      kind: "SEMANTIC",
      effects: Object.freeze(["READ"] as const),
      externalEffectClass: "NONE",
      reversible: true,
      allowedTargetTypes: Object.freeze(["DemoRecord"]),
      sensitivityCeiling: "CONFIDENTIAL",
      spend: "NONE",
      requiredPermissions: Object.freeze([]),
      requiresIdempotencyKey: false,
      ownerGateType: null,
    }),
    Object.freeze({
      capabilityId: "Demo.WriteLocalDraft",
      version: 1,
      kind: "SEMANTIC",
      effects: Object.freeze(["LOCAL_WRITE"] as const),
      externalEffectClass: "REPOSITORY_REVERSIBLE",
      reversible: true,
      allowedTargetTypes: Object.freeze(["DemoDraft"]),
      sensitivityCeiling: "INTERNAL",
      spend: "NONE",
      requiredPermissions: Object.freeze([]),
      requiresIdempotencyKey: false,
      ownerGateType: null,
    }),
    Object.freeze({
      // Sends, and archives what it sent. Both effects count.
      capabilityId: "Demo.SendExternalMessage",
      version: 1,
      kind: "SEMANTIC",
      effects: Object.freeze(["EXTERNAL_SEND", "LOCAL_WRITE", "SPEND"] as const),
      externalEffectClass: "IRREVERSIBLE_EXTERNAL",
      reversible: false,
      allowedTargetTypes: Object.freeze(["DemoContact"]),
      sensitivityCeiling: "CONFIDENTIAL",
      spend: "REQUIRED",
      requiredPermissions: Object.freeze([]),
      requiresIdempotencyKey: true,
      ownerGateType: "REAL_EXTERNAL_BUSINESS_WRITE_REQUIRED",
    }),
  ]),
});

/**
 * The capabilities real dispatch actually uses. Not a demo.
 *
 * `Director.WriteJobArtifact` is the first one: the bounded local executor writes a job's bootstrap
 * and result artifacts, and that write is now an authorised effect rather than a bare `writeFile`.
 * It is deliberately the smallest real thing in the repository that acts on a target — local,
 * reversible, no spend, no external reach — because the point of wiring it is the *path*, not the
 * consequence.
 *
 * Kept separate from the demo registry so that a test fixture can never widen what production
 * dispatch is able to ask for.
 */
export const DIRECTOR_CAPABILITY_REGISTRY_V1: CapabilityRegistryV1 = Object.freeze({
  policyVersion: EFFECT_POLICY_VERSION_V1,
  capabilities: Object.freeze([
    Object.freeze({
      capabilityId: "Director.WriteJobArtifact",
      version: 1,
      kind: "SEMANTIC",
      effects: Object.freeze(["LOCAL_WRITE"] as const),
      externalEffectClass: "REPOSITORY_REVERSIBLE",
      reversible: true,
      allowedTargetTypes: Object.freeze(["JobArtifact"]),
      sensitivityCeiling: "CONFIDENTIAL",
      spend: "NONE",
      requiredPermissions: Object.freeze([]),
      requiresIdempotencyKey: false,
      ownerGateType: null,
    }),
  ]),
});

export function capabilityPolicyFor(
  registry: CapabilityRegistryV1,
  capabilityId: string,
): CapabilityPolicyV1 | null {
  return registry.capabilities.find((row) => row.capabilityId === capabilityId) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Where a piece of the request came from.
 *
 * `UNTRUSTED_EXTERNAL` covers anything read out of a CRM, an inbox, a web page, a document or a
 * customer message. Such content may legitimately shape what a model *proposes*; it may never be the
 * thing that establishes authority, because then any text AION reads could authorise AION.
 */
export type ProvenanceKindV1 = "OWNER_DIRECTIVE" | "REPOSITORY" | "AION_INTERNAL" | "UNTRUSTED_EXTERNAL";

export interface ProvenanceRefV1 {
  readonly kind: ProvenanceKindV1;
  readonly ref: string;
  /** True when this reference is what the request leans on for its authority claim. */
  readonly authorityBearing: boolean;
}

/** A primitive argument value. Structured payloads are canonicalised into these before hashing. */
export type EffectArgumentValueV1 = string | number | boolean | null;

export interface EffectSpendV1 {
  readonly amountUsd: number;
  readonly currency: "USD";
  readonly budgetCategory: string;
}

export interface EffectRequestV1 {
  readonly schema: typeof EFFECT_REQUEST_SCHEMA_V1;
  readonly requestId: string;
  /** The AION principal acting. Not the model — see `proposedByProvider`. */
  readonly actorId: string;
  /**
   * Which provider proposed this. Recorded for audit and deliberately never read by the decision:
   * Claude, Grok, Codex, a local model and a deterministic routine all get the same answer.
   */
  readonly proposedByProvider: string;
  readonly ownerId: string;
  readonly parentMilestoneId: string;
  readonly authorityEnvelopeId: string;
  readonly ownerAuthorizationId: string;
  readonly capabilityId: string;
  readonly capabilityVersion: number;
  readonly targetType: string;
  readonly targetId: string;
  readonly args: Readonly<Record<string, EffectArgumentValueV1>>;
  /** What the caller believes the data class is. Checked against the trusted record, never trusted. */
  readonly declaredSensitivity: SensitivityClassV1;
  readonly provenance: readonly ProvenanceRefV1[];
  readonly spend: EffectSpendV1 | null;
  readonly idempotencyKey: string;
  readonly requestedAtUtc: string;
}

/** What the trusted side knows about a target, independent of anything the request says about it. */
export interface TrustedTargetV1 {
  readonly targetType: string;
  readonly targetId: string;
  readonly sensitivity: SensitivityClassV1;
  /** The write domain this target belongs to, checked against the envelope for write effects. */
  readonly writeDomain: string;
}

/* -------------------------------------------------------------------------- */
/* Decisions and receipts                                                      */
/* -------------------------------------------------------------------------- */

export interface EffectCheckV1 {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface EffectDecisionV1 {
  readonly schema: typeof EFFECT_DECISION_SCHEMA_V1;
  readonly outcome: EffectOutcomeV1;
  readonly reasonCode: EffectReasonCodeV1;
  readonly detail: string;
  readonly requestId: string;
  readonly capabilityId: string;
  readonly actorId: string;
  readonly targetRef: string;
  readonly argumentFingerprint: string;
  readonly requiredPermissions: readonly AuthorityPermissionV1[];
  readonly ownerGateType: OwnerGateTypeV1 | null;
  readonly policyVersion: number;
  readonly decidedAtUtc: string;
  readonly checks: readonly EffectCheckV1[];
}

/**
 * Proof that the gate — and only the gate — allowed this exact request.
 *
 * The shape is inert on purpose. What makes it real is membership of a module-private set that
 * nothing outside this file can add to, so a receipt built by an adapter, a provider or a test double
 * is refused however convincing its fields are. There is no bearer token to leak or guess.
 */
export interface EffectAuthorizationReceiptV1 {
  readonly schema: typeof EFFECT_RECEIPT_SCHEMA_V1;
  readonly requestId: string;
  readonly capabilityId: string;
  readonly argumentFingerprint: string;
  readonly issuedAtUtc: string;
  readonly decision: EffectDecisionV1;
}

const ISSUED_RECEIPTS = new WeakSet<EffectAuthorizationReceiptV1>();

/* -------------------------------------------------------------------------- */
/* Canonicalisation                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A stable string for everything authority binds to.
 *
 * Deterministic ordering and explicit type tags, so `{"n": 1}` and `{"n": "1"}` are different and key
 * order is not. Plain comparison rather than cryptography: the fingerprint defends against a
 * different effect being dispatched than the one allowed, not against an attacker who already runs
 * inside the gate.
 */
/*
 * Separators for canonical forms, named rather than written inline.
 *
 * They exist so that {a: "b", c: "d"} and {ab: "", cd: ""} cannot canonicalise to the same string —
 * concatenating without a boundary makes two different effects look identical, which is the one thing
 * a fingerprint must never do. Control characters because they cannot occur in an argument value that
 * arrived through JSON, and named constants because an unescaped one in source is invisible.
 */
const UNIT = "\u0001";
const RECORD = "\u0002";
const FIELD = "\u0003";

export function canonicalArguments(args: Readonly<Record<string, EffectArgumentValueV1>>): string {
  const keys = Object.keys(args).sort();
  return keys
    .map((key) => {
      const value = args[key];
      const tag = value === null ? "null" : typeof value;
      return [key, tag, String(value)].join(UNIT);
    })
    .join(RECORD);
}

/**
 * The identity of the effect itself: capability, target, arguments, spend, actor and owner.
 *
 * Everything that would make it a *different* effect is in here, so "authorise A, execute B" fails on
 * comparison rather than on anyone noticing.
 *
 * Digested rather than kept literal. The first version concatenated the canonical arguments, and that
 * string then travelled into the audit record — so writing down that AION had been asked to message a
 * customer also wrote down the customer's bank details. A digest identifies the effect without
 * reproducing it. This is not a defence against anyone already inside the gate; it is so that the
 * durable record of a decision is not a copy of the payload.
 */
export function effectFingerprint(request: EffectRequestV1): string {
  const spend = request.spend === null
    ? "none"
    : [request.spend.amountUsd, request.spend.currency, request.spend.budgetCategory].join(UNIT);
  const material = [
    request.capabilityId,
    String(request.capabilityVersion),
    request.targetType,
    request.targetId,
    request.actorId,
    request.ownerId,
    request.declaredSensitivity,
    spend,
    request.idempotencyKey,
    canonicalArguments(request.args),
  ].join(FIELD);
  return createHash("sha256").update(material).digest("hex");
}

export function targetRefOf(request: EffectRequestV1): string {
  return `${request.targetType}:${request.targetId}`;
}

/* -------------------------------------------------------------------------- */
/* The gate                                                                    */
/* -------------------------------------------------------------------------- */

export interface EffectGateDepsV1 {
  readonly registry: CapabilityRegistryV1;
  /** Trusted target facts. Returning `null` means "not known", which is a refusal, not a default. */
  readonly resolveTarget: (targetType: string, targetId: string) => TrustedTargetV1 | null;
  /** Current authority, read at decision time so a revocation lands before the effect and not after. */
  readonly envelopeFor: (envelopeId: string) => OwnerRoadmapAuthorityEnvelopeV1 | null;
  readonly ownerId: string;
  readonly now: string;
}

const SENSITIVITY_RANK: Record<SensitivityClassV1, number> = {
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  RESTRICTED: 3,
};

const EXTERNAL_EFFECTS: readonly EffectKindV1[] = ["EXTERNAL_SEND", "EXTERNAL_PUBLISH"];

/** Which envelope permission each effect kind needs, where one exists. */
const EFFECT_PERMISSION: Partial<Record<EffectKindV1, AuthorityPermissionV1>> = {
  DESTRUCTIVE: "destructiveActionPermission",
  OAUTH_CONSENT: "oauthConsentPermission",
  SECURITY_CHANGE: "securityChangePermission",
  PRODUCTION_WRITE: "productionWriterPermission",
};

/** The gate to open when an effect kind needs the Owner rather than a refusal. */
const EFFECT_GATE: Partial<Record<EffectKindV1, OwnerGateTypeV1>> = {
  DESTRUCTIVE: "DESTRUCTIVE_ACTION_APPROVAL_REQUIRED",
  OAUTH_CONSENT: "OAUTH_REQUIRED",
  SECURITY_CHANGE: "MAJOR_SECURITY_CHANGE_REQUIRED",
  PRODUCTION_WRITE: "PRODUCTION_DEPLOY_APPROVAL_REQUIRED",
  EXTERNAL_SEND: "REAL_EXTERNAL_BUSINESS_WRITE_REQUIRED",
  EXTERNAL_PUBLISH: "PUBLIC_EXPOSURE_APPROVAL_REQUIRED",
};

const GATE_REASON: Partial<Record<EffectKindV1, EffectReasonCodeV1>> = {
  DESTRUCTIVE: "GATE_DESTRUCTIVE_ACTION",
  OAUTH_CONSENT: "GATE_OAUTH_CONSENT",
  SECURITY_CHANGE: "GATE_SECURITY_CHANGE",
  PRODUCTION_WRITE: "GATE_PRODUCTION_WRITE",
  EXTERNAL_SEND: "GATE_NEW_EXTERNAL_EFFECT",
  EXTERNAL_PUBLISH: "GATE_NEW_EXTERNAL_EFFECT",
};

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** The union of permissions a capability's declared effects require. */
export function requiredPermissionsFor(policy: CapabilityPolicyV1): readonly AuthorityPermissionV1[] {
  const out = new Set<AuthorityPermissionV1>(policy.requiredPermissions);
  for (const effect of policy.effects) {
    const permission = EFFECT_PERMISSION[effect];
    if (permission !== undefined) out.add(permission);
  }
  return [...out];
}

/**
 * Decide whether this exact effect may happen, right now.
 *
 * One `ALLOW` exit, at the bottom, reached only by falling through every check — so the set of things
 * that can permit an effect is the empty set plus "nothing objected", which is the property worth
 * having and the one worth attacking.
 */
export function authorizeEffect(
  request: EffectRequestV1,
  deps: EffectGateDepsV1,
): EffectDecisionV1 {
  const checks: EffectCheckV1[] = [];
  const fingerprint = isWellFormedShape(request) ? effectFingerprint(request) : "";
  const targetRef = isWellFormedShape(request) ? targetRefOf(request) : "";

  const decide = (
    outcome: EffectOutcomeV1,
    reasonCode: EffectReasonCodeV1,
    detail: string,
    extras: { requiredPermissions?: readonly AuthorityPermissionV1[]; ownerGateType?: OwnerGateTypeV1 | null } = {},
  ): EffectDecisionV1 => ({
    schema: EFFECT_DECISION_SCHEMA_V1,
    outcome,
    reasonCode,
    detail,
    requestId: typeof request?.requestId === "string" ? request.requestId : "",
    capabilityId: typeof request?.capabilityId === "string" ? request.capabilityId : "",
    actorId: typeof request?.actorId === "string" ? request.actorId : "",
    targetRef,
    argumentFingerprint: fingerprint,
    requiredPermissions: extras.requiredPermissions ?? [],
    ownerGateType: extras.ownerGateType ?? null,
    policyVersion: deps.registry.policyVersion,
    decidedAtUtc: deps.now,
    checks,
  });

  const record = (name: string, passed: boolean, detail: string): boolean => {
    checks.push({ name, passed, detail });
    return passed;
  };

  /* Shape. A request that is not a request cannot be reasoned about at all. */
  if (!isWellFormedShape(request)) {
    record("shape", false, "the request is missing required fields or has the wrong schema");
    return decide("DENY", "DENY_MALFORMED_REQUEST", "the effect request is malformed");
  }
  record("shape", true, "all required fields are present");

  if (!record("actor", isNonEmpty(request.actorId), "an acting principal must be named")) {
    return decide("DENY", "DENY_MISSING_ACTOR", "the request names no actor");
  }

  if (!record("owner", request.ownerId === deps.ownerId, `owner ${request.ownerId} must match ${deps.ownerId}`)) {
    return decide("DENY", "DENY_OWNER_MISMATCH", "the request names a different Owner than this gate serves");
  }

  /* Capability. Unregistered, primitive or version-mismatched all mean "cannot be reasoned about". */
  const policy = capabilityPolicyFor(deps.registry, request.capabilityId);
  if (!record("capability registered", policy !== null, `${request.capabilityId} must be a registered capability`)) {
    return decide("DENY", "DENY_UNKNOWN_CAPABILITY", `capability "${request.capabilityId}" is not registered`);
  }
  const capability = policy as CapabilityPolicyV1;

  if (!record("capability is semantic", capability.kind === "SEMANTIC",
    "raw primitives are implementation detail beneath a capability, never an authority unit")) {
    return decide("DENY", "DENY_UNKNOWN_CAPABILITY", `"${request.capabilityId}" is a primitive, not an authorisable capability`);
  }

  if (!record("capability version", capability.version === request.capabilityVersion,
    `requested v${request.capabilityVersion}, registry has v${capability.version}`)) {
    return decide("DENY", "DENY_CAPABILITY_VERSION_MISMATCH", "the capability version does not match the registry");
  }

  const permissions = requiredPermissionsFor(capability);

  /* Provenance. Retrieved content may shape a proposal; it may never be what authorises one. */
  const untrustedAuthority = request.provenance.some(
    (row) => row.authorityBearing && row.kind === "UNTRUSTED_EXTERNAL",
  );
  if (!record("provenance", !untrustedAuthority,
    "authority may not rest on content read from an external system")) {
    return decide("DENY", "DENY_UNTRUSTED_PROVENANCE_AUTHORITY",
      "the authority claim rests on untrusted external content", { requiredPermissions: permissions });
  }

  /* Authority, read now rather than at planning time. */
  const envelope = deps.envelopeFor(request.authorityEnvelopeId);
  if (!record("authority present", envelope !== null, `envelope ${request.authorityEnvelopeId} must exist`)) {
    return decide("DENY", "DENY_MISSING_AUTHORITY", "no authority envelope backs this request", { requiredPermissions: permissions });
  }
  const authority = envelope as OwnerRoadmapAuthorityEnvelopeV1;

  if (!record("authority active", authority.state === "ACTIVE", `envelope state is ${authority.state}`)) {
    return decide("DENY", "DENY_REVOKED_AUTHORITY", `the authority envelope is ${authority.state}`, { requiredPermissions: permissions });
  }

  const expired = isNonEmpty(authority.expiresAtUtc) && authority.expiresAtUtc <= deps.now;
  if (!record("authority unexpired", !expired, `expiry ${authority.expiresAtUtc || "none"} against ${deps.now}`)) {
    return decide("DENY", "DENY_EXPIRED_AUTHORITY", "the authority envelope has expired", { requiredPermissions: permissions });
  }

  if (!record("owner authorization", authority.ownerAuthorizationId === request.ownerAuthorizationId,
    "the envelope must be the one the Owner authorised")) {
    return decide("DENY", "DENY_LINEAGE_MISMATCH", "the request cites a different Owner authorization than the envelope", { requiredPermissions: permissions });
  }

  if (!record("lineage", authority.approvedParentMilestoneIds.includes(request.parentMilestoneId),
    `${request.parentMilestoneId} must be an approved parent`)) {
    return decide("DENY", "DENY_LINEAGE_MISMATCH", "the milestone is not covered by this envelope", { requiredPermissions: permissions });
  }

  /* Target: exactly this one, known to the trusted side, of a type the capability accepts. */
  if (!record("target type", capability.allowedTargetTypes.includes(request.targetType),
    `${request.capabilityId} accepts ${capability.allowedTargetTypes.join(", ") || "nothing"}`)) {
    return decide("DENY", "DENY_TARGET_TYPE_UNSUPPORTED", "the capability does not act on that kind of target", { requiredPermissions: permissions });
  }

  const target = deps.resolveTarget(request.targetType, request.targetId);
  if (!record("target known", target !== null, `${targetRef} must resolve to a known target`)) {
    return decide("DENY", "DENY_UNKNOWN_TARGET", `target ${targetRef} is not known`, { requiredPermissions: permissions });
  }
  const trustedTarget = target as TrustedTargetV1;

  /* Sensitivity comes from the target, not from the request's opinion of it. */
  if (!record("sensitivity declared honestly",
    request.declaredSensitivity === trustedTarget.sensitivity,
    `declared ${request.declaredSensitivity}, trusted record says ${trustedTarget.sensitivity}`)) {
    return decide("DENY", "DENY_SENSITIVITY_DOWNGRADE",
      "the request declares a different data class than the trusted record", { requiredPermissions: permissions });
  }

  if (!record("sensitivity within capability",
    SENSITIVITY_RANK[trustedTarget.sensitivity] <= SENSITIVITY_RANK[capability.sensitivityCeiling],
    `${trustedTarget.sensitivity} against capability ceiling ${capability.sensitivityCeiling}`)) {
    return decide("DENY", "DENY_SENSITIVITY_ABOVE_SCOPE", "the capability may not handle data of that class", { requiredPermissions: permissions });
  }

  if (SENSITIVITY_RANK[trustedTarget.sensitivity] > SENSITIVITY_RANK[authority.sensitivityCeiling]) {
    record("sensitivity within authority", false,
      `${trustedTarget.sensitivity} above envelope ceiling ${authority.sensitivityCeiling}`);
    return authority.sensitiveDataPermission === "YES"
      ? decide("DENY", "DENY_SENSITIVITY_ABOVE_SCOPE", "the data class exceeds the Owner's ceiling", { requiredPermissions: permissions })
      : decide("OWNER_GATE", "GATE_SENSITIVE_DATA_SCOPE", "handling this data class needs the Owner",
        { requiredPermissions: permissions, ownerGateType: "CREDENTIAL_STORE_REQUIRED" });
  }
  record("sensitivity within authority", true, `${trustedTarget.sensitivity} within ${authority.sensitivityCeiling}`);

  /* Write scope. A read touches no domain; anything that writes must land somewhere allowed. */
  const writes = capability.effects.some((effect) => effect !== "READ");
  if (writes && !record("write domain", authority.allowedWriteDomains.includes(trustedTarget.writeDomain),
    `${trustedTarget.writeDomain} must be one of ${authority.allowedWriteDomains.join(", ") || "none"}`)) {
    return decide("DENY", "DENY_TARGET_OUTSIDE_SCOPE", "the target is outside the authorised write domains", { requiredPermissions: permissions });
  }
  if (!writes) record("write domain", true, "read-only effect touches no write domain");

  /* Permissions the declared effects require, aggregated across all of them. */
  for (const permission of permissions) {
    if (authority[permission] === "YES") continue;
    const effect = capability.effects.find((kind) => EFFECT_PERMISSION[kind] === permission);
    record(`permission ${permission}`, false, "the envelope does not carry this permission");
    const gateType = (effect !== undefined ? EFFECT_GATE[effect] : undefined) ?? capability.ownerGateType;
    const reason = (effect !== undefined ? GATE_REASON[effect] : undefined) ?? "GATE_NEW_EXTERNAL_EFFECT";
    return decide("OWNER_GATE", reason, `${permission} is required and not granted`,
      { requiredPermissions: permissions, ownerGateType: gateType ?? null });
  }
  record("permissions", true, permissions.length === 0 ? "none required" : permissions.join(", "));

  /* Externality and reversibility, from the capability rather than from the sentence. */
  const external = capability.effects.some((effect) => EXTERNAL_EFFECTS.includes(effect));
  if (external && !authority.allowedExternalEffectClasses.includes(capability.externalEffectClass)) {
    record("external effect", false,
      `${capability.externalEffectClass} not among ${authority.allowedExternalEffectClasses.join(", ") || "none"}`);
    return decide("OWNER_GATE", "GATE_NEW_EXTERNAL_EFFECT",
      "this external effect class is not covered by the envelope",
      { requiredPermissions: permissions, ownerGateType: capability.ownerGateType ?? "REAL_EXTERNAL_BUSINESS_WRITE_REQUIRED" });
  }
  record("external effect", true, external ? `${capability.externalEffectClass} covered` : "local effect");

  if (!capability.reversible && authority.requiresReversible) {
    record("reversibility", false, "the envelope only covers reversible work");
    return decide("OWNER_GATE", "GATE_IRREVERSIBLE_EFFECT", "an irreversible effect needs the Owner",
      { requiredPermissions: permissions, ownerGateType: capability.ownerGateType ?? "REAL_EXTERNAL_BUSINESS_WRITE_REQUIRED" });
  }
  record("reversibility", true, capability.reversible ? "reversible" : "irreversible and permitted");

  /* Spend. An undeclared amount is not a small amount. */
  if (capability.spend === "REQUIRED") {
    if (request.spend === null || typeof request.spend.amountUsd !== "number"
      || !Number.isFinite(request.spend.amountUsd) || request.spend.amountUsd < 0) {
      record("spend declared", false, "this capability costs money and the request declares no amount");
      return decide("DENY", "DENY_SPEND_UNDECLARED", "the effect costs money and no amount was declared", { requiredPermissions: permissions });
    }
    record("spend declared", true, `${request.spend.amountUsd} USD`);
    if (request.spend.amountUsd > authority.spendCeilingUsd) {
      record("spend within ceiling", false, `${request.spend.amountUsd} above ceiling ${authority.spendCeilingUsd}`);
      return decide("OWNER_GATE", "GATE_SPEND_APPROVAL", "the amount exceeds the authorised ceiling",
        { requiredPermissions: permissions, ownerGateType: "SPEND_APPROVAL_REQUIRED" });
    }
    record("spend within ceiling", true, `${request.spend.amountUsd} within ${authority.spendCeilingUsd}`);
  } else {
    record("spend", true, "this capability costs nothing");
  }

  /* Idempotency, where repeating the effect would be materially different from doing it once. */
  if (!record("idempotency", !capability.requiresIdempotencyKey || isNonEmpty(request.idempotencyKey),
    "an irreversible capability must carry a replay identity")) {
    return decide("DENY", "DENY_MISSING_IDEMPOTENCY_KEY", "the capability requires an idempotency key", { requiredPermissions: permissions });
  }

  return decide("ALLOW", "ALLOW_ROUTINE_IN_SCOPE",
    "every check passed against current authority", { requiredPermissions: permissions });
}

/**
 * Whether the object has the fields the gate needs before any of them can be compared.
 *
 * Kept separate and total so a malformed request produces a refusal rather than an exception —
 * a thrown error somewhere up the stack is not a decision, and would be far too easy to swallow.
 */
function isWellFormedShape(request: EffectRequestV1 | null | undefined): request is EffectRequestV1 {
  if (request === null || typeof request !== "object") return false;
  const candidate = request as Partial<EffectRequestV1>;
  if (candidate.schema !== EFFECT_REQUEST_SCHEMA_V1) return false;
  // `actorId` is deliberately absent: a missing actor has its own reason code, and an audit asking
  // "why was this refused" is better served by "no actor" than by "malformed".
  for (const field of ["requestId", "ownerId", "parentMilestoneId", "authorityEnvelopeId",
    "ownerAuthorizationId", "capabilityId", "targetType", "targetId", "declaredSensitivity",
    "requestedAtUtc"] as const) {
    if (!isNonEmpty(candidate[field] as unknown)) return false;
  }
  if (typeof candidate.capabilityVersion !== "number" || !Number.isInteger(candidate.capabilityVersion)) return false;
  if (typeof candidate.args !== "object" || candidate.args === null) return false;
  if (!Array.isArray(candidate.provenance)) return false;
  if (typeof candidate.idempotencyKey !== "string") return false;
  if (typeof candidate.actorId !== "string") return false;
  return true;
}

/* -------------------------------------------------------------------------- */
/* Staging, receipts and execution                                             */
/* -------------------------------------------------------------------------- */

/**
 * Authorise, and on `ALLOW` mint the receipt that execution will demand.
 *
 * Separated from `authorizeEffect` so that reading a decision is always free of side effects, and so
 * the only path that produces a usable receipt is this one.
 */
export function issueAuthorization(
  request: EffectRequestV1,
  deps: EffectGateDepsV1,
): { readonly decision: EffectDecisionV1; readonly receipt: EffectAuthorizationReceiptV1 | null } {
  const decision = authorizeEffect(request, deps);
  if (decision.outcome !== "ALLOW") return { decision, receipt: null };
  const receipt: EffectAuthorizationReceiptV1 = {
    schema: EFFECT_RECEIPT_SCHEMA_V1,
    requestId: request.requestId,
    capabilityId: request.capabilityId,
    argumentFingerprint: decision.argumentFingerprint,
    issuedAtUtc: deps.now,
    decision,
  };
  ISSUED_RECEIPTS.add(receipt);
  return { decision, receipt };
}

/** True only for a receipt this module minted. Shape alone never satisfies it. */
export function isIssuedReceipt(receipt: EffectAuthorizationReceiptV1 | null | undefined): boolean {
  return receipt !== null && receipt !== undefined && ISSUED_RECEIPTS.has(receipt);
}

/** A completed effect, kept so a retry can be answered instead of repeated. */
export interface EffectExecutionRecordV1 {
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly argumentFingerprint: string;
  readonly completedAtUtc: string;
}

export interface EffectJournalV1 {
  readonly find: (idempotencyKey: string) => EffectExecutionRecordV1 | null;
  readonly record: (entry: EffectExecutionRecordV1) => void;
}

export interface EffectExecutionResultV1 {
  readonly executed: boolean;
  readonly decision: EffectDecisionV1;
  readonly replayed: boolean;
  readonly result: unknown;
}

/**
 * Run the effect, but only the one that was allowed.
 *
 * Three things are re-established here rather than assumed from the earlier decision: the receipt was
 * minted by this gate, the request still fingerprints to what the receipt covers, and authority still
 * says yes *now*. The third is what makes revocation land before the effect instead of after it —
 * a planning-time approval is a statement about the past.
 */
export function executeAuthorizedEffect(
  request: EffectRequestV1,
  receipt: EffectAuthorizationReceiptV1 | null,
  deps: EffectGateDepsV1,
  perform: (request: EffectRequestV1) => unknown,
  journal: EffectJournalV1,
): EffectExecutionResultV1 {
  const refuse = (reasonCode: EffectReasonCodeV1, detail: string): EffectExecutionResultV1 => ({
    executed: false,
    replayed: false,
    result: null,
    decision: {
      schema: EFFECT_DECISION_SCHEMA_V1,
      outcome: "DENY",
      reasonCode,
      detail,
      requestId: isWellFormedShape(request) ? request.requestId : "",
      capabilityId: isWellFormedShape(request) ? request.capabilityId : "",
      actorId: isWellFormedShape(request) ? request.actorId : "",
      targetRef: isWellFormedShape(request) ? targetRefOf(request) : "",
      argumentFingerprint: isWellFormedShape(request) ? effectFingerprint(request) : "",
      requiredPermissions: [],
      ownerGateType: null,
      policyVersion: deps.registry.policyVersion,
      decidedAtUtc: deps.now,
      checks: [{ name: "execution binding", passed: false, detail }],
    },
  });

  if (!isIssuedReceipt(receipt)) {
    return refuse("DENY_FORGED_RECEIPT", "the authorization receipt was not issued by this gate");
  }
  const issued = receipt as EffectAuthorizationReceiptV1;

  if (!isWellFormedShape(request)) {
    return refuse("DENY_MALFORMED_REQUEST", "the effect request is malformed at execution time");
  }
  if (issued.requestId !== request.requestId || issued.argumentFingerprint !== effectFingerprint(request)) {
    return refuse("DENY_REQUEST_CHANGED_AFTER_AUTHORIZATION",
      "the effect being dispatched is not the effect that was authorised");
  }

  const fresh = authorizeEffect(request, deps);
  if (fresh.outcome !== "ALLOW") {
    return { executed: false, replayed: false, result: null, decision: fresh };
  }

  const capability = capabilityPolicyFor(deps.registry, request.capabilityId);
  if (capability !== null && capability.requiresIdempotencyKey) {
    const prior = journal.find(request.idempotencyKey);
    if (prior !== null) {
      if (prior.argumentFingerprint !== fresh.argumentFingerprint) {
        return refuse("DENY_REPLAYED_EFFECT", "that idempotency key already covers a different effect");
      }
      return { executed: false, replayed: true, result: null, decision: fresh };
    }
  }

  const result = perform(request);
  if (capability !== null && capability.requiresIdempotencyKey) {
    journal.record({
      idempotencyKey: request.idempotencyKey,
      requestId: request.requestId,
      argumentFingerprint: fresh.argumentFingerprint,
      completedAtUtc: deps.now,
    });
  }
  return { executed: true, replayed: false, result, decision: fresh };
}

/**
 * The durable line an audit reads back.
 *
 * Names, classes and the fingerprint — never the arguments themselves, because the point of recording
 * an effect on a CONFIDENTIAL target is not to copy that target's contents somewhere less protected.
 */
export function auditRecordFor(decision: EffectDecisionV1, request: EffectRequestV1): string {
  return JSON.stringify({
    schema: EFFECT_DECISION_SCHEMA_V1,
    effectRequestId: decision.requestId,
    decision: decision.outcome,
    reasonCode: decision.reasonCode,
    capabilityId: decision.capabilityId,
    actorId: decision.actorId,
    proposedByProvider: request.proposedByProvider,
    targetRef: decision.targetRef,
    authorityEnvelopeId: request.authorityEnvelopeId,
    ownerAuthorizationId: request.ownerAuthorizationId,
    argumentFingerprint: decision.argumentFingerprint,
    sensitivity: request.declaredSensitivity,
    policyVersion: decision.policyVersion,
    decidedAtUtc: decision.decidedAtUtc,
  });
}
