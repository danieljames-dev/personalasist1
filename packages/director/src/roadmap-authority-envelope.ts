/**
 * Authorize an objective once; cover its routine descendants; stop at real boundaries.
 *
 * Until now `resolveMilestoneAuthority` bound a milestone to exactly one `ownerAuthorizationId` and
 * knew nothing about lineage, so naming a routine technical child of already-approved work produced
 * a fresh Owner gate. Safe, and the reason the same kind of Founder phrase has been typed five times
 * for work nobody would call a decision.
 *
 * ## The envelope is derived, never minted
 *
 * There is no writable envelope file, and no function here creates one. An envelope is *projected*
 * from the durable Owner authority record that `authorize-current-directive.ps1` wrote — the same
 * record, the same trust boundary, read-only. That is deliberate and it is the security property of
 * this module: an envelope that code can write is not an Owner decision, and the cheapest way to
 * guarantee code cannot write one is to have no writer at all.
 *
 * Every ceiling therefore comes from the record. Nothing in this file can raise one, because there
 * is nothing here to raise — the values are read out of Owner-written JSON on every evaluation.
 *
 * ## Inheritance is a decision, not an opinion
 *
 * `resolveInheritedAuthority` returns `ALLOW_INHERITED`, `REQUIRE_FRESH_OWNER_APPROVAL` or `DENY`
 * from ten checks against durable state. It never consults a model, never scores confidence, and has
 * no branch that resolves uncertainty in favour of proceeding. Missing evidence is not weak
 * evidence; it is a refusal.
 */

import type { ProviderIdV1, SensitivityClassV1 } from "./provider-bridge.js";
import type {
  ExternalEffectClassV1,
  RoadmapMilestoneV1,
} from "./roadmap-contracts.js";
import type { OwnerAuthorityRecordV1 } from "./roadmap-policy.js";

export const ROADMAP_ENVELOPE_SCHEMA_V1 = "aion.director.roadmapAuthorityEnvelope.v1" as const;

export type EnvelopeStateV1 = "ACTIVE" | "SUSPENDED" | "REVOKED" | "EXPIRED" | "UNKNOWN";

export type InheritanceOutcomeV1 = "ALLOW_INHERITED" | "REQUIRE_FRESH_OWNER_APPROVAL" | "DENY";

/**
 * Boundaries that never inherit, whatever an envelope says.
 *
 * Listed by name so the refusal is legible in a decision reason rather than implied by a
 * combination of flags a reader has to reconstruct.
 */
export const ALWAYS_GATED_BOUNDARIES_V1 = Object.freeze([
  "materially new Owner objective",
  "spend beyond the approved ceiling",
  "new paid resource or subscription",
  "production activation",
  "destructive action on important data",
  "new external publication, send or contact",
  "irreversible external effect outside the envelope",
  "new OAuth or account consent",
  "new or materially expanded credential access",
  "sensitive or restricted data expansion",
  "major Windows or security configuration change",
  "new financial obligation",
  "legal or contractual commitment",
  "authority envelope expansion",
]);

export interface OwnerRoadmapAuthorityEnvelopeV1 {
  readonly schema: typeof ROADMAP_ENVELOPE_SCHEMA_V1;
  readonly envelopeId: string;
  readonly ownerAuthorizationId: string;
  /** Objectives a derived milestone may claim lineage to. */
  readonly approvedObjectives: readonly string[];
  readonly allowedWriteDomains: readonly string[];
  readonly allowedProviders: readonly ProviderIdV1[];
  readonly sensitivityCeiling: SensitivityClassV1;
  readonly spendCeilingUsd: number;
  readonly allowedExternalEffectClasses: readonly ExternalEffectClassV1[];
  /** True when only reversible work may inherit — the case whenever irreversible effects are not approved. */
  readonly requiresReversible: boolean;
  readonly productionWriterPermission: "YES" | "NO";
  readonly destructiveActionPermission: "YES" | "NO";
  readonly securityChangePermission: "YES" | "NO";
  readonly oauthConsentPermission: "YES" | "NO";
  readonly sensitiveDataPermission: "YES" | "NO";
  readonly state: EnvelopeStateV1;
  readonly expiresAtUtc: string;
  readonly supersededBy: string;
  readonly alwaysGatedBoundaries: readonly string[];
  readonly provenance: string;
  readonly version: number;
  readonly createdAtUtc: string;
}

