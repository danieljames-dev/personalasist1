/**
 * Owner-authorized broad data discovery (Owner authorization, not agent self-auth).
 *
 * Discovers ordinary useful Owner-controlled folders, classifies relevance/priority,
 * and inventories supported files — without requiring per-folder manual approval.
 *
 * HARD: never touch nearm/all-projects-API or credential/system noise trees.
 */

import { existsSync, readdirSync, statSync, lstatSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { homedir } from "node:os";
import {
  validateImportRootCandidate,
  isNoiseDirectoryName,
  isSecretOrProtectedPath,
  classifyOwnerDataCategory,
  type OwnerDataCategoryV1,
} from "./import-path-policy.js";
import { isSupportedBulkExtension, BULK_SUPPORTED_EXTENSIONS } from "./bulk-ingest.js";

export type DiscoveryPriorityV1 = 1 | 2 | 3 | 4 | 5 | 6;

export type SourceClassV1 =
  | "USEFUL_OWNER_DATA"
  | "TECHNICAL_PROJECT_DATA"
  | "SYSTEM_NOISE"
  | "SECRET_EXCLUDED"
  | "DUPLICATE"
  | "UNSUPPORTED"
  | "REVIEW_REQUIRED";

export type RealVsSyntheticV1 = "REAL_OWNER_DATA" | "SYNTHETIC_TEST_DATA" | "E2E_TEST_DATA" | "UNKNOWN";

export interface DiscoveredSourceV1 {
  path: string;
  label: string;
  category: OwnerDataCategoryV1;
  priority: DiscoveryPriorityV1;
  sourceClass: SourceClassV1;
  realVsSynthetic: RealVsSyntheticV1;
  workspaceCandidate: string;
  estimatedFileCount: number;
  estimatedSupportedFileCount: number;
  estimatedBytes: number;
  lastModifiedMin: string | null;
  lastModifiedMax: string | null;
  importStatus: "discovered" | "registered" | "processed" | "skipped" | "failed";
  reason: string;
  exists: boolean;
  policyOk: boolean;
  policyReason: string;
}

export type DiscoveredSource = DiscoveredSourceV1;

export interface OwnerDataInventoryV1 {
  discoveredAt: string;
  rootsScanned: string[];
  sources: DiscoveredSource[];
  useful: DiscoveredSource[];
  excluded: DiscoveredSource[];
  totals: {
    sources: number;
    useful: number;
    estimatedSupportedFiles: number;
    estimatedBytes: number;
  };
  hardExclusionsHonored: string[];
  reply: string;
}

/** Seed candidate roots — existence checked at runtime; no assumed paths invented as facts. */
export function candidateSeedRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.USERPROFILE || env.HOME || homedir();
  const seeds: string[] = [];
  const push = (p: string) => {
    const t = String(p || "").trim();
    if (t) seeds.push(resolve(t));
  };

  // High-value profile locations
  push(join(home, "Desktop"));
  push(join(home, "Documents"));
  push(join(home, "Downloads"));
  push(join(home, "OneDrive"));
  push(join(home, "OneDrive", "Documents"));

  // Known Owner project / career / business locations (validated if present)
  push(join(home, "Desktop", "Remote Job Kit - Daniel Coffman"));
  push(join(home, "Desktop", "Claude_Grok_System"));
  push(join(home, "Desktop", "E8 Daily Trading Checklist"));

  // Private AION knowledge areas (not OS noise)
  push("C:\\AION-HQ\\private\\career");
  push("C:\\AION-HQ\\private\\identity");
  push("C:\\AION-HQ\\handoffs");
  push("C:\\AION-HQ\\docs");

  // External Owner-data drive common folders (if mounted)
  if (existsSync("D:\\")) {
    push("D:\\Compassionate Choice - Kristinas Business");
    push("D:\\AI Assistant Training");
    push("D:\\Desktop Archive");
    push("D:\\Grok_Parallel_Dev");
    push("D:\\AntiGravity_Plans");
    push("D:\\AntiGravity_External_Handoff");
    // Brand / project pockets — only if present
    push("D:\\Caleb-Backup\\Talk to Caleb\\Drive with Caleb - brand");
    push("D:\\Caleb-Backup\\Brand Video Engine");
  }

  // Deduplicate case-insensitively
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of seeds) {
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/**
 * Shallow expansion: list direct child directories of Desktop/Documents/D:\ that look useful.
 * Depth-bounded; never walks excluded trees.
 */
export function expandLikelyOwnerChildren(root: string, maxChildren = 40): string[] {
  const policy = validateImportRootCandidate(root);
  if (!policy.ok && !isDriveOrProfileContainer(root)) return [];
  if (!existsSync(root)) return [];
  let st;
  try {
    st = statSync(root);
  } catch {
    return [];
  }
  if (!st.isDirectory()) return [];

  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const e of entries) {
    if (out.length >= maxChildren) break;
    if (!e.isDirectory()) continue;
    if (isNoiseDirectoryName(e.name)) continue;
    const full = join(root, e.name);
    if (isSecretOrProtectedPath(full)) continue;
    const v = validateImportRootCandidate(full);
    if (!v.ok) continue;
    // Prefer names that look like Owner work
    const name = e.name.toLowerCase();
    const usefulName =
      /resume|career|job|brand|business|project|sales|crm|customer|marketing|content|plan|note|research|aion|coffman|toyota|lakeland|compassionate|caleb|podcast|grant|llc|identity|handoff|kit|trading|portfolio|product|service|collaborat/i.test(
        name,
      ) ||
      /remote job|daily|checklist|found/i.test(name);
    if (usefulName || isDriveOrProfileContainer(root)) {
      // For profile containers, only take useful-named children; for already-useful roots, skip expansion noise
      if (isDriveOrProfileContainer(root) && !usefulName) continue;
      out.push(v.normalized);
    }
  }
  return out;
}

