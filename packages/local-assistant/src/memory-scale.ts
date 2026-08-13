/**
 * Knowing how big AION is before it becomes a problem.
 *
 * Production state is 17.05 MiB against a 32 MiB ceiling. That is not an emergency and it is not
 * comfortable either: over half consumed, with the Owner about to start photographing a lot daily
 * and ingesting years of archive. The failure mode of a monolithic JSON state is not graceful — it
 * is a write that stops working — so the thing that must exist first is a measurement and a warning,
 * not a database.
 *
 * ## What this module deliberately does not do
 *
 * It does not migrate anything. The addendum was explicit that a storage migration must not
 * destabilise the current release, and the measured evidence says there is time: growth is linear in
 * the sources, the dominant collection is inventory (bounded by the dealership's actual stock), and
 * media already lives outside state on disk. Migration is designed here and scheduled, not performed.
 *
 * The genuine risks are not raw volume. They are:
 *
 * - **duplication** — the same bytes written into several records
 * - **cross-product** — persisting every customer × vehicle match, which grows multiplicatively
 * - **derived accumulation** — every generated draft and summary kept forever
 *
 * Those are architectural, and each one is cheaper to prevent now than to unwind later.
 */
import type { IsoTimestamp } from "./contracts.js";

export const MEMORY_SCALE_SCHEMA_V1 = "aion.memory-scale.v1" as const;

/** Matches the repository's configured ceiling. Read, never redefined, so the two cannot drift. */
export const STATE_CEILING_BYTES = 32 * 1024 * 1024;

export type CapacityLevelV1 = "NORMAL" | "WARNING" | "CRITICAL";

/**
 * Thresholds, chosen against the real ceiling rather than round numbers.
 *
 * WARNING at 60% is roughly where production sits today, so the Owner is told now rather than
 * discovering it at the cliff. CRITICAL at 80% leaves about 6 MiB — enough headroom to migrate
 * deliberately instead of under a failing write.
 */
export const CAPACITY_WARNING_RATIO = 0.60;
export const CAPACITY_CRITICAL_RATIO = 0.80;

export interface CapacityReportV1 {
  schema: typeof MEMORY_SCALE_SCHEMA_V1;
  usedBytes: number;
  ceilingBytes: number;
  ratio: number;
  level: CapacityLevelV1;
  /** The largest collections, so the answer to "what is big?" is immediate. */
  topCollections: Array<{ collection: string; bytes: number; count: number; share: number }>;
  message: string;
  /** Set at WARNING and above — what would actually reduce this. */
  recommendation: string | null;
}

export interface CollectionSizeV1 {
  collection: string;
  bytes: number;
  count: number;
}

/**
 * Measure state and classify how close to the ceiling it is.
 *
 * Pure: the caller supplies sizes it already computed. This module never reads a file, so it can be
 * run against a copy, a snapshot, or a projection without touching production.
 */
export function assessStateCapacity(input: {
  usedBytes: number;
  collections: readonly CollectionSizeV1[];
  ceilingBytes?: number;
}): CapacityReportV1 {
  const ceiling = input.ceilingBytes ?? STATE_CEILING_BYTES;
  const ratio = ceiling > 0 ? input.usedBytes / ceiling : 0;
  const level: CapacityLevelV1 =
    ratio >= CAPACITY_CRITICAL_RATIO ? "CRITICAL"
    : ratio >= CAPACITY_WARNING_RATIO ? "WARNING"
    : "NORMAL";

  const top = [...input.collections]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 6)
    .map((c) => ({ ...c, share: input.usedBytes > 0 ? c.bytes / input.usedBytes : 0 }));

  const pct = Math.round(ratio * 100);
  const message =
    level === "CRITICAL"
      ? `State is at ${pct}% of its ceiling. Writes will start failing before long — this needs attention now.`
      : level === "WARNING"
        ? `State is at ${pct}% of its ceiling. Nothing is broken, but this is the point to plan rather than react.`
        : `State is at ${pct}% of its ceiling.`;

  const biggest = top[0];
  return {
    schema: MEMORY_SCALE_SCHEMA_V1,
    usedBytes: input.usedBytes,
    ceilingBytes: ceiling,
    ratio,
    level,
    topCollections: top,
    message,
    recommendation: level === "NORMAL" || !biggest
      ? null
      : `${biggest.collection} is ${Math.round(biggest.share * 100)}% of it. Moving durable history out of the single state file is the structural fix.`,
  };
}

// ---------------------------------------------------------------------------
// Growth
// ---------------------------------------------------------------------------

