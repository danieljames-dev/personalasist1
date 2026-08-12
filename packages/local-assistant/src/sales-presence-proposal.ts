/**
 * Everything that would touch the outside world, held one step short of doing so.
 *
 * Both proposal types here deliberately mirror `CrmActionProposalV1` — same authority vocabulary,
 * same idempotency discipline, same requirement to name the external effect in plain language. That
 * is reuse rather than imitation: the Owner should approve a social post the same way he approves a
 * CRM note, and a second approval vocabulary would mean a second set of habits and a second place
 * for a mistake to hide.
 *
 * At this milestone every proposal is `PREPARE_ONLY`, and there is no executor for any of them. No
 * Metricool call exists in this repository, no deployment path exists, and the absence is the
 * feature: a proposal that cannot be executed cannot be executed by accident.
 *
 * The performance-feedback model at the bottom is the loop's other half, and it is written
 * defensively. A salesperson posting a few times a week generates sample sizes where the difference
 * between two formats is noise, and a system that confidently reports "Reels outperform photos" from
 * nine posts will send the Owner off to make videos for a reason that does not exist.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import type { AuthorityRequiredV1, ProposalStatusV1 } from "./crm-action-proposal.js";
import type { ContentDraftV1 } from "./content-draft.js";
import type { ContentFormatV1 } from "./content-opportunity.js";
import type { ContentPillarV1 } from "./sales-brand.js";

// ---------------------------------------------------------------------------
// Social publishing
// ---------------------------------------------------------------------------

/** Provider-neutral. Metricool is one possible transport, not the model. */
export type SocialPlatformV1 =
  | "FACEBOOK" | "INSTAGRAM" | "TIKTOK" | "YOUTUBE" | "LINKEDIN";

export interface SocialPublishProposalV1 {
  schema: "aion.social-publish-proposal.v1";
  proposalId: OpaqueId;
  workspace: string;
  platform: SocialPlatformV1;
  contentDraftRef: OpaqueId;
  /** Null means "when the Owner says so" — AION does not pick a posting time on its own. */
  scheduledFor: IsoTimestamp | null;
  sourceRefs: string[];
  authorityRequired: AuthorityRequiredV1;
  expectedExternalEffect: string;
  idempotencyKey: string;
  status: ProposalStatusV1;
  createdAt: IsoTimestamp;
}

export interface SalesPresenceRefusalV1 {
  refused: true;
  reason: string;
}

export const SOCIAL_PUBLISH_SCHEMA_V1 = "aion.social-publish-proposal.v1" as const;
export const WEBSITE_CHANGE_SCHEMA_V1 = "aion.website-change-proposal.v1" as const;

/**
 * Derived from what the post *is*, so the same draft aimed at the same platform is the same
 * operation however many times it is proposed.
 */
export function socialIdempotencyKey(input: {
  workspace: string; platform: SocialPlatformV1; contentDraftRef: string;
}): string {
  return `${input.workspace}:${input.platform}:${input.contentDraftRef}`.slice(0, 400);
}

/**
 * Build a publish proposal, or refuse.
 *
 * The staleness check is the important one. A draft written about a car that has since sold is not a
 * weaker post — it is an advertisement for something the dealership cannot deliver, and it would go
 * out under the Owner's name. Refusing at construction means a stale draft can never reach an
 * approval screen where it looks ready.
 */
