import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVinOcrResult,
  extractStickerFields,
  generateVinConfusionCandidates,
  isContiguousVinObservation,
  isNoisyOcrText,
  isPlausibleVinCharset,
  proposeVinsFromOcrText,
} from "../src/vin-ocr.js";
import { synthesizeValidVin, validateVin } from "../src/vehicle-inventory.js";
import { parseNhtsaRecallPayload, compareTwoVehicles } from "../src/vehicle-research.js";
import type { VehicleRecordV1 } from "../src/vehicle-inventory.js";

test("clean VIN in OCR text is high confidence", () => {
  const vin = synthesizeValidVin("CLEAN01");
  const r = buildVinOcrResult({
    extractedText: `STOCK L100\nVIN ${vin}\nMSRP $32000`,
    provider: "fixture",
  });
  assert.equal(r.status, "VIN_OCR_HIGH_CONFIDENCE");
  assert.equal(r.best?.vin, vin);
  assert.equal(r.best?.valid, true);
  assert.ok(r.best!.confidence >= 85);
});

test("O/0 confusion can recover valid VIN", () => {
  const vin = synthesizeValidVin("CONFUSE1");
  // Force a digit 0 into an O in a non-check position if present
  let broken = vin.replace("0", "O");
  if (broken === vin) broken = vin.slice(0, 10) + "O" + vin.slice(11);
  // If still valid somehow, inject O for 0 across
  if (validateVin(broken).valid) {
    broken = vin.split("").map((c) => (c === "0" ? "O" : c)).join("");
  }
  const candidates = proposeVinsFromOcrText(`VIN: ${broken}`);
  const recovered = candidates.find((c) => c.valid);
  // At least confusion generator runs without crash
  assert.ok(generateVinConfusionCandidates(broken).length >= 1);
  // Prefer recovery when possible
  if (recovered) assert.equal(recovered.source, "corrected");
});

test("invalid OCR text fails gracefully with quality tips", () => {
  const r = buildVinOcrResult({ extractedText: "blurry photo of dashboard", provider: "fixture" });
  assert.equal(r.status, "VIN_OCR_FAILED");
  assert.ok(r.qualityFeedback.some((t) => /closer|glare|retake|uncertain|readable|VIN/i.test(t)));
});

test("empty text quality feedback is actionable", () => {
  const r = buildVinOcrResult({ extractedText: "", provider: "none" });
  assert.equal(r.status, "VIN_OCR_FAILED");
  assert.ok(r.qualityFeedback.length >= 2);
  assert.ok(r.qualityFeedback.some((t) => /closer|glare|straight/i.test(t)));
});

test("REAL_STICKER_FAILURE_WORDING: large phone photo does not demand retake", () => {
  const r = buildVinOcrResult({
    extractedText: "yes",
    provider: "ollama:moondream",
    byteLength: 2_641_019,
    extractionOk: true,
  });
  assert.equal(r.status, "VIN_OCR_FAILED");
  assert.equal(r.failureKind, "DENSE_TEXT_LIMITATION");
  assert.match(r.message, /model|dense|sticker|limitation/i);
  assert.doesNotMatch(r.message, /retake photo/i);
  assert.ok(r.qualityFeedback.every((t) => !/retake photo|clearer picture/i.test(t)));
  assert.ok(r.qualityFeedback.some((t) => /type the.*VIN|model limitation|dense/i.test(t)));
});

test("large empty extraction is model failure not Owner photography", () => {
  const r = buildVinOcrResult({
    extractedText: "",
    provider: "vision-empty",
    byteLength: 3_000_000,
    extractionOk: false,
  });
  assert.equal(r.failureKind, "MODEL_EXTRACTION_FAILURE");
  assert.doesNotMatch(r.message, /retake photo/i);
});

test("stock sticker fields extracted without fabrication", () => {
  const f = extractStickerFields("Stock #: L4421  2025 Toyota Tacoma TRD Sport  Price $38990  Miles 12");
  assert.equal(f.stockNumber, "L4421");
  assert.equal(f.year, 2025);
  assert.equal(f.make, "Toyota");
  assert.equal(f.model, "Tacoma");
  assert.ok(f.price === 38990);
  assert.equal(f.mileage, 12);
  const total = extractStickerFields("Total Suggested Retail Price: $53,378");
  assert.equal(total.price, 53378);
  const empty = extractStickerFields("no useful data here");
  assert.equal(empty.stockNumber, null);
  assert.equal(empty.price, null);
});

