/**
 * The authority a frozen job envelope already represents, in the shape the effect gate reads.
 *
 * This lives in its own module for a reason the test suite enforces: a module that touches
 * `OwnerRoadmapAuthorityEnvelopeV1` may not also be able to write files, so that nothing which
 * handles authority can also persist or forge it. `mva-dispatch.ts` writes artifacts, so the
 * projection cannot live there.
 *
 * ## What this is, and what it is not
 *
 * A job envelope is not something a provider made up: `submitJob` runs the authority decision and
 * `freezeJobEnvelope` fixes the result before any adapter sees it. Projecting it lets the gate check
 * a job's artifact write against the boundary that authorisation actually set — this job's milestone,
 * its data class, its write permission — and refuse anything outside it.
 *
 * It is **not** independent authority. It re-expresses the job's own frozen envelope rather than
 * consulting a separate Owner record, so it binds capability, target, arguments and freshness while
 * adding no second opinion about whether the job should have been authorised at all. A roadmap
 * authority envelope is the stronger source; where one exists it is resolved first and this is never
 * consulted. Nothing here creates or widens Owner authority — every field is copied or narrowed.
 */

import { ROADMAP_ENVELOPE_SCHEMA_V1, type OwnerRoadmapAuthorityEnvelopeV1 } from "./roadmap-authority-envelope.js";
import type { JobEnvelopeV1 } from "./provider-bridge.js";

/** The envelope id a job's own frozen authority is published under. */
export function jobAuthorityEnvelopeId(jobId: string): string {
  return `JOB-${jobId}`;
}

export function jobFrozenAuthority(envelope: JobEnvelopeV1): OwnerRoadmapAuthorityEnvelopeV1 {
  return {
    schema: ROADMAP_ENVELOPE_SCHEMA_V1,
    envelopeId: jobAuthorityEnvelopeId(envelope.jobId),
    ownerAuthorizationId: envelope.ownerAuthorizationId,
    approvedParentMilestoneIds: [envelope.milestoneId],
    approvedObjectives: [envelope.objective],
    // Narrower than the job's own allowed paths on purpose: this authorises artifact writes, nothing else.
    allowedWriteDomains: ["artifacts"],
    allowedProviders: [...envelope.sensitiveDataAllowedProviders],
    sensitivityCeiling: envelope.sensitiveDataClass,
    spendCeilingUsd: 0,
    allowedExternalEffectClasses: ["REPOSITORY_REVERSIBLE"],
    requiresReversible: true,
    productionWriterPermission: "NO",
    destructiveActionPermission: "NO",
    securityChangePermission: "NO",
    oauthConsentPermission: "NO",
    sensitiveDataPermission: "NO",
    // A job frozen without write permission authorises no write, so the envelope is not ACTIVE.
    state: envelope.writePermission ? "ACTIVE" : "REVOKED",
    expiresAtUtc: "",
    supersededBy: "",
    alwaysGatedBoundaries: [],
    provenance: "frozen job envelope",
    version: 1,
    createdAtUtc: envelope.createdAt,
  };
}
