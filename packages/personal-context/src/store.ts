/**
 * Local durable storage: one file per record, validated on the way in and on the way out.
 *
 * Three separate collections rather than one document, because they have three different lifetimes.
 * The registry changes when the Owner enrolls or revokes; facts change on every sync; receipts are
 * append-only history. A single blob would make a fact write rewrite the registry, which is how a
 * crash mid-sync loses an authorization.
 *
 * ## Fail closed on the way out, not just on the way in
 *
 * A record that fails validation when it is *read* raises rather than being skipped. Skipping is the
 * friendlier behaviour and the wrong one: a corrupt source row silently omitted means a source the
 * Owner approved stops being read with no error anywhere, and a corrupt fact row silently omitted
 * means a conflict quietly resolves itself. Both look like success. Raising names the file.
 *
 * ## No cloud, no database
 *
 * Plain JSON under `.aion-local`, which is untracked local state. Personal context does not leave
 * this machine; what leaves is whatever a bounded retrieval hands to one eligible provider.
 */

import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

import {
  PERSONAL_CONTEXT_RECEIPT_SCHEMA_V1,
  validateContextSource,
  validatePersonalContextFact,
  type ContextSourceV1,
  type PersonalContextFactV1,
} from "./contracts.js";
import { validateSyncReceipt, type SyncReceiptV1 } from "./receipts.js";

/** Raised when a stored record cannot be trusted. Never swallowed by a `catch` in this package. */
export class PersonalContextIntegrityError extends Error {
  readonly recordPath: string;
  constructor(recordPath: string, detail: string) {
    super(`personal context record is unusable (${recordPath}): ${detail}`);
    this.name = "PersonalContextIntegrityError";
    this.recordPath = recordPath;
  }
}

