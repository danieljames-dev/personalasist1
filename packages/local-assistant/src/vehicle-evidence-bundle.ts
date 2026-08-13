/**
 * Several photos of one car, understood as one car.
 *
 * The Owner stood on the lot, took a full window sticker, a VIN close-up and a second sticker page,
 * and sent them together. AION treated each as a separate question, produced `STDAAABS1RS004150`
 * from the worst of them, correctly refused it as an invalid VIN — and then had nothing useful to
 * say. Every photo after the failure was wasted.
 *
 * That is the failure this module fixes, and the fix is a change of unit. The unit of understanding
 * is the **bundle**, not the image. One image is one attempt at reading something; the vehicle is
 * what the attempts agree on.
 *
 * Three rules follow from that.
 *
 * **A bad read is a failed read, not an identity.** `STDAAABS1RS004150` fails the VIN charset and
 * the check digit. It is evidence that OCR struggled with that photo — nothing more. It must never
 * be repaired, fuzzy-matched into inventory, or allowed to end the bundle.
 *
 * **Agreement across images beats confidence within one.** A VIN read identically from two photos is
 * far stronger than a VIN one photo was sure about, because the failure modes of glare, angle and
 * focus are not shared between shots.
 *
 * **Two valid, conflicting VINs mean two cars or one bad read — never a choice.** Picking the
 * higher-scoring one would be inventing a fact, so the bundle resolves to UNRESOLVED and says which
 * two it saw.
 *
 * Facts fuse the same way: the VIN may come from the close-up, the trim from the sticker, the base
 * MSRP from a page that had no VIN on it at all — and every fused field keeps the image it came from.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import { normalizeVinCandidate, validateVin } from "./vehicle-inventory.js";
import type { VehicleRecordV1 } from "./vehicle-inventory.js";

export const VEHICLE_EVIDENCE_BUNDLE_SCHEMA_V1 = "aion.vehicle-evidence-bundle.v1" as const;

/** What one photo turned out to be. Decided from content, never from upload order. */
export type EvidenceImageRoleV1 =
  | "WINDOW_STICKER"
  | "VIN_CLOSEUP"
  | "VEHICLE_EXTERIOR"
  | "STOCK_LABEL"
  | "UNKNOWN";

export interface EvidenceImageV1 {
  imageRef: string;
  role: EvidenceImageRoleV1;
  /** Raw OCR text for this image. Evidence, never an instruction. */
  ocrText: string;
  /** VIN strings this image proposed, before validation. */
  vinCandidates: string[];
  /** 0–100 legibility. Low quality explains a failure rather than excusing a guess. */
  quality: number;
}

export interface FusedFieldV1<T> {
  value: T;
  /** Which image established this. Every fused field keeps its own source. */
  imageRef: string;
  confidence: number;
}

/**
 * Sticker money, kept as separate facts.
 *
 * Base MSRP and total suggested retail differ by thousands on an optioned car, and neither is the
 * dealer's advertised price. Fusing them into one number is the mistake that puts a figure the store
 * never advertised into the Owner's mouth.
 */
export interface StickerMoneyV1 {
  baseMsrp: FusedFieldV1<number> | null;
  totalSuggestedRetail: FusedFieldV1<number> | null;
  deliveryCharge: FusedFieldV1<number> | null;
}

export type BundleResolutionV1 =
  | "RESOLVED"
  | "UNRESOLVED_NO_VALID_VIN"
  | "UNRESOLVED_CONFLICTING_VINS"
  | "UNRESOLVED_NOT_IN_INVENTORY";

