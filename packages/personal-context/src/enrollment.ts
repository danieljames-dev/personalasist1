/**
 * Adding a source is a decision; re-reading one the Owner already approved is not.
 *
 * That single distinction is what keeps this system usable without making it a rubber stamp. The
 * Owner says yes once, to a specific root, with a specific scope, a specific sensitivity class and a
 * specific set of providers — and after that, routine re-synchronization of *that* source needs
 * nobody's attention. Widening the root, raising the class, or adding a new source is a fresh
 * decision, because it changes what AION may look at.
 *
 * Enrollment is data, not code. A new approved folder is a registry row written through
 * {@link registerContextSource}; nothing in this package needs editing to add one. That is why the
 * milestone can build the machinery now and enroll the Owner's real sources later without another
 * engineering pass.
 *
 * ## The ceiling is the directive
 *
 * The authorizing directive carries `Sensitive-Data-Permission: NO`. So enrollment refuses a source
 * classified above {@link MILESTONE_SENSITIVITY_CEILING_V1}, and says so in the Owner's terms rather
 * than failing somewhere deep in a sync. The refusal is the honest answer: that source needs a fresh
 * Owner decision, not a workaround.
 */

import { isResolvedHostPath, type ProviderIdV1, type SensitivityClassV1 } from "@aion/director";

import {
  MILESTONE_SENSITIVITY_CEILING_V1,
  PERSONAL_CONTEXT_AUTHORITY_SOURCE,
  PERSONAL_CONTEXT_MILESTONE_ID,
  PERSONAL_CONTEXT_OWNER_AUTHORIZATION_ID,
  PERSONAL_CONTEXT_SCHEMA_V1,
  sensitivityWithin,
  SOURCE_TYPES_V1,
  SYNC_MODES_V1,
  validateContextSource,
  type ContextSourceV1,
  type SourceStateV1,
  type SourceTypeV1,
  type SyncModeV1,
} from "./contracts.js";
import { providerEligibleForSensitivity, providersEligibleForSensitivity } from "./disclosure.js";
import type { PersonalContextStoreV1 } from "./store.js";

export const DEFAULT_MAX_DEPTH = 6;
export const DEFAULT_MAX_FILES = 500;
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

export interface RegisterContextSourceInputV1 {
  readonly sourceId: string;
  readonly sourceType: string;
  readonly location: string;
  readonly displayName: string;
  readonly purpose: string;
  readonly allowedScope?: readonly string[];
  readonly deniedScope?: readonly string[];
  readonly sensitivityClass?: string;
  readonly eligibleProviders?: readonly string[];
  readonly syncMode?: string;
  readonly recursiveAllowed?: boolean;
  readonly maxDepth?: number;
  readonly maxFiles?: number;
  readonly maxBytes?: number;
  readonly followSymlinksAllowed?: boolean;
  readonly priority?: number;
  readonly expiresAt?: string | null;
}

export type EnrollmentDenialReasonV1 =
  | "DUPLICATE_SOURCE_ID"
  | "UNSUPPORTED_SOURCE_TYPE"
  | "UNSUPPORTED_SYNC_MODE"
  | "LOCATION_NOT_IDENTIFIABLE"
  | "SENSITIVITY_ABOVE_MILESTONE_CEILING"
  | "PROVIDER_NOT_ELIGIBLE_FOR_SENSITIVITY"
  | "INVALID_RECORD";

export type EnrollmentResultV1 =
  | { readonly registered: true; readonly source: ContextSourceV1 }
  | { readonly registered: false; readonly reason: EnrollmentDenialReasonV1; readonly detail: string };

export interface EnrollmentDepsV1 {
  readonly store: PersonalContextStoreV1;
  readonly now: string;
}

