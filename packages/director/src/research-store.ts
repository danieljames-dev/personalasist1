/**
 * Where retrieved research lives, and how a page that changed is kept without losing what it said before.
 *
 * Two requirements shape this, and they pull in opposite directions:
 *
 * **Re-retrieving the same page must not create a second piece of evidence.** Otherwise a research
 * loop that runs twice looks twice as well-informed, and the count that Revenue Discovery reads
 * becomes a measure of how often AION searched rather than of how much it knows.
 *
 * **A page that genuinely changed must not overwrite what it used to say.** A competitor's rate page
 * saying \$32 today and \$28 last month is two facts, and the interesting one is often the change.
 * Silently replacing the old record would destroy the only evidence that anything moved.
 *
 * The resolution is that identity includes the content digest. Same URL and same content is the same
 * record — writing it again is a no-op. Same URL and different content is a *new* record that names
 * its predecessor, so history is a chain rather than a field somebody has to remember to update.
 */

import { mkdirSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { writeAtomic } from "./atomic-write.js";
import { digestOf } from "./business-evidence.js";
import type { ResearchRecordV1 } from "./research-record.js";

export const RESEARCH_VERSION_SCHEMA_V1 = "aion.director.researchVersion.v1" as const;

/**
 * A stored record plus where it sits in the history of its URL.
 *
 * `supersedes` points at the previous version's id and is empty for the first sighting. Nothing is
 * ever deleted, so following the chain backwards reconstructs what the page said and when.
 */
export interface StoredResearchRecordV1 {
  readonly schema: typeof RESEARCH_VERSION_SCHEMA_V1;
  readonly record: ResearchRecordV1;
  readonly version: number;
  readonly supersedes: string;
  readonly firstSeenAtUtc: string;
}

export interface ResearchStoreV1 {
  /** Idempotent. Returns what is stored and whether this call is what created it. */
  readonly put: (record: ResearchRecordV1) => { stored: StoredResearchRecordV1; created: boolean };
  readonly all: (workspaceId: string) => readonly StoredResearchRecordV1[];
  /** Every version of one URL, oldest first. */
  readonly history: (workspaceId: string, canonicalUrl: string) => readonly StoredResearchRecordV1[];
  readonly byId: (workspaceId: string, recordId: string) => StoredResearchRecordV1 | null;
}

function workspaceDir(root: string, workspaceId: string): string {
  /*
   * Digested rather than used raw.
   *
   * A workspace id reaches this from configuration, and a path segment built from an identifier is
   * how traversal happens. Digesting removes the question entirely.
   */
  return join(root, digestOf(workspaceId).slice(0, 32));
}

export function createFileResearchStoreV1(root: string): ResearchStoreV1 {
  const read = (workspaceId: string): StoredResearchRecordV1[] => {
    const dir = workspaceDir(root, workspaceId);
    if (!existsSync(dir)) return [];
    const rows: StoredResearchRecordV1[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const parsed = JSON.parse(readFileSync(join(dir, name), "utf8")) as StoredResearchRecordV1;
        if (parsed.schema === RESEARCH_VERSION_SCHEMA_V1 && parsed.record.workspaceId === workspaceId) {
          rows.push(parsed);
        }
      } catch {
        /*
         * An unreadable file is skipped rather than thrown.
         *
         * One corrupt record should not make the whole store unreadable, and the alternative — a
         * research run that dies on startup because of a half-written file — is worse than a run
         * that proceeds with what it can read. The file stays on disk to be looked at.
         */
        continue;
      }
    }
    return rows.sort((a, b) => a.record.retrievedAtUtc.localeCompare(b.record.retrievedAtUtc)
      || a.version - b.version);
  };

  return Object.freeze({
    put(record: ResearchRecordV1): { stored: StoredResearchRecordV1; created: boolean } {
      const dir = workspaceDir(root, record.workspaceId);
      mkdirSync(dir, { recursive: true });
      const existing = read(record.workspaceId);

      /*
       * Same id means same URL, same role and same bytes: nothing has changed.
       *
       * Nothing has changed about the *content*, at least. The question it was fetched for may be new,
       * and a record that remembers only the first one silently stops answering every later task that
       * retrieved the same page — evidence lost rather than doubled. So the content is not rewritten
       * and the question set is merged.
       */
      const already = existing.find((row) => row.record.recordId === record.recordId);
      if (already !== undefined) {
        const merged = [...new Set([...already.record.queries, ...record.queries])];
        if (merged.length === already.record.queries.length) return { stored: already, created: false };
        const updated: StoredResearchRecordV1 = {
          ...already,
          record: { ...already.record, queries: Object.freeze(merged) },
        };
        writeAtomic(join(dir, `${record.recordId}.json`), `${JSON.stringify(updated, null, 2)}
`);
        return { stored: updated, created: false };
      }

      /* Same URL and role, different content: a new version that names what it replaced. */
      const lineage = existing
        .filter((row) => row.record.canonicalUrl === record.canonicalUrl && row.record.role === record.role)
        .sort((a, b) => a.version - b.version);
      const previous = lineage[lineage.length - 1];

      const stored: StoredResearchRecordV1 = {
        schema: RESEARCH_VERSION_SCHEMA_V1,
        record,
        version: (previous?.version ?? 0) + 1,
        supersedes: previous?.record.recordId ?? "",
        firstSeenAtUtc: previous?.firstSeenAtUtc ?? record.retrievedAtUtc,
      };
      writeAtomic(join(dir, `${record.recordId}.json`), `${JSON.stringify(stored, null, 2)}\n`);
      return { stored, created: true };
    },

    all(workspaceId: string): readonly StoredResearchRecordV1[] {
      return Object.freeze(read(workspaceId));
    },

    history(workspaceId: string, canonicalUrl: string): readonly StoredResearchRecordV1[] {
      return Object.freeze(
        read(workspaceId)
          .filter((row) => row.record.canonicalUrl === canonicalUrl)
          .sort((a, b) => a.version - b.version),
      );
    },

    byId(workspaceId: string, recordId: string): StoredResearchRecordV1 | null {
      return read(workspaceId).find((row) => row.record.recordId === recordId) ?? null;
    },
  });
}
