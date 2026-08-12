/**
 * VIN / stock-sticker OCR post-processing.
 *
 * Does not invent VINs from pixels. Takes OCR/vision text (or synthetic fixtures)
 * and proposes structured candidates with confidence. Common OCR confusions
 * (O/0, I/1, …) are applied only when they produce a valid VIN (structure + check digit).
 */
import {
  extractVinCandidatesFromText,
  normalizeVinCandidate,
  validateVin,
  type VinValidationResultV1,
} from "./vehicle-inventory.js";

export type VinOcrStatusV1 =
  | "VIN_OCR_HIGH_CONFIDENCE"
  | "VIN_OCR_CONFIRM_REQUIRED"
  | "VIN_OCR_FAILED";

export interface VinOcrCandidateV1 {
  vin: string;
  validation: VinValidationResultV1;
  confidence: number;
  source: "direct" | "corrected" | "partial";
  corrections: string[];
  /** True only when check digit + structure pass. */
  valid: boolean;
}

export interface StickerFieldsV1 {
  stockNumber: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  price: number | null;
  mileage: number | null;
  rawSignals: string[];
}

export interface VinOcrResultV1 {
  status: VinOcrStatusV1;
  /** Best candidate when any; never silently force invalid. */
  best: VinOcrCandidateV1 | null;
  candidates: VinOcrCandidateV1[];
  sticker: StickerFieldsV1;
  extractedText: string;
  qualityFeedback: string[];
  provider: string;
  message: string;
}

/** Common OCR confusions — applied only as candidate generators, never silent mutation of Owner input. */
const CONFUSION_MAP: Record<string, string[]> = {
  O: ["0"],
  "0": ["O"],
  I: ["1"],
  "1": ["I"],
  B: ["8"],
  "8": ["B"],
  S: ["5"],
  "5": ["S"],
  G: ["6"],
  "6": ["G"],
  Z: ["2"],
  "2": ["Z"],
  Q: ["0"],
  D: ["0"],
};

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

/** Expand a raw 17-char string by single-position confusion swaps (bounded). */
export function generateVinConfusionCandidates(raw: string, maxCandidates = 48): string[] {
  const base = normalizeVinCandidate(raw);
  if (base.length !== 17) return base.length ? [base] : [];
  const out = new Set<string>([base]);
  // Single-position swaps
  for (let i = 0; i < 17 && out.size < maxCandidates; i++) {
    const ch = base[i]!;
    const alts = CONFUSION_MAP[ch];
    if (!alts) continue;
    for (const alt of alts) {
      const next = base.slice(0, i) + alt + base.slice(i + 1);
      out.add(next);
      if (out.size >= maxCandidates) break;
    }
  }
  // Illegal I/O/Q forced to likely digits/letters (still only as candidates)
  if (/[IOQ]/.test(base)) {
    const forced = base.replace(/O/g, "0").replace(/I/g, "1").replace(/Q/g, "0");
    out.add(forced);
  }
  return [...out];
}

export function scoreVinCandidate(
  vin: string,
  opts: { fromCorrection: boolean; rawHit: boolean },
): VinOcrCandidateV1 {
  const validation = validateVin(vin);
  let confidence = 0;
  if (validation.valid) {
    confidence = opts.fromCorrection ? 78 : opts.rawHit ? 92 : 85;
  } else if (validation.code === "CHECK_DIGIT_FAIL") {
    confidence = 35;
  } else if (validation.code === "INVALID_CHARACTERS") {
    confidence = 20;
  } else if (validation.normalized?.length === 17) {
    confidence = 25;
  } else {
    confidence = 10;
  }
  return {
    vin: validation.normalized || normalizeVinCandidate(vin),
    validation,
    confidence,
    source: opts.fromCorrection ? "corrected" : opts.rawHit ? "direct" : "partial",
    corrections: opts.fromCorrection ? ["ocr-confusion-map"] : [],
    valid: validation.valid,
  };
}

/**
 * Build ranked VIN candidates from free OCR/vision text.
 * Only promotes valid (check digit) candidates to high confidence.
 */
