/**
 * Control-plane archival provenance.
 *
 * Imported history is evidence only. It never becomes active CURRENT.md / LATEST.md
 * and never satisfies the authorization gate.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const IMPORTED_HISTORY_MANIFEST_SCHEMA = "aion.control-plane-imported-history.v1" as const;

export interface ImportedHistoryFileV1 {
  relativePath: string;
  sha256: string;
  bytes: number;
  kind: "directive" | "handoff" | "other";
  parsedDirectiveId: string | null;
  parsedStatus: string | null;
}

export interface ImportedHistoryManifestV1 {
  schema: typeof IMPORTED_HISTORY_MANIFEST_SCHEMA;
  designation: "archival-evidence-only";
  sourceSystemInstanceId: string;
  sourceMachineRole: "laptop" | "desktop" | "other";
  sourceHead: string;
  importTimestampUtc: string;
  files: ImportedHistoryFileV1[];
  /** Explicit non-authority statement for gates. */
  activeAuthorization: false;
}

function fail(message: string): never {
  throw new Error(message);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

function isFullSha(value: string): boolean {
  return /^[0-9a-f]{40}$/u.test(value);
}

export function parseDirectiveMetadata(text: string): { directiveId: string | null; status: string | null } {
  const id = /(?:^|\n)\s*Directive-ID:\s*(\S+)\s*(?:\n|$)/u.exec(text)?.[1] ?? null;
  const status = /(?:^|\n)\s*Status:\s*(\S+)\s*(?:\n|$)/u.exec(text)?.[1] ?? null;
  return { directiveId: id, status };
}

async function sha256File(path: string): Promise<{ sha256: string; bytes: number }> {
  const buf = await readFile(path);
  return { sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.byteLength };
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(full);
    }
  }
  await walk(root);
  return out;
}

export function validateImportedHistoryManifestV1(value: unknown): ImportedHistoryManifestV1 {
  if (!value || typeof value !== "object") fail("Imported history manifest is missing.");
  const m = value as Record<string, unknown>;
  if (m.schema !== IMPORTED_HISTORY_MANIFEST_SCHEMA) fail("Imported history schema is unsupported.");
  if (m.designation !== "archival-evidence-only") fail("Imported history must be designated archival-evidence-only.");
  if (m.activeAuthorization !== false) fail("Imported history must set activeAuthorization to false.");
  if (typeof m.sourceSystemInstanceId !== "string" || !isUuid(m.sourceSystemInstanceId)) {
    fail("Imported history sourceSystemInstanceId is invalid.");
  }
  if (!["laptop", "desktop", "other"].includes(String(m.sourceMachineRole))) fail("sourceMachineRole is invalid.");
  if (typeof m.sourceHead !== "string" || !isFullSha(m.sourceHead)) fail("sourceHead must be a full 40-character SHA.");
  if (typeof m.importTimestampUtc !== "string" || new Date(m.importTimestampUtc).toISOString() !== m.importTimestampUtc) {
    fail("importTimestampUtc is invalid.");
  }
  if (!Array.isArray(m.files)) fail("files must be an array.");
  return m as unknown as ImportedHistoryManifestV1;
}

/**
 * Import synthetic or transferred control-plane files into an isolated archival tree.
 * Never writes to active directives/CURRENT.md or handoffs/LATEST.md.
 */
