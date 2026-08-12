/**
 * One grounded vehicle, many surfaces.
 *
 * The architectural rule this file exists to enforce is that a Facebook post, a Reel script, a
 * website feature and a message the Owner texts a customer are **renderings of the same facts**, not
 * four separately-authored pieces of content. The moment they diverge, the price in the post and the
 * price on the site drift apart, and the customer who spotted the difference is standing in front of
 * the Owner asking which one is true.
 *
 * So `VehicleContentFactsV1` is assembled once from the inventory record, and every generator reads
 * only from it. A format decides tone and length; it never decides what is true.
 *
 * ## Price is three different facts, never one
 *
 * A window sticker MSRP is not an advertised price, and an advertised price is not a sale price.
 * They are separate observations from separate sources with separate ages, and the failure mode is
 * specific: `$53,378` read off a Monroney label becoming *"Now only $53,378"* in a post. That is an
 * advertisement the dealership never authorised, made in the Owner's name, and the person who has to
 * answer for it is the Owner. So a price carries its kind and its source, only a website-advertised
 * figure may be quoted as a price, and an unknown price produces a sentence inviting the question
 * rather than a number.
 *
 * ## Content about inventory rots
 *
 * A car sells. A price moves. A draft written on Tuesday is not automatically true on Friday, and
 * "still says CURRENT because nobody re-checked" is how a sold vehicle stays advertised. Freshness is
 * therefore re-derived from the live record rather than stored and trusted.
 *
 * Nothing here reaches a network, a social platform or a website.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import type { VehicleRecordV1 } from "./vehicle-inventory.js";
import type { ContentFormatV1, ContentOpportunityV1 } from "./content-opportunity.js";
import type { SalesBrandProfileV1 } from "./sales-brand.js";

export const CONTENT_DRAFT_SCHEMA_V1 = "aion.content-draft.v1" as const;

// ---------------------------------------------------------------------------
// Price truth
// ---------------------------------------------------------------------------

export type PriceKindV1 =
  /** What the dealer's public site currently advertises. The only kind quotable as "the price". */
  | "WEBSITE_ADVERTISED"
  /** What the Monroney label says. A manufacturer figure, not an offer. */
  | "STICKER_MSRP"
  /** Seen somewhere else — a tag, a screen. Recorded, never advertised. */
  | "DEALER_OBSERVED"
  | "UNKNOWN";

export interface PriceFactV1 {
  kind: PriceKindV1;
  amount: number | null;
  observedAt: IsoTimestamp | null;
  /** Where it came from — a listing URL or an evidence ref. Required for any non-UNKNOWN price. */
  sourceRef: string | null;
}

export const UNKNOWN_PRICE: PriceFactV1 = {
  kind: "UNKNOWN", amount: null, observedAt: null, sourceRef: null,
};

/**
 * Read the strongest price the record actually supports.
 *
 * Advertised beats MSRP because advertised is what a customer can hold the store to. When only an
 * MSRP exists the result is an MSRP — deliberately *not* silently promoted, which is the conflation
 * this whole module exists to prevent.
 */
export function priceFactFromVehicle(vehicle: VehicleRecordV1): PriceFactV1 {
  const history = [...(vehicle.priceHistory ?? [])]
    .filter((entry) => entry && entry.at)
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  const latest = history[0];
  if (!latest) return UNKNOWN_PRICE;

  if (typeof latest.advertisedPrice === "number" && Number.isFinite(latest.advertisedPrice)) {
    return {
      kind: "WEBSITE_ADVERTISED", amount: latest.advertisedPrice,
      observedAt: latest.at, sourceRef: latest.sourceUrl || null,
    };
  }
  if (typeof latest.dealerPrice === "number" && Number.isFinite(latest.dealerPrice)) {
    return {
      kind: "DEALER_OBSERVED", amount: latest.dealerPrice,
      observedAt: latest.at, sourceRef: latest.sourceUrl || null,
    };
  }
  if (typeof latest.msrp === "number" && Number.isFinite(latest.msrp)) {
    return {
      kind: "STICKER_MSRP", amount: latest.msrp,
      observedAt: latest.at, sourceRef: latest.sourceUrl || null,
    };
  }
  return UNKNOWN_PRICE;
}

const money = (n: number): string => `$${n.toLocaleString("en-US")}`;

/**
 * How a price may be said out loud.
 *
 * Each kind gets its own sentence, and none of them is a sales phrase. "Now only", "sale price" and
 * "marked down" all assert a comparison to a previous price that AION has not established, so no
 * branch here can produce one.
 */
