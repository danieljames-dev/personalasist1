/**
 * What is actually worth posting about today.
 *
 * The alternative to this module is the thing every "social media for car salespeople" guide
 * produces: a fixed calendar that demands five posts a week whether or not anything happened. That
 * calendar is why most dealership feeds are noise — it rewards filling slots, and filler is what
 * teaches an audience to scroll past. So opportunities are *derived from things that occurred* — a
 * car arrived, a price moved, several people asked the same question — and when nothing occurred the
 * honest output is nothing.
 *
 * Two rules shape everything here.
 *
 * **Customer demand is only ever aggregate.** One person wanting an AWD RAV4 is that person's
 * business, and a post prompted by it is traceable back to them in a town where the Owner sells to
 * a few hundred people a year. Several people asking the same question is a market observation and
 * belongs to nobody. The threshold is enforced at construction, not left to the drafting layer,
 * because by the time text exists the identity has already leaked into it.
 *
 * **Price is the highest-risk subject and is marked as such.** A price opportunity always requires
 * Owner review, because the failure — advertising a number the dealership is not honouring — is a
 * problem for the Owner personally, not just an inaccurate post.
 *
 * Nothing here reaches a social network, and nothing here writes state.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import type { ContentPillarV1 } from "./sales-brand.js";
import { CONSENT_REQUIRED_PILLARS } from "./sales-brand.js";

export type ContentSignalKindV1 =
  | "NEW_VEHICLE_ON_LOT"
  | "NEW_ONLINE_LISTING"
  | "PRICE_CHANGE"
  | "UNUSUAL_TRIM"
  | "CUSTOMER_DEMAND"
  | "FREQUENT_QUESTION"
  | "VEHICLE_CUSTOMER_MATCH"
  | "NEW_MODEL_KNOWLEDGE"
  | "LOT_OBSERVATION"
  | "WEBSITE_CONTENT_GAP";

/**
 * How many distinct customers must show an interest before it becomes a subject.
 *
 * Three rather than two: in a single-store territory two people are still identifiable to anyone who
 * was on the floor that week, and the Owner is the person who would be asked about it.
 */
export const MIN_AGGREGATE_DEMAND_CUSTOMERS = 3;

export interface ContentSignalV1 {
  kind: ContentSignalKindV1;
  workspace: string;
  /** What the signal is about, in plain words: "RAV4 AWD", "Camry hybrid mileage". */
  subject: string;
  observedAt: IsoTimestamp;
  /** Internal provenance. Never rendered into public text — see `content-draft.ts`. */
  sourceRefs: string[];
  vehicleRef?: string | null;
  /** Aggregate count for demand and question signals. Identities are never carried. */
  customerCount?: number | null;
  detail?: string;
  priceBefore?: number | null;
  priceAfter?: number | null;
}

export type ContentClaimsRiskV1 = "LOW" | "MEDIUM" | "HIGH";

export type ContentFormatV1 =
  | "FACEBOOK_POST"
  | "INSTAGRAM_CAPTION"
  | "SHORT_VIDEO_SCRIPT"
  | "REEL_SCRIPT"
  | "TIKTOK_SCRIPT"
  | "YOUTUBE_SHORT_SCRIPT"
  | "WEBSITE_FEATURED_VEHICLE"
  | "WEBSITE_ARTICLE"
  | "FAQ"
  | "CUSTOMER_SHARE_MESSAGE";

export interface ContentOpportunityV1 {
  opportunityId: OpaqueId;
  workspace: string;
  type: ContentSignalKindV1;
  pillar: ContentPillarV1;
  subject: string;
  vehicleRef: string | null;
  sourceRefs: string[];
  /** Why this is worth posting, in the Owner's language. */
  reason: string;
  /** 0–100. Comparative only; it ranks a day's options against each other. */
  priority: number;
  observedAt: IsoTimestamp;
  suggestedFormats: ContentFormatV1[];
  claimsRisk: ContentClaimsRiskV1;
  requiresOwnerReview: boolean;
  /** Set when the subject decays — inventory moves, prices change. Null for evergreen education. */
  expiresAt: IsoTimestamp | null;
  /** Aggregate count when demand-derived. Never an identity. */
  customerCount: number | null;
}

