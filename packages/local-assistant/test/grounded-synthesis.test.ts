/**
 * The grounding contract, pinned by the failure that produced it.
 *
 * `qwen3:4b-instruct` was given five short grounded facts and asked which car to focus on. It
 * replied that a $34,120 car was "within Sarah Chen's budget of $33,000" and credited it with "AWD
 * availability" that appeared in none of the facts. Both sentences are reproduced verbatim below,
 * because a regression written from memory drifts and this one must not.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSynthesisPacket, validateSynthesis, findUnsupportedFigures, findBudgetContradictions,
  findUnsupportedAttributes, findUnsupportedReferences, allowedFigures,
  describePriceAgainstBudget, chooseOwnerFacingText, SYNTHESIS_PACKET_BUDGET_BYTES,
  type EvidenceFactV1, type ModelSynthesisResultV1,
} from "../src/grounded-synthesis.js";

const FACTS: EvidenceFactV1[] = [
  {
    factId: "f-price", type: "vehicle.price", value: 34120, sourceRef: "listing:camry",
    observedAt: "2026-08-12T10:00:00.000Z", confidence: 95, epistemicClass: "WEBSITE_FACT",
  },
  {
    factId: "f-budget", type: "customer.budget.max", value: 33000, sourceRef: "conversation:sarah",
    observedAt: "2026-08-11T10:00:00.000Z", confidence: 90, epistemicClass: "CUSTOMER_STATED",
  },
  {
    factId: "f-seen", type: "vehicle.physicalPresence", value: "photographed today",
    sourceRef: "photo:doc-a", observedAt: "2026-08-12T09:00:00.000Z", confidence: 99,
    epistemicClass: "PHYSICAL_OBSERVATION",
  },
];

const packet = () => buildSynthesisPacket({
  question: "Which of these should I focus on and why?",
  goal: "PRIORITIZE_VEHICLES",
  facts: FACTS,
  unknowns: ["drivetrain is not recorded"],
});

const draft = (draftResponse: string, supportingFactIds: string[] = ["f-price", "f-budget"]): ModelSynthesisResultV1 => ({
  answerIntent: "recommend", recommendations: [], supportingFactIds, inferences: [], unknowns: [],
  nextAction: null, draftResponse,
});

// ---------------------------------------------------------------------------
// THE MEASURED FAILURE — permanent regression
// ---------------------------------------------------------------------------

test("the exact sentence qwen produced is rejected", () => {
  // Verbatim from the measured run.
  const measured = "Focus on the Camry XLE. It's used, physically seen, priced at $34,120, and "
    + "within Sarah Chen's budget of $33,000 with AWD availability.";
  const validation = validateSynthesis(draft(measured), packet());

  assert.equal(validation.ok, false, "this reply must never reach the Owner");
  const kinds = validation.violations.map((v) => v.kind);
  assert.ok(kinds.includes("FALSE_BUDGET_COMPARISON"), `budget error not caught: ${JSON.stringify(kinds)}`);
  assert.ok(kinds.includes("UNSUPPORTED_ATTRIBUTE"), `AWD not caught: ${JSON.stringify(kinds)}`);
});

test("a price above a stated maximum is never described as within it", () => {
  const violations = findBudgetContradictions("It is within her budget.", FACTS);
  assert.equal(violations.length, 1);
  assert.match(violations[0]!.detail, /34120 is above the stated maximum 33000/);
  assert.match(violations[0]!.detail, /difference is 1120/);
});

test("the correct sentence states the gap and the direction from the arithmetic", () => {
  assert.equal(
    describePriceAgainstBudget(34120, 33000),
    "$34,120 — $1,120 above her stated max of $33,000.",
  );
  assert.equal(
    describePriceAgainstBudget(31500, 33000),
    "$31,500 — $1,500 under her stated max of $33,000.",
  );
  assert.match(describePriceAgainstBudget(33000, 33000), /exactly her stated max/);
});

test("a true budget claim is not flagged", () => {
  const cheap: EvidenceFactV1[] = [
    { ...FACTS[0]!, value: 31500 },
    FACTS[1]!,
  ];
  assert.deepEqual(findBudgetContradictions("Comfortably within her budget.", cheap), []);
  // And the inverse: claiming "over" when it is not.
  assert.equal(findBudgetContradictions("That is above her stated max.", cheap).length, 1);
});

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

test("an attribute that appears in no fact cannot be asserted", () => {
  const violations = findUnsupportedAttributes("It has AWD and a sunroof.", FACTS);
  assert.equal(violations.length, 2, JSON.stringify(violations));
  assert.ok(violations.some((v) => /AWD/.test(v.detail)));
});

test("saying an attribute is unknown stays allowed", () => {
  // The honest answer must not trip the guard that exists to protect it.
  for (const honest of [
    "AWD is unverified on this one.",
    "I don't know whether it has AWD.",
    "Drivetrain isn't recorded, so AWD is unconfirmed.",
    "Worth checking if it is a hybrid.",
  ]) {
    assert.deepEqual(findUnsupportedAttributes(honest, FACTS), [], honest);
  }
});

test("an attribute backed by a fact is allowed", () => {
  const withDrivetrain: EvidenceFactV1[] = [
    ...FACTS,
    {
      factId: "f-dt", type: "vehicle.drivetrain", value: "AWD", sourceRef: "listing:camry",
      observedAt: null, confidence: 95, epistemicClass: "WEBSITE_FACT",
    },
  ];
  assert.deepEqual(findUnsupportedAttributes("It is AWD.", withDrivetrain), []);
});

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

test("a figure that is neither a fact nor arithmetic on facts is rejected", () => {
  const violations = findUnsupportedFigures("Priced at $29,995 today.", FACTS);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.kind, "UNSUPPORTED_FIGURE");
});

test("a difference between two facts is allowed, because the correct sentence needs it", () => {
  assert.ok(allowedFigures(FACTS).has(1120), "34,120 − 33,000 must be writable");
  assert.deepEqual(findUnsupportedFigures("$1,120 above her stated max of $33,000.", FACTS), []);
});

test("citations must point at facts that were actually supplied", () => {
  const violations = findUnsupportedReferences(draft("fine", ["f-price", "f-invented"]), packet());
  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.fragment, "f-invented");
});

// ---------------------------------------------------------------------------
// What the Owner sees
// ---------------------------------------------------------------------------

test("a rejected draft falls back to complete deterministic text, not an apology", () => {
  const deterministic = "$34,120 — $1,120 above her stated max of $33,000.";
  const bad = draft("It is within her budget with AWD.");
  const chosen = chooseOwnerFacingText({
    deterministic, result: bad, validation: validateSynthesis(bad, packet()),
  });
  assert.equal(chosen.usedModel, false);
  assert.equal(chosen.text, deterministic);
  assert.ok(chosen.rejectedFor.includes("FALSE_BUDGET_COMPARISON"));
  assert.ok(!/sorry|unable|cannot/i.test(chosen.text), "the floor is a real answer");
});

test("a clean draft is allowed through", () => {
  const good = draft("The Camry is $34,120, which is $1,120 above her stated max of $33,000.");
  const validation = validateSynthesis(good, packet());
  assert.equal(validation.ok, true, JSON.stringify(validation.violations));
  const chosen = chooseOwnerFacingText({ deterministic: "fallback", result: good, validation });
  assert.equal(chosen.usedModel, true);
});

test("an empty draft is treated as no draft", () => {
  const empty = draft("   ");
  const chosen = chooseOwnerFacingText({
    deterministic: "real answer", result: empty, validation: validateSynthesis(empty, packet()),
  });
  assert.equal(chosen.usedModel, false);
  assert.equal(chosen.text, "real answer");
});

// ---------------------------------------------------------------------------
// The packet
// ---------------------------------------------------------------------------

test("the model never receives the whole state", () => {
  const many: EvidenceFactV1[] = Array.from({ length: 500 }, (_, i) => ({
    factId: `f${i}`, type: "vehicle.note", value: `note ${i} `.repeat(20),
    sourceRef: "x", observedAt: null, confidence: 50, epistemicClass: "KNOWN",
  }));
  const built = buildSynthesisPacket({ question: "q", goal: "PLAN_MY_DAY", facts: many });
  assert.ok(built.facts.length < many.length, "the packet must be bounded");
  assert.ok(Buffer.byteLength(JSON.stringify(built.facts), "utf8") <= SYNTHESIS_PACKET_BUDGET_BYTES * 2);
});

test("named unknowns survive into the packet so the model may report them", () => {
  const built = packet();
  assert.deepEqual(built.unknowns, ["drivetrain is not recorded"]);
});
