/**
 * What it takes for two strings to mean one place, and what it takes to refuse to answer.
 *
 * This file was rewritten rather than extended, because the model it tested was the defect. The old
 * question was "is this path obviously bad?" — not empty, not escaping — and everything that survived
 * that filter was treated as a resource identity. Three spellings of one real directory
 * (`C:\wt-a`, `\wt-a`, `C:wt-a`) all survived it, and all three were granted leases over that
 * directory while `conflicts()` reported false. Relabelling two of them changed nothing, because the
 * label was not what acceptance consulted.
 *
 * So the question here is now positive: *does this provably name one fixed place on this host?* Only
 * `ABSOLUTE_DRIVE` and a well-formed `UNC_ABSOLUTE` do. Everything else — drive-relative,
 * driveless-rooted, relative, escaping, malformed UNC, control bytes, reserved devices, alternate
 * data streams — is refused, and refused at the parser rather than by each caller remembering to ask.
 *
 * Each test below names the concrete failure it exists to prevent, because a test that only asserts
 * current behaviour cannot tell a reader which line is load-bearing.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  canonicalizeHostPath, inspectHostPath, isResolvedHostPath, pathIsInside,
  namesReservedDevice, IDENTITY_CLASSES, type HostPathClassV1,
} from "../src/host-path.js";
import { acquireLease, canonicalResource, conflicts, resourceIsIdentifiable } from "../src/leases.js";
import { hostLockFileName, canonicalizeHostPath as reExported } from "../src/store-contract.js";

const NOW = "2026-08-13T12:00:00.000Z";

/** The source of a package module, read as text so an import edge can be asserted rather than assumed. */
const sourceOf = (module: string): string =>
  readFileSync(fileURLToPath(new URL(`../../src/${module}`, import.meta.url)), "utf8");

/** Claim a worktree against a given set of existing leases. */
const claim = (resource: string, existing: Parameters<typeof acquireLease>[0]["existing"] = [], runId = "r1") =>
  acquireLease({ existing, leaseId: "l", kind: "WORKTREE", resource, missionId: "m", runId, pid: 1, now: NOW });

/** A claim by a *different* run, which is the only kind that can be refused: a run re-acquiring its
 * own lease is idempotent, so asserting refusal with one runId would assert nothing at all. */
const claimBySecondRun = (resource: string, existing: Parameters<typeof acquireLease>[0]["existing"]) =>
  claim(resource, existing, "r2");

// ---------------------------------------------------------------------------
// Acceptance is a closed allowlist
// ---------------------------------------------------------------------------

test("only the two absolute classes may be a resource identity", () => {
  // The allowlist is the whole repair. A class added to the union without being named here must be
  // denied by default, because the previous model's failure was exactly that an unanticipated shape
  // inherited permission from "nothing is obviously wrong with it".
  assert.deepEqual([...IDENTITY_CLASSES].sort(), ["ABSOLUTE_DRIVE", "UNC_ABSOLUTE"]);

  const expected: [string, HostPathClassV1, boolean][] = [
    ["C:/wt-a", "ABSOLUTE_DRIVE", true],
    ["C:\\wt-a", "ABSOLUTE_DRIVE", true],
    ["//server/share/x", "UNC_ABSOLUTE", true],
    ["C:wt-a", "DRIVE_RELATIVE", false],
    ["/wt-a", "ROOTED_DRIVELESS", false],
    ["\\wt-a", "ROOTED_DRIVELESS", false],
    ["wt-a/sub", "RELATIVE", false],
    ["../wt-a", "ESCAPING", false],
    ["C:..\\wt-a", "ESCAPING", false],
    ["", "INVALID", false],
    ["   ", "INVALID", false],
    ["a/..", "INVALID", false],
  ];
  for (const [input, pathClass, identifiable] of expected) {
    const seen = inspectHostPath(input);
    assert.equal(seen.pathClass, pathClass, `${JSON.stringify(input)} class`);
    assert.equal(seen.identifiable, identifiable, `${JSON.stringify(input)} identifiable`);
    assert.equal(isResolvedHostPath(input), identifiable, `${JSON.stringify(input)} isResolved`);
  }
});

