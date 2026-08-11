/**
 * Path policy for Owner-approved import roots.
 * Reject whole drives, protected trees, system/credential locations.
 * Never traverse the absolute Owner exclusion tree (nearm all-projects-API).
 *
 * Owner broad-data authorization still honors these hard exclusions.
 */
import { resolve } from "node:path";

const ABSOLUTE_EXCLUSIONS = [
  "c:\\users\\nearm\\all-projects-api",
];

const BLOCKED_SUBSTRINGS = [
  "\\credential",
  "\\credentials",
  "\\password",
  "\\passwords",
  "\\secrets",
  "\\.ssh",
  "\\appdata\\local\\google\\chrome\\user data",
  "\\appdata\\local\\microsoft\\edge\\user data",
  "\\appdata\\roaming\\mozilla\\firefox",
  "\\windows\\system32",
  "\\program files",
  "\\program files (x86)",
  "\\$recycle.bin",
  "\\system volume information",
  "\\node_modules\\",
  "\\.git\\objects",
  "\\programdata\\microsoft\\",
  "\\appdata\\local\\temp",
  "\\appdata\\local\\npm-cache",
  "\\appdata\\local\\yarn",
  "\\appdata\\roaming\\npm",
];

/** Directory basenames to skip during walks/inventory (system/noise). */
const NOISE_DIR_NAMES = new Set(
  [
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    "__pycache__",
    ".venv",
    "venv",
    "env",
    ".env",
    "dist",
    "build",
    "out",
    "target",
    ".next",
    ".nuxt",
    ".turbo",
    ".cache",
    "coverage",
    ".pytest_cache",
    ".mypy_cache",
    ".tox",
    "bower_components",
    "vendor",
    "$recycle.bin",
    "system volume information",
    "windows",
    "program files",
    "program files (x86)",
    "programdata",
    "appdata",
    "docker",
    ".docker",
    "iOS DeviceSupport",
    "Library", // mac-style noise if present
  ].map((s) => s.toLowerCase()),
);

/** Path/filename patterns treated as secret/protected (never ingest content). */
const SECRET_PATH_RES: RegExp[] = [
  /(^|[\\/])\.env(\.|$|rc|[\\/])/i,
  /(^|[\\/])\.ssh([\\/]|$)/i,
  /(^|[\\/])credentials?([\\/.]|$)/i,
  /(^|[\\/])secrets?([\\/.]|$)/i,
  /(^|[\\/])password/i,
  /\.pem$/i,
  /\.ppk$/i,
  /\.key$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /wallet/i,
  /bitkey/i,
  /seed.?phrase/i,
  /private.?key/i,
  /oauth.?token/i,
  /api.?keys?/i,
  /\.aionbak$/i,
];

export type OwnerDataCategoryV1 =
  | "career"
  | "identity"
  | "business"
  | "brand"
  | "project"
  | "sales"
  | "customer"
  | "personal"
  | "aion_docs"
  | "archive"
  | "technical"
  | "other";

export function normalizeImportRoot(path: string): string {
  return resolve(String(path ?? "").trim()).replace(/[\\/]+$/u, "");
}

export function isNoiseDirectoryName(name: string): boolean {
  const n = String(name ?? "").trim().toLowerCase();
  if (!n) return true;
  if (NOISE_DIR_NAMES.has(n)) return true;
  if (n === "node_modules" || n.endsWith(".egg-info")) return true;
  if (n.startsWith(".") && ["git", "svn", "hg", "cache", "venv", "tox", "mypy_cache", "pytest_cache", "next", "nuxt", "turbo", "docker"].includes(n.slice(1))) {
    return true;
  }
  return false;
}

/**
 * Credential / secret / absolute-exclusion paths — never inventory or ingest content.
 * Intentionally does NOT treat ordinary AppData caches/temp as "secret" so test temp
 * dirs and non-credential files remain walkable; OS/noise is handled separately.
 */
export function isSecretOrProtectedPath(path: string): boolean {
  const p = String(path ?? "");
  const lower = p.toLowerCase();
  if (lower.includes("\\users\\nearm\\all-projects-api") || lower.includes("/users/nearm/all-projects-api")) {
    return true;
  }
  for (const re of SECRET_PATH_RES) {
    if (re.test(p)) return true;
  }
  // Credential store substrings only (not full system BLOCKED list)
  const credentialOnly = [
    "\\credential",
    "\\credentials",
    "\\password",
    "\\passwords",
    "\\secrets",
    "\\.ssh",
    "\\appdata\\local\\google\\chrome\\user data",
    "\\appdata\\local\\microsoft\\edge\\user data",
    "\\appdata\\roaming\\mozilla\\firefox",
  ];
  for (const bad of credentialOnly) {
    if (lower.includes(bad)) return true;
  }
  return false;
}

