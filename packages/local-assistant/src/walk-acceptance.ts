/**
 * Inventory Walk physical acceptance telemetry.
 *
 * Lightweight lot-test metrics for the Owner's first real dealership walk.
 * Does NOT claim physical PASS. Does NOT write Value Ledger entries.
 * No facial/person analysis. No extra sensitive fields.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import type { InventoryWalkV1, PhysicalObservationV1, WalkReconciliationV1 } from "./vehicle-inventory.js";

export type VinEntrySourceV1 =
  | "manual"
  | "windshield-photo"
  | "door-jamb-photo"
  | "stock-sticker";

/** Per scan/observation acceptance row. */
export interface WalkObservationTelemetryV1 {
  id: OpaqueId | string;
  walkId: OpaqueId | string;
  /** Dealership/work workspace isolation — always "work" for Lakeland walks. */
  workspace: string;
  timestamp: IsoTimestamp;
  vinSource: VinEntrySourceV1;
  ocrResult: string | null;
  ocrConfidence: number | null;
  ownerCorrectionRequired: boolean;
  finalConfirmedVin: string | null;
  vinValidationCode: string;
  vinValidationValid: boolean;
  onlineInventoryMatch: boolean;
  stockMatch: boolean | null;
  photoRetryCount: number;
  processingDurationMs: number | null;
  saveSuccess: boolean;
  saveError: string | null;
  observationId: OpaqueId | string | null;
  matchStatus: string | null;
}

export interface WalkAcceptanceReportV1 {
  walkId: string;
  dealershipName: string;
  workspace: string;
  walkState: string;
  startedAt: string;
  endedAt: string | null;
  vehiclesAttempted: number;
  vehiclesSuccessfullyVerified: number;
  vinOcrFirstPassSuccess: number;
  vinOcrCorrected: number;
  manualFallback: number;
  photoRetries: number;
  averageProcessingTimeMs: number | null;
  onlineMatches: number;
  physicalOnly: number;
  onlineNotSeen: number;
  stockMismatches: number;
  failedObservations: number;
  entryCount: number;
  /**
   * Always OWNER_TEST_PENDING until Owner provides separate physical evidence.
   * Telemetry alone never flips this to PASS.
   */
  realDealershipWalk: "OWNER_TEST_PENDING";
  /** Explicit: not Value Ledger / not revenue metrics. */
  valueLedgerPolluted: false;
  reply: string;
}

export function mapEntryMethodToVinSource(
  entryMethod: "manual" | "photo" | "mixed" | undefined,
  vinSource?: VinEntrySourceV1 | string | null,
): VinEntrySourceV1 {
  const s = String(vinSource ?? "").trim().toLowerCase();
  if (s === "manual" || s === "windshield-photo" || s === "door-jamb-photo" || s === "stock-sticker") {
    return s;
  }
  if (entryMethod === "manual") return "manual";
  if (entryMethod === "photo" || entryMethod === "mixed") return "windshield-photo";
  return "manual";
}

