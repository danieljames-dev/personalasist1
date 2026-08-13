/**
 * Bringing the Owner's own history in, and getting only the relevant part back out.
 *
 * The Caleb archive is the record of who the Owner is and how he works — the Army and Merchant
 * Marine years, the spine injuries, the trading system built to run without him at the screen, the
 * charity the whole thing is for. It is the reason AION exists in the shape it does, and until now
 * AION has not had access to any of it.
 *
 * Two decisions shape how it is handled.
 *
 * **Facts are extracted; the archive is referenced.** Each entry becomes an Owner Knowledge fact
 * carrying its own `source_locator`, so "why did we design AION this way?" can be answered *and*
 * traced. The archive itself is not copied into `AssistantStateV1` — 24 entries is small, but the
 * pattern has to be right before it is 24,000, and state is already past half its ceiling.
 *
 * **Retrieval is narrow by default.** The Owner asking about a Camry does not need his medical
 * history in the prompt. Loading a whole personal profile into every request is how an assistant
 * becomes both slow and uncomfortable, so retrieval is scored against the actual question and
 * bounded hard.
 *
 * This material is unusually sensitive — health, finances, family. It is Owner Knowledge in the
 * Personal workspace, it never reaches a public content draft, and it never leaves the machine.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import type { OwnerKnowledgeCategoryV1, OwnerKnowledgeFactV1 } from "./owner-knowledge.js";

export const OWNER_ARCHIVE_SCHEMA_V1 = "aion.owner-archive.v1" as const;

/** One entry as the archive stores it. */
export interface ArchiveEntryV1 {
  content: string;
  source_type: string;
  source_locator: string;
  tags: string[];
  confidence: number;
}

export interface ArchiveIngestPlanV1 {
  schema: typeof OWNER_ARCHIVE_SCHEMA_V1;
  discovered: number;
  ingestable: number;
  skipped: Array<{ locator: string; reason: string }>;
  facts: OwnerKnowledgeFactV1[];
  /** Bytes the facts add to state, so the capacity cost is known before writing. */
  estimatedStateBytes: number;
}

/** Archive tags mapped onto AION's existing Owner Knowledge categories. */
const TAG_CATEGORY: Array<{ tag: string; category: OwnerKnowledgeCategoryV1 }> = [
  { tag: "identity", category: "other" },
  { tag: "mission", category: "goal" },
  { tag: "principles", category: "preference" },
  { tag: "discipline", category: "preference" },
  { tag: "projects", category: "project" },
  { tag: "trading", category: "project" },
  { tag: "aion", category: "project" },
  { tag: "architecture", category: "process" },
  { tag: "partnership", category: "collaborator" },
  { tag: "authority", category: "process" },
  { tag: "skills", category: "skill" },
  { tag: "ops", category: "process" },
  { tag: "risk", category: "preference" },
];

function categoryFor(tags: readonly string[]): OwnerKnowledgeCategoryV1 {
  for (const mapping of TAG_CATEGORY) {
    if (tags.includes(mapping.tag)) return mapping.category;
  }
  return "other";
}

/** A short title from the first clause — enough to scan a list without reading every entry. */
function titleFor(content: string): string {
  const first = String(content ?? "").split(/[.:—]/)[0]?.trim() ?? "";
  return (first || String(content ?? "").slice(0, 60)).slice(0, 90);
}

/**
 * Plan an ingestion without performing it.
 *
 * Separated so the capacity cost and the skip list can be reviewed before anything is written —
 * which is the habit that matters once the archive is large.
 */