export function classifyOwnerDataCategory(path: string): OwnerDataCategoryV1 {
  const blob = String(path ?? "").toLowerCase();
  if (/resume|career|employment|job.?kit|cover.?letter|maritime|cv\b|work.?history/i.test(blob)) return "career";
  if (/identity|profile|about.?me/i.test(blob)) return "identity";
  if (/toyota|lakeland|dealership|sales.?floor|crm.?export|customer|prospect/i.test(blob)) {
    if (/customer|prospect|crm/i.test(blob)) return "customer";
    return "sales";
  }
  if (/compassionate|kristina.?business|llc|grant|brand|marketing|content/i.test(blob)) {
    if (/brand|podcast|video engine|crosspost/i.test(blob)) return "brand";
    return "business";
  }
  if (/aion|handoff|runway/i.test(blob)) return "aion_docs";
  if (/archive|backup|offload|recovery|old.?project/i.test(blob)) return "archive";
  if (/node_modules|\.git|program files|windows\\/i.test(blob)) return "technical";
  if (/project|training|claude|grok|antigravity|plan/i.test(blob)) return "project";
  if (/personal|notes|goals|preferences|trading.?checklist/i.test(blob)) return "personal";
  return "other";
}

export function validateImportRootCandidate(path: string): {
  ok: boolean;
  normalized: string;
  reason: string;
} {
  const raw = String(path ?? "").trim();
  if (!raw) return { ok: false, normalized: "", reason: "Empty path." };
  let normalized: string;
  try {
    normalized = normalizeImportRoot(raw);
  } catch {
    return { ok: false, normalized: "", reason: "Path cannot be resolved." };
  }
  const lower = normalized.toLowerCase();
  // Whole drive
  if (/^[a-z]:$/i.test(normalized) || /^[a-z]:\\?$/i.test(raw)) {
    return { ok: false, normalized, reason: "Whole-drive roots are not allowed." };
  }
  if (normalized === "/" || /^\\\\[^\\]+\\?$/.test(normalized)) {
    return { ok: false, normalized, reason: "UNC server roots / whole share roots not allowed." };
  }
  for (const ex of ABSOLUTE_EXCLUSIONS) {
    if (lower === ex || lower.startsWith(ex + "\\")) {
      return {
        ok: false,
        normalized,
        reason: "Protected exclusion: nearm/all-projects-API must never be imported.",
      };
    }
  }
  if (isSecretOrProtectedPath(normalized)) {
    return { ok: false, normalized, reason: "Blocked sensitive/credential/secret path." };
  }
  for (const bad of BLOCKED_SUBSTRINGS) {
    if (lower.includes(bad)) {
      return { ok: false, normalized, reason: `Blocked sensitive/system path pattern: ${bad}` };
    }
  }
  // Refuse pure OS roots
  if (
    lower === "c:\\windows" ||
    lower.startsWith("c:\\windows\\") ||
    lower === "c:\\program files" ||
    lower.startsWith("c:\\program files\\") ||
    lower === "c:\\program files (x86)" ||
    lower.startsWith("c:\\program files (x86)\\")
  ) {
    return { ok: false, normalized, reason: "Operating system / Program Files trees are not import roots." };
  }
  return { ok: true, normalized, reason: "ok" };
}

/** Owner-operational vs test/e2e workspace classification (label/id heuristics + optional flag). */
export function isTestOrE2eWorkspace(input: {
  id: string;
  label: string;
  kind?: string;
  purpose?: string;
}): boolean {
  const blob = `${input.id} ${input.label} ${input.purpose ?? ""}`.toLowerCase();
  return (
    /\be2e\b/.test(blob) ||
    /\btest business\b/.test(blob) ||
    /\baion v1\.2 test\b/.test(blob) ||
    /^e2e-/.test(input.id) ||
    /-e2e-/.test(input.id) ||
    /\bsynthetic\b/.test(blob) ||
    /\bfixture\b/.test(blob)
  );
}