export function buildWalkObservationTelemetry(
  input: {
    walkId: string;
    workspace?: string;
    timestamp: IsoTimestamp;
    vinSource?: VinEntrySourceV1 | string | null;
    entryMethod?: "manual" | "photo" | "mixed";
    ocrResult?: string | null;
    ocrConfidence?: number | null;
    ownerCorrectionRequired?: boolean;
    finalConfirmedVin?: string | null;
    vinValidationCode?: string;
    vinValidationValid?: boolean;
    onlineInventoryMatch?: boolean;
    stockMatch?: boolean | null;
    photoRetryCount?: number;
    processingDurationMs?: number | null;
    saveSuccess: boolean;
    saveError?: string | null;
    observationId?: string | null;
    matchStatus?: string | null;
  },
  ctx: { id: string },
): WalkObservationTelemetryV1 {
  const vinSource = mapEntryMethodToVinSource(input.entryMethod, input.vinSource);
  const conf =
    input.ocrConfidence === undefined || input.ocrConfidence === null
      ? null
      : Math.min(100, Math.max(0, Number(input.ocrConfidence)));
  const photoRetryCount = Math.max(0, Math.min(50, Number(input.photoRetryCount ?? 0) || 0));
  const duration =
    input.processingDurationMs === undefined || input.processingDurationMs === null
      ? null
      : Math.max(0, Math.round(Number(input.processingDurationMs)));

  // Infer correction need from OCR confidence / photo path when not explicit
  let ownerCorrectionRequired = input.ownerCorrectionRequired === true;
  if (input.ownerCorrectionRequired === undefined) {
    if (vinSource !== "manual" && conf !== null && conf < 85) ownerCorrectionRequired = true;
    if (input.vinValidationValid === false && vinSource !== "manual") ownerCorrectionRequired = true;
  }

  return {
    id: ctx.id,
    walkId: input.walkId,
    workspace: (input.workspace || "work").slice(0, 80),
    timestamp: input.timestamp,
    vinSource,
    ocrResult: input.ocrResult != null ? String(input.ocrResult).slice(0, 64) : null,
    ocrConfidence: conf,
    ownerCorrectionRequired,
    finalConfirmedVin: input.finalConfirmedVin
      ? String(input.finalConfirmedVin).trim().toUpperCase().slice(0, 32)
      : null,
    vinValidationCode: String(input.vinValidationCode ?? "UNKNOWN").slice(0, 40),
    vinValidationValid: input.vinValidationValid === true,
    onlineInventoryMatch: input.onlineInventoryMatch === true,
    stockMatch:
      input.stockMatch === undefined ? null : input.stockMatch === null ? null : input.stockMatch === true,
    photoRetryCount,
    processingDurationMs: duration,
    saveSuccess: input.saveSuccess === true,
    saveError: input.saveError ? String(input.saveError).slice(0, 500) : null,
    observationId: input.observationId ?? null,
    matchStatus: input.matchStatus ? String(input.matchStatus).slice(0, 80) : null,
  };
}

/**
 * Aggregate telemetry for one walk.
 * Uses reconciliation for online-not-seen when provided (from existing walk end logic).
 */
