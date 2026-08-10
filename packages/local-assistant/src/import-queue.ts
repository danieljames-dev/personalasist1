import type { IsoTimestamp, OpaqueId, ProvenanceV1 } from "./contracts.js";

/**
 * Owner-selected import sources (Checkpoint E/K).
 * AION never recursively scans the machine; the Owner picks a path once.
 */

export type ImportSourceKindV1 =
  | "folder"
  | "file"
  | "csv"
  | "json"
  | "document-batch"
  | "other";

export type ImportSourceStatusV1 = "queued" | "processing" | "completed" | "failed" | "cancelled";

export interface QueuedImportSourceV1 {
  id: OpaqueId;
  kind: ImportSourceKindV1;
  /** Absolute path the Owner selected, or logical label for uploaded batches. */
  path: string;
  label: string;
  associateWith: "owner" | "business" | "brand" | "customer" | "none";
  associateId: string | null;
  status: ImportSourceStatusV1;
  lastError: string;
  itemsImported: number;
  itemsSkipped: number;
  provenance: ProvenanceV1;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  completedAt: IsoTimestamp | null;
}

export function buildQueuedImportSource(
  input: Record<string, unknown>,
  context: { id: OpaqueId; now: IsoTimestamp },
): QueuedImportSourceV1 {
  const path = String(input.path ?? "").trim().slice(0, 4096);
  if (!path) throw new Error("Import source needs an explicit path or label.");
  const kinds: ImportSourceKindV1[] = ["folder", "file", "csv", "json", "document-batch", "other"];
  const kind = kinds.includes(input.kind as ImportSourceKindV1) ? (input.kind as ImportSourceKindV1) : "other";
  const associates = ["owner", "business", "brand", "customer", "none"] as const;
  const associateWith = associates.includes(input.associateWith as (typeof associates)[number])
    ? (input.associateWith as (typeof associates)[number])
    : "none";
  return {
    id: context.id,
    kind,
    path,
    label: String(input.label ?? path).trim().slice(0, 200) || path.slice(0, 200),
    associateWith,
    associateId: typeof input.associateId === "string" && input.associateId ? input.associateId.slice(0, 80) : null,
    status: "queued",
    lastError: "",
    itemsImported: 0,
    itemsSkipped: 0,
    provenance: {
      sourceType: "owner",
      sourceRef: String(input.sourceRef ?? "import.queue").slice(0, 500),
      recordedAt: context.now,
    },
    createdAt: context.now,
    updatedAt: context.now,
    completedAt: null,
  };
}

/** Parse simple CSV with header row into objects (no RFC edge-case perfection). */
export function parseSimpleCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return { headers: [], rows: [] };
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = !inQ;
        continue;
      }
      if (ch === "," && !inQ) {
        out.push(cur.trim());
        cur = "";
        continue;
      }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const headers = split(lines[0]!).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1, 501)) {
    const cols = split(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cols[i] ?? "").slice(0, 2000);
    });
    if (Object.values(row).some((v) => v)) rows.push(row);
  }
  return { headers, rows };
}

/** Map common CRM CSV columns to a relationship create payload. */
export function csvRowToRelationship(row: Record<string, string>): Record<string, unknown> | null {
  const name =
    row.display_name ||
    row.name ||
    row.full_name ||
    row.contact ||
    [row.first_name, row.last_name].filter(Boolean).join(" ") ||
    row.company ||
    row.organisation ||
    row.organization ||
    "";
  if (!name.trim()) return null;
  const organisation = row.company || row.organisation || row.organization || row.account || "";
  const email = row.email || row.e_mail || row.email_address || "";
  const phone = row.phone || row.mobile || row.telephone || "";
  const notes = row.notes || row.note || row.comments || "";
  const contactMethods = [];
  if (email) contactMethods.push({ channel: "email", value: email, preferred: true });
  if (phone) contactMethods.push({ channel: "phone", value: phone, preferred: !email });
  return {
    displayName: name.trim().slice(0, 200),
    organisation: organisation.trim().slice(0, 200),
    relationshipType: "prospect",
    notes: notes.slice(0, 5000),
    contactMethods,
    source: "csv-import",
  };
}