export interface InheritanceDecisionV1 {
  readonly outcome: InheritanceOutcomeV1;
  readonly reason: string;
  readonly envelopeId: string | null;
  readonly ownerAuthorizationId: string | null;
  /** Every check that ran, in order, so a refusal can be read rather than guessed at. */
  readonly checks: readonly { readonly name: string; readonly passed: boolean; readonly detail: string }[];
}

const SENSITIVITY_RANK: Record<SensitivityClassV1, number> = {
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  RESTRICTED: 3,
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function normalizeObjective(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Project the envelope an Owner authority record already implies.
 *
 * Returns `null` rather than a permissive default when the record cannot support an envelope. A
 * record missing its ceilings is not a record with generous ceilings.
 *
 * The envelope id is derived from the authorization id, so it cannot be chosen by the caller — a
 * milestone naming `ENVELOPE-anything-i-like` finds no envelope and gates.
 */
export function deriveEnvelopeFromOwnerAuthority(
  record: OwnerAuthorityRecordV1 | null | undefined,
  now: string,
): OwnerRoadmapAuthorityEnvelopeV1 | null {
  if (record === null || record === undefined || typeof record !== "object") return null;
  if (!isNonEmptyString(record.ownerAuthorizationId)) return null;
  if (!isNonEmptyString(record.authorizedObjective)) return null;
  if (!Array.isArray(record.allowedWriteDomains) || record.allowedWriteDomains.length === 0) return null;
  if (!Array.isArray(record.allowedProviders) || record.allowedProviders.length === 0) return null;
  if (typeof record.spendingCeilingUsd !== "number" || !Number.isFinite(record.spendingCeilingUsd)) return null;
  if (!Array.isArray(record.allowedExternalEffects)) return null;
  if (!isNonEmptyString(record.state)) return null;

  const expired =
    isNonEmptyString(record.expiresAtUtc) &&
    !Number.isNaN(Date.parse(record.expiresAtUtc)) &&
    !Number.isNaN(Date.parse(now)) &&
    Date.parse(now) >= Date.parse(record.expiresAtUtc);

  const state: EnvelopeStateV1 =
    record.state === "REVOKED" ? "REVOKED"
      : record.state === "SUSPENDED" ? "SUSPENDED"
        : expired || record.state === "EXPIRED" ? "EXPIRED"
          : record.state === "ACTIVE" ? "ACTIVE"
            : "UNKNOWN";

  // Sensitivity follows the same rule the enrollment ceiling uses: only an explicit YES lifts it
  // above INTERNAL, and anything unusable stays at the lower of the two.
  const sensitivityCeiling: SensitivityClassV1 = record.sensitiveDataPermission === "YES" ? "CONFIDENTIAL" : "INTERNAL";

  const allowedExternalEffectClasses = record.allowedExternalEffects.filter(
    (effect): effect is ExternalEffectClassV1 => typeof effect === "string",
  );
  // "NONE" and "REPOSITORY_REVERSIBLE" are not external effects an Owner grants; they are the
  // absence of one. Adding them here means a milestone that touches nothing outside the repository
  // does not have to be listed in every authorization to be covered.
  const effects: ExternalEffectClassV1[] = ["NONE", "REPOSITORY_REVERSIBLE"];
  for (const effect of allowedExternalEffectClasses) {
    if (!effects.includes(effect)) effects.push(effect);
  }

  return {
    schema: ROADMAP_ENVELOPE_SCHEMA_V1,
    envelopeId: `ENVELOPE-${record.ownerAuthorizationId}`,
    ownerAuthorizationId: record.ownerAuthorizationId,
    approvedObjectives: [record.authorizedObjective],
    allowedWriteDomains: [...record.allowedWriteDomains],
    allowedProviders: [...record.allowedProviders] as ProviderIdV1[],
    sensitivityCeiling,
    spendCeilingUsd: record.spendingCeilingUsd,
    allowedExternalEffectClasses: effects,
    requiresReversible: !effects.includes("IRREVERSIBLE_EXTERNAL"),
    productionWriterPermission: record.productionWriterPermission === "YES" ? "YES" : "NO",
    destructiveActionPermission: record.destructiveActionPermission === "YES" ? "YES" : "NO",
    securityChangePermission: record.securityChangePermission === "YES" ? "YES" : "NO",
    oauthConsentPermission: record.oauthConsentPermission === "YES" ? "YES" : "NO",
    sensitiveDataPermission: record.sensitiveDataPermission === "YES" ? "YES" : "NO",
    state,
    expiresAtUtc: typeof record.expiresAtUtc === "string" ? record.expiresAtUtc : "",
    supersededBy: typeof record.supersededBy === "string" ? record.supersededBy : "",
    alwaysGatedBoundaries: ALWAYS_GATED_BOUNDARIES_V1,
    provenance: `derived from Owner authority record ${record.ownerAuthorizationId}`,
    version: 1,
    createdAtUtc: typeof record.createdAtUtc === "string" ? record.createdAtUtc : "",
  };
}

/** Every envelope the durable Owner authority records currently imply. */
export function deriveEnvelopes(
  records: readonly OwnerAuthorityRecordV1[],
  now: string,
): readonly OwnerRoadmapAuthorityEnvelopeV1[] {
  const envelopes: OwnerRoadmapAuthorityEnvelopeV1[] = [];
  for (const record of records) {
    const envelope = deriveEnvelopeFromOwnerAuthority(record, now);
    if (envelope !== null) envelopes.push(envelope);
  }
  return envelopes;
}

function deny(reason: string, checks: InheritanceDecisionV1["checks"], envelopeId: string | null, authId: string | null): InheritanceDecisionV1 {
  return { outcome: "DENY", reason, envelopeId, ownerAuthorizationId: authId, checks };
}

function gate(reason: string, checks: InheritanceDecisionV1["checks"], envelopeId: string | null, authId: string | null): InheritanceDecisionV1 {
  return { outcome: "REQUIRE_FRESH_OWNER_APPROVAL", reason, envelopeId, ownerAuthorizationId: authId, checks };
}

/**
 * Decide whether a milestone may inherit authority from an Owner-approved envelope.
 *
 * The order matters. Identity and validity of the envelope come first, because a check against a
 * revoked envelope is not a weaker pass — it is meaningless. Then lineage, then each ceiling, then
 * the always-gated boundaries.
 */
export function resolveInheritedAuthority(
  milestone: RoadmapMilestoneV1,
  envelopes: readonly OwnerRoadmapAuthorityEnvelopeV1[],
  now: string,
): InheritanceDecisionV1 {
  const checks: { name: string; passed: boolean; detail: string }[] = [];
  const note = (name: string, passed: boolean, detail: string): void => {
    checks.push({ name, passed, detail });
  };

  const claimed = milestone.authorityEnvelopeId;
  if (!isNonEmptyString(claimed)) {
    note("envelope claimed", false, "milestone claims no authority envelope");
    return gate("milestone claims no authority envelope", checks, null, null);
  }
  note("envelope claimed", true, claimed);

  const envelope = envelopes.find((row) => row.envelopeId === claimed);
  if (envelope === undefined) {
    note("envelope exists", false, `no durable Owner authority implies ${claimed}`);
    return deny(`no durable Owner authority implies envelope ${claimed}`, checks, claimed, null);
  }
  note("envelope exists", true, envelope.ownerAuthorizationId);

  if (envelope.schema !== ROADMAP_ENVELOPE_SCHEMA_V1) {
    note("envelope well formed", false, "schema mismatch");
    return deny("envelope schema mismatch", checks, claimed, envelope.ownerAuthorizationId);
  }
  note("envelope well formed", true, envelope.schema);

  if (envelope.state === "REVOKED") {
    note("envelope active", false, "revoked");
    return deny("Owner authority envelope is revoked", checks, claimed, envelope.ownerAuthorizationId);
  }
  if (envelope.state !== "ACTIVE") {
    note("envelope active", false, envelope.state);
    return gate(`Owner authority envelope is ${envelope.state}`, checks, claimed, envelope.ownerAuthorizationId);
  }
  note("envelope active", true, "ACTIVE");

  if (isNonEmptyString(envelope.supersededBy)) {
    note("envelope current", false, `superseded by ${envelope.supersededBy}`);
    return gate("Owner authority envelope was superseded", checks, claimed, envelope.ownerAuthorizationId);
  }
  note("envelope current", true, "not superseded");

  if (isNonEmptyString(envelope.expiresAtUtc)) {
    const expires = Date.parse(envelope.expiresAtUtc);
    const at = Date.parse(now);
    if (Number.isNaN(expires)) {
      note("envelope unexpired", false, "expiry is unreadable");
      return deny("Owner authority envelope expiry is unreadable", checks, claimed, envelope.ownerAuthorizationId);
    }
    if (!Number.isNaN(at) && at >= expires) {
      note("envelope unexpired", false, `expired at ${envelope.expiresAtUtc}`);
      return gate("Owner authority envelope expired", checks, claimed, envelope.ownerAuthorizationId);
    }
  }
  note("envelope unexpired", true, envelope.expiresAtUtc === "" ? "no expiry" : envelope.expiresAtUtc);

  // Lineage. The milestone must name an objective the Owner actually approved — not merely a similar
  // one, and not the milestone's own objective, which it writes itself.
  const lineage = milestone.derivedFromObjective;
  if (!isNonEmptyString(lineage)) {
    note("lineage proven", false, "milestone names no parent objective");
    return gate("milestone claims an envelope but names no approved parent objective", checks, claimed, envelope.ownerAuthorizationId);
  }
  const approved = envelope.approvedObjectives.map(normalizeObjective);
  if (!approved.includes(normalizeObjective(lineage))) {
    note("lineage proven", false, "parent objective is not one the Owner approved");
    return gate("milestone lineage does not trace to an approved parent objective", checks, claimed, envelope.ownerAuthorizationId);
  }
  note("lineage proven", true, lineage);

  // Write scope. Absent is refused rather than treated as "writes nothing": a milestone that does not
  // say what it will touch has not proven it stays inside the envelope.
  const domains = milestone.writeDomains;
  if (domains === undefined || !Array.isArray(domains) || domains.length === 0) {
    note("write scope subset", false, "milestone declares no write domains");
    return gate("milestone declares no write domains, so subset cannot be proven", checks, claimed, envelope.ownerAuthorizationId);
  }
  const outside = domains.filter((domain) => !envelope.allowedWriteDomains.includes(domain));
  if (outside.length > 0) {
    note("write scope subset", false, `outside the envelope: ${outside.join(", ")}`);
    return gate(`write domains outside the envelope: ${outside.join(", ")}`, checks, claimed, envelope.ownerAuthorizationId);
  }
  note("write scope subset", true, domains.join(", "));

  const providersOutside = milestone.allowedProviders.filter((provider) => !envelope.allowedProviders.includes(provider));
  if (providersOutside.length > 0) {
    note("provider subset", false, `outside the envelope: ${providersOutside.join(", ")}`);
    return gate(`providers outside the envelope: ${providersOutside.join(", ")}`, checks, claimed, envelope.ownerAuthorizationId);
  }
  note("provider subset", true, milestone.allowedProviders.join(", "));

  const milestoneRank = SENSITIVITY_RANK[milestone.sensitivityClass as SensitivityClassV1];
  const ceilingRank = SENSITIVITY_RANK[envelope.sensitivityCeiling];
  if (milestoneRank === undefined) {
    note("sensitivity within ceiling", false, `unknown sensitivity ${String(milestone.sensitivityClass)}`);
    return deny(`milestone sensitivity is not a known class: ${String(milestone.sensitivityClass)}`, checks, claimed, envelope.ownerAuthorizationId);
  }
  if (milestoneRank > ceilingRank) {
    note("sensitivity within ceiling", false, `${milestone.sensitivityClass} exceeds ${envelope.sensitivityCeiling}`);
    return gate("sensitive-data expansion requires fresh Owner approval", checks, claimed, envelope.ownerAuthorizationId);
  }
  note("sensitivity within ceiling", true, milestone.sensitivityClass);

  if (milestone.spendCapUsd > envelope.spendCeilingUsd) {
    note("spend within ceiling", false, `${milestone.spendCapUsd} exceeds ${envelope.spendCeilingUsd}`);
    return gate("milestone spend exceeds the Owner ceiling", checks, claimed, envelope.ownerAuthorizationId);
  }
  note("spend within ceiling", true, String(milestone.spendCapUsd));

  if (!envelope.allowedExternalEffectClasses.includes(milestone.externalEffectClass)) {
    note("external effect permitted", false, milestone.externalEffectClass);
    return gate(`external effect ${milestone.externalEffectClass} is outside the envelope`, checks, claimed, envelope.ownerAuthorizationId);
  }
  note("external effect permitted", true, milestone.externalEffectClass);

  if (envelope.requiresReversible && milestone.reversibilityClass === "IRREVERSIBLE") {
    note("reversibility satisfied", false, "irreversible work under a reversible-only envelope");
    return gate("irreversible work requires fresh Owner approval", checks, claimed, envelope.ownerAuthorizationId);
  }
  note("reversibility satisfied", true, milestone.reversibilityClass);

  // Always-gated boundaries, read from what the milestone declares about itself.
  const boundary = alwaysGatedBoundaryFor(milestone, envelope);
  if (boundary !== null) {
    note("no always-gated boundary", false, boundary);
    return gate(boundary, checks, claimed, envelope.ownerAuthorizationId);
  }
  note("no always-gated boundary", true, "none crossed");

  if (milestone.authorityClass === "HIGH_CONSEQUENCE") {
    note("routine class", false, "milestone declares itself high-consequence");
    return gate("high-consequence milestones always need a fresh Owner decision", checks, claimed, envelope.ownerAuthorizationId);
  }
  note("routine class", true, milestone.authorityClass);

  return {
    outcome: "ALLOW_INHERITED",
    reason: `routine derived milestone is inside Owner envelope ${envelope.envelopeId}`,
    envelopeId: envelope.envelopeId,
    ownerAuthorizationId: envelope.ownerAuthorizationId,
    checks,
  };
}

/**
 * The first always-gated boundary this milestone crosses, or `null`.
 *
 * Read from the milestone's declared risk classes and effect classes rather than from a
 * self-assigned label, so a milestone cannot opt out of a boundary by naming itself routine.
 */
export function alwaysGatedBoundaryFor(
  milestone: RoadmapMilestoneV1,
  envelope: OwnerRoadmapAuthorityEnvelopeV1,
): string | null {
  const risks = new Set(milestone.riskClasses);

  if (risks.has("PRODUCTION_OR_EXTERNAL") && envelope.productionWriterPermission !== "YES") {
    return "production activation requires fresh Owner approval";
  }
  if (risks.has("MONEY") && envelope.spendCeilingUsd <= 0) {
    return "new financial obligation requires fresh Owner approval";
  }
  if (risks.has("SENSITIVE_DATA") && envelope.sensitiveDataPermission !== "YES") {
    return "sensitive-data expansion requires fresh Owner approval";
  }
  if (risks.has("SECURITY_OR_PRIVACY") && envelope.securityChangePermission !== "YES") {
    return "security or privacy change requires fresh Owner approval";
  }
  if (milestone.externalEffectClass === "IRREVERSIBLE_EXTERNAL" && envelope.requiresReversible) {
    return "irreversible external effect requires fresh Owner approval";
  }
  if (milestone.spendCapUsd > 0 && envelope.spendCeilingUsd <= 0) {
    return "new paid resource or subscription requires fresh Owner approval";
  }
  return null;
}