export interface ContentOpportunityRefusalV1 {
  refused: true;
  reason: string;
}

/** Inventory-linked content decays. A week is roughly how long a listing claim stays safe to repeat. */
const INVENTORY_TTL_DAYS = 7;
const PRICE_TTL_DAYS = 3;

function addDays(iso: IsoTimestamp, days: number): IsoTimestamp {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}

const PILLAR_FOR: Record<ContentSignalKindV1, ContentPillarV1> = {
  NEW_VEHICLE_ON_LOT: "NEW_ARRIVAL",
  NEW_ONLINE_LISTING: "CURRENT_INVENTORY",
  PRICE_CHANGE: "PRICE_CHANGE",
  UNUSUAL_TRIM: "FEATURE_EXPLANATION",
  CUSTOMER_DEMAND: "CURRENT_INVENTORY",
  FREQUENT_QUESTION: "CUSTOMER_FAQ",
  VEHICLE_CUSTOMER_MATCH: "CURRENT_INVENTORY",
  NEW_MODEL_KNOWLEDGE: "VEHICLE_EDUCATION",
  LOT_OBSERVATION: "LOT_WALK",
  WEBSITE_CONTENT_GAP: "BUYING_GUIDE",
};

const FORMATS_FOR: Record<ContentSignalKindV1, ContentFormatV1[]> = {
  NEW_VEHICLE_ON_LOT: ["SHORT_VIDEO_SCRIPT", "REEL_SCRIPT", "FACEBOOK_POST", "WEBSITE_FEATURED_VEHICLE"],
  NEW_ONLINE_LISTING: ["FACEBOOK_POST", "INSTAGRAM_CAPTION", "WEBSITE_FEATURED_VEHICLE", "CUSTOMER_SHARE_MESSAGE"],
  PRICE_CHANGE: ["FACEBOOK_POST", "CUSTOMER_SHARE_MESSAGE"],
  UNUSUAL_TRIM: ["SHORT_VIDEO_SCRIPT", "INSTAGRAM_CAPTION", "WEBSITE_ARTICLE"],
  CUSTOMER_DEMAND: ["FACEBOOK_POST", "INSTAGRAM_CAPTION", "WEBSITE_ARTICLE"],
  FREQUENT_QUESTION: ["FAQ", "SHORT_VIDEO_SCRIPT", "WEBSITE_ARTICLE", "FACEBOOK_POST"],
  VEHICLE_CUSTOMER_MATCH: ["CUSTOMER_SHARE_MESSAGE"],
  NEW_MODEL_KNOWLEDGE: ["WEBSITE_ARTICLE", "FACEBOOK_POST", "YOUTUBE_SHORT_SCRIPT"],
  LOT_OBSERVATION: ["REEL_SCRIPT", "TIKTOK_SCRIPT", "SHORT_VIDEO_SCRIPT"],
  WEBSITE_CONTENT_GAP: ["WEBSITE_ARTICLE", "FAQ"],
};

/** Anything that quotes a number a customer could hold the dealership to. */
const HIGH_RISK: ReadonlySet<ContentSignalKindV1> = new Set(["PRICE_CHANGE"]);
const MEDIUM_RISK: ReadonlySet<ContentSignalKindV1> = new Set([
  "NEW_ONLINE_LISTING", "NEW_VEHICLE_ON_LOT", "VEHICLE_CUSTOMER_MATCH", "CUSTOMER_DEMAND",
]);

function claimsRiskFor(kind: ContentSignalKindV1): ContentClaimsRiskV1 {
  if (HIGH_RISK.has(kind)) return "HIGH";
  if (MEDIUM_RISK.has(kind)) return "MEDIUM";
  return "LOW";
}

