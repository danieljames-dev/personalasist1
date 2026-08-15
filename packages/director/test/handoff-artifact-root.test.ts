/**
 * The artifact root is a containment promise, and these tests are the reason it cannot fail open.
 *
 * The parser used to map an `artifactRoot` of "" or "   " to "no root supplied" and carry on with a
 * traversal scan. Both readings pass a green suite, because the paths a caller sends in tests are
 * honest; the difference only shows when a report names a file the run does not own. The empty root
 * is the shape produced by joining a run directory that turned out undefined, or by reading a blank
 * config value — exactly when the caller most believes containment is being enforced.
 *
 * The second half is the mirror defect: with no root supplied, an absolute path used to face nothing
 * but a ".." scan, which "C:\\Windows\\System32\\config\\SAM" passes unchanged. "Nobody said where
 * artifacts live" is not "every path on this machine is an artifact".
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  parseHandoff, artifactPathWithinRoot, HANDOFF_SCHEMA_V1,
} from "../src/handoff.js";

const NOW = "2026-08-13T12:00:00.000Z";
const LATER = "2026-08-13T12:30:00.000Z";
const ARTIFACT_ROOT = "C:\\AION\\director\\runs\\r1";

/** A complete, honest report. Every case below changes exactly one thing about it. */
function goodHandoff(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: HANDOFF_SCHEMA_V1,
    executor: "claude",
    missionId: "m1",
    runId: "r1",
    branch: "executor/claude-director-v01",
    headBefore: "a".repeat(40),
    headAfter: "b".repeat(40),
    status: "PASS",
    tests: [{ suite: "director", total: 42, passed: 42, failed: 0, skipped: 0 }],
    productionMutated: false,
    spendUsd: 0,
    requiresOwner: false,
    nextRecommendedGate: null,
    artifacts: ["logs/build.txt"],
    startedAt: NOW,
    finishedAt: LATER,
    capacityStatus: "AVAILABLE",
    runNonce: "nonce-r1",
    summary: "closed the artifact root defect",
    ...over,
  };
}

const handoffJson = (over: Record<string, unknown> = {}) => JSON.stringify(goodHandoff(over));

/** The path that proves the difference: outside the root, but with no ".." to catch it. */
const SIBLING_RUN = "C:\\AION\\director\\runs\\r2\\stolen.txt";

// ---------------------------------------------------------------------------
// A supplied root that cannot be enforced is an error, never "no root"
// ---------------------------------------------------------------------------

test("an empty artifactRoot is a validation error, not a silent downgrade", () => {
  const result = parseHandoff(handoffJson(), { artifactRoot: "" });
  assert.equal(result.ok, false, "an empty root must not be accepted as if none was supplied");
  assert.equal(result.handoff, null, "a rejected handoff must not also be returned");
  assert.match(result.problems.join("; "), /artifactRoot was supplied but is empty/);
});

test("a whitespace-only artifactRoot is a validation error", () => {
  const result = parseHandoff(handoffJson(), { artifactRoot: "   " });
  assert.equal(result.ok, false, "trimming to nothing is still nothing to confine artifacts to");
  assert.match(result.problems.join("; "), /artifactRoot was supplied but is empty/);
});

test("an unusable artifactRoot does not fall back to the weaker check", () => {
  // The defect that mattered: with the empty root read as "none", this path was accepted because it
  // contains no ".." — the caller asked for containment and got a traversal scan.
  for (const root of ["", "   ", "\t\n", "runs/r1", "..\\runs\\r1"]) {
    const result = parseHandoff(handoffJson({ artifacts: [SIBLING_RUN] }), { artifactRoot: root });
    assert.equal(result.ok, false, `root ${JSON.stringify(root)} must not let ${SIBLING_RUN} through`);
  }
});

test("a relative artifactRoot is refused with its own message", () => {
  const result = parseHandoff(handoffJson(), { artifactRoot: "runs/r1" });
  assert.equal(result.ok, false, "a relative root names a different directory per working directory");
  // The message now comes from the shared host-path predicate rather than this module's own second
  // opinion about what an absolute path is — one rule, one answer, one sentence.
  assert.match(result.problems.join("; "), /artifactRoot runs\/r1 does not name one directory on this host/);
});

test("an unusable root is reported once, as itself", () => {
  // Not as one "resolves outside the permitted artifact root" per artifact: that blames the
  // executor's paths for the caller's option, and the retry policy counts problems.
  const result = parseHandoff(
    handoffJson({ artifacts: ["logs/a.txt", "logs/b.txt", "logs/c.txt"] }),
    { artifactRoot: "  " },
  );
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 1, result.problems.join("; "));
  assert.match(result.problems[0]!, /artifactRoot/);
});

// ---------------------------------------------------------------------------
// No root at all still refuses absolute paths
// ---------------------------------------------------------------------------

