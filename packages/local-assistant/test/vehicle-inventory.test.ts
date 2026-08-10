import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOnlineListings,
  buildDealershipContext,
  emptyVehicleInventoryState,
  extractVinCandidatesFromText,
  listingFromPartial,
  matchObservationToInventory,
  normalizeVinCandidate,
  parseNhtsaDecodePayload,
  queryVehicles,
  reconcileInventoryWalk,
  synthesizeValidVin,
  validateVin,
  vinCheckDigitValid,
  type InventoryWalkV1,
  type PhysicalObservationV1,
  type VehicleRecordV1,
} from "../src/vehicle-inventory.js";
import { parsePublicInventoryHtml, buildFixtureLakelandInventory } from "../src/connectors/dealership-inventory.js";

test("valid VIN normalizes and passes check digit", () => {
  const vin = synthesizeValidVin("TESTWALK01");
  assert.equal(vin.length, 17);
  assert.equal(vinCheckDigitValid(vin), true);
  const r = validateVin(`  ${vin.toLowerCase()}  `);
  assert.equal(r.valid, true);
  assert.equal(r.normalized, vin);
  assert.equal(r.code, "VALID");
});

test("invalid VIN length rejected", () => {
  const r = validateVin("SHORT");
  assert.equal(r.valid, false);
  assert.equal(r.code, "INVALID_LENGTH");
});

test("illegal VIN characters rejected", () => {
  const r = validateVin("1HGCM82633A12345O"); // O illegal
  assert.equal(r.valid, false);
  assert.ok(r.code === "INVALID_CHARACTERS" || r.code === "CHECK_DIGIT_FAIL" || r.code === "INVALID_LENGTH");
});

test("check digit failure detected", () => {
  const vin = synthesizeValidVin("CHECKFAIL1");
  const broken = vin.slice(0, 8) + (vin[8] === "1" ? "2" : "1") + vin.slice(9);
  const r = validateVin(broken);
  assert.equal(r.valid, false);
  assert.equal(r.code, "CHECK_DIGIT_FAIL");
});

test("extract VIN candidates from OCR-like text", () => {
  const vin = synthesizeValidVin("OCRVIN001");
  const text = `STOCK L1234\nVIN: ${vin}\nMSRP $32000`;
  const found = extractVinCandidatesFromText(text);
  assert.ok(found.includes(vin));
});

test("NHTSA payload parse does not invent fields", () => {
  const now = "2030-01-01T00:00:00.000Z";
  const vin = synthesizeValidVin("NHTSA001");
  const decoded = parseNhtsaDecodePayload(
    vin,
    {
      Results: [
        {
          ModelYear: "2025",
          Make: "TOYOTA",
          Model: "Camry",
          Trim: "XLE",
          ErrorCode: "0",
          ErrorText: "",
        },
      ],
    },
    now,
  );
  assert.equal(decoded.year, "2025");
  assert.equal(decoded.make, "TOYOTA");
  assert.equal(decoded.model, "Camry");
  assert.equal(decoded.source, "nhtsa-vpic");
  assert.equal(decoded.trim, "XLE");
});

test("duplicate VIN online refresh keeps one vehicle and price history", () => {
  const now = "2030-01-01T00:00:00.000Z";
  const later = "2030-01-02T00:00:00.000Z";
  let seq = 0;
  const nextId = (k: string) => `${k}-${seq++}`;
  const dealer = buildDealershipContext(
    { name: "Lakeland Toyota", slug: "lakeland-toyota", isCurrent: true },
    { id: "d1", now },
  );
  const vin = synthesizeValidVin("DUP001");
  const l1 = listingFromPartial(
    { vin, stockNumber: "L1", year: 2025, make: "Toyota", model: "Camry", advertisedPrice: 30000 },
    { id: nextId("listing"), now, sourceUrl: "https://example.com/a", sourceType: "fixture" },
  );
  let state = emptyVehicleInventoryState();
  state = applyOnlineListings(state, dealer, [l1], now, nextId);
  assert.equal(state.vehicles.length, 1);
  const l2 = listingFromPartial(
    { vin, stockNumber: "L1", year: 2025, make: "Toyota", model: "Camry", advertisedPrice: 29500 },
    { id: nextId("listing"), now: later, sourceUrl: "https://example.com/b", sourceType: "fixture" },
  );
  state = applyOnlineListings(state, dealer, [l2], later, nextId);
  assert.equal(state.vehicles.length, 1);
  assert.equal(state.vehicles[0]!.priceHistory.length, 2);
  assert.equal(state.vehicles[0]!.priceHistory[0]!.advertisedPrice, 29500);
  assert.equal(state.vehicles[0]!.vin, vin);
});

