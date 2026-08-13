/**
 * Known-defect regressions for Windows host-resource identity.
 * Fail-closed. Live Node/Win32 probes. Naive slash+case fold must lose.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ACCEPTED_IDENTITY_CLASSES,
  PATH_CLASS,
  REJECTED_IDENTITY_CLASSES,
  classifyHostPath,
  defectiveSlashCaseKey,
  identityForExistingResource,
  identityForFutureLock,
  pathIsInside,
  resourceIdentity,
  segmentIsReservedDevice,
} from "./windows-resource-identity.mjs";
import { runWindowsPathProbes } from "./windows-path-probe.mjs";

const live = runWindowsPathProbes();

function probe(name) {
  return live.probes.find((p) => p.name === name);
}

test("live forward and backslash aliases share one existing-resource identity", () => {
  const p = probe("forward-backslash-aliases");
  assert.equal(p.ok, true, p.error);
  assert.equal(p.identitySame, true, JSON.stringify(p));
  assert.equal(p.realpathNative.backslash.toLowerCase(), p.realpathNative.forward.toLowerCase());
});

test("naive slash-fold is not identity: \\\\?\\ prefix must not mint a second key", () => {
  const p = probe("device-namespace-peel");
  assert.equal(p.ok, true, p.error);
  assert.equal(p.naiveSame, false, "if naive treats \\\\?\\ the same, this case is no longer a distinguisher");
  assert.equal(p.identitySame, true, "resolved identity must collide the namespace spelling");
});

test("drive-relative and rooted-driveless are not host identities", () => {
  const rel = probe("drive-relative");
  const rooted = probe("rooted-driveless");
  assert.equal(rel.classify.class, PATH_CLASS.DRIVE_RELATIVE);
  assert.equal(rel.accepted, false);
  assert.equal(rooted.classify.class, PATH_CLASS.ROOTED_DRIVELESS);
  assert.equal(rooted.accepted, false);
});

test("ADS colon forms are not host identities even when they look drive-absolute", () => {
  const ads = `${live.marker}:stream`;
  assert.equal(classifyHostPath(ads).reason, "ads-or-extra-colon");
  assert.equal(classifyHostPath(ads).acceptedForIdentity, false);
  assert.equal(pathIsInside(live.wt, ads).ok, false);
});

test("NUL, empty, and reserved devices are INVALID and cannot be leased", () => {
  assert.equal(classifyHostPath("").acceptedForIdentity, false);
  assert.equal(classifyHostPath("CON").class, PATH_CLASS.INVALID);
  assert.equal(classifyHostPath("nul.txt").class, PATH_CLASS.INVALID);
  assert.equal(classifyHostPath("COM1").reason, "reserved-device");
  assert.equal(classifyHostPath("LPT9.dat").class, PATH_CLASS.INVALID);
  assert.equal(classifyHostPath(`${live.wt}\0x`).reason, "nul");
  assert.equal(segmentIsReservedDevice("PRN"), true);
  assert.ok(!ACCEPTED_IDENTITY_CLASSES.includes(PATH_CLASS.INVALID));
});

test("malformed UNC and device namespace are not usable identities", () => {
  assert.equal(classifyHostPath("\\\\").reason, "malformed-unc");
  assert.equal(classifyHostPath("\\\\server").reason, "malformed-unc");
  assert.equal(classifyHostPath("\\\\?\\NUL").acceptedForIdentity, false);
  assert.equal(classifyHostPath("\\\\.\\CON").acceptedForIdentity, false);
  assert.ok(REJECTED_IDENTITY_CLASSES.includes(classifyHostPath("\\\\?\\C:\\foo").class));
});

test("no root never means all absolute paths allowed", () => {
  const p = probe("containment-no-root");
  assert.equal(p.inside, false);
  assert.equal(p.reason, "NO_ROOT_MEANS_DENY");
  assert.equal(pathIsInside(null, live.marker).reason, "NO_ROOT_MEANS_DENY");
});

test("sibling prefix C:\\foo vs C:\\foobar is outside", () => {
  const p = probe("sibling-prefix");
  assert.equal(p.markerInside.inside, true);
  assert.equal(p.siblingInside.inside, false);
});

test("containment rejects driveless, drive-relative, device, and NUL candidates", () => {
  assert.equal(pathIsInside(live.wt, "\\Users\\x").ok, false);
  assert.equal(pathIsInside(live.wt, "C:foo").ok, false);
  assert.equal(pathIsInside(live.wt, "CON").ok, false);
  assert.equal(pathIsInside(live.wt, `${live.marker}\0`).ok, false);
  assert.equal(pathIsInside("C:foo", live.marker).ok, false);
});

test("two alias spellings must not acquire two worktree leases", () => {
  const a = resourceIdentity("WORKTREE", { path: live.wt });
  const b = resourceIdentity("WORKTREE", { path: live.wt.replace(/\\/g, "/") });
  assert.equal(a.ok && b.ok, true);
  assert.equal(a.key, b.key);
  const naiveA = defectiveSlashCaseKey(live.wt);
  const naiveNs = defectiveSlashCaseKey(`\\\\?\\${live.wt}`);
  assert.notEqual(naiveA, naiveNs);
  const ns = resourceIdentity("WORKTREE", { path: `\\\\?\\${live.wt}` });
  assert.equal(ns.ok, true);
  assert.equal(ns.key, a.key);
});

test("BRANCH is repo+ref, not a filesystem spelling", () => {
  const a = resourceIdentity("BRANCH", { repositoryId: "personalasist1", refName: "executor/x" });
  const b = resourceIdentity("BRANCH", { repositoryId: "PERSONALASIST1", refName: "executor/X" });
  const wt = resourceIdentity("WORKTREE", { path: live.wt });
  assert.equal(a.key, b.key);
  assert.notEqual(a.key, wt.key);
});

test("INTEGRATION and PRODUCTION_WRITER are logical singletons", () => {
  const i1 = resourceIdentity("INTEGRATION", { repositoryId: "repo" });
  const i2 = resourceIdentity("INTEGRATION", { repositoryId: "repo" });
  const p1 = resourceIdentity("PRODUCTION_WRITER", { instanceId: "default" });
  const p2 = resourceIdentity("PRODUCTION_WRITER", { path: live.wt });
  assert.equal(i1.key, i2.key);
  assert.equal(p1.key, p2.key);
  assert.notEqual(i1.key, p1.key);
});

test("future lock identity is derived from an existing parent, not a future path string", () => {
  const lock = identityForFutureLock(live.wt, "director.lock");
  assert.equal(lock.ok, true);
  assert.equal(lock.kind, "FUTURE_LOCK_UNDER_EXISTING");
  assert.ok(lock.key.includes(identityForExistingResource(live.wt).key));
  assert.equal(identityForFutureLock(live.wt, "..\\escape.lock").ok, false);
  assert.equal(identityForFutureLock(live.wt, "CON").ok, false);
  assert.equal(identityForFutureLock("C:foo", "x.lock").ok, false);
});

test("dot-dot under an accepted absolute path resolves to the same worktree", () => {
  const p = probe("dot-dot");
  assert.equal(p.identitySame, true, JSON.stringify(p));
});

test("live reserved-device stats do not override INVALID classification", () => {
  const p = probe("reserved-devices");
  for (const d of p.devices) {
    assert.equal(d.classify.acceptedForIdentity, false, d.input);
  }
});

test("scratch lives outside Claude candidate and AION-HQ worktrees", () => {
  assert.ok(live.scratch.startsWith(os.tmpdir()));
  assert.ok(!/AION-HQ-claude-director/i.test(live.scratch));
  assert.equal(fs.existsSync(live.wt), true);
});
