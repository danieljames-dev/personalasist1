/**
 * Path policy for Owner-approved import roots.
 * Reject whole drives, protected trees, system/credential locations.
 * Never traverse C:\Users\nearm\all-projects-API.
 */
import { resolve, normalize } from "node:path";

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
];

export function normalizeImportRoot(path: string): string {
  return resolve(String(path ?? "").trim()).replace(/[\\/]+$/u, "");
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
        reason: "Protected exclusion: C:\\Users\\nearm\\all-projects-API must never be imported.",
      };
    }
  }
  for (const bad of BLOCKED_SUBSTRINGS) {
    if (lower.includes(bad)) {
      return { ok: false, normalized, reason: `Blocked sensitive/system path pattern: ${bad}` };
    }
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

export function ownerOperationalWorkspaces<T extends { id: string; label: string; archived?: boolean; purpose?: string }>(
  workspaces: readonly T[],
  opts: { includeArchived?: boolean } = {},
): T[] {
  return workspaces.filter((w) => {
    if (!opts.includeArchived && w.archived) return false;
    return !isTestOrE2eWorkspace(w);
  });
}
