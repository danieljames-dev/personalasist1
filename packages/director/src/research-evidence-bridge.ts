/**
 * Where live research meets the evidence rules Revenue Discovery spent twenty-two rounds hardening.
 *
 * The temptation with a new capability is to give it a fast lane. Research is *real* now, so surely
 * it can be trusted a little more than the hypothetical items the operator was built against? No —
 * and the reason is the whole point of those rounds. Every substitution that had to be closed there
 * was something plausible standing in for something evidenced. "It came off the live internet" is
 * exactly that shape.
 *
 * So research enters through `buildResearchItem`, the same constructor as everything else, and is
 * subject to the same rules: a fixture never counts, a derived summary never counts alone, an item
 * must name a source and a fact, and its geography must be one AION is authorized for.
 *
 * The one thing this module adds is the rule the brief asked for explicitly:
 *
 *     A SEARCH SNIPPET IS A DISCOVERY POINTER, NOT AN EVIDENCE SOURCE.
 *
 * Only `EVIDENCE_SOURCE` records — pages that were actually fetched — become research items. A
 * pointer that was never followed contributes nothing, however suggestive its snippet was, because a
 * search engine's one-line paraphrase is not the publisher speaking.
 */

import {
  buildResearchItem,
  isAdmissibleAreaV1,
  type ResearchItemV1,
  type ResearchSourceTypeV1,
} from "./revenue-research.js";
import type { ResearchPortV1, ResearchQueryV1 } from "./revenue-research.js";
import type { ResearchStoreV1, StoredResearchRecordV1 } from "./research-store.js";
import type { ResearchRecordV1, ResearchSourceClassV1 } from "./research-record.js";

/**
 * How a retrieved source class maps onto the evidence layer's source types.
 *
 * Official documents keep their standing; marketplaces and ordinary pages are both public web
 * material and are distinguished so the evidence layer can rank them, not so one can be smuggled in
 * as the other.
 */
const SOURCE_TYPE_FOR_CLASS_V1: Readonly<Record<ResearchSourceClassV1, ResearchSourceTypeV1>> = Object.freeze({
  OFFICIAL_PUBLIC_DOCUMENT: "PUBLIC_GOVERNMENT",
  PUBLIC_MARKETPLACE: "PUBLIC_MARKETPLACE",
  PUBLIC_WEB: "PUBLIC_WEB",
});

/**
 * Freshness from what the page said about itself, never from when AION happened to look.
 *
 * A page fetched today is not therefore current — it may be a rate card last touched in 2019. When
 * the page states no date, freshness is `UNKNOWN`, which is the honest answer and costs the item
 * nothing it deserves.
 */
export function freshnessForV1(record: ResearchRecordV1, now: string): ResearchItemV1["freshness"] {
  if (record.observedPublicationDate === "") return "UNKNOWN";
  const published = new Date(record.observedPublicationDate).getTime();
  const asked = new Date(now).getTime();
  if (Number.isNaN(published) || Number.isNaN(asked)) return "UNKNOWN";
  const days = (asked - published) / 86_400_000;
  if (days <= 400) return "CURRENT";
  if (days <= 1100) return "AGING";
  return "STALE";
}

/**
 * How strong a single retrieved page is allowed to be.
 *
 * Capped at `MODERATE` for ordinary web material however official it looks, because one page is one
 * source and the evidence layer's `STRONG` is reserved for claims corroborated across independent
 * ones. An official public document earns `MODERATE` on its own; a marketing page earns `WEAK`.
 * Nothing here can mint `STRONG`, which is deliberate — a capability that can award itself the top
 * grade is the substitution this whole design refuses.
 */
export function evidenceQualityForV1(record: ResearchRecordV1): ResearchItemV1["evidenceQuality"] {
  if (record.role !== "EVIDENCE_SOURCE") return "NONE";
  if (record.extract.trim().length < 200) return "NONE";
  if (record.sourceClass === "OFFICIAL_PUBLIC_DOCUMENT") return "MODERATE";
  if (record.sourceClass === "PUBLIC_MARKETPLACE") return "WEAK";
  return "WEAK";
}