test("an anchor that is invisible process state is refused, not relabelled", () => {
  // The failure this replaces, exactly: one real directory, three spellings, three granted leases.
  // `\wt-a` is anchored to the current drive and `C:wt-a` to the per-drive current directory, so two
  // processes spelling them alike mean different places and one process spelling them differently
  // means the same place. Neither is detectable from the string, so neither is guessed at.
  for (const unknowable of ["\\wt-a", "/wt-a", "C:wt-a", "C:..\\wt-a", "../wt-a", "wt-a"]) {
    assert.equal(isResolvedHostPath(unknowable), false, `${unknowable} has no anchor this process can see`);
    assert.equal(resourceIsIdentifiable("WORKTREE", unknowable), false, `${unknowable} is not leasable`);
    assert.equal(claim(unknowable).ok, false, `${unknowable} must not be granted`);
    assert.equal(
      hostLockFileName({ kind: "WORKTREE", resourceKey: canonicalizeHostPath(unknowable) }).ok,
      false,
      `${unknowable} must not name a lock file`,
    );
  }
  // And the drive-absolute spelling of the same name still works, so the refusal is about the anchor.
  assert.equal(claim("C:\\wt-a").ok, true);
});

// ---------------------------------------------------------------------------
// Unresolved traversal never disappears
// ---------------------------------------------------------------------------

test("a '..' with nothing to cancel is preserved, never popped off another '..'", () => {
  // The original defect in one line: `out.pop()` ate the `..` it had just pushed, so `../../foo`
  // canonicalised to `foo` — a path climbing two levels out arriving as one that stays put.
  for (const [input, expected, ascends] of [
    ["..", "..", 1],
    ["../foo", "../foo", 1],
    ["..\\foo", "../foo", 1],
    ["../../foo", "../../foo", 2],
    ["..\\..\\foo", "../../foo", 2],
    ["../../../foo", "../../../foo", 3],
    ["../a/../../foo", "../../foo", 2],
    ["a/../../foo", "../foo", 1],
    ["a/b/../../../foo", "../foo", 1],
    ["./../foo", "../foo", 1],
    ["..//..///foo", "../../foo", 2],
    ["  ../../foo  ", "../../foo", 2],
  ] as const) {
    const seen = inspectHostPath(input);
    assert.equal(seen.path, expected, `${input} climbs out of its base and must say so`);
    assert.equal(seen.ascends, ascends, `${input} escape depth`);
    assert.equal(seen.pathClass, "ESCAPING");
    assert.equal(seen.identifiable, false);
  }
  assert.notEqual(canonicalizeHostPath("../../foo"), canonicalizeHostPath("foo"));
});

test("a real root clamps rather than escaping, and a UNC root is not edible", () => {
  assert.equal(canonicalizeHostPath("C:/a/b/../c"), "c:/a/c");
  assert.equal(canonicalizeHostPath("C:/a\\b/../c"), "c:/a/c", "mixed separators are one spelling");
  assert.equal(canonicalizeHostPath("C:/a/./b/"), "c:/a/b", "a `.` and a trailing separator are noise");
  assert.equal(canonicalizeHostPath("C:\\WT-A\\"), "c:/wt-a", "NTFS is case-insensitive");
  // A root has nowhere above it, and the OS agrees: `cd C:\ && cd ..` stays at `C:\`.
  assert.equal(canonicalizeHostPath("C:/a/../.."), "c:/");
  assert.equal(inspectHostPath("C:/a/../..").pathClass, "ABSOLUTE_DRIVE");
  assert.equal(canonicalizeHostPath("\\\\host\\share\\..\\..\\x"), "//host/share/x", "'..' may not eat a UNC root");
});

// ---------------------------------------------------------------------------
// Aliases: one directory must never produce two keys
// ---------------------------------------------------------------------------

