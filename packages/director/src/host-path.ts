/**
 * One spelling per place, decided by text alone — and an explicit refusal for everything else.
 *
 * `C:/wt-a`, `C:\wt-a`, `C:\WT-A\`, `C:/wt-a/sub/..` and `\\?\C:\wt-a` are one directory on a Windows
 * host, and treating them as five is how two executors end up inside one worktree while both leases
 * look uncontested. Every module that has to decide "is this the same place?" asks this one.
 *
 * ## Positive acceptance, not absence of suspicion
 *
 * The previous model answered "is this usable?" with *not empty and not escaping*. That is a much
 * weaker claim than "this provably names one fixed place on this host", and the gap was where the
 * defects lived: a driveless root `\wt-a`, a drive-relative `C:wt-a` and an absolute `C:\wt-a` were
 * all "not empty, not escaping", and all three were granted leases over one real directory — proven
 * by creating the directory and reading one marker file through all three spellings. Relabelling the
 * first two as `RELATIVE` changed nothing, because `RELATIVE` was still accepted.
 *
 * So classification is now explicit and acceptance is a closed allowlist: {@link IDENTITY_CLASSES}.
 * A class that is not on that list is not usable as a resource identity, and adding a class to the
 * union without adding it to the list denies it by default. The anchors this refuses —
 * `DRIVE_RELATIVE` (per-drive current directory) and `ROOTED_DRIVELESS` (current drive) — are
 * refused for one reason: they are anchored to *process state no string can see*, so two processes
 * spelling them identically mean different directories, and one process spelling them differently
 * means the same directory. Neither direction can be detected here, so neither is guessed at.
 *
 * ## Pure string work, and what that costs
 *
 * No filesystem is consulted, so a symlink, a junction, a mapped drive and a `subst` alias are
 * invisible — `Z:/wt-a` and `C:/repos/wt-a` may be one directory and this module will call them two.
 * Callers that can resolve, must resolve before calling. What this module guarantees is the other
 * direction: two spellings it calls equal really are the same place.
 *
 * **There is no resolver in this package yet.** An earlier version of this paragraph named
 * `resourceIdentityOf` in `leases.ts` as the place where a caller with filesystem access resolves
 * first. No such function exists, and no module here calls `realpath`. Pointing at an imaginary
 * mitigation is worse than admitting the gap, because it reads as though the gap is covered. Until
 * D2 supplies filesystem-backed identity (`realpath.native` plus `dev`/`ino`), every alias that is
 * not decidable from text is genuinely open, and callers must treat a text-equal answer as necessary
 * but not sufficient.
 *
 * ## `\\?\` is normalised, not rejected
 *
 * `fs.realpathSync.native` *emits* `\\?\C:\wt-a`, and Git for Windows emits it for long paths, so the
 * extended-length prefix is what a careful caller produces rather than an attack. Rejecting it would
 * punish the callers doing the right thing; passing it through unchanged gave one directory a second
 * lease key and a second lock file. It is therefore stripped to the identity it denotes, so resolved
 * output and the plain spelling land on one key. `\\?\UNC\server\share` becomes `//server/share` for
 * the same reason. The traversal and anchor rules then apply to what is underneath: `\\?\..\..\x` is
 * refused exactly as `\\..\..\x` is.
 *
 * ## Unresolved `..` is preserved, never dropped
 *
 * A `..` that has nothing to cancel is not noise, it is a path whose meaning depends on a base nobody
 * supplied. An earlier implementation popped whatever was on the stack, including a `..` it had
 * pushed itself, so `../../foo` canonicalised to `foo` — an escaping path arriving as a contained
 * one, under a name that would later become a lock file and a lease key. Traversal that cannot be
 * resolved is kept verbatim at the front and counted in `ascends`.
 *
 * ## The UNC anchor is validated, not assumed
 *
 * `//server/share` is the root, so `..` must not eat the server name — but the previous version built
 * that root from the first two segments *without looking at them*. `\\..\..\x` became `//../../x`,
 * classified as rooted with `ascends: 0`, and was leasable and lockable: two unresolved parent steps
 * arriving as a fixed location. Worse, the next `..` was then absorbed as though it had hit a real
 * root, so `\\server\..\x` and `\\server\..\..\x` collapsed to one key. The anchor components are now
 * checked before they become a root.
 *
 * ## 8.3 short names
 *
 * NTFS generates one for every long name on a volume with short-name creation enabled, so
 * `C:\AION-HQ-claude-director-v01` and `C:\AIE149~1` are the same directory — identical `dev`/`ino`,
 * same bytes through either — and this host has one for all forty-odd worktrees. Unlike a junction,
 * the *shape* is decidable from text, so refusing it is possible here even though resolving it is
 * not: a generated alias is never a name anybody configures, and a directory genuinely called
 * `abc~1` is rarer than two executors in one worktree. Refused rather than folded, because the long
 * name it stands for cannot be recovered from the string.
 *
 * ## Trailing dots and spaces, and why they are folded even though it is not always true
 *
 * The ordinary Win32 path APIs strip trailing dots and spaces from each segment before opening, so
 * `wt-b.` and `wt-b` are one directory — confirmed on this host through `cmd.exe`. Under
 * *extended-length* semantics (`\\?\`, which Node switches to for long paths) they are not stripped,
 * and `wt-b.` is a distinct name that usually cannot be created. Measured directly: reading
 * `<long path>\wt-a.\marker.txt` from Node fails, while the same read through `cmd.exe` on a short
 * path succeeds.
 *
 * So the two spellings are the same directory under one API and different under another, and no
 * string can tell which API a caller will end up using. They are folded, deliberately, because the
 * two errors are not symmetric: folding can only ever *refuse* a second claim that might have been
 * legitimate, while not folding can *grant* two leases over one directory — the failure this whole
 * module exists to prevent. `store-contract.ts` already encoded the stripping rule for identifiers.
 */

