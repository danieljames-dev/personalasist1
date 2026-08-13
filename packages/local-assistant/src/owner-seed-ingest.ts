/**
 * Bringing the Owner's own recorded history into current memory.
 *
 * There is a small archive of high-signal facts the Owner and Caleb wrote down while building
 * earlier systems — decisions, doctrine, why things were designed the way they were. Without it AION
 * meets its own Owner as a stranger every morning, which is exactly the complaint that started this
 * work: it could describe a car but could not remember a thing they had agreed.
 *
 * ## What ingestion must preserve
 *
 * **Provenance.** Each fact records where it came from, so a later disagreement is settled by
 * looking rather than by arguing with a confident assistant.
 *
 * **Historical meaning.** These are records of what was true or decided *then*. Ingesting them as
 * present-tense assertions would let a superseded decision outrank a current one. They arrive as
 * history and are labelled as history; supersession is a later, explicit act.
 *
 * **Non-authority.** This is the load-bearing one. Archive text is data, not instruction. A line in
 * an old note reading "always deploy straight to production" is a record of something someone once
 * wrote — it cannot widen what AION is allowed to do today. Every ingested fact is therefore stamped
 * `grantsAuthority: false`, and that literal is asserted in the test suite rather than merely
 * intended.
 *
 * ## Idempotence without a database
 *
 * Re-running ingestion must not double the archive. Identity is derived from normalised content, so
 * the same fact ingested twice collides with itself and is skipped. Ordering in the source file
 * carries no meaning and index-based identity would break the moment a line was inserted.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import type { OwnerKnowledgeCategoryV1, OwnerKnowledgeFactV1 } from "./owner-knowledge.js";

export const OWNER_SEED_SCHEMA_V1 = "aion.owner-seed-ingest.v1" as const;

/** One entry as it appears in the authorized archive file. */
export interface SeedFactInputV1 {
  content: string;
  source_type?: string | null;
  source_locator?: string | null;
  tags?: readonly string[];
  confidence?: number | null;
}

export interface PlannedSeedFactV1 {
  /** Stable across re-runs; derived from content, not from position. */
  dedupeKey: string;
  title: string;
  category: OwnerKnowledgeCategoryV1;
  content: string;
  confidence: number;
  sourceRef: string;
  tags: string[];
  /** Archive text is evidence about the past. It never authorizes an action. */
  grantsAuthority: false;
}

export interface SeedIngestPlanV1 {
  schema: typeof OWNER_SEED_SCHEMA_V1;
  toAdd: PlannedSeedFactV1[];
  /** Already present from an earlier run, matched on derived identity. */
  skippedExisting: string[];
  /** Entries that carried no usable content. */
  rejected: string[];
  totalSeen: number;
}

/**
 * Tag-to-category mapping.
 *
 * The archive's tags are richer than the knowledge store's categories, so several tags collapse onto
 * one category. First match wins and the order here is meaningful: "trading" plus "project" should
 * land as a project, because that is how the Owner asks about it.
 */
const TAG_CATEGORY_ORDER: ReadonlyArray<[RegExp, OwnerKnowledgeCategoryV1]> = [
  [/^(?:projects?|portfolio|aion|v2|milestone-0|opening-drive|trading)$/i, "project"],
  [/^(?:skills?|stack|technical|architecture|system-design|memory-systems)$/i, "skill"],
  [/^(?:principles|doctrine|philosophy|operating-rules|discipline|risk)$/i, "preference"],
  [/^(?:goals?|mission|purpose)$/i, "goal"],
  [/^(?:identity|profile|background|psychology)$/i, "profile"],
  [/^(?:professional|career-agent|xo|role)$/i, "role"],
  [/^(?:partnership|ai-collaboration|caleb|communication|agents|autonomy|authority)$/i, "preference"],
];

export function categoryForTags(tags: readonly string[] = []): OwnerKnowledgeCategoryV1 {
  for (const [pattern, category] of TAG_CATEGORY_ORDER) {
    if (tags.some((tag) => pattern.test(String(tag).trim()))) return category;
  }
  return "other";
}

/**
 * A short label for a fact that arrived without one.
 *
 * Takes the first sentence and trims it to something that reads on a phone. A title is navigation,
 * not a summary — getting it slightly blunt is better than getting it long.
 */
