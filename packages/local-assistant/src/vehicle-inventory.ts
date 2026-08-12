/**
 * Dealership / vehicle inventory domain (lot walk + public listings).
 *
 * VIN is the strongest identity when known. Online listing ≠ physically on lot.
 * Physical Owner walk observations are stronger on-lot evidence than a web listing.
 * Never invent missing listing fields. Never overwrite price/status history.
 */
import type { IsoTimestamp, OpaqueId, ProvenanceV1 } from "./contracts.js";

// ─── VIN ────────────────────────────────────────────────────────────────────

const VIN_ILLEGAL = /[IOQ]/gi;
const VIN_TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export type VinValidationCodeV1 =
  | "VALID"
  | "INVALID_LENGTH"
  | "INVALID_CHARACTERS"
  | "CHECK_DIGIT_FAIL"
  | "EMPTY";

export interface VinValidationResultV1 {
  raw: string;
  normalized: string | null;
  valid: boolean;
  code: VinValidationCodeV1;
  checkDigitOk: boolean | null;
  message: string;
}

export function normalizeVinCandidate(raw: string): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[\s\-._]/g, "")
    .trim();
}

export function validateVin(raw: string): VinValidationResultV1 {
  const original = String(raw ?? "");
  const normalized = normalizeVinCandidate(original);
  if (!normalized) {
    return {
      raw: original,
      normalized: null,
      valid: false,
      code: "EMPTY",
      checkDigitOk: null,
      message: "No VIN provided.",
    };
  }
  if (normalized.length !== 17) {
    return {
      raw: original,
      normalized,
      valid: false,
      code: "INVALID_LENGTH",
      checkDigitOk: null,
      message: `Modern VIN must be 17 characters (got ${normalized.length}).`,
    };
  }
  if (VIN_ILLEGAL.test(normalized) || !/^[A-HJ-NPR-Z0-9]{17}$/u.test(normalized)) {
    return {
      raw: original,
      normalized,
      valid: false,
      code: "INVALID_CHARACTERS",
      checkDigitOk: null,
      message: "VIN contains illegal characters (I, O, Q are never used).",
    };
  }
  const checkOk = vinCheckDigitValid(normalized);
  if (!checkOk) {
    return {
      raw: original,
      normalized,
      valid: false,
      code: "CHECK_DIGIT_FAIL",
      checkDigitOk: false,
      message: "VIN check digit does not match (position 9).",
    };
  }
  return {
    raw: original,
    normalized,
    valid: true,
    code: "VALID",
    checkDigitOk: true,
    message: "VIN is well-formed and check digit matches.",
  };
}

export function vinCheckDigitValid(vin: string): boolean {
  if (vin.length !== 17) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = vin[i]!;
    const value = VIN_TRANSLITERATION[ch];
    if (value === undefined) return false;
    sum += value * VIN_WEIGHTS[i]!;
  }
  const remainder = sum % 11;
  const expected = remainder === 10 ? "X" : String(remainder);
  return vin[8] === expected;
}

/** Extract likely VIN candidates from free text / OCR (17-char patterns). */
export function extractVinCandidatesFromText(text: string): string[] {
  const upper = String(text ?? "").toUpperCase();
  const hits = upper.match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) ?? [];
  const spaced = upper.match(/\b(?:[A-HJ-NPR-Z0-9][\s\-]?){16}[A-HJ-NPR-Z0-9]\b/g) ?? [];
  const fromSpaced = spaced.map((s) => normalizeVinCandidate(s));
  const all = [...hits, ...fromSpaced].map((v) => normalizeVinCandidate(v));
  const unique = [...new Set(all)].filter((v) => v.length === 17);
  return unique.filter((v) => validateVin(v).valid || validateVin(v).code === "CHECK_DIGIT_FAIL");
}

// ─── VIN decode (NHTSA vPIC) ────────────────────────────────────────────────

