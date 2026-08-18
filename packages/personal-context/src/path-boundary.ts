/**
 * The only way a file becomes readable: it is inside an approved root, and the filesystem agrees.
 *
 * Two separate checks, because either one alone has a known hole. The string check refuses shapes
 * that never name a legitimate entry inside a root — `..`, an absolute path, an NTFS alternate data
 * stream, a reserved device name, a generated 8.3 alias. The filesystem check resolves both the root
 * and the candidate through `realpath` and asks whether the *resolved* candidate is still under the
 * *resolved* root, which is the only thing that catches a symlink, a junction, a reparse point or a
 * `subst` alias — none of which any amount of string analysis can see.
 *
 * `@aion/director`'s `isResolvedHostPath` is reused rather than re-derived for the "does this name
 * one fixed place on this host" question. That predicate is hardened against a specific catalogue of
 * Windows aliasing defects (8.3 short names, `NUL:`, `::$INDEX_ALLOCATION`, trailing dots), and a
 * second implementation here would drift from it. What this module adds is the part that predicate
 * explicitly does not do: consult the filesystem.
 *
 * Every refusal is a value, never an exception, and every refusal names its reason — a boundary that
 * fails silently is a boundary a caller learns to ignore.
 */

import { isResolvedHostPath } from "@aion/director";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { ContextSourceV1 } from "./contracts.js";

export type PathDenialReasonV1 =
  | "ROOT_NOT_IDENTIFIABLE"
  | "ROOT_UNRESOLVABLE"
  | "EMPTY_ENTRY"
  | "CONTROL_BYTES"
  | "ABSOLUTE_ENTRY"
  | "TRAVERSAL_ESCAPE"
  | "RESOLVED_OUTSIDE_ROOT"
  | "SYMLINK_NOT_ALLOWED"
  | "UNSAFE_PATH_SHAPE"
  | "ENTRY_UNRESOLVABLE"
  | "DEPTH_EXCEEDED"
  | "RECURSION_NOT_ALLOWED"
  | "DENIED_SCOPE"
  | "OUTSIDE_ALLOWED_SCOPE"
  | "MAX_BYTES_EXCEEDED";

export interface PathGrantV1 {
  readonly allowed: true;
  /** The real path on disk, after every link in the chain has been followed. */
  readonly resolvedPath: string;
  /** Posix-separated, root-relative — the spelling used in provenance so receipts stay portable. */
  readonly relativePath: string;
  readonly wasSymbolicLink: boolean;
}

export interface PathDenialV1 {
  readonly allowed: false;
  readonly reason: PathDenialReasonV1;
  /** Enough to debug, never the full host path of something outside the approved root. */
  readonly detail: string;
}

export type PathDecisionV1 = PathGrantV1 | PathDenialV1;

export interface FileStatV1 {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
  readonly size: number;
  readonly mtimeMs: number;
}

/**
 * The filesystem operations this package is allowed to perform. Reading and describing, nothing else.
 *
 * There is no `writeFileSync`, no `unlinkSync` and no `renameSync` here on purpose: a source adapter
 * that cannot express a write cannot accidentally perform one against the Owner's own files.
 */
export interface PersonalContextFsV1 {
  realpathSync(path: string): string;
  lstatSync(path: string): FileStatV1;
  readdirSync(path: string): readonly string[];
  readFileSync(path: string): string;
}

const CONTROL_BYTES = /[\u0000-\u001f\u007f]/;

function denial(reason: PathDenialReasonV1, detail: string): PathDenialV1 {
  return { allowed: false, reason, detail };
}

/** Posix spelling, lower-cased, for scope comparison on a case-insensitive filesystem. */
export function toComparableRelative(value: string): string {
  return value.split(/[\\/]+/).filter((part) => part !== "").join("/").toLowerCase();
}

/** Whether `relativePath` is at or under one of `prefixes`. An empty prefix list matches everything. */
export function matchesScope(relativePath: string, prefixes: readonly string[]): boolean {
  if (prefixes.length === 0) return true;
  const target = toComparableRelative(relativePath);
  return prefixes.some((prefix) => {
    const normalized = toComparableRelative(prefix);
    if (normalized === "") return true;
    return target === normalized || target.startsWith(`${normalized}/`);
  });
}

/**
 * String-level refusal of entry spellings that never legitimately name something inside a root.
 *
 * Runs before anything touches the disk, so a hostile spelling never becomes a filesystem call.
 */
