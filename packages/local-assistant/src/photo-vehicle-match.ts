/**
 * Photo evidence → inventory identity.
 *
 * A VIN read off a photograph is the strongest automatic identity signal AION has, and it is still
 * only evidence. The states below exist because the interesting cases are the ones that are *not* a
 * clean hit: a VIN that validates but is not in inventory is not a wrong VIN, an ambiguous read is
 * not a match, and a fixture record is never real dealer stock. Collapsing those into "found / not
 * found" is what would let a salesperson quote a car that is not there.
 *
 * Auto-linking is deliberately narrow — exact validated VIN, or an unambiguous stock number. Colour,
 * body style, probable model and general resemblance never link anything, because a confident wrong
 * link is worse for the Owner than no link at all.
 */
import type { IsoTimestamp } from "./contracts.js";
import type { VehicleRecordV1 } from "./vehicle-inventory.js";
import type { VinOcrResultV1 } from "./vin-ocr.js";
import { normalizeVinCandidate, validateVin } from "./vehicle-inventory.js";
import { isFixtureVehicle } from "./vehicle-intelligence.js";

export type PhotoMatchStateV1 =
  | "EXACT_LIVE_MATCH"
  | "EXACT_FIXTURE_MATCH"
  | "VALID_VIN_NOT_IN_CURRENT_INVENTORY"
  | "AMBIGUOUS_UNCONFIRMED_VIN"
  | "INVALID_VIN"
  | "NO_VIN_FOUND";

export type PhotoMatchMethodV1 =
  | "VALIDATED_VIN"
  | "UNIQUE_STOCK_NUMBER"
  | "OWNER_ASSERTION"
  | "NONE";

export interface PhotoVehicleLinkV1 {
  state: PhotoMatchStateV1;
  /** Set only when the link is safe to make automatically. */
  vehicleRef: string | null;
  vin: string | null;
  stockNumber: string | null;
  matchMethod: PhotoMatchMethodV1;
  confidence: number;
  /** Alternatives the Owner should choose between; never auto-resolved. */
  candidates: Array<{ vehicleRef: string; vin: string | null; label: string }>;
  /** What the link rests on, in Owner-readable terms. */
  evidence: string[];
  /** Owner-facing sentence. Always inside what the evidence supports. */
  message: string;
}

export interface PhotoVehicleProvenanceV1 {
  imageSourceRef: string;
  vehicleRef: string | null;
  observedAt: IsoTimestamp;
  matchMethod: PhotoMatchMethodV1;
  vinCandidate: string | null;
  validatedVin: string | null;
  confidence: number;
  extractionProvider: string;
  state: PhotoMatchStateV1;
  /** Set when an Owner correction has superseded the automatic link. */
  correctedAt: IsoTimestamp | null;
  correctionNote: string | null;
}

function label(v: VehicleRecordV1): string {
  return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || v.vin || v.id;
}

/**
 * Resolve OCR output against inventory.
 *
 * Pure and side-effect free so the decision rules can be tested without a provider, a filesystem,
 * or a network call — the three things that made this logic hard to trust before.
 */