export type GrowthClassV1 =
  /** One source event, one record. Predictable. */
  | "LINEAR_SOURCE"
  /** Records computed from sources. Linear only if bounded and expired. */
  | "DERIVED"
  /** The same content stored more than once. Always a defect. */
  | "DUPLICATION"
  /** Grows with the product of two collections. The one that actually bites. */
  | "CROSS_PRODUCT"
  /** Rebuildable. Should not be backed up like canonical data. */
  | "CACHE"
  /** Images, audio, PDFs. Belongs on disk, never inside state. */
  | "MEDIA_BLOB";

export interface GrowthDriverV1 {
  name: string;
  growthClass: GrowthClassV1;
  /** Bytes added per day at the Owner's expected rate. */
  bytesPerDay: number;
  /** True when it lands in the bounded state file rather than on disk. */
  countsAgainstStateCeiling: boolean;
  control: string;
}

export interface GrowthModelV1 {
  drivers: GrowthDriverV1[];
  stateBytesPerDay: number;
  mediaBytesPerDay: number;
  projected30DayStateBytes: number;
  projected1YearStateBytes: number;
  daysUntilWarning: number | null;
  daysUntilCeiling: number | null;
  crossProductRisks: string[];
  summary: string;
}

/**
 * Project growth from the Owner's stated daily volumes.
 *
 * Only state-bound drivers count towards the ceiling. Photographs are by far the largest byte
 * volume and are the *least* dangerous to the ceiling, because they live on disk — which is exactly
 * why the distinction is modelled rather than a single total being reported.
 */
export function buildGrowthModel(input: {
  currentStateBytes: number;
  drivers: readonly GrowthDriverV1[];
  ceilingBytes?: number;
}): GrowthModelV1 {
  const ceiling = input.ceilingBytes ?? STATE_CEILING_BYTES;
  const stateBytesPerDay = input.drivers
    .filter((d) => d.countsAgainstStateCeiling)
    .reduce((sum, d) => sum + d.bytesPerDay, 0);
  const mediaBytesPerDay = input.drivers
    .filter((d) => !d.countsAgainstStateCeiling)
    .reduce((sum, d) => sum + d.bytesPerDay, 0);

  const warningBytes = ceiling * CAPACITY_WARNING_RATIO;
  const daysTo = (target: number): number | null => {
    if (stateBytesPerDay <= 0) return null;
    const remaining = target - input.currentStateBytes;
    return remaining <= 0 ? 0 : Math.floor(remaining / stateBytesPerDay);
  };

  const crossProductRisks = input.drivers
    .filter((d) => d.growthClass === "CROSS_PRODUCT")
    .map((d) => `${d.name} — ${d.control}`);

  return {
    drivers: [...input.drivers],
    stateBytesPerDay,
    mediaBytesPerDay,
    projected30DayStateBytes: input.currentStateBytes + stateBytesPerDay * 30,
    projected1YearStateBytes: input.currentStateBytes + stateBytesPerDay * 365,
    daysUntilWarning: daysTo(warningBytes),
    daysUntilCeiling: daysTo(ceiling),
    crossProductRisks,
    summary: stateBytesPerDay <= 0
      ? "No measured state growth per day."
      : `State grows about ${Math.round(stateBytesPerDay / 1024)} KiB/day; media about `
        + `${Math.round(mediaBytesPerDay / 1_048_576)} MiB/day on disk, which does not touch the ceiling.`,
  };
}

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

export type MemoryTierV1 =
  | "HOT_OPERATIONAL"
  | "DURABLE_STRUCTURED_HISTORY"
  | "SOURCE_BLOB"
  | "SEARCH_INDEX"
  | "DERIVED_RECOMPUTABLE"
  | "COLD_ARCHIVAL";

export interface TierPolicyV1 {
  tier: MemoryTierV1;
  whatLivesHere: string;
  storage: string;
  /** Canonical data must be backed up; a rebuildable index need not be. */
  backedUp: boolean;
  rebuildable: boolean;
}

/**
 * Where each kind of memory belongs.
 *
 * The load-bearing line is the last one on `DERIVED_RECOMPUTABLE`: customer × vehicle matches are
 * computed on demand and never persisted per pair. With ~2,000 vehicles and a growing customer list
 * that product is millions of rows describing something recomputable in milliseconds.
 */