export function proposeVinsFromOcrText(text: string): VinOcrCandidateV1[] {
  const raw = String(text ?? "");
  const direct = extractVinCandidatesFromText(raw);
  // Also grab near-17 alphanumerics that may include illegal OCR chars
  const loose = raw.toUpperCase().match(/[A-Z0-9IOQ]{15,20}/g) ?? [];
  const seeds = uniqueStrings([
    ...direct,
    ...loose.map((s) => normalizeVinCandidate(s)).filter((s) => s.length >= 15 && s.length <= 20),
  ]);

  const scored: VinOcrCandidateV1[] = [];
  const seen = new Set<string>();

  for (const seed of seeds) {
    const variants =
      seed.length === 17
        ? generateVinConfusionCandidates(seed)
        : seed.length > 17
          ? [seed.slice(0, 17), ...generateVinConfusionCandidates(seed.slice(0, 17))]
          : [seed];

    for (const v of variants) {
      if (v.length !== 17 || seen.has(v)) continue;
      seen.add(v);
      const fromCorrection = v !== normalizeVinCandidate(seed) || /[IOQ]/.test(seed);
      const rawHit = direct.includes(v);
      const c = scoreVinCandidate(v, { fromCorrection, rawHit });
      // Prefer valid only in shortlist; keep top invalid for feedback
      if (c.valid || c.confidence >= 30) scored.push(c);
    }
  }

  scored.sort((a, b) => {
    if (a.valid !== b.valid) return a.valid ? -1 : 1;
    return b.confidence - a.confidence;
  });
  return scored.slice(0, 12);
}

