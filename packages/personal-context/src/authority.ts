/**
 * The enrollable sensitivity ceiling, read from durable Owner authority rather than written in code.
 *
 * The first version of this package pinned the ceiling to a constant:
 * `MILESTONE_SENSITIVITY_CEILING_V1 = "INTERNAL"`. It enforced the right rule, and it enforced it in
 * the wrong place. An agent that hit `SENSITIVITY_ABOVE_MILESTONE_CEILING` while trying to enroll a
 * resume had a one-line edit available that would make the refusal go away, and that edit looks like
 * ordinary maintenance in a diff. A gate whose value lives next to the code it guards is a gate with
 * a bypass.
 *
 * So the ceiling now comes from `.aion-local/owner-authority/<id>.json` — the record the Founder
 * authorization script writes, and which agents are structurally forbidden from creating
 * (`Write-AionOwnerMilestoneAuthorization` refuses without a verified Founder phrase). Raising the
 * ceiling means getting an Owner-authorized directive that carries
 * `Sensitive-Data-Permission: YES`. There is no code path that raises it otherwise.
 *
 * ## Why the mapping is coarse
 *
 * The durable record carries `sensitiveDataPermission` as YES or NO; it has no ceiling field. Rather
 * than invent one and read it from somewhere softer, the mapping is deliberately two-valued:
 *
 * - `NO`  → `INTERNAL`. Ordinary project and work context, nothing personal-sensitive.
 * - `YES` → `CONFIDENTIAL`. Real career and personal-work material.
 *
 * `RESTRICTED` is never reachable from an authority record alone. If the Owner ever needs it, that
 * is a governance change with its own review, not a flag flip — and this comment is where the next
 * person should start.
 */

import type { SensitivityClassV1 } from "@aion/director";

import { DEFAULT_SENSITIVITY_CEILING_V1, sensitivityRank } from "./contracts.js";

export const OWNER_AUTHORITY_SCHEMA_V1 = "aion.ownerStandingAuthority.v1" as const;

/** The subset of the durable Owner authority record this package depends on. */
export interface OwnerAuthorityRecordV1 {
  readonly schemaVersion: string;
  readonly ownerAuthorizationId: string;
  readonly milestoneId: string;
  readonly state: string;
  readonly sensitiveDataPermission: string;
  readonly expiresAtUtc: string;
}

export type CeilingBasisV1 =
  | "OWNER_AUTHORITY_SENSITIVE_YES"
  | "OWNER_AUTHORITY_SENSITIVE_NO"
  | "NO_AUTHORITY_SUPPLIED"
  | "AUTHORITY_NOT_ACTIVE"
  | "AUTHORITY_MALFORMED"
  | "AUTHORITY_EXPIRED";

export interface CeilingDecisionV1 {
  readonly ceiling: SensitivityClassV1;
  readonly basis: CeilingBasisV1;
  /** Persisted alongside an enrollment refusal so the Owner sees which record decided it. */
  readonly ownerAuthorizationId: string | null;
  readonly detail: string;
}

function failClosed(basis: CeilingBasisV1, detail: string, id: string | null): CeilingDecisionV1 {
  return { ceiling: DEFAULT_SENSITIVITY_CEILING_V1, basis, ownerAuthorizationId: id, detail };
}

/** `null` when the record is usable as authority, otherwise why it is not. */
export function validateOwnerAuthorityRecord(candidate: unknown): string | null {
  if (candidate === null || typeof candidate !== "object") return "authority record is not an object";
  const record = candidate as Partial<OwnerAuthorityRecordV1>;
  if (record.schemaVersion !== OWNER_AUTHORITY_SCHEMA_V1) return "authority schema mismatch";
  if (typeof record.ownerAuthorizationId !== "string" || record.ownerAuthorizationId.trim() === "") {
    return "ownerAuthorizationId is empty";
  }
  if (typeof record.milestoneId !== "string" || record.milestoneId.trim() === "") return "milestoneId is empty";
  if (typeof record.state !== "string" || record.state.trim() === "") return "state is empty";
  if (record.sensitiveDataPermission !== "YES" && record.sensitiveDataPermission !== "NO") {
    return "sensitiveDataPermission must be YES or NO";
  }
  return null;
}

/**
 * Decide the enrollable ceiling from an Owner authority record.
 *
 * Every failure path returns the default rather than throwing, because a caller that cannot read
 * authority must still be able to enroll ordinary non-sensitive sources — it just must not be able
 * to enroll personal ones. Failing closed here means "less", never "nothing".
 */
export function resolveEnrollmentCeiling(
  authority: OwnerAuthorityRecordV1 | null,
  now: string,
): CeilingDecisionV1 {
  if (authority === null) {
    return failClosed("NO_AUTHORITY_SUPPLIED", "No Owner authority record was supplied; ceiling falls back to the default.", null);
  }
  const problem = validateOwnerAuthorityRecord(authority);
  if (problem !== null) {
    return failClosed("AUTHORITY_MALFORMED", `Owner authority record is unusable: ${problem}`, null);
  }
  const id = authority.ownerAuthorizationId;
  if (authority.state !== "ACTIVE") {
    return failClosed("AUTHORITY_NOT_ACTIVE", `Owner authority ${id} is ${authority.state}, not ACTIVE.`, id);
  }
  if (typeof authority.expiresAtUtc === "string" && authority.expiresAtUtc.trim() !== "") {
    const expires = Date.parse(authority.expiresAtUtc);
    const at = Date.parse(now);
    if (!Number.isNaN(expires) && !Number.isNaN(at) && at >= expires) {
      return failClosed("AUTHORITY_EXPIRED", `Owner authority ${id} expired at ${authority.expiresAtUtc}.`, id);
    }
  }
  if (authority.sensitiveDataPermission === "YES") {
    return {
      ceiling: "CONFIDENTIAL",
      basis: "OWNER_AUTHORITY_SENSITIVE_YES",
      ownerAuthorizationId: id,
      detail: `Owner authority ${id} grants sensitive-data permission, so CONFIDENTIAL sources are enrollable.`,
    };
  }
  return {
    ceiling: "INTERNAL",
    basis: "OWNER_AUTHORITY_SENSITIVE_NO",
    ownerAuthorizationId: id,
    detail: `Owner authority ${id} withholds sensitive-data permission, so the ceiling stays at INTERNAL.`,
  };
}

/** Whether a class is at or below a decided ceiling. */
export function withinCeiling(value: SensitivityClassV1, decision: CeilingDecisionV1): boolean {
  const rank = sensitivityRank(value);
  return rank !== Number.POSITIVE_INFINITY && rank <= sensitivityRank(decision.ceiling);
}
