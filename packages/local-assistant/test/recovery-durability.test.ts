/**
 * Recovery durability regressions.
 *
 * These cover the failure modes that make a backup *look* fine and still not restore the system:
 * a missing Gmail cursor (forcing a full rescan), credential material silently riding along in the
 * payload, a manifest that does not say what it excluded, an off-disk copy that drifted from the
 * local one, and a retention policy that prunes the last good recovery point.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectRecoveryPackage,
  redactOAuthMetadata,
  findSecretKeyPaths,
  restoredCursorSeenIdCount,
  RECOVERY_PACKAGE_VERSION,
} from "../src/recovery-package.js";
import { planBackupRetention, DEFAULT_BACKUP_RETENTION } from "../src/backup-retention.js";
import { NodePrivateBackupV1, createEmptyStateV1 } from "../src/adapters.js";

const SEEN_IDS = Array.from({ length: 105 }, (_, i) => `msg-${i}`);

function makeDataRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "aion-recovery-"));
  mkdirSync(join(root, "secrets"), { recursive: true });
  mkdirSync(join(root, "pilot"), { recursive: true });
  writeFileSync(
    join(root, "secrets", "gmail-scan-state.local.json"),
    JSON.stringify({ version: 1, seenMessageIds: SEEN_IDS, totalScanned: 105, lastQuery: "q", updatedAt: "2026-08-12T00:00:00.000Z" }),
  );
  writeFileSync(
    join(root, "secrets", "gmail-oauth.local.json"),
    JSON.stringify({
      version: 1, updatedAt: "2026-08-12T00:00:00.000Z",
      clientId: "1234567890-abc.apps.googleusercontent.com",
      clientSecretEnc: "ENCRYPTED-SECRET-VALUE",
      refreshTokenEnc: "ENCRYPTED-REFRESH-VALUE",
      scopes: ["gmail.readonly"], connectedAt: "2026-08-12T00:00:00.000Z", lastSyncAt: "2026-08-12T00:00:00.000Z",
    }),
  );
  writeFileSync(join(root, "secrets", "machine-key.local"), "machine-key-material-should-never-travel");
  writeFileSync(join(root, "secrets", "private-backup-passphrase.local"), "passphrase-should-never-travel");
  writeFileSync(join(root, "pilot", "pilot-days.local.json"), JSON.stringify({ days: [{ day: 1 }] }));
  writeFileSync(join(root, "machine-role.json"), JSON.stringify({ machine: "TEST", DESKTOP_PRIMARY: true }));
  return root;
}

test("recovery package includes the Gmail scan cursor so recovery does not restart from zero", () => {
  const root = makeDataRoot();
  try {
    const pkg = collectRecoveryPackage(root, "2026-08-12T00:00:00.000Z");
    assert.equal(pkg.manifest.version, RECOVERY_PACKAGE_VERSION);
    assert.ok(pkg.manifest.includedPaths.includes("secrets/gmail-scan-state.local.json"));
    assert.equal(restoredCursorSeenIdCount(pkg.sidecars), 105);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recovery package never carries secret material", () => {
  const root = makeDataRoot();
  try {
    const pkg = collectRecoveryPackage(root, "2026-08-12T00:00:00.000Z");
    const serialized = JSON.stringify(pkg.sidecars);
    assert.ok(!serialized.includes("ENCRYPTED-SECRET-VALUE"), "client secret must not appear");
    assert.ok(!serialized.includes("ENCRYPTED-REFRESH-VALUE"), "refresh token must not appear");
    assert.ok(!serialized.includes("machine-key-material-should-never-travel"), "machine key must not appear");
    assert.ok(!serialized.includes("passphrase-should-never-travel"), "backup passphrase must not appear");
    // Scan each sidecar's contents, mirroring how the collector guards itself. The map keys are
    // file paths (some under `secrets/`) and are not themselves secret material.
    for (const [rel, value] of Object.entries(pkg.sidecars)) {
      assert.deepEqual(findSecretKeyPaths(value), [], `${rel} must contain no secret-shaped keys`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("OAuth continuity metadata survives while encrypted fields are dropped", () => {
  const meta = redactOAuthMetadata({
    clientId: "id.apps.googleusercontent.com",
    clientSecretEnc: "nope",
    refreshTokenEnc: "nope",
    scopes: ["a"],
    connectedAt: "t",
  });
  assert.equal(meta.clientId, "id.apps.googleusercontent.com");
  assert.deepEqual(meta.scopes, ["a"]);
  assert.equal(meta.clientSecretEnc, undefined);
  assert.equal(meta.refreshTokenEnc, undefined);
});

test("manifest states both what was included and what was deliberately excluded", () => {
  const root = makeDataRoot();
  try {
    const pkg = collectRecoveryPackage(root, "2026-08-12T00:00:00.000Z");
    assert.ok(pkg.manifest.excludedPaths.some((p) => p.includes("machine-key.local")));
    assert.ok(pkg.manifest.excludedPaths.some((p) => p.includes("private-backup-passphrase.local")));
    assert.ok(pkg.manifest.excludedPaths.some((p) => p.includes("authority-v2")));
    for (const entry of pkg.manifest.entries) {
      assert.ok(entry.reason.length > 0, `entry ${entry.path} must record a reason`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("encrypted recovery package round-trips state and cursor, and v1 artifacts still restore", async () => {
  const root = makeDataRoot();
  const exportRoot = join(root, "exports");
  mkdirSync(exportRoot, { recursive: true });
  try {
    const port = new NodePrivateBackupV1(exportRoot);
    const state = { ...createEmptyStateV1(), revision: 42 };
    const pkg = collectRecoveryPackage(root, "2026-08-12T00:00:00.000Z");

    const v2Path = join(exportRoot, "pkg.aionbak");
    await port.createPackage(state, pkg.sidecars, pkg.manifest, v2Path, "passphrase-1234567890");
    const restored = await port.restorePackage(v2Path, "passphrase-1234567890");
    assert.equal(restored.version, "aion.private-backup.v2");
    assert.equal(restored.state.revision, 42);
    assert.equal(restoredCursorSeenIdCount(restored.sidecars), 105);
    // Ciphertext must not leak plaintext secrets or cursor contents onto disk.
    const onDisk = readFileSync(v2Path, "utf8");
    assert.ok(!onDisk.includes("ENCRYPTED-SECRET-VALUE"));
    assert.ok(!onDisk.includes("msg-0\""));

    // Backward compatibility: a v1 artifact still restores through the same port.
    const v1Path = join(exportRoot, "legacy.aionbak");
    await port.create(state, v1Path, "passphrase-1234567890");
    const legacy = await port.restorePackage(v1Path, "passphrase-1234567890");
    assert.equal(legacy.version, "aion.private-backup.v1");
    assert.equal(legacy.state.revision, 42);
    assert.deepEqual(legacy.sidecars, {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("off-disk copy integrity is detectable by digest comparison", async () => {
  const root = makeDataRoot();
  const exportRoot = join(root, "exports");
  mkdirSync(exportRoot, { recursive: true });
  try {
    const port = new NodePrivateBackupV1(exportRoot);
    const state = { ...createEmptyStateV1(), revision: 7 };
    const p = join(exportRoot, "a.aionbak");
    await port.createPackage(state, {}, { version: RECOVERY_PACKAGE_VERSION }, p, "passphrase-1234567890");
    const original = readFileSync(p, "utf8");
    const copy = join(exportRoot, "b.aionbak");
    writeFileSync(copy, original);
    assert.equal(readFileSync(copy, "utf8"), original, "faithful copy matches byte for byte");

    // A corrupted off-disk copy must fail integrity, not silently restore.
    const corrupted = join(exportRoot, "c.aionbak");
    writeFileSync(corrupted, original.replace(/"stateDigest":"[0-9a-f]{8}/, '"stateDigest":"deadbeef'));
    await assert.rejects(() => port.restorePackage(corrupted, "passphrase-1234567890"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("retention never removes the newest, the newest verified, or the only off-disk recovery point", () => {
  const artifacts = [
    { path: "local-old", modifiedMs: 1, verified: true, offDisk: false },
    ...Array.from({ length: 30 }, (_, i) => ({ path: `local-${i}`, modifiedMs: 100 + i, verified: false, offDisk: false })),
    { path: "offdisk-only", modifiedMs: 5, verified: true, offDisk: true },
  ];
  const plan = planBackupRetention(artifacts, DEFAULT_BACKUP_RETENTION);
  const prunedPaths = plan.prune.map((p) => p.artifact.path);

  const newest = [...artifacts].sort((a, b) => b.modifiedMs - a.modifiedMs)[0]!;
  assert.ok(!prunedPaths.includes(newest.path), "newest artifact must survive");
  assert.ok(!prunedPaths.includes("offdisk-only"), "only off-disk copy must survive");
  assert.ok(!prunedPaths.includes("local-old"), "newest verified local artifact must survive");
  assert.ok(plan.prune.length > 0, "unbounded growth must still be bounded");
  for (const { reason } of plan.prune) assert.ok(reason.length > 0);
});

test("retention with few artifacts prunes nothing", () => {
  const plan = planBackupRetention([
    { path: "a", modifiedMs: 2, verified: true, offDisk: false },
    { path: "b", modifiedMs: 1, verified: false, offDisk: false },
  ]);
  assert.equal(plan.prune.length, 0);
  assert.equal(plan.keep.length, 2);
});