/**
 * Base priority per signal kind.
 *
 * A question several customers asked outranks a new arrival, because the question is evidence of
 * demand the Owner has already met in person and the arrival is only evidence that a truck came.
 */
const BASE_PRIORITY: Record<ContentSignalKindV1, number> = {
  FREQUENT_QUESTION: 78,
  CUSTOMER_DEMAND: 74,
  NEW_VEHICLE_ON_LOT: 70,
  PRICE_CHANGE: 66,
  UNUSUAL_TRIM: 62,
  NEW_ONLINE_LISTING: 58,
  LOT_OBSERVATION: 54,
  NEW_MODEL_KNOWLEDGE: 50,
  VEHICLE_CUSTOMER_MATCH: 46,
  WEBSITE_CONTENT_GAP: 42,
};

/**
 * Turn one grounded signal into an opportunity, or refuse it.
 *
 * Refusal is the interesting path. A demand signal below the aggregation threshold is not downgraded
 * or held for later — it is declined, because there is no safe version of "one customer wants this"
 * as public content.
 */
export function contentOpportunityFromSignal(input: {
  signal: ContentSignalV1;
  opportunityId: OpaqueId;
  enabledPillars: readonly ContentPillarV1[];
  now: IsoTimestamp;
}): ContentOpportunityV1 | ContentOpportunityRefusalV1 {
  const s = input.signal;
  const pillar = PILLAR_FOR[s.kind];

  if (!input.enabledPillars.includes(pillar)) {
    return { refused: true, reason: `${pillar} is not one of the subjects you post about` };
  }
  if (CONSENT_REQUIRED_PILLARS.has(pillar)) {
    return { refused: true, reason: `${pillar} needs consent or first-hand evidence AION does not have` };
  }
  if (!s.sourceRefs.length) {
    return { refused: true, reason: `a ${s.kind} signal with no source is not grounded enough to post from` };
  }

  // Aggregation floor. Enforced here so no drafting path can reach a single customer's want.
  if (s.kind === "CUSTOMER_DEMAND" || s.kind === "FREQUENT_QUESTION") {
    const count = s.customerCount ?? 0;
    if (count < MIN_AGGREGATE_DEMAND_CUSTOMERS) {
      return {
        refused: true,
        reason:
          `only ${count} customer(s) raised "${s.subject}" — below the ${MIN_AGGREGATE_DEMAND_CUSTOMERS} `
          + `needed for it to be a market observation rather than somebody's private business`,
      };
    }
  }

  if (s.kind === "PRICE_CHANGE" && (s.priceAfter == null || !Number.isFinite(s.priceAfter))) {
    return { refused: true, reason: "a price-change opportunity needs the new price, from a real observation" };
  }

  const claimsRisk = claimsRiskFor(s.kind);
  const expiresAt =
    s.kind === "PRICE_CHANGE" ? addDays(s.observedAt, PRICE_TTL_DAYS)
    : s.vehicleRef ? addDays(s.observedAt, INVENTORY_TTL_DAYS)
    : null;

  return {
    opportunityId: input.opportunityId,
    workspace: s.workspace,
    type: s.kind,
    pillar,
    subject: s.subject,
    vehicleRef: s.vehicleRef ?? null,
    sourceRefs: [...s.sourceRefs],
    reason: reasonFor(s),
    priority: priorityFor(s, input.now),
    observedAt: s.observedAt,
    suggestedFormats: [...FORMATS_FOR[s.kind]],
    claimsRisk,
    // A price claim is the Owner's personal exposure, so it never bypasses him.
    requiresOwnerReview: claimsRisk === "HIGH",
    expiresAt,
    customerCount: s.customerCount ?? null,
  };
}