export function matchPhotoToVehicle(input: {
  ocr: VinOcrResultV1;
  vehicles: readonly VehicleRecordV1[];
}): PhotoVehicleLinkV1 {
  const { ocr, vehicles } = input;
  const none = (state: PhotoMatchStateV1, message: string, evidence: string[] = []): PhotoVehicleLinkV1 => ({
    state, vehicleRef: null, vin: null, stockNumber: null, matchMethod: "NONE",
    confidence: 0, candidates: [], evidence, message,
  });

  const best = ocr.best;
  if (!best || ocr.candidates.length === 0) {
    return none("NO_VIN_FOUND", "No VIN could be read from this image. Retake closer, straight on, with the plate filling the frame.", ocr.qualityFeedback);
  }

  // A read that never passed validation is not an identity claim.
  if (!best.valid) {
    return none(
      "INVALID_VIN",
      `Read "${best.vin}" but it is not a structurally valid VIN, so it is not used to identify a vehicle. Confirm or retake.`,
      [`OCR candidate: ${best.vin}`, ...ocr.qualityFeedback],
    );
  }

  // Several plausible valid readings means the photo did not settle the question.
  const validCandidates = ocr.candidates.filter((c) => c.valid);
  const distinctValid = [...new Set(validCandidates.map((c) => c.vin))];
  const settled = ocr.status === "VIN_OCR_HIGH_CONFIDENCE" && best.source === "direct";
  if (distinctValid.length > 1 && !settled) {
    const inInventory = distinctValid
      .map((vin) => vehicles.find((v) => normalizeVinCandidate(v.vin ?? "") === vin))
      .filter((v): v is VehicleRecordV1 => Boolean(v));
    return {
      state: "AMBIGUOUS_UNCONFIRMED_VIN",
      vehicleRef: null, vin: null, stockNumber: null, matchMethod: "NONE", confidence: best.confidence,
      candidates: inInventory.map((v) => ({ vehicleRef: v.id, vin: v.vin, label: label(v) })),
      evidence: [`Ambiguous characters produced ${distinctValid.length} valid readings: ${distinctValid.join(", ")}`],
      message: `More than one valid VIN reading is possible from this photo (${distinctValid.join(", ")}). Confirm which is correct — AION will not choose for you.`,
    };
  }

  const vin = normalizeVinCandidate(best.vin);
  const match = vehicles.find((v) => normalizeVinCandidate(v.vin ?? "") === vin);

  if (match) {
    const fixture = isFixtureVehicle(match);
    return {
      state: fixture ? "EXACT_FIXTURE_MATCH" : "EXACT_LIVE_MATCH",
      // A fixture is never linked as real stock, so no automatic vehicleRef.
      vehicleRef: fixture ? null : match.id,
      vin,
      stockNumber: match.stockNumber ?? null,
      matchMethod: fixture ? "NONE" : "VALIDATED_VIN",
      confidence: best.confidence,
      candidates: [],
      evidence: [
        `Validated VIN ${vin} (check digit OK)`,
        `Inventory record ${label(match)}`,
        match.listingUrl || match.detailUrl || "local inventory record",
      ],
      message: fixture
        ? `VIN ${vin} matches a FIXTURE/DEMO record, not real dealer stock. Not linked as inventory.`
        : `${label(match)} — VIN ${vin}${match.stockNumber ? `, stock ${match.stockNumber}` : ""}. Matched on validated VIN.`,
    };
  }

  // Stock number is the fallback identity, and only when it is unambiguous.
  const stock = ocr.sticker.stockNumber ? String(ocr.sticker.stockNumber).toUpperCase() : null;
  if (stock) {
    const stockMatches = vehicles.filter((v) => (v.stockNumber ?? "").toUpperCase() === stock);
    if (stockMatches.length === 1 && !isFixtureVehicle(stockMatches[0]!)) {
      const v = stockMatches[0]!;
      return {
        state: "EXACT_LIVE_MATCH",
        vehicleRef: v.id, vin: v.vin, stockNumber: v.stockNumber ?? null,
        matchMethod: "UNIQUE_STOCK_NUMBER", confidence: Math.min(best.confidence, 80),
        candidates: [],
        evidence: [`Unique stock number ${stock}`, `Inventory record ${label(v)}`],
        message: `${label(v)} — matched on unique stock number ${stock}. The photographed VIN ${vin} is not in current inventory, so confirm this is the same car.`,
      };
    }
    if (stockMatches.length > 1) {
      return {
        state: "AMBIGUOUS_UNCONFIRMED_VIN",
        vehicleRef: null, vin, stockNumber: stock, matchMethod: "NONE", confidence: best.confidence,
        candidates: stockMatches.map((v) => ({ vehicleRef: v.id, vin: v.vin, label: label(v) })),
        evidence: [`Stock number ${stock} matches ${stockMatches.length} records`],
        message: `Stock number ${stock} is not unique in inventory. Confirm which vehicle this is.`,
      };
    }
  }

  // Valid VIN, no record. This is emphatically not "wrong VIN".
  return {
    state: "VALID_VIN_NOT_IN_CURRENT_INVENTORY",
    vehicleRef: null, vin, stockNumber: stock, matchMethod: "NONE", confidence: best.confidence,
    candidates: [],
    evidence: [`Validated VIN ${vin} (check digit OK)`, "No exact match in current AION inventory"],
    message:
      `VIN ${vin} reads as valid, but there is no matching record in AION's current inventory. `
      + "That does not mean the VIN is wrong — AION covers only part of the public listings, and a car "
      + "can be sold, a trade-in, offsite, or newly arrived. Government VIN decode may still describe it.",
  };
}

/** Provenance for a photo-derived link. Vision output is evidence input, never authority. */
export function buildPhotoProvenance(input: {
  link: PhotoVehicleLinkV1;
  imageSourceRef: string;
  observedAt: IsoTimestamp;
  extractionProvider: string;
  vinCandidate: string | null;
}): PhotoVehicleProvenanceV1 {
  return {
    imageSourceRef: input.imageSourceRef,
    vehicleRef: input.link.vehicleRef,
    observedAt: input.observedAt,
    matchMethod: input.link.matchMethod,
    vinCandidate: input.vinCandidate,
    validatedVin: input.link.vin,
    confidence: input.link.confidence,
    extractionProvider: input.extractionProvider,
    state: input.link.state,
    correctedAt: null,
    correctionNote: null,
  };
}