export function extractStickerFields(text: string): StickerFieldsV1 {
  const t = String(text ?? "");
  const signals: string[] = [];
  const stock =
    t.match(/\b(?:stock|stk|stock\s*#|stock\s*no\.?)\s*[:#]?\s*([A-Z0-9\-]{3,20})\b/i)?.[1] ??
    t.match(/\bSTK\s*[:#]?\s*([A-Z0-9\-]{3,20})\b/i)?.[1] ??
    null;
  if (stock) signals.push(`stock:${stock}`);

  const yearRaw = t.match(/\b(20[12]\d)\b/)?.[1] ?? null;
  const year = yearRaw ? Number(yearRaw) : null;
  if (year) signals.push(`year:${year}`);

  const make =
    t.match(/\b(Toyota|Honda|Ford|Chevrolet|Chevy|Nissan|Hyundai|Kia|BMW|Mercedes|GMC|Ram|Jeep)\b/i)?.[1] ?? null;
  if (make) signals.push(`make:${make}`);

  const model =
    t.match(
      /\b(Camry|Tacoma|Highlander|RAV4|Corolla|Tundra|4Runner|Sienna|Prius|Sequoia|Crown|Venza|Grand Highlander)\b/i,
    )?.[1] ?? null;
  if (model) signals.push(`model:${model}`);

  const trim =
    t.match(/\b(XLE|XSE|SR5|TRD\s*(?:Sport|Off[- ]?Road|Pro)|Limited|LE|SE|Platinum|Nightshade|Hybrid)\b/i)?.[0] ??
    null;
  if (trim) signals.push(`trim:${trim}`);

  const priceRaw =
    t.match(/(?:price|msrp|internet|selling)\s*[:$]?\s*\$?\s*([\d,]{4,7})/i)?.[1] ??
    t.match(/\$\s*([\d,]{4,7})/)?.[1] ??
    null;
  const price = priceRaw ? Number(priceRaw.replace(/,/g, "")) : null;
  if (price) signals.push(`price:${price}`);

  const milesRaw =
    t.match(/(?:miles|mileage|odometer)\s*[:#]?\s*([\d,]{1,7})/i)?.[1] ?? null;
  const mileage = milesRaw ? Number(milesRaw.replace(/,/g, "")) : null;
  if (mileage != null) signals.push(`mileage:${mileage}`);

  return {
    stockNumber: stock ? stock.toUpperCase() : null,
    year,
    make: make ? make.replace(/^chevy$/i, "Chevrolet") : null,
    model,
    trim,
    price: Number.isFinite(price as number) ? price : null,
    mileage: Number.isFinite(mileage as number) ? mileage : null,
    rawSignals: signals,
  };
}

export function qualityFeedbackForOcr(input: {
  text: string;
  candidates: VinOcrCandidateV1[];
  status: VinOcrStatusV1;
  byteLength?: number;
}): string[] {
  const tips: string[] = [];
  const t = input.text || "";
  if (input.status === "VIN_OCR_HIGH_CONFIDENCE") {
    tips.push("VIN candidate looks valid — confirm or SAVE · NEXT.");
    return tips;
  }
  if (!t.trim()) {
    tips.push("No readable text found. Move closer to the VIN plate or stock sticker.");
    tips.push("Reduce windshield glare; shoot straight-on, not at an angle.");
    tips.push("Fill the frame with the VIN characters; avoid motion blur.");
    return tips;
  }
  if (t.length < 20) {
    tips.push("Only a little text was readable. Move closer and retake straight-on.");
  }
  const partial = t.toUpperCase().match(/[A-Z0-9IOQ]{10,16}/g);
  if (partial?.length && !input.candidates.some((c) => c.valid)) {
    tips.push("VIN appears partly obscured or cut off — reframe so all 17 characters are visible.");
  }
  if (/[IOQ]/.test(t.toUpperCase()) && input.candidates.some((c) => c.source === "corrected" && c.valid)) {
    tips.push("OCR may have confused O/0 or I/1 — review the proposed VIN carefully.");
  }
  if (input.candidates.some((c) => c.validation.code === "CHECK_DIGIT_FAIL")) {
    tips.push("A 17-character string failed the VIN check digit — retake or edit manually.");
  }
  if (input.byteLength !== undefined && input.byteLength < 40_000) {
    tips.push("Image is small/compressed — use the phone camera at full resolution if possible.");
  }
  if (!tips.length) {
    tips.push("VIN uncertain. Retake photo or type the VIN in the large field.");
  }
  return tips.slice(0, 6);
}

export function buildVinOcrResult(input: {
  extractedText: string;
  provider: string;
  byteLength?: number;
  /**
   * Whether the vision call actually produced text.
   *
   * When a provider fails, callers pass its *diagnostic* string as `extractedText`. Mining that
   * for VINs produced candidates from the error itself — "Image stored; vision model returned
   * empty text." yielded `RETURNEDEMPTYTEXT` at CONFIRM_REQUIRED, i.e. AION asking the Owner to
   * confirm a VIN assembled from its own failure message. An error string is not evidence about a
   * car, so a failed extraction yields no candidates and no sticker fields.
   */
  extractionOk?: boolean;
}): VinOcrResultV1 {
  const failed = input.extractionOk === false;
  const text = String(input.extractedText ?? "");
  const candidates = failed ? [] : proposeVinsFromOcrText(text);
  const sticker = failed ? extractStickerFields("") : extractStickerFields(text);
  const best = candidates.find((c) => c.valid) ?? candidates[0] ?? null;

  let status: VinOcrStatusV1 = "VIN_OCR_FAILED";
  if (best?.valid && best.confidence >= 85 && best.source === "direct") {
    status = "VIN_OCR_HIGH_CONFIDENCE";
  } else if (best?.valid && best.confidence >= 70) {
    status = best.confidence >= 85 ? "VIN_OCR_HIGH_CONFIDENCE" : "VIN_OCR_CONFIRM_REQUIRED";
  } else if (best?.valid) {
    status = "VIN_OCR_CONFIRM_REQUIRED";
  } else if (best) {
    status = "VIN_OCR_CONFIRM_REQUIRED";
  }

  // Corrected-only valid still requires confirm (never silent)
  if (best?.valid && best.source === "corrected") {
    status = "VIN_OCR_CONFIRM_REQUIRED";
  }

  const qualityFeedback = qualityFeedbackForOcr({
    text,
    candidates,
    status,
    ...(input.byteLength !== undefined ? { byteLength: input.byteLength } : {}),
  });

  const message =
    status === "VIN_OCR_HIGH_CONFIDENCE"
      ? `High-confidence VIN ${best!.vin}. Confirm if correct.`
      : status === "VIN_OCR_CONFIRM_REQUIRED"
        ? best?.valid
          ? `VIN candidate ${best.vin} — confirm or edit (confidence ${best.confidence}%).`
          : "VIN uncertain — confirm, edit, or retake photo."
        : "VIN OCR failed — retake photo or enter VIN manually.";

  return {
    status,
    best: best?.valid || best ? best : null,
    candidates,
    sticker,
    extractedText: text.slice(0, 20_000),
    qualityFeedback,
    provider: input.provider,
    message,
  };
}

/**
 * VIN-focused vision prompt for local multimodal models.
 * Instructs not to invent characters.
 */
/**
 * VIN/sticker read prompt.
 *
 * Kept deliberately short. The previous multi-clause instruction made a small local model
 * (moondream) return an *empty* response for every VIN image while the same model read the same
 * image fine when simply asked what text it saw. Small vision models follow one plain instruction;
 * they go silent on a list of rules.
 *
 * The anti-invention guarantee therefore does not live in this prompt — it lives downstream in
 * `proposeVinsFromOcrText` and `scoreVinCandidate`, where a candidate must pass structure and
 * check-digit validation and ambiguous reads are surfaced rather than silently corrected. That is
 * the right place for it: a prompt can be ignored, validation cannot.
 */
export const VIN_VISION_PROMPT = "What text do you see in this image? List every character exactly as printed.";