export function priceSentence(fact: PriceFactV1): string {
  if (fact.kind === "WEBSITE_ADVERTISED" && fact.amount != null) {
    return `Listed at ${money(fact.amount)} on the dealer site${fact.observedAt ? ` as of ${fact.observedAt.slice(0, 10)}` : ""}.`;
  }
  if (fact.kind === "STICKER_MSRP" && fact.amount != null) {
    // Named as the sticker so nobody reads it as an offer. The disclaimer deliberately avoids the
    // words "sale price": the claim scanner below rejects that phrase, so wording it that way would
    // make every MSRP-only vehicle refuse to draft — and a caption truncated mid-sentence would show
    // the phrase without the "not".
    return `Window sticker MSRP is ${money(fact.amount)} — that is the manufacturer's sticker, not what the dealer is advertising.`;
  }
  if (fact.kind === "DEALER_OBSERVED" && fact.amount != null) {
    return `I have ${money(fact.amount)} recorded from an in-store observation — check the current listing before quoting it.`;
  }
  return "I do not have a current published price for this one — message me and I will get you today's number.";
}

/** True when this price may be presented to the public as the vehicle's price. */
export function priceIsQuotable(fact: PriceFactV1): boolean {
  return fact.kind === "WEBSITE_ADVERTISED" && fact.amount != null && Boolean(fact.sourceRef);
}

// ---------------------------------------------------------------------------
// The single grounded facts object
// ---------------------------------------------------------------------------

export interface VehicleContentFactsV1 {
  vehicleRef: OpaqueId;
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  condition: string | null;
  exteriorColor: string | null;
  mileage: number | null;
  stockNumber: string | null;
  /** Only features with evidence behind them. Never inferred from a trim name. */
  features: string[];
  price: PriceFactV1;
  inventoryStatus: string;
  observedAt: IsoTimestamp | null;
  sourceRefs: string[];
}

export function vehicleContentFacts(input: {
  vehicle: VehicleRecordV1;
  /** Supplied by the caller with its own evidence — this module never invents equipment. */
  features?: readonly string[];
  extraSourceRefs?: readonly string[];
}): VehicleContentFactsV1 {
  const v = input.vehicle;
  const price = priceFactFromVehicle(v);
  return {
    vehicleRef: v.id,
    vin: v.vin ?? null,
    year: v.year ?? null,
    make: v.make ?? null,
    model: v.model ?? null,
    trim: v.trim ?? null,
    condition: v.condition ?? null,
    exteriorColor: v.exteriorColor ?? null,
    mileage: v.mileage ?? null,
    stockNumber: v.stockNumber ?? null,
    features: [...(input.features ?? [])],
    price,
    inventoryStatus: v.presenceStatus,
    observedAt: v.lastOnlineAt ?? v.lastPhysicalAt ?? null,
    sourceRefs: [
      `vehicle:${v.id}`,
      ...(price.sourceRef ? [`price:${price.sourceRef}`] : []),
      ...(input.extraSourceRefs ?? []),
    ],
  };
}

export function vehicleLabel(facts: VehicleContentFactsV1): string {
  return [facts.year, facts.make, facts.model, facts.trim].filter(Boolean).join(" ")
    || facts.vin
    || "this vehicle";
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export type ContentFreshnessV1 = "CURRENT" | "NEEDS_REVERIFY" | "STALE";

export type DraftReviewStatusV1 = "DRAFT" | "NEEDS_OWNER_REVIEW" | "APPROVED" | "STALE";

export interface DraftClaimV1 {
  statement: string;
  sourceRefs: string[];
}

export interface ContentDraftV1 {
  schema: typeof CONTENT_DRAFT_SCHEMA_V1;
  draftId: OpaqueId;
  workspace: string;
  format: ContentFormatV1;
  title: string;
  /** Public-facing text. Nothing internal — no refs, no customer detail — may appear here. */
  body: string;
  opportunityRef: OpaqueId | null;
  vehicleRef: OpaqueId | null;
  /** Internal provenance. Deliberately separate from `body`. */
  sourceRefs: string[];
  claims: DraftClaimV1[];
  priceFact: PriceFactV1;
  priceEvidenceRef: string | null;
  freshness: ContentFreshnessV1;
  reviewStatus: DraftReviewStatusV1;
  /** Fixed at this milestone. Nothing in this repository can publish. */
  publishAuthorityRequired: "PREPARE_ONLY";
  createdAt: IsoTimestamp;
  expiresAt: IsoTimestamp | null;
}

/** Inventory-linked drafts stop being safe to publish after this long without re-checking. */
export const DRAFT_INVENTORY_TTL_DAYS = 7;

// ---------------------------------------------------------------------------
// Safety scanners
// ---------------------------------------------------------------------------

/**
 * Phrases that assert a commercial fact AION cannot establish.
 *
 * Financing, incentives and trade values are regulated advertising claims, and availability is a
 * promise about a car that may already be sold. None of them can be derived from an inventory
 * listing, so any of them appearing in generated text means something invented it.
 */
const INVENTED_CLAIM_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(?:only|just|now)\s*\$\s*[\d,]+/i, label: "sale framing around a price" },
  { pattern: /\bsale price\b|\bmarked down\b|\bdiscount(?:ed)?\b|\bsave \$\s*[\d,]+/i, label: "discount claim" },
  { pattern: /\b\d+(?:\.\d+)?\s*%\s*apr\b|\bapr\b/i, label: "APR claim" },
  { pattern: /\$\s*[\d,]+\s*(?:\/|per\s+)?\s*(?:mo|month)\b|\bmonthly payment\b/i, label: "monthly payment claim" },
  { pattern: /\brebate\b|\bincentive\b|\bcash back\b/i, label: "incentive claim" },
  { pattern: /\btrade[- ]in value\b|\byour trade is worth\b/i, label: "trade value claim" },
  { pattern: /\bguaranteed approv|\bpre[- ]?approved\b|\bfinancing approved\b|\bno credit check\b/i, label: "financing approval claim" },
  { pattern: /\bin stock now\b|\bguaranteed available\b|\bstill available\b/i, label: "availability guarantee" },
];