/**
 * What a path is anchored to, which is what decides whether it may be compared to another.
 *
 * Every value is a distinct answer to "where does this start?", because that is the question the
 * defects turned on. Only the members listed in {@link IDENTITY_CLASSES} name a place on this host.
 */
export type HostPathClassV1 =
  /** `C:/x` — a drive letter and a separator. Names one place on this host. */
  | "ABSOLUTE_DRIVE"
  /** `//server/share/x` with a validated anchor. Names one place, on a host that may not be this one. */
  | "UNC_ABSOLUTE"
  /** `C:x`, `C:..\x` — anchored to the per-drive current directory, which is invisible process state. */
  | "DRIVE_RELATIVE"
  /** `/x`, `\x` — anchored to the current drive, which is invisible process state. */
  | "ROOTED_DRIVELESS"
  /** `a/b` — names one place under whatever base the caller supplies, and the caller must say which. */
  | "RELATIVE"
  /** One or more unresolved `..` remain, so the path climbs above its base wherever that is. */
  | "ESCAPING"
  /** Empty, control-byte-bearing, malformed UNC, or cancelled down to nothing. Names nothing. */
  | "INVALID";

/**
 * The classes that may be used as a filesystem resource identity.
 *
 * A closed allowlist, deliberately: this is the whole difference between the model that failed and
 * this one. A new class added to the union above is denied until it is named here on purpose.
 */
export const IDENTITY_CLASSES: readonly HostPathClassV1[] = ["ABSOLUTE_DRIVE", "UNC_ABSOLUTE"];

export interface HostPathV1 {
  /** The canonical text, case-folded whole. `""` whenever `identifiable` is false and no text survives. */
  path: string;
  pathClass: HostPathClassV1;
  /**
   * Unresolved parent steps still at the front, `0` unless `ESCAPING`.
   *
   * Counted rather than re-derived, because a caller that has to re-parse the string to learn how far
   * out a path reaches is a caller that will eventually skip the check.
   */
  ascends: number;
  /**
   * Whether this names one fixed place on this host.
   *
   * The single question every caller should ask. Derived from {@link IDENTITY_CLASSES} rather than
   * from a list of things that are wrong, so an unanticipated shape is unusable by default.
   */
  identifiable: boolean;
}