test("online-only vs physical-only matching", () => {
  const vinOnline = synthesizeValidVin("ONLINE01");
  const vinPhysical = synthesizeValidVin("PHYS01");
  const vehicles: VehicleRecordV1[] = [
    {
      id: "v1",
      vin: vinOnline,
      dealershipId: "d1",
      dealershipName: "Lakeland Toyota",
      stockNumber: "S1",
      year: 2025,
      make: "Toyota",
      model: "Tacoma",
      trim: null,
      condition: "new",
      exteriorColor: null,
      interiorColor: null,
      mileage: null,
      presenceStatus: "ONLINE_LISTED",
      listingUrl: null,
      detailUrl: null,
      lastOnlineAt: "2030-01-01T00:00:00.000Z",
      lastPhysicalAt: null,
      priceHistory: [],
      statusHistory: [],
      listingObservations: [],
      relationshipIds: [],
      opportunityIds: [],
      createdAt: "2030-01-01T00:00:00.000Z",
      updatedAt: "2030-01-01T00:00:00.000Z",
    },
  ];
  const m1 = matchObservationToInventory({ vin: vinOnline, stockNumber: "S1" }, vehicles, "Lakeland Toyota");
  assert.equal(m1.matchStatus, "VERIFIED_ON_LOT");
  const m2 = matchObservationToInventory({ vin: vinPhysical, stockNumber: null }, vehicles, "Lakeland Toyota");
  assert.equal(m2.matchStatus, "SEEN_ON_LOT_NOT_ONLINE");
  const m3 = matchObservationToInventory(
    { vin: vinOnline, stockNumber: "WRONG" },
    vehicles,
    "Lakeland Toyota",
  );
  assert.equal(m3.matchStatus, "STOCK_NUMBER_MISMATCH");
});

test("walk reconciliation exceptions first + no false missing", () => {
  const now = "2030-01-01T12:00:00.000Z";
  const vinA = synthesizeValidVin("WALKA");
  const vinB = synthesizeValidVin("WALKB");
  const walk: InventoryWalkV1 = {
    id: "w1",
    dealershipId: "d1",
    dealershipName: "Lakeland Toyota",
    state: "complete",
    coverageDeclaredComplete: false,
    startedAt: now,
    endedAt: now,
    observationIds: ["o1"],
    notes: "",
    provenance: { sourceType: "owner", sourceRef: "test", recordedAt: now },
  };
  const observations: PhysicalObservationV1[] = [
    {
      id: "o1",
      walkId: "w1",
      dealershipId: "d1",
      dealershipName: "Lakeland Toyota",
      vin: vinA,
      stockNumber: null,
      note: "",
      photoDocumentIds: [],
      recognitionConfidence: 100,
      matchStatus: "VERIFIED_ON_LOT",
      vehicleId: "v1",
      source: "PHYSICAL_OWNER_WALK",
      entryMethod: "manual",
      observedAt: now,
      provenance: { sourceType: "owner", sourceRef: "test", recordedAt: now },
    },
  ];
  const vehicles: VehicleRecordV1[] = [
    {
      id: "v1",
      vin: vinA,
      dealershipId: "d1",
      dealershipName: "Lakeland Toyota",
      stockNumber: null,
      year: 2025,
      make: "Toyota",
      model: "Camry",
      trim: null,
      condition: "new",
      exteriorColor: null,
      interiorColor: null,
      mileage: null,
      presenceStatus: "PHYSICALLY_VERIFIED",
      listingUrl: null,
      detailUrl: null,
      lastOnlineAt: now,
      lastPhysicalAt: now,
      priceHistory: [],
      statusHistory: [],
      listingObservations: [],
      relationshipIds: [],
      opportunityIds: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "v2",
      vin: vinB,
      dealershipId: "d1",
      dealershipName: "Lakeland Toyota",
      stockNumber: null,
      year: 2025,
      make: "Toyota",
      model: "Tacoma",
      trim: null,
      condition: "new",
      exteriorColor: null,
      interiorColor: null,
      mileage: null,
      presenceStatus: "ONLINE_LISTED",
      listingUrl: null,
      detailUrl: null,
      lastOnlineAt: now,
      lastPhysicalAt: null,
      priceHistory: [],
      statusHistory: [],
      listingObservations: [],
      relationshipIds: [],
      opportunityIds: [],
      createdAt: now,
      updatedAt: now,
    },
  ];
  const summary = reconcileInventoryWalk(walk, observations, vehicles, now);
  assert.equal(summary.physicallyObservedCount, 1);
  assert.equal(summary.onlineButNotSeen.length, 1);
  assert.ok(summary.caveat.includes("does NOT mean missing"));
  assert.ok(summary.exceptionsFirst.some((e) => /not claimed missing/i.test(e)));
});

