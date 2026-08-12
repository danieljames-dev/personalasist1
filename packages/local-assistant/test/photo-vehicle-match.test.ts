/**
 * Photo → inventory linking rules.
 *
 * These tests exist to pin the *refusals*. Matching a VIN that is present is the easy half; the half
 * that protects the Owner on a lot is refusing to link an ambiguous read, refusing to call a fixture
 * real stock, and refusing to call a valid-but-absent VIN wrong.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOwnerPhotoCorrection,
  buildPhotoProvenance,
  matchPhotoToVehicle,
} from "../src/photo-vehicle-match.js";
import { buildVinOcrResult } from "../src/vin-ocr.js";
import { validateVin } from "../src/vehicle-inventory.js";
import type { VehicleRecordV1 } from "../src/vehicle-inventory.js";

const LIVE_VIN = "4T1G11AK2PU131060";
// The synthetic-walk demo VIN prefix that isFixtureVehicle recognises, with a correct check digit.
const FIXTURE_VIN = "1HGCM82633A004352";

function vehicle(over: Partial<VehicleRecordV1> & { id: string }): VehicleRecordV1 {
  return {
    vin: null, dealershipId: null, dealershipName: "Toyota of Example",
    stockNumber: null, year: 2023, make: "Toyota", model: "Camry", trim: "LE",
    condition: "used", exteriorColor: null, interiorColor: null, mileage: null,
    presenceStatus: "ONLINE_LISTED", listingUrl: "https://example.com/x", detailUrl: null,
    lastOnlineAt: "2026-08-12T00:00:00.000Z", lastPhysicalAt: null,
    priceHistory: [], statusHistory: [], listingObservations: [],
    relationshipIds: [], opportunityIds: [],
    ...over,
  } as VehicleRecordV1;
}

const LIVE = vehicle({ id: "veh-live", vin: LIVE_VIN, stockNumber: "L1002", dealershipName: "Toyota of Example" });
const FIXTURE = vehicle({
  id: "veh-fixture",
  vin: FIXTURE_VIN,
  dealershipName: "Demo Dealership",
  // isFixtureVehicle keys on the observation's sourceType, not the dealership name.
  listingObservations: [{ sourceType: "fixture" }] as unknown as VehicleRecordV1["listingObservations"],
});

test("valid VIN with an exact live record links on VALIDATED_VIN", () => {
  const ocr = buildVinOcrResult({ extractedText: `VIN ${LIVE_VIN}`, provider: "ollama:moondream", extractionOk: true });
  const link = matchPhotoToVehicle({ ocr, vehicles: [LIVE] });
  assert.equal(link.state, "EXACT_LIVE_MATCH");
  assert.equal(link.vehicleRef, "veh-live");
  assert.equal(link.matchMethod, "VALIDATED_VIN");
  assert.equal(link.vin, LIVE_VIN);
  assert.ok(link.evidence.length > 0, "a link must carry its evidence");
});

test("a fixture record is never linked as real dealer stock", () => {
  const ocr = buildVinOcrResult({ extractedText: `VIN ${FIXTURE_VIN}`, provider: "fixture", extractionOk: true });
  const link = matchPhotoToVehicle({ ocr, vehicles: [FIXTURE] });
  assert.equal(link.state, "EXACT_FIXTURE_MATCH");
  assert.equal(link.vehicleRef, null, "a demo record must not become an inventory link");
  assert.equal(link.matchMethod, "NONE");
  assert.match(link.message, /FIXTURE|DEMO/i);
});

test("valid VIN absent from inventory is not called a wrong VIN", () => {
  const ocr = buildVinOcrResult({ extractedText: `VIN ${LIVE_VIN}`, provider: "fixture", extractionOk: true });
  const link = matchPhotoToVehicle({ ocr, vehicles: [] });
  assert.equal(link.state, "VALID_VIN_NOT_IN_CURRENT_INVENTORY");
  assert.equal(link.vehicleRef, null);
  assert.equal(link.vin, LIVE_VIN);
  // Must not assert the VIN is bad. Checked as an affirmative claim, since the correct message
  // legitimately contains the word "wrong" inside the negation "does not mean the VIN is wrong".
  assert.ok(
    !/(?<!does not mean the )\b(?:vin is (?:wrong|invalid|incorrect)|invalid vin|not a valid vin|does not exist)\b/i.test(link.message),
    `must not impugn the VIN: ${link.message}`,
  );
  assert.match(link.message, /does not mean the VIN is wrong/i, "must say so explicitly");
  assert.match(link.message, /sold|trade-in|offsite|newly arrived|coverage/i, "must offer the real hypotheses");
});

test("structurally invalid VIN produces no link", () => {
  const ocr = buildVinOcrResult({ extractedText: "VIN 4T1G11AK3PU131060", provider: "fixture", extractionOk: true });
  const link = matchPhotoToVehicle({ ocr, vehicles: [LIVE] });
  assert.ok(link.state === "INVALID_VIN" || link.state === "NO_VIN_FOUND", `got ${link.state}`);
  assert.equal(link.vehicleRef, null);
});

test("a repeated-character read is rejected, not validated by check-digit coincidence", () => {
  // 17 identical characters satisfy the weighted-sum check digit arithmetic, so these were reported
  // as VALID VINs. A camera on a dark or blown-out surface is exactly how OCR produces one.
  for (const fake of ["00000000000000000", "11111111111111111"]) {
    const v = validateVin(fake);
    assert.equal(v.valid, false, `${fake} must not validate`);
    assert.equal(v.code, "PLACEHOLDER_VIN");
    const link = matchPhotoToVehicle({
      ocr: buildVinOcrResult({ extractedText: `VIN ${fake}`, provider: "ollama:moondream", extractionOk: true }),
      vehicles: [LIVE],
    });
    assert.equal(link.vehicleRef, null, `${fake} must never link a vehicle`);
    assert.notEqual(link.state, "VALID_VIN_NOT_IN_CURRENT_INVENTORY", "a failed read is not a valid absent VIN");
  }
});

test("real VINs still validate after the placeholder guard", () => {
  assert.equal(validateVin(LIVE_VIN).valid, true);
  assert.equal(validateVin(FIXTURE_VIN).valid, true);
});

test("provider diagnostic text yields no VIN and therefore no link", () => {
  const ocr = buildVinOcrResult({
    extractedText: "Image stored; vision model returned empty text.",
    provider: "ollama:moondream",
    extractionOk: false,
  });
  const link = matchPhotoToVehicle({ ocr, vehicles: [LIVE] });
  assert.equal(link.state, "NO_VIN_FOUND");
  assert.equal(link.vehicleRef, null);
});

test("a generic exterior photo claims no VIN", () => {
  const ocr = buildVinOcrResult({
    extractedText: "A silver sedan parked in front of a building.",
    provider: "ollama:moondream",
    extractionOk: true,
  });
  const link = matchPhotoToVehicle({ ocr, vehicles: [LIVE] });
  assert.equal(link.vehicleRef, null, "colour and body style must never link a vehicle");
  assert.equal(link.matchMethod, "NONE");
});

test("Owner correction repoints the link and records provenance without erasing the original read", () => {
  const ocr = buildVinOcrResult({ extractedText: `VIN ${LIVE_VIN}`, provider: "ollama:moondream", extractionOk: true });
  const link = matchPhotoToVehicle({ ocr, vehicles: [LIVE] });
  const prov = buildPhotoProvenance({
    link, imageSourceRef: "image:abc123", observedAt: "2026-08-12T12:00:00.000Z",
    extractionProvider: "ollama:moondream", vinCandidate: LIVE_VIN,
  });
  assert.equal(prov.vehicleRef, "veh-live");
  assert.equal(prov.correctedAt, null);

  const corrected = applyOwnerPhotoCorrection(prov, {
    vehicleRef: null, note: "This photo belongs to a different vehicle.", at: "2026-08-12T12:05:00.000Z",
  });
  assert.equal(corrected.vehicleRef, null);
  assert.equal(corrected.matchMethod, "OWNER_ASSERTION");
  assert.equal(corrected.correctedAt, "2026-08-12T12:05:00.000Z");
  assert.equal(corrected.vinCandidate, LIVE_VIN, "the original OCR candidate must survive the correction");
  assert.equal(corrected.imageSourceRef, "image:abc123");
});

test("a correction to an invalid VIN is refused rather than stored", () => {
  const prov = buildPhotoProvenance({
    link: matchPhotoToVehicle({
      ocr: buildVinOcrResult({ extractedText: `VIN ${LIVE_VIN}`, provider: "fixture", extractionOk: true }),
      vehicles: [LIVE],
    }),
    imageSourceRef: "image:abc123", observedAt: "2026-08-12T12:00:00.000Z",
    extractionProvider: "fixture", vinCandidate: LIVE_VIN,
  });
  const bad = applyOwnerPhotoCorrection(prov, {
    correctedVin: "NOTAVIN", note: "The VIN is actually NOTAVIN", at: "2026-08-12T12:06:00.000Z",
  });
  assert.equal(bad.validatedVin, LIVE_VIN, "a bad correction must not overwrite a good VIN");
  assert.match(String(bad.correctionNote), /Rejected/i);
});
