/**
 * Who the Owner is, professionally, in public.
 *
 * A sales brand profile is the thing every generated post, script and page is written from, which
 * makes it the single most dangerous place in this vertical to be generous. Generic "car salesman
 * personal branding" advice fills exactly these fields with plausible invention — years of
 * experience, a sales rank, a certification, a customer testimonial — and once one of those reaches
 * a public post the Owner has made a claim about himself he cannot support. A dealership is a
 * regulated, reputational business; an invented credential is worse than an empty profile.
 *
 * So this module treats unverifiable self-description as a category, not a field. `claims` may only
 * hold statements that cite evidence, and the constructor refuses the specific attributes that
 * marketing copy reaches for first. Everything else stays null, and null is allowed to be the final
 * answer — an "About" section that says less is not a defect.
 *
 * Nothing here reaches a network or a social platform.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";

export type SalesBrandVoiceV1 =
  | "PLAIN" | "WARM" | "TECHNICAL" | "ENTHUSIASTIC" | "CONSULTATIVE";

export type SalesBrandToneV1 = "PROFESSIONAL" | "FRIENDLY" | "DIRECT" | "EDUCATIONAL";

/**
 * The subjects the Owner posts about.
 *
 * Configurable rather than fixed, because a pillar the Owner has no material for produces filler,
 * and filler is what makes a sales feed worth muting.
 */
export type ContentPillarV1 =
  | "CURRENT_INVENTORY"
  | "NEW_ARRIVAL"
  | "LOT_WALK"
  | "VEHICLE_EDUCATION"
  | "MODEL_COMPARISON"
  | "FEATURE_EXPLANATION"
  | "CUSTOMER_FAQ"
  | "BUYING_GUIDE"
  | "PERSONAL_BRAND"
  | "PRICE_CHANGE"
  | "INVENTORY_CHANGE"
  | "SHORT_VIDEO"
  | "LOCAL_RELEVANCE"
  // Consent-gated. Listed in the type so a caller can name them and be told no.
  | "CUSTOMER_STORY"
  | "DELIVERY_STORY";

export const DEFAULT_CONTENT_PILLARS: readonly ContentPillarV1[] = [
  "CURRENT_INVENTORY", "NEW_ARRIVAL", "LOT_WALK", "VEHICLE_EDUCATION", "MODEL_COMPARISON",
  "FEATURE_EXPLANATION", "CUSTOMER_FAQ", "BUYING_GUIDE", "PRICE_CHANGE", "INVENTORY_CHANGE",
  "SHORT_VIDEO",
];

/**
 * Pillars that cannot be used from AION's own knowledge alone.
 *
 * A delivery or customer story is about a real person who has not agreed to appear in marketing, and
 * a local-relevance post asserts something about an event or place AION did not attend. Each needs
 * something AION does not have — consent, or first-hand evidence — so they stay closed until the
 * Owner opens them with the evidence in hand.
 */
export const CONSENT_REQUIRED_PILLARS: ReadonlySet<ContentPillarV1> = new Set([
  "CUSTOMER_STORY", "DELIVERY_STORY", "LOCAL_RELEVANCE",
]);

/** A public claim, and what supports it. A claim with no support is not a claim, it is a wish. */
export interface BrandClaimV1 {
  statement: string;
  /** Evidence refs. Required — a claim cannot be constructed without at least one. */
  sourceRefs: string[];
  verifiedAt: IsoTimestamp;
}

/**
 * Self-descriptions AION must never generate.
 *
 * Named individually rather than caught by a general rule because these are precisely the phrases
 * that make a personal sales brand sound credible, which is why a generator reaches for them and why
 * a reviewer skims past them.
 */
export const UNVERIFIABLE_BRAND_ATTRIBUTES: readonly string[] = [
  "awards", "salesVolume", "salesRank", "yearsExperience", "yearsAtDealership",
  "testimonials", "certifications", "manufacturerCertified", "topSalesperson",
  "customerRating", "reviewScore", "dealerAuthorized",
];

export interface SalesBrandProfileV1 {
  schema: "aion.sales-brand.v1";
  workspace: string;
  /** Everything below may legitimately be null. Null means unknown, and unknown is publishable as silence. */
  displayName: string | null;
  professionalRole: string | null;
  dealershipName: string | null;
  serviceArea: string | null;
  brandPromise: string | null;
  voice: SalesBrandVoiceV1;
  tone: SalesBrandToneV1;
  audience: string | null;
  contentPillars: ContentPillarV1[];
  /** Subjects the Owner does not want raised, e.g. politics, competitor disparagement. */
  topicsToAvoid: string[];
  /** Claims that cite evidence. Empty is the correct default. */
  claims: BrandClaimV1[];
  claimsPolicy: string;
  contactPreferences: { preferred: "phone" | "text" | "email" | "form" | null; note: string | null };
  complianceNotes: string[];
  websiteIdentity: { siteName: string | null; domain: string | null; tagline: string | null };
  /** Only handles the Owner actually confirmed. Never guessed from a name. */
  socialHandles: Array<{ platform: string; handle: string }>;
  updatedAt: IsoTimestamp;
  sourceRefs: string[];
}