test("every spelling of one directory produces one key, one lock and a real conflict", () => {
  const aliases = [
    "C:\\wt-a", "C:/wt-a", "c:/WT-A", "C:\\wt-a\\", "C:/wt-a/sub/..",
    "C://wt-a", "C:/./wt-a/", "C:\\wt-a.", "C:\\wt-a ",
    "\\\\?\\C:\\wt-a", "\\\\.\\C:\\wt-a", "\\\\?\\c:/WT-A/",
  ];
  const held = claim("C:\\wt-a");
  assert.equal(held.ok, true);
  for (const alias of aliases) {
    assert.equal(canonicalizeHostPath(alias), "c:/wt-a", `${alias} is the same directory`);
    assert.equal(
      conflicts({ kind: "WORKTREE", resource: alias }, { kind: "WORKTREE", resource: "C:\\wt-a" }),
      true,
      `${alias} must contest`,
    );
    assert.equal(claimBySecondRun(alias, [held.lease!]).ok, false, `${alias} must not get a second lease`);
    assert.equal(
      hostLockFileName({ kind: "WORKTREE", resourceKey: canonicalResource("WORKTREE", alias) }).fileName,
      hostLockFileName({ kind: "WORKTREE", resourceKey: "c:/wt-a" }).fileName,
      `${alias} must derive one lock file`,
    );
  }
});

test("the Win32 namespace prefix is normalised to what it denotes, not accepted as a second identity", () => {
  // `fs.realpathSync.native` emits `\\?\C:\...` and Git for Windows emits it for long paths, so this
  // is what a careful caller produces. Passed through unchanged it canonicalised to `//?/c:/wt-a` —
  // a second lease key and a second lock file for one directory, with `conflicts` reporting false.
  assert.equal(canonicalizeHostPath("\\\\?\\C:\\wt-a"), "c:/wt-a");
  assert.equal(canonicalizeHostPath("\\\\?\\UNC\\server\\share\\x"), "//server/share/x");
  assert.equal(canonicalizeHostPath("\\\\server\\share\\x"), "//server/share/x");
  // Normalising is not the same as trusting: what the prefix wraps still faces every rule.
  for (const wrapped of ["\\\\?\\..\\..\\x", "\\\\?\\relative\\x", "\\\\?\\NUL", "\\\\.\\NUL", "\\\\?\\UNC\\..\\..\\x"]) {
    assert.equal(inspectHostPath(wrapped).pathClass, "INVALID", `${wrapped} wraps nothing placeable`);
    assert.equal(isResolvedHostPath(wrapped), false);
  }
  assert.equal(inspectHostPath("\\\\?\\C:\\a\\..\\..").path, "c:/", "traversal still clamps through the prefix");
});

test("trailing dots and spaces do not create a second directory", () => {
  // Asserted as a deliberate policy, not as a universal fact about Windows. The ordinary Win32 APIs
  // strip trailing dots and spaces, so `wt-b.` and `wt-b` open one directory (confirmed via
  // cmd.exe); under extended-length `\\?\` semantics — which Node uses for long paths — they do not,
  // and the two names are distinct. Measured both ways. Folding is chosen because the errors are
  // asymmetric: folding can only refuse a claim that might have been legitimate, while not folding
  // can grant two leases over one directory.
  assert.equal(canonicalizeHostPath("C:\\wt-b."), "c:/wt-b");
  assert.equal(canonicalizeHostPath("C:\\wt-b "), "c:/wt-b");
  assert.equal(canonicalizeHostPath("C:\\a. \\b"), "c:/a/b");
  const held = claim("C:\\wt-b");
  assert.equal(claimBySecondRun("C:\\wt-b.", [held.lease!]).ok, false, "one directory, one lease");
  // A segment that is nothing but dots and spaces names nothing at all.
  assert.equal(inspectHostPath("C:\\...\\b").pathClass, "INVALID");
});

// ---------------------------------------------------------------------------
// Malformed and hostile input
// ---------------------------------------------------------------------------

