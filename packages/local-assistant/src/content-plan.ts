/**
 * What to post, and the freedom to say "nothing today".
 *
 * Every content calendar tool starts from a quota — five posts a week, one a day — and then works
 * backwards to fill it. That is exactly backwards for a salesperson whose credibility is the
 * product. A feed that posts because it is Tuesday teaches the audience that the posts are not about
 * anything, and once they have learned that, the post that *is* about something gets scrolled past
 * with the rest.
 *
 * So the plan is built from opportunities, and the number of slots is however many good
 * opportunities exist. Zero is a legitimate answer and is stated as one, in a sentence that tells
 * the Owner why rather than leaving them wondering whether AION is broken.
 *
 * The daily brief is written to be read in the ten seconds before the Owner walks onto the lot.
 * Stale items lead, because a wrong vehicle on the website costs more than a post not made.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import type { ContentFormatV1, ContentOpportunityV1 } from "./content-opportunity.js";
import type { ContentDraftV1 } from "./content-draft.js";
import type { ContentPillarV1, SalesBrandProfileV1 } from "./sales-brand.js";
import { pillarLabel } from "./sales-brand.js";

export const CONTENT_PLAN_SCHEMA_V1 = "aion.content-plan.v1" as const;

export type ContentPlanHorizonV1 = "DAILY" | "WEEKLY" | "MONTHLY";

export interface ContentPlanSlotV1 {
  slotId: OpaqueId;
  /** What kind of thing this slot is for, in the Owner's terms. */
  role: "INVENTORY" | "EDUCATION" | "SHORT_VIDEO" | "CUSTOMER_QUESTION" | "PERSONAL_BRAND";
  opportunityRef: OpaqueId;
  subject: string;
  pillar: ContentPillarV1;
  suggestedFormat: ContentFormatV1;
  priority: number;
  requiresOwnerReview: boolean;
  reason: string;
}

export interface SocialContentPlanV1 {
  schema: typeof CONTENT_PLAN_SCHEMA_V1;
  planId: OpaqueId;
  workspace: string;
  horizon: ContentPlanHorizonV1;
  periodStart: IsoTimestamp;
  slots: ContentPlanSlotV1[];
  /** Opportunities that existed but did not earn a slot, with the reason. */
  notPlanned: Array<{ subject: string; reason: string }>;
  /** Set when the honest recommendation is to post nothing. */
  noPostRecommended: boolean;
  message: string;
  createdAt: IsoTimestamp;
}

/**
 * Below this, an opportunity is not worth the Owner's name on it.
 *
 * A threshold rather than a ranking cutoff: the point is that weak content should not be published
 * at all, not that it should be published last.
 */
export const MIN_PLANNABLE_PRIORITY = 35;

/** How many slots each horizon will fill at most, when the material exists. */
const MAX_SLOTS: Record<ContentPlanHorizonV1, number> = { DAILY: 4, WEEKLY: 12, MONTHLY: 40 };

const ROLE_FOR_PILLAR: Partial<Record<ContentPillarV1, ContentPlanSlotV1["role"]>> = {
  CURRENT_INVENTORY: "INVENTORY",
  NEW_ARRIVAL: "INVENTORY",
  INVENTORY_CHANGE: "INVENTORY",
  PRICE_CHANGE: "INVENTORY",
  VEHICLE_EDUCATION: "EDUCATION",
  MODEL_COMPARISON: "EDUCATION",
  FEATURE_EXPLANATION: "EDUCATION",
  BUYING_GUIDE: "EDUCATION",
  CUSTOMER_FAQ: "CUSTOMER_QUESTION",
  LOT_WALK: "SHORT_VIDEO",
  SHORT_VIDEO: "SHORT_VIDEO",
  PERSONAL_BRAND: "PERSONAL_BRAND",
};

function roleFor(pillar: ContentPillarV1): ContentPlanSlotV1["role"] {
  return ROLE_FOR_PILLAR[pillar] ?? "EDUCATION";
}