function isDriveOrProfileContainer(path: string): boolean {
  const lower = resolve(path).toLowerCase().replace(/[\\/]+$/u, "");
  const home = (process.env.USERPROFILE || homedir()).toLowerCase();
  return (
    lower === "d:" ||
    lower === "d:\\" ||
    lower === `${home}\\desktop` ||
    lower === `${home}\\documents` ||
    lower === `${home}\\downloads` ||
    lower === `${home}\\onedrive` ||
    lower === `${home}\\onedrive\\documents`
  );
}

function priorityForCategory(cat: OwnerDataCategoryV1): DiscoveryPriorityV1 {
  switch (cat) {
    case "career":
    case "identity":
      return 1;
    case "business":
    case "brand":
      return 2;
    case "project":
    case "aion_docs":
      return 3;
    case "sales":
    case "customer":
      return 4;
    case "personal":
      return 5;
    case "archive":
      return 6;
    default:
      return 5;
  }
}

function workspaceFor(cat: OwnerDataCategoryV1, path: string): string {
  const base = basename(path).toLowerCase();
  if (/compassionate|kristina/i.test(path)) return "compassionate-choice";
  if (/toyota|lakeland/i.test(path)) return "dealership";
  if (/caleb|podcast|brand video/i.test(path)) return "caleb-brand";
  if (/remote job|resume|career|maritime/i.test(path)) return "career";
  if (/aion/i.test(path) || cat === "aion_docs") return "aion-project";
  switch (cat) {
    case "career":
    case "identity":
      return "career";
    case "business":
      return base.slice(0, 40) || "business";
    case "brand":
      return base.slice(0, 40) || "brand";
    case "sales":
    case "customer":
      return "sales";
    case "personal":
      return "personal";
    default:
      return "owner-import";
  }
}

function classifyRealVsSynthetic(path: string): RealVsSyntheticV1 {
  const lower = path.toLowerCase();
  if (/\\e2e\\|[/\\]e2e[/\\]|-e2e-|e2e-test|fixture|synthetic|owner-first-sources|smoke-bulk|aion-smoke/i.test(lower)) {
    if (/e2e/i.test(lower)) return "E2E_TEST_DATA";
    return "SYNTHETIC_TEST_DATA";
  }
  return "REAL_OWNER_DATA";
}