test("a UNC anchor is validated before it becomes a root", () => {
  // Unchecked, `\\..\..\x` became the fixed location `//../../x` — classified rooted with ascends 0,
  // leasable, lockable. Two unresolved parent steps arriving as a place. Worse, the next `..` was
  // then absorbed as though it had hit a real root, collapsing `\\server\..\x` and
  // `\\server\..\..\x` onto one key: a `..` silently dropped and two claims sharing one lock.
  for (const malformed of [
    "\\\\..\\..\\x", "\\\\server\\..\\x", "\\\\.\\.\\x", "\\\\", "\\\\server",
    "\\\\server\\", "\\\\\\share\\x", "//../x", "//./",
  ]) {
    const seen = inspectHostPath(malformed);
    assert.equal(seen.identifiable, false, `${JSON.stringify(malformed)} must not be a place`);
    assert.equal(claim(malformed).ok, false, `${JSON.stringify(malformed)} must not be leasable`);
    assert.equal(
      hostLockFileName({ kind: "WORKTREE", resourceKey: canonicalResource("WORKTREE", malformed) }).ok,
      false,
      `${JSON.stringify(malformed)} must not name a lock file`,
    );
  }
  // A well-formed share still works, and is not collapsed into a local drive identity.
  assert.equal(inspectHostPath("\\\\server\\share\\x").pathClass, "UNC_ABSOLUTE");
  assert.equal(pathIsInside("//server/share/x", "C:/server/share"), false, "a share is not a local directory");
});

test("a control byte cannot split one directory into two leases", () => {
  // Win32 native path APIs terminate at a NUL, so `C:/wt-a\u0000` and `C:/wt-a` open the same
  // directory. Carried through, both were identifiable, `conflicts` said false, and two lock files
  // were derived — a second uncontested lease over a worktree another run already held.
  const held = claim("C:/wt-a");
  for (const poisoned of ["C:/wt-a\u0000", "C:/wt-a\u0000/x", "\u0000", "C:/wt\u001fa", "C:/wt\u007fa"]) {
    assert.equal(inspectHostPath(poisoned).pathClass, "INVALID", `${JSON.stringify(poisoned)} names nothing`);
    assert.equal(isResolvedHostPath(poisoned), false);
    assert.equal(resourceIsIdentifiable("WORKTREE", poisoned), false);
    assert.equal(claimBySecondRun(poisoned, [held.lease!]).ok, false);
  }
  assert.notEqual(canonicalizeHostPath("C:/wt-a\u0000"), canonicalizeHostPath("C:/wt-a"));
});

test("reserved devices and alternate data streams are not directories", () => {
  // `NUL` was refused while `NUL:` was accepted, and `NUL:` opens the null device in any real
  // directory — verified on this host. The stem is therefore cut at `.` *or* `:`, which closes the
  // ADS spelling in the same stroke.
  for (const device of ["NUL", "nul", "CON", "con.txt", "NUL:", "nul:", "NUL::$DATA", "COM1", "LPT9.log", "CON. "]) {
    assert.equal(namesReservedDevice(device), true, `${JSON.stringify(device)} is a device`);
    assert.equal(namesReservedDevice(`logs/${device}`), true, `${JSON.stringify(device)} is a device in any directory`);
  }
  // Names that merely begin with a device name are ordinary files.
  for (const ordinary of ["console.txt", "nullify.log", "com10.txt", "auxiliary"]) {
    assert.equal(namesReservedDevice(ordinary), false, `${ordinary} is a real name`);
  }
});

// ---------------------------------------------------------------------------
// Containment
// ---------------------------------------------------------------------------

test("containment is segment-wise and both operands must be placeable", () => {
  assert.equal(pathIsInside("C:/AION/director/missions/m1", "C:\\aion\\director"), true);
  assert.equal(pathIsInside("C:/AION/director", "C:/AION/director"), true, "a path contains itself");
  // The sibling-prefix trap: `C:/AION` is not an ancestor of `C:/AION-HQ-...`, though it is a prefix.
  assert.equal(pathIsInside("C:/AION-HQ-claude-director-v01", "C:/AION"), false);
  assert.equal(pathIsInside("C:/ab", "C:/a"), false);
  // An unplaceable value is nobody's ancestor and nobody's child. The old guard was phrased
  // negatively — "not empty, not escaping" — so every rooted-looking value the UNC defect produced
  // was accepted on both sides: `pathIsInside("\\\\..\\..\\x\\y", "\\\\..\\..")` returned true.
  for (const unplaceable of ["\\\\..\\..", "..", "", "C:", "C:wt-a", "/wt-a", "wt-a"]) {
    assert.equal(pathIsInside(`${unplaceable}/x`, unplaceable), false, `${JSON.stringify(unplaceable)} as ancestor`);
    assert.equal(pathIsInside(unplaceable, "C:/wt-a"), false, `${JSON.stringify(unplaceable)} as candidate`);
  }
  // Two coordinate systems never contain one another.
  assert.equal(pathIsInside("//server/share/x", "//server/share"), true);
  assert.equal(pathIsInside("C:/server/share/x", "//server/share"), false);
});