export function registerContextSource(
  input: RegisterContextSourceInputV1,
  deps: EnrollmentDepsV1,
): EnrollmentResultV1 {
  if (!SOURCE_TYPES_V1.includes(input.sourceType as SourceTypeV1)) {
    return { registered: false, reason: "UNSUPPORTED_SOURCE_TYPE", detail: `unknown source type: ${input.sourceType}` };
  }
  const syncMode = (input.syncMode ?? "ON_DEMAND") as SyncModeV1;
  if (!SYNC_MODES_V1.includes(syncMode)) {
    return { registered: false, reason: "UNSUPPORTED_SYNC_MODE", detail: `unknown sync mode: ${String(input.syncMode)}` };
  }
  if (deps.store.loadSource(input.sourceId) !== null) {
    return { registered: false, reason: "DUPLICATE_SOURCE_ID", detail: `source already registered: ${input.sourceId}` };
  }
  // Pure string identity first: a location that cannot be pinned to one place on this host cannot be
  // bounded either, and nothing else in the pipeline would notice.
  if (!isResolvedHostPath(input.location)) {
    return {
      registered: false,
      reason: "LOCATION_NOT_IDENTIFIABLE",
      detail: "location must be an absolute path naming one fixed place on this host",
    };
  }

  const sensitivityClass = (input.sensitivityClass ?? "INTERNAL") as SensitivityClassV1;
  if (!sensitivityWithin(sensitivityClass, MILESTONE_SENSITIVITY_CEILING_V1)) {
    return {
      registered: false,
      reason: "SENSITIVITY_ABOVE_MILESTONE_CEILING",
      detail:
        `this milestone may enroll sources up to ${MILESTONE_SENSITIVITY_CEILING_V1}; ` +
        `${sensitivityClass} requires a fresh Owner decision`,
    };
  }

  const requested = (input.eligibleProviders ?? providersEligibleForSensitivity(sensitivityClass)) as readonly ProviderIdV1[];
  for (const provider of requested) {
    if (!providerEligibleForSensitivity(provider, sensitivityClass)) {
      return {
        registered: false,
        reason: "PROVIDER_NOT_ELIGIBLE_FOR_SENSITIVITY",
        detail: `provider ${provider} is not eligible for ${sensitivityClass} under Provider Bridge V1`,
      };
    }
  }
  if (requested.length === 0) {
    return {
      registered: false,
      reason: "PROVIDER_NOT_ELIGIBLE_FOR_SENSITIVITY",
      detail: `no provider is eligible for ${sensitivityClass}`,
    };
  }

  const source: ContextSourceV1 = {
    schema: PERSONAL_CONTEXT_SCHEMA_V1,
    sourceId: input.sourceId,
    sourceType: input.sourceType as SourceTypeV1,
    location: input.location,
    displayName: input.displayName,
    purpose: input.purpose,
    authorizationSource: PERSONAL_CONTEXT_AUTHORITY_SOURCE,
    milestoneId: PERSONAL_CONTEXT_MILESTONE_ID,
    ownerAuthorizationId: PERSONAL_CONTEXT_OWNER_AUTHORIZATION_ID,
    allowedScope: [...(input.allowedScope ?? [])],
    deniedScope: [...(input.deniedScope ?? [])],
    sensitivityClass,
    eligibleProviders: [...requested],
    syncMode,
    recursiveAllowed: input.recursiveAllowed ?? true,
    maxDepth: input.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxFiles: input.maxFiles ?? DEFAULT_MAX_FILES,
    maxBytes: input.maxBytes ?? DEFAULT_MAX_BYTES,
    // Off by default. A source that follows links is a source whose approved root is only as bounded
    // as whatever the filesystem happens to point at today.
    followSymlinksAllowed: input.followSymlinksAllowed ?? false,
    activeState: "ACTIVE",
    revokedAt: null,
    expiresAt: input.expiresAt ?? null,
    priority: input.priority ?? 100,
    lastAttemptedSync: null,
    lastSuccessfulSync: null,
    fingerprint: null,
    version: 1,
    sourceModifiedAt: null,
    createdAt: deps.now,
    updatedAt: deps.now,
  };

  const problem = validateContextSource(source);
  if (problem !== null) return { registered: false, reason: "INVALID_RECORD", detail: problem };

  deps.store.saveSource(source);
  return { registered: true, source };
}

export type SourceStateChangeResultV1 =
  | { readonly changed: true; readonly source: ContextSourceV1 }
  | { readonly changed: false; readonly detail: string };

/**
 * Move a source between ACTIVE, DISABLED and REVOKED.
 *
 * Revocation stamps `revokedAt` and leaves every derived fact exactly where it is. The facts stop
 * being disclosable because retrieval consults the registry, not because the rows were deleted —
 * which means the provenance of anything a past job already saw is still answerable.
 */
export function setSourceState(
  sourceId: string,
  state: SourceStateV1,
  deps: EnrollmentDepsV1,
): SourceStateChangeResultV1 {
  const existing = deps.store.loadSource(sourceId);
  if (existing === null) return { changed: false, detail: `source is not registered: ${sourceId}` };
  const updated: ContextSourceV1 = {
    ...existing,
    activeState: state,
    revokedAt: state === "REVOKED" ? (existing.revokedAt ?? deps.now) : existing.revokedAt,
    updatedAt: deps.now,
  };
  const problem = validateContextSource(updated);
  if (problem !== null) return { changed: false, detail: problem };
  deps.store.saveSource(updated);
  return { changed: true, source: updated };
}

/** Whether a source may be read right now, and why not when it may not. */
export function sourceReadable(source: ContextSourceV1, now: string): { readable: boolean; reason: string | null } {
  if (source.activeState === "REVOKED") return { readable: false, reason: "SOURCE_REVOKED" };
  if (source.activeState === "DISABLED") return { readable: false, reason: "SOURCE_DISABLED" };
  if (source.expiresAt !== null) {
    const expires = Date.parse(source.expiresAt);
    const at = Date.parse(now);
    if (!Number.isNaN(expires) && !Number.isNaN(at) && at >= expires) {
      return { readable: false, reason: "SOURCE_EXPIRED" };
    }
  }
  return { readable: true, reason: null };
}