export async function importControlPlaneHistoryArchival(input: {
  aionLocalRoot: string;
  sourceSystemInstanceId: string;
  sourceMachineRole: "laptop" | "desktop" | "other";
  sourceHead: string;
  importTimestampUtc: string;
  /** Map of relative path under directives|handoffs → absolute source file. */
  sources: Array<{ category: "directives" | "handoffs"; relativePath: string; absolutePath: string }>;
}): Promise<ImportedHistoryManifestV1> {
  if (!input.aionLocalRoot || !isAbsolute(input.aionLocalRoot) || resolve(input.aionLocalRoot) !== input.aionLocalRoot) {
    fail("aionLocalRoot must be a normalized absolute path.");
  }
  if (basename(input.aionLocalRoot) !== ".aion-local") fail("Archival import root must be a .aion-local directory.");
  if (!isUuid(input.sourceSystemInstanceId)) fail("sourceSystemInstanceId is invalid.");
  if (!isFullSha(input.sourceHead)) fail("sourceHead must be a full 40-character SHA.");

  // Refuse if caller tries to target active paths.
  for (const source of input.sources) {
    const base = basename(source.relativePath).toLowerCase();
    if (base === "current.md" || base === "latest.md") {
      // Allowed as *archival content* under imported-history only; never as active install target.
    }
    if (!isAbsolute(source.absolutePath)) fail("Source paths must be absolute.");
  }

  const destRoot = join(input.aionLocalRoot, "imported-history", input.sourceSystemInstanceId);
  await mkdir(join(destRoot, "directives"), { recursive: true });
  await mkdir(join(destRoot, "handoffs"), { recursive: true });

  // Guard: do not modify active CURRENT/LATEST
  const activeCurrent = join(input.aionLocalRoot, "directives", "CURRENT.md");
  const activeLatest = join(input.aionLocalRoot, "handoffs", "LATEST.md");
  let currentBefore: string | null = null;
  let latestBefore: string | null = null;
  try { currentBefore = await readFile(activeCurrent, "utf8"); } catch { /* absent ok */ }
  try { latestBefore = await readFile(activeLatest, "utf8"); } catch { /* absent ok */ }

  const files: ImportedHistoryFileV1[] = [];
  for (const source of input.sources) {
    const info = await stat(source.absolutePath);
    if (!info.isFile()) fail(`Source is not a file: ${source.relativePath}`);
    const raw = await readFile(source.absolutePath);
    const text = raw.toString("utf8");
    const meta = parseDirectiveMetadata(text);
    const rel = source.relativePath.replace(/\\/gu, "/").replace(/^\/+/u, "");
    if (rel.includes("..")) fail("Source relative path must not traverse.");
    const dest = join(destRoot, source.category, rel);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, raw, { flag: "wx", mode: 0o600 });
    const hash = createHash("sha256").update(raw).digest("hex");
    files.push({
      relativePath: `${source.category}/${rel}`,
      sha256: hash,
      bytes: raw.byteLength,
      kind: source.category === "directives" ? "directive" : source.category === "handoffs" ? "handoff" : "other",
      parsedDirectiveId: meta.directiveId,
      parsedStatus: meta.status,
    });
  }

  const manifest: ImportedHistoryManifestV1 = {
    schema: IMPORTED_HISTORY_MANIFEST_SCHEMA,
    designation: "archival-evidence-only",
    sourceSystemInstanceId: input.sourceSystemInstanceId,
    sourceMachineRole: input.sourceMachineRole,
    sourceHead: input.sourceHead,
    importTimestampUtc: input.importTimestampUtc,
    files,
    activeAuthorization: false,
  };
  validateImportedHistoryManifestV1(manifest);
  await writeFile(join(destRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  // Prove active files unchanged
  let currentAfter: string | null = null;
  let latestAfter: string | null = null;
  try { currentAfter = await readFile(activeCurrent, "utf8"); } catch { /* */ }
  try { latestAfter = await readFile(activeLatest, "utf8"); } catch { /* */ }
  if (currentBefore !== currentAfter) fail("Archival import must not modify active CURRENT.md.");
  if (latestBefore !== latestAfter) fail("Archival import must not modify active LATEST.md.");

  return manifest;
}

/**
 * Authorization isolation: archival CURRENT/LATEST-shaped files never authorize work.
 * Active gate path is only `.aion-local/directives/CURRENT.md` with Status AUTHORIZED.
 */
export function assertArchivalCannotAuthorize(input: {
  aionLocalRoot: string;
  importedManifest: ImportedHistoryManifestV1;
  activeCurrentPath?: string;
}): { archivalAuthorized: false; activePath: string } {
  const manifest = validateImportedHistoryManifestV1(input.importedManifest);
  if (manifest.activeAuthorization !== false) fail("Archival manifest claims active authorization.");
  if (manifest.designation !== "archival-evidence-only") fail("Archival designation missing.");
  const activePath = input.activeCurrentPath ?? join(input.aionLocalRoot, "directives", "CURRENT.md");
  // Any Status: AUTHORIZED found only under imported-history is non-authorizing.
  for (const file of manifest.files) {
    if (file.parsedStatus === "AUTHORIZED") {
      // still archival
      if (!file.relativePath.startsWith("directives/") && !file.relativePath.startsWith("handoffs/")) {
        fail("Unexpected archival path.");
      }
    }
  }
  const importedRoot = join(input.aionLocalRoot, "imported-history");
  const rel = relative(importedRoot, activePath);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
    fail("Active authorization path must not resolve inside imported-history.");
  }
  return { archivalAuthorized: false, activePath };
}

export function isPathInsideImportedHistory(aionLocalRoot: string, candidatePath: string): boolean {
  const imported = join(aionLocalRoot, "imported-history");
  const rel = relative(imported, candidatePath);
  return !!rel && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}
