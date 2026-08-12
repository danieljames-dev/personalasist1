/**
 * The Command Center, tested as the Owner will actually meet it.
 *
 * Two failure modes matter more than the rest. A dashboard that always has something on it teaches
 * the Owner that its numbers are decoration, so the empty cases are asserted as hard as the full
 * ones. And a screen that collapses several different prices into one row is how a window-sticker
 * figure gets quoted to a customer as the asking price, so every price assertion here checks the
 * label as well as the number.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { RelationshipV1 } from "../src/contracts.js";
import type { VehicleRecordV1 } from "../src/vehicle-inventory.js";
import type { CustomerNeedV1 } from "../src/customer-needs.js";
import type { CommitmentCandidateV1, ConversationEventV1 } from "../src/conversation-event.js";
import type { CrmActionProposalV1 } from "../src/crm-action-proposal.js";
import type { LotWalkSessionViewV1 } from "../src/lot-walk.js";
import { routeCrmAssistantIntent } from "../src/crm-assistant.js";
import {
  buildSalesCommandCenter, formatCommandCenterToday, formatCustomerAttention,
  SALES_COMMAND_CENTER_SCHEMA_V1,
} from "../src/sales-command-center.js";
import {
  priceDisplayFromVehicle, priceDisplayFromParts, formatPriceDisplay, hasQuotableAdvertisedPrice,
} from "../src/price-display.js";

const NOW = "2026-08-12T15:15:00.000Z";
const SARAH = "6103a23c-ff4a-4a2d-aefc-775fb2a99fd5";
const LISTING = "https://www.lakelandtoyota.com/vehicle/JTDACAAJ8T3051788";

function rel(over: Partial<RelationshipV1> & { id: string; displayName: string }): RelationshipV1 {
  return {
    workspace: "work", organisation: "", role: "", notes: "", objections: [], interests: [],
    archived: false, kind: "customer", lifecycle: "prospect", contactMethods: [],
    followUps: [], interactions: [], ...over,
  } as unknown as RelationshipV1;
}

function vehicle(over: Partial<VehicleRecordV1> = {}): VehicleRecordV1 {
  return {
    id: "veh-crown", vin: "JTDACAAJ8T3051788", dealershipId: "d1", dealershipName: "Lakeland Toyota",
    stockNumber: "L1042", year: 2026, make: "Toyota", model: "Crown Signia", trim: "Limited",
    condition: "new", exteriorColor: "Dark Blue", interiorColor: "Black", mileage: 8,
    presenceStatus: "ONLINE_LISTED", listingUrl: LISTING, detailUrl: LISTING,
    lastOnlineAt: "2026-08-12T15:00:00.000Z", lastPhysicalAt: "2026-08-12T14:00:00.000Z",
    priceHistory: [
      { at: "2026-08-12T15:00:00.000Z", advertisedPrice: 53378, msrp: 49090, dealerPrice: null, sourceUrl: LISTING },
    ],
    statusHistory: [], listingObservations: [], relationshipIds: [], opportunityIds: [],
    createdAt: NOW, updatedAt: NOW, ...over,
  } as unknown as VehicleRecordV1;
}

function need(over: Partial<CustomerNeedV1> & { id: string; attribute: CustomerNeedV1["attribute"]; value: string }): CustomerNeedV1 {
  return {
    workspace: "work", relationshipRef: SARAH, numericValue: null, strength: "HARD_REQUIREMENT",
    confidence: 90, sourceRef: "conversation:conv-1#0", observedAt: "2026-08-11T10:00:00.000Z",
    supersededAt: null, supersededBy: null, invalidatedAt: null, invalidationReason: null, ...over,
  } as CustomerNeedV1;
}

const CONVERSATION = {
  id: "conv-1", workspace: "work", channel: "PHONE_CALL", direction: "INBOUND",
  occurredAt: "2026-08-11T10:00:00.000Z", capturedAt: "2026-08-11T10:05:00.000Z",
  identity: { state: "RESOLVED", relationshipRef: SARAH, method: "EXACT_PHONE", confidence: 95, workspace: "work", candidates: [], evidence: [], message: "" },
  evidenceRef: "transcript:t-1",
  segments: [{ index: 0, speaker: "CUSTOMER", text: "I need AWD.", startMs: 0 }],
  summary: "", extraction: { provider: "faster-whisper:tiny.en", ok: true, confidence: 82 },
  derived: { needIds: [], commitmentIds: ["c1"], proposalIds: [] },
  correctedAt: null, correctionNote: null,
} as unknown as ConversationEventV1;

const COMMITMENT: CommitmentCandidateV1 = {
  party: "OWNER_PROMISED", statement: "I'll send you pictures", timeHint: "this afternoon",
  confidence: 85, sourceRef: "conversation:conv-1#2", reason: "definite language with a stated time",
};

const PROPOSAL = {
  proposalId: "p-1", workspace: "work", customerRef: SARAH, action: "PREPARE_CALL_NOTE",
  fields: {}, note: "Discussed a Crown Signia; wants AWD.", sourceRefs: ["transcript:t-1", "conversation:conv-1#0"],
  confidence: 85, authorityRequired: "PREPARE_ONLY",
  expectedExternalEffect: "Drafts a call note for your review.",
  idempotencyKey: "work:sarah:PREPARE_CALL_NOTE", status: "PROPOSED",
  createdAt: NOW, resolvedAt: null, resolutionNote: null,
} as CrmActionProposalV1;

function lotWalkView(over: Partial<LotWalkSessionViewV1> = {}): LotWalkSessionViewV1 {
  return {
    sessionId: "walk-1", workspace: "work", dealershipName: "Lakeland Toyota", state: "active",
    startedAt: "2026-08-12T14:00:00.000Z", endedAt: null,
    photoEvidenceCount: 4, identifiedVehicleCount: 3, unresolvedPhotoCount: 1, duplicateVinCount: 0,
    vehicles: [{
      vin: "JTDACAAJ8T3051788", observationId: "obs-1", walkId: "walk-1", vehicleId: "veh-crown",
      observedAt: "2026-08-12T14:00:00.000Z", lastSeenAt: "2026-08-12T14:00:00.000Z",
      year: 2026, make: "Toyota", model: "Crown Signia", trim: "Limited", condition: "new",
      exteriorColor: "Dark Blue", matchStatus: "VERIFIED_ON_LOT", temporal: "SEEN_ON_LOT_TODAY",
      websiteListing: "ON_WEBSITE",
      website: {
        websitePrice: 53378, websitePriceObservedAt: "2026-08-12T15:00:00.000Z", stickerMsrp: 49090,
        priceState: "PRICE_PUBLISHED", previousWebsitePrice: null, sourceLabel: "website_advertised",
      },
      photoDocumentIds: ["doc-1"], photoCount: 1,
      customerMatches: [{
        relationshipRef: SARAH, customerName: "Sarah Whitmore", matchScore: 70,
        freshness: "FRESH", why: "matched model", matchedOn: [],
      }],
      notes: "", summaryLine: "2026 Toyota Crown Signia Limited",
    }],
    reconciliation: null, caveat: "", ...over,
  } as unknown as LotWalkSessionViewV1;
}

function build(over: Partial<Parameters<typeof buildSalesCommandCenter>[0]> = {}) {
  return buildSalesCommandCenter({
    workspace: "work", now: NOW,
    relationships: [rel({ id: SARAH, displayName: "Sarah Whitmore" })],
    needs: [
      need({ id: "n1", attribute: "model", value: "crown signia" }),
      need({ id: "n2", attribute: "must-have", value: "awd" }),
    ],
    commitments: [COMMITMENT],
    proposals: [PROPOSAL],
    conversations: [CONVERSATION],
    vehicles: [vehicle()],
    lotWalkView: lotWalkView(),
    gmailReady: true,
    inventoryCount: 2195,
    ...over,
  });
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

test("the projection carries every section and never mutates its inputs", () => {
  const vehicles = [vehicle()];
  const before = JSON.stringify(vehicles);
  const view = build({ vehicles });
  assert.equal(view.schema, SALES_COMMAND_CENTER_SCHEMA_V1);
  assert.equal(view.workspace, "work");
  for (const key of ["today", "customerAttention", "vehicleOpportunities", "lotWalk", "calls", "preparedFollowups", "content", "website", "aionCanDo", "ownerMustDo", "capabilityStatus"]) {
    assert.ok(key in view, `missing ${key}`);
  }
  // Opening the dashboard must not change anything.
  assert.equal(JSON.stringify(vehicles), before);
});

test("today counts what is actually true", () => {
  const view = build();
  assert.equal(view.today.customerFollowupsThatMatter, 1);
  assert.equal(view.today.vehiclesPhotographedToday, 3);
  assert.equal(view.today.preparedCrmActions, 1);
  assert.ok(view.today.headlines.length > 0);
  const prose = formatCommandCenterToday(view);
  assert.match(prose, /TODAY/);
  assert.match(prose, /Only you can do/);
});

test("an empty day says so instead of inventing work", () => {
  const view = buildSalesCommandCenter({
    workspace: "work", now: NOW, relationships: [], needs: [], commitments: [],
    proposals: [], conversations: [], vehicles: [], lotWalkView: null,
  });
  assert.deepEqual(view.today.headlines, []);
  assert.deepEqual(view.customerAttention, []);
  assert.deepEqual(view.ownerMustDo, []);
  assert.equal(view.lotWalk.active, false);
  assert.match(view.lotWalk.message, /haven't started a lot walk/i);
  assert.match(view.content.message, /No strong grounded content opportunity/i);
  assert.match(formatCommandCenterToday(view), /Nothing needs you right now/i);
  assert.equal(formatCustomerAttention(view), "No customer follow-ups need attention right now.");
});

test("a customer appears only when something is true about them", () => {
  const view = build();
  assert.equal(view.customerAttention.length, 1);
  const sarah = view.customerAttention[0]!;
  assert.equal(sarah.name, "Sarah Whitmore");
  assert.ok(sarah.reasons.includes("OWED_COMMITMENT"));
  assert.match(sarah.why, /send you pictures/i);
  assert.deepEqual(sarah.ownerOwes, ["I'll send you pictures (this afternoon)"]);
  assert.equal(sarah.preparedActionCount, 1);

  // Someone who merely exists is not on the list.
  const quiet = build({
    relationships: [rel({ id: SARAH, displayName: "Sarah Whitmore" }), rel({ id: "other", displayName: "Nobody Special" })],
  });
  assert.ok(!quiet.customerAttention.some((c) => c.name === "Nobody Special"));
});

test("nothing crosses a workspace boundary", () => {
  const view = build({
    relationships: [
      rel({ id: SARAH, displayName: "Sarah Whitmore" }),
      rel({ id: "personal-1", displayName: "Ruth Callaghan", workspace: "personal" }),
    ],
    needs: [
      need({ id: "n1", attribute: "model", value: "crown signia" }),
      need({ id: "px", attribute: "model", value: "rav4", relationshipRef: "personal-1", workspace: "personal" }),
    ],
    proposals: [
      PROPOSAL,
      { ...PROPOSAL, proposalId: "p-personal", workspace: "personal", customerRef: "personal-1" },
    ],
  });
  const serialised = JSON.stringify(view);
  assert.ok(!/Ruth/i.test(serialised), "a personal contact reached the dealership dashboard");
  assert.ok(!/p-personal/.test(serialised), "a personal proposal reached the dealership dashboard");
  assert.ok(view.customerAttention.every((c) => c.relationshipRef !== "personal-1"));
});

// ---------------------------------------------------------------------------
// Price precision
// ---------------------------------------------------------------------------

test("website advertised and sticker figures are separate rows with separate sources", () => {
  const display = priceDisplayFromVehicle(vehicle());
  assert.equal(display.lines.length, 2);

  const advertised = display.lines.find((l) => l.kind === "WEBSITE_ADVERTISED")!;
  assert.equal(advertised.amount, 53378);
  assert.equal(advertised.label, "Website advertised price");
  assert.match(advertised.sourceLabel, /dealer website/);
  assert.equal(advertised.sourceRef, LISTING);

  const sticker = display.lines.find((l) => l.kind === "STICKER_UNSPECIFIED")!;
  assert.equal(sticker.amount, 49090);
  assert.match(sticker.label, /Sticker/);
  assert.match(sticker.sourceLabel, /window sticker/);

  // The two never merge, and the honest gap is stated rather than guessed away.
  assert.notEqual(advertised.amount, sticker.amount);
  assert.ok(display.precisionNote && /base MSRP or the total suggested retail/i.test(display.precisionNote));

  const text = formatPriceDisplay(display);
  assert.match(text, /Website advertised price: \$53,378/);
  assert.match(text, /Sticker MSRP: \$49,090/);
  // No bare "Price:" row anywhere — the reader always knows which number they are looking at.
  assert.ok(!/(^|\n)Price:/.test(text));
});

test("the three-line shape the Owner asked for is available when the components are known", () => {
  const display = priceDisplayFromParts({
    websiteAdvertised: { amount: 53378, sourceRef: LISTING },
    stickerBaseMsrp: { amount: 49090, sourceRef: "sticker:img-1" },
    stickerTotal: { amount: 53378, sourceRef: "sticker:img-1" },
  });
  const text = formatPriceDisplay(display);
  assert.match(text, /Website advertised price: \$53,378/);
  assert.match(text, /Sticker base MSRP: \$49,090/);
  assert.match(text, /Sticker total \(suggested retail\): \$53,378/);
  // Identical numbers, still separate provenance.
  assert.equal(display.lines.filter((l) => l.amount === 53378).length, 2);
  assert.equal(display.precisionNote, null, "nothing to caveat when each component was named");
});

test("a sticker figure is never quotable as the price, and an unknown price shows no number", () => {
  const stickerOnly = priceDisplayFromVehicle(vehicle({
    priceHistory: [{ at: NOW, advertisedPrice: null, msrp: 53378, dealerPrice: null, sourceUrl: "sticker:img-1" }],
  } as Partial<VehicleRecordV1>));
  assert.equal(hasQuotableAdvertisedPrice(stickerOnly), false);
  assert.equal(stickerOnly.advertised, null);

  const none = priceDisplayFromVehicle(vehicle({ priceHistory: [] } as Partial<VehicleRecordV1>));
  assert.equal(none.unknown, true);
  assert.ok(!/\$/.test(formatPriceDisplay(none)));
  assert.match(formatPriceDisplay(none), /not currently published/i);
});

test("the vehicle panel shows every price line and never says sold", () => {
  const view = build();
  const car = view.vehicleOpportunities[0]!;
  assert.equal(car.label, "2026 Toyota Crown Signia Limited");
  assert.equal(car.price.lines.length, 2);
  assert.ok(car.price.lines.every((l) => l.label && l.sourceLabel));

  const missing = build({
    lotWalkView: lotWalkView({
      vehicles: [{ ...lotWalkView().vehicles[0]!, websiteListing: "NOT_FOUND_ON_WEBSITE" }],
    } as Partial<LotWalkSessionViewV1>),
  });
  const note = missing.vehicleOpportunities[0]!.websiteNote;
  assert.match(note, /not the same as sold/i);
  assert.ok(!/\bsold\b(?!\.)/i.test(note.replace(/not the same as sold/i, "")));
});

// ---------------------------------------------------------------------------
// Calls, follow-ups, capability truth
// ---------------------------------------------------------------------------

test("a call states how speakers were decided and never invents diarisation", () => {
  const view = build();
  const call = view.calls[0]!;
  assert.equal(call.customerName, "Sarah Whitmore");
  assert.equal(call.identityState, "RESOLVED");
  assert.match(call.attributionNote, /session binding you supplied, not from automatic voice separation/i);

  const unresolved = build({
    conversations: [{
      ...CONVERSATION,
      identity: { ...CONVERSATION.identity, state: "UNRESOLVED", relationshipRef: null },
      segments: [{ index: 0, speaker: "UNKNOWN", text: "I need AWD.", startMs: 0 }],
    } as unknown as ConversationEventV1],
  });
  // An unresolved call is never attached to a person.
  assert.equal(unresolved.calls[0]!.customerName, null);
  assert.match(unresolved.calls[0]!.attributionNote, /nothing in this call is attributed to either party/i);
  assert.ok(unresolved.ownerMustDo.some((a) => /identify a call/i.test(a.label)));
});

test("prepared work is PREPARED, never sent or written", () => {
  const view = build();
  const item = view.preparedFollowups[0]!;
  assert.equal(item.status, "PREPARED");
  assert.equal(item.customerName, "Sarah Whitmore");
  assert.match(item.sourceSummary, /recorded call/i);
  const serialised = JSON.stringify(view.preparedFollowups);
  assert.ok(!/\bSENT\b|\bWRITTEN\b|LOGGED_IN_TEKION/i.test(serialised));
});

test("capability status separates a ready foundation from an external connection", () => {
  const view = build();
  const byArea = new Map(view.capabilityStatus.map((c) => [c.area, c]));
  assert.equal(byArea.get("Tekion connection")!.state, "NOT_CONNECTED");
  assert.match(byArea.get("Tekion connection")!.detail, /Safety harness ready/i);
  assert.equal(byArea.get("Social publishing")!.state, "NOT_CONNECTED");
  assert.equal(byArea.get("Public website")!.state, "NOT_DEPLOYED");
  assert.equal(byArea.get("Social drafts")!.state, "READY");
  assert.equal(byArea.get("Gmail")!.state, "READY");
  assert.match(byArea.get("Inventory")!.detail, /2,195/);
  // No button anywhere offers to write to Tekion.
  assert.ok(!/write to tekion/i.test(JSON.stringify(view)));
});

test("owner-must-do holds only what AION genuinely cannot do", () => {
  const view = build();
  assert.ok(view.ownerMustDo.some((a) => /call sarah/i.test(a.label)));
  assert.ok(view.ownerMustDo.some((a) => /re-photograph/i.test(a.label)));
  // Drafting is AION's job, so it must never appear as the Owner's.
  assert.ok(!view.ownerMustDo.some((a) => /draft|prepare a follow-up|write a post/i.test(a.label)));
  assert.ok(view.aionCanDo.length > 0);
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test("the sales day routes, and existing traffic is untouched", () => {
  const claimed: Array<[string, string]> = [
    ["Show me everything important", "SALES_TODAY"],
    ["My sales day", "SALES_TODAY"],
    ["What's my day look like?", "SALES_TODAY"],
    ["Who should I call?", "SALES_WHO_TO_CALL"],
    ["What customers need attention?", "SALES_WHO_TO_CALL"],
    ["What should I post today?", "SALES_CONTENT_COMMAND"],
    ["Make today's social content.", "SALES_CONTENT_COMMAND"],
    ["Create a weekly content plan", "SALES_CONTENT_COMMAND"],
    ["Make a Reel script for JTDACAAJ8T3051788", "SALES_CONTENT_COMMAND"],
    ["Which vehicles should I feature?", "SALES_CONTENT_COMMAND"],
    ["What's stale on my website?", "SALES_CONTENT_COMMAND"],
    // Same question the other way round. Found missing during integration acceptance.
    ["What website content is stale?", "SALES_CONTENT_COMMAND"],
    ["Prepare a website update", "SALES_CONTENT_COMMAND"],
  ];
  for (const [text, expected] of claimed) {
    assert.equal(routeCrmAssistantIntent(text).intent, expected, text);
  }

  const untouched: Array<[string, string]> = [
    // "What should I do (today)?" is the cross-workspace briefing and always has been — it covers
    // career and personal work too, so the sales day does not get to take it.
    ["What should I do?", "WORK_QUEUE"],
    ["What should I do today?", "WORK_QUEUE"],
    // Same words, different question: this one is answered from the vehicles just photographed.
    ["Who should I call from today's lot walk?", "VEHICLE_INVENTORY"],
    ["Show me the cars I photographed today", "VEHICLE_INVENTORY"],
    ["What needs me?", "WORK_QUEUE"],
    ["What changed?", "WORK_QUEUE"],
    ["What changed since yesterday?", "WORK_QUEUE"],
    ["Start my day.", "WORK_QUEUE"],
    ["What should I follow up on?", "LIST_FOLLOWUPS"],
    ["Who should I follow up with?", "LIST_FOLLOWUPS"],
    ["What does Sarah want?", "CUSTOMER_NEEDS"],
    ["Which vehicles fit Sarah?", "CUSTOMER_FIT"],
    ["Who might want this vehicle?", "VEHICLE_CUSTOMER_MATCH"],
    ["What should I know before I call Sarah?", "CUSTOMER_PRECALL"],
    ["What vehicles do we have?", "VEHICLE_INVENTORY"],
    ["What are my goals?", "OWNER_GOALS"],
    ["What jobs fit me?", "CAREER_PROFILE"],
  ];
  for (const [text, expected] of untouched) {
    assert.equal(routeCrmAssistantIntent(text).intent, expected, `"${text}" must still route to ${expected}`);
  }
});

// ---------------------------------------------------------------------------
// One interface, every domain
// ---------------------------------------------------------------------------

test("one call, one photo and one customer surface together in a single view", () => {
  const view = build();

  // The call produced needs, a commitment and a prepared action.
  assert.equal(view.calls.length, 1);
  assert.equal(view.preparedFollowups.length, 1);

  // The customer carries what the call established, and what the lot walk found.
  const sarah = view.customerAttention[0]!;
  assert.match(sarah.currentNeedSummary, /crown signia|awd/i);
  assert.ok(sarah.ownerOwes.length > 0);

  // The photographed vehicle is present with its price provenance and its interested customer.
  const car = view.vehicleOpportunities[0]!;
  assert.equal(car.vin, "JTDACAAJ8T3051788");
  assert.ok(car.interestedCustomers.some((c) => c.relationshipRef === SARAH));
  assert.equal(car.price.advertised?.amount, 53378);
  assert.equal(car.price.advertised?.sourceRef, LISTING);

  // The lot walk panel counts today's work.
  assert.equal(view.lotWalk.identified, 3);
  assert.equal(view.lotWalk.unresolvedPhotos, 1);

  // Today ties them together.
  assert.ok(view.today.headlines.some((h) => /customer/i.test(h)));
  assert.ok(view.today.headlines.some((h) => /photographed/i.test(h)));
  assert.ok(view.today.headlines.some((h) => /prepared/i.test(h)));

  // And nothing anywhere claims an external effect. Checked on the fields that carry state rather
  // than by scanning the blob — "NOT_DEPLOYED" contains "DEPLOYED", and a substring match here
  // would fail on exactly the honest label it is meant to protect.
  assert.equal(view.website.status, "PREPARED");
  assert.ok(view.preparedFollowups.every((f) => f.status === "PREPARED"));
  assert.ok(view.capabilityStatus.every((c) => ["READY", "NOT_CONNECTED", "NOT_DEPLOYED", "UNKNOWN"].includes(c.state)));
  assert.ok(view.capabilityStatus.some((c) => c.area === "Public website" && c.state === "NOT_DEPLOYED"));
  assert.ok(view.capabilityStatus.some((c) => c.area === "Social publishing" && c.state === "NOT_CONNECTED"));
});