export interface VehicleEvidenceBundleV1 {
  schema: typeof VEHICLE_EVIDENCE_BUNDLE_SCHEMA_V1;
  bundleId: OpaqueId;
  workspace: string;
  conversationId: string | null;
  messageId: string | null;
  images: EvidenceImageV1[];
  capturedAt: IsoTimestamp;
  /** Per-image VIN candidates that survived structural and check-digit validation. */
  validVinsByImage: Array<{ imageRef: string; vins: string[] }>;
  /** Set only on a single agreed, structurally valid VIN. */
  validatedVin: string | null;
  /** How many images independently produced the validated VIN. */
  vinAgreementCount: number;
  vehicleRef: OpaqueId | null;
  resolution: BundleResolutionV1;
  model: FusedFieldV1<string> | null;
  trim: FusedFieldV1<string> | null;
  exteriorColor: FusedFieldV1<string> | null;
  money: StickerMoneyV1;
  features: Array<FusedFieldV1<string>>;
  /** Contradictions between images, stated rather than resolved. */
  conflicts: string[];
  /** What no image established. These are what the Owner can photograph next. */
  unknowns: string[];
  confidence: number;
  sourceRefs: string[];
  message: string;
}

// ---------------------------------------------------------------------------
// VIN resolution across images
// ---------------------------------------------------------------------------

export interface VinConsensusV1 {
  validatedVin: string | null;
  agreementCount: number;
  /** Every distinct VIN that passed validation. More than one is a conflict. */
  distinctValidVins: string[];
  /** Candidates that failed, with the reason — this is what makes a failure useful. */
  rejected: Array<{ imageRef: string; candidate: string; reason: string }>;
  resolution: BundleResolutionV1;
}

/**
 * Decide the VIN from every image at once.
 *
 * Validation happens per candidate before anything is compared, so a malformed string can never
 * out-vote a real one by appearing twice. A bundle where image A fails and image B succeeds resolves
 * from B — the failure of A is recorded, not fatal.
 */
export function resolveVinAcrossImages(images: readonly EvidenceImageV1[]): VinConsensusV1 {
  const rejected: Array<{ imageRef: string; candidate: string; reason: string }> = [];
  const validByImage = new Map<string, Set<string>>();

  for (const image of images) {
    const accepted = new Set<string>();
    for (const raw of image.vinCandidates) {
      const normalised = normalizeVinCandidate(raw);
      if (!normalised) {
        rejected.push({ imageRef: image.imageRef, candidate: raw, reason: "not a 17-character VIN shape" });
        continue;
      }
      const verdict = validateVin(normalised);
      if (!verdict.valid) {
        // The Owner's real failure case. Recorded with its reason so the reply can say what was
        // wrong with the photo rather than just refusing.
        rejected.push({
          imageRef: image.imageRef,
          candidate: normalised,
          reason: verdict.message || verdict.code || "failed VIN validation",
        });
        continue;
      }
      accepted.add(normalised);
    }
    if (accepted.size) validByImage.set(image.imageRef, accepted);
  }

  const counts = new Map<string, number>();
  for (const vins of validByImage.values()) {
    for (const vin of vins) counts.set(vin, (counts.get(vin) ?? 0) + 1);
  }
  const distinct = [...counts.keys()].sort();

  if (!distinct.length) {
    return { validatedVin: null, agreementCount: 0, distinctValidVins: [], rejected, resolution: "UNRESOLVED_NO_VALID_VIN" };
  }
  if (distinct.length > 1) {
    // Two structurally valid VINs are two different cars, or one very good misread. Either way the
    // honest answer is that AION does not know which — picking the more popular one would be a guess
    // dressed as a count.
    return {
      validatedVin: null,
      agreementCount: 0,
      distinctValidVins: distinct,
      rejected,
      resolution: "UNRESOLVED_CONFLICTING_VINS",
    };
  }

  const vin = distinct[0]!;
  return {
    validatedVin: vin,
    agreementCount: counts.get(vin) ?? 1,
    distinctValidVins: distinct,
    rejected,
    resolution: "RESOLVED",
  };
}

// ---------------------------------------------------------------------------
// Fact fusion
// ---------------------------------------------------------------------------

export interface StickerReadingV1 {
  imageRef: string;
  model?: string | null;
  trim?: string | null;
  exteriorColor?: string | null;
  baseMsrp?: number | null;
  totalSuggestedRetail?: number | null;
  deliveryCharge?: number | null;
  features?: readonly string[];
}

/**
 * Fuse per-image readings into one set of facts.
 *
 * First reading wins per field, and later disagreement becomes a conflict rather than an overwrite.
 * Silently preferring the newest photo would mean a blurry retake could quietly replace a clean read.
 */