/**
 * Apply an Owner correction without erasing what was originally observed.
 *
 * The Owner is authoritative over the machine here, but the original read stays on the record:
 * a correction history is how a recurring OCR failure becomes visible instead of being quietly
 * papered over each time.
 */
export function applyOwnerPhotoCorrection(
  provenance: PhotoVehicleProvenanceV1,
  input: { vehicleRef?: string | null; correctedVin?: string | null; note: string; at: IsoTimestamp },
): PhotoVehicleProvenanceV1 {
  const correctedVin = input.correctedVin ? normalizeVinCandidate(input.correctedVin) : null;
  if (correctedVin && !validateVin(correctedVin).valid) {
    // Refuse a correction that is itself not a valid VIN rather than storing a bad one.
    return { ...provenance, correctedAt: input.at, correctionNote: `Rejected correction "${input.correctedVin}": not a valid VIN. ${input.note}` };
  }
  return {
    ...provenance,
    vehicleRef: input.vehicleRef === undefined ? provenance.vehicleRef : input.vehicleRef,
    validatedVin: correctedVin ?? provenance.validatedVin,
    matchMethod: "OWNER_ASSERTION",
    confidence: 100,
    correctedAt: input.at,
    correctionNote: input.note.slice(0, 500),
  };
}

/**
 * Durable Chat photo → vehicle context for follow-ups without re-upload.
 *
 * Scoped to a workspace (and optionally a conversation). Never shared across workspaces.
 * Vision prose is not stored as fact — only structured match fields and provenance.
 */
export interface PhotoVehicleContextV1 {
  workspaceId: string;
  /** When set, follow-ups in a *different* conversation must not use this context. */
  conversationId: string | null;
  vehicleId: string | null;
  validatedVin: string | null;
  matchState: PhotoMatchStateV1;
  matchMethod: PhotoMatchMethodV1;
  confidence: number;
  documentRef: string | null;
  provenance: PhotoVehicleProvenanceV1;
  setAt: IsoTimestamp;
}

/** Build durable context after a photo match. vehicleId is only set for safe live links. */
export function buildPhotoVehicleContext(input: {
  workspaceId: string;
  conversationId?: string | null;
  documentRef?: string | null;
  link: PhotoVehicleLinkV1;
  provenance: PhotoVehicleProvenanceV1;
  setAt: IsoTimestamp;
}): PhotoVehicleContextV1 {
  return {
    workspaceId: input.workspaceId,
    conversationId: input.conversationId ?? null,
    vehicleId: input.link.vehicleRef,
    validatedVin: input.link.vin,
    matchState: input.link.state,
    matchMethod: input.link.matchMethod,
    confidence: input.link.confidence,
    documentRef: input.documentRef ?? null,
    provenance: input.provenance,
    setAt: input.setAt,
  };
}

/**
 * Whether a text turn may reuse the last photo vehicle.
 *
 * Pronouns are the common path ("does it have recalls?"). Attribute questions without a pronoun
 * ("what's the price?", "what trim?") also apply once a car was just identified — requiring the
 * Owner to re-upload for every attribute is a form, not a conversation.
 *
 * Workspace and conversation scopes are enforced by the caller before invoking this.
 */
export function isPhotoVehicleFollowUpQuestion(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t || t.length > 500) return false;
  if (/\b(it|this|that|the car|the vehicle|this one|this unit)\b/i.test(t)) return true;
  if (/\b(price|msrp|sticker|cost|how much)\b/i.test(t)) return true;
  if (/\b(trim|package|packages|options?|equipment)\b/i.test(t)) return true;
  if (/\brecalls?\b/i.test(t)) return true;
  if (/\b(mileage|miles|odometer|stock|colour|color|condition)\b/i.test(t)) return true;
  if (/\b(fit|match|show|suit|right for)\b/i.test(t) && /\b[A-Z][a-z]{1,20}\b/.test(t)) return true;
  if (/\bwhat (do we|do you) know\b/i.test(t)) return true;
  return false;
}

/**
 * Context is usable only in the same workspace, and only in the same conversation when one was
 * recorded. A null conversationId on either side means "workspace-scoped Chat path" (Claude's
 * current assistant.prompt attachment flow does not always open a conversation first).
 */
export function photoContextApplies(
  ctx: PhotoVehicleContextV1 | null | undefined,
  input: { workspaceId: string; conversationId?: string | null },
): boolean {
  if (!ctx?.vehicleId) return false;
  if (ctx.workspaceId !== input.workspaceId) return false;
  if (ctx.conversationId && input.conversationId && ctx.conversationId !== input.conversationId) return false;
  return true;
}
