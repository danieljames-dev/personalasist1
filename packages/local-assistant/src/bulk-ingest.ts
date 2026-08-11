/**
 * Bounded recursive bulk ingestion for Owner-approved folder roots.
 *
 * Never scans whole drives. Stays inside an approved root, refuses symlink/junction
 * escape, hashes content for skip/dedupe, and continues through per-file failures.
 */

import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep, basename } from "node:path";
import { isNoiseDirectoryName, isSecretOrProtectedPath } from "./import-path-policy.js";

export const BULK_SUPPORTED_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".xlsx",
  ".xls",
  ".pptx",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".log",
] as const;

export interface BulkIngestLimitsV1 {
  maxDepth: number;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_BULK_LIMITS: BulkIngestLimitsV1 = {
  maxDepth: 12,
  maxFiles: 500,
  maxFileBytes: 6 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
};

export interface DiscoveredBulkFileV1 {
  absolutePath: string;
  relativePath: string;
  /** POSIX-style relative path for stable provenance display. */
  relativePathPosix: string;
  byteLength: number;
  modifiedAtMs: number;
  contentHash: string;
  extension: string;
  supported: boolean;
}

export interface BulkWalkSkippedV1 {
  absolutePath: string;
  relativePath: string;
  reason:
    | "unsupported-type"
    | "too-large"
    | "max-files"
    | "max-total-bytes"
    | "max-depth"
    | "symlink-or-junction"
    | "escape"
    | "unreadable"
    | "not-file"
    | "duplicate-in-batch"
    | "noise-directory"
    | "secret-or-protected";
  detail?: string;
}

export interface BulkWalkResultV1 {
  root: string;
  approvedRoot: string;
  files: DiscoveredBulkFileV1[];
  skipped: BulkWalkSkippedV1[];
  errors: Array<{ path: string; message: string }>;
  limits: BulkIngestLimitsV1;
  truncated: boolean;
}

export function isSupportedBulkExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return BULK_SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export function hashBytes(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function hashFileContent(absolutePath: string): string {
  const bytes = readFileSync(absolutePath);
  return hashBytes(bytes);
}

/**
 * True when candidate resolves under approvedRoot (after normalize).
 * Uses path.relative semantics; rejects absolute escapes and .. segments.
 */
export function isPathInsideRoot(approvedRoot: string, candidate: string): boolean {
  const root = resolve(approvedRoot);
  const target = resolve(candidate);
  if (root === target) return true;
  const rel = relative(root, target);
  if (!rel || rel === "") return true;
  if (rel.startsWith("..")) return false;
  // Windows: different drive letters produce absolute relative paths
  if (resolve(rel) === rel && !rel.startsWith(".")) return false;
  return !rel.split(/[/\\]/).includes("..");
}

/**
 * Resolve real path when possible; fall back to resolved lexical path.
 * Callers still re-check containment against approved root realpath.
 */
export function safeRealPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function toPosixRelative(rel: string): string {
  return rel.split(sep).join("/").replace(/\\/g, "/");
}

export interface BulkWalkOptionsV1 {
  /** Owner-selected folder to process (must be under approvedRoot). */
  folder: string;
  /** Approved import root or data root that contains folder. */
  approvedRoot: string;
  limits?: Partial<BulkIngestLimitsV1>;
  /**
   * Existing content hashes already ingested — skip unchanged files.
   * Map contentHash -> true.
   */
  knownHashes?: Set<string> | Map<string, unknown>;
  /**
   * Skip files whose relative path + mtime + size match a prior successful ingest
   * (resume / idempotency without re-reading). Optional; hash still wins for content.
   */
  knownProvenance?: Map<string, { contentHash: string; byteLength: number; modifiedAtMs: number }>;
}

/**
 * Recursively discover supported files under folder, staying inside approvedRoot.
 * Does not extract text — only discovers, hashes, and classifies skip reasons.
 */
export function walkAuthorizedFolder(options: BulkWalkOptionsV1): BulkWalkResultV1 {
  const limits: BulkIngestLimitsV1 = { ...DEFAULT_BULK_LIMITS, ...options.limits };
  const folder = resolve(options.folder);
  const approvedRoot = resolve(options.approvedRoot);
  const known = options.knownHashes
    ? options.knownHashes instanceof Set
      ? options.knownHashes
      : new Set(options.knownHashes.keys())
    : new Set<string>();
  const knownProv = options.knownProvenance ?? new Map();

  const files: DiscoveredBulkFileV1[] = [];
  const skipped: BulkWalkSkippedV1[] = [];
  const errors: Array<{ path: string; message: string }> = [];
  const seenHashesInBatch = new Set<string>();
  let totalBytes = 0;
  let truncated = false;

  let approvedReal = approvedRoot;
  try {
    approvedReal = realpathSync(approvedRoot);
  } catch {
    approvedReal = approvedRoot;
  }

  if (!isPathInsideRoot(approvedReal, folder) && !isPathInsideRoot(approvedRoot, folder)) {
    return {
      root: folder,
      approvedRoot: approvedReal,
      files: [],
      skipped: [{ absolutePath: folder, relativePath: "", reason: "escape", detail: "Folder is outside approved root." }],
      errors: [{ path: folder, message: "Folder is outside approved root." }],
      limits,
      truncated: false,
    };
  }

  // Reject starting at a symlink/junction that escapes.
  try {
    const startLstat = lstatSync(folder);
    if (startLstat.isSymbolicLink()) {
      const real = safeRealPath(folder);
      if (!isPathInsideRoot(approvedReal, real)) {
        return {
          root: folder,
          approvedRoot: approvedReal,
          files: [],
          skipped: [{ absolutePath: folder, relativePath: "", reason: "symlink-or-junction", detail: "Start path is a link that escapes the approved root." }],
          errors: [{ path: folder, message: "Symlink/junction escape at start path." }],
          limits,
          truncated: false,
        };
      }
    }
  } catch (e) {
    return {
      root: folder,
      approvedRoot: approvedReal,
      files: [],
      skipped: [],
      errors: [{ path: folder, message: String((e as Error).message || e) }],
      limits,
      truncated: false,
    };
  }

  const visit = (dir: string, depth: number): void => {
    if (truncated) return;
    if (depth > limits.maxDepth) {
      skipped.push({
        absolutePath: dir,
        relativePath: toPosixRelative(relative(folder, dir) || "."),
        reason: "max-depth",
      });
      truncated = true;
      return;
    }

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      errors.push({ path: dir, message: String((e as Error).message || e).slice(0, 500) });
      return;
    }

    // Stable order for resumable determinism
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (truncated) break;
      // System / package noise — never descend
      if (entry.isDirectory() && isNoiseDirectoryName(entry.name)) {
        skipped.push({
          absolutePath: join(dir, entry.name),
          relativePath: toPosixRelative(relative(folder, join(dir, entry.name))),
          reason: "noise-directory",
          detail: entry.name,
        });
        continue;
      }
      const full = join(dir, entry.name);
      const relFromFolder = toPosixRelative(relative(folder, full));
      if (isSecretOrProtectedPath(full) || isSecretOrProtectedPath(entry.name)) {
        skipped.push({
          absolutePath: full,
          relativePath: relFromFolder,
          reason: "secret-or-protected",
          detail: "credential/secret pattern",
        });
        continue;
      }

      let lst;
      try {
        lst = lstatSync(full);
      } catch (e) {
        errors.push({ path: full, message: String((e as Error).message || e).slice(0, 500) });
        skipped.push({ absolutePath: full, relativePath: relFromFolder, reason: "unreadable" });
        continue;
      }

      // Symlink / junction protection: never follow links that leave the root.
      if (lst.isSymbolicLink()) {
        let real: string;
        try {
          real = realpathSync(full);
        } catch {
          skipped.push({
            absolutePath: full,
            relativePath: relFromFolder,
            reason: "symlink-or-junction",
            detail: "Could not resolve link.",
          });
          continue;
        }
        if (!isPathInsideRoot(approvedReal, real)) {
          skipped.push({
            absolutePath: full,
            relativePath: relFromFolder,
            reason: "symlink-or-junction",
            detail: "Link escapes approved root.",
          });
          continue;
        }
        // Link stays inside root — treat by target type without re-entering outside.
        try {
          const st = statSync(full);
          if (st.isDirectory()) {
            visit(full, depth + 1);
            continue;
          }
          if (!st.isFile()) {
            skipped.push({ absolutePath: full, relativePath: relFromFolder, reason: "not-file" });
            continue;
          }
          // fall through as file using st
          processFile(full, relFromFolder, st.size, st.mtimeMs);
          continue;
        } catch (e) {
          errors.push({ path: full, message: String((e as Error).message || e).slice(0, 500) });
          skipped.push({ absolutePath: full, relativePath: relFromFolder, reason: "unreadable" });
          continue;
        }
      }

      // Windows directory junctions often report as directories via Dirent; recheck with lstat
      // if reparse point — on Node, isSymbolicLink covers many junctions when created as 'junction'.
      if (entry.isDirectory() || lst.isDirectory()) {
        // Containment of the directory itself
        if (!isPathInsideRoot(approvedReal, full) && !isPathInsideRoot(approvedRoot, full)) {
          skipped.push({ absolutePath: full, relativePath: relFromFolder, reason: "escape" });
          continue;
        }
        visit(full, depth + 1);
        continue;
      }

      if (!entry.isFile() && !lst.isFile()) {
        skipped.push({ absolutePath: full, relativePath: relFromFolder, reason: "not-file" });
        continue;
      }

      processFile(full, relFromFolder, lst.size, lst.mtimeMs);
    }
  };

