/**
 * Inventory walk acceptance telemetry — mechanics only.
 * Does not claim REAL_DEALERSHIP_WALK physical PASS.
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
  InMemoryStateRepositoryV1,
  LocalArchiveImportSourceV1,
  LocalEchoCapabilityV1,
  NodePrivateBackupV1,
  SelectableDeveloperAgentRegistryV1,
  StaticCapabilityRegistryV1,
  SyntheticDeveloperAgentBridgeV1,
} from "../src/index.js";
import {
  buildWalkAcceptanceReport,
  buildWalkObservationTelemetry,
  deriveOnlineMatch,
  deriveStockMatch,
  mapEntryMethodToVinSource,
} from "../src/walk-acceptance.js";
import { synthesizeValidVin } from "../src/vehicle-inventory.js";
import type { InventoryWalkV1 } from "../src/vehicle-inventory.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aion-walk-acc-"));
  const exports = join(root, "exports");
  await mkdir(exports);
  const service = new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(),
    ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(),
    backup: new NodePrivateBackupV1(exports),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
  return { service };
}

test("mapEntryMethodToVinSource", () => {
  assert.equal(mapEntryMethodToVinSource("manual"), "manual");
  assert.equal(mapEntryMethodToVinSource("photo"), "windshield-photo");
  assert.equal(mapEntryMethodToVinSource("photo", "door-jamb-photo"), "door-jamb-photo");
  assert.equal(mapEntryMethodToVinSource("mixed", "stock-sticker"), "stock-sticker");
});

test("derive online/stock match helpers", () => {
  assert.equal(deriveOnlineMatch("VERIFIED_ON_LOT"), true);
  assert.equal(deriveOnlineMatch("SEEN_ON_LOT_NOT_ONLINE"), false);
  assert.equal(deriveStockMatch("A1", "A1", null), true);
  assert.equal(deriveStockMatch("A1", "B2", null), false);
  assert.equal(deriveStockMatch(null, "A1", null), null);
  assert.equal(deriveStockMatch("x", "y", "STOCK_MISMATCH"), false);
});

test("buildWalkObservationTelemetry fields", () => {
  const t = buildWalkObservationTelemetry(
    {
      walkId: "w1",
      workspace: "work",
      timestamp: "2030-06-10T12:00:00.000Z",
      vinSource: "windshield-photo",
      ocrResult: "BADVIN",
      ocrConfidence: 60,
      ownerCorrectionRequired: true,
      finalConfirmedVin: synthesizeValidVin("TEL01"),
      vinValidationCode: "VALID",
      vinValidationValid: true,
      onlineInventoryMatch: true,
      stockMatch: true,
      photoRetryCount: 2,
      processingDurationMs: 450,
      saveSuccess: true,
      observationId: "obs1",
      matchStatus: "VERIFIED_ON_LOT",
    },
    { id: "tel1" },
  );
  assert.equal(t.workspace, "work");
  assert.equal(t.vinSource, "windshield-photo");
  assert.equal(t.ownerCorrectionRequired, true);
  assert.equal(t.photoRetryCount, 2);
  assert.equal(t.processingDurationMs, 450);
  assert.equal(t.saveSuccess, true);
});

test("buildWalkAcceptanceReport aggregates and never auto-PASS", () => {
  const walk: InventoryWalkV1 = {
    id: "w1",
    dealershipId: "d1",
    dealershipName: "Lakeland Toyota",
    state: "complete",
    coverageDeclaredComplete: false,
    startedAt: "2030-06-10T10:00:00.000Z",
    endedAt: "2030-06-10T11:00:00.000Z",
    observationIds: ["o1", "o2"],
    notes: "",
    provenance: { sourceType: "owner", sourceRef: "walk", recordedAt: "2030-06-10T10:00:00.000Z" },
  };
  const vin = synthesizeValidVin("REP01");
  const entries = [
    buildWalkObservationTelemetry(
      {
        walkId: "w1",
        workspace: "work",
        timestamp: "2030-06-10T10:05:00.000Z",
        vinSource: "manual",
        finalConfirmedVin: vin,
        vinValidationValid: true,
        vinValidationCode: "VALID",
        onlineInventoryMatch: true,
        matchStatus: "VERIFIED_ON_LOT",
        processingDurationMs: 100,
        saveSuccess: true,
      },
      { id: "t1" },
    ),
    buildWalkObservationTelemetry(
      {
        walkId: "w1",
        workspace: "work",
        timestamp: "2030-06-10T10:06:00.000Z",
        vinSource: "windshield-photo",
        ocrConfidence: 70,
        ownerCorrectionRequired: true,
        finalConfirmedVin: synthesizeValidVin("REP02"),
        vinValidationValid: true,
        vinValidationCode: "VALID",
        onlineInventoryMatch: false,
        matchStatus: "SEEN_ON_LOT_NOT_ONLINE",
        photoRetryCount: 1,
        processingDurationMs: 300,
        saveSuccess: true,
      },
      { id: "t2" },
    ),
    buildWalkObservationTelemetry(
      {
        walkId: "w1",
        workspace: "work",
        timestamp: "2030-06-10T10:07:00.000Z",
        vinSource: "door-jamb-photo",
        saveSuccess: false,
        saveError: "disk full",
        vinValidationValid: false,
        vinValidationCode: "EMPTY",
        processingDurationMs: 50,
      },
      { id: "t3" },
    ),
  ];
  // Personal workspace entry must not pollute work report
  const otherWs = buildWalkObservationTelemetry(
    {
      walkId: "w1",
      workspace: "personal",
      timestamp: "2030-06-10T10:08:00.000Z",
      saveSuccess: true,
      vinValidationValid: true,
      vinValidationCode: "VALID",
      finalConfirmedVin: synthesizeValidVin("REP03"),
    },
    { id: "t4" },
  );
  const report = buildWalkAcceptanceReport({
    walk,
    entries: [...entries, otherWs],
    reconciliation: {
      walkId: "w1",
      dealershipName: "Lakeland Toyota",
      onlineInventoryCount: 5,
      physicallyObservedCount: 2,
      matchedCount: 1,
      onlineButNotSeen: [
        { vin: "X", stockNumber: null, year: 2024, make: "Toyota", model: "Camry" },
        { vin: "Y", stockNumber: null, year: null, make: null, model: null },
      ],
      seenButNotOnline: [],
      vinMismatches: [],
      stockMismatches: [{ observationId: "o9", detail: "stock" }],
      duplicates: [],
      photoReviewRequired: [],
      exceptionsFirst: [],
      caveat: "test",
      generatedAt: "2030-06-10T11:00:00.000Z",
    },
    workspace: "work",
  });
  assert.equal(report.vehiclesAttempted, 3);
  assert.equal(report.manualFallback, 1);
  // Photo with explicit correction + failed photo (invalid VIN infers correction)
  assert.ok(report.vinOcrCorrected >= 1);
  assert.equal(report.photoRetries, 1);
  assert.equal(report.failedObservations, 1);
  assert.equal(report.onlineNotSeen, 2);
  assert.equal(report.averageProcessingTimeMs, Math.round((100 + 300 + 50) / 3));
  assert.equal(report.realDealershipWalk, "OWNER_TEST_PENDING");
  assert.equal(report.valueLedgerPolluted, false);
  assert.match(report.reply, /INVENTORY WALK TEST RESULTS/);
  assert.match(report.reply, /OWNER_TEST_PENDING/);
});

test("INTEGRATED: recordWalkObservation writes telemetry; command surfaces report", async () => {
  const { service } = await fixture();
  await service.ensureLakelandToyotaContext({ setCurrent: true });
  const vin = synthesizeValidVin("WALK1");
  await service.refreshDealershipInventory({ useFixture: true, fixtureVins: [vin] });
  await service.startInventoryWalk("acceptance test");

  const r1 = await service.recordWalkObservation({
    vin,
    entryMethod: "manual",
    vinSource: "manual",
    processingDurationMs: 120,
  });
  assert.equal(r1.telemetry.saveSuccess, true);
  assert.equal(r1.telemetry.workspace, "work");
  assert.equal(r1.telemetry.vinSource, "manual");
  assert.ok(r1.telemetry.processingDurationMs === 120);

  const r2 = await service.recordWalkObservation({
    vin: synthesizeValidVin("WALK2"),
    entryMethod: "photo",
    vinSource: "windshield-photo",
    ocrResult: "OCRRAW",
    recognitionConfidence: 65,
    ownerCorrectionRequired: true,
    photoRetryCount: 2,
    processingDurationMs: 800,
  });
  assert.equal(r2.telemetry.ownerCorrectionRequired, true);
  assert.equal(r2.telemetry.photoRetryCount, 2);

  const report = await service.inventoryWalkTestResults();
  assert.ok(report);
  assert.equal(report!.realDealershipWalk, "OWNER_TEST_PENDING");
  assert.equal(report!.valueLedgerPolluted, false);
  assert.ok(report!.vehiclesAttempted >= 2);
  assert.match(report!.reply, /INVENTORY WALK TEST RESULTS/);

  // Value ledger not polluted by walk telemetry
  const snap = await service.snapshot();
  const ledgerHasWalk = (snap.executive?.valueLedger ?? []).some((e) =>
    /walk acceptance|walk telemetry/i.test(e.action + e.notes + e.capability),
  );
  assert.equal(ledgerHasWalk, false);

  const nl = await service.assistantPrompt("Inventory walk test results");
  assert.match(nl.reply, /INVENTORY WALK TEST RESULTS|OWNER_TEST_PENDING/i);
  assert.equal(nl.action, "inventory.walk.test_results");
});