/**
 * Lightweight inventory of a root: counts supported files without full content hash.
 * Skips noise directories and secret paths. Bounded depth/file walk.
 */
export function inventoryRoot(
  root: string,
  opts: { maxDepth?: number; maxFiles?: number } = {},
): {
  fileCount: number;
  supportedCount: number;
  bytes: number;
  lastModifiedMin: string | null;
  lastModifiedMax: string | null;
  truncated: boolean;
} {
  const maxDepth = opts.maxDepth ?? 6;
  const maxFiles = opts.maxFiles ?? 800;
  let fileCount = 0;
  let supportedCount = 0;
  let bytes = 0;
  let minMs: number | null = null;
  let maxMs: number | null = null;
  let truncated = false;

  const visit = (dir: string, depth: number): void => {
    if (truncated) return;
    if (depth > maxDepth) {
      truncated = true;
      return;
    }
    if (isSecretOrProtectedPath(dir)) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (truncated) break;
      if (isNoiseDirectoryName(e.name)) continue;
      const full = join(dir, e.name);
      if (isSecretOrProtectedPath(full)) continue;
      let lst;
      try {
        lst = lstatSync(full);
      } catch {
        continue;
      }
      if (lst.isSymbolicLink()) continue;
      if (lst.isDirectory()) {
        visit(full, depth + 1);
        continue;
      }
      if (!lst.isFile()) continue;
      // Count only non-secret files toward inventory
      if (isSecretOrProtectedPath(full) || isSecretOrProtectedPath(e.name)) continue;
      fileCount += 1;
      if (fileCount >= maxFiles) truncated = true;
      const m = lst.mtimeMs;
      if (minMs === null || m < minMs) minMs = m;
      if (maxMs === null || m > maxMs) maxMs = m;
      if (isSupportedBulkExtension(e.name)) {
        supportedCount += 1;
        bytes += lst.size;
      }
      if (truncated) break;
    }
  };

  try {
    if (!existsSync(root)) {
      return { fileCount: 0, supportedCount: 0, bytes: 0, lastModifiedMin: null, lastModifiedMax: null, truncated: false };
    }
    visit(resolve(root), 0);
  } catch {
    /* empty */
  }

  return {
    fileCount,
    supportedCount,
    bytes,
    lastModifiedMin: minMs !== null ? new Date(minMs).toISOString() : null,
    lastModifiedMax: maxMs !== null ? new Date(maxMs).toISOString() : null,
    truncated,
  };
}