export function buildSocialPublishProposal(input: {
  proposalId: OpaqueId;
  workspace: string;
  platform: SocialPlatformV1;
  draft: ContentDraftV1;
  scheduledFor?: IsoTimestamp | null;
  now: IsoTimestamp;
}): SocialPublishProposalV1 | SalesPresenceRefusalV1 {
  const draft = input.draft;

  if (draft.workspace !== input.workspace) {
    return { refused: true, reason: `the draft belongs to ${draft.workspace}, not ${input.workspace}` };
  }
  if (draft.freshness === "STALE" || draft.reviewStatus === "STALE") {
    return { refused: true, reason: "this draft is stale — the vehicle or price it describes has changed since it was written" };
  }
  if (draft.freshness === "NEEDS_REVERIFY") {
    return { refused: true, reason: "this draft needs re-verifying against the current listing before it can be scheduled" };
  }
  if (!draft.sourceRefs.length) {
    return { refused: true, reason: "a publish proposal must carry the evidence the content came from" };
  }
  if (draft.publishAuthorityRequired !== "PREPARE_ONLY") {
    return { refused: true, reason: "drafts at this milestone are prepare-only" };
  }

  return {
    schema: SOCIAL_PUBLISH_SCHEMA_V1,
    proposalId: input.proposalId,
    workspace: input.workspace,
    platform: input.platform,
    contentDraftRef: draft.draftId,
    scheduledFor: input.scheduledFor ?? null,
    sourceRefs: [...draft.sourceRefs],
    // Fixed. Nothing in this repository can raise it, and no executor exists to honour it if it could.
    authorityRequired: "PREPARE_ONLY",
    expectedExternalEffect:
      `Would post to ${input.platform.toLowerCase()} under your account`
      + `${input.scheduledFor ? ` at ${input.scheduledFor}` : " when you say so"}. `
      + "Nothing is connected, so nothing can be posted yet.",
    idempotencyKey: socialIdempotencyKey({
      workspace: input.workspace, platform: input.platform, contentDraftRef: draft.draftId,
    }),
    status: "PROPOSED",
    createdAt: input.now,
  };
}

// ---------------------------------------------------------------------------
// Website changes
// ---------------------------------------------------------------------------

export type WebsiteChangeActionV1 =
  | "ADD_FEATURED_VEHICLE"
  | "REMOVE_STALE_VEHICLE"
  | "UPDATE_PRICE"
  | "UPDATE_VEHICLE_STATUS"
  | "PUBLISH_ARTICLE"
  | "UPDATE_FAQ"
  | "UPDATE_HOME_FEATURE";

export interface WebsiteChangeProposalV1 {
  schema: typeof WEBSITE_CHANGE_SCHEMA_V1;
  proposalId: OpaqueId;
  workspace: string;
  action: WebsiteChangeActionV1;
  /** The page path this would affect. */
  target: string;
  vehicleRef: OpaqueId | null;
  contentDraftRef: OpaqueId | null;
  /** Field-level diff, so the Owner approves a change rather than a description of one. */
  changes: Array<{ field: string; before: string | null; after: string | null }>;
  sourceRefs: string[];
  authorityRequired: AuthorityRequiredV1;
  expectedExternalEffect: string;
  idempotencyKey: string;
  status: ProposalStatusV1;
  createdAt: IsoTimestamp;
}

export function websiteIdempotencyKey(input: {
  workspace: string; action: WebsiteChangeActionV1; target: string;
}): string {
  return `${input.workspace}:${input.action}:${input.target}`.slice(0, 400);
}

/**
 * Build a website change proposal, or refuse.
 *
 * Removals are exempt from the staleness rule that blocks additions, and that asymmetry is the
 * point: a stale vehicle is precisely the reason a removal exists. Refusing to remove something
 * because the evidence for it is out of date would leave a sold car on the Owner's website forever.
 */
export function buildWebsiteChangeProposal(input: {
  proposalId: OpaqueId;
  workspace: string;
  action: WebsiteChangeActionV1;
  target: string;
  vehicleRef?: string | null;
  draft?: ContentDraftV1 | null;
  changes: ReadonlyArray<{ field: string; before: string | null; after: string | null }>;
  sourceRefs: readonly string[];
  now: IsoTimestamp;
}): WebsiteChangeProposalV1 | SalesPresenceRefusalV1 {
  if (!input.sourceRefs.length) {
    return { refused: true, reason: "a website change must cite what it is based on" };
  }
  if (!input.changes.length) {
    return { refused: true, reason: "nothing would change" };
  }

  const removing = input.action === "REMOVE_STALE_VEHICLE" || input.action === "UPDATE_VEHICLE_STATUS";
  if (input.draft && !removing && (input.draft.freshness === "STALE" || input.draft.freshness === "NEEDS_REVERIFY")) {
    return { refused: true, reason: "the content behind this change is stale — re-verify the listing first" };
  }

  return {
    schema: WEBSITE_CHANGE_SCHEMA_V1,
    proposalId: input.proposalId,
    workspace: input.workspace,
    action: input.action,
    target: input.target,
    vehicleRef: input.vehicleRef ?? null,
    contentDraftRef: input.draft?.draftId ?? null,
    changes: input.changes.map((c) => ({ ...c })),
    sourceRefs: [...input.sourceRefs],
    authorityRequired: "PREPARE_ONLY",
    expectedExternalEffect:
      `Would ${input.action.replace(/_/g, " ").toLowerCase()} on ${input.target}. `
      + "No site is deployed, so nothing changes anywhere yet.",
    idempotencyKey: websiteIdempotencyKey({
      workspace: input.workspace, action: input.action, target: input.target,
    }),
    status: "PROPOSED",
    createdAt: input.now,
  };
}

