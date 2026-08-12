/**
 * Customer questions must reach the customer handlers — and nothing else may lose traffic to them.
 *
 * Before this routing existed, "What does Sarah want?" fell through to a raw-text name lookup and
 * came back as a generic account summary; "Who might want this vehicle?" matched two customers on
 * the words "want" and "vehicle" appearing in their notes. Explicit intents are the fix, and the
 * negative assertions below are what stop the fix from eating inventory and career traffic.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { routeCrmAssistantIntent } from "../src/crm-assistant.js";
import {
  answerCommitments, answerCustomerFit, answerCustomerNeeds, answerNeedsHistory,
  answerPrecallBrief, answerVehicleCustomerMatch, needsByCustomer,
} from "../src/customer-query-handlers.js";
import { recordNeed, type CustomerNeedV1 } from "../src/customer-needs.js";
import type { CommitmentCandidateV1 } from "../src/conversation-event.js";
import type { RelationshipV1 } from "../src/contracts.js";
import type { VehicleRecordV1 } from "../src/vehicle-inventory.js";

const NOW = "2026-08-12T12:00:00.000Z";

const ROUTES: Array<[string, string]> = [
  ["What does Sarah want?", "CUSTOMER_NEEDS"],
  ["What does Sarah want now?", "CUSTOMER_NEEDS"],
  ["What is Sarah looking for?", "CUSTOMER_NEEDS"],
  ["What changed in Sarah's needs?", "CUSTOMER_NEEDS_HISTORY"],
  ["What did Sarah want before?", "CUSTOMER_NEEDS_HISTORY"],
  ["Which vehicles fit Sarah?", "CUSTOMER_FIT"],
  ["Why doesn't this vehicle fit Sarah?", "CUSTOMER_FIT"],
  ["Who might want this vehicle?", "VEHICLE_CUSTOMER_MATCH"],
  ["What did I promise Sarah?", "CUSTOMER_COMMITMENTS"],
  ["What should I know before I call Sarah?", "CUSTOMER_PRECALL"],
];

test("every customer question reaches its own intent, with a clean subject", () => {
  for (const [q, expected] of ROUTES) {
    const r = routeCrmAssistantIntent(q);
    assert.equal(r.intent, expected, `"${q}" routed to ${r.intent}`);
  }
  // The subject must be the person, not the trailing verb — the handler looks the name up with it.
  assert.equal(routeCrmAssistantIntent("What does Sarah want?").subject, "Sarah");
  assert.equal(routeCrmAssistantIntent("What did I promise Sarah?").subject, "Sarah");
});

test("existing traffic is not stolen", () => {
  const untouched: Array<[string, string]> = [
    ["What vehicles do we have?", "VEHICLE_INVENTORY"],
    ["Show me Camrys under 30k", "VEHICLE_INVENTORY"],
    ["What jobs fit me?", "CAREER_PROFILE"],
    ["What are my goals?", "OWNER_GOALS"],
    ["What projects am I working on?", "PROJECT_STATUS"],
  ];
  for (const [q, expected] of untouched) {
    assert.equal(routeCrmAssistantIntent(q).intent, expected, `"${q}" must still route to ${expected}`);
  }
});

test("the am-inside-Camry class of bug stays impossible", () => {
  for (const q of ["What am I working toward?", "What projects am I working on?", "How am I doing?"]) {
    const intent = routeCrmAssistantIntent(q).intent;
    assert.ok(
      !intent.startsWith("CUSTOMER_") && intent !== "VEHICLE_CUSTOMER_MATCH",
      `"${q}" must not become a customer question (got ${intent})`,
    );
  }
});

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

function rel(over: Partial<RelationshipV1> & { id: string; displayName: string }): RelationshipV1 {
  return {
    workspace: "work", organisation: "", role: "", notes: "", objections: [], interests: [],
    archived: false, kind: "customer", lifecycle: "prospect", contactMethods: [],
    followUps: [], interactions: [],
    ...over,
  } as unknown as RelationshipV1;
}
const SARAH = rel({ id: "sarah", displayName: "Sarah" });
const KRISTINA = rel({ id: "kristina", displayName: "Kristina Leach", workspace: "compassionate-choice" });

function need(over: Partial<CustomerNeedV1> & { id: string; attribute: CustomerNeedV1["attribute"]; value: string }): CustomerNeedV1 {
  return {
    workspace: "work", relationshipRef: "sarah", numericValue: null, strength: "PREFERENCE",
    confidence: 85, sourceRef: "conversation:c1#0", observedAt: "2026-08-11T10:00:00.000Z",
    supersededAt: null, supersededBy: null, invalidatedAt: null, invalidationReason: null,
    ...over,
  } as CustomerNeedV1;
}

const NEEDS = [
  need({ id: "n1", attribute: "model", value: "camry" }),
  need({ id: "n2", attribute: "max-price", value: "35000", numericValue: 35000, strength: "HARD_REQUIREMENT" }),
  need({ id: "n3", attribute: "powertrain", value: "hybrid", strength: "EXCLUSION" }),
  need({ id: "n4", attribute: "color", value: "dark blue" }),
];

function vehicle(over: Partial<VehicleRecordV1> & { id: string }): VehicleRecordV1 {
  return {
    vin: "4T1G11AK2PU131060", dealershipId: null, dealershipName: "Toyota", stockNumber: null,
    year: 2024, make: "Toyota", model: "Camry", trim: "XSE", condition: "new",
    exteriorColor: null, interiorColor: null, mileage: null, presenceStatus: "ONLINE_LISTED",
    listingUrl: "https://example.com/x", detailUrl: null, lastOnlineAt: NOW, lastPhysicalAt: null,
    priceHistory: [{ advertisedPrice: 33480 }], statusHistory: [], listingObservations: [],
    relationshipIds: [], opportunityIds: [], govVinFacts: { fuelType: "Gasoline" },
    ...over,
  } as unknown as VehicleRecordV1;
}

test("the needs answer reads as prose, not a record dump", () => {
  const { reply } = answerCustomerNeeds({ customer: SARAH, needs: NEEDS });
  assert.match(reply, /Sarah/);
  assert.match(reply, /\$35,000/, "money is formatted for a person");
  assert.match(reply, /ruled out/i, "an exclusion is stated as such");
  assert.ok(!/MODEL=|CONFIDENCE=|HARD_REQUIREMENT|customerNeeds/.test(reply), `internal vocabulary leaked: ${reply}`);
});

test("no recorded needs reads as an invitation, not an error", () => {
  const { reply } = answerCustomerNeeds({ customer: SARAH, needs: [] });
  assert.match(reply, /don't have anything recorded/i);
  assert.ok(!/undefined|null|\[\]/.test(reply));
});

test("the history answer explains the transition", () => {
  const all = recordNeed(
    [need({ id: "old", attribute: "model", value: "camry" })],
    need({ id: "new", attribute: "model", value: "rav4", observedAt: "2026-08-14T10:00:00.000Z" }),
  );
  const { reply } = answerNeedsHistory({ customer: SARAH, needs: all });
  assert.match(reply, /camry/i);
  assert.match(reply, /rav4/i);
});

test("why-doesn't-it-fit answers with the disqualifiers", () => {
  const { reply, action } = answerCustomerFit({
    customer: SARAH, needs: NEEDS, vehicles: [vehicle({ id: "v1" })],
    question: "Why doesn't this vehicle fit Sarah?",
  });
  assert.equal(action, "customer.fit.explain");
  assert.match(reply, /rule|out|have to/i);
  assert.match(reply, /\$35,000/);
});

test("the fit answer names unknowns rather than claiming them", () => {
  const { reply } = answerCustomerFit({
    customer: SARAH, needs: NEEDS, vehicles: [vehicle({ id: "v1" })],
    question: "Which vehicles fit Sarah?",
  });
  assert.match(reply, /unknown/i, "an unstated listing field must be reported, not assumed");
});

test("reverse matching never leaves the workspace", () => {
  const kristinaNeeds = [need({ id: "k1", attribute: "model", value: "camry", relationshipRef: "kristina", workspace: "compassionate-choice" })];
  const grouped = needsByCustomer([...NEEDS, ...kristinaNeeds], [SARAH, KRISTINA], "work");
  assert.ok(grouped.has("sarah"));
  assert.equal(grouped.has("kristina"), false, "a care-business contact must never be a dealership prospect");

  const { reply, data } = answerVehicleCustomerMatch({
    vehicle: vehicle({ id: "v1" }), needsByCustomer: grouped, now: NOW,
  });
  assert.ok(!/Kristina/i.test(reply), "no cross-workspace name may appear");
  assert.ok(Array.isArray((data as { matches: unknown[] }).matches));
});

test("commitments distinguish who promised what, and flag what could not be attributed", () => {
  const candidates: CommitmentCandidateV1[] = [
    { party: "OWNER_PROMISED", statement: "I'll send you pictures", timeHint: "this afternoon", confidence: 85, sourceRef: "conversation:c1#2", reason: "definite" },
    { party: "CUSTOMER_PROMISED", statement: "I'll be there Saturday", timeHint: "saturday", confidence: 85, sourceRef: "conversation:c1#5", reason: "definite" },
    { party: "UNCERTAIN", statement: "I'll call", timeHint: null, confidence: 20, sourceRef: "conversation:c1#9", reason: "speaker unknown" },
  ];
  const mine = answerCommitments({ customer: SARAH, candidates, question: "What did I promise Sarah?" });
  assert.match(mine.reply, /You told Sarah/i);
  assert.match(mine.reply, /pictures/);
  assert.ok(!/be there Saturday/.test(mine.reply), "the customer's promise is not the Owner's");
  assert.match(mine.reply, /couldn't attribute/i, "unattributed promises must be surfaced");

  const theirs = answerCommitments({ customer: SARAH, candidates, question: "What did Sarah promise me?" });
  assert.match(theirs.reply, /Saturday/);
});

test("the pre-call brief leads with requirements and states the unknowns", () => {
  const candidates: CommitmentCandidateV1[] = [
    { party: "OWNER_PROMISED", statement: "send pictures", timeHint: "today", confidence: 85, sourceRef: "conversation:c1#2", reason: "definite" },
  ];
  const { reply } = answerPrecallBrief({
    customer: SARAH, needs: NEEDS, candidates, vehicles: [vehicle({ id: "v1" })],
  });
  assert.match(reply, /Sarah/);
  assert.match(reply, /\$35,000/);
  assert.match(reply, /You owe them/i, "an open promise must appear before a call");
  assert.match(reply, /don't state|worth confirming/i, "unknowns are what to ask about");
  assert.ok(!/HARD_REQUIREMENT|EXCLUSION|matchScore/.test(reply), `internal vocabulary leaked: ${reply}`);
});