function buildSource(path: string, inventory = true): DiscoveredSource {
  const policy = validateImportRootCandidate(path);
  const exists = existsSync(path);
  const category = classifyOwnerDataCategory(path);
  const priority = priorityForCategory(category);
  const realVsSynthetic = classifyRealVsSynthetic(path);

  let sourceClass: SourceClassV1 = "USEFUL_OWNER_DATA";
  let reason = "Candidate Owner data root";
  if (!policy.ok) {
    sourceClass = policy.reason.toLowerCase().includes("protected") || policy.reason.toLowerCase().includes("blocked")
      ? "SECRET_EXCLUDED"
      : "SYSTEM_NOISE";
    reason = policy.reason;
  } else if (isSecretOrProtectedPath(path)) {
    sourceClass = "SECRET_EXCLUDED";
    reason = "Secret/credential path pattern";
  } else if (!exists) {
    sourceClass = "UNSUPPORTED";
    reason = "Path does not exist";
  } else if (realVsSynthetic !== "REAL_OWNER_DATA") {
    sourceClass = "REVIEW_REQUIRED";
    reason = "Synthetic/E2E path pattern — keep separate from Owner operational views";
  } else if (category === "technical") {
    sourceClass = "TECHNICAL_PROJECT_DATA";
    reason = "Technical project data (useful selectively)";
  } else if (category === "archive") {
    sourceClass = "USEFUL_OWNER_DATA";
    reason = "Archive — lower priority; process after current work";
  }

  let inv = {
    fileCount: 0,
    supportedCount: 0,
    bytes: 0,
    lastModifiedMin: null as string | null,
    lastModifiedMax: null as string | null,
    truncated: false,
  };
  if (exists && policy.ok && sourceClass !== "SECRET_EXCLUDED" && sourceClass !== "SYSTEM_NOISE" && inventory) {
    inv = inventoryRoot(path);
    if (inv.supportedCount === 0 && inv.fileCount > 0) {
      sourceClass = "UNSUPPORTED";
      reason = "No supported document types found in shallow inventory";
    } else if (inv.supportedCount === 0 && inv.fileCount === 0) {
      // empty or only noise
      sourceClass = sourceClass === "USEFUL_OWNER_DATA" ? "REVIEW_REQUIRED" : sourceClass;
      reason = inv.truncated ? "Empty or inaccessible at inventory depth" : "Empty root";
    }
  }

  // Profile container containers: don't auto-register whole Desktop — children are preferred
  if (isDriveOrProfileContainer(path) && sourceClass === "USEFUL_OWNER_DATA") {
    sourceClass = "REVIEW_REQUIRED";
    reason = "Profile/container root — prefer specific child folders; may still register if files live at top level";
  }

  return {
    path: policy.normalized || resolve(path),
    label: basename(path) || path,
    category,
    priority,
    sourceClass,
    realVsSynthetic,
    workspaceCandidate: workspaceFor(category, path),
    estimatedFileCount: inv.fileCount,
    estimatedSupportedFileCount: inv.supportedCount,
    estimatedBytes: inv.bytes,
    lastModifiedMin: inv.lastModifiedMin,
    lastModifiedMax: inv.lastModifiedMax,
    importStatus: "discovered",
    reason,
    exists,
    policyOk: policy.ok,
    policyReason: policy.reason,
  };
}

/**
 * Full discovery + inventory pass. Safe metadata only; no content ingestion.
 */