/**
 * Build a plan from what actually happened.
 *
 * Variety is preferred but never manufactured: the planner takes the strongest opportunity in each
 * role before taking a second from any role, so a day with three new arrivals produces one inventory
 * post and then looks for something different — but a day that only has inventory news produces
 * inventory posts rather than an invented "education" slot.
 */
export function buildContentPlan(input: {
  planId: OpaqueId;
  workspace: string;
  horizon: ContentPlanHorizonV1;
  opportunities: readonly ContentOpportunityV1[];
  brand: SalesBrandProfileV1;
  periodStart: IsoTimestamp;
  now: IsoTimestamp;
  nextSlotId: (index: number) => OpaqueId;
}): SocialContentPlanV1 {
  const notPlanned: Array<{ subject: string; reason: string }> = [];
  const eligible: ContentOpportunityV1[] = [];

  for (const opportunity of input.opportunities) {
    if (opportunity.workspace !== input.workspace) {
      notPlanned.push({ subject: opportunity.subject, reason: "different workspace" });
      continue;
    }
    if (!input.brand.contentPillars.includes(opportunity.pillar)) {
      notPlanned.push({ subject: opportunity.subject, reason: `${pillarLabel(opportunity.pillar)} is not a subject you post about` });
      continue;
    }
    if (opportunity.expiresAt && Date.parse(opportunity.expiresAt) <= Date.parse(input.now)) {
      notPlanned.push({ subject: opportunity.subject, reason: "the observation behind it has expired" });
      continue;
    }
    if (opportunity.priority < MIN_PLANNABLE_PRIORITY) {
      notPlanned.push({ subject: opportunity.subject, reason: "not strong enough to be worth posting" });
      continue;
    }
    eligible.push(opportunity);
  }

  eligible.sort((a, b) => b.priority - a.priority || (a.subject < b.subject ? -1 : 1));

  // One pass taking the best of each role, then fill remaining capacity by strength.
  const cap = MAX_SLOTS[input.horizon];
  const chosen: ContentOpportunityV1[] = [];
  const usedRoles = new Set<string>();
  for (const opportunity of eligible) {
    if (chosen.length >= cap) break;
    const role = roleFor(opportunity.pillar);
    if (usedRoles.has(role)) continue;
    usedRoles.add(role);
    chosen.push(opportunity);
  }
  for (const opportunity of eligible) {
    if (chosen.length >= cap) break;
    if (chosen.includes(opportunity)) continue;
    chosen.push(opportunity);
  }

  const slots: ContentPlanSlotV1[] = chosen.map((opportunity, index) => ({
    slotId: input.nextSlotId(index),
    role: roleFor(opportunity.pillar),
    opportunityRef: opportunity.opportunityId,
    subject: opportunity.subject,
    pillar: opportunity.pillar,
    suggestedFormat: opportunity.suggestedFormats[0] ?? "FACEBOOK_POST",
    priority: opportunity.priority,
    requiresOwnerReview: opportunity.requiresOwnerReview,
    reason: opportunity.reason,
  }));

  const noPostRecommended = slots.length === 0;
  return {
    schema: CONTENT_PLAN_SCHEMA_V1,
    planId: input.planId,
    workspace: input.workspace,
    horizon: input.horizon,
    periodStart: input.periodStart,
    slots,
    notPlanned,
    noPostRecommended,
    message: noPostRecommended
      ? "Nothing worth posting today. Nothing new came in, nothing moved, and no question came up more than once — "
        + "a quiet day is better than a filler post."
      : `${slots.length} thing${slots.length === 1 ? "" : "s"} worth posting.`,
    createdAt: input.now,
  };
}

// ---------------------------------------------------------------------------
// The daily brief
// ---------------------------------------------------------------------------

export interface SalesPresenceTodayV1 {
  workspace: string;
  generatedAt: IsoTimestamp;
  opportunityCount: number;
  plan: SocialContentPlanV1;
  draftsReady: number;
  scriptsReady: number;
  staleWebsiteItems: number;
  websiteUpdatesAvailable: number;
}