export function inspectRelativeEntry(entry: string): PathDenialV1 | null {
  if (typeof entry !== "string" || entry.trim() === "") return denial("EMPTY_ENTRY", "entry is empty");
  if (CONTROL_BYTES.test(entry)) return denial("CONTROL_BYTES", "entry contains control bytes");
  if (isAbsolute(entry)) return denial("ABSOLUTE_ENTRY", "entry is absolute");
  // A drive-relative spelling (`c:sub`) and a rooted-driveless one (`\sub`) are anchored to invisible
  // process state, so they are not relative to this root even though they look like it.
  if (/^[A-Za-z]:/.test(entry)) return denial("ABSOLUTE_ENTRY", "entry is drive-anchored");
  if (/^[\\/]/.test(entry)) return denial("ABSOLUTE_ENTRY", "entry is rooted");
  const parts = entry.split(/[\\/]+/).filter((part) => part !== "" && part !== ".");
  if (parts.length === 0) return denial("EMPTY_ENTRY", "entry names nothing");
  if (parts.includes("..")) return denial("TRAVERSAL_ESCAPE", "entry contains a parent step");
  return null;
}

/** How many levels below the root an entry sits. A file directly in the root is `1`. */
export function entryDepth(relativePath: string): number {
  return toComparableRelative(relativePath).split("/").filter((part) => part !== "").length;
}

/**
 * Resolve one entry inside one source, or refuse and say why.
 *
 * The order matters. String shape first (cheap, and keeps hostile spellings away from the disk),
 * then scope, then depth, then the filesystem. The filesystem step is last because it is the only
 * one that can be defeated by something the caller controls — a link created between the check and
 * the read — and doing it immediately before the read narrows that window as far as this design can.
 */
export function resolveWithinSource(
  source: ContextSourceV1,
  entry: string,
  fs: PersonalContextFsV1,
): PathDecisionV1 {
  if (!isResolvedHostPath(source.location)) {
    return denial("ROOT_NOT_IDENTIFIABLE", "source location does not name one fixed place on this host");
  }

  const shapeProblem = inspectRelativeEntry(entry);
  if (shapeProblem !== null) return shapeProblem;

  const relativePath = toComparableRelative(entry);
  if (matchesScope(relativePath, source.deniedScope) && source.deniedScope.length > 0) {
    return denial("DENIED_SCOPE", `entry is inside a denied scope: ${relativePath}`);
  }
  if (!matchesScope(relativePath, source.allowedScope)) {
    return denial("OUTSIDE_ALLOWED_SCOPE", `entry is outside the approved scope: ${relativePath}`);
  }

  const depth = entryDepth(relativePath);
  if (!source.recursiveAllowed && depth > 1) {
    return denial("RECURSION_NOT_ALLOWED", `source does not permit recursion (depth ${depth})`);
  }
  if (depth > source.maxDepth) {
    return denial("DEPTH_EXCEEDED", `entry depth ${depth} exceeds maxDepth ${source.maxDepth}`);
  }

  let realRoot: string;
  try {
    realRoot = fs.realpathSync(source.location);
  } catch {
    return denial("ROOT_UNRESOLVABLE", "source location cannot be resolved on this host");
  }
  if (!isResolvedHostPath(realRoot)) {
    return denial("ROOT_NOT_IDENTIFIABLE", "resolved source location does not name one fixed place");
  }

  const candidate = join(realRoot, ...relativePath.split("/"));

  let wasSymbolicLink = false;
  try {
    wasSymbolicLink = fs.lstatSync(candidate).isSymbolicLink();
  } catch {
    return denial("ENTRY_UNRESOLVABLE", `entry does not exist: ${relativePath}`);
  }
  if (wasSymbolicLink && !source.followSymlinksAllowed) {
    return denial("SYMLINK_NOT_ALLOWED", `entry is a link and this source does not follow links: ${relativePath}`);
  }

  let resolvedPath: string;
  try {
    resolvedPath = fs.realpathSync(candidate);
  } catch {
    return denial("ENTRY_UNRESOLVABLE", `entry cannot be resolved: ${relativePath}`);
  }
  if (!isResolvedHostPath(resolvedPath)) {
    return denial("UNSAFE_PATH_SHAPE", `resolved entry is not a usable host path: ${relativePath}`);
  }

  // The containment question, asked of the resolved pair. This is the step a symlink, junction or
  // reparse point cannot survive: the link may live inside the root, but its target does not.
  const inside = relative(resolve(realRoot), resolve(resolvedPath));
  if (inside !== "" && (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))) {
    return denial("RESOLVED_OUTSIDE_ROOT", `entry resolves outside the approved root: ${relativePath}`);
  }

  return { allowed: true, resolvedPath, relativePath, wasSymbolicLink };
}

export interface ApprovedFileV1 {
  readonly relativePath: string;
  readonly resolvedPath: string;
  readonly size: number;
  readonly mtimeMs: number;
}

