/**
 * Model knowledge + VIN answer regressions.
 *
 * The line that matters: general trim knowledge must never read as a claim about a specific car.
 * These pin the model lookup, the trim comparisons a salesperson actually asks for, and the
 * grouping/caveats in a VIN answer.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  TOYOTA_MODEL_KNOWLEDGE,
  findModelKnowledge,
  findTrimsInText,
  modelKnowledgeLines,
  trimsByFocus,
} from "../src/toyota-model-knowledge.js";
import { vinDetailLines } from "../src/vehicle-intelligence.js";

test("inventory-weighted models are covered", () => {
  const names = TOYOTA_MODEL_KNOWLEDGE.map((m) => m.model);
  for (const expected of ["Corolla", "Camry", "Tacoma", "RAV4", "Tundra", "Corolla Cross", "Highlander"]) {
    assert.ok(names.includes(expected), `${expected} must be covered`);
  }
});

test("model lookup prefers the longer alias", () => {
  assert.equal(findModelKnowledge("what corolla cross trims are there")?.model, "Corolla Cross");
  assert.equal(findModelKnowledge("difference between corolla le and se")?.model, "Corolla");
  assert.equal(findModelKnowledge("tacoma trd off-road vs trd sport")?.model, "Tacoma");
  assert.equal(findModelKnowledge("what about a peugeot"), null);
});

test("named trims are extracted for comparison questions", () => {
  const tacoma = findModelKnowledge("tacoma")!;
  const trims = findTrimsInText(tacoma, "what is the difference between TRD Sport and TRD Off-Road");
  const names = trims.map((t) => t.trim);
  assert.ok(names.includes("TRD Sport"));
  assert.ok(names.includes("TRD Off-Road"));
});

test("the sport/off-road distinction salespeople conflate is captured", () => {
  const tacoma = findModelKnowledge("tacoma")!;
  assert.equal(trimsByFocus(tacoma, "sport").some((t) => t.trim === "TRD Sport"), true);
  assert.equal(trimsByFocus(tacoma, "off-road").some((t) => t.trim === "TRD Off-Road"), true);
  assert.match(tacoma.caveat, /TRD Sport is street-focused/i);
});

test("every model knowledge answer disclaims VIN-specific equipment", () => {
  for (const model of TOYOTA_MODEL_KNOWLEDGE) {
    const lines = modelKnowledgeLines(model);
    assert.ok(lines.every((l) => l.class === "GENERAL_MODEL_KNOWLEDGE"), `${model.model} lines must all be general knowledge`);
    const joined = lines.map((l) => l.text).join(" ");
    assert.match(joined, /not the equipment on any specific VIN/i, `${model.model} must carry the VIN disclaimer`);
  }
});

test("RAV4 powertrain spread is explained, including the Prime naming difference", () => {
  const rav4 = findModelKnowledge("rav4")!;
  assert.match(rav4.hybrid, /plug-in/i);
  assert.match(rav4.hybrid, /RAV4 Prime \(PHEV\)/i, "the government naming difference must be explained, not treated as an error");
});

function vehicle(over: Record<string, unknown> = {}) {
  return {
    id: "v1", vin: "4T1G11AK2PU131060", year: 2023, make: "Toyota", model: "Camry", trim: "SE",
    condition: "used", stockNumber: null, exteriorColor: null, interiorColor: null, mileage: null,
    presenceStatus: "ONLINE_LISTED", listingUrl: "u", detailUrl: "u",
    priceHistory: [{ at: "t", advertisedPrice: 29640, msrp: null, dealerPrice: null }],
    statusHistory: [], listingObservations: [], relationshipIds: [], opportunityIds: [],
    ...over,
  } as never;
}

test("a VIN answer groups dealer and government evidence separately", () => {
  const v = vehicle({
    govVinFacts: {
      status: "DECODED", source: "https://vpic.nhtsa.dot.gov/api/", bodyClass: "Sedan/Saloon",
      driveType: "FWD", fuelType: "Gasoline", engineCylinders: "4", displacementL: "2.5",
      plantCountry: "USA", plantCity: "GEORGETOWN", conflictsWithListing: [],
    },
  });
  const text = vinDetailLines(v).map((l) => `${l.class}|${l.text}`).join("\n");
  assert.match(text, /LIVE_DEALER_INVENTORY\|Dealer listing —/);
  assert.match(text, /GOVERNMENT_VIN_FACT\|Government VIN decode —/);
  assert.match(text, /Sedan\/Saloon/);
  assert.match(text, /\$29,640/);
});

test("a VIN answer never claims recall clearance and always lists real unknowns", () => {
  const text = vinDetailLines(vehicle()).map((l) => l.text).join("\n").toLowerCase();
  assert.ok(!/\bhas no recalls\b/.test(text));
  assert.match(text, /vin-specific open-recall status/);
  assert.match(text, /installed packages and optional equipment/);
  assert.match(text, /physical presence on the lot/, "an online-only listing must say so");
});

test("unknowns reflect the actual vehicle, not a fixed checklist", () => {
  const complete = vehicle({ stockNumber: "L1234", exteriorColor: "White", mileage: 12000, presenceStatus: "PHYSICALLY_VERIFIED" });
  const text = vinDetailLines(complete, "what is unknown about this vin").map((l) => l.text).join(" ");
  assert.ok(!/stock number/i.test(text), "a known stock number must not be listed as unknown");
  assert.ok(!/exterior colour/i.test(text), "a known colour must not be listed as unknown");
  assert.ok(!/physical presence/i.test(text), "a physically verified car must not be listed as unseen");
});