export interface VinDecodeResultV1 {
  vin: string;
  year: string | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  bodyClass: string | null;
  driveType: string | null;
  fuelType: string | null;
  plantCountry: string | null;
  errorCode: string | null;
  errorText: string | null;
  raw: Record<string, string>;
  provenance: ProvenanceV1;
  source: "nhtsa-vpic" | "fixture" | "none";
}

export function emptyVinDecode(vin: string, now: IsoTimestamp): VinDecodeResultV1 {
  return {
    vin,
    year: null,
    make: null,
    model: null,
    trim: null,
    bodyClass: null,
    driveType: null,
    fuelType: null,
    plantCountry: null,
    errorCode: null,
    errorText: "Not decoded.",
    raw: {},
    provenance: { sourceType: "system", sourceRef: "vin.decode.none", recordedAt: now },
    source: "none",
  };
}

export function parseNhtsaDecodePayload(
  vin: string,
  payload: unknown,
  now: IsoTimestamp,
): VinDecodeResultV1 {
  const results = (payload as { Results?: Array<Record<string, unknown>> })?.Results;
  const row = Array.isArray(results) && results[0] ? results[0] : {};
  const str = (k: string): string | null => {
    const v = row[k];
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s && s !== "Not Applicable" && s !== "null" ? s : null;
  };
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v !== undefined && v !== null && String(v).trim()) raw[k] = String(v).slice(0, 500);
  }
  return {
    vin,
    year: str("ModelYear"),
    make: str("Make"),
    model: str("Model"),
    trim: str("Trim") || str("Series"),
    bodyClass: str("BodyClass"),
    driveType: str("DriveType"),
    fuelType: str("FuelTypePrimary"),
    plantCountry: str("PlantCountry"),
    errorCode: str("ErrorCode"),
    errorText: str("ErrorText"),
    raw,
    provenance: {
      sourceType: "system",
      sourceRef: "https://vpic.nhtsa.dot.gov/api/",
      recordedAt: now,
    },
    source: "nhtsa-vpic",
  };
}