// ---------------------------------------------------------------------------
// Typed resource identity: not every lease kind is a path
// ---------------------------------------------------------------------------

test("a singleton role is a role, and a path-shaped role token is refused", () => {
  // Forcing every kind through one path model failed in both directions. Left out of the path set,
  // `canonicalResource("PREVIEW", "..\\p")` returned `..\\p` with the separator not even normalised
  // and `../p` returned itself — two identifiable claims, `conflicts` false, both granted. Put *into*
  // the path set, a relative path became an accepted identity, which excludes nobody. A role is
  // neither: it is a token, and anything path-shaped in that slot is a caller error.
  for (const kind of ["PREVIEW", "PRODUCTION_WRITER", "INTEGRATION"] as const) {
    assert.equal(resourceIsIdentifiable(kind, "owner-state"), true, `${kind} accepts a role token`);
    assert.equal(canonicalResource(kind, "Owner-State"), "owner-state", `${kind} is case-folded`);
    for (const pathShaped of ["..\\p", "../p", "C:\\p", "C:/p", "\\\\?\\C:\\p", "p/q", "p\\q", "/p"]) {
      assert.equal(resourceIsIdentifiable(kind, pathShaped), false, `${kind} must refuse ${pathShaped}`);
      assert.equal(canonicalResource(kind, pathShaped), "", `${kind} must not key on ${pathShaped}`);
    }
    // The defect in one assertion: two spellings of one directory must not become two role holders.
    assert.equal(
      conflicts({ kind, resource: "..\\p" }, { kind, resource: "../p" }),
      true,
      `${kind} fails closed on two unidentifiable claims`,
    );
  }
  // PRODUCTION_WRITER exclusivity must not depend on how somebody spelled a directory.
  const writer = acquireLease({
    existing: [], leaseId: "l1", kind: "PRODUCTION_WRITER", resource: "production",
    missionId: "m1", runId: "r1", pid: 1, now: NOW,
  });
  assert.equal(writer.ok, true);
  assert.equal(acquireLease({
    existing: [writer.lease!], leaseId: "l2", kind: "PRODUCTION_WRITER", resource: "PRODUCTION",
    missionId: "m1", runId: "r2", pid: 2, now: NOW,
  }).ok, false, "one production writer, whatever the case");
  // conflicts() ignores the resource for this kind. Two genuinely different
  // tokens are still one writer. The lock-file name must agree (see r23 R3).
  const writerA = acquireLease({
    existing: [], leaseId: "l-a", kind: "PRODUCTION_WRITER", resource: "writer-a",
    missionId: "m1", runId: "r-a", pid: 1, now: NOW,
  });
  assert.equal(writerA.ok, true);
  assert.equal(acquireLease({
    existing: [writerA.lease!], leaseId: "l-b", kind: "PRODUCTION_WRITER", resource: "writer-b",
    missionId: "m1", runId: "r-b", pid: 2, now: NOW,
  }).ok, false, "one production writer, whatever token the caller typed");
});

test("a branch is a ref, not a path, and is never path-canonicalised", () => {
  // Git on Windows stores refs as files, so case folds; but `a/../b` is a legal ref name distinct
  // from `b`, and resolving it as a path would merge two branches into one lease.
  assert.equal(canonicalResource("BRANCH", "Executor/X"), "executor/x");
  // Git itself forbids ".." in a ref name, so this was asserting that an impossible branch is a
  // valid identity. What matters is that a ref is never *path-canonicalised* — "a/../b" must not
  // silently become "b" and merge two branches into one lease — and refusing it outright is the
  // stronger version of that guarantee.
  assert.equal(canonicalResource("BRANCH", "A/../b"), "", "a ref containing '..' is not a branch");
  assert.equal(resourceIsIdentifiable("BRANCH", "A/../b"), false);
  assert.equal(canonicalResource("BRANCH", "feature/Nested/Name"), "feature/nested/name", "real refs still fold");
  assert.equal(resourceIsIdentifiable("BRANCH", "executor/x"), true);
  assert.equal(resourceIsIdentifiable("BRANCH", ""), false);
  assert.equal(resourceIsIdentifiable("BRANCH", "bad\u0000ref"), false);
  // Git's own grammar, checked because "not a path" was doing the work of "is a ref".
  for (const illegal of ["a b", "a~b", "a^b", "a:b", "a?b", "a*b", "a[b", "a\\b", "/lead", "trail/", "x.lock"]) {
    assert.equal(resourceIsIdentifiable("BRANCH", illegal), false, `${illegal} is not a legal ref`);
  }
});

