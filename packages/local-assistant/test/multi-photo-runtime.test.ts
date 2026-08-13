/**
 * The Owner's lot failure, reproduced through the real service method.
 *
 * He sent a sticker, a VIN close-up and a second page in one go. AION read them as three separate
 * questions, produced STDAAABS1RS004150 from the worst of them, refused it correctly, and had
 * nothing useful left to say. These tests drive `answerAboutVehiclePhotoBundle` — the actual runtime
 * entry point the server calls — rather than the domain function underneath it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryStateRepositoryV1, DeterministicClockV1, DeterministicIdGeneratorV1,
  DeterministicModelProviderV1, StaticCapabilityRegistryV1, LocalEchoCapabilityV1,
  LocalArchiveImportSourceV1, NodePrivateBackupV1, SelectableDeveloperAgentRegistryV1,
  SyntheticDeveloperAgentBridgeV1,
} from "../src/adapters.js";
import { AionAssistantV1 } from "../src/service.js";

const GOOD_VIN = "JTDACAAJ8T3051788";
const BAD_OCR = "STDAAABS1RS004150";
const OTHER_VIN = "JTDACAAU4V3084476";

async function makeService() {
  const root = await mkdtemp(join(tmpdir(), "aion-bundle-"));
  const exportsRoot = join(root, "exports");
  await mkdir(exportsRoot);
  const service = new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(),
    ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(),
    backup: new NodePrivateBackupV1(exportsRoot),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
  await service.updateSettings({ activeWorkspace: "work" });
  return service;
}

async function seedInventory(service: AionAssistantV1, vins: string[]) {
  await service.refreshDealershipInventory({
    dealershipName: "Lakeland Toyota", useFixture: true, fixtureVins: vins,
  });
  const state = await service.snapshot();
  return state.vehicleInventory?.vehicles ?? [];
}

/** A one-pixel JPEG. The OCR text is injected, so the bytes only need to be a valid image. */
const TINY_JPEG_B64 = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a"
  + "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/E"
  + "ABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

function photo(filename: string, documentRef: string) {
  return { contentBase64: TINY_JPEG_B64, mimeType: "image/jpeg", filename, documentRef };
}

type BundleData = {
  bundle: {
    resolution: string;
    validatedVin: string | null;
    vehicleRef: string | null;
    vinAgreementCount: number;
    money: { totalSuggestedRetail: { value: number } | null };
  };
  timings: Record<string, number>;
};

test("a bad first read does not abort the turn; a later photo resolves the vehicle", async () => {
  const service = await makeService();
  const vehicles = await seedInventory(service, [GOOD_VIN]);
  const crown = vehicles.find((v) => v.vin === GOOD_VIN);
  assert.ok(crown, "inventory fixture must seed the Crown");

  const result = await service.answerAboutVehiclePhotoBundle({
    text: "What car is this?",
    images: [photo("a.jpg", "doc-a"), photo("b.jpg", "doc-b"), photo("c.jpg", "doc-c")],
    conversationId: "conv-lot",
    offline: true,
    // Photo A is the Owner's real bad read; B carries the valid VIN; C carries sticker facts only.
    extractedTexts: [
      `VIN ${BAD_OCR} glare across the plate`,
      `VEHICLE IDENTIFICATION NUMBER ${GOOD_VIN}`,
      "TOTAL SUGGESTED RETAIL PRICE $53,378 CROWN SIGNIA LIMITED",
    ],
  });

  const data = result.data as BundleData;
  assert.equal(data.bundle.resolution, "RESOLVED", result.reply);
  assert.equal(data.bundle.validatedVin, GOOD_VIN, "the valid VIN from photo B must win");
  assert.equal(data.bundle.vehicleRef, crown!.id, "and it must join inventory exactly");
  assert.match(result.reply, /same vehicle/i);
  assert.match(result.reply, new RegExp(GOOD_VIN));
  // The invalid string must never reach the Owner as an identity.
  assert.ok(!result.reply.includes(BAD_OCR), "an invalid read is not an identity");

  // Photo C enriched the same vehicle.
  assert.equal(data.bundle.money.totalSuggestedRetail?.value, 53378);
  assert.match(result.reply, /53,378/);

  // Timings are measured per image and overall.
  assert.equal(typeof data.timings.total_ms, "number");
  assert.equal(typeof data.timings.ocr_image_1_ms, "number");
  assert.equal(typeof data.timings.bundle_assembly_ms, "number");
});

test("the resolved vehicle becomes the active context, so follow-ups need no VIN", async () => {
  const service = await makeService();
  await seedInventory(service, [GOOD_VIN]);
  await service.answerAboutVehiclePhotoBundle({
    text: "What car is this?",
    images: [photo("a.jpg", "doc-a"), photo("b.jpg", "doc-b")],
    conversationId: "conv-lot",
    offline: true,
    extractedTexts: [`VIN ${BAD_OCR}`, `VIN ${GOOD_VIN}`],
  });

  const state = await service.snapshot();
  const context = state.photoVehicleContext;
  assert.ok(context, "an identified vehicle must become the active context");
  assert.equal(context!.validatedVin, GOOD_VIN);
  assert.ok(context!.vehicleId, "and it must point at the inventory record");
});

test("two valid conflicting VINs are left unresolved, never merged into one car", async () => {
  const service = await makeService();
  await seedInventory(service, [GOOD_VIN, OTHER_VIN]);

  const result = await service.answerAboutVehiclePhotoBundle({
    text: "What are these?",
    images: [photo("a.jpg", "doc-a"), photo("b.jpg", "doc-b")],
    conversationId: "conv-lot",
    offline: true,
    extractedTexts: [`VIN ${GOOD_VIN}`, `VIN ${OTHER_VIN}`],
  });

  const data = result.data as BundleData;
  assert.equal(data.bundle.resolution, "UNRESOLVED_CONFLICTING_VINS");
  assert.equal(data.bundle.validatedVin, null, "a conflict must not be resolved by preference");
  assert.equal(data.bundle.vehicleRef, null, "FALSE_VIN_LINKS must stay zero");
  assert.match(result.reply, /two cars or one bad read|different valid VINs/i);
});

test("no valid VIN produces useful recovery advice, not a bare refusal", async () => {
  const service = await makeService();
  await seedInventory(service, [GOOD_VIN]);
  const result = await service.answerAboutVehiclePhotoBundle({
    text: "What car is this?",
    images: [photo("a.jpg", "doc-a")],
    conversationId: "conv-lot",
    offline: true,
    extractedTexts: [`VIN ${BAD_OCR}`],
  });
  const data = result.data as BundleData;
  assert.equal(data.bundle.resolution, "UNRESOLVED_NO_VALID_VIN");
  assert.equal(data.bundle.vehicleRef, null);
  // The Owner is standing at the car — the reply must say what would fix it.
  assert.match(result.reply, /VIN plate|barcode/i);
});

test("identifying a vehicle from photos does not claim it is physically on the lot", async () => {
  const service = await makeService();
  await seedInventory(service, [GOOD_VIN]);
  await service.answerAboutVehiclePhotoBundle({
    text: "What car is this?",
    images: [photo("b.jpg", "doc-b")],
    conversationId: "conv-lot",
    offline: true,
    extractedTexts: [`VIN ${GOOD_VIN}`],
  });
  const state = await service.snapshot();
  // A photo is identification, not a physical observation. Only a lot walk creates one of those.
  assert.equal((state.vehicleInventory?.observations ?? []).length, 0);
});