  function processFile(full: string, relFromFolder: string, size: number, mtimeMs: number): void {
    if (files.length >= limits.maxFiles) {
      skipped.push({ absolutePath: full, relativePath: relFromFolder, reason: "max-files" });
      truncated = true;
      return;
    }
    if (!isPathInsideRoot(approvedReal, full) && !isPathInsideRoot(approvedRoot, full)) {
      skipped.push({ absolutePath: full, relativePath: relFromFolder, reason: "escape" });
      return;
    }
    if (isSecretOrProtectedPath(full) || isSecretOrProtectedPath(basename(full))) {
      skipped.push({
        absolutePath: full,
        relativePath: relFromFolder,
        reason: "secret-or-protected",
        detail: "credential/secret pattern",
      });
      return;
    }
    if (!isSupportedBulkExtension(entryName(full))) {
      skipped.push({ absolutePath: full, relativePath: relFromFolder, reason: "unsupported-type" });
      return;
    }
    if (size > limits.maxFileBytes) {
      skipped.push({ absolutePath: full, relativePath: relFromFolder, reason: "too-large", detail: `${size}` });
      return;
    }
    if (totalBytes + size > limits.maxTotalBytes) {
      skipped.push({ absolutePath: full, relativePath: relFromFolder, reason: "max-total-bytes" });
      truncated = true;
      return;
    }

    // Resume via provenance: same relative path + size + mtime + known hash
    const prior = knownProv.get(relFromFolder);
    if (prior && prior.byteLength === size && prior.modifiedAtMs === mtimeMs && known.has(prior.contentHash)) {
      skipped.push({
        absolutePath: full,
        relativePath: relFromFolder,
        reason: "duplicate-in-batch",
        detail: "unchanged-already-ingested",
      });
      return;
    }

    let contentHash: string;
    try {
      contentHash = hashFileContent(full);
    } catch (e) {
      errors.push({ path: full, message: String((e as Error).message || e).slice(0, 500) });
      skipped.push({ absolutePath: full, relativePath: relFromFolder, reason: "unreadable" });
      return;
    }

    if (known.has(contentHash)) {
      skipped.push({
        absolutePath: full,
        relativePath: relFromFolder,
        reason: "duplicate-in-batch",
        detail: "content-hash-already-ingested",
      });
      return;
    }
    if (seenHashesInBatch.has(contentHash)) {
      skipped.push({
        absolutePath: full,
        relativePath: relFromFolder,
        reason: "duplicate-in-batch",
        detail: "duplicate-content-in-this-import",
      });
      return;
    }

    seenHashesInBatch.add(contentHash);
    totalBytes += size;
    files.push({
      absolutePath: full,
      relativePath: relFromFolder,
      relativePathPosix: relFromFolder,
      byteLength: size,
      modifiedAtMs: mtimeMs,
      contentHash,
      extension: extensionOf(entryName(full)),
      supported: true,
    });
  }