export interface SalesBrandRefusalV1 {
  refused: true;
  reason: string;
}

export const SALES_BRAND_SCHEMA_V1 = "aion.sales-brand.v1" as const;

/**
 * The default claims policy.
 *
 * Written as a sentence the Owner can read and disagree with, rather than as a flag. A policy nobody
 * can quote is a policy nobody can enforce.
 */
export const DEFAULT_CLAIMS_POLICY =
  "Only state what current dealership evidence supports. Never state price, availability, financing, "
  + "incentives, or trade value without a cited current source. Never describe experience, awards, "
  + "rankings, or certifications that are not on file.";

export interface BuildSalesBrandInputV1 {
  workspace: string;
  displayName?: string | null;
  professionalRole?: string | null;
  dealershipName?: string | null;
  serviceArea?: string | null;
  brandPromise?: string | null;
  voice?: SalesBrandVoiceV1;
  tone?: SalesBrandToneV1;
  audience?: string | null;
  contentPillars?: readonly ContentPillarV1[];
  topicsToAvoid?: readonly string[];
  claims?: ReadonlyArray<{ statement: string; sourceRefs?: readonly string[]; verifiedAt?: IsoTimestamp }>;
  claimsPolicy?: string;
  contactPreferences?: { preferred?: "phone" | "text" | "email" | "form" | null; note?: string | null };
  complianceNotes?: readonly string[];
  websiteIdentity?: { siteName?: string | null; domain?: string | null; tagline?: string | null };
  socialHandles?: ReadonlyArray<{ platform: string; handle: string }>;
  now: IsoTimestamp;
  sourceRefs?: readonly string[];
  /** Anything not modelled above. Present so the guard below has something to catch. */
  extra?: Record<string, unknown>;
}

/**
 * Build a profile, or refuse.
 *
 * The refusal path exists for one case that matters: a caller — a future UI, an import, a model —
 * supplying an attribute like `yearsExperience`. Silently dropping it would be safe for the record
 * and unsafe for the Owner, who would believe AION knows something it does not and would find it
 * missing from a post later. Refusing says which field and why.
 */
export function buildSalesBrandProfile(
  input: BuildSalesBrandInputV1,
): SalesBrandProfileV1 | SalesBrandRefusalV1 {
  const extra = input.extra ?? {};
  for (const key of Object.keys(extra)) {
    if (UNVERIFIABLE_BRAND_ATTRIBUTES.includes(key)) {
      return {
        refused: true,
        reason:
          `"${key}" is a claim about the Owner that AION cannot verify. Record it as a claim with a `
          + `source if it is true, or leave it out — an empty profile is safer than an invented credential`,
      };
    }
  }

  const claims: BrandClaimV1[] = [];
  for (const claim of input.claims ?? []) {
    const refs = [...(claim.sourceRefs ?? [])].filter(Boolean);
    if (!refs.length) {
      return {
        refused: true,
        reason: `the claim "${String(claim.statement).slice(0, 60)}" cites no evidence — a public statement about the Owner needs a source`,
      };
    }
    claims.push({
      statement: String(claim.statement).slice(0, 300),
      sourceRefs: refs,
      verifiedAt: claim.verifiedAt ?? input.now,
    });
  }

  return {
    schema: SALES_BRAND_SCHEMA_V1,
    workspace: input.workspace,
    displayName: nullable(input.displayName),
    professionalRole: nullable(input.professionalRole),
    dealershipName: nullable(input.dealershipName),
    serviceArea: nullable(input.serviceArea),
    brandPromise: nullable(input.brandPromise),
    voice: input.voice ?? "PLAIN",
    tone: input.tone ?? "PROFESSIONAL",
    audience: nullable(input.audience),
    contentPillars: [...(input.contentPillars ?? DEFAULT_CONTENT_PILLARS)],
    topicsToAvoid: [...(input.topicsToAvoid ?? [])],
    claims,
    claimsPolicy: input.claimsPolicy ?? DEFAULT_CLAIMS_POLICY,
    contactPreferences: {
      preferred: input.contactPreferences?.preferred ?? null,
      note: nullable(input.contactPreferences?.note),
    },
    complianceNotes: [...(input.complianceNotes ?? [])],
    websiteIdentity: {
      siteName: nullable(input.websiteIdentity?.siteName),
      domain: nullable(input.websiteIdentity?.domain),
      tagline: nullable(input.websiteIdentity?.tagline),
    },
    socialHandles: [...(input.socialHandles ?? [])].map((h) => ({
      platform: String(h.platform).slice(0, 40),
      handle: String(h.handle).slice(0, 80),
    })),
    updatedAt: input.now,
    sourceRefs: [...(input.sourceRefs ?? [])],
  };
}

function nullable(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, 500) : null;
}

/** Is this pillar usable from AION's own grounded knowledge, or does it need the Owner first? */
export function pillarIsSelfServable(pillar: ContentPillarV1): boolean {
  return !CONSENT_REQUIRED_PILLARS.has(pillar);
}

