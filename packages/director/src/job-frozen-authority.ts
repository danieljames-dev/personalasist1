/**
 * Effect authority projected from an Owner authority record — never from the work being authorised.
 *
 * ## What this replaces, and why
 *
 * V0.2 projected authority out of the *job envelope* and published it into the gate at execute time.
 * An independent review classified that correctly as `SELF_ASSERTED_JOB_AUTHORITY`: the executing job
 * furnished the record that then authorised it, and lineage closed on itself — the approved parent was
 * the job's own milestone id. A gate that reads authority the caller just wrote is checking a mirror.
 *
 *     AUTHORITY MUST EXIST BEFORE EXECUTION.
 *
 * So the input here is an `OwnerAuthorityRecordV1` — a durable file under `.aion-local/owner-authority`
 * that the Owner authorised and that predates any dispatch. Nothing about the job reaches this
 * function: not its objective, not its milestone, not its declared class. Execution can only *resolve*
 * what this produced; it cannot create, widen, republish or reinterpret it.
 *
 * ## Narrowing only
 *
 * Every field is copied or narrowed, never widened:
 *
 *   - write domains are intersected with the domains artifacts can legitimately land in;
 *   - the data-class ceiling is capped at `INTERNAL` whatever the record permits;
 *   - external effects are limited to `REPOSITORY_REVERSIBLE`, and reversibility is required;
 *   - every consequential permission is `NO`, whatever the record carries;
 *   - spend is zero.
 *
 * A record granting more does not produce more. That is what makes this safe to derive automatically:
 * the projection can only ever describe a subset of what the Owner already allowed, so it cannot
 * become a route to authority nobody granted.
 *
 * The result is still revocable (state and expiry are read from the record at dispatch), inspectable
 * (it names the authorization it came from), and reproducible after a restart from the record on disk
 * rather than from anything the job said about itself.
 */

import { ROADMAP_ENVELOPE_SCHEMA_V1, type OwnerRoadmapAuthorityEnvelopeV1 } from "./roadmap-authority-envelope.js";
import type { SensitivityClassV1 } from "./provider-bridge.js";

/** The envelope id an Owner record's effect authority is published under. */
export function effectAuthorityEnvelopeId(ownerAuthorizationId: string): string {
  return `EFFECT-${ownerAuthorizationId}`;
}

/** Where a job artifact may legitimately be written. Anything else is outside this projection. */
export const ARTIFACT_WRITE_DOMAINS_V1: readonly string[] = [".aion-local", "artifacts"];

/** The shape this projection reads. Only these fields are consulted. */
export interface OwnerAuthorityRecordShapeV1 {
  readonly ownerAuthorizationId?: unknown;
  readonly milestoneId?: unknown;
  readonly allowedWriteDomains?: unknown;
  readonly allowedProviders?: unknown;
  readonly state?: unknown;
  readonly expiresAtUtc?: unknown;
  readonly createdAtUtc?: unknown;
}