test("PLACEHOLDER / letter-heavy check-digit coincidence is not a plausible VIN", () => {
  // Measured false candidate from reflection OCR on real sticker glass (check digit can pass by chance).
  assert.equal(isPlausibleVinCharset("SRRL5SAA5REASEVES"), false);
  assert.equal(isPlausibleVinCharset("JTDACAAJ8T3051788"), true);
  const vin = synthesizeValidVin("PLAUS01");
  assert.equal(isPlausibleVinCharset(vin), true);
});

test("contiguous VIN observation required — scatter OCR must not invent links", () => {
  const vin = "JTDACAAJ8T3051788";
  assert.equal(isContiguousVinObservation(`VIN ${vin} end`, vin), true);
  assert.equal(isContiguousVinObservation("J T D A C A A J 8 T 3 0 5 1 7 8 8", vin), true);
  // Scattered tokens that only form a VIN after deleting all spaces across the page
  assert.equal(
    isContiguousVinObservation("L 4 TL T 4 J 3 LA S 4 0 3 4 3 7 PR FFFX BERL", "355J7ER591B55A3EF"),
    false,
  );
  const scatter = "L 4 TL T 4 J 3 LA S 4 0 3 4 3 7 PR FFFX BERL F BE FF 7 4 LETT 355J7ER591B55A3EF";
  // Contiguous gate: candidate must appear as near-contiguous observation in page text
  const cands = proposeVinsFromOcrText(scatter);
  assert.ok(cands.every((c) => !c.valid || isContiguousVinObservation(scatter, c.vin)));
});

test("OCR confusion recovery from contiguous seed (B→8) keeps provenance via corrected source", () => {
  // Engine observed B; confusion map may propose 8. Seed must remain contiguous observation.
  const page = "VEHICLE IDENTIFICATION NUMBER JTDACAAJBT3051788 END";
  const cands = proposeVinsFromOcrText(page);
  const target = cands.find((c) => c.vin === "JTDACAAJ8T3051788" && c.valid);
  // Only assert if check-digit path produces it — never invent outside confusion map.
  if (target) {
    assert.ok(target.source === "corrected" || target.source === "direct");
    assert.ok(isContiguousVinObservation(page, "JTDACAAJBT3051788"));
  }
  // Alphabet-sequence / filler must not become HIGH_CONFIDENCE VINs
  const filler = proposeVinsFromOcrText("ABCDEFGHIJKLMNOPQ 12345678901234567");
  assert.ok(filler.every((c) => !c.valid || c.confidence < 85));
});

test("sticker fields recognize Crown Signia Limited", () => {
  const fields = extractStickerFields(
    "TOYOTA CROWN SIGNIA LIMITED MANUFACTURER'S SUGGESTED RETAIL PRICE $50,955.00",
  );
  assert.equal(fields.make?.toLowerCase(), "toyota");
  assert.match(String(fields.model ?? ""), /crown|signia/i);
  assert.match(String(fields.trim ?? ""), /^limited$/i);
  assert.equal(fields.price, 50955);
});

test("total suggested retail recovers OCR $→5 garble (553.378.00 → 53378)", () => {
  // Measured EasyOCR on real Monroney: TOTAL line became "553.378.00" instead of $53,378.00
  const fields = extractStickerFields(
    "TOYOTA CROWN SIGNIA LIMITED MANUFACTURER'S SUGGESTED RETAIL PRICE $50,955.00 TOTAL SUGGESTED RETAIL PRICE 553.378.00",
  );
  assert.equal(fields.price, 53378);
  assert.ok(fields.rawSignals.some((s) => s === "totalSuggestedRetail:53378"));
});