function reasonFor(s: ContentSignalV1): string {
  switch (s.kind) {
    case "FREQUENT_QUESTION":
      return `${s.customerCount} customers have asked about ${s.subject} — answering it once publicly saves the conversation`;
    case "CUSTOMER_DEMAND":
      return `${s.customerCount} customers are looking for ${s.subject}`;
    case "NEW_VEHICLE_ON_LOT":
      return `${s.subject} arrived on the lot`;
    case "NEW_ONLINE_LISTING":
      return `${s.subject} is newly listed online`;
    case "PRICE_CHANGE":
      return s.priceBefore != null
        ? `${s.subject} moved from $${s.priceBefore.toLocaleString("en-US")} to $${s.priceAfter!.toLocaleString("en-US")}`
        : `${s.subject} has a new advertised price`;
    case "UNUSUAL_TRIM":
      return `${s.subject} is not a trim that turns up often`;
    case "LOT_OBSERVATION":
      return `you noticed ${s.subject} on a lot walk`;
    case "NEW_MODEL_KNOWLEDGE":
      return `new model information for ${s.subject}`;
    case "VEHICLE_CUSTOMER_MATCH":
      return `${s.subject} fits what someone has been looking for`;
    default:
      return `${s.subject} is missing from the site`;
  }
}

/** Recency matters: a car that arrived today is more interesting than one that arrived last week. */
function priorityFor(s: ContentSignalV1, now: IsoTimestamp): number {
  const base = BASE_PRIORITY[s.kind];
  const ageDays = Math.max(0, Math.floor((Date.parse(now) - Date.parse(s.observedAt)) / 86_400_000));
  const decay = Math.min(30, ageDays * 4);
  const demandBoost = s.customerCount && s.customerCount > MIN_AGGREGATE_DEMAND_CUSTOMERS
    ? Math.min(12, (s.customerCount - MIN_AGGREGATE_DEMAND_CUSTOMERS) * 3)
    : 0;
  return Math.max(1, Math.min(100, base - decay + demandBoost));
}

export interface RankedOpportunitiesV1 {
  opportunities: ContentOpportunityV1[];
  /** Signals that produced nothing, and why. Reported rather than dropped. */
  declined: Array<{ subject: string; reason: string }>;
}

/**
 * Rank a day's signals.
 *
 * Expired opportunities are dropped rather than ranked low: a stale inventory claim is not a weak
 * post, it is a wrong one.
 */
export function rankContentOpportunities(input: {
  signals: readonly ContentSignalV1[];
  enabledPillars: readonly ContentPillarV1[];
  workspace: string;
  now: IsoTimestamp;
  nextId: (index: number) => OpaqueId;
}): RankedOpportunitiesV1 {
  const opportunities: ContentOpportunityV1[] = [];
  const declined: Array<{ subject: string; reason: string }> = [];

  input.signals.forEach((signal, index) => {
    // Workspace is a boundary, not a filter: dealership content is built from dealership signals.
    if (signal.workspace !== input.workspace) {
      declined.push({ subject: signal.subject, reason: "belongs to a different workspace" });
      return;
    }
    const built = contentOpportunityFromSignal({
      signal, opportunityId: input.nextId(index),
      enabledPillars: input.enabledPillars, now: input.now,
    });
    if ("refused" in built) {
      declined.push({ subject: signal.subject, reason: built.reason });
      return;
    }
    if (built.expiresAt && Date.parse(built.expiresAt) <= Date.parse(input.now)) {
      declined.push({ subject: signal.subject, reason: "the observation behind it has expired — it would need re-checking first" });
      return;
    }
    opportunities.push(built);
  });

  opportunities.sort((a, b) => b.priority - a.priority || (a.subject < b.subject ? -1 : 1));
  return { opportunities, declined };
}

/** True when this opportunity's grounding has aged out and must be re-observed before use. */
export function opportunityExpired(opportunity: ContentOpportunityV1, now: IsoTimestamp): boolean {
  return Boolean(opportunity.expiresAt) && Date.parse(opportunity.expiresAt!) <= Date.parse(now);
}