export function fuseStickerFacts(readings: readonly StickerReadingV1[]): {
  model: FusedFieldV1<string> | null;
  trim: FusedFieldV1<string> | null;
  exteriorColor: FusedFieldV1<string> | null;
  money: StickerMoneyV1;
  features: Array<FusedFieldV1<string>>;
  conflicts: string[];
} {
  const conflicts: string[] = [];

  const text = (field: "model" | "trim" | "exteriorColor"): FusedFieldV1<string> | null => {
    let chosen: FusedFieldV1<string> | null = null;
    for (const reading of readings) {
      const value = String(reading[field] ?? "").trim();
      if (!value) continue;
      if (!chosen) { chosen = { value, imageRef: reading.imageRef, confidence: 85 }; continue; }
      if (chosen.value.toLowerCase() !== value.toLowerCase()) {
        conflicts.push(`${field}: "${chosen.value}" (${chosen.imageRef}) vs "${value}" (${reading.imageRef})`);
      }
    }
    return chosen;
  };

  const money = (field: "baseMsrp" | "totalSuggestedRetail" | "deliveryCharge"): FusedFieldV1<number> | null => {
    let chosen: FusedFieldV1<number> | null = null;
    for (const reading of readings) {
      const value = reading[field];
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
      if (!chosen) { chosen = { value, imageRef: reading.imageRef, confidence: 85 }; continue; }
      if (chosen.value !== value) {
        conflicts.push(`${field}: ${chosen.value} (${chosen.imageRef}) vs ${value} (${reading.imageRef})`);
      }
    }
    return chosen;
  };

  const features: Array<FusedFieldV1<string>> = [];
  const seen = new Set<string>();
  for (const reading of readings) {
    for (const feature of reading.features ?? []) {
      const key = feature.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      features.push({ value: feature.trim(), imageRef: reading.imageRef, confidence: 80 });
    }
  }

  const baseMsrp = money("baseMsrp");
  const total = money("totalSuggestedRetail");
  // A sanity check, not a correction: a base above the total means one of them was misread, and the
  // Owner should be told rather than have AION quietly pick one.
  if (baseMsrp && total && baseMsrp.value > total.value) {
    conflicts.push(`base MSRP ${baseMsrp.value} is higher than the total ${total.value} — one of those was misread`);
  }

  return {
    model: text("model"),
    trim: text("trim"),
    exteriorColor: text("exteriorColor"),
    money: { baseMsrp, totalSuggestedRetail: total, deliveryCharge: money("deliveryCharge") },
    features,
    conflicts,
  };
}

// ---------------------------------------------------------------------------
// The bundle
// ---------------------------------------------------------------------------

export function buildVehicleEvidenceBundle(input: {
  bundleId: OpaqueId;
  workspace: string;
  conversationId?: string | null;
  messageId?: string | null;
  images: readonly EvidenceImageV1[];
  readings?: readonly StickerReadingV1[];
  /** Current inventory, for corroboration only. It never repairs an invalid VIN. */
  vehicles?: readonly VehicleRecordV1[];
  capturedAt: IsoTimestamp;
}): VehicleEvidenceBundleV1 {
  const consensus = resolveVinAcrossImages(input.images);
  const fused = fuseStickerFacts(input.readings ?? []);

  let vehicleRef: OpaqueId | null = null;
  let resolution = consensus.resolution;

  if (consensus.validatedVin) {
    // Exact match only. Inventory corroborates a VIN that already passed validation; it is never
    // allowed to reach back and make a failed read into a vehicle.
    const match = (input.vehicles ?? []).find(
      (v) => String(v.vin ?? "").toUpperCase() === consensus.validatedVin,
    );
    if (match) vehicleRef = match.id;
    else resolution = "UNRESOLVED_NOT_IN_INVENTORY";
  }

  const unknowns: string[] = [];
  if (!fused.model) unknowns.push("model");
  if (!fused.trim) unknowns.push("trim");
  if (!fused.money.baseMsrp) unknowns.push("base MSRP");
  if (!fused.money.totalSuggestedRetail) unknowns.push("sticker total");
  if (!consensus.validatedVin) unknowns.push("VIN");

  const sourceRefs = [
    ...input.images.map((i) => `image:${i.imageRef}`),
    ...(consensus.validatedVin ? [`vin:${consensus.validatedVin}`] : []),
    ...(vehicleRef ? [`vehicle:${vehicleRef}`] : []),
  ];

  const confidence = consensus.validatedVin
    ? Math.min(99, 60 + consensus.agreementCount * 15 + (vehicleRef ? 15 : 0))
    : 0;

  return {
    schema: VEHICLE_EVIDENCE_BUNDLE_SCHEMA_V1,
    bundleId: input.bundleId,
    workspace: input.workspace,
    conversationId: input.conversationId ?? null,
    messageId: input.messageId ?? null,
    images: [...input.images],
    capturedAt: input.capturedAt,
    validVinsByImage: [...groupValidVins(input.images)],
    validatedVin: consensus.validatedVin,
    vinAgreementCount: consensus.agreementCount,
    vehicleRef,
    resolution,
    model: fused.model,
    trim: fused.trim,
    exteriorColor: fused.exteriorColor,
    money: fused.money,
    features: fused.features,
    conflicts: fused.conflicts,
    unknowns,
    confidence,
    sourceRefs,
    message: describeBundleOutcome({ consensus, resolution, imageCount: input.images.length }),
  };
}