export async function decodeVinNhtsa(
  vin: string,
  now: IsoTimestamp,
  fetchImpl: typeof fetch = fetch,
): Promise<VinDecodeResultV1> {
  const v = validateVin(vin);
  if (!v.valid || !v.normalized) {
    const empty = emptyVinDecode(vin, now);
    empty.errorText = v.message;
    return empty;
  }
  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(v.normalized)}?format=json`;
  const res = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const empty = emptyVinDecode(v.normalized, now);
    empty.errorText = `NHTSA HTTP ${res.status}`;
    return empty;
  }
  const json = await res.json();
  return parseNhtsaDecodePayload(v.normalized, json, now);
}

// ─── Dealership context ─────────────────────────────────────────────────────

export interface DealershipContextV1 {
  id: OpaqueId;
  /** Owner-supplied label, e.g. "Lakeland Toyota". */
  name: string;
  slug: string;
  city: string;
  state: string;
  /** Public website root when known. */
  publicWebsite: string;
  inventoryNewUrl: string;
  inventoryUsedUrl: string;
  /** Owner said they work here. */
  ownerWorksHere: boolean;
  /** Active current dealership for inventory walk. */
  isCurrent: boolean;
  notes: string;
  provenance: ProvenanceV1;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export function slugifyDealership(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "dealership";
}

export const LAKELAND_TOYOTA_DEFAULT: Omit<
  DealershipContextV1,
  "id" | "provenance" | "createdAt" | "updatedAt" | "ownerWorksHere" | "isCurrent" | "notes"
> = {
  name: "Lakeland Toyota",
  slug: "lakeland-toyota",
  city: "Lakeland",
  state: "FL",
  publicWebsite: "https://www.lakelandtoyota.com/",
  inventoryNewUrl: "https://www.lakelandtoyota.com/searchnew.aspx",
  inventoryUsedUrl: "https://www.lakelandtoyota.com/searchused.aspx",
};

export function buildDealershipContext(
  input: Record<string, unknown>,
  context: { id: OpaqueId; now: IsoTimestamp },
): DealershipContextV1 {
  const name = String(input.name ?? "").trim().slice(0, 200);
  if (!name) throw new Error("Dealership name is required.");
  const slug = String(input.slug ?? slugifyDealership(name)).slice(0, 80);
  return {
    id: context.id,
    name,
    slug,
    city: String(input.city ?? "").trim().slice(0, 100),
    state: String(input.state ?? "").trim().slice(0, 40),
    publicWebsite: String(input.publicWebsite ?? "").trim().slice(0, 500),
    inventoryNewUrl: String(input.inventoryNewUrl ?? "").trim().slice(0, 500),
    inventoryUsedUrl: String(input.inventoryUsedUrl ?? "").trim().slice(0, 500),
    ownerWorksHere: input.ownerWorksHere === true,
    isCurrent: input.isCurrent === true,
    notes: String(input.notes ?? "").trim().slice(0, 2000),
    provenance: {
      sourceType: "owner",
      sourceRef: String(input.sourceRef ?? "owner.dealership").slice(0, 500),
      recordedAt: context.now,
    },
    createdAt: context.now,
    updatedAt: context.now,
  };
}

// ─── Listings & vehicles ────────────────────────────────────────────────────

export type VehiclePresenceStatusV1 =
  | "ONLINE_LISTED"
  | "PHYSICALLY_VERIFIED"
  | "NOT_VERIFIED"
  | "NO_LONGER_FOUND_ONLINE";

export type ObservationMatchStatusV1 =
  | "VERIFIED_ON_LOT"
  | "ONLINE_LISTED_NOT_SEEN"
  | "SEEN_ON_LOT_NOT_ONLINE"
  | "VIN_MISMATCH"
  | "STOCK_NUMBER_MISMATCH"
  | "DUPLICATE_OBSERVATION"
  | "PHOTO_REVIEW_REQUIRED"
  | "MANUAL_ENTRY"
  | "PENDING";

export interface InventoryListingObservationV1 {
  id: OpaqueId;
  retrievedAt: IsoTimestamp;
  sourceUrl: string;
  sourceType: "public-dealer-site" | "fixture" | "owner-import";
  vin: string | null;
  stockNumber: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  condition: "new" | "used" | "cpo" | "unknown" | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  mileage: number | null;
  advertisedPrice: number | null;
  msrp: number | null;
  dealerPrice: number | null;
  listingUrl: string | null;
  detailUrl: string | null;
  availability: string | null;
  raw: Record<string, string>;
}

export interface VehiclePriceHistoryEntryV1 {
  at: IsoTimestamp;
  advertisedPrice: number | null;
  msrp: number | null;
  dealerPrice: number | null;
  sourceUrl: string;
}

export interface VehicleStatusHistoryEntryV1 {
  at: IsoTimestamp;
  status: VehiclePresenceStatusV1;
  note: string;
}

export interface VehicleRecordV1 {
  id: OpaqueId;
  vin: string | null;
  dealershipId: OpaqueId | null;
  dealershipName: string;
  stockNumber: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  condition: "new" | "used" | "cpo" | "unknown" | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  mileage: number | null;
  presenceStatus: VehiclePresenceStatusV1;
  listingUrl: string | null;
  detailUrl: string | null;
  lastOnlineAt: IsoTimestamp | null;
  lastPhysicalAt: IsoTimestamp | null;
  priceHistory: VehiclePriceHistoryEntryV1[];
  statusHistory: VehicleStatusHistoryEntryV1[];
  listingObservations: InventoryListingObservationV1[];
  /** CRM links (Owner-asserted only). */
  relationshipIds: OpaqueId[];
  opportunityIds: OpaqueId[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface PhysicalObservationV1 {
  id: OpaqueId;
  walkId: OpaqueId;
  dealershipId: OpaqueId | null;
  dealershipName: string;
  vin: string | null;
  stockNumber: string | null;
  note: string;
  photoDocumentIds: OpaqueId[];
  recognitionConfidence: number | null;
  matchStatus: ObservationMatchStatusV1;
  vehicleId: OpaqueId | null;
  source: "PHYSICAL_OWNER_WALK";
  entryMethod: "manual" | "photo" | "mixed";
  observedAt: IsoTimestamp;
  provenance: ProvenanceV1;
}

export type InventoryWalkStateV1 = "active" | "complete" | "cancelled";

export interface InventoryWalkV1 {
  id: OpaqueId;
  dealershipId: OpaqueId | null;
  dealershipName: string;
  state: InventoryWalkStateV1;
  /** Owner declared the walk covers the relevant lot area. */
  coverageDeclaredComplete: boolean;
  startedAt: IsoTimestamp;
  endedAt: IsoTimestamp | null;
  observationIds: OpaqueId[];
  notes: string;
  provenance: ProvenanceV1;
}

export interface WalkReconciliationV1 {
  walkId: OpaqueId;
  dealershipName: string;
  onlineInventoryCount: number;
  physicallyObservedCount: number;
  matchedCount: number;
  onlineButNotSeen: Array<{ vin: string | null; stockNumber: string | null; year: number | null; make: string | null; model: string | null }>;
  seenButNotOnline: Array<{ vin: string | null; stockNumber: string | null; observationId: OpaqueId }>;
  vinMismatches: Array<{ observationId: OpaqueId; detail: string }>;
  stockMismatches: Array<{ observationId: OpaqueId; detail: string }>;
  duplicates: Array<{ vin: string; observationIds: OpaqueId[] }>;
  photoReviewRequired: Array<{ observationId: OpaqueId; vin: string | null }>;
  exceptionsFirst: string[];
  caveat: string;
  generatedAt: IsoTimestamp;
}

export interface VehicleInventoryStateV1 {
  dealerships: DealershipContextV1[];
  vehicles: VehicleRecordV1[];
  walks: InventoryWalkV1[];
  observations: PhysicalObservationV1[];
  /** Last public inventory refresh per dealership slug. */
  lastInventoryRefresh: Record<string, IsoTimestamp>;
  /** Cached public listings (newest refresh wins; history lives on vehicles). */
  onlineListings: InventoryListingObservationV1[];
  /**
   * Physical walk Acceptance metrics (lot test). Workspace-scoped entries.
   * Not Value Ledger. Never auto-claims REAL_DEALERSHIP_WALK PASS.
   */
  walkAcceptanceMetrics: import("./walk-acceptance.js").WalkObservationMetricsV1[];
}

export function emptyVehicleInventoryState(): VehicleInventoryStateV1 {
  return {
    dealerships: [],
    vehicles: [],
    walks: [],
    observations: [],
    lastInventoryRefresh: {},
    onlineListings: [],
    walkAcceptanceMetrics: [],
  };
}

function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Prices of 0 from dealer markup are not real asks — treat as unknown. */
function priceOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  if (n == null || n <= 0) return null;
  return n;
}

function strOrNull(v: unknown, max = 200): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().slice(0, max);
  return s || null;
}

export function listingFromPartial(
  input: Record<string, unknown>,
  context: { id: OpaqueId; now: IsoTimestamp; sourceUrl: string; sourceType: InventoryListingObservationV1["sourceType"] },
): InventoryListingObservationV1 {
  const vinRaw = strOrNull(input.vin, 32);
  const vinNorm = vinRaw ? normalizeVinCandidate(vinRaw) : null;
  const vin = vinNorm && vinNorm.length === 17 ? vinNorm : vinRaw;
  return {
    id: context.id,
    retrievedAt: context.now,
    sourceUrl: context.sourceUrl.slice(0, 1000),
    sourceType: context.sourceType,
    vin,
    stockNumber: strOrNull(input.stockNumber ?? input.stock, 64),
    year: numOrNull(input.year),
    make: strOrNull(input.make, 80),
    model: strOrNull(input.model, 80),
    trim: strOrNull(input.trim, 120),
    condition: (["new", "used", "cpo", "unknown"].includes(String(input.condition ?? ""))
      ? (String(input.condition) as InventoryListingObservationV1["condition"])
      : "unknown"),
    exteriorColor: strOrNull(input.exteriorColor, 80),
    interiorColor: strOrNull(input.interiorColor, 80),
    mileage: numOrNull(input.mileage),
    advertisedPrice: priceOrNull(input.advertisedPrice ?? input.price),
    msrp: priceOrNull(input.msrp),
    dealerPrice: priceOrNull(input.dealerPrice),
    listingUrl: strOrNull(input.listingUrl, 1000),
    detailUrl: strOrNull(input.detailUrl ?? input.listingUrl, 1000),
    availability: strOrNull(input.availability ?? input.status, 120),
    raw: Object.fromEntries(
      Object.entries(input)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, String(v).slice(0, 500)])
        .slice(0, 40),
    ),
  };
}

/** Upsert vehicles from a batch of online listings; preserves price/status history. */
export function applyOnlineListings(
  state: VehicleInventoryStateV1,
  dealership: DealershipContextV1,
  listings: InventoryListingObservationV1[],
  now: IsoTimestamp,
  nextId: (kind: string) => string,
): VehicleInventoryStateV1 {
  const vehicles = [...state.vehicles];
  const seenVin = new Set<string>();
  const seenStock = new Set<string>();

  for (const listing of listings) {
    if (listing.vin) seenVin.add(listing.vin);
    if (listing.stockNumber) seenStock.add(listing.stockNumber.toUpperCase());

    let idx = -1;
    if (listing.vin) {
      idx = vehicles.findIndex(
        (v) => v.vin === listing.vin && (v.dealershipId === dealership.id || v.dealershipName === dealership.name),
      );
    }
    if (idx < 0 && listing.stockNumber) {
      idx = vehicles.findIndex(
        (v) =>
          v.stockNumber &&
          listing.stockNumber &&
          v.stockNumber.toUpperCase() === listing.stockNumber.toUpperCase() &&
          (v.dealershipId === dealership.id || v.dealershipName === dealership.name),
      );
    }

    if (idx < 0) {
      vehicles.unshift({
        id: nextId("vehicle"),
        vin: listing.vin,
        dealershipId: dealership.id,
        dealershipName: dealership.name,
        stockNumber: listing.stockNumber,
        year: listing.year,
        make: listing.make,
        model: listing.model,
        trim: listing.trim,
        condition: listing.condition,
        exteriorColor: listing.exteriorColor,
        interiorColor: listing.interiorColor,
        mileage: listing.mileage,
        presenceStatus: "ONLINE_LISTED",
        listingUrl: listing.listingUrl,
        detailUrl: listing.detailUrl,
        lastOnlineAt: now,
        lastPhysicalAt: null,
        // Only record a first observation when the listing actually published a price.
        priceHistory:
          (listing.advertisedPrice != null && listing.advertisedPrice > 0) ||
          (listing.msrp != null && listing.msrp > 0) ||
          (listing.dealerPrice != null && listing.dealerPrice > 0)
            ? [{
                at: now,
                advertisedPrice: listing.advertisedPrice,
                msrp: listing.msrp,
                dealerPrice: listing.dealerPrice,
                sourceUrl: listing.sourceUrl,
              }]
            : [],
        statusHistory: [{ at: now, status: "ONLINE_LISTED", note: "First observed online." }],
        listingObservations: [listing],
        relationshipIds: [],
        opportunityIds: [],
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }

    const prev = vehicles[idx]!;
    // Price history records observed prices, not the act of looking. A listing page that publishes
    // no price used to append an all-null entry on every refresh, which grew state without adding
    // evidence and masked the real price behind a null newest entry. Only a grounded price is
    // written, and only when it differs from the most recent grounded price we already hold.
    const observedPrice =
      (listing.advertisedPrice != null && listing.advertisedPrice > 0) ||
      (listing.msrp != null && listing.msrp > 0) ||
      (listing.dealerPrice != null && listing.dealerPrice > 0);
    const lastGrounded = prev.priceHistory.find(
      (p) =>
        (p.advertisedPrice != null && p.advertisedPrice > 0) ||
        (p.msrp != null && p.msrp > 0) ||
        (p.dealerPrice != null && p.dealerPrice > 0),
    );
    const priceChanged =
      observedPrice &&
      (lastGrounded?.advertisedPrice !== listing.advertisedPrice ||
        lastGrounded?.msrp !== listing.msrp ||
        lastGrounded?.dealerPrice !== listing.dealerPrice);

    const priceHistory = priceChanged
      ? [{
          at: now,
          advertisedPrice: listing.advertisedPrice,
          msrp: listing.msrp,
          dealerPrice: listing.dealerPrice,
          sourceUrl: listing.sourceUrl,
        }, ...prev.priceHistory].slice(0, 50)
      : prev.priceHistory;

    const wasPhysical = prev.presenceStatus === "PHYSICALLY_VERIFIED";
    const presenceStatus: VehiclePresenceStatusV1 = wasPhysical ? "PHYSICALLY_VERIFIED" : "ONLINE_LISTED";
    const reappear: VehicleStatusHistoryEntryV1 = { at: now, status: presenceStatus, note: "Reappeared online." };
    const statusHistory: VehicleStatusHistoryEntryV1[] =
      prev.presenceStatus === "NO_LONGER_FOUND_ONLINE"
        ? [reappear, ...prev.statusHistory].slice(0, 50)
        : prev.statusHistory;

    vehicles[idx] = {
      ...prev,
      vin: listing.vin || prev.vin,
      stockNumber: listing.stockNumber || prev.stockNumber,
      year: listing.year ?? prev.year,
      make: listing.make ?? prev.make,
      model: listing.model ?? prev.model,
      trim: listing.trim ?? prev.trim,
      condition: listing.condition ?? prev.condition,
      exteriorColor: listing.exteriorColor ?? prev.exteriorColor,
      interiorColor: listing.interiorColor ?? prev.interiorColor,
      mileage: listing.mileage ?? prev.mileage,
      presenceStatus,
      listingUrl: listing.listingUrl || prev.listingUrl,
      detailUrl: listing.detailUrl || prev.detailUrl,
      lastOnlineAt: now,
      priceHistory,
      statusHistory,
      listingObservations: [listing, ...prev.listingObservations].slice(0, 30),
      updatedAt: now,
    };
  }

  // Mark previously online vehicles for this dealership not in this refresh.
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i]!;
    if (v.dealershipId !== dealership.id && v.dealershipName !== dealership.name) continue;
    if (v.presenceStatus === "PHYSICALLY_VERIFIED") continue;
    const still =
      (v.vin && seenVin.has(v.vin)) ||
      (v.stockNumber && seenStock.has(v.stockNumber.toUpperCase()));
    if (!still && v.lastOnlineAt && v.presenceStatus === "ONLINE_LISTED") {
      const gone: VehicleStatusHistoryEntryV1 = {
        at: now,
        status: "NO_LONGER_FOUND_ONLINE",
        note: "Not present in latest public inventory refresh.",
      };
      vehicles[i] = {
        ...v,
        presenceStatus: "NO_LONGER_FOUND_ONLINE",
        statusHistory: [gone, ...v.statusHistory].slice(0, 50),
        updatedAt: now,
      };
    }
  }

  return {
    ...state,
    vehicles: vehicles.slice(0, 5000),
    onlineListings: listings.slice(0, 3000),
    lastInventoryRefresh: { ...state.lastInventoryRefresh, [dealership.slug]: now },
  };
}

export function matchObservationToInventory(
  observation: Pick<PhysicalObservationV1, "vin" | "stockNumber">,
  vehicles: readonly VehicleRecordV1[],
  dealershipName: string,
): { vehicle: VehicleRecordV1 | null; matchStatus: ObservationMatchStatusV1 } {
  if (observation.vin) {
    const byVin = vehicles.find(
      (v) => v.vin === observation.vin && (!dealershipName || v.dealershipName === dealershipName),
    );
    if (byVin) {
      if (
        observation.stockNumber &&
        byVin.stockNumber &&
        observation.stockNumber.toUpperCase() !== byVin.stockNumber.toUpperCase()
      ) {
        return { vehicle: byVin, matchStatus: "STOCK_NUMBER_MISMATCH" };
      }
      return { vehicle: byVin, matchStatus: "VERIFIED_ON_LOT" };
    }
    // VIN not online
    return { vehicle: null, matchStatus: "SEEN_ON_LOT_NOT_ONLINE" };
  }
  if (observation.stockNumber) {
    const byStock = vehicles.find(
      (v) =>
        v.stockNumber &&
        observation.stockNumber &&
        v.stockNumber.toUpperCase() === observation.stockNumber.toUpperCase() &&
        (!dealershipName || v.dealershipName === dealershipName),
    );
    if (byStock) return { vehicle: byStock, matchStatus: "VERIFIED_ON_LOT" };
    return { vehicle: null, matchStatus: "SEEN_ON_LOT_NOT_ONLINE" };
  }
  return { vehicle: null, matchStatus: "PHOTO_REVIEW_REQUIRED" };
}

export function reconcileInventoryWalk(
  walk: InventoryWalkV1,
  observations: readonly PhysicalObservationV1[],
  vehicles: readonly VehicleRecordV1[],
  now: IsoTimestamp,
): WalkReconciliationV1 {
  const walkObs = observations.filter((o) => o.walkId === walk.id);
  const dealerVehicles = vehicles.filter(
    (v) => v.dealershipName === walk.dealershipName || v.dealershipId === walk.dealershipId,
  );
  const online = dealerVehicles.filter(
    (v) => v.presenceStatus === "ONLINE_LISTED" || v.presenceStatus === "PHYSICALLY_VERIFIED",
  );
  const observedVins = new Set(walkObs.map((o) => o.vin).filter(Boolean) as string[]);
  const matched = walkObs.filter((o) => o.matchStatus === "VERIFIED_ON_LOT");

  const onlineButNotSeen = online
    .filter((v) => v.vin && !observedVins.has(v.vin))
    .map((v) => ({
      vin: v.vin,
      stockNumber: v.stockNumber,
      year: v.year,
      make: v.make,
      model: v.model,
    }));

  const seenButNotOnline = walkObs
    .filter((o) => o.matchStatus === "SEEN_ON_LOT_NOT_ONLINE")
    .map((o) => ({ vin: o.vin, stockNumber: o.stockNumber, observationId: o.id }));

  const vinMismatches = walkObs
    .filter((o) => o.matchStatus === "VIN_MISMATCH")
    .map((o) => ({ observationId: o.id, detail: `VIN ${o.vin ?? "?"} mismatch` }));

  const stockMismatches = walkObs
    .filter((o) => o.matchStatus === "STOCK_NUMBER_MISMATCH")
    .map((o) => ({
      observationId: o.id,
      detail: `Stock ${o.stockNumber ?? "?"} does not match online VIN record`,
    }));

  const byVin = new Map<string, OpaqueId[]>();
  for (const o of walkObs) {
    if (!o.vin) continue;
    const list = byVin.get(o.vin) ?? [];
    list.push(o.id);
    byVin.set(o.vin, list);
  }
  const duplicates = [...byVin.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([vin, observationIds]) => ({ vin, observationIds }));

  const photoReviewRequired = walkObs
    .filter((o) => o.matchStatus === "PHOTO_REVIEW_REQUIRED")
    .map((o) => ({ observationId: o.id, vin: o.vin }));

  const exceptionsFirst: string[] = [];
  if (stockMismatches.length) exceptionsFirst.push(`${stockMismatches.length} stock-number mismatch(es)`);
  if (vinMismatches.length) exceptionsFirst.push(`${vinMismatches.length} VIN mismatch(es)`);
  if (duplicates.length) exceptionsFirst.push(`${duplicates.length} duplicate VIN observation(s)`);
  if (photoReviewRequired.length) exceptionsFirst.push(`${photoReviewRequired.length} photo review required`);
  if (seenButNotOnline.length) exceptionsFirst.push(`${seenButNotOnline.length} seen on lot but not online`);
  if (onlineButNotSeen.length) {
    exceptionsFirst.push(
      walk.coverageDeclaredComplete
        ? `${onlineButNotSeen.length} online but not seen (walk marked complete for area)`
        : `${onlineButNotSeen.length} online but not seen (not claimed missing — walk coverage not declared complete)`,
    );
  }
  if (!exceptionsFirst.length) exceptionsFirst.push("No exceptions flagged.");

  return {
    walkId: walk.id,
    dealershipName: walk.dealershipName,
    onlineInventoryCount: online.length,
    physicallyObservedCount: walkObs.length,
    matchedCount: matched.length,
    onlineButNotSeen,
    seenButNotOnline,
    vinMismatches,
    stockMismatches,
    duplicates,
    photoReviewRequired,
    exceptionsFirst,
    caveat: walk.coverageDeclaredComplete
      ? "Owner declared this walk covers the relevant inventory area."
      : "Online-but-not-seen does NOT mean missing from the lot unless the Owner marks walk coverage complete.",
    generatedAt: now,
  };
}

export function queryVehicles(
  vehicles: readonly VehicleRecordV1[],
  query: {
    dealershipName?: string;
    year?: number;
    make?: string;
    model?: string;
    vin?: string;
    condition?: string;
    maxPrice?: number;
    presenceStatus?: VehiclePresenceStatusV1;
    verifiedToday?: boolean;
    nowIso?: string;
  },
): VehicleRecordV1[] {
  const day = query.nowIso?.slice(0, 10);
  return vehicles.filter((v) => {
    if (query.dealershipName && v.dealershipName.toLowerCase() !== query.dealershipName.toLowerCase()) return false;
    if (query.year && v.year !== query.year) return false;
    if (query.make && !(v.make || "").toLowerCase().includes(query.make.toLowerCase())) return false;
    if (query.model && !(v.model || "").toLowerCase().includes(query.model.toLowerCase())) return false;
    if (query.vin && v.vin !== normalizeVinCandidate(query.vin)) return false;
    if (query.condition && v.condition !== query.condition) return false;
    if (query.maxPrice != null) {
      // Newest *known* price, not newest entry — a price-less observation must not hide a
      // vehicle from a budget filter.
      let p: number | null = null;
      for (const entry of v.priceHistory ?? []) {
        const candidate = entry?.advertisedPrice ?? entry?.dealerPrice ?? entry?.msrp ?? null;
        if (candidate != null && candidate > 0) { p = candidate; break; }
      }
      if (p == null || p > query.maxPrice) return false;
    }
    if (query.presenceStatus && v.presenceStatus !== query.presenceStatus) return false;
    if (query.verifiedToday && day) {
      if (!v.lastPhysicalAt || v.lastPhysicalAt.slice(0, 10) !== day) return false;
    }
    return true;
  });
}

/** Generate a synthetic valid VIN for tests (Toyota-like WMI + sequential + check digit). */
export function synthesizeValidVin(seed: string): string {
  const base = ("1HGCM" + normalizeVinCandidate(seed).replace(/[^A-HJ-NPR-Z0-9]/g, "0").padEnd(11, "0").slice(0, 11)).slice(0, 16);
  // positions 0-7 and 9-16; leave check digit blank as X temporarily
  let body = base.slice(0, 8) + "0" + base.slice(8, 16);
  if (body.length < 17) body = (body + "00000000000000000").slice(0, 17);
  // compute check digit
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    if (i === 8) continue;
    const ch = body[i]!;
    const value = VIN_TRANSLITERATION[ch] ?? 0;
    sum += value * VIN_WEIGHTS[i]!;
  }
  const remainder = sum % 11;
  const check = remainder === 10 ? "X" : String(remainder);
  return body.slice(0, 8) + check + body.slice(9);
}