export function scanDraftForInventedClaims(body: string): string[] {
  const text = String(body ?? "");
  return INVENTED_CLAIM_PATTERNS.filter((rule) => rule.pattern.test(text)).map((rule) => rule.label);
}

export interface PrivateValueV1 {
  kind: "name" | "phone" | "email" | "note" | "transcript";
  value: string;
}

const PHONE_SHAPE = /\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const EMAIL_SHAPE = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i;
/** Internal reference schemes that must never be rendered into public text. */
const INTERNAL_REF_SHAPE = /\b(?:conversation|transcript|relationship|customer|need|commitment|proposal):/i;

/**
 * Find anything in a public draft that belongs to a private person.
 *
 * Two layers on purpose. The shape detectors catch a phone number or an internal reference that
 * reached the body through any route at all, including one nobody anticipated. The `forbidden` list
 * catches the specific customers this content was derived from, whose names are ordinary words a
 * pattern would never flag — a post prompted by Sarah's question must not mention Sarah.
 */
export function scanDraftForPrivateData(
  draft: Pick<ContentDraftV1, "body" | "title">,
  forbidden: readonly PrivateValueV1[] = [],
): string[] {
  const text = `${draft.title}\n${draft.body}`;
  const found: string[] = [];
  if (PHONE_SHAPE.test(text)) found.push("a phone number");
  if (EMAIL_SHAPE.test(text)) found.push("an email address");
  if (INTERNAL_REF_SHAPE.test(text)) found.push("an internal record reference");
  for (const item of forbidden) {
    const value = String(item.value ?? "").trim();
    if (value.length >= 3 && text.toLowerCase().includes(value.toLowerCase())) {
      found.push(`a customer ${item.kind}`);
    }
  }
  return [...new Set(found)];
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

/**
 * Re-derive freshness from the live record.
 *
 * Deliberately recomputed rather than read from the draft. A stored freshness field is only ever as
 * true as the last time somebody remembered to update it, and the whole failure this guards against
 * is nobody remembering.
 */
export function reviewDraftFreshness(input: {
  draft: ContentDraftV1;
  vehicle: VehicleRecordV1 | null;
  now: IsoTimestamp;
}): { freshness: ContentFreshnessV1; reason: string } {
  const { draft, vehicle, now } = input;

  if (!draft.vehicleRef) {
    // Education and FAQ content does not decay with inventory.
    return { freshness: "CURRENT", reason: "not tied to a specific vehicle" };
  }
  if (!vehicle) {
    return { freshness: "STALE", reason: "the vehicle this was written about is no longer in inventory" };
  }
  if (vehicle.presenceStatus === "NO_LONGER_FOUND_ONLINE") {
    return { freshness: "STALE", reason: "the vehicle is no longer listed on the dealer site — it has probably sold" };
  }

  const current = priceFactFromVehicle(vehicle);
  if (draft.priceFact.amount != null && current.amount !== draft.priceFact.amount) {
    return {
      freshness: "NEEDS_REVERIFY",
      reason: current.amount != null
        ? `the price moved from ${money(draft.priceFact.amount)} to ${money(current.amount)} since this was written`
        : "the price this was written from is no longer published",
    };
  }
  if (draft.priceFact.kind !== current.kind) {
    return { freshness: "NEEDS_REVERIFY", reason: "the kind of price on record changed — re-check before using this" };
  }
  if (draft.expiresAt && Date.parse(draft.expiresAt) <= Date.parse(now)) {
    return { freshness: "NEEDS_REVERIFY", reason: "the observation behind this has aged out and needs re-checking" };
  }
  return { freshness: "CURRENT", reason: "still matches the current listing" };
}

/** Apply a freshness review to a draft, moving review status with it. */
export function applyFreshness(draft: ContentDraftV1, review: { freshness: ContentFreshnessV1; reason: string }): ContentDraftV1 {
  return {
    ...draft,
    freshness: review.freshness,
    reviewStatus:
      review.freshness === "STALE" ? "STALE"
      : review.freshness === "NEEDS_REVERIFY" ? "NEEDS_OWNER_REVIEW"
      : draft.reviewStatus,
  };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface GenerateDraftInputV1 {
  draftId: OpaqueId;
  workspace: string;
  format: ContentFormatV1;
  facts: VehicleContentFactsV1 | null;
  opportunity: ContentOpportunityV1;
  brand: SalesBrandProfileV1;
  now: IsoTimestamp;
  /** Aggregate-only context, e.g. "3 customers asked about AWD". Never an identity. */
  aggregateNote?: string | null;
  /** Customers this content was derived from, so their details can be excluded by name. */
  forbiddenValues?: readonly PrivateValueV1[];
}

export interface DraftRefusalV1 {
  refused: true;
  reason: string;
}

/**
 * Produce one draft.
 *
 * Refuses rather than degrades. A draft that exists is a draft the Owner can approve, and the review
 * screen is the wrong place to discover that the price in it came from a window sticker.
 */
export function generateContentDraft(
  input: GenerateDraftInputV1,
): ContentDraftV1 | DraftRefusalV1 {
  const { facts, opportunity, brand, format } = input;

  if (VEHICLE_FORMATS.has(format) && !facts) {
    return { refused: true, reason: `${format} is about a specific vehicle and none was supplied` };
  }
  if (facts && facts.inventoryStatus === "NO_LONGER_FOUND_ONLINE") {
    return { refused: true, reason: `${vehicleLabel(facts)} is no longer listed — it should not be advertised` };
  }

  const price = facts?.price ?? UNKNOWN_PRICE;
  const built = renderBody({ ...input, price });
  const body = built.body;

  const invented = scanDraftForInventedClaims(body);
  if (invented.length) {
    // A generator that produced a forbidden claim is a bug, not a draft to hand to the Owner.
    return { refused: true, reason: `generated text contained ${invented.join(", ")} — refusing rather than asking you to catch it` };
  }
  const leaked = scanDraftForPrivateData({ title: built.title, body }, input.forbiddenValues ?? []);
  if (leaked.length) {
    return { refused: true, reason: `generated text contained ${leaked.join(", ")} — nothing private reaches a public draft` };
  }

  const expiresAt = facts
    ? new Date(Date.parse(input.now) + DRAFT_INVENTORY_TTL_DAYS * 86_400_000).toISOString()
    : null;

  const claims: DraftClaimV1[] = [];
  if (priceIsQuotable(price)) {
    claims.push({ statement: `Advertised at ${money(price.amount!)}`, sourceRefs: [price.sourceRef!] });
  } else if (price.kind === "STICKER_MSRP" && price.amount != null) {
    claims.push({ statement: `Sticker MSRP ${money(price.amount)}`, sourceRefs: [price.sourceRef ?? `vehicle:${facts?.vehicleRef}`] });
  }
  for (const feature of facts?.features ?? []) {
    claims.push({ statement: feature, sourceRefs: facts!.sourceRefs });
  }

  return {
    schema: CONTENT_DRAFT_SCHEMA_V1,
    draftId: input.draftId,
    workspace: input.workspace,
    format,
    title: built.title,
    body,
    opportunityRef: opportunity.opportunityId,
    vehicleRef: facts?.vehicleRef ?? null,
    sourceRefs: [...new Set([...(facts?.sourceRefs ?? []), ...opportunity.sourceRefs])],
    claims,
    priceFact: price,
    priceEvidenceRef: price.sourceRef,
    freshness: "CURRENT",
    // A price claim or a high-risk subject always goes past the Owner.
    reviewStatus: opportunity.requiresOwnerReview || priceIsQuotable(price) ? "NEEDS_OWNER_REVIEW" : "DRAFT",
    publishAuthorityRequired: "PREPARE_ONLY",
    createdAt: input.now,
    expiresAt,
  };
}

const VEHICLE_FORMATS: ReadonlySet<ContentFormatV1> = new Set([
  "WEBSITE_FEATURED_VEHICLE", "CUSTOMER_SHARE_MESSAGE",
]);

const SCRIPT_FORMATS: ReadonlySet<ContentFormatV1> = new Set([
  "SHORT_VIDEO_SCRIPT", "REEL_SCRIPT", "TIKTOK_SCRIPT", "YOUTUBE_SHORT_SCRIPT",
]);

function signOff(brand: SalesBrandProfileV1): string {
  const who = brand.displayName ? brand.displayName : "me";
  const where = brand.dealershipName ? ` at ${brand.dealershipName}` : "";
  const how =
    brand.contactPreferences.preferred === "phone" ? "Give me a call"
    : brand.contactPreferences.preferred === "text" ? "Send me a text"
    : brand.contactPreferences.preferred === "email" ? "Email me"
    : "Message me";
  return `${how} — ${who}${where}.`;
}

/** Every format renders from the same facts. Tone and shape differ; truth does not. */
function renderBody(input: GenerateDraftInputV1 & { price: PriceFactV1 }): { title: string; body: string } {
  const { facts, opportunity, brand, format, price } = input;
  const label = facts ? vehicleLabel(facts) : opportunity.subject;
  const spec = facts
    ? [
        facts.exteriorColor ? `${facts.exteriorColor}` : null,
        facts.condition ? `${facts.condition}` : null,
        facts.mileage != null ? `${facts.mileage.toLocaleString("en-US")} miles` : null,
        facts.stockNumber ? `stock ${facts.stockNumber}` : null,
      ].filter(Boolean).join(" · ")
    : "";
  const featureLine = facts?.features.length ? facts.features.join(", ") : "";
  const priceLine = priceSentence(price);
  const aggregate = input.aggregateNote ? `${input.aggregateNote} ` : "";

  if (SCRIPT_FORMATS.has(format)) {
    const seconds = format === "YOUTUBE_SHORT_SCRIPT" ? 60 : 30;
    return {
      title: `${label} — ${seconds}s script`,
      body: [
        `[0-3s] Hook: "${aggregate}Here's the ${label}."`,
        spec ? `[3-8s] Walk the outside: ${spec}.` : `[3-8s] Walk the outside.`,
        featureLine ? `[8-18s] Point out: ${featureLine}.` : `[8-18s] Show the inside — say only what you can see on camera.`,
        `[18-25s] ${priceLine}`,
        `[25-${seconds}s] ${signOff(brand)}`,
        "",
        "Say nothing about financing, payments or incentives on camera.",
      ].join("\n"),
    };
  }

  if (format === "WEBSITE_FEATURED_VEHICLE") {
    return {
      title: label,
      body: [
        `${label}${spec ? ` — ${spec}` : ""}.`,
        featureLine ? `Features: ${featureLine}.` : "",
        priceLine,
        facts?.observedAt ? `Listing last verified ${facts.observedAt.slice(0, 10)}.` : "",
      ].filter(Boolean).join("\n"),
    };
  }

  if (format === "CUSTOMER_SHARE_MESSAGE") {
    return {
      title: `Share: ${label}`,
      body: [
        `Thought of you — we have a ${label}${spec ? ` (${spec})` : ""}.`,
        featureLine ? `It has ${featureLine}.` : "",
        priceLine,
        "Want me to hold it for a look?",
      ].filter(Boolean).join(" "),
    };
  }

  if (format === "FAQ" || format === "WEBSITE_ARTICLE") {
    return {
      title: opportunity.subject,
      body: [
        `${aggregate}Here's the short answer on ${opportunity.subject}.`,
        "",
        "[Answer from what you know first-hand — keep it to what you can support.]",
        "",
        signOff(brand),
      ].join("\n"),
    };
  }

  if (format === "INSTAGRAM_CAPTION") {
    return {
      title: label,
      body: [
        `${label}${spec ? ` · ${spec}` : ""}`,
        featureLine ? `${featureLine}` : "",
        priceLine,
        signOff(brand),
      ].filter(Boolean).join("\n"),
    };
  }

  // FACEBOOK_POST and anything else conversational.
  return {
    title: label,
    body: [
      `${aggregate}${facts ? `We have a ${label} on the lot` : opportunity.subject}${spec ? ` — ${spec}` : ""}.`,
      featureLine ? `It has ${featureLine}.` : "",
      priceLine,
      signOff(brand),
    ].filter(Boolean).join(" "),
  };
}