// ---------------------------------------------------------------------------
// Performance feedback
// ---------------------------------------------------------------------------

/** Where a performance number came from. Nothing is ever synthesised. */
export type PerformanceSourceV1 = "METRICOOL_FIXTURE" | "OWNER_REPORTED" | "PLATFORM_EXPORT";

export interface ContentPerformanceObservationV1 {
  observationId: OpaqueId;
  workspace: string;
  contentDraftRef: OpaqueId;
  platform: SocialPlatformV1;
  format: ContentFormatV1;
  pillar: ContentPillarV1;
  vehicleRef: OpaqueId | null;
  views: number | null;
  reach: number | null;
  engagements: number | null;
  clicks: number | null;
  /** Only counted when a lead can actually be attributed, which is rare and must not be assumed. */
  attributedLeads: number | null;
  observedAt: IsoTimestamp;
  source: PerformanceSourceV1;
}

/**
 * Below this many observations, a difference between two formats is not a finding.
 *
 * Set high enough to be honest rather than encouraging. The Owner posting twice a week reaches this
 * in a couple of months, and telling him "not enough data yet" for that long is correct — the
 * alternative is sending him to make Reels on the strength of four posts.
 */
export const MIN_OBSERVATIONS_FOR_SIGNAL = 12;

export interface ContentPerformanceReadingV1 {
  /** Ranked only when the sample supports ranking. */
  byFormat: Array<{ format: ContentFormatV1; observations: number; medianEngagements: number | null }>;
  hasEnoughData: boolean;
  message: string;
}

/**
 * Read performance without overclaiming.
 *
 * Median rather than mean, because one post that got shared distorts an average and would become a
 * strategy. And no causal language anywhere: this reports what was observed alongside what was
 * posted, which is not the same as what caused what, and the difference matters when the conclusion
 * changes how somebody spends their week.
 */
export function readContentPerformance(input: {
  observations: readonly ContentPerformanceObservationV1[];
  workspace: string;
}): ContentPerformanceReadingV1 {
  const mine = input.observations.filter((o) => o.workspace === input.workspace);
  const groups = new Map<ContentFormatV1, number[]>();
  for (const observation of mine) {
    if (observation.engagements == null) continue;
    const list = groups.get(observation.format) ?? [];
    list.push(observation.engagements);
    groups.set(observation.format, list);
  }

  const byFormat = [...groups.entries()]
    .map(([format, values]) => ({
      format,
      observations: values.length,
      medianEngagements: median(values),
    }))
    .sort((a, b) => (b.medianEngagements ?? 0) - (a.medianEngagements ?? 0));

  const total = mine.length;
  const hasEnoughData = total >= MIN_OBSERVATIONS_FOR_SIGNAL;

  return {
    byFormat,
    hasEnoughData,
    message: hasEnoughData
      ? `Across ${total} posts, these formats saw the most engagement. That is what was observed alongside them, `
        + `not proof that the format caused it.`
      : `Only ${total} post${total === 1 ? "" : "s"} measured — too few to tell formats apart. `
        + `I will keep counting and say something once there are at least ${MIN_OBSERVATIONS_FOR_SIGNAL}.`,
  };
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}