function stringsOf(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

const SENSITIVITY_CEILING: SensitivityClassV1 = "INTERNAL";

/**
 * Project one Owner authority record into the effect authority for local artifact writes.
 *
 * Returns `null` — never a permissive default — when the record cannot support one. A record missing
 * its identity, naming no milestone, or allowing none of the artifact write domains is a record that
 * authorises no artifact write, and the absence of authority has to read as absence.
 */
export function effectAuthorityFromOwnerRecord(
  record: OwnerAuthorityRecordShapeV1 | null | undefined,
): OwnerRoadmapAuthorityEnvelopeV1 | null {
  if (record === null || record === undefined || typeof record !== "object") return null;
  if (!nonEmpty(record.ownerAuthorizationId) || !nonEmpty(record.milestoneId)) return null;

  const domains = stringsOf(record.allowedWriteDomains).filter((domain) => ARTIFACT_WRITE_DOMAINS_V1.includes(domain));
  if (domains.length === 0) return null;

  return {
    schema: ROADMAP_ENVELOPE_SCHEMA_V1,
    envelopeId: effectAuthorityEnvelopeId(record.ownerAuthorizationId),
    ownerAuthorizationId: record.ownerAuthorizationId,
    // The Owner's milestone is the approved parent. A job asserts descent from it and the gate checks
    // that assertion; the job never supplies the value itself.
    approvedParentMilestoneIds: [record.milestoneId],
    approvedObjectives: [],
    allowedWriteDomains: domains,
    allowedProviders: stringsOf(record.allowedProviders) as OwnerRoadmapAuthorityEnvelopeV1["allowedProviders"],
    sensitivityCeiling: SENSITIVITY_CEILING,
    spendCeilingUsd: 0,
    allowedExternalEffectClasses: ["REPOSITORY_REVERSIBLE"],
    requiresReversible: true,
    productionWriterPermission: "NO",
    destructiveActionPermission: "NO",
    securityChangePermission: "NO",
    oauthConsentPermission: "NO",
    sensitiveDataPermission: "NO",
    state: record.state === "ACTIVE" ? "ACTIVE" : "REVOKED",
    expiresAtUtc: nonEmpty(record.expiresAtUtc) ? record.expiresAtUtc : "",
    supersededBy: "",
    alwaysGatedBoundaries: [],
    provenance: `owner authority record ${record.ownerAuthorizationId}`,
    version: 1,
    createdAtUtc: nonEmpty(record.createdAtUtc) ? record.createdAtUtc : "",
  };
}

/**
 * Project every record that supports one, indexed by envelope id.
 *
 * Built by the control plane before dispatch, so execution resolves a reference rather than producing
 * a record. A restart rebuilds this from the same files and gets the same answer.
 */
export function effectAuthoritiesFromOwnerRecords(
  records: readonly OwnerAuthorityRecordShapeV1[],
): ReadonlyMap<string, OwnerRoadmapAuthorityEnvelopeV1> {
  const out = new Map<string, OwnerRoadmapAuthorityEnvelopeV1>();
  for (const record of records) {
    const projected = effectAuthorityFromOwnerRecord(record);
    if (projected !== null) out.set(projected.envelopeId, projected);
  }
  return out;
}

/**
 * True when `child` stays inside `parent` on every axis the gate reads.
 *
 * A job may narrow what it hands a child. It may not widen it, and "widen" has to be checked rather
 * than trusted, because the widening that matters would be introduced by whoever builds the child.
 */
export function authorityIsWithin(
  child: OwnerRoadmapAuthorityEnvelopeV1,
  parent: OwnerRoadmapAuthorityEnvelopeV1,
): boolean {
  const rank: Record<SensitivityClassV1, number> = { PUBLIC: 0, INTERNAL: 1, CONFIDENTIAL: 2, RESTRICTED: 3 };
  if (child.ownerAuthorizationId !== parent.ownerAuthorizationId) return false;
  if (rank[child.sensitivityCeiling] > rank[parent.sensitivityCeiling]) return false;
  if (child.spendCeilingUsd > parent.spendCeilingUsd) return false;
  if (!child.requiresReversible && parent.requiresReversible) return false;
  for (const domain of child.allowedWriteDomains) {
    if (!parent.allowedWriteDomains.includes(domain)) return false;
  }
  for (const effect of child.allowedExternalEffectClasses) {
    if (!parent.allowedExternalEffectClasses.includes(effect)) return false;
  }
  for (const milestone of child.approvedParentMilestoneIds) {
    if (!parent.approvedParentMilestoneIds.includes(milestone)) return false;
  }
  const permissions = [
    "productionWriterPermission", "destructiveActionPermission", "securityChangePermission",
    "oauthConsentPermission", "sensitiveDataPermission",
  ] as const;
  for (const permission of permissions) {
    if (child[permission] === "YES" && parent[permission] !== "YES") return false;
  }
  return true;
}