/**
 * Synthetic / fixture people, orgs, and free-text that must not surface in Owner operational views.
 * Conservative: only strong test markers — never hide ambiguous real names solely for being common.
 */
export function isSyntheticOwnerFacingText(...parts: Array<string | null | undefined>): boolean {
  const blob = parts.map((p) => String(p ?? "")).join(" ").toLowerCase();
  if (!blob.trim()) return false;
  return (
    /\be2e\b/.test(blob) ||
    /\bsynthetic\b/.test(blob) ||
    /\bfixture\b/.test(blob) ||
    /\bsmoke\b/.test(blob) ||
    /\btest company\b/.test(blob) ||
    /\bcsv e2e\b/.test(blob) ||
    /\bjane test\b/.test(blob) ||
    /\bacme r7\b/.test(blob) ||
    /\bfirst source contact\b/.test(blob) ||
    /\brunway first-source\b/.test(blob) ||
    /\baion-smoke\b/.test(blob) ||
    /\bexample\.test\b/.test(blob) ||
    /\btest (customer|contact|lead|prospect|person)\b/.test(blob)
  );
}

export function isSyntheticRelationship(r: {
  id?: string;
  displayName?: string;
  notes?: string;
  tags?: readonly string[];
  company?: string;
  email?: string;
  organisation?: string;
  source?: string;
}): boolean {
  if (
    isSyntheticOwnerFacingText(
      r.id,
      r.displayName,
      r.notes,
      r.company,
      r.organisation,
      r.email,
      r.source,
      ...(r.tags ?? []),
    )
  ) {
    return true;
  }
  // Known executive-OS / daily-scenario fixture capture text (not real Owner CRM)
  const notes = String(r.notes ?? "").toLowerCase();
  if (
    /limited tacoma under\s*50,?000/.test(notes) ||
    /likes the limited tacoma under/.test(notes) ||
    /i just talked to mike\. he likes the limited/.test(notes)
  ) {
    return true;
  }
  return false;
}

/** Demo commitments seeded with scenario first names (Riley/Jordan + Tacoma/Highlander demo). */
export function isSyntheticCommitment(c: {
  committedBy?: string;
  committedTo?: string;
  statement?: string;
  workspace?: string;
}): boolean {
  if (isSyntheticOwnerFacingText(c.committedBy, c.committedTo, c.statement, c.workspace)) return true;
  const to = String(c.committedTo ?? "").toLowerCase();
  const st = String(c.statement ?? "").toLowerCase();
  if ((to === "riley" || to === "jordan") && /highlander|tacoma/.test(st)) return true;
  if (!String(c.statement ?? "").trim() && !String(c.committedTo ?? "").trim()) return true;
  return false;
}

/** Low-value technical import content mis-tagged as career/employment knowledge. */
export function isTechnicalNoiseKnowledgeFact(input: {
  title?: string;
  content?: string;
  category?: string;
  sourceRef?: string;
}): boolean {
  const blob = `${input.title ?? ""} ${input.content ?? ""} ${input.sourceRef ?? ""}`.toLowerCase();
  if (/mozilla\/\d|applewebkit|user-agent|text\/html|<!doctype/i.test(blob)) return true;
  if (/\b(threat model|architecture proposal|specification\.md|adr-\d|sprint \d|phase \d)\b/i.test(blob)) return true;
  if (/\b(r6\.|r7\.|control plane|object model|deterministic parsing)\b/i.test(blob)) return true;
  if (/manifest\.csv|path,name,ext,size_kb/i.test(blob)) return true;
  // Pure code/doc paths as "employment" from AION repo docs
  if (
    (input.category === "employment" || input.category === "skill") &&
    /\b(career-evidence|career-data|career-input|local-identity-bootstrap|handoff|runway)\b/i.test(blob) &&
    !/\b(merchant|seafarer|army|bosun|able seaman|resume|cover letter)\b/i.test(blob)
  ) {
    return true;
  }
  return false;
}

export function ownerOperationalWorkspaces<T extends { id: string; label: string; archived?: boolean; purpose?: string }>(
  workspaces: readonly T[],
  opts: { includeArchived?: boolean } = {},
): T[] {
  return workspaces.filter((w) => {
    if (!opts.includeArchived && w.archived) return false;
    return !isTestOrE2eWorkspace(w);
  });
}
