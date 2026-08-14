/**
 * One sweep for the defect class that has produced every failure in this package so far.
 *
 * Four adversarial gates found nine real defects and all nine were the same shape: a set of accepted
 * values enumerated correctly, and the *boundary* around it left open. `NUL` refused and `NUL:`
 * accepted. A path class relabelled rather than removed from acceptance. `PRODUCTION_OBSERVATIONS`
 * indexed bare, so `toString` answered for a production observation. A deployment guarded at one
 * transition row while another edge routed around it.
 *
 * Each was fixed individually, and each fix was itself reviewed and found to have the same hole one
 * spelling further along. The pattern is not carelessness about any one input — it is that the tests
 * were written from the inside out, asserting that the accepted values are accepted. This file works
 * the other way: it takes every exported predicate that decides an authority question and pushes the
 * hostile boundary through it, mechanically, without knowing what any individual answer should be.
 *
 * The rule it enforces is uniform and weak on purpose, so it stays true as the package grows:
 * **a predicate that decides identity, permission or containment must never say yes to a value from
 * the hostile set, and must never throw.** No case here needs updating when a new legitimate value is
 * added; it only fails when a new door opens.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { inspectHostPath, isResolvedHostPath, pathIsInside, namesReservedDevice } from "../src/host-path.js";
import { canonicalResource, resourceIsIdentifiable, IDENTITY_MODEL, type LeaseKindV1 } from "../src/resource-identity.js";
import { hostLockFileName } from "../src/store-contract.js";
import { advance, MISSION_STATES, TERMINAL_STATES, type MissionStateV1, type MissionContextV1 } from "../src/mission.js";
import { parseHandoff, artifactPathWithinRoot } from "../src/handoff.js";

/**
 * Values that must never be accepted as anything, whatever the question.
 *
 * Grouped by how they get in, because that is what makes the list reviewable: each group is a way a
 * string reaches this package from somewhere that is not a programmer's keyboard.
 */
const HOSTILE: readonly unknown[] = [
  // Inherited object keys. A bare `MAP[value]` answers for all of these; that is how an event named
  // "toString" wrote a Function into deployment truth and erased production uncertainty.
  "__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty",
  "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "__defineGetter__", "__lookupGetter__",
  // Nothing, or nothing after trimming.
  "", " ", "   ", "\t", "\n", "\r\n", "\t\n ",
  // Control bytes. Win32 native APIs terminate at a NUL, so the validated string and the opened
  // string stop being the same string.
  "\u0000", "a\u0000b", "C:/wt-a\u0000", "\u0001", "a\u001fb", "a\u007fb",
  // Alternate data streams: text-decidable aliases that reach the same directory.
  "C:\\wt-a:stream", "C:\\wt-a::$INDEX_ALLOCATION", "C:\\wt-a:$I30:$INDEX_ALLOCATION", "x.txt::$DATA",
  // Reserved devices, in every spelling Win32 resolves to the device.
  "NUL", "nul", "NUL:", "NUL.txt", "NUL::$DATA", "CON", "CON.", "CON. ", "COM1", "LPT9.log",
  "logs/NUL", "logs\\con", "C:\\AION\\NUL",
  // Anchors that are invisible process state.
  "C:", "C:wt-a", "C:..\\wt-a", "\\wt-a", "/wt-a", "wt-a", "wt-a/sub", "../wt-a", "..", "a/..",
  // Malformed UNC, and the device namespace as ordinary input.
  "\\\\", "\\\\server", "\\\\server\\", "\\\\..\\..\\x", "\\\\.\\.\\x", "\\\\\\share\\x",
  "\\\\?\\NUL", "\\\\.\\NUL", "\\\\?\\relative\\x", "\\\\?\\GLOBALROOT\\Device\\HarddiskVolume3",
  // Wrong types entirely. These arrive from JSON.parse and from recovered records.
  null, undefined, 0, 1, false, true, {}, [], ["C:/wt-a"], { path: "C:/wt-a" }, () => "C:/wt-a", Symbol("x"),
  Number.NaN, Infinity, -0,
];

