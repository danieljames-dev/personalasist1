/**
 * Conversation intelligence — identity, needs, commitments, matching, proposals.
 *
 * These tests are mostly about refusals. Attaching a conversation when the evidence is good is the
 * easy half; the half that protects a real customer is refusing to attach on a first name, refusing
 * to turn "maybe I'll stop by" into an appointment, and refusing to let a care-business contact
 * appear in a car-sales queue.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { RelationshipV1 } from "../src/contracts.js";
import type { VehicleRecordV1 } from "../src/vehicle-inventory.js";
import {
  applyOwnerIdentityCorrection,
  isSafeToAttribute,
  normalizePhone,
  resolveCustomerIdentity,
} from "../src/customer-identity.js";
import {
  currentNeeds, formatNeedChanges, needChanges, needFreshness, recordNeed,
  type CustomerNeedV1,
} from "../src/customer-needs.js";
import {
  extractFromEvent, isConfirmableCommitment, proposeCommitments,
  type ConversationEventV1,
} from "../src/conversation-event.js";
import {
  fitVehicleToNeeds, matchNeedsToInventory, matchVehicleToCustomers,
} from "../src/customer-inventory-match.js";
import { applyExecutionResult, buildCrmActionProposal } from "../src/crm-action-proposal.js";

const NOW = "2026-08-12T12:00:00.000Z";

function rel(over: Partial<RelationshipV1> & { id: string; displayName: string }): RelationshipV1 {
  return {
    workspace: "work", organisation: "", role: "", notes: "", objections: [], interests: [],
    archived: false, kind: "customer", lifecycle: "prospect", contactMethods: [],
    followUps: [], interactions: [],
    ...over,
  } as unknown as RelationshipV1;
}

const SARAH = rel({
  id: "sarah",
  displayName: "Sarah Whitmore",
  contactMethods: [
    { channel: "phone", label: "mobile", value: "(863) 555-0142" },
    { channel: "email", label: "home", value: "Sarah.W@example.com" },
  ] as RelationshipV1["contactMethods"],
});
const SARAH_TWO = rel({ id: "sarah2", displayName: "Sarah Delgado" });
const KRISTINA = rel({
  id: "kristina", displayName: "Kristina Leach", workspace: "compassionate-choice",
  contactMethods: [{ channel: "phone", label: "mobile", value: "863-555-0199" }] as RelationshipV1["contactMethods"],
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

test("exact phone resolves, however the number is written", () => {
  assert.equal(normalizePhone("(863) 555-0142"), "8635550142");
  assert.equal(normalizePhone("+1 863 555 0142"), "8635550142");
  const r = resolveCustomerIdentity({
    signals: { workspace: "work", phone: "+1-863-555-0142" },
    relationships: [SARAH, SARAH_TWO],
  });
  assert.equal(r.state, "RESOLVED");
  assert.equal(r.relationshipRef, "sarah");
  assert.equal(r.method, "EXACT_PHONE");
  assert.ok(isSafeToAttribute(r));
});

test("exact email resolves regardless of case", () => {
  const r = resolveCustomerIdentity({
    signals: { workspace: "work", email: "SARAH.W@Example.COM" },
    relationships: [SARAH, SARAH_TWO],
  });
  assert.equal(r.state, "RESOLVED");
  assert.equal(r.relationshipRef, "sarah");
  assert.equal(r.method, "EXACT_EMAIL");
});

test("a name alone never resolves anyone", () => {
  const r = resolveCustomerIdentity({
    signals: { workspace: "work", spokenName: "Sarah" },
    relationships: [SARAH],
  });
  assert.equal(r.state, "UNRESOLVED");
  assert.equal(r.relationshipRef, null);
  assert.equal(isSafeToAttribute(r), false);
  assert.match(r.message, /confirm/i, "must offer the Owner a way to resolve it");
});

test("two people with the same first name are ambiguous, never guessed", () => {
  const r = resolveCustomerIdentity({
    signals: { workspace: "work", spokenName: "Sarah" },
    relationships: [SARAH, SARAH_TWO],
  });
  assert.equal(r.state, "AMBIGUOUS");
  assert.equal(r.relationshipRef, null);
  assert.equal(r.candidates.length, 2);
});

test("conflicting strong signals are never resolved by precedence", () => {
  const other = rel({
    id: "other", displayName: "Marcus Reed",
    contactMethods: [{ channel: "email", label: "work", value: "sarah.w@example.com" }] as RelationshipV1["contactMethods"],
  });
  const r = resolveCustomerIdentity({
    signals: { workspace: "work", phone: "8635550142", email: "sarah.w@example.com" },
    relationships: [SARAH, other],
  });
  assert.equal(r.state, "CONFLICTING_SIGNALS");
  assert.equal(r.relationshipRef, null);
  assert.equal(r.candidates.length, 2);
});

test("identity never crosses a workspace boundary", () => {
  // Kristina's number, asked in the dealership workspace. Must not resolve her.
  const r = resolveCustomerIdentity({
    signals: { workspace: "work", phone: "863-555-0199" },
    relationships: [SARAH, KRISTINA],
  });
  assert.notEqual(r.relationshipRef, "kristina", "a care-business contact must not resolve in the dealership");
  assert.equal(r.state, "UNRESOLVED");
});

test("Owner correction re-points the link and flags that derived facts must be revisited", () => {
  const wrong = resolveCustomerIdentity({
    signals: { workspace: "work", phone: "8635550142" },
    relationships: [SARAH],
  });
  const corrected = applyOwnerIdentityCorrection({
    previous: wrong, relationshipRef: "sarah2", relationships: [SARAH, SARAH_TWO],
    at: NOW, note: "Sarah is a different person",
  });
  assert.equal(corrected.resolution.relationshipRef, "sarah2");
  assert.equal(corrected.resolution.method, "OWNER_ASSERTION");
  assert.equal(corrected.previous.relationshipRef, "sarah", "the original resolution is preserved");
  assert.equal(corrected.requiresReattribution, true, "facts under the old link must be revisited");
});

// ---------------------------------------------------------------------------
// Needs
// ---------------------------------------------------------------------------

function need(over: Partial<CustomerNeedV1> & { id: string; attribute: CustomerNeedV1["attribute"]; value: string }): CustomerNeedV1 {
  return {
    workspace: "work", relationshipRef: "sarah", numericValue: null, strength: "PREFERENCE",
    confidence: 85, sourceRef: "conversation:c1#1", observedAt: "2026-08-10T10:00:00.000Z",
    supersededAt: null, supersededBy: null, invalidatedAt: null, invalidationReason: null,
    ...over,
  } as CustomerNeedV1;
}

test("a new preference supersedes the old one without deleting it", () => {
  const monday = need({ id: "n1", attribute: "model", value: "camry", observedAt: "2026-08-10T10:00:00.000Z" });
  const friday = need({ id: "n2", attribute: "model", value: "suv", observedAt: "2026-08-14T10:00:00.000Z", sourceRef: "conversation:c2#3" });
  const all = recordNeed([monday], friday);

  assert.equal(all.length, 2, "nothing is deleted");
  const current = currentNeeds(all, "sarah");
  assert.equal(current.length, 1);
  assert.equal(current[0]!.value, "suv", "the newer evidence is current");
  const old = all.find((n) => n.id === "n1")!;
  assert.equal(old.supersededBy, "n2");
  assert.equal(old.value, "camry", "the original value is untouched");
});

test("the change history answers what changed, citing both sides", () => {
  const all = recordNeed(
    [need({ id: "n1", attribute: "model", value: "camry" })],
    need({ id: "n2", attribute: "model", value: "suv", observedAt: "2026-08-14T10:00:00.000Z", sourceRef: "conversation:c2#3" }),
  );
  const changes = needChanges(all, "sarah");
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.from, "camry");
  assert.equal(changes[0]!.to, "suv");
  assert.equal(changes[0]!.fromSourceRef, "conversation:c1#1");
  const text = formatNeedChanges(changes, "Sarah");
  assert.match(text, /camry/i);
  assert.match(text, /suv/i);
});

test("a different attribute does not disturb an unrelated one", () => {
  const all = recordNeed(
    [need({ id: "n1", attribute: "model", value: "camry" })],
    need({ id: "n2", attribute: "max-price", value: "35000", numericValue: 35000 }),
  );
  assert.equal(currentNeeds(all, "sarah").length, 2);
});

test("freshness ages a need rather than deleting it", () => {
  assert.equal(needFreshness(need({ id: "a", attribute: "model", value: "camry", observedAt: "2026-08-11T00:00:00.000Z" }), NOW), "FRESH");
  assert.equal(needFreshness(need({ id: "b", attribute: "model", value: "camry", observedAt: "2026-06-20T00:00:00.000Z" }), NOW), "AGING");
  assert.equal(needFreshness(need({ id: "c", attribute: "model", value: "camry", observedAt: "2026-01-01T00:00:00.000Z" }), NOW), "STALE");
});

// ---------------------------------------------------------------------------
// Commitments
// ---------------------------------------------------------------------------

test("a definite promise with a time becomes a confirmable commitment", () => {
  const [c] = proposeCommitments({
    segment: { index: 22, speaker: "OWNER", text: "I'll send you pictures this afternoon.", startMs: null },
    eventId: "c1",
  });
  assert.ok(c, "a promise should be proposed");
  assert.equal(c!.party, "OWNER_PROMISED");
  assert.equal(c!.timeHint, "this afternoon");
  assert.ok(isConfirmableCommitment(c!));
  assert.equal(c!.sourceRef, "conversation:c1#22", "must cite the sentence");
});

test("hedged language never becomes a commitment", () => {
  for (const text of [
    "Maybe I'll stop by this weekend.",
    "I might call you tomorrow.",
    "I'll try to get those over to you today.",
    "Hopefully I'll have an answer Friday.",
  ]) {
    const found = proposeCommitments({ segment: { index: 1, speaker: "CUSTOMER", text, startMs: null }, eventId: "c1" });
    assert.ok(!found.some(isConfirmableCommitment), `"${text}" must not become a commitment`);
  }
});

test("a failed extraction derives nothing at all", () => {
  const event = {
    id: "c1", workspace: "work", channel: "PHONE_CALL", direction: "INBOUND",
    occurredAt: NOW, capturedAt: NOW,
    identity: resolveCustomerIdentity({ signals: { workspace: "work", phone: "8635550142" }, relationships: [SARAH] }),
    evidenceRef: null,
    segments: [{ index: 1, speaker: "OWNER", text: "I'll call you tomorrow.", startMs: null }],
    summary: "", extraction: { provider: "whisper", ok: false, confidence: 0 },
    derived: { needIds: [], commitmentIds: [], proposalIds: [] },
    correctedAt: null, correctionNote: null,
  } as unknown as ConversationEventV1;
  const out = extractFromEvent(event);
  assert.deepEqual(out.commitments, []);
  assert.match(String(out.blocked), /extraction failed/i);
});

test("an unidentified conversation derives nothing but is still kept", () => {
  const event = {
    id: "c2", workspace: "work", channel: "PHONE_CALL", direction: "INBOUND",
    occurredAt: NOW, capturedAt: NOW,
    identity: resolveCustomerIdentity({ signals: { workspace: "work", spokenName: "Sarah" }, relationships: [SARAH, SARAH_TWO] }),
    evidenceRef: "document:abc",
    segments: [{ index: 1, speaker: "OWNER", text: "I'll call you tomorrow.", startMs: null }],
    summary: "", extraction: { provider: "whisper", ok: true, confidence: 90 },
    derived: { needIds: [], commitmentIds: [], proposalIds: [] },
    correctedAt: null, correctionNote: null,
  } as unknown as ConversationEventV1;
  const out = extractFromEvent(event);
  assert.deepEqual(out.commitments, []);
  assert.match(String(out.blocked), /not identified/i);
  assert.equal(event.evidenceRef, "document:abc", "the evidence is still stored");
});

// ---------------------------------------------------------------------------
// Inventory matching
// ---------------------------------------------------------------------------

function vehicle(over: Partial<VehicleRecordV1> & { id: string }): VehicleRecordV1 {
  return {
    vin: null, dealershipId: null, dealershipName: "Toyota", stockNumber: null,
    year: 2024, make: "Toyota", model: "Camry", trim: "XSE", condition: "new",
    exteriorColor: null, interiorColor: null, mileage: null, presenceStatus: "ONLINE_LISTED",
    listingUrl: "https://example.com/x", detailUrl: null, lastOnlineAt: NOW, lastPhysicalAt: null,
    priceHistory: [{ advertisedPrice: 33480 }], statusHistory: [], listingObservations: [],
    relationshipIds: [], opportunityIds: [],
    govVinFacts: { fuelType: "Gasoline" },
    ...over,
  } as unknown as VehicleRecordV1;
}

const NEEDS_SARAH: CustomerNeedV1[] = [
  need({ id: "p", attribute: "max-price", value: "35000", numericValue: 35000, strength: "HARD_REQUIREMENT" }),
  need({ id: "h", attribute: "powertrain", value: "hybrid", strength: "EXCLUSION" }),
  need({ id: "t", attribute: "trim", value: "xse", strength: "PREFERENCE" }),
  need({ id: "c", attribute: "color", value: "dark blue", strength: "PREFERENCE" }),
];

test("a hard requirement disqualifies rather than scoring low", () => {
  const hybrid = vehicle({ id: "v-hybrid", govVinFacts: { fuelType: "Gasoline, Hybrid" } as never });
  const fit = fitVehicleToNeeds({ vehicle: hybrid, needs: NEEDS_SARAH });
  assert.equal(fit.disqualified, true, "an excluded powertrain must disqualify");
  assert.equal(fit.matchScore, 0);
  assert.ok(matchNeedsToInventory({ needs: NEEDS_SARAH, vehicles: [hybrid] }).length === 0);
});

test("an over-budget vehicle is disqualified by the hard requirement", () => {
  const pricey = vehicle({ id: "v-pricey", priceHistory: [{ advertisedPrice: 41000 }] as never });
  assert.equal(fitVehicleToNeeds({ vehicle: pricey, needs: NEEDS_SARAH }).disqualified, true);
});

test("an unstated feature is reported unknown, never as a match", () => {
  const fit = fitVehicleToNeeds({ vehicle: vehicle({ id: "v1" }), needs: NEEDS_SARAH });
  assert.equal(fit.disqualified, false);
  const unknownAttrs = fit.unknowns.map((u) => u.attribute);
  assert.ok(unknownAttrs.includes("color"), "colour is not stated on the listing");
  const claimedAttrs = [...fit.hardRequirementsMet, ...fit.preferencesMet].map((c) => c.attribute);
  assert.ok(!claimedAttrs.includes("color"), "an unknown must never be claimed as a match");
});

test("a good fit ranks with its reasons", () => {
  const fits = matchNeedsToInventory({ needs: NEEDS_SARAH, vehicles: [vehicle({ id: "v1", vin: "4T1G11AK2PU131060" })] });
  assert.equal(fits.length, 1);
  assert.ok(fits[0]!.matchScore > 0);
  assert.ok(fits[0]!.why.some((w) => /trim/.test(w)));
});

test("reverse match excludes stale needs and says when the customer said it", () => {
  const fresh = new Map([["sarah", { name: "Sarah", needs: NEEDS_SARAH }]]);
  const hits = matchVehicleToCustomers({ vehicle: vehicle({ id: "v1" }), needsByCustomer: fresh, now: NOW });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.freshness, "FRESH");
  assert.ok(hits[0]!.matchedOn.length > 0, "must say which needs matched");

  const stale = new Map([["sarah", {
    name: "Sarah",
    needs: NEEDS_SARAH.map((n) => ({ ...n, observedAt: "2026-01-01T00:00:00.000Z" })),
  }]]);
  assert.equal(
    matchVehicleToCustomers({ vehicle: vehicle({ id: "v1" }), needsByCustomer: stale, now: NOW }).length,
    0,
    "a six-month-old want is not current intent",
  );
});

test("reverse match ignores low-confidence mentions", () => {
  const vague = new Map([["sarah", {
    name: "Sarah",
    needs: [need({ id: "v", attribute: "trim", value: "xse", confidence: 30 })],
  }]]);
  assert.equal(matchVehicleToCustomers({ vehicle: vehicle({ id: "v1" }), needsByCustomer: vague, now: NOW }).length, 0);
});

// ---------------------------------------------------------------------------
// CRM action proposals
// ---------------------------------------------------------------------------

const RESOLVED = resolveCustomerIdentity({ signals: { workspace: "work", phone: "8635550142" }, relationships: [SARAH] });

test("a proposal cannot be built from an unresolved identity", () => {
  const unresolved = resolveCustomerIdentity({ signals: { workspace: "work", spokenName: "Sarah" }, relationships: [SARAH] });
  const out = buildCrmActionProposal({
    proposalId: "p1", workspace: "work", identity: unresolved, action: "ADD_CALL_NOTE",
    note: "Discussed budget", sourceRefs: ["conversation:c1#3"], confidence: 80,
    expectedExternalEffect: "Adds a call note", now: NOW,
  });
  assert.ok("refused" in out);
  assert.match(out.reason, /grounded customer/i);
});

test("a proposal cannot cross workspaces", () => {
  const out = buildCrmActionProposal({
    proposalId: "p2", workspace: "compassionate-choice", identity: RESOLVED, action: "ADD_CALL_NOTE",
    note: "x", sourceRefs: ["conversation:c1#3"], confidence: 80,
    expectedExternalEffect: "Adds a call note", now: NOW,
  });
  assert.ok("refused" in out);
  assert.match(out.reason, /workspace mismatch/i);
});

test("a proposal must cite evidence and describe its effect plainly", () => {
  const noRefs = buildCrmActionProposal({
    proposalId: "p3", workspace: "work", identity: RESOLVED, action: "ADD_CALL_NOTE",
    note: "x", sourceRefs: [], confidence: 80, expectedExternalEffect: "Adds a note", now: NOW,
  });
  assert.ok("refused" in noRefs);
  const noEffect = buildCrmActionProposal({
    proposalId: "p4", workspace: "work", identity: RESOLVED, action: "ADD_CALL_NOTE",
    note: "x", sourceRefs: ["conversation:c1#3"], confidence: 80, expectedExternalEffect: "  ", now: NOW,
  });
  assert.ok("refused" in noEffect);
});

test("a grounded proposal carries a stable idempotency key", () => {
  const make = () => buildCrmActionProposal({
    proposalId: "p5", workspace: "work", identity: RESOLVED, action: "ADD_CALL_NOTE",
    note: "Discussed budget", sourceRefs: ["conversation:c1#3", "conversation:c1#7"], confidence: 80,
    expectedExternalEffect: "Adds a call note to Sarah's record", now: NOW,
  });
  const a = make(); const b = make();
  assert.ok(!("refused" in a) && !("refused" in b));
  assert.equal(a.idempotencyKey, b.idempotencyKey, "a retry must produce the same key");
  assert.equal(a.customerRef, "sarah");
  assert.equal(a.authorityRequired, "APPROVED_WRITE");
  assert.equal(a.status, "PROPOSED");
});

test("prepare-only actions need no write authority", () => {
  const p = buildCrmActionProposal({
    proposalId: "p6", workspace: "work", identity: RESOLVED, action: "PREPARE_FOLLOWUP",
    note: "x", sourceRefs: ["conversation:c1#3"], confidence: 80,
    expectedExternalEffect: "Drafts a follow-up for your review", now: NOW,
  });
  assert.ok(!("refused" in p));
  assert.equal(p.authorityRequired, "PREPARE_ONLY");
});

test("an uncertain write never counts as executed and is never auto-retried", () => {
  const p = buildCrmActionProposal({
    proposalId: "p7", workspace: "work", identity: RESOLVED, action: "ADD_CALL_NOTE",
    note: "x", sourceRefs: ["conversation:c1#3"], confidence: 80,
    expectedExternalEffect: "Adds a call note", now: NOW,
  });
  assert.ok(!("refused" in p));
  const after = applyExecutionResult(p, { outcome: "UNCERTAIN_WRITE", detail: "page navigated away", at: NOW });
  assert.equal(after.status, "UNCERTAIN");
  assert.notEqual(after.status, "EXECUTED");
  assert.match(String(after.resolutionNote), /may or may not/i);
});