function groupValidVins(images: readonly EvidenceImageV1[]): Array<{ imageRef: string; vins: string[] }> {
  return images.map((image) => ({
    imageRef: image.imageRef,
    vins: image.vinCandidates
      .map((raw) => normalizeVinCandidate(raw))
      .filter((v): v is string => Boolean(v) && validateVin(v!).valid),
  }));
}

function describeBundleOutcome(input: {
  consensus: VinConsensusV1;
  resolution: BundleResolutionV1;
  imageCount: number;
}): string {
  const { consensus, resolution, imageCount } = input;
  if (resolution === "RESOLVED") {
    return consensus.agreementCount > 1
      ? `${imageCount} photos, and ${consensus.agreementCount} of them read the same VIN.`
      : `${imageCount} photos; one of them gave me a clean VIN.`;
  }
  if (resolution === "UNRESOLVED_CONFLICTING_VINS") {
    return `Two different valid VINs across these photos (${consensus.distinctValidVins.join(" and ")}). `
      + `That's either two cars or one bad read, and I'm not going to guess which.`;
  }
  if (resolution === "UNRESOLVED_NOT_IN_INVENTORY") {
    return `I read VIN ${consensus.validatedVin} cleanly, but it isn't in current inventory.`;
  }
  const worst = consensus.rejected[0];
  return worst
    ? `I couldn't get a valid VIN out of ${imageCount} photo${imageCount === 1 ? "" : "s"}. `
      + `The closest was "${worst.candidate}" — ${worst.reason}.`
    : `I couldn't find a VIN in ${imageCount} photo${imageCount === 1 ? "" : "s"}.`;
}

/**
 * What to photograph next.
 *
 * The Owner is standing next to the car. A refusal that does not say what would fix it wastes the
 * one moment when fixing it is easy.
 */
export function nextPhotoAdvice(bundle: VehicleEvidenceBundleV1): string | null {
  if (bundle.resolution === "RESOLVED" && !bundle.unknowns.length) return null;
  if (bundle.resolution === "UNRESOLVED_NO_VALID_VIN") {
    return "Get me the VIN plate through the windscreen, or the barcode block on the sticker — straight on, close, no glare.";
  }
  if (bundle.resolution === "UNRESOLVED_CONFLICTING_VINS") {
    return "One more clear shot of the VIN and I'll know which of the two is right.";
  }
  if (bundle.resolution === "UNRESOLVED_NOT_IN_INVENTORY") {
    return "That VIN isn't in the feed I have. Worth a photo of the stock label so I can look it up another way.";
  }
  if (bundle.unknowns.length) {
    return `I've got the car. Still missing ${bundle.unknowns.join(", ")} — the pricing block on the sticker would fill that in.`;
  }
  return null;
}