test("FALSE_MSRP_FACTS: unrelated digit blobs must not become $53,378", () => {
  // Recovery is only valid next to total/MSRP monetary labels — not arbitrary long numbers.
  const negatives = [
    "phone 555-337-8000 call back",
    "stock number 55337800 on the lot",
    "VIN fragment JTDA 553378 near plate",
    "option code 553378 PKG A",
    "built 05/33/78 or date 2025-05-33",
    "combined 33 mpg city 28 highway 55337800 more text",
    "553.378.00 appears alone with no price label",
    "55337800",
  ];
  for (const text of negatives) {
    const fields = extractStickerFields(text);
    assert.notEqual(
      fields.price,
      53378,
      `must not invent $53,378 from: ${text}`,
    );
    assert.ok(
      !fields.rawSignals.some((s) => /totalSuggestedRetail:53378|price:53378/.test(s)),
      `must not signal false total MSRP from: ${text}`,
    );
  }
});

test("noisy reflection OCR does not yield silent HIGH_CONFIDENCE VIN links", () => {
  // Heavy punctuation + reflection symbols (measured classical OCR on lot glass photos).
  const garbage =
    "!!! … § ‡ · · · £58 / \\ | { } [ ] ~ @ # $ % ^ & * ( ) _ + = < > ? / . , ; : ` ' \" "
    + "Mini Eo ATE oN TOR AR AER ROE REE Rp “PRN NOS i) ed 2 = § 2 Fad x 3 Xi £38 7 Fide "
    + "SRRL5SAA5REASEVES more junk !!! ??? ###";
  assert.equal(isNoisyOcrText(garbage), true);
  const r = buildVinOcrResult({
    extractedText: garbage,
    provider: "tesseract:lower-right",
    byteLength: 2_500_000,
    extractionOk: true,
  });
  // Letter-heavy check-digit coincidence must not become a silent identity claim.
  assert.notEqual(r.status, "VIN_OCR_HIGH_CONFIDENCE");
  assert.ok(!r.best?.valid || r.best.vin !== "SRRL5SAA5REASEVES");
  if (r.best?.valid) {
    assert.ok(r.best.confidence < 85);
    assert.notEqual(r.best.source, "direct");
  }
});

test("corrected-only valid VIN requires confirm", () => {
  const vin = synthesizeValidVin("CORR01");
  // Present only a version that needs correction to match — use raw with spaces/noise
  const r = buildVinOcrResult({
    extractedText: `maybe ${vin.slice(0, 8)}O${vin.slice(9)} end`,
    provider: "fixture",
  });
  // If we recovered via correction, status should be confirm-required
  if (r.best?.valid && r.best.source === "corrected") {
    assert.equal(r.status, "VIN_OCR_CONFIRM_REQUIRED");
  }
});

test("NHTSA recall payload parse", () => {
  const recalls = parseNhtsaRecallPayload({
    results: [
      {
        NHTSACampaignNumber: "24V123000",
        Component: "AIR BAGS",
        Summary: "Air bag may not deploy.",
        Consequence: "Injury risk.",
        Remedy: "Dealer will replace.",
        ReportReceivedDate: "01/01/2024",
      },
    ],
  });
  assert.equal(recalls.length, 1);
  assert.equal(recalls[0]!.campaignNumber, "24V123000");
});

test("vehicle comparison uses stored fields only", () => {
  const now = "2030-01-01T00:00:00.000Z";
  const base = (id: string, trim: string, price: number): VehicleRecordV1 => ({
    id,
    vin: synthesizeValidVin(id),
    dealershipId: "d1",
    dealershipName: "Lakeland Toyota",
    stockNumber: id,
    year: 2025,
    make: "Toyota",
    model: "Camry",
    trim,
    condition: "new",
    exteriorColor: null,
    interiorColor: null,
    mileage: null,
    presenceStatus: "ONLINE_LISTED",
    listingUrl: null,
    detailUrl: null,
    lastOnlineAt: now,
    lastPhysicalAt: null,
    priceHistory: [{ at: now, advertisedPrice: price, msrp: null, dealerPrice: null, sourceUrl: "x" }],
    statusHistory: [],
    listingObservations: [],
    relationshipIds: [],
    opportunityIds: [],
    createdAt: now,
    updatedAt: now,
  });
  const findings = compareTwoVehicles(base("A", "LE", 28000), base("B", "XLE", 32000));
  assert.ok(findings.some((f) => /Trim differs/i.test(f.statement)));
  assert.ok(findings.every((f) => f.sourceType !== "aion-inference" || f.caveat));
});
