/**
 * The hostile set, pushed through the only gate that decides what may be read.
 *
 * These are written from the outside in. Each case is a way out of an approved root — a parent step,
 * an absolute path, a link whose target is elsewhere, a folder deeper than the Owner agreed to, a
 * device name that Win32 resolves ahead of the filesystem — and the assertion is always the same
 * shape: refused, with a reason, without throwing.
 *
 * The link cases matter most, because they are the ones no amount of string analysis can catch. A
 * link that lives inside the root and points outside it is spelled like every other child.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  enumerateApprovedFiles,
  entryDepth,
  inspectRelativeEntry,
  matchesScope,
  resolveWithinSource,
} from "../src/path-boundary.js";
import { FakeFs, makeSource } from "./fixtures.js";

function rootedFs(): FakeFs {
  return new FakeFs()
    .addDir("c:/pc-test/root")
    .addDir("c:/pc-test/outside")
    .addFile("c:/pc-test/root/a.json", "{}", 1000)
    .addFile("c:/pc-test/root/nested/b.json", "{}", 2000)
    .addFile("c:/pc-test/root/nested/deeper/c.json", "{}", 3000)
    .addFile("c:/pc-test/outside/secret.json", "{}", 4000);
}

test("a parent step is refused before the filesystem is touched", () => {
  const fs = rootedFs();
  const decision = resolveWithinSource(makeSource(), "../outside/secret.json", fs);
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false ? decision.reason : null, "TRAVERSAL_ESCAPE");
});

test("a parent step buried mid-path is refused too", () => {
  const fs = rootedFs();
  for (const entry of ["nested/../../outside/secret.json", "nested/..", "a/b/../../../x"]) {
    const decision = resolveWithinSource(makeSource(), entry, fs);
    assert.equal(decision.allowed, false, entry);
    assert.equal(decision.allowed === false ? decision.reason : null, "TRAVERSAL_ESCAPE", entry);
  }
});

test("an absolute path outside the root is refused, in every Windows spelling", () => {
  const fs = rootedFs();
  for (const entry of ["c:/pc-test/outside/secret.json", "\\pc-test\\outside", "c:outside", "/etc/passwd"]) {
    const decision = resolveWithinSource(makeSource(), entry, fs);
    assert.equal(decision.allowed, false, entry);
    assert.equal(decision.allowed === false ? decision.reason : null, "ABSOLUTE_ENTRY", entry);
  }
});

test("a link out of the root is refused when links are not followed", () => {
  const fs = rootedFs().addLink("c:/pc-test/root/escape", "c:/pc-test/outside");
  const decision = resolveWithinSource(makeSource({ followSymlinksAllowed: false }), "escape", fs);
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false ? decision.reason : null, "SYMLINK_NOT_ALLOWED");
});

test("a link out of the root is still refused when links ARE followed, because the target is outside", () => {
  const fs = rootedFs().addLink("c:/pc-test/root/escape", "c:/pc-test/outside");
  const decision = resolveWithinSource(makeSource({ followSymlinksAllowed: true }), "escape", fs);
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false ? decision.reason : null, "RESOLVED_OUTSIDE_ROOT");
});

test("a link that stays inside the root is allowed when links are followed", () => {
  const fs = rootedFs().addLink("c:/pc-test/root/alias", "c:/pc-test/root/nested");
  const decision = resolveWithinSource(makeSource({ followSymlinksAllowed: true }), "alias", fs);
  assert.equal(decision.allowed, true);
  assert.equal(decision.allowed === true ? decision.wasSymbolicLink : null, true);
});

test("recursion is refused entirely when the source does not permit it", () => {
  const fs = rootedFs();
  const decision = resolveWithinSource(makeSource({ recursiveAllowed: false }), "nested/b.json", fs);
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false ? decision.reason : null, "RECURSION_NOT_ALLOWED");
});

test("depth is bounded even when recursion is permitted", () => {
  const fs = rootedFs();
  const source = makeSource({ recursiveAllowed: true, maxDepth: 2 });
  assert.equal(resolveWithinSource(source, "nested/b.json", fs).allowed, true);
  const tooDeep = resolveWithinSource(source, "nested/deeper/c.json", fs);
  assert.equal(tooDeep.allowed, false);
  assert.equal(tooDeep.allowed === false ? tooDeep.reason : null, "DEPTH_EXCEEDED");
});

test("a denied scope wins over an allowed one", () => {
  const fs = rootedFs();
  const source = makeSource({ allowedScope: ["nested"], deniedScope: ["nested/deeper"] });
  assert.equal(resolveWithinSource(source, "nested/b.json", fs).allowed, true);
  const denied = resolveWithinSource(source, "nested/deeper/c.json", fs);
  assert.equal(denied.allowed, false);
  assert.equal(denied.allowed === false ? denied.reason : null, "DENIED_SCOPE");
  const outside = resolveWithinSource(source, "a.json", fs);
  assert.equal(outside.allowed, false);
  assert.equal(outside.allowed === false ? outside.reason : null, "OUTSIDE_ALLOWED_SCOPE");
});

test("shapes that never name a legitimate child are refused without touching the disk", () => {
  for (const entry of ["", "   ", ".", "..", "a\u0000b"]) {
    assert.notEqual(inspectRelativeEntry(entry), null, JSON.stringify(entry));
  }
  assert.equal(inspectRelativeEntry("nested/b.json"), null);
});

test("a device name or an alternate data stream is refused by the reused host-path predicate", () => {
  const fs = rootedFs().addFile("c:/pc-test/root/nul", "{}", 5000).addFile("c:/pc-test/root/a.json:hidden", "{}", 6000);
  for (const entry of ["nul", "NUL", "a.json:hidden"]) {
    const decision = resolveWithinSource(makeSource(), entry, fs);
    assert.equal(decision.allowed, false, entry);
  }
});

test("a source root that does not name one fixed place is refused outright", () => {
  const fs = rootedFs();
  for (const location of ["", "root", "\\root", "c:root"]) {
    const decision = resolveWithinSource(makeSource({ location }), "a.json", fs);
    assert.equal(decision.allowed, false, location);
    assert.equal(decision.allowed === false ? decision.reason : null, "ROOT_NOT_IDENTIFIABLE", location);
  }
});

test("scope matching and depth counting agree with the spellings on disk", () => {
  assert.equal(matchesScope("Nested/B.json", ["nested"]), true);
  assert.equal(matchesScope("nestedother/b.json", ["nested"]), false);
  assert.equal(matchesScope("anything", []), true);
  assert.equal(entryDepth("a.json"), 1);
  assert.equal(entryDepth("nested/deeper/c.json"), 3);
});

test("enumeration walks only the approved root and records what it refused", () => {
  const fs = rootedFs().addLink("c:/pc-test/root/escape", "c:/pc-test/outside");
  const result = enumerateApprovedFiles(makeSource(), fs);

  assert.deepEqual(
    result.files.map((file) => file.relativePath).sort(),
    ["a.json", "nested/b.json", "nested/deeper/c.json"],
  );
  assert.equal(result.files.every((file) => !file.resolvedPath.includes("outside")), true);
  assert.equal(result.denials.some((denial) => denial.reason === "SYMLINK_NOT_ALLOWED"), true);
  assert.equal(result.truncatedBy, null);
});

test("enumeration stops at the file ceiling and says which ceiling stopped it", () => {
  const fs = rootedFs();
  const result = enumerateApprovedFiles(makeSource({ maxFiles: 2 }), fs);
  assert.equal(result.files.length, 2);
  assert.equal(result.truncatedBy, "MAX_FILES");
});

test("enumeration stops at the byte ceiling too", () => {
  const fs = new FakeFs()
    .addDir("c:/pc-test/root")
    .addFile("c:/pc-test/root/a.json", "x".repeat(40), 1000)
    .addFile("c:/pc-test/root/b.json", "y".repeat(40), 1000);
  const result = enumerateApprovedFiles(makeSource({ maxBytes: 50 }), fs);
  assert.equal(result.files.length, 1);
  assert.equal(result.truncatedBy, "MAX_BYTES");
});

test("a single-file source is its own root and needs no walk", () => {
  const fs = rootedFs();
  const result = enumerateApprovedFiles(
    makeSource({ sourceType: "APPROVED_LOCAL_FILE", location: "c:/pc-test/root/a.json" }),
    fs,
  );
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0]?.relativePath, ".");
});

test("an unresolvable root produces a denial rather than an exception", () => {
  const fs = rootedFs();
  const result = enumerateApprovedFiles(makeSource({ location: "c:/pc-test/missing" }), fs);
  assert.equal(result.files.length, 0);
  assert.equal(result.denials[0]?.reason, "ROOT_UNRESOLVABLE");
});
