/**
 * What a lease kind's resource *is*, which is not the same question for every kind.
 *
 * This sits between `host-path.ts` (syntax) and the two modules that need identity decisions —
 * `leases.ts` (may this claim be granted?) and `store-contract.ts` (what file may this claim lock?).
 * It exists as its own module for one reason: both of those need the same answer, and the previous
 * arrangement gave them different ones. The lock layer tested only "does the key still contain `..`",
 * so a `WORKTREE` key of `wt-a` — a relative path that names a different directory to every process —
 * was refused a lease and granted a lock file. Two layers disagreeing about one claim is how a
 * defence-in-depth check becomes a second, weaker front door.
 *
 * Nothing here touches the filesystem, so it stays importable by pure policy code with no persistence
 * in the process. `host-path.ts` is its only dependency and depends on nothing itself.
 *
 * ## Why the kinds differ
 *
 * Forcing all five through one path model failed in both directions. `PREVIEW` and
 * `PRODUCTION_WRITER` left *out* of the path set meant `../p` and `..\p` became two uncontested
 * claims on one directory. Put *into* the path set, a relative path became an accepted identity,
 * which excludes nobody. Neither is right, because a role is not a location: the production writer is
 * a singleton whose exclusivity must not depend on whether somebody typed `C:\foo`, `C:/foo` or
 * `\\?\C:\foo`.
 */
import { canonicalizeHostPath, isResolvedHostPath, namesReservedDevice } from "./host-path.js";

/**
 * The kinds of thing that can only have one owner.
 *
 * `PRODUCTION_WRITER` is the strictest: the running production process is the only writer of the
 * Owner's business state, and a second one would race it over a single JSON document.
 */
export type LeaseKindV1 =
  | "WORKTREE"
  | "BRANCH"
  | "INTEGRATION"
  | "PREVIEW"
  | "PRODUCTION_WRITER";

/**
 * How a kind's resource is identified.
 *
 * - `HOST_PATH`   names a directory that exists on this host, and identity is that directory. Only an
 *                 absolute, anchored spelling can name one. A caller with filesystem access should
 *                 resolve (`realpath.native`) before claiming; this layer cannot, and refuses what it
 *                 cannot place rather than guessing.
 * - `REPO_REF`    a Git ref, scoped to the repository. Case-folded because Git on Windows stores refs
 *                 as files, so `Executor/X` and `executor/x` are one branch — but never
 *                 path-canonicalised, because `a/../b` is a legal ref name distinct from `b`, and
 *                 resolving it as a path would merge two branches into one lease.
 * - `SINGLETON`   a logical role with one holder. The resource is a role token, not a location, so
 *                 path-shaped input is refused outright rather than canonicalised.
 */
export type ResourceIdentityModelV1 = "HOST_PATH" | "REPO_REF" | "SINGLETON";

export const IDENTITY_MODEL: Readonly<Record<LeaseKindV1, ResourceIdentityModelV1>> = {
  WORKTREE: "HOST_PATH",
  BRANCH: "REPO_REF",
  INTEGRATION: "SINGLETON",
  PREVIEW: "SINGLETON",
  PRODUCTION_WRITER: "SINGLETON",
};

/** Written as escapes, never as the characters themselves — typing them is how they get into source. */
const CONTROL_BYTES = /[\u0000-\u001f\u007f]/;

/**
 * Anything carrying a drive, a root, a separator or a traversal.
 *
 * Used to refuse path-shaped input where a role token belongs. Deliberately generous: a false
 * positive costs a caller renaming a role, a false negative costs two holders of one production
 * writer.
 */
export function looksLikeHostPath(resource: string): boolean {
  return /^[A-Za-z]:/.test(resource)
    || /[\\/]/.test(resource)
    || resource.split(/[\\/]+/).includes("..");
}

/**
 * Names that answer for a property nobody set.
 *
 * A resource key becomes an object key somewhere — a lease index, a lock table, a status map — and
 * `map["__proto__"]` or `map["toString"]` returns an inherited value rather than the absence the
 * caller is testing for. Not hypothetical: the same shape in `mission.ts` let an event named
 * `toString` answer for a production observation and erase deployment uncertainty. No legitimate
 * branch, role or worktree in this system is called any of these, so they are refused at the identity
 * boundary rather than defended against separately at every consumer downstream.
 */
