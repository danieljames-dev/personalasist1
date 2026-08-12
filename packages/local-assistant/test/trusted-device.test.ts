/**
 * Trusted-device session and authorization contract.
 *
 * Reachability (LAN/Tailscale) is never authentication. Pair once → session token digests
 * survive restarts; revoked / unknown tokens fail closed.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authenticate,
  digestSecret,
  issuePairingToken,
  pruneAccess,
  redeemPairingCode,
  revokeDevice,
} from "../src/access.js";
import {
  AionAssistantV1,
  DeterministicClockV1,
  DeterministicIdGeneratorV1,
  DeterministicModelProviderV1,
  FileStateRepositoryV1,
  InMemoryStateRepositoryV1,
  LocalArchiveImportSourceV1,
  LocalEchoCapabilityV1,
  NodePrivateBackupV1,
  SelectableDeveloperAgentRegistryV1,
  StaticCapabilityRegistryV1,
  SyntheticDeveloperAgentBridgeV1,
} from "../src/index.js";
import { createEmptyStateV1 } from "../src/adapters.js";

function ports(repository: InMemoryStateRepositoryV1 | FileStateRepositoryV1, exportsRoot: string, epoch?: number) {
  return {
    repository,
    clock: new DeterministicClockV1(epoch ?? Date.parse("2030-01-01T00:00:00.000Z")),
    ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(),
    backup: new NodePrivateBackupV1(exportsRoot),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  };
}

async function serviceFixture() {
  const root = await mkdtemp(join(tmpdir(), "aion-trust-"));
  const exportsRoot = join(root, "exports");
  await mkdir(exportsRoot);
  const service = new AionAssistantV1(ports(new InMemoryStateRepositoryV1(), exportsRoot));
  return { service, root };
}

test("paired device authenticates; unknown and revoked tokens are blocked", () => {
  const state = createEmptyStateV1();
  state.settings.remoteAccess.enabled = true;
  const now = "2030-01-01T00:00:00.000Z";
  const { code } = issuePairingToken(state, "Owner iPhone", "pairing-1", now);
  const { token, device, session } = redeemPairingCode(
    state,
    code,
    { deviceId: "device-1", sessionId: "session-1" },
    now,
    90,
  );

  const ok = authenticate(state, token, now);
  assert.ok(ok);
  assert.equal(ok!.device.id, device.id);
  assert.equal(ok!.session.id, session.id);

  assert.equal(authenticate(state, "totally-unknown-token-value-xxxxxxxx", now), null);
  assert.equal(authenticate(state, "short", now), null);

  revokeDevice(state, device.id, "2030-01-01T01:00:00.000Z");
  assert.equal(authenticate(state, token, "2030-01-01T01:00:01.000Z"), null);
});

test("same token authorizes repeated use without re-pairing", () => {
  const state = createEmptyStateV1();
  state.settings.remoteAccess.enabled = true;
  const now = "2030-06-01T12:00:00.000Z";
  const { code } = issuePairingToken(state, "Phone", "p1", now);
  const { token } = redeemPairingCode(state, code, { deviceId: "d1", sessionId: "s1" }, now, 30);
  for (let i = 0; i < 5; i++) {
    assert.ok(authenticate(state, token, now), `attempt ${i + 1} must succeed`);
  }
  assert.throws(() => redeemPairingCode(state, code, { deviceId: "d2", sessionId: "s2" }, now, 30));
});

test("session digests survive state reload (production restart equivalent)", async () => {
  const root = await mkdtemp(join(tmpdir(), "aion-trust-file-"));
  const dataRoot = join(root, "private", "aion");
  const exportsRoot = join(root, "exports");
  await mkdir(dataRoot, { recursive: true });
  await mkdir(exportsRoot);

  const first = new AionAssistantV1(ports(new FileStateRepositoryV1(dataRoot), exportsRoot));
  await first.updateSettings({ remoteAccess: { enabled: true, bindAddress: "127.0.0.1", sessionDays: 90 } });
  const issued = await first.createPairingCode("Restart Phone");
  const paired = await first.pairDevice(issued.code, "pair:test");
  assert.ok(paired.token.length >= 20);

  const before = await first.authenticateDevice(paired.token);
  assert.ok(before);
  assert.equal(before!.label, "Restart Phone");

  const reloaded = new AionAssistantV1(
    ports(new FileStateRepositoryV1(dataRoot), exportsRoot, Date.parse("2030-01-01T00:10:00.000Z")),
  );
  const after = await reloaded.authenticateDevice(paired.token);
  assert.ok(after, "token must remain valid after restart");
  assert.equal(after!.deviceId, before!.deviceId);

  await reloaded.revokeDevice(after!.deviceId);
  assert.equal(await reloaded.authenticateDevice(paired.token), null);
});

test("service pair → auth → second call; revoke blocks", async () => {
  const { service } = await serviceFixture();
  await service.updateSettings({ remoteAccess: { enabled: true, bindAddress: "127.0.0.1", sessionDays: 30 } });
  const { code } = await service.createPairingCode("Lot Phone");
  const first = await service.pairDevice(code, "pair:a");
  assert.ok(await service.authenticateDevice(first.token));
  assert.ok(await service.authenticateDevice(first.token), "second request without re-pair");

  await service.revokeDevice(first.deviceId);
  assert.equal(await service.authenticateDevice(first.token), null);
});

test("only digests are stored — raw token is not in state", async () => {
  const { service } = await serviceFixture();
  await service.updateSettings({ remoteAccess: { enabled: true, bindAddress: "127.0.0.1", sessionDays: 30 } });
  const { code } = await service.createPairingCode("Secret Check");
  const paired = await service.pairDevice(code, "pair:b");
  const snap = await service.snapshot();
  const blob = JSON.stringify(snap);
  assert.equal(blob.includes(paired.token), false, "session token must never appear in state");
  assert.equal(blob.includes(code), false, "pairing code must never appear in state");
  assert.ok(snap.sessions.some((s) => s.tokenHash === digestSecret(paired.token)));
});

test("expired sessions fail closed after prune", () => {
  const state = createEmptyStateV1();
  state.settings.remoteAccess.enabled = true;
  const issuedAt = "2030-01-01T00:00:00.000Z";
  const { code } = issuePairingToken(state, "Temp", "p-exp", issuedAt);
  const { token } = redeemPairingCode(
    state,
    code,
    { deviceId: "d-exp", sessionId: "s-exp" },
    issuedAt,
    1,
  );
  assert.ok(authenticate(state, token, "2030-01-01T12:00:00.000Z"));
  assert.equal(authenticate(state, token, "2030-01-03T00:00:01.000Z"), null);
  pruneAccess(state, "2030-01-03T00:00:01.000Z");
  assert.equal(authenticate(state, token, "2030-01-03T00:00:02.000Z"), null);
});