  function entryName(p: string): string {
    const parts = p.split(/[/\\]/);
    return parts[parts.length - 1] || p;
  }

  visit(folder, 0);

  return {
    root: folder,
    approvedRoot: approvedReal,
    files,
    skipped,
    errors,
    limits,
    truncated,
  };
}

export function mimeForBulkExtension(extOrName: string): string {
  const lower = extOrName.toLowerCase();
  if (lower.endsWith(".png") || lower === ".png") return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower === ".jpg" || lower === ".jpeg") return "image/jpeg";
  if (lower.endsWith(".webp") || lower === ".webp") return "image/webp";
  if (lower.endsWith(".pdf") || lower === ".pdf") return "application/pdf";
  if (lower.endsWith(".json") || lower === ".json") return "application/json";
  if (lower.endsWith(".csv") || lower === ".csv") return "text/csv";
  if (lower.endsWith(".md") || lower === ".md") return "text/markdown";
  if (lower.endsWith(".docx") || lower === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".xlsx") || lower === ".xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".xls") || lower === ".xls") return "application/vnd.ms-excel";
  if (lower.endsWith(".pptx") || lower === ".pptx") {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  return "text/plain";
}

export function kindForBulkFile(name: string, mimeType: string): "document" | "image" | "spreadsheet" | "other" {
  if (mimeType.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(name)) return "image";
  if (/\.(csv|xlsx?)$/i.test(name)) return "spreadsheet";
  if (/\.(txt|md|pdf|docx|json|log|pptx)$/i.test(name)) return "document";
  return "other";
}
