/**
 * The sales presence foundation, tested on the things that would embarrass the Owner.
 *
 * Most of this vertical is generation, and generation is easy to test badly — assert that a string
 * came back and move on. The failures that matter are not empty strings. They are a window-sticker
 * MSRP appearing as a sale price, a sold car still being advertised, a customer's name reaching a
 * public post because she was the reason the post got written, and a confident analytics claim from
 * nine data points.
 *
 * So the assertions below are mostly about what must *not* appear.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { VehicleRecordV1 } from "../src/vehicle-inventory.js";
import {
  buildSalesBrandProfile, salesBrandFromBrandDna, brandProfileGaps, describeSalesBrand,
  DEFAULT_CONTENT_PILLARS, CONSENT_REQUIRED_PILLARS, pillarIsSelfServable,
  type SalesBrandProfileV1,
} from "../src/sales-brand.js";
import {
  rankContentOpportunities, contentOpportunityFromSignal, MIN_AGGREGATE_DEMAND_CUSTOMERS,
  type ContentSignalV1, type ContentOpportunityV1,
} from "../src/content-opportunity.js";
import {
  vehicleContentFacts, priceFactFromVehicle, priceSentence, priceIsQuotable,
  generateContentDraft, reviewDraftFreshness, applyFreshness,
  scanDraftForInventedClaims, scanDraftForPrivateData,
  type ContentDraftV1,
} from "../src/content-draft.js";
import {
  buildContentPlan, formatSalesPresenceToday, routeSalesPresenceCommand, summariseDrafts,
} from "../src/content-plan.js";
import {
  salesWebsiteArchitecture, vehiclePageFromFacts, buildLeadCaptureForm, displayVin,
  staleWebsiteVehicles, FORBIDDEN_LEAD_FIELDS,
} from "../src/sales-website.js";
import {
  buildSocialPublishProposal, buildWebsiteChangeProposal, readContentPerformance,
  MIN_OBSERVATIONS_FOR_SIGNAL, type ContentPerformanceObservationV1,
} from "../src/sales-presence-proposal.js";

const NOW = "2026-08-12T12:00:00.000Z";
const LISTING_URL = "https://www.lakelandtoyota.com/vehicle/JTDBAMDE0T3000001";

function brand(over: Partial<SalesBrandProfileV1> = {}): SalesBrandProfileV1 {
  const built = buildSalesBrandProfile({
    workspace: "work",
    displayName: "D. Coffman",
    professionalRole: "Sales Consultant",
    dealershipName: "Lakeland Toyota",
    serviceArea: "Polk County",
    brandPromise: "Straight answers and the actual price.",
    contactPreferences: { preferred: "text" },
    now: NOW,
  });
  assert.ok(!("refused" in built));
  return { ...built, ...over };
}

/** A vehicle whose latest price observation is a real dealer-site advertised price. */
function vehicle(over: Partial<VehicleRecordV1> = {}): VehicleRecordV1 {
  return {
    id: "veh-1", vin: "JTDBAMDE0T3000001", dealershipId: "d1", dealershipName: "Lakeland Toyota",
    stockNumber: "L1042", year: 2025, make: "Toyota", model: "Camry", trim: "XSE",
    condition: "new", exteriorColor: "Dark Blue", interiorColor: "Black", mileage: 8,
    presenceStatus: "ONLINE_LISTED", listingUrl: LISTING_URL, detailUrl: LISTING_URL,
    lastOnlineAt: "2026-08-11T12:00:00.000Z", lastPhysicalAt: null,
    priceHistory: [
      { at: "2026-08-11T12:00:00.000Z", advertisedPrice: 33995, msrp: 35120, dealerPrice: null, sourceUrl: LISTING_URL },
    ],
    statusHistory: [], listingObservations: [], relationshipIds: [], opportunityIds: [],
    createdAt: NOW, updatedAt: NOW,
    ...over,
  } as unknown as VehicleRecordV1;
}

function signal(over: Partial<ContentSignalV1> & { kind: ContentSignalV1["kind"]; subject: string }): ContentSignalV1 {
  return {
    workspace: "work", observedAt: "2026-08-11T12:00:00.000Z",
    sourceRefs: [`vehicle:veh-1`, `listing:${LISTING_URL}`],
    ...over,
  } as ContentSignalV1;
}

function rank(signals: ContentSignalV1[]) {
  return rankContentOpportunities({
    signals, enabledPillars: DEFAULT_CONTENT_PILLARS, workspace: "work", now: NOW,
    nextId: (i) => `opp-${i}`,
  });
}