test("with no root supplied, an absolute artifact path is refused", () => {
  for (const absolute of [
    "C:\\Windows\\System32\\config\\SAM",
    "/etc/shadow",
    "c:/aion/other-run/out.txt",
    "\\\\server\\share\\remote.txt",
    "C:logs\\drive-relative.txt",
  ]) {
    const result = parseHandoff(handoffJson({ artifacts: [absolute] }));
    assert.equal(result.ok, false, `${absolute} must not pass merely because no root was supplied`);
    assert.match(result.problems.join("; "), /absolute path and no artifact root was established/);
  }
});

test("with no root supplied, a plain relative artifact path is still accepted", () => {
  // The fix must not turn every existing caller that omits the root into a failed run.
  const result = parseHandoff(handoffJson({ artifacts: ["logs/build.txt", "out\\report.html"] }));
  assert.equal(result.ok, true, result.problems.join("; "));
  assert.deepEqual(result.handoff?.artifacts, ["logs/build.txt", "out\\report.html"]);
});

test("with no root supplied, traversal and bare directory names are still refused", () => {
  const traversal = parseHandoff(handoffJson({ artifacts: ["../../.ssh/id_rsa"] }));
  assert.equal(traversal.ok, false);
  assert.match(traversal.problems.join("; "), /contains a \.\. segment/);

  // "." resolves to the artifact directory itself, which anything trusting the list would copy whole.
  const directory = parseHandoff(handoffJson({ artifacts: ["./"] }));
  assert.equal(directory.ok, false, "a path resolving to no segments names no file");
  assert.match(directory.problems.join("; "), /names a directory rather than a file/);
});

// ---------------------------------------------------------------------------
// A usable root confines paths after canonical resolution
// ---------------------------------------------------------------------------

test("a valid root accepts an artifact contained in it", () => {
  for (const inside of [
    "logs/build.txt",
    "logs\\build.txt",
    "./logs/./build.txt",
    "C:\\AION\\director\\runs\\r1\\logs\\build.txt",
    "c:/aion/DIRECTOR/runs/R1/out.txt",
  ]) {
    const result = parseHandoff(handoffJson({ artifacts: [inside] }), { artifactRoot: ARTIFACT_ROOT });
    assert.equal(result.ok, true, `${inside} is inside the root: ${result.problems.join("; ")}`);
  }
});

test("a valid root refuses a sibling run that shares its prefix", () => {
  // Containment is per segment, not per character: "runs\\r1" is not a prefix of "runs\\r10" as
  // directories, and a string startsWith check would hand run r1's reader run r10's files.
  for (const sibling of [SIBLING_RUN, "C:\\AION\\director\\runs\\r10\\x.txt", "D:\\elsewhere.txt"]) {
    const result = parseHandoff(handoffJson({ artifacts: [sibling] }), { artifactRoot: ARTIFACT_ROOT });
    assert.equal(result.ok, false, `${sibling} is not inside ${ARTIFACT_ROOT}`);
    assert.match(result.problems.join("; "), /outside the permitted artifact root/);
  }
});

test("a valid root refuses a parent traversal that lands above it", () => {
  for (const climb of ["../r2/build.txt", "..", "logs/../../r2/build.txt", "../../../etc/passwd"]) {
    const result = parseHandoff(handoffJson({ artifacts: [climb] }), { artifactRoot: ARTIFACT_ROOT });
    assert.equal(result.ok, false, `${climb} climbs out of the run's directory`);
  }
});

test("a mixed-separator escape is refused, because the filesystem reads both", () => {
  // A check that only understood "/" would pass these on Windows, which is the host that matters.
  for (const mixed of [
    "logs\\../../r2/stolen.txt",
    "logs/..\\..\\r2\\stolen.txt",
    "logs\\..\\..\\..\\..\\Windows\\System32\\config\\SAM",
  ]) {
    const result = parseHandoff(handoffJson({ artifacts: [mixed] }), { artifactRoot: ARTIFACT_ROOT });
    assert.equal(result.ok, false, `${mixed} escapes the root once both separators are honoured`);
    assert.match(result.problems.join("; "), /outside the permitted artifact root/);
  }
  assert.equal(artifactPathWithinRoot(ARTIFACT_ROOT, "logs\\../../r2/stolen.txt"), false);
});

test("the root itself is not an artifact in the root", () => {
  const result = parseHandoff(handoffJson({ artifacts: [ARTIFACT_ROOT] }), { artifactRoot: ARTIFACT_ROOT });
  assert.equal(result.ok, false, "the root names a directory, not a file inside it");
});

// ---------------------------------------------------------------------------
// The honest case is untouched
// ---------------------------------------------------------------------------

test("a good handoff still parses with a valid root, fences and prose included", () => {
  const wrapped = `Here is my report:\n\`\`\`json\n${handoffJson()}\n\`\`\`\nThanks.`;
  const result = parseHandoff(wrapped, { artifactRoot: ARTIFACT_ROOT });
  assert.equal(result.ok, true, result.problems.join("; "));
  assert.deepEqual(result.problems, []);
  const handoff = result.handoff;
  assert.ok(handoff, "a parsed handoff must be returned");
  assert.deepEqual(handoff.artifacts, ["logs/build.txt"]);
  assert.equal(handoff.status, "PASS");
  assert.equal(handoff.productionMutated, false);
  assert.equal(handoff.spendUsd, 0);
});