export function buildWalkAcceptanceReport(input: {
  walk: InventoryWalkV1;
  entries: readonly WalkObservationTelemetryV1[];
  reconciliation?: WalkReconciliationV1 | null;
  workspace?: string;
}): WalkAcceptanceReportV1 {
  const workspace = input.workspace || "work";
  const entries = input.entries.filter(
    (e) => e.walkId === input.walk.id && e.workspace === workspace,
  );

  const vehiclesAttempted = entries.length;
  const vehiclesSuccessfullyVerified = entries.filter(
    (e) =>
      e.saveSuccess &&
      e.vinValidationValid &&
      (e.matchStatus === "VERIFIED_ON_LOT" ||
        e.matchStatus === "SEEN_ON_LOT_NOT_ONLINE" ||
        e.onlineInventoryMatch ||
        e.finalConfirmedVin),
  ).length;

  const photoEntries = entries.filter((e) => e.vinSource !== "manual");
  const vinOcrFirstPassSuccess = photoEntries.filter(
    (e) =>
      e.saveSuccess &&
      e.vinValidationValid &&
      !e.ownerCorrectionRequired &&
      (e.ocrConfidence == null || e.ocrConfidence >= 85),
  ).length;
  const vinOcrCorrected = photoEntries.filter((e) => e.ownerCorrectionRequired).length;
  const manualFallback = entries.filter((e) => e.vinSource === "manual").length;
  const photoRetries = entries.reduce((s, e) => s + (e.photoRetryCount || 0), 0);

  const durations = entries
    .map((e) => e.processingDurationMs)
    .filter((d): d is number => d != null && Number.isFinite(d));
  const averageProcessingTimeMs = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null;

  const onlineMatches = entries.filter((e) => e.onlineInventoryMatch).length;
  const physicalOnly = entries.filter(
    (e) =>
      e.saveSuccess &&
      e.vinValidationValid &&
      !e.onlineInventoryMatch &&
      (e.matchStatus === "SEEN_ON_LOT_NOT_ONLINE" || e.matchStatus === "MANUAL_ENTRY"),
  ).length;

  const onlineNotSeen = input.reconciliation?.onlineButNotSeen?.length ?? 0;
  const stockMismatches =
    entries.filter((e) => e.stockMatch === false).length +
    (input.reconciliation?.stockMismatches?.length ?? 0);
  const failedObservations = entries.filter((e) => !e.saveSuccess || e.saveError).length;

  const reply = [
    "INVENTORY WALK TEST RESULTS",
    `(Acceptance telemetry — not Value Ledger · REAL_DEALERSHIP_WALK = OWNER_TEST_PENDING)`,
    "",
    `Walk: ${input.walk.id}`,
    `Dealership: ${input.walk.dealershipName}`,
    `Workspace: ${workspace}`,
    `State: ${input.walk.state}`,
    `Started: ${input.walk.startedAt}`,
    `Ended: ${input.walk.endedAt ?? "(active)"}`,
    "",
    "SUMMARY",
    `  Vehicles attempted: ${vehiclesAttempted}`,
    `  Vehicles successfully verified: ${vehiclesSuccessfullyVerified}`,
    `  VIN OCR first-pass success: ${vinOcrFirstPassSuccess}`,
    `  VIN OCR corrected (Owner): ${vinOcrCorrected}`,
    `  Manual fallback: ${manualFallback}`,
    `  Photo retries (total): ${photoRetries}`,
    `  Average processing time: ${averageProcessingTimeMs != null ? `${averageProcessingTimeMs} ms` : "n/a"}`,
    `  Online inventory matches: ${onlineMatches}`,
    `  Physical-only (seen, not online): ${physicalOnly}`,
    `  Online-not-seen (reconcile): ${onlineNotSeen}`,
    `  Stock mismatches: ${stockMismatches}`,
    `  Failed observations: ${failedObservations}`,
    "",
    "PER-OBSERVATION (latest first, max 15)",
    ...(entries.length
      ? entries
          .slice()
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
          .slice(0, 15)
          .map(
            (e, i) =>
              `  ${i + 1}. ${e.timestamp.slice(0, 19)} · ${e.vinSource} · VIN ${e.finalConfirmedVin || e.ocrResult || "?"} · valid=${e.vinValidationValid} · online=${e.onlineInventoryMatch} · retries=${e.photoRetryCount} · ${e.processingDurationMs ?? "?"}ms · save=${e.saveSuccess ? "ok" : "FAIL"}`,
          )
      : ["  (no telemetry entries yet)"]),
    "",
    "Caveat: Online match ≠ on lot. Telemetry never auto-claims physical PASS.",
  ].join("\n");

  return {
    walkId: input.walk.id,
    dealershipName: input.walk.dealershipName,
    workspace,
    walkState: input.walk.state,
    startedAt: input.walk.startedAt,
    endedAt: input.walk.endedAt,
    vehiclesAttempted,
    vehiclesSuccessfullyVerified,
    vinOcrFirstPassSuccess,
    vinOcrCorrected,
    manualFallback,
    photoRetries,
    averageProcessingTimeMs,
    onlineMatches,
    physicalOnly,
    onlineNotSeen,
    stockMismatches,
    failedObservations,
    entryCount: entries.length,
    realDealershipWalk: "OWNER_TEST_PENDING",
    valueLedgerPolluted: false,
    reply,
  };
}

/** Derive stock match from observation vs vehicle when both have stock numbers. */
export function deriveStockMatch(
  observationStock: string | null | undefined,
  vehicleStock: string | null | undefined,
  matchStatus: string | null | undefined,
): boolean | null {
  if (matchStatus && /STOCK_MISMATCH/i.test(matchStatus)) return false;
  const a = (observationStock || "").trim().toLowerCase();
  const b = (vehicleStock || "").trim().toLowerCase();
  if (!a || !b) return null;
  return a === b;
}

/** Infer online match from observation match status. */
export function deriveOnlineMatch(matchStatus: string | null | undefined): boolean {
  return matchStatus === "VERIFIED_ON_LOT";
}
