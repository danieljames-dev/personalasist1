/**
 * Keeping extracted document text out of the one file that has a ceiling.
 *
 * Measured on production: `crmDocuments` is 20.8% of `AssistantStateV1`, and **91% of that is
 * `extractedText`** — OCR output copied inline from files that are already on disk. 377 documents
 * average 9.75 KiB each. At the Owner's stated hundred photos a day that is roughly 950 KiB of state
 * per day and about sixteen days of headroom against the 32 MiB limit.
 *
 * The text is not the problem. Storing a *second copy* of it inside the single bounded document is.
 * The original file is canonical evidence and is never touched; what changes is that the derived
 * transcription moves to a sidecar next to the state file, and the record keeps a reference and a
 * byte count instead.
 *
 * ## Why this is the right fix before a database
 *
 * A storage migration is a large, risky change with its own recovery and concurrency surface. This
 * is a narrow one that removes the fastest-growing thing in state and buys the time to do the larger
 * change deliberately. Fix the waste first; move the furniture later.
 *
 * ## Reading never breaks
 *
 * Every record written before today has its text inline, and those records must keep working
 * untouched. So the accessor tries the sidecar, falls back to inline, and a document with neither is
 * simply a document with no extracted text — not an error. Nothing is rewritten in place, nothing is
 * deleted, and a migration can be run twice with no effect the second time.
 */
import type { CrmDocumentV1 } from "./contracts.js";

export const DOCUMENT_TEXT_SCHEMA_V1 = "aion.document-text.v1" as const;

/**
 * Below this, text stays inline.
 *
 * A short summary line costs less as a few hundred bytes in the record than as a file handle and a
 * read. The threshold is where a sidecar starts paying for itself, not zero.
 */
export const INLINE_TEXT_MAX_BYTES = 2_048;

/** Sidecar directory, relative to the existing private AION data root. No second data root. */
export const DOCUMENT_TEXT_DIR = "document-text";

export interface DocumentTextRefV1 {
  /** Relative path under the private data root. Never absolute, never a network path. */
  ref: string;
  bytes: number;
}

/** Deterministic, derived from the document id so a repeat run produces the same path. */
export function documentTextRefFor(documentId: string): string {
  const safe = String(documentId).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
  return `${DOCUMENT_TEXT_DIR}/${safe}.txt`;
}

export interface DocumentTextPlanV1 {
  /** Text that stays in the record, empty when it moved to a sidecar. */
  inlineText: string;
  /** Set when the text belongs in a sidecar. */
  sidecar: DocumentTextRefV1 | null;
  bytes: number;
}

/**
 * Decide where a document's text should live.
 *
 * Pure: it never touches the filesystem. The caller does the write, which keeps this testable and
 * keeps process concerns out of the domain package.
 */
export function planDocumentTextStorage(input: {
  documentId: string;
  text: string;
}): DocumentTextPlanV1 {
  const text = String(input.text ?? "");
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= INLINE_TEXT_MAX_BYTES) {
    return { inlineText: text, sidecar: null, bytes };
  }
  return {
    inlineText: "",
    sidecar: { ref: documentTextRefFor(input.documentId), bytes },
    bytes,
  };
}

/**
 * Read a document's text wherever it lives.
 *
 * Sidecar first, then the legacy inline field. A missing sidecar falls back rather than throwing:
 * losing the reference should degrade to "no extracted text", never to a broken document.
 */
export async function resolveDocumentText(
  document: Pick<CrmDocumentV1, "extractedText"> & { extractedTextRef?: string | null },
  readSidecar: (ref: string) => Promise<string | null>,
): Promise<string> {
  const ref = document.extractedTextRef;
  if (ref) {
    try {
      const text = await readSidecar(ref);
      if (typeof text === "string") return text;
    } catch {
      // Fall through to inline. A read failure is not a reason to lose the record.
    }
  }
  return String(document.extractedText ?? "");
}

/** True when this record still carries large text inline and would benefit from moving. */
export function needsTextMigration(document: Pick<CrmDocumentV1, "extractedText"> & { extractedTextRef?: string | null }): boolean {
  if (document.extractedTextRef) return false;
  return Buffer.byteLength(String(document.extractedText ?? ""), "utf8") > INLINE_TEXT_MAX_BYTES;
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

export interface TextMigrationItemV1 {
  documentId: string;
  ref: string;
  text: string;
  bytesFreed: number;
}

export interface TextMigrationPlanV1 {
  schema: typeof DOCUMENT_TEXT_SCHEMA_V1;
  items: TextMigrationItemV1[];
  /** Documents already migrated or small enough to leave alone. */
  skipped: number;
  totalBytesFreed: number;
  stateBytesBefore: number;
  stateBytesAfter: number;
  percentReduction: number;
}

/**
 * Plan the move for a whole collection.
 *
 * Idempotent by construction: a document that already has a `extractedTextRef` is skipped, so
 * running this twice moves nothing the second time. The plan carries the text so the caller writes
 * sidecars and clears inline fields in one pass — a half-applied migration would leave text in
 * neither place.
 */
export function planStateTextMigration(input: {
  documents: ReadonlyArray<Pick<CrmDocumentV1, "id" | "extractedText"> & { extractedTextRef?: string | null }>;
  stateBytesBefore: number;
}): TextMigrationPlanV1 {
  const items: TextMigrationItemV1[] = [];
  let skipped = 0;

  for (const document of input.documents) {
    if (!needsTextMigration(document)) { skipped += 1; continue; }
    const text = String(document.extractedText ?? "");
    items.push({
      documentId: document.id,
      ref: documentTextRefFor(document.id),
      text,
      // What leaves state: the text plus the JSON quoting around it.
      bytesFreed: Buffer.byteLength(JSON.stringify(text), "utf8") - 2,
    });
  }

  const totalBytesFreed = items.reduce((sum, i) => sum + i.bytesFreed, 0);
  const after = Math.max(0, input.stateBytesBefore - totalBytesFreed);
  return {
    schema: DOCUMENT_TEXT_SCHEMA_V1,
    items,
    skipped,
    totalBytesFreed,
    stateBytesBefore: input.stateBytesBefore,
    stateBytesAfter: after,
    percentReduction: input.stateBytesBefore > 0 ? (totalBytesFreed / input.stateBytesBefore) * 100 : 0,
  };
}

/**
 * Apply the plan to a document record.
 *
 * The inline field is emptied rather than deleted, so the shape stays exactly what every existing
 * reader expects. `extractedTextBytes` is kept because search and capacity reporting want the size
 * without opening the sidecar.
 */
export function applyTextMigrationToDocument<T extends { id: string; extractedText: string }>(
  document: T,
  item: TextMigrationItemV1,
): T & { extractedTextRef: string; extractedTextBytes: number } {
  return {
    ...document,
    extractedText: "",
    extractedTextRef: item.ref,
    extractedTextBytes: Buffer.byteLength(item.text, "utf8"),
  };
}