test("omitting artifactRoot entirely is still a supported call", () => {
  // `undefined` means "the caller has nothing to add", which is different from offering a root that
  // cannot be enforced; only the second is an error.
  const result = parseHandoff(handoffJson(), { expectedMissionId: "m1", expectedRunId: "r1" });
  assert.equal(result.ok, true, result.problems.join("; "));
  assert.deepEqual(result.handoff?.artifacts, ["logs/build.txt"]);
});

test("a share on another host is not the local directory that spells the same segments", () => {
  // `normalizePath` reduced a UNC path to the same shape as a slash-rooted local one — the leading
  // `//` vanished because the segment loop skips empty parts — so containment could not tell them
  // apart. Neither path has a `..` in it, which is why the traversal scan never saw it.
  // A driveless root is now refused outright — it is anchored to the current drive, which is process
  // state — so the UNC-vs-local confusion is asserted against roots that are actually acceptable.
  assert.equal(artifactPathWithinRoot("/AION/runs/r1", "/AION/runs/r1/log.txt"), false,
    "a driveless root is anchored to whatever drive the process happens to be on");
  assert.equal(
    artifactPathWithinRoot("C:\\AION\\runs\\r1", "\\\\AION\\runs\\r1\\payload.exe"), false,
    "a remote SMB location is not inside a local root",
  );
  assert.equal(
    artifactPathWithinRoot("\\\\aion-nas\\runs\\r1", "C:\\aion-nas\\runs\\r1\\x.txt"), false,
    "and the mirror: a local path is not inside a remote share",
  );
  // Both spellings still contain their own kind, so the distinction costs nothing honest.
  assert.equal(artifactPathWithinRoot("C:\\AION\\runs\\r1", "C:\\AION\\runs\\r1\\log.txt"), true);
  assert.equal(artifactPathWithinRoot("\\\\aion-nas\\runs\\r1", "\\\\aion-nas\\runs\\r1\\log.txt"), true);
});

test("a reserved device name is not a file in the run", () => {
  // Win32 resolves CON/NUL/AUX/PRN/COM1-9/LPT1-9 ahead of the filesystem in *every* directory, with
  // or without an extension, so "logs/CON" is textually inside the root and passes every containment
  // test while what opens is the console. Trailing dots and spaces are stripped by the OS first.
  for (const device of ["logs/CON", "CON", "NUL", "logs\\aux.txt", "COM1", "logs/LPT9.log", "logs/CON. "]) {
    const rooted = parseHandoff(handoffJson({ artifacts: [device] }), { artifactRoot: ARTIFACT_ROOT });
    assert.equal(rooted.ok, false, `${device} must be refused with a root`);
    assert.match(rooted.problems.join("; "), /reserved Windows device/);
    const rootless = parseHandoff(handoffJson({ artifacts: [device] }), {});
    assert.equal(rootless.ok, false, `${device} must be refused with no root either`);
  }
  // A name that merely starts with a device name is an ordinary file and stays legal.
  for (const ordinary of ["logs/console.txt", "logs/nullify.log", "logs/com10.txt"]) {
    const result = parseHandoff(handoffJson({ artifacts: [ordinary] }), { artifactRoot: ARTIFACT_ROOT });
    assert.equal(result.ok, true, `${ordinary}: ${result.problems.join("; ")}`);
  }
});

test("an artifact root must name one directory by the same rule paths are judged by", () => {
  // Every spelling below was accepted here while host-path.ts called it INVALID — a share-less UNC,
  // the device namespace, and a root ending in a reserved device. "\\aion-nas" then reported
  // "\\aion-nas\c$\Windows\System32\config\SAM" as contained, and a "...\NUL" root makes every
  // artifact write vanish into the null device while reporting success. Two predicates for one
  // question is the same defect class as two device-name predicates was.
  for (const root of [
    "\\\\aion-nas",
    "\\\\aion-nas\\",
    "\\\\NUL\\share",
    "\\\\?\\NUL",
    "\\\\.\\NUL",
    "\\\\?\\relative\\x",
    "\\\\?\\GLOBALROOT\\Device\\HarddiskVolume3",
    "C:\\AION\\runs\\NUL",
    "C:\\AION\\runs\\r1:stream",
    "C:runs\\r1",
    "\\AION\\runs\\r1",
  ]) {
    const result = parseHandoff(handoffJson(), { artifactRoot: root });
    assert.equal(result.ok, false, `root ${JSON.stringify(root)} must be refused`);
    assert.equal(result.handoff, null, "a rejected handoff must not also be returned");
  }
  // A real UNC share with both components, and a real drive root, still work.
  assert.equal(
    parseHandoff(handoffJson(), { artifactRoot: "\\\\aion-nas\\runs" }).ok, true,
    "a share with a server and a share name is usable",
  );
  assert.equal(parseHandoff(handoffJson(), { artifactRoot: ARTIFACT_ROOT }).ok, true);
});