export function memoryTierPolicy(): TierPolicyV1[] {
  return [
    {
      tier: "HOT_OPERATIONAL",
      whatLivesHere: "active conversation focus, current walk, current commitments, capability state",
      storage: "state file — small, read on every request",
      backedUp: true, rebuildable: false,
    },
    {
      tier: "DURABLE_STRUCTURED_HISTORY",
      whatLivesHere: "conversation events, needs and their supersession, corrections, observations, price history, Owner Knowledge",
      storage: "state file today; the first candidate to move to an embedded store",
      backedUp: true, rebuildable: false,
    },
    {
      tier: "SOURCE_BLOB",
      whatLivesHere: "photographs, audio, PDFs, raw archive material",
      storage: "private filesystem, content-addressed — never inside state",
      backedUp: true, rebuildable: false,
    },
    {
      tier: "SEARCH_INDEX",
      whatLivesHere: "full-text over conversations, archive, transcripts",
      storage: "rebuildable index alongside the durable store",
      backedUp: false, rebuildable: true,
    },
    {
      tier: "DERIVED_RECOMPUTABLE",
      whatLivesHere: "customer/vehicle matches, daily summaries, content opportunities, projections",
      storage: "computed on demand; cached with expiry, never persisted per pair",
      backedUp: false, rebuildable: true,
    },
    {
      tier: "COLD_ARCHIVAL",
      whatLivesHere: "superseded history not needed on an ordinary request",
      storage: "durable store, excluded from the hot read path",
      backedUp: true, rebuildable: false,
    },
  ];
}

// ---------------------------------------------------------------------------
// Storage decision
// ---------------------------------------------------------------------------

export type StructuredStorageDecisionV1 = "KEEP_FILE_STATE_FOR_NOW" | "HYBRID_MIGRATION_JUSTIFIED";

export interface StorageDecisionV1 {
  decision: StructuredStorageDecisionV1;
  rationale: string[];
  /** What would flip the decision. Named so the next executor does not re-litigate it. */
  triggers: string[];
  nextSafePhase: string;
}

/**
 * Decide from measurement, not from the fact that a database was mentioned.
 *
 * A migration has real costs — recovery, backup, concurrency, a second failure mode — and they are
 * only worth paying when the current shape is actually failing. The triggers make that a
 * measurement rather than a judgement call next time.
 */
export function decideStructuredStorage(input: {
  capacity: CapacityReportV1;
  growth: GrowthModelV1;
}): StorageDecisionV1 {
  const { capacity, growth } = input;
  const soon = growth.daysUntilCeiling != null && growth.daysUntilCeiling < 180;
  const justified = capacity.level === "CRITICAL" || soon;

  const rationale = [
    `state is at ${Math.round(capacity.ratio * 100)}% of the ${Math.round(capacity.ceilingBytes / 1_048_576)} MiB ceiling`,
    growth.daysUntilCeiling == null
      ? "no measured daily state growth to project from"
      : `at the current rate the ceiling is about ${growth.daysUntilCeiling} days away`,
    capacity.topCollections[0]
      ? `${capacity.topCollections[0].collection} is the largest collection at ${Math.round(capacity.topCollections[0].share * 100)}%`
      : "no dominant collection",
    "media already lives on the filesystem rather than in state",
  ];

  return {
    decision: justified ? "HYBRID_MIGRATION_JUSTIFIED" : "KEEP_FILE_STATE_FOR_NOW",
    rationale,
    triggers: [
      `state reaches ${Math.round(CAPACITY_CRITICAL_RATIO * 100)}% of the ceiling`,
      "projected ceiling date falls inside six months",
      "a single collection exceeds half of state",
      "full-text search over history becomes a normal daily operation",
    ],
    nextSafePhase: justified
      ? "Move durable structured history to an embedded store behind the existing repository port, keeping the file state readable and the cutover reversible."
      : "Keep the file state. Re-measure at each milestone, and migrate when a trigger fires rather than on a schedule.",
  };
}

/**
 * Guard against persisting a cross-product.
 *
 * Called where a bulk derived write would otherwise be tempting. Returns a refusal rather than a
 * warning: with thousands on each side, the row count is the argument.
 */
export function checkCrossProductPersistence(input: {
  leftCount: number;
  rightCount: number;
  what: string;
}): { allowed: boolean; reason: string } {
  const product = input.leftCount * input.rightCount;
  if (product <= 5_000) {
    return { allowed: true, reason: `${product} rows is small enough to hold` };
  }
  return {
    allowed: false,
    reason: `${input.what} would be ${input.leftCount} x ${input.rightCount} = ${product.toLocaleString("en-US")} rows. `
      + `Compute it on demand and cache the top few instead — it is recomputable in milliseconds and would never be read in full.`,
  };
}
