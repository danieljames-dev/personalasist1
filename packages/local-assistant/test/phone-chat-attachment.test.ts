/**
 * Unified Chat attachment backend: upload → OCR path → VIN match → follow-ups.
 * Offline OCR text fixtures — no live Ollama required for unit correctness.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AionAssistantV1,
  DeterministicClockV1,
  DeterministicIdGeneratorV1,
  DeterministicModelProviderV1,
  FileStateRepositoryV1,
  InMemoryStateRepositoryV1,
  LocalArchiveImportSourceV1,
  LocalEchoCapabilityV1,
  NodePrivateBackupV1,
  SelectableDeveloperAgentRegistryV1,
  StaticCapabilityRegistryV1,
  SyntheticDeveloperAgentBridgeV1,
} from "../src/index.js";
import {
  buildPhotoProvenance,
  buildPhotoVehicleContext,
  isPhotoVehicleFollowUpQuestion,
  matchPhotoToVehicle,
  photoContextApplies,
} from "../src/photo-vehicle-match.js";
import { buildVinOcrResult } from "../src/vin-ocr.js";
import {
  cropPngToRegion,
  decodeSimplePng,
  encodeRgbaPng,
  vinIdentityCropRegions,
} from "../src/image-region.js";
import type { AssistantStateV1 } from "../src/contracts.js";
import type { VehicleRecordV1 } from "../src/vehicle-inventory.js";

const LIVE_VIN = "4T1G11AK2PU131060";
const NOW = "2026-08-12T00:00:00.000Z";

function ports(repository: InMemoryStateRepositoryV1 | FileStateRepositoryV1, exportsRoot: string) {
  return {
    repository,
    clock: new DeterministicClockV1(),
    ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(),
    backup: new NodePrivateBackupV1(exportsRoot),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aion-chat-attach-"));
  const exportsRoot = join(root, "exports");
  await mkdir(exportsRoot);
  const service = new AionAssistantV1(ports(new InMemoryStateRepositoryV1(), exportsRoot));
  return { service, root, exportsRoot };
}

function liveVehicle(over: Partial<VehicleRecordV1> = {}): VehicleRecordV1 {
  return {
    id: "veh-live-1",
    vin: LIVE_VIN,
    dealershipId: null,
    dealershipName: "Toyota of Example",
    stockNumber: "L1002",
    year: 2023,
    make: "Toyota",
    model: "Camry",
    trim: "SE",
    condition: "used",
    exteriorColor: "Silver",
    interiorColor: null,
    mileage: 12000,
    presenceStatus: "ONLINE_LISTED",
    listingUrl: "https://example.com/camry",
    detailUrl: null,
    lastOnlineAt: NOW,
    lastPhysicalAt: null,
    priceHistory: [{
      at: NOW,
      advertisedPrice: 24990,
      msrp: null,
      dealerPrice: null,
      sourceUrl: "https://example.com/camry",
    }],
    statusHistory: [],
    listingObservations: [],
    relationshipIds: [],
    opportunityIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

async function seedInventory(service: AionAssistantV1, vehicles: VehicleRecordV1[]) {
  const mutate = (service as unknown as {
    mutate: (fn: (draft: AssistantStateV1) => void) => Promise<void>;
  }).mutate.bind(service);
  await mutate((draft) => {
    if (!draft.vehicleInventory) {
      draft.vehicleInventory = {
        dealerships: [],
        vehicles: [],
        walks: [],
        observations: [],
        lastInventoryRefresh: {},
        onlineListings: [],
        walkAcceptanceMetrics: [],
      };
    }
    draft.vehicleInventory.vehicles = [...vehicles];
  });
}

test("follow-up question detector covers price/trim/recalls without pronouns", () => {
  assert.equal(isPhotoVehicleFollowUpQuestion("What's the price?"), true);
  assert.equal(isPhotoVehicleFollowUpQuestion("Does it have recalls?"), true);
  assert.equal(isPhotoVehicleFollowUpQuestion("What trim is it?"), true);
  assert.equal(isPhotoVehicleFollowUpQuestion("Would this fit Sarah?"), true);
  assert.equal(isPhotoVehicleFollowUpQuestion("hello world"), false);
});

test("photo context does not leak across workspaces or conversations", () => {
  const ocr = buildVinOcrResult({ extractedText: `VIN ${LIVE_VIN}`, provider: "fixture", extractionOk: true });
  const link = matchPhotoToVehicle({ ocr, vehicles: [liveVehicle()] });
  const prov = buildPhotoProvenance({
    link,
    imageSourceRef: "image:1",
    observedAt: NOW,
    extractionProvider: "fixture",
    vinCandidate: LIVE_VIN,
  });
  const ctx = buildPhotoVehicleContext({
    workspaceId: "work",
    conversationId: "conv-a",
    link,
    provenance: prov,
    setAt: NOW,
  });
  assert.equal(photoContextApplies(ctx, { workspaceId: "work", conversationId: "conv-a" }), true);
  assert.equal(photoContextApplies(ctx, { workspaceId: "personal", conversationId: "conv-a" }), false);
  assert.equal(photoContextApplies(ctx, { workspaceId: "work", conversationId: "conv-b" }), false);
  assert.equal(photoContextApplies(ctx, { workspaceId: "work", conversationId: null }), true);
});

test("resolvePhotoVehicleContext keeps conversation A vehicle out of conversation B", async () => {
  const { resolvePhotoVehicleContext, upsertPhotoVehicleContext } = await import("../src/photo-vehicle-match.js");
  const ocr = buildVinOcrResult({ extractedText: `VIN ${LIVE_VIN}`, provider: "fixture", extractionOk: true });
  const link = matchPhotoToVehicle({ ocr, vehicles: [liveVehicle()] });
  const prov = buildPhotoProvenance({
    link, imageSourceRef: "img", observedAt: NOW, extractionProvider: "fixture", vinCandidate: LIVE_VIN,
  });
  const ctxA = buildPhotoVehicleContext({
    workspaceId: "work", conversationId: "conv-a", link, provenance: prov, setAt: NOW,
  });
  const list = upsertPhotoVehicleContext([], ctxA);
  assert.equal(
    resolvePhotoVehicleContext(list, null, { workspaceId: "work", conversationId: "conv-b" }),
    null,
    "conversation B must not see conversation A's vehicle",
  );
  assert.equal(
    resolvePhotoVehicleContext(list, null, { workspaceId: "work", conversationId: "conv-a" })?.vehicleId,
    "veh-live-1",
  );
  assert.equal(
    resolvePhotoVehicleContext(list, null, { workspaceId: "personal", conversationId: "conv-a" }),
    null,
    "personal workspace must not see work photo vehicle",
  );
});

test("Chat photo path: validated VIN → inventory match → durable context → follow-ups", async () => {
  const { service } = await fixture();
  await seedInventory(service, [liveVehicle()]);

  const png = encodeRgbaPng(16, 16, Buffer.alloc(16 * 16 * 4, 200));
  const photo = await service.answerAboutVehiclePhoto({
    text: "What vehicle is this and what do we know about it?",
    contentBase64: png.toString("base64"),
    mimeType: "image/png",
    filename: "vin-plate.png",
    documentRef: "doc-test-1",
    conversationId: "conv-photo-1",
    offline: true,
    extractedText: `VIN ${LIVE_VIN}`,
  });

  assert.equal(photo.intent, "VEHICLE_PHOTO");
  assert.match(photo.reply, /Camry/i);
  assert.equal((photo.data as { matchState: string }).matchState, "EXACT_LIVE_MATCH");
  assert.equal((photo.data as { vehicleRef: string }).vehicleRef, "veh-live-1");
  assert.ok(photo.attachmentRef);

  const ctx = await service.getPhotoVehicleContext();
  assert.ok(ctx);
  assert.equal(ctx!.vehicleId, "veh-live-1");
  assert.equal(ctx!.validatedVin, LIVE_VIN);
  assert.equal(ctx!.provenance.imageSourceRef, "doc-test-1");

  const price = await service.assistantPrompt("What's the price?", { conversationId: "conv-photo-1" });
  assert.equal(price.intent, "VEHICLE_PHOTO_FOLLOWUP");
  assert.match(price.reply, /24,?990|advertised/i);

  const recalls = await service.assistantPrompt("Does it have recalls?", { conversationId: "conv-photo-1" });
  assert.equal(recalls.intent, "VEHICLE_PHOTO_FOLLOWUP");
  assert.match(recalls.reply, /recall/i);

  const trim = await service.assistantPrompt("What trim is it?", { conversationId: "conv-photo-1" });
  assert.equal(trim.intent, "VEHICLE_PHOTO_FOLLOWUP");
  assert.match(trim.reply, /SE|Camry|Dealer listing/i);
});

test("valid VIN not in inventory is not auto-linked", async () => {
  const { service } = await fixture();
  await seedInventory(service, []);

  const png = encodeRgbaPng(8, 8, Buffer.alloc(8 * 8 * 4, 10));
  const missing = await service.answerAboutVehiclePhoto({
    text: "What is this?",
    contentBase64: png.toString("base64"),
    offline: true,
    extractedText: `VIN ${LIVE_VIN}`,
    filename: "x.png",
    mimeType: "image/png",
  });
  assert.equal((missing.data as { matchState: string }).matchState, "VALID_VIN_NOT_IN_CURRENT_INVENTORY");
  assert.equal((missing.data as { vehicleRef: string | null }).vehicleRef, null);
  assert.match(missing.reply, /does not mean the VIN is wrong/i);
});

test("ambiguous multi-valid VIN candidates never auto-link", () => {
  const link = matchPhotoToVehicle({
    ocr: {
      status: "VIN_OCR_CONFIRM_REQUIRED",
      best: {
        vin: "4T1G11AK2PU131060",
        valid: true,
        confidence: 80,
        source: "corrected",
        corrections: ["G/6"],
        validation: {
          raw: "4T1G11AK2PU131060",
          normalized: "4T1G11AK2PU131060",
          valid: true,
          code: "VALID",
          checkDigitOk: true,
          message: "ok",
        },
      },
      candidates: [
        {
          vin: "4T1G11AK2PU131060",
          valid: true,
          confidence: 80,
          source: "corrected",
          corrections: [],
          validation: {
            raw: "4T1G11AK2PU131060",
            normalized: "4T1G11AK2PU131060",
            valid: true,
            code: "VALID",
            checkDigitOk: true,
            message: "ok",
          },
        },
        {
          vin: "4T1611AK2PU131060",
          valid: true,
          confidence: 78,
          source: "corrected",
          corrections: [],
          validation: {
            raw: "4T1611AK2PU131060",
            normalized: "4T1611AK2PU131060",
            valid: true,
            code: "VALID",
            checkDigitOk: true,
            message: "ok",
          },
        },
      ],
      sticker: {
        stockNumber: null, year: null, make: null, model: null, trim: null, price: null, mileage: null, rawSignals: [],
      },
      extractedText: "ambiguous",
      qualityFeedback: [],
      provider: "fixture",
      message: "confirm",
    },
    vehicles: [liveVehicle()],
  });
  assert.equal(link.state, "AMBIGUOUS_UNCONFIRMED_VIN");
  assert.equal(link.vehicleRef, null);
  assert.equal(link.matchMethod, "NONE");
});

test("document upload then photo identify reuses intake document ref", async () => {
  const { service } = await fixture();
  await seedInventory(service, [liveVehicle()]);
  const png = encodeRgbaPng(8, 8, Buffer.alloc(8 * 8 * 4, 40));
  const doc = await service.attachCrmDocument({
    filename: "chat-photo.png",
    mimeType: "image/png",
    byteLength: png.length,
    storedPath: "private/aion/intake/test/chat-photo.png",
    tags: ["chat-attachment", "photo"],
    kind: "image",
    summary: "Chat attachment",
  });
  assert.ok(doc.id);

  const photo = await service.answerAboutVehiclePhoto({
    text: "What vehicle is this?",
    contentBase64: png.toString("base64"),
    mimeType: "image/png",
    filename: "chat-photo.png",
    documentRef: doc.id,
    offline: true,
    extractedText: `VIN ${LIVE_VIN}`,
  });
  assert.equal(photo.documentRef, doc.id);
  const updated = (await service.listCrmDocuments()).find((d) => d.id === doc.id);
  assert.ok(updated);
  assert.match(updated!.summary, /photo-match:EXACT_LIVE_MATCH|vin:/i);
});

test("photo vehicle context survives process restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "aion-photo-restart-"));
  const dataRoot = join(root, "private", "aion");
  const exportsRoot = join(root, "exports");
  await mkdir(dataRoot, { recursive: true });
  await mkdir(exportsRoot);

  const first = new AionAssistantV1(ports(new FileStateRepositoryV1(dataRoot), exportsRoot));
  await seedInventory(first, [liveVehicle()]);
  const png = encodeRgbaPng(8, 8, Buffer.alloc(8 * 8 * 4, 1));
  await first.answerAboutVehiclePhoto({
    text: "Identify",
    contentBase64: png.toString("base64"),
    offline: true,
    extractedText: `VIN ${LIVE_VIN}`,
    filename: "a.png",
    mimeType: "image/png",
  });

  const second = new AionAssistantV1(ports(new FileStateRepositoryV1(dataRoot), exportsRoot));
  const ctx = await second.getPhotoVehicleContext();
  assert.ok(ctx?.vehicleId, "context must be durable in state");
  const follow = await second.assistantPrompt("What's the price?");
  assert.equal(follow.intent, "VEHICLE_PHOTO_FOLLOWUP");
});

test("image-region PNG crop round-trip and identity regions", () => {
  const w = 40;
  const h = 40;
  const rgba = Buffer.alloc(w * h * 4, 128);
  rgba[((h - 1) * w + (w - 1)) * 4] = 255;
  const png = encodeRgbaPng(w, h, rgba);
  const decoded = decodeSimplePng(png);
  assert.ok(decoded);
  assert.equal(decoded!.width, w);
  assert.equal(decoded!.height, h);

  const regions = vinIdentityCropRegions();
  assert.ok(regions.length >= 3);
  const crop = cropPngToRegion(png, regions[0]!);
  assert.ok(crop);
  const cropDecoded = decodeSimplePng(crop!);
  assert.ok(cropDecoded);
});

test("failed extraction yields no VIN candidates (no diagnostic-text mining)", () => {
  const failed = buildVinOcrResult({
    extractedText: "Image stored; vision model returned empty text.",
    provider: "ollama:moondream",
    extractionOk: false,
  });
  assert.equal(failed.candidates.length, 0);
  assert.equal(failed.best, null);
});