export function planArchiveIngest(input: {
  entries: readonly ArchiveEntryV1[];
  workspace: string;
  now: IsoTimestamp;
  nextId: (index: number) => OpaqueId;
  /** Locators already ingested, so a repeat run adds nothing. */
  existingLocators?: readonly string[];
}): ArchiveIngestPlanV1 {
  const seen = new Set(input.existingLocators ?? []);
  const skipped: Array<{ locator: string; reason: string }> = [];
  const facts: OwnerKnowledgeFactV1[] = [];

  input.entries.forEach((entry, index) => {
    const locator = String(entry.source_locator ?? "").trim();
    const content = String(entry.content ?? "").trim();

    if (!content) { skipped.push({ locator: locator || `entry-${index}`, reason: "empty" }); return; }
    if (!locator) { skipped.push({ locator: `entry-${index}`, reason: "no source locator — a fact about the Owner needs provenance" }); return; }
    if (seen.has(locator)) { skipped.push({ locator, reason: "already ingested" }); return; }
    seen.add(locator);

    facts.push({
      id: input.nextId(index),
      category: categoryFor(entry.tags ?? []),
      title: titleFor(content),
      content: content.slice(0, 4000),
      // The archive's own confidence is carried rather than replaced. It was recorded by the
      // process that captured the material and knows more about it than this mapper does.
      confidence: Math.round(Math.max(0, Math.min(1, entry.confidence ?? 0.8)) * 100),
      enabled: true,
      provenance: {
        sourceType: "owner",
        sourceRef: locator,
        recordedAt: input.now,
      } as OwnerKnowledgeFactV1["provenance"],
      corrections: [],
      createdAt: input.now,
      updatedAt: input.now,
    });
  });

  const estimatedStateBytes = facts.reduce((sum, f) => sum + Buffer.byteLength(JSON.stringify(f), "utf8"), 0);
  return {
    schema: OWNER_ARCHIVE_SCHEMA_V1,
    discovered: input.entries.length,
    ingestable: facts.length,
    skipped,
    facts,
    estimatedStateBytes,
  };
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

export interface MemoryRetrievalPacketV1 {
  question: string;
  workspace: string;
  facts: Array<{ factId: OpaqueId; title: string; content: string; sourceRef: string; score: number }>;
  /** Bytes of fact content in this packet, against the budget. */
  usedBytes: number;
  budgetBytes: number;
  /** Set when relevant history exists but the question did not warrant loading it. */
  note: string | null;
}

/**
 * How much Owner history may enter one prompt.
 *
 * A budget rather than a count: three long entries can dwarf ten short ones, and the thing that
 * degrades a local model's answer is total context, not row count.
 */
export const MEMORY_PACKET_BUDGET_BYTES = 6_000;

const STOPWORDS = new Set([
  "what", "when", "where", "which", "that", "this", "with", "about", "have", "from", "they",
  "were", "did", "does", "the", "and", "for", "you", "i", "we", "us", "our", "my", "me", "a", "an",
  "is", "are", "was", "to", "of", "on", "in", "it", "do", "how", "why", "tell",
]);

function terms(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    // Two characters, not three: the Owner's vocabulary includes short proper nouns like "XO", and
    // dropping them left "what did we decide about the XO role?" matching on the word "role" alone,
    // which retrieved an unrelated goal about a dispatcher job.
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * How many of the question's own words a fact must actually match.
 *
 * A single common word is not a topic. "What was THE REAL PLAY?" scored against an entry titled
 * "Project portfolio: Real-estate platforms…" purely on *real*, cleared the score threshold on the
 * title weighting alone, and was returned as though it were the answer — a confident reply to a
 * question the archive does not cover. Requiring breadth as well as score is what turns that into an
 * honest "I don't have that".
 */
export const MIN_MATCHED_TERMS = 2;

/**
 * Retrieve the part of the Owner's history this question is actually about.
 *
 * Scored on term overlap against title and content, with the title weighted higher because it is
 * the entry's own summary of itself. Deliberately returns nothing when nothing scores — an empty
 * packet is the correct answer to a question about a Camry, and padding it with the highest-scoring
 * irrelevant entry is how personal material ends up in a sales prompt.
 */
export function retrieveOwnerMemory(input: {
  question: string;
  facts: readonly OwnerKnowledgeFactV1[];
  workspace: string;
  budgetBytes?: number;
  minScore?: number;
}): MemoryRetrievalPacketV1 {
  const budget = input.budgetBytes ?? MEMORY_PACKET_BUDGET_BYTES;
  const minScore = input.minScore ?? 2;
  const wanted = terms(input.question);

  const scored = input.facts
    .filter((f) => f.enabled)
    .map((fact) => {
      const title = terms(fact.title);
      const body = terms(fact.content);
      let score = 0;
      let matchedTerms = 0;
      for (const term of wanted) {
        if (title.includes(term)) { score += 3; matchedTerms += 1; }
        else if (body.includes(term)) { score += 1; matchedTerms += 1; }
      }
      return { fact, score, matchedTerms };
    })
    // Breadth as well as weight. A question with several content words needs several of them to
    // land; a one-word question is judged on score alone because breadth is not available to it.
    .filter((row) => row.score >= minScore
      && row.matchedTerms >= Math.min(MIN_MATCHED_TERMS, wanted.length))
    .sort((a, b) => b.score - a.score || b.fact.confidence - a.fact.confidence);

  const facts: MemoryRetrievalPacketV1["facts"] = [];
  let usedBytes = 0;
  for (const row of scored) {
    const size = Buffer.byteLength(row.fact.content, "utf8");
    if (usedBytes + size > budget) break;
    usedBytes += size;
    facts.push({
      factId: row.fact.id,
      title: row.fact.title,
      content: row.fact.content,
      sourceRef: String((row.fact.provenance as { sourceRef?: string })?.sourceRef ?? ""),
      score: row.score,
    });
  }

  return {
    question: input.question,
    workspace: input.workspace,
    facts,
    usedBytes,
    budgetBytes: budget,
    note: scored.length > facts.length
      ? `${scored.length - facts.length} more related entries exist; ask and I'll go deeper.`
      : null,
  };
}

/**
 * Answer from retrieved history, or say plainly that it is not there.
 *
 * The unsupported case is the important one. This material is personal, and an invented recollection
 * of the Owner's own life is worse than an admission — he would know immediately, and stop trusting
 * everything else.
 */
export function answerFromOwnerMemory(packet: MemoryRetrievalPacketV1): string {
  if (!packet.facts.length) {
    return "I don't have anything on file about that. If you tell me, or point me at where it's "
      + "written down, I'll keep it.";
  }
  const lines = packet.facts.slice(0, 4).map((f) => `· ${f.content}`);
  if (packet.note) lines.push("", packet.note);
  return lines.join("\n");
}