function draftFor(format: Parameters<typeof generateContentDraft>[0]["format"], opportunity: ContentOpportunityV1, over: Record<string, unknown> = {}) {
  const built = generateContentDraft({
    draftId: `draft-${format}`, workspace: "work", format,
    facts: vehicleContentFacts({ vehicle: vehicle(), features: ["All-wheel drive", "Heated seats"] }),
    opportunity, brand: brand(), now: NOW,
    ...over,
  } as Parameters<typeof generateContentDraft>[0]);
  assert.ok(!("refused" in built), `${format} refused: ${(built as { reason?: string }).reason}`);
  return built as ContentDraftV1;
}

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

test("a brand profile keeps unknowns unknown and never invents a credential", () => {
  const profile = brand();
  assert.equal(profile.displayName, "D. Coffman");
  assert.deepEqual(profile.claims, [], "no claims may exist without evidence");
  assert.ok(profile.claimsPolicy.length > 0);
  // Nothing filled in a plausible default.
  const bare = buildSalesBrandProfile({ workspace: "work", now: NOW });
  assert.ok(!("refused" in bare));
  assert.equal(bare.displayName, null);
  assert.equal(bare.dealershipName, null);
  assert.ok(brandProfileGaps(bare).length > 0, "gaps must be surfaced, not defaulted");
  assert.match(describeSalesBrand(bare), /don't have a name/i);
});

test("unverifiable self-description is refused by name", () => {
  for (const key of ["yearsExperience", "awards", "salesRank", "certifications", "testimonials"]) {
    const built = buildSalesBrandProfile({ workspace: "work", now: NOW, extra: { [key]: "anything" } });
    assert.ok("refused" in built, `${key} must be refused`);
    assert.match((built as { reason: string }).reason, new RegExp(key));
  }
});

test("a claim without a source is refused", () => {
  const built = buildSalesBrandProfile({
    workspace: "work", now: NOW,
    claims: [{ statement: "Top volume salesperson in the region" }],
  });
  assert.ok("refused" in built);
  assert.match((built as { reason: string }).reason, /cites no evidence/i);
});

test("the profile derives from existing brand DNA rather than competing with it", () => {
  const built = salesBrandFromBrandDna({
    dna: {
      workspaceId: "work", audience: "Polk County families", voice: "warm", tone: "friendly",
      claims: ["Answers texts the same day"], forbiddenClaims: ["guaranteed financing"],
      provenanceSourceRef: "brand-dna:work", updatedAt: NOW,
    },
    now: NOW,
  });
  assert.ok(!("refused" in built));
  assert.equal(built.voice, "WARM");
  assert.equal(built.tone, "FRIENDLY");
  assert.equal(built.audience, "Polk County families");
  // The DNA's forbidden claims carry over rather than being re-listed somewhere else.
  assert.deepEqual(built.topicsToAvoid, ["guaranteed financing"]);
  assert.equal(built.claims[0]!.sourceRefs[0], "brand-dna:work");
});

test("consent-gated pillars are closed by default", () => {
  for (const pillar of ["CUSTOMER_STORY", "DELIVERY_STORY", "LOCAL_RELEVANCE"] as const) {
    assert.ok(CONSENT_REQUIRED_PILLARS.has(pillar));
    assert.equal(pillarIsSelfServable(pillar), false);
    assert.ok(!DEFAULT_CONTENT_PILLARS.includes(pillar), `${pillar} must not be on by default`);
  }
  assert.ok(DEFAULT_CONTENT_PILLARS.includes("CURRENT_INVENTORY"));
  assert.ok(DEFAULT_CONTENT_PILLARS.includes("CUSTOMER_FAQ"));
});

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

test("inventory, lot and price signals each become a ranked opportunity", () => {
  const result = rank([
    signal({ kind: "NEW_ONLINE_LISTING", subject: "2025 Camry XSE", vehicleRef: "veh-1" }),
    signal({ kind: "LOT_OBSERVATION", subject: "Crown Signia on the front row", vehicleRef: "veh-2" }),
    signal({ kind: "PRICE_CHANGE", subject: "2025 Camry XSE", vehicleRef: "veh-1", priceBefore: 34995, priceAfter: 33995 }),
  ]);
  assert.equal(result.opportunities.length, 3);
  const kinds = result.opportunities.map((o) => o.type).sort();
  assert.deepEqual(kinds, ["LOT_OBSERVATION", "NEW_ONLINE_LISTING", "PRICE_CHANGE"]);

  const price = result.opportunities.find((o) => o.type === "PRICE_CHANGE")!;
  assert.equal(price.claimsRisk, "HIGH");
  assert.equal(price.requiresOwnerReview, true, "a price claim always goes past the Owner");
  assert.ok(price.expiresAt, "price content must expire");

  const lot = result.opportunities.find((o) => o.type === "LOT_OBSERVATION")!;
  assert.equal(lot.pillar, "LOT_WALK");
  assert.ok(lot.suggestedFormats.includes("REEL_SCRIPT"));
});

test("a price-change signal with no new price is refused", () => {
  const built = contentOpportunityFromSignal({
    signal: signal({ kind: "PRICE_CHANGE", subject: "Camry", priceAfter: null }),
    opportunityId: "o1", enabledPillars: DEFAULT_CONTENT_PILLARS, now: NOW,
  });
  assert.ok("refused" in built);
});

test("an ungrounded signal produces nothing", () => {
  const built = contentOpportunityFromSignal({
    signal: { ...signal({ kind: "NEW_ONLINE_LISTING", subject: "Camry" }), sourceRefs: [] },
    opportunityId: "o1", enabledPillars: DEFAULT_CONTENT_PILLARS, now: NOW,
  });
  assert.ok("refused" in built);
  assert.match((built as { reason: string }).reason, /no source/i);
});

// ---------------------------------------------------------------------------
// Customer privacy
// ---------------------------------------------------------------------------

test("one customer's want never becomes public content; several become a subject", () => {
  const single = contentOpportunityFromSignal({
    signal: signal({ kind: "CUSTOMER_DEMAND", subject: "AWD RAV4", customerCount: 1, sourceRefs: ["conversation:c1#0"] }),
    opportunityId: "o1", enabledPillars: DEFAULT_CONTENT_PILLARS, now: NOW,
  });
  assert.ok("refused" in single);
  assert.match((single as { reason: string }).reason, /private business/i);

  const aggregate = contentOpportunityFromSignal({
    signal: signal({
      kind: "FREQUENT_QUESTION", subject: "AWD RAV4 availability",
      customerCount: MIN_AGGREGATE_DEMAND_CUSTOMERS + 2,
      sourceRefs: ["conversation:c1#0", "conversation:c2#3", "conversation:c3#1"],
    }),
    opportunityId: "o2", enabledPillars: DEFAULT_CONTENT_PILLARS, now: NOW,
  });
  assert.ok(!("refused" in aggregate));
  assert.equal(aggregate.customerCount, MIN_AGGREGATE_DEMAND_CUSTOMERS + 2);
  // The count is carried; the people are not.
  assert.ok(!/sarah|whitmore/i.test(JSON.stringify(aggregate)));
});

test("no customer identity, contact detail or internal ref can reach a public draft", () => {
  const opportunity = rank([signal({ kind: "NEW_ONLINE_LISTING", subject: "2025 Camry XSE", vehicleRef: "veh-1" })]).opportunities[0]!;
  const drafts = ["FACEBOOK_POST", "INSTAGRAM_CAPTION", "SHORT_VIDEO_SCRIPT", "WEBSITE_FEATURED_VEHICLE", "CUSTOMER_SHARE_MESSAGE"] as const;
  for (const format of drafts) {
    const draft = draftFor(format, opportunity);
    const leaks = scanDraftForPrivateData(draft, [
      { kind: "name", value: "Sarah Whitmore" },
      { kind: "phone", value: "863-555-0142" },
    ]);
    assert.deepEqual(leaks, [], `${format} leaked ${leaks.join(", ")}`);
    // Internal provenance lives beside the body, never inside it.
    assert.ok(!/conversation:|transcript:|relationship:/i.test(draft.body));
    assert.ok(draft.sourceRefs.length > 0);
  }
});

test("the private-data scanner catches what it is meant to catch", () => {
  assert.deepEqual(
    scanDraftForPrivateData({ title: "x", body: "Call Sarah on 863-555-0142" }, [{ kind: "name", value: "Sarah" }]).sort(),
    ["a customer name", "a phone number"],
  );
  assert.deepEqual(
    scanDraftForPrivateData({ title: "x", body: "see conversation:conv-1#2" }),
    ["an internal record reference"],
  );
  assert.deepEqual(scanDraftForPrivateData({ title: "x", body: "reach me at sarah@example.com" }), ["an email address"]);
});

// ---------------------------------------------------------------------------
// Price truth
// ---------------------------------------------------------------------------

test("an advertised price and a sticker MSRP are never the same fact", () => {
  const advertised = priceFactFromVehicle(vehicle());
  assert.equal(advertised.kind, "WEBSITE_ADVERTISED");
  assert.equal(advertised.amount, 33995);
  assert.equal(advertised.sourceRef, LISTING_URL);
  assert.equal(priceIsQuotable(advertised), true);

  // The same vehicle with only a sticker figure must not be promoted to an advertised price.
  const stickerOnly = priceFactFromVehicle(vehicle({
    priceHistory: [{ at: "2026-08-11T12:00:00.000Z", advertisedPrice: null, msrp: 53378, dealerPrice: null, sourceUrl: "sticker:img-1" }],
  } as Partial<VehicleRecordV1>));
  assert.equal(stickerOnly.kind, "STICKER_MSRP");
  assert.equal(stickerOnly.amount, 53378);
  assert.equal(priceIsQuotable(stickerOnly), false, "an MSRP is never quotable as the price");

  const sentence = priceSentence(stickerOnly);
  assert.match(sentence, /sticker/i);
  assert.match(sentence, /not what the dealer is advertising/i);
  assert.ok(!/\bonly\b|sale price|marked down/i.test(sentence));
  // The sentence goes into draft bodies, so it must survive the claim scanner it will be checked by.
  assert.deepEqual(scanDraftForInventedClaims(sentence), []);
});

test("a vehicle with only a sticker price still drafts, and never quotes it as the price", () => {
  const msrpOnly = vehicle({
    priceHistory: [{ at: "2026-08-11T12:00:00.000Z", advertisedPrice: null, msrp: 53378, dealerPrice: null, sourceUrl: "sticker:img-1" }],
  } as Partial<VehicleRecordV1>);
  const opportunity = rank([signal({ kind: "NEW_ONLINE_LISTING", subject: "Crown Signia", vehicleRef: "veh-1" })]).opportunities[0]!;
  const built = generateContentDraft({
    draftId: "d-msrp", workspace: "work", format: "FACEBOOK_POST",
    facts: vehicleContentFacts({ vehicle: msrpOnly }),
    opportunity, brand: brand(), now: NOW,
  });
  assert.ok(!("refused" in built), `MSRP-only vehicle refused: ${(built as { reason?: string }).reason}`);
  const draft = built as ContentDraftV1;
  assert.equal(draft.priceFact.kind, "STICKER_MSRP");
  assert.match(draft.body, /sticker/i);
  assert.deepEqual(scanDraftForInventedClaims(draft.body), []);
  // Recorded as an MSRP claim, never as an advertised price.
  assert.ok(draft.claims.some((c) => /Sticker MSRP/i.test(c.statement)));
  assert.ok(!draft.claims.some((c) => /Advertised/i.test(c.statement)));
});

test("an unknown price produces an invitation, never a number", () => {
  const unknown = priceFactFromVehicle(vehicle({ priceHistory: [] } as Partial<VehicleRecordV1>));
  assert.equal(unknown.kind, "UNKNOWN");
  const sentence = priceSentence(unknown);
  assert.ok(!/\$/.test(sentence), "no figure may appear when no price is known");
  assert.match(sentence, /today's number/i);
});

test("no generated draft can contain an invented commercial claim", () => {
  const opportunity = rank([signal({ kind: "NEW_ONLINE_LISTING", subject: "2025 Camry XSE", vehicleRef: "veh-1" })]).opportunities[0]!;
  for (const format of ["FACEBOOK_POST", "INSTAGRAM_CAPTION", "SHORT_VIDEO_SCRIPT", "REEL_SCRIPT", "WEBSITE_FEATURED_VEHICLE", "CUSTOMER_SHARE_MESSAGE"] as const) {
    const draft = draftFor(format, opportunity);
    assert.deepEqual(scanDraftForInventedClaims(draft.body), [], `${format}: ${draft.body}`);
  }
  // And the scanner itself works.
  assert.ok(scanDraftForInventedClaims("Now only $33,995!").length > 0);
  assert.ok(scanDraftForInventedClaims("0.9% APR available").length > 0);
  assert.ok(scanDraftForInventedClaims("$399/mo with approved credit").length > 0);
  assert.ok(scanDraftForInventedClaims("$2,000 rebate this month").length > 0);
});

test("the price source survives into the draft and onto the page", () => {
  const opportunity = rank([signal({ kind: "NEW_ONLINE_LISTING", subject: "2025 Camry XSE", vehicleRef: "veh-1" })]).opportunities[0]!;
  const draft = draftFor("WEBSITE_FEATURED_VEHICLE", opportunity);
  assert.equal(draft.priceFact.kind, "WEBSITE_ADVERTISED");
  assert.equal(draft.priceEvidenceRef, LISTING_URL);
  assert.ok(draft.claims.some((c) => c.sourceRefs.includes(LISTING_URL)));

  const page = vehiclePageFromFacts({
    facts: vehicleContentFacts({ vehicle: vehicle() }),
    now: "2026-08-12T12:00:00.000Z",
  });
  assert.equal(page.websitePrice, 33995);
  assert.equal(page.priceSource, LISTING_URL);
  assert.ok(page.priceObservedAt);
});

// ---------------------------------------------------------------------------
// Temporal invalidation
// ---------------------------------------------------------------------------

test("a draft goes stale when the vehicle stops being listed, and needs re-checking when the price moves", () => {
  const opportunity = rank([signal({ kind: "NEW_ONLINE_LISTING", subject: "2025 Camry XSE", vehicleRef: "veh-1" })]).opportunities[0]!;
  const draft = draftFor("FACEBOOK_POST", opportunity);
  assert.equal(draft.freshness, "CURRENT");

  const sold = reviewDraftFreshness({
    draft, vehicle: vehicle({ presenceStatus: "NO_LONGER_FOUND_ONLINE" } as Partial<VehicleRecordV1>), now: NOW,
  });
  assert.equal(sold.freshness, "STALE");
  assert.match(sold.reason, /no longer listed/i);
  assert.equal(applyFreshness(draft, sold).reviewStatus, "STALE");

  const repriced = reviewDraftFreshness({
    draft,
    vehicle: vehicle({
      priceHistory: [{ at: "2026-08-12T09:00:00.000Z", advertisedPrice: 32995, msrp: 35120, dealerPrice: null, sourceUrl: LISTING_URL }],
    } as Partial<VehicleRecordV1>),
    now: NOW,
  });
  assert.equal(repriced.freshness, "NEEDS_REVERIFY");
  assert.match(repriced.reason, /price moved/i);

  const gone = reviewDraftFreshness({ draft, vehicle: null, now: NOW });
  assert.equal(gone.freshness, "STALE");

  // Never silently current.
  assert.notEqual(sold.freshness, "CURRENT");
  assert.notEqual(repriced.freshness, "CURRENT");
});

test("a draft about a delisted vehicle is refused outright", () => {
  const opportunity = rank([signal({ kind: "NEW_ONLINE_LISTING", subject: "2025 Camry XSE", vehicleRef: "veh-1" })]).opportunities[0]!;
  const built = generateContentDraft({
    draftId: "d", workspace: "work", format: "FACEBOOK_POST",
    facts: vehicleContentFacts({ vehicle: vehicle({ presenceStatus: "NO_LONGER_FOUND_ONLINE" } as Partial<VehicleRecordV1>) }),
    opportunity, brand: brand(), now: NOW,
  });
  assert.ok("refused" in built);
  assert.match((built as { reason: string }).reason, /no longer listed/i);
});

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

test("the plan follows the opportunities, and recommends nothing when there are none", () => {
  const opportunities = rank([
    signal({ kind: "NEW_ONLINE_LISTING", subject: "2025 Camry XSE", vehicleRef: "veh-1" }),
    signal({ kind: "FREQUENT_QUESTION", subject: "Camry vs Camry Hybrid", customerCount: 4, sourceRefs: ["conversation:c1#0"] }),
    signal({ kind: "LOT_OBSERVATION", subject: "Crown Signia walkaround", vehicleRef: "veh-2" }),
  ]).opportunities;

  const plan = buildContentPlan({
    planId: "plan-1", workspace: "work", horizon: "DAILY", opportunities,
    brand: brand(), periodStart: NOW, now: NOW, nextSlotId: (i) => `slot-${i}`,
  });
  assert.equal(plan.noPostRecommended, false);
  assert.ok(plan.slots.length >= 3);
  // Variety first: three different roles before any role repeats.
  const roles = plan.slots.map((s) => s.role);
  assert.equal(new Set(roles.slice(0, 3)).size, 3);

  const empty = buildContentPlan({
    planId: "plan-2", workspace: "work", horizon: "DAILY", opportunities: [],
    brand: brand(), periodStart: NOW, now: NOW, nextSlotId: (i) => `slot-${i}`,
  });
  assert.equal(empty.noPostRecommended, true);
  assert.match(empty.message, /quiet day is better than a filler post/i);
  assert.equal(empty.slots.length, 0);
});

test("a weak opportunity is left out rather than posted last", () => {
  const stale = signal({ kind: "WEBSITE_CONTENT_GAP", subject: "old gap", observedAt: "2026-07-01T00:00:00.000Z" });
  const opportunities = rank([stale]).opportunities;
  const plan = buildContentPlan({
    planId: "p", workspace: "work", horizon: "DAILY", opportunities,
    brand: brand(), periodStart: NOW, now: NOW, nextSlotId: (i) => `slot-${i}`,
  });
  assert.equal(plan.slots.length, 0);
  assert.ok(plan.notPlanned.length > 0, "and it is reported, not silently dropped");
});

test("the daily brief leads with what is wrong on the website", () => {
  const opportunities = rank([signal({ kind: "NEW_ONLINE_LISTING", subject: "2025 Camry XSE", vehicleRef: "veh-1" })]).opportunities;
  const plan = buildContentPlan({
    planId: "p", workspace: "work", horizon: "DAILY", opportunities,
    brand: brand(), periodStart: NOW, now: NOW, nextSlotId: (i) => `slot-${i}`,
  });
  const brief = formatSalesPresenceToday({
    workspace: "work", generatedAt: NOW, opportunityCount: opportunities.length, plan,
    draftsReady: 2, scriptsReady: 1, staleWebsiteItems: 1, websiteUpdatesAvailable: 2,
  });
  assert.match(brief, /SALES PRESENCE TODAY/);
  const staleIndex = brief.indexOf("stale");
  const recommendIndex = brief.indexOf("Recommended");
  assert.ok(staleIndex >= 0 && staleIndex < recommendIndex, "stale website items must come first");
  assert.match(brief, /Nothing has been published/);
});

test("the Owner's phrasings route, and nothing else is claimed", () => {
  const cases: Array<[string, string]> = [
    ["What should I post today?", "WHAT_SHOULD_I_POST"],
    ["Make today's social content.", "MAKE_TODAYS_CONTENT"],
    ["Create a weekly content plan", "WEEKLY_CONTENT_PLAN"],
    ["What should I make a video about?", "VIDEO_IDEA"],
    ["Make a Reel script for JTDBAMDE0T3000001", "REEL_FOR_VIN"],
    ["Turn this vehicle into a Facebook post", "POST_FOR_VEHICLE"],
    ["Which vehicles should I feature?", "WHICH_VEHICLES_TO_FEATURE"],
    ["What questions are customers asking?", "CUSTOMER_QUESTIONS"],
    ["What's stale on my website?", "WEBSITE_STALE"],
    ["Prepare a website update", "PREPARE_WEBSITE_UPDATE"],
  ];
  for (const [text, expected] of cases) {
    assert.equal(routeSalesPresenceCommand(text).command, expected, text);
  }
  assert.equal(routeSalesPresenceCommand("Make a Reel script for JTDBAMDE0T3000001").subject, "JTDBAMDE0T3000001");
  // Unrelated traffic falls through rather than being claimed.
  for (const text of ["What does Sarah want?", "What vehicles do we have?", "What are my goals?", "What changed?"]) {
    assert.equal(routeSalesPresenceCommand(text).command, null, text);
  }
});

// ---------------------------------------------------------------------------
// Website
// ---------------------------------------------------------------------------

test("the architecture is mobile-first, grounded, and honest about what comes later", () => {
  const site = salesWebsiteArchitecture({ workspace: "work", now: NOW });
  assert.equal(site.layout, "MOBILE_FIRST");
  const kinds = site.pages.map((p) => p.kind);
  for (const required of ["HOME", "FEATURED_VEHICLES", "FIND_A_VEHICLE", "VEHICLE_DETAIL", "MODEL_GUIDES", "BUYING_GUIDES", "FAQ", "ABOUT", "CONTACT"]) {
    assert.ok(kinds.includes(required as never), `missing ${required}`);
  }
  assert.equal(site.pages.find((p) => p.kind === "BLOG")!.phase, "LATER");
  assert.ok(site.constraints.some((c) => /never stores its own copy/i.test(c)));
  assert.ok(site.constraints.some((c) => /No customer information/i.test(c)));
});

test("a vehicle page carries its verification date and hides most of the VIN", () => {
  const facts = vehicleContentFacts({ vehicle: vehicle(), features: ["All-wheel drive"] });
  const page = vehiclePageFromFacts({ facts, now: "2026-08-12T12:00:00.000Z" });
  assert.equal(page.status, "AVAILABLE_AS_OF");
  assert.equal(page.lastVerifiedAt, "2026-08-11T12:00:00.000Z");
  assert.equal(page.vinDisplay, "E0T30000" === page.vinDisplay ? page.vinDisplay : facts.vin!.slice(-8));
  assert.equal(page.vinDisplay!.length, 8);
  assert.notEqual(page.vinDisplay, facts.vin, "a full VIN must not be published by default");
  assert.equal(displayVin(facts.vin, "HIDDEN"), null);
  assert.equal(displayVin(facts.vin, "FULL"), facts.vin);

  // Verification ages out rather than staying true forever.
  const later = vehiclePageFromFacts({ facts, now: "2026-08-20T12:00:00.000Z" });
  assert.equal(later.status, "NEEDS_REVERIFY");
  assert.match(later.callToAction, /confirm whether this one is still here/i);
  assert.equal(staleWebsiteVehicles([page, later]).length, 1);
});

test("a page with no published price says so instead of showing one", () => {
  const facts = vehicleContentFacts({ vehicle: vehicle({ priceHistory: [] } as Partial<VehicleRecordV1>) });
  const page = vehiclePageFromFacts({ facts, now: NOW });
  assert.equal(page.websitePrice, null);
  assert.equal(page.priceSource, null);
  assert.ok(!/\$/.test(page.priceStatement));
});

test("lead capture asks for little and refuses anything resembling a credit application", () => {
  const form = buildLeadCaptureForm({ formId: "f1", workspace: "work", now: NOW });
  assert.ok(!("refused" in form));
  assert.equal(form.destination, "AION_INTERNAL_ONLY");
  assert.equal(form.consent.required, true);
  assert.equal(form.consent.defaultChecked, false, "consent is never pre-ticked");

  for (const field of FORBIDDEN_LEAD_FIELDS) {
    const built = buildLeadCaptureForm({ formId: "f", workspace: "work", fields: ["name", field], now: NOW });
    assert.ok("refused" in built, `${field} must be refused`);
  }
});

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

test("a social publish proposal is prepare-only and cannot carry a stale draft", () => {
  const opportunity = rank([signal({ kind: "NEW_ONLINE_LISTING", subject: "2025 Camry XSE", vehicleRef: "veh-1" })]).opportunities[0]!;
  const draft = draftFor("FACEBOOK_POST", opportunity);

  const proposal = buildSocialPublishProposal({
    proposalId: "sp-1", workspace: "work", platform: "FACEBOOK", draft, now: NOW,
  });
  assert.ok(!("refused" in proposal));
  assert.equal(proposal.authorityRequired, "PREPARE_ONLY");
  assert.equal(proposal.status, "PROPOSED");
  assert.equal(proposal.scheduledFor, null, "AION does not pick a posting time on its own");
  assert.ok(proposal.idempotencyKey.length > 0);
  assert.match(proposal.expectedExternalEffect, /nothing can be posted yet/i);
  assert.deepEqual(proposal.sourceRefs, draft.sourceRefs);

  const stale = buildSocialPublishProposal({
    proposalId: "sp-2", workspace: "work", platform: "FACEBOOK",
    draft: { ...draft, freshness: "STALE" }, now: NOW,
  });
  assert.ok("refused" in stale);
  assert.match((stale as { reason: string }).reason, /stale/i);

  // The same draft to the same platform is the same operation.
  const again = buildSocialPublishProposal({
    proposalId: "sp-3", workspace: "work", platform: "FACEBOOK", draft, now: NOW,
  });
  assert.ok(!("refused" in again));
  assert.equal(again.idempotencyKey, proposal.idempotencyKey);
});

test("a website change proposal is prepare-only, and removals are never blocked by staleness", () => {
  const opportunity = rank([signal({ kind: "NEW_ONLINE_LISTING", subject: "2025 Camry XSE", vehicleRef: "veh-1" })]).opportunities[0]!;
  const draft = draftFor("WEBSITE_FEATURED_VEHICLE", opportunity);

  const add = buildWebsiteChangeProposal({
    proposalId: "wc-1", workspace: "work", action: "ADD_FEATURED_VEHICLE", target: "/vehicles",
    vehicleRef: "veh-1", draft, sourceRefs: draft.sourceRefs,
    changes: [{ field: "featured", before: null, after: "veh-1" }], now: NOW,
  });
  assert.ok(!("refused" in add));
  assert.equal(add.authorityRequired, "PREPARE_ONLY");
  assert.match(add.expectedExternalEffect, /No site is deployed/i);

  const staleAdd = buildWebsiteChangeProposal({
    proposalId: "wc-2", workspace: "work", action: "ADD_FEATURED_VEHICLE", target: "/vehicles",
    draft: { ...draft, freshness: "STALE" }, sourceRefs: ["x"],
    changes: [{ field: "featured", before: null, after: "veh-1" }], now: NOW,
  });
  assert.ok("refused" in staleAdd, "a stale vehicle must not be added");

  // Removing a stale vehicle is exactly what a stale vehicle is for.
  const remove = buildWebsiteChangeProposal({
    proposalId: "wc-3", workspace: "work", action: "REMOVE_STALE_VEHICLE", target: "/vehicles/L1042",
    draft: { ...draft, freshness: "STALE" }, sourceRefs: ["vehicle:veh-1"],
    changes: [{ field: "featured", before: "veh-1", after: null }], now: NOW,
  });
  assert.ok(!("refused" in remove), "a removal must not be blocked by the staleness it exists to fix");
});

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

test("performance is not read from a sample too small to read", () => {
  const observation = (i: number, format: ContentPerformanceObservationV1["format"], engagements: number): ContentPerformanceObservationV1 => ({
    observationId: `obs-${i}`, workspace: "work", contentDraftRef: `d-${i}`, platform: "FACEBOOK",
    format, pillar: "CURRENT_INVENTORY", vehicleRef: null, views: 100, reach: 90,
    engagements, clicks: 2, attributedLeads: null, observedAt: NOW, source: "METRICOOL_FIXTURE",
  });

  const few = readContentPerformance({
    observations: [observation(1, "REEL_SCRIPT", 40), observation(2, "FACEBOOK_POST", 5)],
    workspace: "work",
  });
  assert.equal(few.hasEnoughData, false);
  assert.match(few.message, /too few/i);

  const many = readContentPerformance({
    observations: Array.from({ length: MIN_OBSERVATIONS_FOR_SIGNAL }, (_, i) =>
      observation(i, i % 2 ? "REEL_SCRIPT" : "FACEBOOK_POST", i % 2 ? 40 : 5)),
    workspace: "work",
  });
  assert.equal(many.hasEnoughData, true);
  assert.equal(many.byFormat[0]!.format, "REEL_SCRIPT");
  // Reported as observed, never as caused.
  assert.match(many.message, /not proof that the format caused it/i);
});

// ---------------------------------------------------------------------------
// The whole chain
// ---------------------------------------------------------------------------

test("one grounded vehicle produces every surface from the same facts, provenance intact", () => {
  const v = vehicle();
  const opportunities = rank([
    signal({ kind: "NEW_ONLINE_LISTING", subject: "2025 Camry XSE", vehicleRef: v.id }),
    signal({
      kind: "FREQUENT_QUESTION", subject: "Is the Camry available with AWD",
      customerCount: 4, sourceRefs: ["conversation:c1#0", "conversation:c2#1", "conversation:c3#0"],
    }),
  ]).opportunities;
  assert.equal(opportunities.length, 2);

  const inventory = opportunities.find((o) => o.type === "NEW_ONLINE_LISTING")!;
  const facts = vehicleContentFacts({ vehicle: v, features: ["All-wheel drive", "Heated seats"] });

  const surfaces = (["FACEBOOK_POST", "INSTAGRAM_CAPTION", "SHORT_VIDEO_SCRIPT", "WEBSITE_FEATURED_VEHICLE", "CUSTOMER_SHARE_MESSAGE"] as const)
    .map((format) => {
      const built = generateContentDraft({
        draftId: `d-${format}`, workspace: "work", format, facts,
        opportunity: inventory, brand: brand(), now: NOW,
        forbiddenValues: [{ kind: "name", value: "Sarah Whitmore" }],
      });
      assert.ok(!("refused" in built), `${format} refused`);
      return built as ContentDraftV1;
    });

  for (const draft of surfaces) {
    // Same facts, same price, same provenance — one knowledge object, many renderings.
    assert.equal(draft.vehicleRef, v.id);
    assert.equal(draft.priceFact.amount, 33995);
    assert.equal(draft.priceFact.kind, "WEBSITE_ADVERTISED");
    assert.equal(draft.priceEvidenceRef, LISTING_URL);
    assert.ok(draft.sourceRefs.includes(`vehicle:${v.id}`));
    assert.ok(draft.sourceRefs.includes(`price:${LISTING_URL}`));
    assert.equal(draft.publishAuthorityRequired, "PREPARE_ONLY");
    assert.deepEqual(scanDraftForInventedClaims(draft.body), []);
    assert.deepEqual(scanDraftForPrivateData(draft, [{ kind: "name", value: "Sarah Whitmore" }]), []);
    // The advertised figure may be quoted, and it is the real one.
    assert.match(draft.body, /33,995/);
    assert.ok(!/35,120/.test(draft.body), "the sticker MSRP must not appear as the price");
  }

  // A price claim always routes past the Owner.
  assert.ok(surfaces.every((d) => d.reviewStatus === "NEEDS_OWNER_REVIEW"));

  // The page projection agrees with the drafts.
  const page = vehiclePageFromFacts({ facts, now: "2026-08-12T12:00:00.000Z" });
  assert.equal(page.websitePrice, draftPrice(surfaces[0]!));
  assert.equal(page.stickerMsrp, null, "an advertised price is not also reported as MSRP");

  // And a proposal from any of them stays prepare-only.
  const proposal = buildSocialPublishProposal({
    proposalId: "sp", workspace: "work", platform: "INSTAGRAM", draft: surfaces[1]!, now: NOW,
  });
  assert.ok(!("refused" in proposal));
  assert.equal(proposal.authorityRequired, "PREPARE_ONLY");

  const summary = summariseDrafts(surfaces);
  assert.equal(summary.scripts, 1);
  assert.equal(summary.stale, 0);
});

function draftPrice(draft: ContentDraftV1): number | null {
  return draft.priceFact.amount;
}