// ---------------------------------------------------------------------------
// Dependency direction
// ---------------------------------------------------------------------------

/**
 * Every `import`/`export ... from "./x.js"` in a module, whether or not it is type-only.
 *
 * Statement-shaped rather than line-shaped on purpose: a re-export block spread over six lines ends
 * with `} from "./host-path.js";`, which no line-based scanner recognises as an import — and a
 * dependency test that quietly stops seeing edges passes forever.
 */
const localImportsOf = (module: string): { specifier: string; typeOnly: boolean }[] => {
  const source = sourceOf(module);
  // The clause may span lines but never a `;`, so one statement can never swallow the next and
  // report its neighbour's type-only-ness as its own.
  const statement = /(?:^|\n)[ \t]*(import|export)\s+([^;]*?)\bfrom\s+"(\.\/[^"]+)"/g;
  const found: { specifier: string; typeOnly: boolean }[] = [];
  for (const match of source.matchAll(statement)) {
    const clause = match[2] ?? "";
    const specifier = match[3] ?? "";
    found.push({ specifier, typeOnly: /^type\s/.test(clause) });
  }
  return found;
};

test("the lease rules do not import the store at runtime", () => {
  const imports = localImportsOf("leases.ts");
  assert.equal(
    imports.some((entry) => entry.specifier === "./resource-identity.js" && !entry.typeOnly),
    true,
    "identity comes from the shared pure module, not from the store",
  );
  // A value import of the store would put filesystem code behind every lease decision, and would be
  // the second half of a cycle as soon as the store needed a rule from here.
  for (const entry of imports) {
    if (entry.specifier !== "./store-contract.js") continue;
    assert.equal(entry.typeOnly, true, "leases.ts may reference the store type-only or not at all");
  }
});