test("query vehicles by model and max price", () => {
  const vin = synthesizeValidVin("QUERY1");
  const vehicles: VehicleRecordV1[] = [
    {
      id: "v1",
      vin,
      dealershipId: "d1",
      dealershipName: "Lakeland Toyota",
      stockNumber: "X",
      year: 2025,
      make: "Toyota",
      model: "Highlander",
      trim: null,
      condition: "used",
      exteriorColor: null,
      interiorColor: null,
      mileage: 10000,
      presenceStatus: "ONLINE_LISTED",
      listingUrl: null,
      detailUrl: null,
      lastOnlineAt: null,
      lastPhysicalAt: null,
      priceHistory: [{ at: "2030-01-01T00:00:00.000Z", advertisedPrice: 35000, msrp: 40000, dealerPrice: null, sourceUrl: "x" }],
      statusHistory: [],
      listingObservations: [],
      relationshipIds: [],
      opportunityIds: [],
      createdAt: "2030-01-01T00:00:00.000Z",
      updatedAt: "2030-01-01T00:00:00.000Z",
    },
  ];
  const hits = queryVehicles(vehicles, { model: "Highlander", condition: "used", maxPrice: 40000 });
  assert.equal(hits.length, 1);
  assert.equal(queryVehicles(vehicles, { model: "Highlander", maxPrice: 30000 }).length, 0);
});

test("fixture inventory builds listings", () => {
  let n = 0;
  const vins = [synthesizeValidVin("FIX1"), synthesizeValidVin("FIX2")];
  const list = buildFixtureLakelandInventory("2030-01-01T00:00:00.000Z", (k) => `${k}-${n++}`, vins);
  assert.equal(list.length, 2);
  assert.equal(list[0]!.sourceType, "fixture");
});

test("HTML parser extracts JSON vin fields", () => {
  let n = 0;
  const vin = synthesizeValidVin("HTML1");
  const html = `<html><script>var data={"vin":"${vin}","stockNumber":"L99","year":2025,"make":"Toyota","model":"Camry","internetPrice":31000}</script></html>`;
  const listings = parsePublicInventoryHtml(html, "https://www.lakelandtoyota.com/searchnew.aspx", "2030-01-01T00:00:00.000Z", (k) => `${k}-${n++}`, "new");
  assert.ok(listings.some((l) => l.vin === vin));
});

test("normalize strips spaces", () => {
  assert.equal(normalizeVinCandidate("1hg cm 826 33a 004352"), "1HGCM82633A004352");
});