export function titleForContent(content: string, tags: readonly string[] = []): string {
  const text = String(content ?? "").trim().replace(/\s+/g, " ");
  const firstSentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
  const clipped = firstSentence.length > 70 ? `${firstSentence.slice(0, 67).trimEnd()}…` : firstSentence;
  if (clipped) return clipped;
  return tags.length ? `Note on ${tags[0]}` : "Archive note";
}

/**
 * Content-derived identity.
 *
 * A small non-cryptographic hash is the right tool: this is a duplicate check inside one local
 * store, not a security boundary, and it must stay pure so the planner can be tested without I/O.
 */
export function seedDedupeKey(content: string): string {
  const normalized = String(content ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  let hash = 2_166_136_261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return `seed-${hash.toString(36)}-${normalized.length}`;
}

/** Archive confidence arrives as 0..1; the knowledge store keeps whole percentages. */
export function normalizeSeedConfidence(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 80;
  const scaled = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

/**
 * Decide what to ingest without writing anything.
 *
 * Returning a plan rather than performing the write is what makes this testable and what lets the
 * caller run it dry first. Existing facts are matched on the derived key recorded in their source
 * reference, so a second run is a no-op rather than a duplicate archive.
 */
export function planSeedIngest(input: {
  entries: readonly SeedFactInputV1[];
  existingFacts: readonly OwnerKnowledgeFactV1[];
}): SeedIngestPlanV1 {
  const present = new Set(
    input.existingFacts
      .map((fact) => String(fact.provenance?.sourceRef ?? ""))
      .filter((ref) => ref.includes("seed-"))
      .map((ref) => ref.slice(ref.indexOf("seed-")).split(/\s/)[0]!),
  );

  const toAdd: PlannedSeedFactV1[] = [];
  const skippedExisting: string[] = [];
  const rejected: string[] = [];
  const seenThisRun = new Set<string>();

  for (const entry of input.entries) {
    const content = String(entry?.content ?? "").trim();
    if (!content) {
      rejected.push("entry with no content");
      continue;
    }
    const dedupeKey = seedDedupeKey(content);
    if (present.has(dedupeKey) || seenThisRun.has(dedupeKey)) {
      skippedExisting.push(dedupeKey);
      continue;
    }
    seenThisRun.add(dedupeKey);

    const tags = (entry.tags ?? []).map((t) => String(t).trim()).filter(Boolean);
    const locator = String(entry.source_locator ?? "").trim();
    const sourceType = String(entry.source_type ?? "archive").trim();

    toAdd.push({
      dedupeKey,
      title: titleForContent(content, tags),
      category: categoryForTags(tags),
      content,
      confidence: normalizeSeedConfidence(entry.confidence),
      // The key travels in the source reference so the next run can find it without a side index.
      sourceRef: `owner-archive:${sourceType}${locator ? `:${locator}` : ""} ${dedupeKey}`.slice(0, 500),
      tags,
      grantsAuthority: false,
    });
  }

  return {
    schema: OWNER_SEED_SCHEMA_V1,
    toAdd,
    skippedExisting,
    rejected,
    totalSeen: input.entries.length,
  };
}

/** Shape a planned fact for `buildOwnerKnowledgeFact`, which owns validation and stamping. */
export function seedFactToKnowledgeInput(planned: PlannedSeedFactV1): Record<string, unknown> {
  return {
    category: planned.category,
    title: planned.title,
    // Tags ride along in the content so retrieval can match on them; the archive has no other index.
    content: planned.tags.length ? `${planned.content}\n\n[${planned.tags.join(", ")}]` : planned.content,
    confidence: planned.confidence,
    sourceType: "import",
    sourceRef: planned.sourceRef,
    enabled: true,
  };
}

/**
 * What to say when the archive is thinner than the question.
 *
 * The Owner has years of conversations with Caleb and this file holds 24 facts. Answering from it as
 * though it were the whole record would be the same failure as reporting a listing count as a lot
 * count — a confident answer drawn from a sample that was never representative.
 */
export function archiveCoverageNote(input: {
  factsIngested: number;
  factsMatched: number;
}): string | null {
  if (input.factsMatched > 0) {
    return `That's from the ${input.factsIngested} facts you've had me keep so far — not the whole archive.`;
  }
  return `I have ${input.factsIngested} facts from your archive on file and none of them cover that. `
    + `The full history with Caleb hasn't been ingested, so this is a gap in what I hold, not proof it never happened.`;
}

export interface SeedFactIdentityV1 {
  id: OpaqueId;
  dedupeKey: string;
  ingestedAt: IsoTimestamp;
}