const INHERITED_KEYS: ReadonlySet<string> = new Set(
  Object.getOwnPropertyNames(Object.prototype).concat("prototype"),
);

/**
 * Characters Git itself forbids in a ref name.
 *
 * Checked because "not a path" was doing the work of "is a ref", and those are different claims:
 * `C:\wt-a:stream` is not a valid branch, but it also is not caught by the path guard, so it was
 * accepted as a BRANCH identity. Git rejects space, `~^:?*[`, backslash and control bytes outright,
 * so a value carrying one never named a branch this Director could act on — and accepting it would
 * put a lease on a resource that cannot exist.
 */
const ILLEGAL_IN_REF = /[ ~^:?*\[\\]/;

/** A role token: no separators, no traversal, no control bytes, and something left after trimming. */
export function isUsableSingletonToken(trimmed: string): boolean {
  if (trimmed === "" || CONTROL_BYTES.test(trimmed)) return false;
  if (INHERITED_KEYS.has(trimmed)) return false;
  // A colon is a drive qualifier or an alternate data stream, and a role is neither. Without this,
  // "x.txt::$DATA" was an acceptable name for the integration singleton — a role token that carries
  // filesystem syntax is a caller passing a location where a role belongs.
  if (trimmed.includes(":")) return false;
  if (namesReservedDevice(trimmed)) return false;
  return !looksLikeHostPath(trimmed);
}

/**
 * The string two claims are compared on.
 *
 * An unusable resource canonicalises to `""` rather than to something that looks like an identity, so
 * a slip downstream cannot turn `../p` into an exclusion domain shared with whatever else happens to
 * canonicalise the same way. Ask {@link resourceIsIdentifiable} before treating the result as an
 * identity — and note that `""` is refused by every consumer, so the failure is loud either way.
 */
export function canonicalResource(kind: LeaseKindV1, resource: string): string {
  const trimmed = typeof resource === "string" ? resource.trim() : "";
  switch (IDENTITY_MODEL[kind]) {
    case "HOST_PATH":
      return isResolvedHostPath(trimmed) ? canonicalizeHostPath(trimmed) : "";
    case "SINGLETON":
      return isUsableSingletonToken(trimmed) ? trimmed.toLowerCase() : "";
    case "REPO_REF":
      return resourceIsIdentifiable(kind, trimmed) ? trimmed.toLowerCase() : "";
  }
}

/**
 * Whether a resource names one thing this process can actually exclude others from.
 *
 * Positive for every kind: each model states what it accepts rather than what it rejects, so an
 * unanticipated shape is denied by default instead of inheriting permission.
 */
export function resourceIsIdentifiable(kind: LeaseKindV1, resource: string): boolean {
  const trimmed = typeof resource === "string" ? resource.trim() : "";
  switch (IDENTITY_MODEL[kind]) {
    case "HOST_PATH":
      // `\wt-a`, `C:wt-a`, `wt-a` and `../wt-a` are all refused: their anchor is invisible process
      // state, so two runs spelling them alike mean different directories and one run spelling them
      // differently means the same directory. Neither is detectable here, so neither is guessed at.
      return isResolvedHostPath(trimmed);
    case "SINGLETON":
      return isUsableSingletonToken(trimmed);
    case "REPO_REF":
      return trimmed !== ""
        && !CONTROL_BYTES.test(trimmed)
        && !INHERITED_KEYS.has(trimmed)
        && !ILLEGAL_IN_REF.test(trimmed)
        && !trimmed.split("/").includes("..")
        && !trimmed.startsWith("/") && !trimmed.endsWith("/")
        && !trimmed.endsWith(".lock")
        // Git stores a ref as a file under .git/refs, so a branch named NUL or CON asks the
        // filesystem for a device. The write reports success and the ref never exists.
        && !namesReservedDevice(trimmed);
  }
}