/** Runs `f` and reports what it did, converting a throw into a distinguishable outcome. */
function outcome<T>(f: () => T): { threw: boolean; value: T | undefined; error: unknown } {
  try {
    return { threw: false, value: f(), error: null };
  } catch (error) {
    return { threw: true, value: undefined, error };
  }
}

/**
 * Inherited object keys are legal Windows filenames.
 *
 * They belong in the hostile set for every predicate that *indexes a map* with a value, and they do
 * not belong here: `logs/__proto__` is an ordinary file, and refusing it would fail honest runs to
 * defend against nothing. The distinction is deliberate rather than a weakening — a downstream
 * consumer that keys an object by artifact name has a prototype-pollution problem of its own, which
 * is that consumer's guard to write, not a reason for containment to reject a real name here.
 */
/**
 * Values that are legitimate as a ref or a role name even though they are useless as a host path.
 *
 * `wt-a` is a perfectly ordinary branch name; it appears in the hostile set because it cannot
 * identify a *directory*, which is a different question. Keeping the one hostile list and narrowing
 * it per predicate is deliberate — the alternative is a separate list per function, which is how the
 * device predicate and the path predicate drifted apart in the first place.
 */
const LEGAL_TOKEN_NAMES = new Set(["wt-a", "wt-a/sub"]);

const LEGAL_FILENAMES = new Set([
  "__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty",
  "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "__defineGetter__", "__lookupGetter__",
  "wt-a", "wt-a/sub",
]);

const describe = (value: unknown): string =>
  typeof value === "symbol" ? "Symbol(x)" : typeof value === "function" ? "() => …" : JSON.stringify(value) ?? String(value);

// ---------------------------------------------------------------------------
// Host path identity
// ---------------------------------------------------------------------------

test("no hostile value is ever an identifiable host path, and none throws", () => {
  for (const value of HOSTILE) {
    const seen = outcome(() => inspectHostPath(value as string));
    assert.equal(seen.threw, false, `inspectHostPath(${describe(value)}) threw: ${String(seen.error)}`);
    assert.equal(seen.value?.identifiable, false, `inspectHostPath(${describe(value)}) claimed to name a place`);

    const resolved = outcome(() => isResolvedHostPath(value as string));
    assert.equal(resolved.threw, false, `isResolvedHostPath(${describe(value)}) threw`);
    assert.equal(resolved.value, false, `isResolvedHostPath(${describe(value)}) said yes`);
  }
});

test("no hostile value is inside anything, and nothing is inside a hostile value", () => {
  // Both directions, because `false` is the safe answer for one reading of containment and the
  // permissive answer for the other — a caller asking "is the store root outside every worktree"
  // must not read `false` as clearance from an operand that could not be placed.
  for (const value of HOSTILE) {
    const asCandidate = outcome(() => pathIsInside(value as string, "C:/AION/director"));
    assert.equal(asCandidate.threw, false, `pathIsInside(${describe(value)}, root) threw`);
    assert.equal(asCandidate.value, false, `${describe(value)} was reported inside a real root`);

    const asAncestor = outcome(() => pathIsInside("C:/AION/director/runs/r1", value as string));
    assert.equal(asAncestor.threw, false, `pathIsInside(child, ${describe(value)}) threw`);
    assert.equal(asAncestor.value, false, `${describe(value)} was reported to contain a real path`);
  }
});

// ---------------------------------------------------------------------------
// Lease and lock identity, for every kind
// ---------------------------------------------------------------------------