export function discoverOwnerDataSources(opts: {
  seeds?: string[];
  expandChildren?: boolean;
  inventory?: boolean;
  now?: string;
} = {}): OwnerDataInventoryV1 {
  const now = opts.now ?? new Date().toISOString();
  const seeds = opts.seeds ?? candidateSeedRoots();
  const expand = opts.expandChildren !== false;
  const doInv = opts.inventory !== false;

  const pathSet = new Set<string>();
  const ordered: string[] = [];
  const add = (p: string) => {
    const k = resolve(p).toLowerCase();
    if (pathSet.has(k)) return;
    pathSet.add(k);
    ordered.push(resolve(p));
  };

  for (const s of seeds) add(s);
  if (expand) {
    for (const s of [...seeds]) {
      if (isDriveOrProfileContainer(s) || /desktop|documents|downloads|onedrive/i.test(s)) {
        for (const child of expandLikelyOwnerChildren(s)) add(child);
      }
    }
    // Also expand D:\ one level for Owner-looking folders if drive exists
    if (existsSync("D:\\")) {
      for (const child of expandLikelyOwnerChildren("D:\\", 30)) add(child);
    }
  }

  const sources = ordered.map((p) => buildSource(p, doInv));
  // Prefer specific folders: drop container-only REVIEW_REQUIRED with zero supported files when children cover them
  const useful = sources
    .filter((s) => {
      if (!s.exists || !s.policyOk) return false;
      if (s.sourceClass === "SECRET_EXCLUDED" || s.sourceClass === "SYSTEM_NOISE") return false;
      if (s.realVsSynthetic !== "REAL_OWNER_DATA") return false;
      if (s.estimatedSupportedFileCount > 0) return true;
      // Allow small career folders that might only have md at top
      if (s.priority <= 2 && s.exists && s.policyOk) return true;
      return false;
    })
    .sort((a, b) => a.priority - b.priority || b.estimatedSupportedFileCount - a.estimatedSupportedFileCount);

  const excluded = sources.filter((s) => !useful.includes(s));

  const hardExclusionsHonored = [
    "nearm/all-projects-API (absolute)",
    "credential/password/ssh/wallet stores",
    "Windows/Program Files/system noise",
    "node_modules/.git/venv/caches",
  ];

  const totals = {
    sources: sources.length,
    useful: useful.length,
    estimatedSupportedFiles: useful.reduce((n, s) => n + s.estimatedSupportedFileCount, 0),
    estimatedBytes: useful.reduce((n, s) => n + s.estimatedBytes, 0),
  };

  const reply = [
    "OWNER DATA DISCOVERY INVENTORY",
    `(Owner-authorized broad discovery — not per-folder manual pick)`,
    `Discovered at: ${now}`,
    "",
    "HARD EXCLUSIONS HONORED",
    ...hardExclusionsHonored.map((h) => `  • ${h}`),
    "",
    `USEFUL SOURCES (${useful.length}) — priority order`,
    ...useful.slice(0, 40).map(
      (s) =>
        `  P${s.priority} [${s.category}] ${s.label} · supported≈${s.estimatedSupportedFileCount}/${s.estimatedFileCount} · ${(s.estimatedBytes / 1024).toFixed(0)} KB · ${s.workspaceCandidate} · ${s.path}`,
    ),
    useful.length > 40 ? `  … +${useful.length - 40} more` : "",
    "",
    `EXCLUDED / DEFERRED (${excluded.length})`,
    ...excluded
      .filter((s) => s.sourceClass === "SECRET_EXCLUDED" || !s.policyOk)
      .slice(0, 15)
      .map((s) => `  • [${s.sourceClass}] ${s.path} — ${s.reason}`),
    "",
    "TOTALS",
    `  Candidates scanned: ${totals.sources}`,
    `  Useful for ingest: ${totals.useful}`,
    `  Est. supported files: ${totals.estimatedSupportedFiles}`,
    `  Est. supported bytes: ${(totals.estimatedBytes / (1024 * 1024)).toFixed(1)} MB`,
    "",
    `Supported extensions: ${BULK_SUPPORTED_EXTENSIONS.join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    discoveredAt: now,
    rootsScanned: ordered,
    sources,
    useful,
    excluded,
    totals,
    hardExclusionsHonored,
    reply,
  };
}

/** Prefer text-heavy knowledge roots; defer pure media/render output. */
function isLowValueMediaRoot(path: string): boolean {
  const lower = path.toLowerCase();
  return /out_clips|out_audiogram|out_long|screen recordings?|captures|videos?$|\.mkv|recordings$/i.test(lower);
}

/** Roots ready for auto-register under Owner broad authorization. */
export function rootsForAutoRegister(inventory: OwnerDataInventoryV1, maxRoots = 24): string[] {
  return inventory.useful
    .filter((s) => s.policyOk && s.exists && s.realVsSynthetic === "REAL_OWNER_DATA")
    .filter((s) => !isDriveOrProfileContainer(s.path) || s.estimatedSupportedFileCount > 0)
    .filter((s) => !isLowValueMediaRoot(s.path))
    // Prefer non-container specific folders
    .filter((s) => {
      const lower = s.path.toLowerCase();
      const home = (process.env.USERPROFILE || "").toLowerCase();
      // Downloads often noisy installers — only high priority
      if (lower === `${home}\\downloads`) return s.priority <= 2;
      // Huge archives after current work
      if (s.priority >= 6 && s.estimatedBytes > 50 * 1024 * 1024) return false;
      return true;
    })
    .slice(0, maxRoots)
    .map((s) => s.path);
}

export function formatDiscoveryMorningSlice(inventory: OwnerDataInventoryV1): Record<string, unknown> {
  return {
    OWNER_DATA_DISCOVERY: inventory.useful.length > 0 ? "PASS" : inventory.sources.some((s) => s.exists) ? "PARTIAL" : "FAIL",
    SAFE_DATA_ROOTS_DISCOVERED: inventory.useful.length,
    ROOTS_REGISTERED: 0,
    ROOTS_PROCESSED: 0,
    REAL_FILES_DISCOVERED: inventory.totals.estimatedSupportedFiles,
    categories: inventory.useful.reduce(
      (acc, s) => {
        acc[s.category] = (acc[s.category] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
  };
}
