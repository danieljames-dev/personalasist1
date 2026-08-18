/**
 * Which repository, at which commit — read from the checkout, never guessed and never executed.
 *
 * A fact derived from a repository is worthless as evidence unless you can say *which* repository and
 * *when*. "Skill: Rust, source: some folder" ages into a claim nobody can check; "Skill: Rust,
 * repository `origin/foo`, commit `abc1234`, observed 2026-08-18" can be re-verified years later.
 *
 * ## Read, not run
 *
 * There is no `git` subprocess here. This package's filesystem surface is read-only by construction
 * (`PersonalContextFsV1` has no exec and no write), and adding process execution so a source adapter
 * could shell out would hand every future adapter the same capability. So identity comes from the
 * files Git already maintains: `.git/HEAD`, the loose ref it names, `.git/packed-refs` when the ref
 * has been packed, and the `url` in `.git/config`.
 *
 * The cost is honest and bounded: a few shapes are not resolvable this way — a `.git` *file*
 * (worktree or submodule pointing elsewhere), a symbolic HEAD through an unusual ref layout. Each
 * returns `null` with a reason rather than a plausible-looking commit. A null commit is a gap;
 * a wrong commit is a lie that survives review.
 *
 * ## Why this bypasses `deniedScope`
 *
 * `.git` is excluded from the content walk by default, because object files are not career evidence
 * and walking them burns the file ceiling. This module reads three specific paths inside it anyway,
 * deliberately: they describe the source rather than being source content. Containment is still
 * enforced — every read resolves through `realpath` and must land inside the approved root — so the
 * exemption is "these three metadata files", not "this directory is unbounded".
 */

import { isResolvedHostPath } from "@aion/director";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { ContextSourceV1 } from "./contracts.js";
import type { PersonalContextFsV1 } from "./path-boundary.js";

export interface RepositoryIdentityV1 {
  /** The commit HEAD resolves to, or `null` when it cannot be read honestly. */
  readonly head: string | null;
  /** The remote URL recorded in the checkout, or `null`. */
  readonly remote: string | null;
  /** Why the answer is what it is, so a `null` is diagnosable rather than mysterious. */
  readonly detail: string;
}

const NOT_A_REPOSITORY: RepositoryIdentityV1 = {
  head: null,
  remote: null,
  detail: "No .git directory was found inside the approved root; this source is not a Git checkout.",
};

const OBJECT_ID = /^[0-9a-f]{40}$/;

/**
 * Read one metadata file inside the approved root, or `null`.
 *
 * Containment is re-derived here rather than borrowed from `resolveWithinSource`, because that
 * function deliberately enforces `deniedScope` and this read is the one documented exemption. The
 * *boundary* half of the check is identical and is not relaxed.
 */
function readInsideRoot(realRoot: string, relativePath: string, fs: PersonalContextFsV1): string | null {
  const candidate = join(realRoot, ...relativePath.split("/"));
  let resolved: string;
  try {
    resolved = fs.realpathSync(candidate);
  } catch {
    return null;
  }
  if (!isResolvedHostPath(resolved)) return null;
  const inside = relative(resolve(realRoot), resolve(resolved));
  if (inside !== "" && (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))) return null;
  try {
    return fs.readFileSync(resolved);
  } catch {
    return null;
  }
}

/** The `url` of `[remote "origin"]`, or the first url in the file. Parsed, not regexed blindly. */
export function parseRemoteUrl(config: string): string | null {
  let section = "";
  let firstUrl: string | null = null;
  for (const rawLine of config.split(/\r?\n/)) {
    const line = rawLine.trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header !== null) {
      section = (header[1] ?? "").trim();
      continue;
    }
    const url = /^url\s*=\s*(.+)$/.exec(line);
    if (url === null) continue;
    const value = (url[1] ?? "").trim();
    if (value === "") continue;
    if (firstUrl === null) firstUrl = value;
    if (/^remote\s+"origin"$/.test(section)) return value;
  }
  return firstUrl;
}

/** Find one ref in a `packed-refs` file. */
export function parsePackedRef(packed: string, ref: string): string | null {
  for (const rawLine of packed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("^")) continue;
    const match = /^([0-9a-f]{40})\s+(.+)$/.exec(line);
    if (match === null) continue;
    if ((match[2] ?? "").trim() === ref) return match[1] ?? null;
  }
  return null;
}

/**
 * Describe the repository an approved root is a checkout of.
 *
 * Never throws. Every unreadable shape becomes a `null` with a reason, because a sync must not fail
 * because a repository is laid out unusually — it must record less.
 */
export function readRepositoryIdentity(source: ContextSourceV1, fs: PersonalContextFsV1): RepositoryIdentityV1 {
  if (!isResolvedHostPath(source.location)) {
    return { head: null, remote: null, detail: "The source location does not name one fixed place on this host." };
  }
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(source.location);
  } catch {
    return { head: null, remote: null, detail: "The source location could not be resolved." };
  }

  let gitIsDirectory: boolean;
  try {
    gitIsDirectory = fs.lstatSync(join(realRoot, ".git")).isDirectory();
  } catch {
    return NOT_A_REPOSITORY;
  }
  if (!gitIsDirectory) {
    return {
      head: null,
      remote: null,
      detail: "`.git` is a file rather than a directory (a linked worktree or submodule). Its real "
        + "repository lives outside the approved root, so the commit is not read rather than guessed.",
    };
  }

  const config = readInsideRoot(realRoot, ".git/config", fs);
  const remote = config === null ? null : parseRemoteUrl(config);

  const headFile = readInsideRoot(realRoot, ".git/HEAD", fs);
  if (headFile === null) {
    return { head: null, remote, detail: "`.git/HEAD` could not be read." };
  }
  const head = headFile.trim();

  // Detached HEAD: the commit is written directly.
  if (OBJECT_ID.test(head)) {
    return { head, remote, detail: "HEAD is detached and names the commit directly." };
  }

  const symbolic = /^ref:\s*(.+)$/.exec(head);
  if (symbolic === null) {
    return { head: null, remote, detail: "`.git/HEAD` is neither a commit nor a symbolic ref." };
  }
  const ref = (symbolic[1] ?? "").trim();
  if (ref === "" || ref.includes("..") || ref.startsWith("/")) {
    return { head: null, remote, detail: "`.git/HEAD` names an unusable ref." };
  }

  const loose = readInsideRoot(realRoot, `.git/${ref}`, fs);
  if (loose !== null && OBJECT_ID.test(loose.trim())) {
    return { head: loose.trim(), remote, detail: `HEAD follows ${ref}, read as a loose ref.` };
  }

  const packed = readInsideRoot(realRoot, ".git/packed-refs", fs);
  const fromPacked = packed === null ? null : parsePackedRef(packed, ref);
  if (fromPacked !== null) {
    return { head: fromPacked, remote, detail: `HEAD follows ${ref}, read from packed-refs.` };
  }

  return {
    head: null,
    remote,
    detail: `HEAD follows ${ref}, which is neither a loose ref nor in packed-refs (an unborn branch, or a layout this reader does not cover).`,
  };
}
