/**
 * R6.5.1 unit/synthetic tests for provisioned presence + installed composition.
 * Real OS install is verified separately by installed-instance harness.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import {
  ProvisionedOwnerPresence,
  UnprovisionedRealOwnerPresence,
  OperatorHost,
  envelopeDigest,
  buildUnsignedEnvelope,
  ElevatedOperatorBroker,
  ManifestBrokerIntegrityPort,
  StaticHostFactsPort,
  StaticRepositoryFactsPort,
  StaticGitFactsPort,
  writeOwnerApprovalRequest,
  drainOwnerApprovalInbox,
} from "../src/index.js";
import {
  BASELINE,
  MACHINE,
  ROLE,
  REPO,
  ORIGIN,
  defaultFacts,
  tempStore,
} from "./helpers.js";

test("R6.5.1 provisioned presence approve+verify exact digest", () => {
  const presence = new ProvisionedOwnerPresence(randomBytes(32));
  const digest = "ab".repeat(32);
  const proof = presence.approveEnvelopeDigest(digest, "2026-08-09T20:00:00.000Z");
  assert.equal(proof.kind, "provisioned_owner_hmac_v1");
  assert.equal(presence.verify(digest, proof), true);
  assert.equal(presence.verify("cd".repeat(32), proof), false);
});

test("R6.5.1 activated host requires provisioned presence", () => {
  const { dir, cleanup } = tempStore();
  try {
    assert.throws(
      () =>
        new OperatorHost({
          storeDir: dir,
          activationMode: "activated",
          presence: new UnprovisionedRealOwnerPresence(),
          ...defaultFacts(),
        }),
      /ProvisionedOwnerPresence|activated host/,
    );
  } finally {
    cleanup();
  }
});

test("R6.5.1/R6.5.2 activated host ownerAuthorize binds digest+nonce", () => {
  const { dir, cleanup } = tempStore();
  try {
    const presence = new ProvisionedOwnerPresence(randomBytes(32));
    const host = new OperatorHost({
      storeDir: dir,
      activationMode: "activated",
      presence,
      ...defaultFacts(),
    });
    const envelope = buildUnsignedEnvelope({
      directiveId: "AION-V1.3-R6.5.1-TEST",
      agentRole: "GROK_BUILD",
      repositoryRoot: REPO,
      canonicalOrigin: ORIGIN,
      baselineCommit: BASELINE,
      machineRole: ROLE,
      machineName: MACHINE,
      authorizedOperations: ["host.read", "repo.read"],
      expiresAtUtc: "2099-01-01T00:00:00.000Z",
      issuedAtUtc: "2026-08-09T00:00:00.000Z",
    });
    host.submitPending(envelope);
    assert.throws(() => host.ownerAuthorize(envelope.authorizationId, "", "x"), /digest/);
    const challenge = host.beginOwnerApprovalChallenge(envelope.authorizationId);
    const authorized = host.ownerAuthorize(
      envelope.authorizationId,
      challenge.digest,
      challenge.nonce,
    );
    assert.equal(authorized.approvalProof?.kind, "provisioned_owner_hmac_v1");
    assert.equal(envelopeDigest(authorized), challenge.digest);
  } finally {
    cleanup();
  }
});

test("R6.5.2 owner-approval-inbox parse + drain", () => {
  const { dir, cleanup } = tempStore();
  try {
    const inbox = join(dir, "inbox");
    writeOwnerApprovalRequest(inbox, {
      schemaVersion: "aion.owner-approval-inbox.v1",
      authorizationId: "auth_test",
      envelopeDigest: "ab".repeat(32),
      approvalNonce: "nonce1",
      directiveId: "DIR",
      repositoryRoot: REPO,
      requestedAtUtc: new Date().toISOString(),
      helperPid: 1,
      elevated: true,
    });
    const drained = drainOwnerApprovalInbox(inbox);
    assert.equal(drained.length, 1);
    assert.equal(drained[0]!.authorizationId, "auth_test");
    assert.equal(drainOwnerApprovalInbox(inbox).length, 0);
  } finally {
    cleanup();
  }
});

test("R6.5.1 installed broker TEMP write effect + protected refuse", () => {
  const { dir, cleanup } = tempStore();
  try {
    const presence = new ProvisionedOwnerPresence(randomBytes(32));
    const material = "r651-integrity";
    const integrity = new ManifestBrokerIntegrityPort({ x: material }, () => ({ x: material }));
    const envelope = buildUnsignedEnvelope({
      directiveId: "AION-V1.3-R6.5.1-TEST",
      agentRole: "GROK_BUILD",
      repositoryRoot: REPO,
      canonicalOrigin: ORIGIN,
      baselineCommit: BASELINE,
      machineRole: ROLE,
      machineName: MACHINE,
      authorizedOperations: ["host.read", "repo.edit", "powershell.repo_operation"],
      expiresAtUtc: "2099-01-01T00:00:00.000Z",
      issuedAtUtc: "2026-08-09T00:00:00.000Z",
      riskClass: "ELEVATED_HOST",
    });
    // Attach approval via presence for broker loadEnvelope
    const host = new OperatorHost({
      storeDir: dir,
      activationMode: "activated",
      presence,
      ...defaultFacts(),
    });
    host.submitPending(envelope);
    const ch = host.beginOwnerApprovalChallenge(envelope.authorizationId);
    host.ownerAuthorize(envelope.authorizationId, ch.digest, ch.nonce);
    const rec = host.getStore().get(envelope.authorizationId)!;

    const broker = new ElevatedOperatorBroker({
      brokerVersion: "0.1.0-r651",
      activated: true,
      installed: true,
      presence,
      loadEnvelope: (id) => (id === rec.envelope.authorizationId ? rec.envelope : null),
      hostFacts: new StaticHostFactsPort({ machineName: MACHINE, machineRole: ROLE }),
      repositoryFacts: new StaticRepositoryFactsPort({
        repositoryRoot: REPO,
        canonicalOrigin: ORIGIN,
        branch: "main",
        headCommit: BASELINE,
      }),
      gitFacts: new StaticGitFactsPort({
        repositoryRoot: REPO,
        headCommit: BASELINE,
        branch: "main",
        canonicalOrigin: ORIGIN,
        originMainCommit: BASELINE,
        workingTreeClean: true,
      }),
      integrity,
      replayStateDir: join(dir, "replay"),
    });

    const target = join(tmpdir(), `aion-r651-synth-${randomBytes(4).toString("hex")}.txt`);
    const digest = envelopeDigest(rec.envelope);
    const allow = broker.handle({
      schemaVersion: "aion.elevated-broker.request.v1",
      requestId: randomBytes(8).toString("hex"),
      authorizationId: rec.envelope.authorizationId,
      agentRole: "GROK_BUILD",
      operation: "filesystem.authorized_admin_write",
      repositoryRoot: REPO,
      machineName: MACHINE,
      args: { path: target, content: "r651-ok\n" },
      envelopeDigest: digest,
      requestedAtUtc: new Date().toISOString(),
    });
    assert.equal(allow.outcome, "ALLOW", allow.reason);
    assert.match(allow.reasonCode, /allow/i);

    const refuseProtected = broker.handle({
      schemaVersion: "aion.elevated-broker.request.v1",
      requestId: randomBytes(8).toString("hex"),
      authorizationId: rec.envelope.authorizationId,
      agentRole: "GROK_BUILD",
      operation: "filesystem.authorized_admin_write",
      repositoryRoot: REPO,
      machineName: MACHINE,
      args: {
        path: "C:\\Program Files\\AION\\ElevatedOperatorBroker\\bin\\aion-elevated-broker.exe",
        content: "nope",
      },
      envelopeDigest: digest,
      requestedAtUtc: new Date().toISOString(),
    });
    assert.equal(refuseProtected.outcome, "REFUSE");
    assert.match(refuseProtected.reasonCode, /protected|broker/i);

    const high = broker.handle({
      schemaVersion: "aion.elevated-broker.request.v1",
      requestId: randomBytes(8).toString("hex"),
      authorizationId: rec.envelope.authorizationId,
      agentRole: "GROK_BUILD",
      operation: "host.read_security",
      repositoryRoot: REPO,
      machineName: MACHINE,
      args: {},
      envelopeDigest: digest,
      requestedAtUtc: new Date().toISOString(),
      highConsequenceIntent: "bitlocker",
    });
    assert.equal(high.outcome, "REFUSE");
    assert.equal(high.reasonCode, "high-consequence");
  } finally {
    cleanup();
  }
});

test("R6.5.1 unprovisioned still fails closed", () => {
  const p = new UnprovisionedRealOwnerPresence();
  assert.throws(
    () => p.approveEnvelopeDigest("ab".repeat(32), new Date().toISOString()),
    /not provisioned|unprovisioned|Founder remains/i,
  );
});

void mkdtempSync;
void writeFileSync;
void mkdirSync;
void rmSync;