/**
 * What the Owner still has to tell AION.
 *
 * Surfaced rather than defaulted. A profile silently filled with reasonable guesses is one the Owner
 * never corrects, because nothing ever looks wrong.
 */
export function brandProfileGaps(profile: SalesBrandProfileV1): string[] {
  const gaps: string[] = [];
  if (!profile.displayName) gaps.push("the name you want to appear under");
  if (!profile.dealershipName) gaps.push("which dealership you're writing as");
  if (!profile.serviceArea) gaps.push("the area you serve");
  if (!profile.brandPromise) gaps.push("what you want to be known for");
  if (!profile.contactPreferences.preferred) gaps.push("how you want people to reach you");
  if (!profile.websiteIdentity.siteName) gaps.push("what the site should be called");
  if (!profile.socialHandles.length) gaps.push("your social handles, if you have them");
  return gaps;
}

/** Owner-facing summary that states the unknowns rather than papering over them. */
export function describeSalesBrand(profile: SalesBrandProfileV1): string {
  const lines: string[] = [];
  lines.push(
    profile.displayName
      ? `Publishing as ${profile.displayName}${profile.professionalRole ? `, ${profile.professionalRole}` : ""}${profile.dealershipName ? ` at ${profile.dealershipName}` : ""}.`
      : "I don't have a name to publish under yet.",
  );
  if (profile.brandPromise) lines.push(`What you want to be known for: ${profile.brandPromise}`);
  lines.push(`Subjects: ${profile.contentPillars.map(pillarLabel).join(", ")}.`);
  if (profile.topicsToAvoid.length) lines.push(`Staying off: ${profile.topicsToAvoid.join(", ")}.`);
  lines.push(
    profile.claims.length
      ? `${profile.claims.length} claim(s) on file, each with a source.`
      : "No claims about your record are on file, so nothing will say you have one.",
  );
  const gaps = brandProfileGaps(profile);
  if (gaps.length) {
    lines.push("");
    lines.push(`Still need from you: ${gaps.join("; ")}.`);
  }
  return lines.join("\n");
}

export function pillarLabel(pillar: ContentPillarV1): string {
  const labels: Record<ContentPillarV1, string> = {
    CURRENT_INVENTORY: "current inventory",
    NEW_ARRIVAL: "new arrivals",
    LOT_WALK: "lot walks",
    VEHICLE_EDUCATION: "vehicle education",
    MODEL_COMPARISON: "model comparisons",
    FEATURE_EXPLANATION: "feature explanations",
    CUSTOMER_FAQ: "customer FAQs",
    BUYING_GUIDE: "buying guides",
    PERSONAL_BRAND: "introducing yourself",
    PRICE_CHANGE: "price changes",
    INVENTORY_CHANGE: "inventory changes",
    SHORT_VIDEO: "short video",
    LOCAL_RELEVANCE: "local relevance",
    CUSTOMER_STORY: "customer stories",
    DELIVERY_STORY: "delivery stories",
  };
  return labels[pillar];
}

/**
 * Bridge from the workspace-level brand DNA that already exists.
 *
 * `BrandDnaV1` is AION's general brand model and this profile is the automotive-sales specialisation
 * of it — not a rival. Deriving rather than duplicating means the Owner maintains voice, audience and
 * forbidden claims in one place; `forbiddenClaims` in particular must not fork, because two lists of
 * things never to say is a guarantee that one of them is out of date.
 *
 * The fields `BrandDnaV1` has no opinion about — dealership, service area, contact preference — stay
 * null until the Owner fills them.
 */
export function salesBrandFromBrandDna(input: {
  dna: {
    workspaceId: string; audience: string; voice: string; tone: string;
    claims: string[]; forbiddenClaims: string[]; provenanceSourceRef: string; updatedAt: IsoTimestamp;
  };
  now: IsoTimestamp;
}): SalesBrandProfileV1 | SalesBrandRefusalV1 {
  const voice = (["PLAIN", "WARM", "TECHNICAL", "ENTHUSIASTIC", "CONSULTATIVE"] as const)
    .find((v) => v.toLowerCase() === String(input.dna.voice).trim().toLowerCase()) ?? "PLAIN";
  const tone = (["PROFESSIONAL", "FRIENDLY", "DIRECT", "EDUCATIONAL"] as const)
    .find((t) => t.toLowerCase() === String(input.dna.tone).trim().toLowerCase()) ?? "PROFESSIONAL";
  return buildSalesBrandProfile({
    workspace: input.dna.workspaceId,
    audience: input.dna.audience,
    voice,
    tone,
    // DNA claims arrive already curated by the Owner; they carry the DNA's own provenance ref.
    claims: input.dna.claims.filter(Boolean).map((statement) => ({
      statement,
      sourceRefs: [input.dna.provenanceSourceRef].filter(Boolean),
      verifiedAt: input.dna.updatedAt,
    })),
    topicsToAvoid: input.dna.forbiddenClaims,
    now: input.now,
    sourceRefs: [input.dna.provenanceSourceRef].filter(Boolean),
  });
}
