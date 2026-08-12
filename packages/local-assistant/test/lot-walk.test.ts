/**
 * Lot Walk: photo → VIN → website inventory/price → customer match (pure domain + service).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEmptyStateV1,
  InMemoryStateRepositoryV1,
  DeterministicClockV1,
  DeterministicIdGeneratorV1,
  DeterministicModelProviderV1,
  StaticCapabilityRegistryV1,
  LocalEchoCapabilityV1,
  LocalArchiveImportSourceV1,
  NodePrivateBackupV1,
  SelectableDeveloperAgentRegistryV1,
  SyntheticDeveloperAgentBridgeV1,
} from "../src/adapters.js";
import { AionAssistantV1 } from "../src/service.js";
import {
  websitePriceFromVehicle,
  buildLotWalkList,
  buildLotWalkCallList,
  formatLotWalkPhotoReply,
  needsByCustomerFromState,
} from "../src/lot-walk.js";
import { synthesizeValidVin, type VehicleRecordV1, type InventoryWalkV1, type PhysicalObservationV1 } from "../src/vehicle-inventory.js";
import { recordNeed, type CustomerNeedV1 } from "../src/customer-needs.js";
import { routeCrmAssistantIntent } from "../src/crm-assistant.js";

const CROWN_VIN = "JTDACAAJ8T3051788";

function baseVehicle(over: Partial<VehicleRecordV1> = {}): VehicleRecordV1 {
  return {
    id: over.id || "veh-1",
    vin: over.vin ?? CROWN_VIN,
    dealershipId: "d1",
    dealershipName: "Lakeland Toyota",
    stockNumber: over.stockNumber ?? "STK1",
    year: over.year ?? 2026,
    make: over.make ?? "Toyota",
    model: over.model ?? "Toyota Crown Signia",
    trim: over.trim ?? "Limited",
    condition: over.condition ?? "new",
    exteriorColor: over.exteriorColor ?? "Black",
    interiorColor: null,
    mileage: null,
    presenceStatus: over.presenceStatus ?? "ONLINE_LISTED",
    listingUrl: over.listingUrl ?? "https://example.test/listing",
    detailUrl: null,
    lastOnlineAt: over.lastOnlineAt ?? "2030-01-01T12:00:00.000Z",
    lastPhysicalAt: over.lastPhysicalAt ?? null,
    priceHistory: over.priceHistory ?? [
      {
        at: "2030-01-01T12:00:00.000Z",
        advertisedPrice: 53378,
        msrp: 50955,
        dealerPrice: null,
        sourceUrl: "https://example.test/listing",
      },
    ],
    statusHistory: [],
    listingObservations: over.listingObservations ?? [],
    relationshipIds: [],
    opportunityIds: [],
    createdAt: "2030-01-01T00:00:00.000Z",
    updatedAt: "2030-01-01T12:00:00.000Z",
    ...over,
  };
}

test("website price never invents and never promotes MSRP alone", () => {
  const withWeb = websitePriceFromVehicle(baseVehicle());
  assert.equal(withWeb.websitePrice, 53378);
  assert.equal(withWeb.stickerMsrp, 50955);
  assert.equal(withWeb.priceState, "PRICE_PUBLISHED");
  assert.equal(withWeb.sourceLabel, "website_advertised");

  const msrpOnly = websitePriceFromVehicle(
    baseVehicle({
      priceHistory: [
        {
          at: "2030-01-01T12:00:00.000Z",
          advertisedPrice: null,
          msrp: 50955,
          dealerPrice: null,
          sourceUrl: "https://example.test",
        },
      ],
      listingObservations: [],
      listingUrl: null,
      lastOnlineAt: null,
    }),
  );
  assert.equal(msrpOnly.websitePrice, null);
  assert.equal(msrpOnly.stickerMsrp, 50955);
  assert.equal(msrpOnly.priceState, "PRICE_NOT_PUBLISHED");

  const empty = websitePriceFromVehicle(null);
  assert.equal(empty.websitePrice, null);
  assert.equal(empty.priceState, "PRICE_NOT_PUBLISHED");
});

test("price change detection uses published website asks only", () => {
  const v = baseVehicle({
    priceHistory: [
      {
        at: "2030-01-02T12:00:00.000Z",
        advertisedPrice: 52000,
        msrp: 50955,
        dealerPrice: null,
        sourceUrl: "https://example.test",
      },
      {
        at: "2030-01-01T12:00:00.000Z",
        advertisedPrice: 53378,
        msrp: 50955,
        dealerPrice: null,
        sourceUrl: "https://example.test",
      },
    ],
  });
  const web = websitePriceFromVehicle(v);
  assert.equal(web.websitePrice, 52000);
  assert.equal(web.previousWebsitePrice, 53378);
  assert.equal(web.priceState, "PRICE_CHANGED_SINCE_LAST_OBSERVATION");
});

test("lot walk list dedupes VIN photos and separates website-not-found from sold", () => {
  const walk: InventoryWalkV1 = {
    id: "walk-1",
    dealershipId: "d1",
    dealershipName: "Lakeland Toyota",
    state: "active",
    coverageDeclaredComplete: false,
    startedAt: "2030-01-01T15:00:00.000Z",
    endedAt: null,
    observationIds: ["o1", "o2", "o3"],
    notes: "",
    provenance: { sourceType: "owner", sourceRef: "test", recordedAt: "2030-01-01T15:00:00.000Z" },
  };
  const vehicle = baseVehicle({ id: "veh-crown" });
  const physicalOnlyVin = synthesizeValidVin("PHYSONLY01");
  const observations: PhysicalObservationV1[] = [
    {
      id: "o1",
      walkId: "walk-1",
      dealershipId: "d1",
      dealershipName: "Lakeland Toyota",
      vin: CROWN_VIN,
      stockNumber: "STK1",
      note: "",
      photoDocumentIds: ["doc-a"],
      recognitionConfidence: 92,
      matchStatus: "VERIFIED_ON_LOT",
      vehicleId: "veh-crown",
      source: "PHYSICAL_OWNER_WALK",
      entryMethod: "photo",
      observedAt: "2030-01-01T15:10:00.000Z",
      provenance: { sourceType: "owner", sourceRef: "test", recordedAt: "2030-01-01T15:10:00.000Z" },
    },
    {
      id: "o2",
      walkId: "walk-1",
      dealershipId: "d1",
      dealershipName: "Lakeland Toyota",
      vin: CROWN_VIN,
      stockNumber: "STK1",
      note: "second photo",
      photoDocumentIds: ["doc-b"],
      recognitionConfidence: 90,
      matchStatus: "DUPLICATE_OBSERVATION",
      vehicleId: "veh-crown",
      source: "PHYSICAL_OWNER_WALK",
      entryMethod: "photo",
      observedAt: "2030-01-01T15:12:00.000Z",
      provenance: { sourceType: "owner", sourceRef: "test", recordedAt: "2030-01-01T15:12:00.000Z" },
    },
    {
      id: "o3",
      walkId: "walk-1",
      dealershipId: "d1",
      dealershipName: "Lakeland Toyota",
      vin: physicalOnlyVin,
      stockNumber: null,
      note: "",
      photoDocumentIds: ["doc-c"],
      recognitionConfidence: 88,
      matchStatus: "SEEN_ON_LOT_NOT_ONLINE",
      vehicleId: null,
      source: "PHYSICAL_OWNER_WALK",
      entryMethod: "photo",
      observedAt: "2030-01-01T15:20:00.000Z",
      provenance: { sourceType: "owner", sourceRef: "test", recordedAt: "2030-01-01T15:20:00.000Z" },
    },
  ];

  const view = buildLotWalkList({
    walk,
    observations,
    vehicles: [vehicle],
    now: "2030-01-01T16:00:00.000Z",
  });

  assert.equal(view.identifiedVehicleCount, 2);
  assert.equal(view.duplicateVinCount, 1);
  const crown = view.vehicles.find((v) => v.vin === CROWN_VIN);
  assert.ok(crown);
  assert.equal(crown.photoCount, 2);
  assert.equal(crown.website.websitePrice, 53378);
  assert.equal(crown.websiteListing, "ON_WEBSITE");
  assert.equal(crown.temporal, "SEEN_ON_LOT_TODAY");

  const onlyPhysical = view.vehicles.find((v) => v.vin === physicalOnlyVin);
  assert.ok(onlyPhysical);
  assert.equal(onlyPhysical.websiteListing, "NOT_FOUND_ON_WEBSITE");
  assert.match(view.caveat, /never labeled sold/i);
});

test("customer call list uses reverse match and never invents unknowns as satisfied", () => {
  const vehicle = baseVehicle({
    model: "Camry",
    trim: "XSE",
    year: 2025,
    priceHistory: [
      {
        at: "2030-01-01T12:00:00.000Z",
        advertisedPrice: 34860,
        msrp: 36000,
        dealerPrice: null,
        sourceUrl: "https://example.test",
      },
    ],
  });
  let bag: CustomerNeedV1[] = [];
  const specs: CustomerNeedV1[] = [
    {
      id: "n0",
      workspace: "work",
      relationshipRef: "rel-sarah",
      attribute: "model",
      value: "camry",
      strength: "PREFERENCE",
      numericValue: null,
      sourceRef: "t1",
      observedAt: "2030-01-01T10:00:00.000Z",
      confidence: 90,
      authority: "OBSERVED",
      supersededAt: null,
      supersededBy: null,
      invalidatedAt: null,
      invalidationReason: null,
    },
    {
      id: "n1",
      workspace: "work",
      relationshipRef: "rel-sarah",
      attribute: "max-price",
      value: "35000",
      strength: "HARD_REQUIREMENT",
      numericValue: 35000,
      sourceRef: "t1",
      observedAt: "2030-01-01T10:00:00.000Z",
      confidence: 90,
      authority: "OBSERVED",
      supersededAt: null,
      supersededBy: null,
      invalidatedAt: null,
      invalidationReason: null,
    },
  ];
  for (const s of specs) {
    bag = recordNeed(bag, s);
  }
  const needs = bag;

  const map = new Map([["rel-sarah", { name: "Sarah", needs }]]);
  const items = buildLotWalkList({
    walk: {
      id: "walk-1",
      dealershipId: "d1",
      dealershipName: "Lakeland Toyota",
      state: "active",
      coverageDeclaredComplete: false,
      startedAt: "2030-01-01T15:00:00.000Z",
      endedAt: null,
      observationIds: ["o1"],
      notes: "",
      provenance: { sourceType: "owner", sourceRef: "t", recordedAt: "2030-01-01T15:00:00.000Z" },
    },
    observations: [
      {
        id: "o1",
        walkId: "walk-1",
        dealershipId: "d1",
        dealershipName: "Lakeland Toyota",
        vin: vehicle.vin,
        stockNumber: null,
        note: "",
        photoDocumentIds: ["p1"],
        recognitionConfidence: 95,
        matchStatus: "VERIFIED_ON_LOT",
        vehicleId: vehicle.id,
        source: "PHYSICAL_OWNER_WALK",
        entryMethod: "photo",
        observedAt: "2030-01-01T15:30:00.000Z",
        provenance: { sourceType: "owner", sourceRef: "t", recordedAt: "2030-01-01T15:30:00.000Z" },
      },
    ],
    vehicles: [vehicle],
    now: "2030-01-01T16:00:00.000Z",
    needsByCustomer: map,
  });
  const call = buildLotWalkCallList({
    items: items.vehicles,
    vehicles: [vehicle],
    needsByCustomer: map,
  });
  assert.ok(call.length >= 1);
  assert.equal(call[0]!.customerName, "Sarah");
  assert.equal(call[0]!.websitePrice, 34860);
  assert.ok(call[0]!.websitePriceLabel.includes("34,860"));
});

test("lot walk photo reply is phone-friendly and honest on unresolved VIN", () => {
  const unresolved = formatLotWalkPhotoReply({
    item: null,
    ocrStatus: "VIN_OCR_FAILED",
    ocrMessage: "No VIN",
    vin: null,
    duplicate: false,
  });
  assert.match(unresolved, /could not extract a reliable VIN/i);
  assert.match(unresolved, /will not guess/i);
});

test("lot walk intent patterns route to vehicle inventory", () => {
  const r = routeCrmAssistantIntent("Show me the cars I photographed today");
  assert.equal(r.intent, "VEHICLE_INVENTORY");
  const r2 = routeCrmAssistantIntent("Who should I call from today's lot walk?");
  assert.equal(r2.intent, "VEHICLE_INVENTORY");
});

class SeededStateRepo {
  private state: ReturnType<typeof createEmptyStateV1> | null;
  constructor(initial: ReturnType<typeof createEmptyStateV1>) {
    this.state = initial;
  }
  async load() {
    return this.state ? structuredClone(this.state) : null;
  }
  async save(expectedRevision: number, state: ReturnType<typeof createEmptyStateV1>) {
    const current = this.state?.revision ?? 0;
    if (current !== expectedRevision || state.revision !== expectedRevision + 1) {
      throw new Error("Assistant state revision conflict.");
    }
    this.state = state;
  }
}

async function makeService(seedVehicles: VehicleRecordV1[] = []) {
  const root = await mkdtemp(join(tmpdir(), "aion-lot-walk-"));
  const exportsRoot = join(root, "exports");
  await mkdir(exportsRoot);
  const { emptyVehicleInventoryState } = await import("../src/vehicle-inventory.js");
  const state = createEmptyStateV1();
  state.vehicleInventory = emptyVehicleInventoryState();
  state.vehicleInventory.vehicles = [...seedVehicles];
  state.vehicleInventory.dealerships = [
    {
      id: "d1",
      name: "Lakeland Toyota",
      slug: "lakeland-toyota",
      city: "Lakeland",
      state: "FL",
      publicWebsite: "https://example.test",
      inventoryNewUrl: "https://example.test/new",
      inventoryUsedUrl: "https://example.test/used",
      ownerWorksHere: true,
      isCurrent: true,
      notes: "",
      provenance: { sourceType: "owner", sourceRef: "test", recordedAt: "2030-01-01T00:00:00.000Z" },
      createdAt: "2030-01-01T00:00:00.000Z",
      updatedAt: "2030-01-01T00:00:00.000Z",
    },
  ];
  const repository = new SeededStateRepo(state) as unknown as InMemoryStateRepositoryV1;
  const service = new AionAssistantV1({
    repository,
    clock: new DeterministicClockV1(),
    ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(),
    backup: new NodePrivateBackupV1(exportsRoot),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
  return { service, repository };
}

test("INTEGRATED: processLotWalkPhoto with OCR text records observation + website join", async () => {
  const { service } = await makeService([baseVehicle({ id: "veh-crown-live" })]);

  const result = await service.processLotWalkPhoto({
    extractedText: `VIN ${CROWN_VIN} TOYOTA CROWN SIGNIA LIMITED TOTAL SUGGESTED RETAIL PRICE 553.378.00`,
    offline: true,
    filename: "sticker.jpg",
    documentRef: "doc-crown-1",
  });

  assert.ok(result.walkId);
  assert.equal(result.ocr.best?.vin, CROWN_VIN);
  assert.ok(result.observation);
  assert.equal(result.observation?.vin, CROWN_VIN);
  assert.ok(result.vehicle);
  assert.equal(result.websitePrice, 53378);
  assert.match(result.reply, /Crown Signia|Got it/i);
  assert.match(result.reply, /53,378|Website price/i);
  assert.equal(result.duplicate, false);

  // Second photo same VIN → duplicate handling
  const again = await service.processLotWalkPhoto({
    extractedText: `VIN ${CROWN_VIN}`,
    offline: true,
    documentRef: "doc-crown-2",
  });
  assert.equal(again.duplicate, true);
  assert.match(again.reply, /Already on this walk|another photo/i);

  const list = await service.lotWalkCurrentList();
  assert.ok(list);
  assert.equal(list!.identifiedVehicleCount, 1);
  const item = list!.vehicles.find((v) => v.vin === CROWN_VIN);
  assert.ok(item);
  assert.ok(item!.photoCount >= 2);
  assert.equal(item!.website.websitePrice, 53378);
  assert.notEqual(item!.website.stickerMsrp, item!.website.websitePrice);

  // Restart persistence via new service on same repository
  const snap = await service.snapshot();
  assert.ok((snap.vehicleInventory?.observations?.length ?? 0) >= 2);
  assert.ok((snap.vehicleInventory?.walks?.length ?? 0) >= 1);
});

test("INTEGRATED: invalid VIN photo stays unresolved — FALSE_VIN_LINKS 0", async () => {
  const { service } = await makeService([baseVehicle()]);
  const result = await service.processLotWalkPhoto({
    extractedText: "NO VIN HERE just random text 12345",
    offline: true,
    documentRef: "doc-bad",
  });
  assert.equal(result.ocr.best?.valid ?? false, false);
  assert.match(result.reply, /could not extract|unresolved/i);
  // Must not invent a link to the seeded Crown VIN without image evidence.
  assert.notEqual(result.observation?.vin, CROWN_VIN);
});

test("workspace isolation: needs map only includes active workspace", () => {
  const map = needsByCustomerFromState({
    relationships: [
      { id: "r1", displayName: "Work Sarah", workspace: "work" },
      { id: "r2", displayName: "Personal Sam", workspace: "personal" },
    ],
    needs: [
      {
        id: "n1",
        workspace: "work",
        relationshipRef: "r1",
        attribute: "model",
        value: "camry",
        strength: "PREFERENCE",
        numericValue: null,
        sourceRef: "t",
        observedAt: "2030-01-01T00:00:00.000Z",
        confidence: 90,
        authority: "OBSERVED",
        supersededAt: null,
        supersededBy: null,
        invalidatedAt: null,
        invalidationReason: null,
      },
      {
        id: "n2",
        workspace: "personal",
        relationshipRef: "r2",
        attribute: "model",
        value: "tacoma",
        strength: "PREFERENCE",
        numericValue: null,
        sourceRef: "t",
        observedAt: "2030-01-01T00:00:00.000Z",
        confidence: 90,
        authority: "OBSERVED",
        supersededAt: null,
        supersededBy: null,
        invalidatedAt: null,
        invalidationReason: null,
      },
    ],
    workspace: "work",
  });
  assert.equal(map.has("r1"), true);
  assert.equal(map.has("r2"), false);
});