const INVALID: HostPathV1 = { path: "", pathClass: "INVALID", ascends: 0, identifiable: false };

/** Control bytes, NUL first. Win32 native APIs terminate at a NUL, so the validated path and the
 * opened path stop being the same path. Refused at this boundary so no caller downstream has to
 * remember: `C:/wt-a\0` was a second identifiable key for a directory another run already held. */
const CONTROL_BYTES = /[\u0000-\u001f\u007f]/;

/**
 * The NTFS 8.3 generated-alias shape: up to eight characters, `~`, a digit run, optional extension.
 *
 * Matched on shape rather than resolved, because the long name cannot be recovered from the short one
 * by text. This is the alias that is always present rather than opt-in: every long directory name on
 * the volume has one, so without this every worktree had a second identity, a second lease and a
 * second lock file.
 */
const SHORT_NAME_ALIAS = /^[^\\/.]{1,8}~[0-9]{1,3}(\.[^\\/.]{1,3})?$/;

/** Win32 strips trailing dots and spaces from a segment before opening it. */
const TRAILING_DOTS_OR_SPACES = /[. ]+$/;

/**
 * The DOS device names Win32 resolves ahead of the filesystem, in every directory.
 *
 * Exported because the artifact guard needs exactly this predicate and must not grow a second,
 * subtly different copy — that divergence is what let `NUL:` through while `NUL` was refused.
 */
const RESERVED_DEVICE_NAMES: ReadonlySet<string> = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

/**
 * Whether one path segment names a reserved device rather than a file.
 *
 * The stem is taken at the first `.` **or `:`**, which is the fix for the whole class rather than for
 * one spelling: `NUL` was refused while `NUL:` was accepted, and `NUL:` opens the null device in any
 * real directory (verified on this host — `type "<dir>\NUL:"` returns 0, and writes to it vanish).
 * `:` also introduces an NTFS alternate data stream, so `NUL::$DATA` is caught by the same cut.
 * Trailing dots and spaces are stripped first because Win32 strips them first.
 */
export function namesReservedDeviceSegment(segment: string): boolean {
  const stem = (segment.split(/[.:]/)[0] ?? "").replace(TRAILING_DOTS_OR_SPACES, "").trim();
  return RESERVED_DEVICE_NAMES.has(stem.toUpperCase());
}

/** Whether any segment of a path names a reserved device. */
export function namesReservedDevice(candidate: string): boolean {
  return candidate.split(/[\\/]+/).some(namesReservedDeviceSegment);
}

/** A UNC server or share component that cannot anchor anything. */
function invalidUncComponent(component: string): boolean {
  const stripped = component.replace(TRAILING_DOTS_OR_SPACES, "").trim();
  return stripped === ""
    || stripped === "."
    || stripped === ".."
    || stripped.includes(":")
    || namesReservedDeviceSegment(stripped);
}

/**
 * Canonicalise and classify in one pass.
 *
 * Separators normalised, `.` and repeated separators collapsed, trailing separators and per-segment
 * trailing dots/spaces dropped, `..` resolved where it can be and preserved where it cannot, drive
 * letter and body case-folded together — NTFS is case-insensitive, so `C:\WT-A` and `c:/wt-a` must
 * not become two leases and two lock files.
 */