test("no hostile value is an identifiable resource for any lease kind, and none names a lock file", () => {
  // Swept over the kinds rather than a chosen few: PREVIEW and PRODUCTION_WRITER were originally
  // omitted from the path rules, which is how `../p` and `..\p` became two uncontested claims on one
  // directory. A kind added later is covered here the day it is added.
  const kinds = Object.keys(IDENTITY_MODEL) as LeaseKindV1[];
  assert.ok(kinds.length >= 5, "every lease kind must be swept");
  for (const kind of kinds) {
    for (const value of HOSTILE) {
      // A plain token is a legal branch name AND a legal role name; it is only useless as a *path*.
      // Narrowing the one hostile list per predicate keeps a single reviewable list, rather than a
      // separate list per function, which is how two predicates for one rule drifted apart before.
      if (IDENTITY_MODEL[kind] !== "HOST_PATH" && typeof value === "string" && LEGAL_TOKEN_NAMES.has(value)) continue;
      const identifiable = outcome(() => resourceIsIdentifiable(kind, value as string));
      assert.equal(identifiable.threw, false, `resourceIsIdentifiable(${kind}, ${describe(value)}) threw`);
      assert.equal(identifiable.value, false, `${kind} accepted ${describe(value)} as an identity`);

      const key = outcome(() => canonicalResource(kind, value as string));
      assert.equal(key.threw, false, `canonicalResource(${kind}, ${describe(value)}) threw`);
      assert.equal(key.value, "", `${kind} produced a lease key ${describe(key.value)} for ${describe(value)}`);

      const lock = outcome(() => hostLockFileName({ kind, resourceKey: key.value ?? "" }));
      assert.equal(lock.threw, false, `hostLockFileName(${kind}, ${describe(value)}) threw`);
      assert.equal(lock.value?.ok, false, `${kind} derived a lock file for ${describe(value)}`);
      assert.equal(lock.value?.fileName, null);
    }
  }
});

// ---------------------------------------------------------------------------
// Mission authority
// ---------------------------------------------------------------------------

const UNCERTAIN: MissionContextV1 = {
  unresolvedRequiredGates: 0,
  unsatisfiedMandatoryWorkItems: 0,
  independentWorkRemains: false,
  postIntegrationVerificationPassed: true,
  postDeployVerificationPassed: true,
  deploymentDependenciesSatisfied: true,
  deploymentAuthorityPresent: true,
  productionWriterLeaseAvailable: true,
  // The writer's release is its own fact; the maximal context proves it so that deployment truth is
  // the only thing left that can refuse a move.
  productionWriterLeaseReleasedByThisRun: true,
  deploymentTruth: "MAY_HAVE_WRITTEN",
};

test("no hostile event moves a mission, writes deployment truth, or throws", () => {
  // The defect this generalises: `advance(state, "toString")` returned ok:true and set
  // deploymentTruth to a function, which a faithful caller persists, JSON.stringify drops, and the
  // reload defaults back to NOT_STARTED — production uncertainty erased by a string nobody defined.
  for (const state of MISSION_STATES) {
    if (TERMINAL_STATES.includes(state)) continue;
    for (const value of HOSTILE) {
      const moved = outcome(() => advance(state, value as never, null, { context: UNCERTAIN }));
      assert.equal(moved.threw, false, `advance(${state}, ${describe(value)}) threw: ${String(moved.error)}`);
      assert.equal(moved.value?.ok, false, `${state} accepted event ${describe(value)}`);
      assert.equal(moved.value?.to, null, `${state} moved on event ${describe(value)}`);
      assert.equal(moved.value?.deploymentTruth, null, `${describe(value)} wrote deployment truth from ${state}`);
      assert.equal(typeof moved.value?.reason, "string", "a refusal must still explain itself");
    }
  }
});

test("no hostile state is a legal origin, resume target or interruption origin", () => {
  for (const value of HOSTILE) {
    const from = outcome(() => advance(value as MissionStateV1, "PLAN_SELECTED", null, { context: UNCERTAIN }));
    assert.equal(from.threw, false, `advance(${describe(value)}, PLAN_SELECTED) threw`);
    assert.equal(from.value?.ok, false, `${describe(value)} was accepted as a mission state`);

    const resumed = outcome(() => advance("PAUSED", "MISSION_RESUMED", value as MissionStateV1, { context: UNCERTAIN }));
    assert.equal(resumed.threw, false, `resume to ${describe(value)} threw`);
    assert.equal(resumed.value?.ok, false, `${describe(value)} was accepted as a resume target`);

    const recovered = outcome(() => advance("INTERRUPTED", "GIT_VERIFIED", null, {
      context: UNCERTAIN, interruptedFrom: value as MissionStateV1,
    }));
    assert.equal(recovered.threw, false, `recovery from ${describe(value)} threw`);
    assert.equal(recovered.value?.ok, false, `${describe(value)} was accepted as an interruption origin`);
  }
});

