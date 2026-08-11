import assert from "node:assert/strict";
import test from "node:test";
import {
  answerVehicleQuery,
  isFixtureVehicle,
  matchCustomerToVehicles,
  TOYOTA_CAMRY_TRIM_KNOWLEDGE,
} from "../src/vehicle-intelligence.js";
import type { VehicleRecordV1 } from "../src/vehicle-inventory.js";
import type { RelationshipV1 } from "../src/contracts.js";

const now = "2026-08-12T15:00:00.000Z";

function liveVehicle(partial: Partial<VehicleRecordV1> & { id: string; vin: string }): VehicleRecordV1 {
  return {
    dealershipId: "d1",
    dealershipName: "Lakeland Toyota",
    stockNumber: null,
    year: 2026,
    make: "Toyota",
    model: "Camry",
    trim: "LE",
    condition: "new",
    exteriorColor: null,
    interiorColor: null,
    mileage: null,
    presenceStatus: "ONLINE_LISTED",
    listingUrl: "https://www.lakelandtoyota.com/vehicledetailsvin.aspx?vin=" + partial.vin,
    detailUrl: "https://www.lakelandtoyota.com/vehicledetailsvin.aspx?vin=" + partial.vin,
    lastOnlineAt: now,
    lastPhysicalAt: null,
    priceHistory: [{ at: now, advertisedPrice: 28000, dealerPrice: null, msrp: null, sourceUrl: "public" }],
    statusHistory: [],
    listingObservations: [
      {
        id: "l1",
        retrievedAt: now,
        sourceUrl: "https://www.lakelandtoyota.com/searchnew.aspx",
        sourceType: "public-dealer-site",
        vin: partial.vin,
        stockNumber: null,
        year: 2026,
        make: "Toyota",
        model: "Camry",
        trim: "LE",
        condition: "new",
        exteriorColor: null,
        interiorColor: null,
        mileage: null,
        advertisedPrice: 28000,
        msrp: null,
        dealerPrice: null,
        listingUrl: null,
        detailUrl: null,
        availability: "available",
        raw: {},
      },
    ],
    relationshipIds: [],
    opportunityIds: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

function fixtureVehicle(id: string, vin: string): VehicleRecordV1 {
  return liveVehicle({
    id,
    vin,
    model: "Camry",
    trim: "XLE",
    listingObservations: [
      {
        id: "f1",
        retrievedAt: now,
        sourceUrl: "fixture",
        sourceType: "fixture",
        vin,
        stockNumber: "L1000",
        year: 2024,
        make: "Toyota",
        model: "Camry",
        trim: "XLE",
        condition: "used",
        exteriorColor: "White",
        interiorColor: "Black",
        mileage: 12000,
        advertisedPrice: 28000,
        msrp: 32000,
        dealerPrice: null,
        listingUrl: null,
        detailUrl: null,
        availability: "available",
        raw: {},
      },
    ],
  });
}

test("fixture vehicles are never treated as live lot", () => {
  const f = fixtureVehicle("v1", "1HGCMRW1X00000000");
  assert.equal(isFixtureVehicle(f), true);
  const live = liveVehicle({ id: "v2", vin: "5YFB4MDEXTP490712" });
  assert.equal(isFixtureVehicle(live), false);
});

test("vehicle query prefers live inventory and labels knowledge class", () => {
  const vehicles = [
    fixtureVehicle("f1", "1HGCMRW1X00000000"),
    liveVehicle({ id: "l1", vin: "5YFB4MDEXTP490712", model: "Corolla", trim: "LE", priceHistory: [{ at: now, advertisedPrice: 25248, dealerPrice: null, msrp: null, sourceUrl: "public" }] }),
    liveVehicle({ id: "l2", vin: "4T1G11AK0PU000001", model: "Camry", trim: "SE", priceHistory: [{ at: now, advertisedPrice: 29500, dealerPrice: null, msrp: null, sourceUrl: "public" }] }),
  ];
  const ans = answerVehicleQuery({
    query: "What Camrys do we have under $30000?",
    vehicles,
    nowIso: now,
    lastInventoryRefresh: { "lakeland-toyota": now },
  });
  assert.ok(ans.vehicles.every((v) => v.sourceClass === "LIVE_DEALER_INVENTORY"));
  assert.ok(ans.vehicles.some((v) => /camry/i.test(v.model || "")));
  assert.ok(!ans.vehicles.some((v) => v.vin === "1HGCMRW1X00000000"));
  assert.match(ans.reply, /LIVE_DEALER_INVENTORY/);
  assert.doesNotMatch(ans.reply, /FIXTURE_DEMO.*Camry XLE/);
});

test("trim comparison is general model knowledge not unit equipment", () => {
  const ans = answerVehicleQuery({
    query: "What is the difference between LE, SE, XLE and XSE?",
    vehicles: [],
    nowIso: now,
  });
  assert.ok(ans.lines.some((l) => l.class === "GENERAL_MODEL_KNOWLEDGE"));
  assert.ok(TOYOTA_CAMRY_TRIM_KNOWLEDGE.length >= 4);
  assert.match(ans.reply, /GENERAL_MODEL_KNOWLEDGE/);
  assert.match(ans.reply, /not this car's installed equipment/i);
});

test("stale inventory warns when refresh is old", () => {
  const ans = answerVehicleQuery({
    query: "What SUVs do we have?",
    vehicles: [liveVehicle({ id: "s1", vin: "5TDGZRAH0PS000001", model: "Highlander", trim: "XLE" })],
    nowIso: now,
    lastInventoryRefresh: { "lakeland-toyota": "2026-08-01T00:00:00.000Z" },
  });
  assert.ok(ans.staleWarning);
  assert.match(ans.reply, /stale|age/i);
});

test("customer match shows why conflicts and unknowns without inventing affordability", () => {
  const rel = {
    id: "r1",
    displayName: "Sarah",
    workspace: "work",
    relationshipType: "customer",
    archived: false,
    notes: "",
    interests: [{ id: "i1", kind: "vehicle", description: "Camry under $30000", createdAt: now }],
    preferences: [],
    objections: [],
    followUps: [],
    appointments: [],
    interactions: [],
  } as unknown as RelationshipV1;
  const vehicles = [
    liveVehicle({
      id: "c1",
      vin: "4T1G11AK0PU000002",
      model: "Camry",
      trim: "LE",
      priceHistory: [{ at: now, advertisedPrice: 28000, dealerPrice: null, msrp: null, sourceUrl: "public" }],
    }),
    liveVehicle({
      id: "c2",
      vin: "4T1G11AK0PU000003",
      model: "Camry",
      trim: "XSE",
      priceHistory: [{ at: now, advertisedPrice: 38000, dealerPrice: null, msrp: null, sourceUrl: "public" }],
    }),
  ];
  const matches = matchCustomerToVehicles({ relationship: rel, vehicles, nowIso: now });
  assert.ok(matches.length >= 1);
  const under = matches.find((m) => m.vin === "4T1G11AK0PU000002");
  assert.ok(under);
  assert.ok(under!.whyMatches.some((w) => /Camry/i.test(w)));
  const over = matches.find((m) => m.vin === "4T1G11AK0PU000003");
  if (over) {
    assert.ok(over.knownConflicts.some((c) => /budget/i.test(c)) || over.score < under!.score);
  }
});

test("sold / no longer available uses NO_LONGER_FOUND_ONLINE not invention", () => {
  const gone = liveVehicle({
    id: "g1",
    vin: "5YFB4MDEXTP490799",
    model: "Corolla",
    presenceStatus: "NO_LONGER_FOUND_ONLINE",
  });
  const ans = answerVehicleQuery({
    query: "Which vehicles are no longer available?",
    vehicles: [gone, liveVehicle({ id: "g2", vin: "5YFB4MDEXTP490712", model: "Corolla" })],
    nowIso: now,
    lastInventoryRefresh: { "lakeland-toyota": now },
  });
  assert.ok(ans.vehicles.every((v) => v.vin === "5YFB4MDEXTP490799"));
});
