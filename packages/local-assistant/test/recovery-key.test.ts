/**
 * Automatic recovery-key regressions.
 *
 * The property that matters is asymmetric: backups must work with zero Owner interaction, while the
 * key must never reach the backup drive, the manifest, or the ciphertext. These tests pin both
 * halves, plus the compatibility guarantee that adopting the legacy passphrase keeps older
 * artifacts restorable rather than silently stranding them.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureRecoveryKey,
  rotateRecoveryKey,
  loadRecoveryKey,
  candidateKeyMaterials,
  generateRecoveryKeyMaterial,
  generateKeyId,
  identityOf,
  buildRecoveryKeyPackage,
  keyMaterialMatches,
  RECOVERY_KEY_BITS,
  RECOVERY_KEY_ALGORITHM,
} from "../src/recovery-key.js";
import { resolvePrivateBackupPassphrase } from "../src/private-backup-key.js";
import { NodePrivateBackupV1, createEmptyStateV1 } from "../src/adapters.js";
import { collectRecoveryPackage } from "../src/recovery-package.js";

const NOW = "2026-08-12T01:00:00.000Z";

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "aion-key-"));
  mkdirSync(join(root, "secrets"), { recursive: true });
  return root;
}

test("recovery key is 256-bit CSPRNG material, not derived from anything guessable", () => {
  const a = generateRecoveryKeyMaterial();
  const b = generateRecoveryKeyMaterial();
  assert.notEqual(a, b, "two generations must differ");
  assert.equal(Buffer.from(a, "base64url").length, RECOVERY_KEY_BITS / 8);
  // No host/user/time-derived substrings.
  for (const probe of [process.env.USERNAME ?? "user", "DESKTOP", "2026", "aion"]) {
    assert.ok(!a.toLowerCase().includes(String(probe).toLowerCase()), `key must not embed ${probe}`);
  }
});

test("keyId is independent of key material, so publishing it leaks nothing", () => {
  const root = freshRoot();
  try {
    const rec = ensureRecoveryKey(root, NOW);
    assert.equal(rec.algorithm, RECOVERY_KEY_ALGORITHM);
    assert.ok(!rec.key.includes(rec.keyId));
    assert.ok(!rec.keyId.includes(rec.key));
    const ids = new Set(Array.from({ length: 50 }, () => generateKeyId()));
    assert.equal(ids.size, 50, "key ids must not collide");
    // Identity is the only shape allowed to travel.
    assert.equal((identityOf(rec) as unknown as Record<string, unknown>).key, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("backup key resolves automatically with no Owner passphrase", () => {
  const root = freshRoot();
  const prior = process.env.AION_PRIVATE_BACKUP_PASSPHRASE;
  delete process.env.AION_PRIVATE_BACKUP_PASSPHRASE;
  try {
    const resolved = resolvePrivateBackupPassphrase(root);
    assert.equal(resolved.source, "recovery_key");
    assert.ok((resolved.passphrase ?? "").length >= 12);
    assert.ok(resolved.keyId);
  } finally {
    if (prior !== undefined) process.env.AION_PRIVATE_BACKUP_PASSPHRASE = prior;
    rmSync(root, { recursive: true, force: true });
  }
});

test("a pre-existing legacy passphrase is adopted, not replaced, so old artifacts still restore", () => {
  const root = freshRoot();
  try {
    const legacy = "legacy-passphrase-material-0123456789";
    writeFileSync(join(root, "secrets", "private-backup-passphrase.local"), `${legacy}\n`);
    const rec = ensureRecoveryKey(root, NOW);
    assert.equal(rec.origin, "adopted-legacy");
    assert.ok(keyMaterialMatches(rec.key, legacy), "adopted key must equal the legacy material");
    assert.ok(candidateKeyMaterials(root).includes(legacy));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rotation keeps the previous key so historical backups are never stranded", () => {
  const root = freshRoot();
  try {
    const first = ensureRecoveryKey(root, NOW);
    const rotated = rotateRecoveryKey(root, NOW);
    assert.equal(rotated.keyVersion, first.keyVersion + 1);
    assert.notEqual(rotated.keyId, first.keyId);
    const candidates = candidateKeyMaterials(root);
    assert.ok(candidates.includes(first.key), "rotated-out key must remain available for restore");
    assert.equal(loadRecoveryKey(root)!.keyVersion, rotated.keyVersion);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("key material never appears in the manifest, the ciphertext, or the off-disk artifact", async () => {
  const root = freshRoot();
  const exportRoot = join(root, "exports");
  mkdirSync(exportRoot, { recursive: true });
  try {
    const rec = ensureRecoveryKey(root, NOW);
    const port = new NodePrivateBackupV1(exportRoot);
    const state = { ...createEmptyStateV1(), revision: 11 };
    const pkg = collectRecoveryPackage(root, NOW);
    const manifest = { ...pkg.manifest, keyId: rec.keyId, keyVersion: rec.keyVersion, keySource: "recovery_key" };
    const dest = join(exportRoot, "k.aionbak");
    await port.createPackage(state, pkg.sidecars, manifest, dest, rec.key);

    const onDisk = readFileSync(dest, "utf8");
    assert.ok(!onDisk.includes(rec.key), "key material must never appear in the artifact");
    assert.ok(JSON.stringify(manifest).includes(rec.keyId), "keyId is safe metadata and should be recorded");
    assert.ok(!JSON.stringify(manifest).includes(rec.key), "manifest must not carry key material");

    const restored = await port.restorePackage(dest, rec.key);
    assert.equal(restored.state.revision, 11);
    assert.equal((restored.manifest as { keyId?: string }).keyId, rec.keyId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the independent key package carries the key but refuses to be a backup-drive artifact", () => {
  const root = freshRoot();
  try {
    const rec = ensureRecoveryKey(root, NOW);
    const pkg = buildRecoveryKeyPackage(rec, NOW);
    assert.equal(pkg.format, "aion.recovery-key-package.v1");
    assert.equal(pkg.identity.keyId, rec.keyId);
    assert.ok(pkg.key.length >= 32, "the transport package is the copy that survives C: loss");
    assert.ok(
      pkg.instructions.some((i) => /AION-backups/i.test(i)),
      "instructions must warn against co-locating the key with the backups",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an artifact restores from the independent key alone, without the local key file", async () => {
  const root = freshRoot();
  const exportRoot = join(root, "exports");
  mkdirSync(exportRoot, { recursive: true });
  try {
    const rec = ensureRecoveryKey(root, NOW);
    const independentCopy = buildRecoveryKeyPackage(rec, NOW).key;
    const port = new NodePrivateBackupV1(exportRoot);
    const state = { ...createEmptyStateV1(), revision: 99 };
    const dest = join(exportRoot, "d.aionbak");
    await port.createPackage(state, { marker: true }, { keyId: rec.keyId }, dest, rec.key);

    // Simulate total loss of the desktop key path: remove the local key files entirely.
    rmSync(join(root, "secrets", "recovery-key.local.json"), { force: true });
    rmSync(join(root, "secrets", "private-backup-passphrase.local"), { force: true });
    assert.ok(!existsSync(join(root, "secrets", "recovery-key.local.json")));

    const restored = await port.restorePackage(dest, independentCopy);
    assert.equal(restored.state.revision, 99, "independent key alone must decrypt the artifact");
    assert.equal((restored.sidecars as { marker?: boolean }).marker, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recovery key files are confined to the private secrets boundary", () => {
  const root = freshRoot();
  try {
    ensureRecoveryKey(root, NOW);
    assert.ok(existsSync(join(root, "secrets", "recovery-key.local.json")));
    // `.local` / `secrets/` live under the gitignored private root; nothing is written elsewhere.
    assert.ok(!existsSync(join(root, "recovery-key.local.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