/**
 * The ten-second version.
 *
 * Stale website items lead. A post not made costs nothing; a sold car still advertised on the
 * Owner's own site costs a conversation he has to have standing in front of someone.
 */
export function formatSalesPresenceToday(input: SalesPresenceTodayV1): string {
  const lines: string[] = ["SALES PRESENCE TODAY", ""];

  if (input.staleWebsiteItems > 0) {
    lines.push(
      `Website needs attention first: ${input.staleWebsiteItems} featured ${input.staleWebsiteItems === 1 ? "vehicle is" : "vehicles are"} stale.`,
    );
    lines.push("");
  }

  lines.push(`Content opportunities: ${input.opportunityCount}`);
  lines.push("");

  if (input.plan.noPostRecommended) {
    lines.push(input.plan.message);
  } else {
    lines.push("Recommended:");
    for (const slot of input.plan.slots) {
      const review = slot.requiresOwnerReview ? " (needs your eyes — it quotes a price)" : "";
      lines.push(`- ${slot.subject} — ${formatLabel(slot.suggestedFormat)}${review}`);
    }
  }

  lines.push("");
  lines.push("Website:");
  lines.push(
    input.staleWebsiteItems || input.websiteUpdatesAvailable
      ? `- ${input.staleWebsiteItems} stale, ${input.websiteUpdatesAvailable} update${input.websiteUpdatesAvailable === 1 ? "" : "s"} available`
      : "- nothing to change",
  );

  lines.push("");
  lines.push("Social:");
  lines.push(
    input.draftsReady || input.scriptsReady
      ? `- ${input.draftsReady} draft${input.draftsReady === 1 ? "" : "s"} and ${input.scriptsReady} video script${input.scriptsReady === 1 ? "" : "s"} ready for review`
      : "- nothing drafted yet",
  );

  lines.push("");
  lines.push("Nothing has been published. Everything here is waiting on you.");
  return lines.join("\n");
}

export function formatLabel(format: ContentFormatV1): string {
  const labels: Record<ContentFormatV1, string> = {
    FACEBOOK_POST: "Facebook post",
    INSTAGRAM_CAPTION: "Instagram caption",
    SHORT_VIDEO_SCRIPT: "short video script",
    REEL_SCRIPT: "Reel script",
    TIKTOK_SCRIPT: "TikTok script",
    YOUTUBE_SHORT_SCRIPT: "YouTube Short script",
    WEBSITE_FEATURED_VEHICLE: "website feature",
    WEBSITE_ARTICLE: "website article",
    FAQ: "FAQ answer",
    CUSTOMER_SHARE_MESSAGE: "message to send a customer",
  };
  return labels[format];
}

// ---------------------------------------------------------------------------
// Command surface
// ---------------------------------------------------------------------------

/**
 * The things the Owner will actually say.
 *
 * Defined and tested here as a pure request/response vocabulary rather than wired into `service.ts`.
 * Grok is working in that file on the lot-walk vertical and a routing splice from this branch would
 * collide for no benefit — the routing is a one-line-per-intent change at integration time, while the
 * decision about what each request *means* is the part worth getting right now.
 */
export type SalesPresenceCommandV1 =
  | "WHAT_SHOULD_I_POST"
  | "MAKE_TODAYS_CONTENT"
  | "WEEKLY_CONTENT_PLAN"
  | "VIDEO_IDEA"
  | "REEL_FOR_VIN"
  | "POST_FOR_VEHICLE"
  | "WHICH_VEHICLES_TO_FEATURE"
  | "CUSTOMER_QUESTIONS"
  | "WEBSITE_STALE"
  | "PREPARE_WEBSITE_UPDATE";

interface CommandRule {
  command: SalesPresenceCommandV1;
  patterns: RegExp[];
}