export interface PersonalContextStoreV1 {
  listSources(): readonly ContextSourceV1[];
  loadSource(sourceId: string): ContextSourceV1 | null;
  saveSource(source: ContextSourceV1): void;
  listFacts(): readonly PersonalContextFactV1[];
  saveFacts(facts: readonly PersonalContextFactV1[]): void;
  listReceipts(): readonly SyncReceiptV1[];
  saveReceipt(receipt: SyncReceiptV1): void;
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function assertSafeSegment(value: string, what: string): void {
  if (!SAFE_SEGMENT.test(value)) throw new PersonalContextIntegrityError(value, `${what} is not a safe path segment`);
}

/* -------------------------------------------------------------------------- */
/* Memory store — the one tests drive                                          */
/* -------------------------------------------------------------------------- */

export function createMemoryPersonalContextStore(seed?: {
  readonly sources?: readonly ContextSourceV1[];
  readonly facts?: readonly PersonalContextFactV1[];
  readonly receipts?: readonly SyncReceiptV1[];
}): PersonalContextStoreV1 {
  const sources = new Map<string, ContextSourceV1>((seed?.sources ?? []).map((row) => [row.sourceId, row]));
  const facts = new Map<string, PersonalContextFactV1>((seed?.facts ?? []).map((row) => [row.factId, row]));
  const receipts: SyncReceiptV1[] = [...(seed?.receipts ?? [])];

  return {
    listSources() {
      return [...sources.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
    },
    loadSource(sourceId) {
      return sources.get(sourceId) ?? null;
    },
    saveSource(source) {
      const problem = validateContextSource(source);
      if (problem !== null) throw new PersonalContextIntegrityError(source.sourceId ?? "<unknown>", problem);
      sources.set(source.sourceId, source);
    },
    listFacts() {
      return [...facts.values()].sort((a, b) => a.factId.localeCompare(b.factId));
    },
    saveFacts(rows) {
      for (const row of rows) {
        const problem = validatePersonalContextFact(row);
        if (problem !== null) throw new PersonalContextIntegrityError(row.factId ?? "<unknown>", problem);
      }
      for (const row of rows) facts.set(row.factId, row);
    },
    listReceipts() {
      return [...receipts].sort((a, b) => a.receiptId.localeCompare(b.receiptId));
    },
    saveReceipt(receipt) {
      const problem = validateSyncReceipt(receipt);
      if (problem !== null) throw new PersonalContextIntegrityError(receipt.receiptId ?? "<unknown>", problem);
      receipts.push(receipt);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* File store                                                                  */
/* -------------------------------------------------------------------------- */

const RENAME_ATTEMPTS = 8;

/**
 * Temp file, fsync, rename — the same durability discipline `@aion/director` uses internally.
 *
 * Reimplemented rather than imported because the director package does not export `writeAtomic` on
 * its public surface, and reaching into another workspace's `src` would couple this package to that
 * package's internal layout. The rename retry is the Windows antivirus/indexer window; a persistent
 * failure leaves the previous bytes intact rather than a truncated file.
 */
function writeDurable(target: string, contents: string): void {
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  const handle = openSync(temporary, "w");
  try {
    writeSync(handle, contents);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt += 1) {
    try {
      renameSync(temporary, target);
      return;
    } catch (error) {
      lastError = error;
      const code = error !== null && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code === "EEXIST" || code === "EPERM") continue;
      break;
    }
  }
  try {
    unlinkSync(temporary);
  } catch {
    // Leaving the temp file behind is better than deleting the evidence of a failed persist.
  }
  throw lastError;
}

function readJsonFiles(directory: string): { path: string; parsed: unknown }[] {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }
  const rows: { path: string; parsed: unknown }[] = [];
  for (const name of [...names].sort()) {
    if (!name.endsWith(".json")) continue;
    const path = join(directory, name);
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (error) {
      throw new PersonalContextIntegrityError(path, `record could not be read: ${String(error)}`);
    }
    try {
      rows.push({ path, parsed: JSON.parse(raw) });
    } catch {
      throw new PersonalContextIntegrityError(path, "record is not valid JSON");
    }
  }
  return rows;
}

export function sourceRecordPath(root: string, sourceId: string): string {
  assertSafeSegment(sourceId, "sourceId");
  return join(root, "sources", `${sourceId}.json`);
}

export function factRecordPath(root: string, factId: string): string {
  assertSafeSegment(factId, "factId");
  return join(root, "facts", `${factId}.json`);
}

export function receiptRecordPath(root: string, receiptId: string): string {
  assertSafeSegment(receiptId, "receiptId");
  return join(root, "receipts", `${receiptId}.json`);
}

/**
 * A store rooted at one directory. Reloading it is how restart-safety is proven: build a second
 * store over the same root and every registry row, fact and receipt is there, conflict links included.
 */
export function createFilePersonalContextStore(root: string): PersonalContextStoreV1 {
  return {
    listSources() {
      return readJsonFiles(join(root, "sources"))
        .map(({ path, parsed }) => {
          const problem = validateContextSource(parsed);
          if (problem !== null) throw new PersonalContextIntegrityError(path, problem);
          return parsed as ContextSourceV1;
        })
        .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
    },
    loadSource(sourceId) {
      const path = sourceRecordPath(root, sourceId);
      let raw: string;
      try {
        raw = readFileSync(path, "utf8");
      } catch {
        return null;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new PersonalContextIntegrityError(path, "record is not valid JSON");
      }
      const problem = validateContextSource(parsed);
      if (problem !== null) throw new PersonalContextIntegrityError(path, problem);
      return parsed as ContextSourceV1;
    },
    saveSource(source) {
      const problem = validateContextSource(source);
      if (problem !== null) throw new PersonalContextIntegrityError(source.sourceId ?? "<unknown>", problem);
      writeDurable(sourceRecordPath(root, source.sourceId), `${JSON.stringify(source, null, 2)}\n`);
    },
    listFacts() {
      return readJsonFiles(join(root, "facts"))
        .map(({ path, parsed }) => {
          const problem = validatePersonalContextFact(parsed);
          if (problem !== null) throw new PersonalContextIntegrityError(path, problem);
          return parsed as PersonalContextFactV1;
        })
        .sort((a, b) => a.factId.localeCompare(b.factId));
    },
    saveFacts(facts) {
      for (const fact of facts) {
        const problem = validatePersonalContextFact(fact);
        if (problem !== null) throw new PersonalContextIntegrityError(fact.factId ?? "<unknown>", problem);
      }
      for (const fact of facts) {
        writeDurable(factRecordPath(root, fact.factId), `${JSON.stringify(fact, null, 2)}\n`);
      }
    },
    listReceipts() {
      return readJsonFiles(join(root, "receipts"))
        .map(({ path, parsed }) => {
          const problem = validateSyncReceipt(parsed);
          if (problem !== null) throw new PersonalContextIntegrityError(path, problem);
          return parsed as SyncReceiptV1;
        })
        .sort((a, b) => a.receiptId.localeCompare(b.receiptId));
    },
    saveReceipt(receipt) {
      const problem = validateSyncReceipt(receipt);
      if (problem !== null) throw new PersonalContextIntegrityError(receipt.receiptId ?? "<unknown>", problem);
      writeDurable(
        receiptRecordPath(root, receipt.receiptId),
        `${JSON.stringify({ ...receipt, schema: PERSONAL_CONTEXT_RECEIPT_SCHEMA_V1 }, null, 2)}\n`,
      );
    },
  };
}