export interface ResearchItemConversionV1 {
  readonly item: ResearchItemV1 | null;
  readonly skipped: string;
}

/**
 * Turn one stored record into a research item, or explain why it cannot be one.
 *
 * Returning a reason rather than silently dropping matters: "we fetched eleven pages and three
 * became evidence" is a fact somebody should be able to interrogate, and a filter that leaves no
 * trace is indistinguishable from a bug.
 */
export function researchItemFromRecordV1(
  record: ResearchRecordV1,
  taskId: string,
  now: string,
): ResearchItemConversionV1 {
  if (record.role !== "EVIDENCE_SOURCE") {
    return { item: null, skipped: "a search snippet is a discovery pointer, not an evidence source" };
  }
  if (record.httpStatus !== 200) {
    return { item: null, skipped: `the source answered ${record.httpStatus}, so nothing was published to read` };
  }
  const fact = record.extract.trim();
  if (fact === "") return { item: null, skipped: "the fetched page carried no readable text" };

  try {
    const item = buildResearchItem({
      taskId,
      workspaceId: record.workspaceId,
      sourceType: SOURCE_TYPE_FOR_CLASS_V1[record.sourceClass],
      /* The publisher's URL, so a reader can go and check. */
      sourceRef: record.canonicalUrl,
      derivedFrom: "",
      retrievedAtUtc: record.retrievedAtUtc,
      geography: record.geography,
      /*
       * A bounded excerpt, not the page.
       *
       * The whole document would make the evidence store unreadable and would tempt something
       * downstream into treating the record as a corpus to search rather than as a citation. The
       * digest is what proves what was read; this is what makes it legible.
       */
      fact: fact.slice(0, 1200),
      freshness: freshnessForV1(record, now),
      evidenceQuality: evidenceQualityForV1(record),
    });
    return { item, skipped: "" };
  } catch (error) {
    return { item: null, skipped: (error as Error).message };
  }
}

/**
 * A research port backed by what has already been retrieved and stored.
 *
 * Revenue Discovery asks a `ResearchPortV1` for evidence and does not know or care whether the
 * network was touched during *its* run. Separating retrieval from consumption is what lets the
 * Director research in one bounded step and rank in another, and what lets a restart rank against
 * everything gathered so far without fetching anything again.
 */
export function createStoreBackedResearchPortV1(input: {
  store: ResearchStoreV1;
  workspaceId: string;
  now: string;
}): ResearchPortV1 {
  return Object.freeze({
    fetchPublicEvidence(query: ResearchQueryV1): readonly ResearchItemV1[] {
      const authorized = new Set(query.geography.map((area) => area.toLowerCase()));
      const items: ResearchItemV1[] = [];
      /*
       * One source, one piece of evidence — whatever its version history says.
       *
       * A live re-run found this: two of the four fetched pages had changed between runs, which is
       * correct to *record* as new versions, and was then served as four more items. The market did
       * not get better understood because a page's boilerplate rotated. History is kept so a change
       * can be explained; only the current reading is evidence of what is true now.
       */
      const latest = new Map<string, StoredResearchRecordV1>();
      for (const stored of input.store.all(input.workspaceId)) {
        const key = `${stored.record.canonicalUrl}|${stored.record.role}`;
        const held = latest.get(key);
        if (held === undefined || stored.version > held.version) latest.set(key, stored);
      }
      for (const stored of latest.values()) {
        const record = stored.record;
        if (record.role !== "EVIDENCE_SOURCE") continue;
        /*
         * Only what this question asked for.
         *
         * Records are stored per workspace, not per question, so without this a query about wages
         * would be answered with pages retrieved while asking about rates. Matching on the stored
         * query keeps a task's evidence to what was gathered for it.
         */
        if (!record.queries.includes(query.question)) continue;
        const admissible = isAdmissibleAreaV1(record.geography, authorized);
        if (!admissible) continue;
        const { item } = researchItemFromRecordV1(record, record.researchTaskId, input.now);
        if (item !== null) items.push(item);
      }
      return Object.freeze(items);
    },
  });
}