// ---------------------------------------------------------------------------
// Artifact containment
// ---------------------------------------------------------------------------

test("no hostile value is a usable artifact root, and none is contained in a real one", () => {
  const REAL_ROOT = "C:\\AION\\director\\runs\\r1";
  for (const value of HOSTILE) {
    // `undefined` is the one legitimate member of the hostile list here: it is how a caller says "I
    // have nothing to add", which is different from offering a root that cannot be enforced. Every
    // other value — including `null`, which is what JSON.parse yields for an absent key — is an error.
    if (value === undefined) continue;
    const parsed = outcome(() => parseHandoff(REPORT, { artifactRoot: value as string }));
    assert.equal(parsed.threw, false, `parseHandoff(root=${describe(value)}) threw`);
    assert.equal(parsed.value?.ok, false, `root ${describe(value)} was accepted`);
    assert.equal(parsed.value?.handoff, null, "a rejected handoff must not also be returned");

    // Containment is asked only about values that are not legal relative filenames: `logs/__proto__`
    // really is inside the run root, and asserting otherwise would be asserting a bug.
    const contained = outcome(() => artifactPathWithinRoot(REAL_ROOT, value as string));
    assert.equal(contained.threw, false, `artifactPathWithinRoot(root, ${describe(value)}) threw`);
    if (typeof value === "string" && LEGAL_FILENAMES.has(value)) continue;
    assert.equal(contained.value, false, `${describe(value)} was reported inside the run root`);
  }
});


test("no hostile value is accepted as an artifact path under a real root", () => {
  for (const value of HOSTILE) {
    if (typeof value !== "string" || value === "") continue; // non-strings are covered by the field's own type check
    if (LEGAL_FILENAMES.has(value)) continue;
    const parsed = outcome(() => parseHandoff(reportWith([value]), { artifactRoot: "C:\\AION\\director\\runs\\r1" }));
    assert.equal(parsed.threw, false, `artifact ${describe(value)} threw`);
    assert.equal(parsed.value?.ok, false, `artifact ${describe(value)} was accepted`);
  }
});

test("the reserved-device predicate covers the class in every directory", () => {
  for (const device of ["NUL", "nul", "NUL:", "NUL.txt", "NUL::$DATA", "CON", "CON.", "CON. ", "COM1", "LPT9.log"]) {
    assert.equal(namesReservedDevice(device), true, `${JSON.stringify(device)} is a device`);
    assert.equal(namesReservedDevice(`logs/${device}`), true, `${JSON.stringify(device)} is a device anywhere`);
    assert.equal(namesReservedDevice(`C:\\AION\\runs\\r1\\${device}`), true, `${JSON.stringify(device)} under a root`);
  }
  for (const ordinary of ["console.txt", "nullify.log", "com10.txt", "auxiliary", "content"]) {
    assert.equal(namesReservedDevice(ordinary), false, `${ordinary} is a real name`);
  }
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function reportWith(artifacts: unknown[]): string {
  return JSON.stringify({
    schema: "aion.director.handoff.v1",
    executor: "claude",
    missionId: "m1",
    runId: "r1",
    branch: "executor/claude-director-v01",
    headBefore: "a".repeat(40),
    headAfter: "b".repeat(40),
    status: "PASS",
    tests: [{ suite: "director", total: 1, passed: 1, failed: 0, skipped: 0 }],
    productionMutated: false,
    spendUsd: 0,
    requiresOwner: false,
    nextRecommendedGate: null,
    artifacts,
    startedAt: "2026-08-13T12:00:00.000Z",
    finishedAt: "2026-08-13T12:30:00.000Z",
    capacityStatus: "AVAILABLE",
    summary: "boundary sweep fixture",
  });
}

const REPORT = reportWith(["logs/build.txt"]);