export interface EnumerationV1 {
  readonly files: readonly ApprovedFileV1[];
  readonly denials: readonly (PathDenialV1 & { readonly entry: string })[];
  /** Set when a bound stopped the walk before it finished, so a receipt can say so out loud. */
  readonly truncatedBy: "MAX_FILES" | "MAX_BYTES" | null;
  readonly directoriesVisited: number;
}

/**
 * Walk an approved root, breadth-first, refusing everything the boundary refuses.
 *
 * Bounded three ways — depth, file count, byte count — because "read the approved folder" with no
 * ceiling is one accidental symlink-to-`C:\` away from being the scan-everything system this
 * milestone exists to avoid. When a bound stops the walk, the caller is told which one, so a partial
 * read is never reported as a complete one.
 */
export function enumerateApprovedFiles(source: ContextSourceV1, fs: PersonalContextFsV1): EnumerationV1 {
  const files: ApprovedFileV1[] = [];
  const denials: (PathDenialV1 & { entry: string })[] = [];
  let truncatedBy: "MAX_FILES" | "MAX_BYTES" | null = null;
  let bytes = 0;
  let directoriesVisited = 0;

  if (!isResolvedHostPath(source.location)) {
    return {
      files,
      denials: [{ ...denial("ROOT_NOT_IDENTIFIABLE", "source location is not identifiable"), entry: "" }],
      truncatedBy: null,
      directoriesVisited: 0,
    };
  }

  let realRoot: string;
  try {
    realRoot = fs.realpathSync(source.location);
  } catch {
    return {
      files,
      denials: [{ ...denial("ROOT_UNRESOLVABLE", "source location cannot be resolved"), entry: "" }],
      truncatedBy: null,
      directoriesVisited: 0,
    };
  }

  let rootIsFile = false;
  try {
    rootIsFile = fs.lstatSync(realRoot).isFile();
  } catch {
    return {
      files,
      denials: [{ ...denial("ROOT_UNRESOLVABLE", "source location cannot be described"), entry: "" }],
      truncatedBy: null,
      directoriesVisited: 0,
    };
  }

  // A single-file source is its own root. The boundary work is identical; there is just nothing to walk.
  if (rootIsFile) {
    let stat: FileStatV1;
    try {
      stat = fs.lstatSync(realRoot);
    } catch {
      return { files, denials, truncatedBy: null, directoriesVisited: 0 };
    }
    files.push({ relativePath: ".", resolvedPath: realRoot, size: stat.size, mtimeMs: stat.mtimeMs });
    return { files, denials, truncatedBy: null, directoriesVisited: 0 };
  }

  const queue: string[] = [""];
  while (queue.length > 0) {
    const dirRelative = queue.shift() ?? "";
    const dirAbsolute = dirRelative === "" ? realRoot : join(realRoot, ...dirRelative.split("/"));
    directoriesVisited += 1;

    let entries: readonly string[];
    try {
      entries = fs.readdirSync(dirAbsolute);
    } catch {
      denials.push({ ...denial("ENTRY_UNRESOLVABLE", "directory cannot be listed"), entry: dirRelative });
      continue;
    }

    for (const name of [...entries].sort()) {
      if (truncatedBy !== null) break;
      const childRelative = dirRelative === "" ? name : `${dirRelative}/${name}`;
      const decision = resolveWithinSource(source, childRelative, fs);
      if (!decision.allowed) {
        // Depth and recursion ceilings are the walk doing its job, not an attack; they are still
        // recorded, because a receipt that omits what it declined to read overstates its coverage.
        denials.push({ ...decision, entry: childRelative });
        continue;
      }

      let stat: FileStatV1;
      try {
        stat = fs.lstatSync(decision.resolvedPath);
      } catch {
        denials.push({ ...denial("ENTRY_UNRESOLVABLE", "entry cannot be described"), entry: childRelative });
        continue;
      }

      if (stat.isDirectory()) {
        if (source.recursiveAllowed && entryDepth(childRelative) < source.maxDepth) {
          queue.push(decision.relativePath);
        }
        continue;
      }
      if (!stat.isFile()) continue;

      if (files.length >= source.maxFiles) {
        truncatedBy = "MAX_FILES";
        break;
      }
      if (bytes + stat.size > source.maxBytes) {
        truncatedBy = "MAX_BYTES";
        break;
      }
      bytes += stat.size;
      files.push({
        relativePath: decision.relativePath,
        resolvedPath: decision.resolvedPath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }
    if (truncatedBy !== null) break;
  }

  return { files, denials, truncatedBy, directoriesVisited };
}
