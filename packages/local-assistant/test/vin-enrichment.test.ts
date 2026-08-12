/**
 * Government VIN fact regressions.
 *
 * The decode is public-source evidence sitting *beside* dealer evidence, never on top of it. These
 * pin the rules that keep the two apart: dealer columns are untouched, a make/model disagreement is
 * recorded rather than resolved, an invalid VIN is never retried forever, and a cached vehicle is
 * never decoded twice.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGovVinFacts,
  vehiclesNeedingVinDecode,
  emptyVinDecode,
  parseNhtsaDecodePayload,
} from "../src/vehicle-inventory.js";

const NOW = "2026-08-12T03:00:00.000Z";
const VIN = "4T1G11AK2PU131060";

function decodePayload(over: Record<string, string> = {}) {
  return {
    Results: [{
      ModelYear: "2023", Make: "TOYOTA", Model: "Camry", Series: "SE",
      BodyClass: "Sedan/Saloon", DriveType: "FWD", FuelTypePrimary: "Gasoline",
      Manufacturer: "TOYOTA MOTOR MANUFACTURING, KENTUCKY, INC.",
      VehicleType: "PASSENGER CAR", EngineCylinders: "4", DisplacementL: "2.5",
      EngineConfiguration: "In-Line", TransmissionStyle: "Automatic",
      PlantCountry: "UNITED STATES (USA)", PlantCity: "GEORGETOWN",
      ElectrificationLevel: "", ErrorText: "0 - VIN decoded clean. Check Digit (9th position) is correct",
      ...over,
    }],
  };
}

test("government facts capture useful decoded fields", () => {
  const decode = parseNhtsaDecodePayload(VIN, decodePayload(), NOW);
  const facts = buildGovVinFacts({ decode, listingMake: "Toyota", listingModel: "Camry", vinValidity: "VALID", now: NOW });
  assert.equal(facts.status, "DECODED");
  assert.equal(facts.modelYear, "2023");
  assert.equal(facts.bodyClass, "Sedan/Saloon");
  assert.equal(facts.driveType, "FWD");
  assert.equal(facts.engineCylinders, "4");
  assert.equal(facts.displacementL, "2.5");
  assert.equal(facts.transmission, "Automatic");
  assert.equal(facts.plantCountry, "UNITED STATES (USA)");
  assert.ok(facts.manufacturer?.includes("TOYOTA"));
  assert.equal(facts.source, "https://vpic.nhtsa.dot.gov/api/");
  assert.equal(facts.decodedAt, NOW);
  assert.deepEqual(facts.conflictsWithListing, [], "agreeing evidence is not a conflict");
});

test("a make/model disagreement is recorded, never resolved", () => {
  const decode = parseNhtsaDecodePayload(VIN, decodePayload({ Make: "HONDA", Model: "Accord" }), NOW);
  const facts = buildGovVinFacts({ decode, listingMake: "Toyota", listingModel: "Camry", vinValidity: "VALID", now: NOW });
  assert.equal(facts.conflictsWithListing.length, 2);
  assert.ok(facts.conflictsWithListing[0]!.includes("dealer"));
  assert.ok(facts.conflictsWithListing[0]!.includes("government"));
  // Both evidence paths survive — the record does not pick a winner.
  assert.equal(facts.make, "HONDA");
});

test("missing values on either side are not treated as disagreement", () => {
  const decode = parseNhtsaDecodePayload(VIN, decodePayload({ Make: "" }), NOW);
  const facts = buildGovVinFacts({ decode, listingMake: "Toyota", listingModel: "Camry", vinValidity: "VALID", now: NOW });
  assert.deepEqual(facts.conflictsWithListing, [], "absence is not conflict");
});

test("an invalid VIN is marked and never retried", () => {
  const facts = buildGovVinFacts({
    decode: emptyVinDecode("NOTAVIN", NOW),
    listingMake: "Toyota", listingModel: "Camry", vinValidity: "INVALID", now: NOW,
  });
  assert.equal(facts.status, "VIN_INVALID");
  assert.equal(facts.retryEligible, false, "a structurally impossible VIN will never decode");
});

test("a transient decode failure stays retry-eligible", () => {
  const decode = emptyVinDecode(VIN, NOW);
  decode.errorText = "NHTSA HTTP 503";
  const facts = buildGovVinFacts({ decode, listingMake: "Toyota", listingModel: "Camry", vinValidity: "VALID", now: NOW });
  assert.equal(facts.status, "DECODE_FAILED");
  assert.equal(facts.retryEligible, true);
});

test("already-decoded vehicles are not decoded again", () => {
  const base = { id: "v1", vin: VIN, make: "Toyota", model: "Camry" } as never;
  const decoded = { ...(base as object), id: "v2", govVinFacts: { status: "DECODED", retryEligible: false } } as never;
  const invalid = { ...(base as object), id: "v3", govVinFacts: { status: "VIN_INVALID", retryEligible: false } } as never;
  const failed = { ...(base as object), id: "v4", govVinFacts: { status: "DECODE_FAILED", retryEligible: true } } as never;
  const noVin = { id: "v5", vin: null } as never;

  const pending = vehiclesNeedingVinDecode([base, decoded, invalid, failed, noVin]);
  const ids = pending.map((v) => v.id);
  assert.ok(ids.includes("v1"), "never-decoded is pending");
  assert.ok(ids.includes("v4"), "retry-eligible failure is pending");
  assert.ok(!ids.includes("v2"), "cached decode is skipped");
  assert.ok(!ids.includes("v3"), "invalid VIN is skipped");
  assert.ok(!ids.includes("v5"), "no VIN, nothing to decode");
});

test("batch limit bounds how many VINs a single run will decode", () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ id: `v${i}`, vin: VIN }) as never);
  assert.equal(vehiclesNeedingVinDecode(many, { limit: 10 }).length, 10);
});

test("dealer naming granularity is refinement, not conflict", async () => {
  const { detectListingConflicts } = await import("../src/vehicle-inventory.js");
  // The dealer routinely names a car more specifically than vPIC does.
  for (const [dealer, gov] of [
    ["RAV4 Hybrid", "RAV4"],
    ["Tacoma 4WD", "Tacoma"],
    ["Tundra i-FORCE MAX", "Tundra"],
    ["RC 200t", "RC"],
    ["Corolla Cross", "Corolla Cross"],
  ] as const) {
    assert.deepEqual(
      detectListingConflicts({ listingMake: "Toyota", listingModel: dealer, govMake: "TOYOTA", govModel: gov }),
      [],
      `"${dealer}" vs "${gov}" must not be reported as a conflict`,
    );
  }
});

test("a different manufacturer is a real conflict and must surface", async () => {
  const { detectListingConflicts } = await import("../src/vehicle-inventory.js");
  const hits = detectListingConflicts({ listingMake: "Toyota", listingModel: "Highlander", govMake: "HONDA", govModel: "Pilot" });
  assert.equal(hits.length, 2);
  assert.ok(hits.some((h) => h.startsWith("make")), "manufacturer divergence must be reported");
});

test("genuinely different model names still conflict", async () => {
  const { detectListingConflicts } = await import("../src/vehicle-inventory.js");
  const hits = detectListingConflicts({ listingMake: "Toyota", listingModel: "Camry", govMake: "TOYOTA", govModel: "Corolla" });
  assert.equal(hits.length, 1);
  assert.ok(hits[0]!.startsWith("model"));
});
