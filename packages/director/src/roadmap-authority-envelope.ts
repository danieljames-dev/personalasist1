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

import {
  CONSEQUENCE_PERMISSIONS_V1,
  describeConsequences,
  detectRequestedConsequences,
  type RequestedConsequenceV1,
} from "./consequence-model.js";
import { assessOwnerBoundaries, describeBoundaries } from "./owner-boundary-detection.js";
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
  /**
   * The parent milestones this envelope covers the children of.
   *
   * The Owner names these when authorizing. A child proves lineage by referencing one of them by id;
   * nothing derived from the *text* of a new request can add to this list.
   */
  readonly approvedParentMilestoneIds: readonly string[];
  /** Objectives, for display and cross-checking. Never lineage on their own. */
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

  /*
   * Only records the Owner explicitly marked as envelope-granting are inheritable.
   *
   * The first version projected an envelope from *every* ACTIVE authority record, which quietly
   * turned eight unrelated milestone authorizations into eight generic inheritance sources. An
   * authorization to build Provider Bridge is not permission to derive arbitrary future work from;
   * it is permission to build Provider Bridge. The marker and the approved parent list are written
   * by `authorize-current-directive.ps1` from the directive the Owner authorized, so they cannot
   * appear without an Owner decision.
   */
  if (record.grantsRoadmapAuthorityEnvelope !== "YES") return null;
  const parents = Array.isArray(record.envelopeApprovedParentMilestoneIds)
    ? record.envelopeApprovedParentMilestoneIds.filter(isNonEmptyString)
    : [];
  if (parents.length === 0) return null;

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
    approvedParentMilestoneIds: parents,
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

  /*
   * The always-gated boundaries, read from the milestone's own objective text.
   *
   * Checked here, before lineage and before any ceiling, because this is the step whose absence
   * caused the review failure. `ALWAYS_GATED_BOUNDARIES_V1` was declared and never evaluated, so
   * "delete the production backups" passed every ceiling it was measured against — it declared no
   * spend, no sensitivity and no external effect, and all three were true of the *milestone record*
   * while being irrelevant to the sentence that created it.
   *
   * This runs on the objective rather than on declared fields precisely because declared fields are
   * what a planner fills in, and a planner that misreads a request produces a record that is
   * internally consistent and completely wrong.
   */
  const consequences = consequencesOf(milestone.objective);
  const uncovered = uncoveredConsequences(consequences, envelope);
  if (uncovered.length > 0) {
    const detail = `${uncovered.join(", ")} — ${describeConsequences(consequences)}`;
    note("requested consequence is inside the envelope", false, detail);
    return gate(`requested consequence is outside the Owner envelope: ${detail}`, checks, claimed, envelope.ownerAuthorizationId);
  }
  note("requested consequence is inside the envelope", true, describeConsequences(consequences));

  /*
   * Lineage, by milestone id.
   *
   * The earlier version matched an objective *string* against the envelope's approved objective, and
   * the planner stamped that string onto whatever the Owner had just typed — so lineage proved only
   * that the planner had copied a value it had been handed. A milestone id refers to a node that
   * already exists and is named in the envelope by the Owner; no amount of new text can produce one.
   */
  const parentId = milestone.derivedFromMilestoneId;
  if (!isNonEmptyString(parentId)) {
    note("lineage proven", false, "milestone names no parent milestone");
    return gate("milestone claims an envelope but names no approved parent milestone", checks, claimed, envelope.ownerAuthorizationId);
  }
  if (!envelope.approvedParentMilestoneIds.includes(parentId)) {
    note("lineage proven", false, `${parentId} is not an approved parent of this envelope`);
    return gate(`milestone lineage does not trace to an approved parent milestone (${parentId})`, checks, claimed, envelope.ownerAuthorizationId);
  }
  if (parentId === milestone.milestoneId) {
    note("lineage proven", false, "milestone names itself as its own parent");
    return deny("milestone names itself as its own parent", checks, claimed, envelope.ownerAuthorizationId);
  }
  // The objective, when stated, must still agree with the envelope. A child that names an approved
  // parent id but an unrelated parent objective is contradicting itself.
  const statedObjective = milestone.derivedFromObjective;
  if (isNonEmptyString(statedObjective)) {
    const approved = envelope.approvedObjectives.map(normalizeObjective);
    if (!approved.includes(normalizeObjective(statedObjective))) {
      note("lineage proven", false, "stated parent objective contradicts the envelope");
      return deny("milestone parent objective contradicts the envelope it claims", checks, claimed, envelope.ownerAuthorizationId);
    }
  }
  note("lineage proven", true, parentId);

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

  /*
   * Irreversible work needs *a* permission covering it — not necessarily the external-effects one.
   *
   * `requiresReversible` is derived from the allowed external effects, and deleting a local backup is
   * irreversible without being external. Gating on that alone meant an envelope explicitly granting
   * destructive action could still never exercise it, which makes the permission decorative in the
   * safe-looking direction. Either permission covers it; neither does not.
   */
  if (milestone.reversibilityClass === "IRREVERSIBLE" && !irreversibleWorkIsCovered(envelope)) {
    note("reversibility satisfied", false, "irreversible work under an envelope that covers neither kind");
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
 * The two readings of a request, unioned into one structured answer.
 *
 * The lexical pass recognises *named* boundaries; the structured pass reads action × target and flags
 * what it cannot resolve. Neither is trusted alone — the first misses paraphrase, the second can miss
 * a boundary that is a noun rather than a verb ("OAuth", "Tekion").
 *
 * They are unioned rather than chained, and specifically the lexical pass is folded in as *evidence*
 * instead of acting as its own unconditional refusal. An unconditional lexical gate would mean an
 * envelope that explicitly grants destructive action could still never exercise it, which makes the
 * permission field decorative in the opposite direction — safe-looking and dishonest.
 */
export function consequencesOf(objective: string): RequestedConsequenceV1 {
  const structured = detectRequestedConsequences(objective);
  const lexical = assessOwnerBoundaries(objective);
  if (lexical.boundaries.length === 0) return structured;

  const raised = { ...structured } as Record<string, unknown>;
  const evidence = [...structured.evidence];
  for (const row of lexical.boundaries) {
    const consequence = LEXICAL_BOUNDARY_CONSEQUENCE[row.boundary];
    if (consequence === undefined) continue;
    if (raised[consequence] === true) continue;
    raised[consequence] = true;
    evidence.push({
      consequence,
      action: "named boundary",
      target: row.boundary,
      detail: `"${row.matched}" names ${row.boundary}`,
    });
  }
  return { ...(raised as unknown as RequestedConsequenceV1), evidence };
}

/**
 * Whether an envelope covers irreversible work at all.
 *
 * There are two distinct kinds and they have two distinct permissions: deleting a local backup is
 * irreversible and not external, while emailing a customer is irreversible and not destructive.
 * Requiring the wrong one of the two made a granted permission unusable — a failure that looks safe
 * and is simply wrong, and which hid behind "it gated, so it must be working".
 */
function irreversibleWorkIsCovered(envelope: OwnerRoadmapAuthorityEnvelopeV1): boolean {
  return (
    envelope.destructiveActionPermission === "YES"
    || envelope.allowedExternalEffectClasses.includes("IRREVERSIBLE_EXTERNAL")
  );
}

/** Which structured consequence each named lexical boundary implies. */
const LEXICAL_BOUNDARY_CONSEQUENCE: Readonly<Record<string, keyof RequestedConsequenceV1>> = {
  "new OAuth or account consent": "accountAccess",
  "new or materially expanded credential access": "credentialAccess",
  "destructive action on important data": "destructiveImportantData",
  "backup destruction": "destructiveImportantData",
  "production activation or change": "productionMutation",
  "new paid resource or subscription": "paidResource",
  "spend beyond the approved ceiling": "spendIncrease",
  "sensitive or restricted data expansion": "sensitiveDataExpansion",
  "new external publication, send or contact": "externalPublish",
  "major Windows or security configuration change": "securityConfigurationChange",
  "job discovery or applications": "externalContact",
  "authority envelope expansion": "authorityExpansion",
  "external system of record": "externalContact",
};

/**
 * Every requested consequence this envelope does not carry permission for.
 *
 * This is the rule the independent review's second finding is about, stated once:
 *
 *   **Valid lineage proves relationship. It does not grant permission to cross a consequence the
 *   envelope was never given.**
 *
 * A child can be a perfect, bounded, correctly-parented step of approved work and still be asking to
 * email a customer. Lineage answers "does this belong to that?"; it says nothing about what "this"
 * would do. Before this check existed, 18 of 31 high-consequence requests inherited authority on the
 * strength of a valid parent id alone.
 */
export function uncoveredConsequences(
  consequences: RequestedConsequenceV1,
  envelope: OwnerRoadmapAuthorityEnvelopeV1,
): readonly string[] {
  const uncovered: string[] = [];
  for (const { consequence, requires } of CONSEQUENCE_PERMISSIONS_V1) {
    if (consequences[consequence] !== true) continue;
    const covered =
      requires === "never" ? false
        : requires === "destructive" ? envelope.destructiveActionPermission === "YES"
          : requires === "oauth" ? envelope.oauthConsentPermission === "YES"
            : requires === "security" ? envelope.securityChangePermission === "YES"
              : requires === "production" ? envelope.productionWriterPermission === "YES"
                : requires === "sensitive" ? envelope.sensitiveDataPermission === "YES"
                  : requires === "spend" ? envelope.spendCeilingUsd > 0
                    : envelope.allowedExternalEffectClasses.includes("IRREVERSIBLE_EXTERNAL");
    if (!covered) uncovered.push(consequence);
  }
  return uncovered;
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
  /*
   * `destructiveActionPermission` and `oauthConsentPermission` were copied into every envelope and
   * then read by nothing. A field that exists in a record but is never evaluated is documentation,
   * not enforcement — and it reads as a guarantee to anyone auditing the projection.
   */
  if (risks.has("PERSISTENCE_OR_RECOVERY") && envelope.destructiveActionPermission !== "YES") {
    return "destructive or recovery-affecting action requires fresh Owner approval";
  }
  if (milestone.reversibilityClass === "IRREVERSIBLE" && !irreversibleWorkIsCovered(envelope)) {
    return "irreversible work requires a destructive-action or irreversible-external permission this envelope does not carry";
  }
  if (envelope.oauthConsentPermission !== "YES") {
    // OAuth is the one boundary with no honest proxy among the declared fields, so it is read from
    // the objective. An envelope that does not carry consent permission cannot cover work that asks
    // for it, however the milestone happens to have classified itself.
    const oauth = assessOwnerBoundaries(milestone.objective).boundaries.find(
      (row) => row.boundary === "new OAuth or account consent" || row.boundary === "new or materially expanded credential access",
    );
    if (oauth !== undefined) return `${oauth.boundary} requires fresh Owner approval`;
  }
  if (milestone.externalEffectClass === "IRREVERSIBLE_EXTERNAL" && envelope.requiresReversible) {
    return "irreversible external effect requires fresh Owner approval";
  }
  if (milestone.spendCapUsd > 0 && envelope.spendCeilingUsd <= 0) {
    return "new paid resource or subscription requires fresh Owner approval";
  }
  return null;
}