/**
 * Patterns are written with the file tools only, never through a shell heredoc.
 *
 * That is not a stylistic preference: a previous milestone in this repository introduced 62 literal
 * backspace bytes into regex-bearing source that way, and every rule silently matched nothing.
 */
const COMMAND_RULES: CommandRule[] = [
  {
    command: "WHAT_SHOULD_I_POST",
    patterns: [/\bwhat should i post\b/i, /\bwhat do i post\b/i, /\banything worth posting\b/i],
  },
  {
    command: "MAKE_TODAYS_CONTENT",
    patterns: [/\bmake today'?s (?:social|content|posts?)\b/i, /\bcreate today'?s (?:social|content)\b/i],
  },
  {
    command: "WEEKLY_CONTENT_PLAN",
    patterns: [/\bweekly content plan\b/i, /\bcontent plan for the week\b/i, /\bplan my (?:week|content)\b/i],
  },
  {
    command: "VIDEO_IDEA",
    patterns: [/\bwhat should i make a video about\b/i, /\bvideo idea\b/i, /\bwhat should i film\b/i],
  },
  {
    command: "REEL_FOR_VIN",
    patterns: [/\b(?:reel|short|tiktok|video) script for\b/i, /\bmake a reel for\b/i],
  },
  {
    command: "POST_FOR_VEHICLE",
    patterns: [/\bturn this (?:vehicle|car|vin) into a (?:facebook |instagram )?post\b/i, /\bbuild a post for\b/i, /\bmake a post for this\b/i],
  },
  {
    command: "WHICH_VEHICLES_TO_FEATURE",
    patterns: [/\bwhich vehicles? (?:should i |are worth )?featur/i, /\bwhat should i feature\b/i],
  },
  {
    command: "CUSTOMER_QUESTIONS",
    patterns: [/\bwhat (?:questions are|are) customers asking\b/i, /\bmost common customer question\b/i],
  },
  {
    command: "WEBSITE_STALE",
    patterns: [/\bwhat(?:'s| is) stale on my website\b/i, /\bstale website\b/i, /\bwebsite out of date\b/i],
  },
  {
    command: "PREPARE_WEBSITE_UPDATE",
    patterns: [/\bprepare a website update\b/i, /\bupdate my website\b/i],
  },
];

export interface SalesPresenceRouteV1 {
  command: SalesPresenceCommandV1 | null;
  /** Trailing text after the match — a VIN, a model name. Empty when there is none. */
  subject: string;
}

/**
 * Classify one Owner request.
 *
 * Returns null rather than guessing. An unrecognised request should fall through to whatever already
 * handles it, and a sales-presence router that claims ordinary questions would break the assistant
 * the Owner already relies on.
 */
export function routeSalesPresenceCommand(text: string): SalesPresenceRouteV1 {
  const input = String(text ?? "").trim();
  for (const rule of COMMAND_RULES) {
    for (const pattern of rule.patterns) {
      const match = input.match(pattern);
      if (!match) continue;
      const after = input.slice((match.index ?? 0) + match[0].length).trim();
      return { command: rule.command, subject: after.replace(/^[:\-\s]+/, "").replace(/[?.!]+$/, "") };
    }
  }
  return { command: null, subject: "" };
}

/** Which drafts are ready to show, split the way the daily brief reports them. */
export function summariseDrafts(drafts: readonly ContentDraftV1[]): { ready: number; scripts: number; stale: number } {
  let ready = 0;
  let scripts = 0;
  let stale = 0;
  for (const draft of drafts) {
    if (draft.reviewStatus === "STALE" || draft.freshness === "STALE") { stale += 1; continue; }
    const isScript = draft.format === "SHORT_VIDEO_SCRIPT" || draft.format === "REEL_SCRIPT"
      || draft.format === "TIKTOK_SCRIPT" || draft.format === "YOUTUBE_SHORT_SCRIPT";
    if (isScript) scripts += 1; else ready += 1;
  }
  return { ready, scripts, stale };
}