export function inspectHostPath(value: string): HostPathV1 {
  if (typeof value !== "string") return INVALID;
  if (CONTROL_BYTES.test(value)) return INVALID;

  const raw = value.trim().replace(/\\/g, "/");
  if (raw === "") return INVALID;

  // Win32 namespace prefixes denote the same objects as the plain spellings, and `realpath.native`
  // emits them, so they are normalised to the identity underneath rather than accepted as a separate
  // one or refused outright. Whatever is underneath then faces every rule below unchanged.
  const namespaced = /^\/\/[?.]\/(.*)$/.exec(raw);
  if (namespaced) {
    const rest = namespaced[1] ?? "";
    const unc = /^unc\/(.*)$/i.exec(rest);
    const inner = inspectHostPath(unc ? `//${unc[1] ?? ""}` : rest);
    // A device-namespace spelling is only ever an alias for a real absolute path. If what it wraps is
    // not one — `\\?\..\..\x`, `\\?\relative` — it names nothing, rather than inheriting a weaker class.
    return inner.identifiable ? inner : INVALID;
  }

  // Drive-relative, handled before anything treats `c:..` as the name of a directory. The remainder is
  // a relative path; the anchor is the per-drive current directory, which no string can see.
  const driveRelative = /^([a-zA-Z]):(?!\/)(.*)$/.exec(raw);
  if (driveRelative) {
    const inner = inspectHostPath(driveRelative[2] ?? "");
    const letter = (driveRelative[1] ?? "").toLowerCase();
    if (inner.pathClass === "INVALID") return INVALID;
    return {
      path: `${letter}:${inner.path}`,
      pathClass: inner.ascends > 0 ? "ESCAPING" : "DRIVE_RELATIVE",
      ascends: inner.ascends,
      identifiable: false,
    };
  }

  const isUnc = raw.startsWith("//");
  const parts = (isUnc ? raw.slice(2) : raw).split("/");
  const head = parts[0] ?? "";
  const driveLetter = /^([a-zA-Z]):$/.exec(head)?.[1];
  const driveless = !isUnc && head === "";

  let prefix: string;
  let anchor: HostPathClassV1;
  let start: number;
  if (isUnc) {
    // Validated before it becomes a root. Unchecked, `\\..\..\x` became the fixed location
    // `//../../x` — leasable, lockable, `ascends: 0` — and the next `..` was absorbed as though it
    // had reached a real root, collapsing `\\server\..\x` and `\\server\..\..\x` onto one key.
    const server = parts[0] ?? "";
    const share = parts[1] ?? "";
    if (invalidUncComponent(server) || invalidUncComponent(share)) return INVALID;
    prefix = `//${server.replace(TRAILING_DOTS_OR_SPACES, "")}/${share.replace(TRAILING_DOTS_OR_SPACES, "")}`;
    anchor = "UNC_ABSOLUTE";
    start = 2;
  } else if (driveLetter !== undefined) {
    prefix = `${driveLetter}:/`;
    anchor = "ABSOLUTE_DRIVE";
    start = 1;
  } else if (driveless) {
    prefix = "/";
    anchor = "ROOTED_DRIVELESS";
    start = 1;
  } else {
    prefix = "";
    anchor = "RELATIVE";
    start = 0;
  }

  const out: string[] = [];
  let ascends = 0;
  for (let i = start; i < parts.length; i += 1) {
    const part = parts[i] ?? "";
    if (part === "" || part === ".") continue; // collapses `//`, `/./` and a trailing separator
    if (part === "..") {
      const last = out[out.length - 1];
      // A `..` may only cancel a segment that names something. Letting it pop a `..` already on the
      // stack is what turned `../../foo` into `foo`.
      if (last !== undefined && last !== "..") {
        out.pop();
        continue;
      }
      // At a real root the OS itself has nowhere to go — `cd C:\ && cd ..` stays at `C:\`.
      if (prefix !== "") continue;
      out.push("..");
      ascends += 1;
      continue;
    }
    // A `:` past the drive prefix opens an NTFS alternate data stream — and for a directory, the
    // stream spellings reach the directory itself: `wt-a::$INDEX_ALLOCATION` and
    // `wt-a:$I30:$INDEX_ALLOCATION` have the same dev/ino as `wt-a`, list the same children and read
    // the same files, confirmed here and through cmd.exe. Left alone they were three identifiable
    // keys, three lock files and two uncontested leases over one directory. This module already
    // reasoned about ADS for the device predicate and applied it nowhere else; identity is where it
    // actually mattered. Refused rather than folded: the stream suffix is not always a synonym for
    // the file, so the honest answer is that this text does not name one place.
    // ORDER MATTERS, and getting it wrong is this file's recurring defect in miniature. Win32 strips
    // trailing dots and spaces from a segment *before* it resolves anything, so every predicate below
    // has to see the same bytes the OS will. The first version tested `:`, the device names and the
    // 8.3 shape against the raw segment and only folded afterwards — so `AION-H~1` was refused as an
    // alias while `AION-H~1.` sailed through as a valid identity and took a second uncontested lease
    // on the same directory (confirmed: cmd.exe opens `AION-H~1.\marker.txt` and reads the file).
    // Folding first means a predicate added later cannot be put on the wrong side of it.
    const segment = part.replace(TRAILING_DOTS_OR_SPACES, "");
    if (segment === "") return INVALID; // a segment that was nothing but dots and spaces
    // A `:` past the drive prefix opens an NTFS alternate data stream, and for a directory the stream
    // spellings reach the directory itself — same dev/ino, same children, same files.
    if (segment.includes(":")) return INVALID;
    // A reserved device name in ANY segment: Win32 resolves it ahead of the filesystem in every
    // directory, so `C:\AION\runs\NUL` is the null device rather than a directory under the store
    // root, and writes to it vanish while reporting success.
    if (namesReservedDeviceSegment(segment)) return INVALID;
    // A generated 8.3 alias names the same directory as some long name this module cannot recover.
    if (SHORT_NAME_ALIAS.test(segment)) return INVALID;
    out.push(segment);
  }

  const joined = out.join("/");
  const body = prefix === "" || prefix.endsWith("/") || joined === "" ? prefix + joined : `${prefix}/${joined}`;
  const path = body.toLowerCase();
  if (path === "") return INVALID; // e.g. `a/..`, which names its own unsupplied base

  const pathClass: HostPathClassV1 = ascends > 0 ? "ESCAPING" : anchor;
  return { path, pathClass, ascends, identifiable: IDENTITY_CLASSES.includes(pathClass) };
}