test("no module cycle exists between the path, lease, store and handoff modules", () => {
  const modules = ["host-path.ts", "resource-identity.ts", "leases.ts", "store-contract.ts", "handoff.ts"] as const;
  // Runtime edges only: `import type` is erased by the compiler, so it cannot deadlock a module
  // graph at load time and is not part of the cycle question.
  const runtimeEdges = new Map<string, string[]>();
  for (const module of modules) {
    const edges = localImportsOf(module)
      .filter((entry) => !entry.typeOnly)
      .map((entry) => entry.specifier.replace(/^\.\//, "").replace(/\.js$/, ".ts"))
      .filter((name): name is (typeof modules)[number] => (modules as readonly string[]).includes(name));
    runtimeEdges.set(module, edges);
  }

  assert.deepEqual(runtimeEdges.get("host-path.ts"), [], "the shared primitive must depend on nothing");
  assert.deepEqual(runtimeEdges.get("resource-identity.ts"), ["host-path.ts"], "identity depends on syntax only");
  assert.equal(runtimeEdges.get("leases.ts")?.includes("store-contract.ts"), false);
  assert.equal(runtimeEdges.get("leases.ts")?.includes("resource-identity.ts"), true);
  assert.equal(runtimeEdges.get("store-contract.ts")?.includes("resource-identity.ts"), true);
  assert.equal(runtimeEdges.get("store-contract.ts")?.includes("leases.ts"), false,
    "the store may reference the lease types but must not load the module");
  // handoff.ts now shares the device predicate rather than keeping a second copy that drifted.
  assert.equal(runtimeEdges.get("handoff.ts")?.includes("host-path.ts"), true);

  // Depth-first over the whole graph, so a cycle added later fails here rather than at load time.
  const seen = new Set<string>();
  const walk = (module: string, stack: readonly string[]): void => {
    assert.equal(stack.includes(module), false, `runtime import cycle: ${[...stack, module].join(" -> ")}`);
    if (seen.has(module)) return;
    seen.add(module);
    for (const next of runtimeEdges.get(module) ?? []) walk(next, [...stack, module]);
  };
  for (const module of modules) walk(module, []);
});

test("the old import path still works, so nothing had to be rewritten to keep compiling", () => {
  assert.equal(reExported("C:\\wt-a"), "c:/wt-a", "store-contract re-exports the canonicaliser it used to own");
});

test("an alternate data stream is not a second name for a directory", () => {
  // Proven against the real filesystem by the reviewer: `wt-a`, `wt-a::$INDEX_ALLOCATION` and
  // `wt-a:$I30:$INDEX_ALLOCATION` share one dev/ino, list the same children and read the same files
  // — through Node and through cmd.exe. Unfolded they were three identifiable keys, three lock files
  // and two uncontested leases over one directory. This module already reasoned about ADS for the
  // device predicate and applied it nowhere else; identity is where it mattered.
  const held = claim("C:\\wt-a");
  assert.equal(held.ok, true);
  for (const stream of [
    "C:\\wt-a::$INDEX_ALLOCATION",
    "C:\\wt-a:$I30:$INDEX_ALLOCATION",
    "C:\\wt-a:stream",
    "C:\\wt-a\\file.txt:stream",
    "C:\\wt-a\\file.txt::$DATA",
    "\\\\server\\share:x\\y",
  ]) {
    const seen = inspectHostPath(stream);
    assert.equal(seen.pathClass, "INVALID", `${stream} does not name one place`);
    assert.equal(seen.identifiable, false);
    assert.equal(resourceIsIdentifiable("WORKTREE", stream), false, `${stream} is not leasable`);
    assert.equal(claimBySecondRun(stream, [held.lease!]).ok, false, `${stream} must not get a lease`);
    assert.equal(
      hostLockFileName({ kind: "WORKTREE", resourceKey: canonicalResource("WORKTREE", stream) }).ok,
      false,
      `${stream} must not name a lock file`,
    );
  }
  // The drive colon is still the drive colon.
  assert.equal(canonicalizeHostPath("C:\\wt-a"), "c:/wt-a");
});

test("a segment is folded before any predicate reads it", () => {
  // Win32 strips trailing dots and spaces before it resolves anything, so a predicate that runs on
  // the raw segment is asking about a string the OS will never see. The 8.3 check sat on the wrong
  // side of that fold: `AION-H~1` was refused as a generated alias while `AION-H~1.` passed as a
  // valid identity and took a second uncontested lease on the same directory — cmd.exe opens
  // `AION-H~1.\marker.txt` and reads the file. Asserted across every predicate rather than only the
  // one that was wrong, so a predicate added later cannot be placed on the wrong side either.
  for (const spelling of [
    "C:\\probe\\AION-H~1.",
    "C:\\probe\\AION-H~1 ",
    "C:\\probe\\AION-H~1. ",
    "C:\\probe\\aion-h~1..",
    "C:\\AION\\NUL.",
    "C:\\AION\\NUL ",
    "C:\\AION\\con. ",
    "C:\\AION\\LPT9.",
  ]) {
    const seen = inspectHostPath(spelling);
    assert.equal(seen.pathClass, "INVALID", `${spelling} must not survive by decoration`);
    assert.equal(isResolvedHostPath(spelling), false);
    assert.equal(resourceIsIdentifiable("WORKTREE", spelling), false);
  }
  // The undecorated spellings are refused too, so the fold closed a bypass rather than a whole class.
  assert.equal(inspectHostPath("C:\\probe\\AION-H~1").pathClass, "INVALID");
  assert.equal(inspectHostPath("C:\\AION\\NUL").pathClass, "INVALID");
  // And an ordinary name that merely ends in a dot still folds to the directory it names.
  assert.equal(canonicalizeHostPath("C:\\probe\\ordinary."), "c:/probe/ordinary");
});