/**
 * The canonical text on its own, for the comparison sites that only need a key.
 *
 * Returns a plain string, never `null`, deliberately: this value decides lease identity at a dozen
 * call sites, and a nullable key invites the fallback that gets written under deadline — "no key, so
 * nothing matches" — which is precisely the second uncontested lease this area exists to prevent. An
 * unusable path comes back visibly unusable instead: `""`, or still carrying its `../`. Ask
 * {@link isResolvedHostPath} before treating one as a place.
 */
export function canonicalizeHostPath(value: string): string {
  return inspectHostPath(value).path;
}

/**
 * Whether this names one identifiable place on this host.
 *
 * Positive: true only for the classes on {@link IDENTITY_CLASSES}. This is the guard callers use to
 * refuse rather than to guess, and it is the line the previous model got wrong — a claim on `\wt-a`
 * or `C:wt-a` means a different directory to every process with a different current drive or working
 * directory, so granting exclusion on one would exclude nobody.
 */
export function isResolvedHostPath(value: string): boolean {
  return inspectHostPath(value).identifiable;
}

/**
 * Whether a path sits under an ancestor, for asserting the store root is outside every worktree.
 *
 * The separator is appended before the prefix test because `C:/AION` is not an ancestor of
 * `C:/AION-HQ-claude-director-v01`, and a naive `startsWith` says it is.
 *
 * Both operands must be identifiable. That is stricter than the old "not empty, not escaping" test,
 * which accepted every rooted-looking value the UNC defect produced — `pathIsInside("\\\\..\\..\\x\\y",
 * "\\\\..\\..")` returned true, a path climbing two levels out reported as containing another.
 *
 * Note for callers: `false` means "not known to be inside", which is the safe answer for *one* of the
 * two readings this serves. For "refuse to write state into something that might be a worktree",
 * `false` is the permissive answer, so a caller asking that question must reject an unidentifiable
 * operand outright rather than treat `false` as clearance.
 */
export function pathIsInside(candidate: string, ancestor: string): boolean {
  const child = inspectHostPath(candidate);
  const parent = inspectHostPath(ancestor);
  if (!child.identifiable || !parent.identifiable) return false;
  // A drive path and a UNC path are two coordinate systems; neither contains the other.
  if (child.pathClass !== parent.pathClass) return false;
  if (child.path === parent.path) return true;
  return child.path.startsWith(parent.path.endsWith("/") ? parent.path : `${parent.path}/`);
}
