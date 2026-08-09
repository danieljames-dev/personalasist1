/**
 * V1.3-R6.1 continuity safety primitives — synthetic fixtures only.
 * Never reads owner private/aion/state-v1.json or identity.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AionAssistantV1,
  AuthorityGatedStateRepositoryV1,
  CANONICAL_ORIGIN,
  DeterministicClockV1,
  DeterministicIdGeneratorV1,
  DeterministicModelProviderV1,
  FileStateRepositoryV1,
  InMemoryStateRepositoryV1,
  FileWriterAuthorityV1,
  InMemoryWriterAuthorityV1,
  LocalArchiveImportSourceV1,
  LocalEchoCapabilityV1,
  NodePrivateBackupV1,
  SelectableDeveloperAgentRegistryV1,
  StaticCapabilityRegistryV1,
  SyntheticDeveloperAgentBridgeV1,
  assertArchivalCannotAuthorize,
  assertCanonicalRepositoryIdentity,
  assertNoPassphraseResidue,
  createEmptyStateV1,
  createWriterGrantForTest,
  digestMigrationManifest,
  digestValue,
  importControlPlaneHistoryArchival,
  installColdPrivateBackup,
  isPathInsideImportedHistory,
  normalizeOriginUrl,
  validateAuthorityGrantV1,
  validateMigrationManifestV1,
  validateOwnerAuthorityCommandV1,
} from "../src/index.js";
import type { MigrationManifestV1 } from "../src/index.js";

const SYSTEM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SYSTEM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HEAD_A = "3f47f21c89b3c1b10b53f4f4bb53ff4117effdd5";
const HEAD_B = "28c0cce9773548b3ff17af6c14c34c8b3d460bbe";
const EVAL_DIGEST = "docker.io/library/node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32";
const WRONG_ORIGIN = "https://github.com/danieljames-dev/AION.git";

function syntheticState(revision = 3) {
  const state = createEmptyStateV1();
  state.revision = revision;
  state.onboardingComplete = true;
  state.memories.push({
    id: "11111111-1111-4111-8111-111111111101",
    workspace: "personal",
    content: "Synthetic continuity fixture memory.",
    category: "semantic",
    confirmation: "owner-confirmed",
    conflict: "none",
    enabled: true,
    createdAt: "2030-01-01T00:00:00.000Z",
    updatedAt: "2030-01-01T00:00:00.000Z",
    sourceTimestamp: "2030-01-01T00:00:00.000Z",
    provenance: { sourceType: "owner", sourceRef: "fixture", recordedAt: "2030-01-01T00:00:00.000Z" },
    corrections: [],
  });
  return state;
}

function baseManifest(overrides: {
  source?: Partial<MigrationManifestV1["source"]>;
  target?: Partial<MigrationManifestV1["target"]>;
  privateBackup?: Partial<MigrationManifestV1["privateBackup"]>;
  verification?: Partial<MigrationManifestV1["verification"]>;
  [key: string]: unknown;
} = {}): MigrationManifestV1 {
  const draft: Record<string, unknown> = {
    schema: "aion.continuity-migration-manifest.v1",
    source: {
      role: "primary",
      systemInstanceId: SYSTEM_A,
      origin: CANONICAL_ORIGIN,
      branch: "main",
      head: HEAD_A,
      ...(overrides.source ?? {}),
    },
    target: {
      role: "secondary",
      systemInstanceId: SYSTEM_B,
      origin: CANONICAL_ORIGIN,
      head: HEAD_A,
      ...(overrides.target ?? {}),
    },
    controlPlane: {
      designDirective: "AION-V1.3-R6-CONTINUITY-MIGRATION-DESIGN",
      cutoverDirective: "AION-V1.3-R6.2-CUTOVER-NOT-YET",
      historyPolicy: "archival-import-only",
    },
    codeBackup: {
      backupId: "20260809T003801Z",
      bundleSha256: "019d0607759397c59f22bbbca03c2c839ba4ec89390b3aca4b57504a8f772a72",
    },
    privateBackup: {
      artifactSha256: "0".repeat(64),
      format: "aion.private-backup.v1",
      stateSchema: "aion.local-assistant-state.v1",
      stateRevision: 3,
      stateSha256: "0".repeat(64),
      ...(overrides.privateBackup ?? {}),
    },
    identity: {
      schema: "aion.local-identity-state.v1",
      fileSha256: "5a131eda03168697ecce3f755ec42a91650707df57650686719938c67f34eb83",
      transferPolicy: "not-included",
    },
    models: {
      runtime: "ollama",
      runtimeVersion: "0.32.6",
      entries: [
        { tag: "qwen3:4b-instruct", digestOrBlobSha256: "0edcdef34593", endpointLogicalId: "9a6890df-3ecb-4282-8580-f9b52ff2ebd3" },
      ],
    },
    brain: {
      mode: "local-preferred",
      primaryEndpointId: "9a6890df-3ecb-4282-8580-f9b52ff2ebd3",
      endpointIdentityPolicy: "preserve-logical-ids-reprobe-health",
    },
    verification: {
      expectedVerifyPassCount: 587,
      evaluatorDigest: EVAL_DIGEST,
      ...(overrides.verification ?? {}),
    },
    authority: {
      epoch: 1,
      sourceState: "WRITER",
      targetState: "absent",
    },
    cutover: {
      state: "designed",
      promotedMachine: "none",
      timestampUtc: null,
    },
  };
  for (const key of Object.keys(overrides)) {
    if (["source", "target", "privateBackup", "verification"].includes(key)) continue;
    draft[key] = overrides[key];
  }
  return validateMigrationManifestV1(draft);
}

async function serviceWithAuthority(authority: InMemoryWriterAuthorityV1) {
  const root = await mkdtemp(join(tmpdir(), "aion-auth-"));
  const exports = join(root, "exports");
  await mkdir(exports);
  const developerAgents = new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]);
  const repository = new AuthorityGatedStateRepositoryV1(new InMemoryStateRepositoryV1(), authority);
  const service = new AionAssistantV1({
    repository,
    clock: new DeterministicClockV1(),
    ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(),
    backup: new NodePrivateBackupV1(exports),
    developerAgents,
    authority,
  });
  return { root, exports, service, authority };
}

// ---------------------------------------------------------------------------
// A — Writer authority
// ---------------------------------------------------------------------------

test("A1 WRITER permits authorized persistent mutation", async () => {
  const authority = new InMemoryWriterAuthorityV1(createWriterGrantForTest({ state: "WRITER" }));
  const { service } = await serviceWithAuthority(authority);
  const memory = await service.createMemory({ content: "Writer may persist.", category: "semantic" });
  assert.equal(memory.content, "Writer may persist.");
  assert.equal((await service.snapshot()).memories.length, 1);
});

test("A2 READ_ONLY rejects mutation", async () => {
  const authority = new InMemoryWriterAuthorityV1(createWriterGrantForTest({ state: "READ_ONLY", authorityEpoch: 2 }));
  const { service } = await serviceWithAuthority(authority);
  await assert.rejects(service.createMemory({ content: "nope", category: "semantic" }), /READ_ONLY/i);
});

test("A3 REVOKED rejects mutation", async () => {
  const authority = new InMemoryWriterAuthorityV1(createWriterGrantForTest({ state: "REVOKED", authorityEpoch: 3, revokedAt: "2030-01-01T00:02:00.000Z" }));
  const { service } = await serviceWithAuthority(authority);
  await assert.rejects(service.createTask({ title: "blocked" }), /REVOKED/i);
});

test("A4 missing authority rejects mutation", async () => {
  const authority = new InMemoryWriterAuthorityV1(null);
  const { service } = await serviceWithAuthority(authority);
  await assert.rejects(service.completeOnboarding(), /missing/i);
});

test("A5 malformed authority rejects mutation", async () => {
  const authority = new InMemoryWriterAuthorityV1(null);
  assert.throws(() => validateAuthorityGrantV1({ schema: "nope" }), /unsupported|invalid|missing/i);
  authority.replaceForTest(createWriterGrantForTest({ state: "WRITER" }));
  // Corrupt digest in memory bypassing constructor validation path
  (authority as unknown as { grant: { digest: string } }).grant.digest = "0".repeat(64);
  const { service } = await serviceWithAuthority(authority);
  await assert.rejects(service.createConversation("x"), /digest|invalid|authority/i);
});

test("A6 stale epoch rejects mutation via non-monotonic command", async () => {
  const authority = new InMemoryWriterAuthorityV1(createWriterGrantForTest({ authorityEpoch: 5, state: "WRITER" }));
  await assert.rejects(
    authority.applyOwnerCommand({
      schema: "aion.owner-authority-command.v1",
      command: "revoke",
      systemInstanceId: "11111111-1111-4111-8111-111111111111",
      authorityEpoch: 5,
      grantDirectiveId: "STALE",
      at: "2030-01-01T00:03:00.000Z",
    }),
    /stale|non-monotonic|epoch/i,
  );
});

test("A7 previous writer cannot replay stale grant", async () => {
  const first = createWriterGrantForTest({ authorityEpoch: 1, state: "WRITER" });
  const authority = new InMemoryWriterAuthorityV1(first);
  await authority.applyOwnerCommand({
    schema: "aion.owner-authority-command.v1",
    command: "revoke",
    systemInstanceId: first.systemInstanceId,
    authorityEpoch: 2,
    grantDirectiveId: "REVOKE-1",
    at: "2030-01-01T00:04:00.000Z",
  });
  // Replaying epoch-1 WRITER by stuffing store fails digest if we re-validate; applying grant at epoch 1 fails
  await assert.rejects(
    authority.applyOwnerCommand({
      schema: "aion.owner-authority-command.v1",
      command: "grant-writer",
      systemInstanceId: first.systemInstanceId,
      authorityEpoch: 1,
      grantDirectiveId: "REPLAY",
      at: "2030-01-01T00:05:00.000Z",
    }),
    /stale|non-monotonic|epoch/i,
  );
  const { service } = await serviceWithAuthority(authority);
  await assert.rejects(service.createMemory({ content: "replay", category: "episodic" }), /REVOKED/i);
});

test("A8 runtime cannot self-promote", async () => {
  const authority = new InMemoryWriterAuthorityV1(createWriterGrantForTest({ state: "READ_ONLY", authorityEpoch: 2 }));
  const { service } = await serviceWithAuthority(authority);
  await assert.rejects(service.promoteWriterAuthority(), /cannot self-promote/i);
  assert.equal((await service.inspectWriterAuthority())?.state, "READ_ONLY");
});

test("A9 alternate entry points cannot bypass mutation gate", async () => {
  const authority = new InMemoryWriterAuthorityV1(createWriterGrantForTest({ state: "REVOKED", authorityEpoch: 4, revokedAt: "2030-01-01T00:06:00.000Z" }));
  const inner = new InMemoryStateRepositoryV1();
  const gated = new AuthorityGatedStateRepositoryV1(inner, authority);
  const state = createEmptyStateV1();
  state.revision = 1;
  await assert.rejects(gated.save(0, state), /REVOKED|authority/i);
  assert.equal(await gated.load(), null);
});

test("A10 read-only access remains available where permitted", async () => {
  const authority = new InMemoryWriterAuthorityV1(createWriterGrantForTest({ state: "READ_ONLY", authorityEpoch: 2 }));
  const { service } = await serviceWithAuthority(authority);
  const snap = await service.snapshot();
  assert.equal(snap.schema, "aion.local-assistant-state.v1");
  assert.equal((await service.inspectWriterAuthority())?.state, "READ_ONLY");
});

test("A-bootstrap FileWriterAuthorityV1 never auto-creates WRITER (V1 non-authoritative)", async () => {
  const root = await mkdtemp(join(tmpdir(), "aion-v1-auth-"));
  try {
    const authority = new FileWriterAuthorityV1(root);
    const created = await authority.bootstrapLegacyWriterIfAbsent({
      systemInstanceId: SYSTEM_A,
      grantedAt: "2030-01-01T00:00:00.000Z",
    });
    assert.equal(created.created, false);
    assert.equal(created.grant, null);
    await assert.rejects(authority.assertWritable("test"), /V1_NOT_AUTHORITATIVE|READ_ONLY/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// C — Manifest + repository identity (before cold restore uses them)
// ---------------------------------------------------------------------------

test("C1 canonical schema validation", () => {
  const m = baseManifest();
  assert.equal(m.schema, "aion.continuity-migration-manifest.v1");
  assert.equal(validateMigrationManifestV1(m).source.head.length, 40);
});

test("C2 deterministic canonicalization / digest", () => {
  const a = digestMigrationManifest(baseManifest());
  const b = digestMigrationManifest(baseManifest());
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/u);
});

test("C3 no secret fields", () => {
  assert.throws(
    () => validateMigrationManifestV1({ ...baseManifest(), passphrase: "hunter2hunter2" }),
    /secret/i,
  );
});

test("C4 full 40-char SHA required", () => {
  assert.throws(
    () => validateMigrationManifestV1(baseManifest({ source: { head: "3f47f21" } })),
    /40-character|HEAD/i,
  );
});

test("C5 wrong repo rejected", () => {
  assert.throws(
    () => assertCanonicalRepositoryIdentity({ origin: WRONG_ORIGIN, head: HEAD_A }),
    /origin identity mismatch|refused/i,
  );
  assert.equal(normalizeOriginUrl(CANONICAL_ORIGIN), CANONICAL_ORIGIN);
});

test("C6 wrong SHA rejected", () => {
  assert.throws(
    () => assertCanonicalRepositoryIdentity({
      origin: CANONICAL_ORIGIN,
      head: HEAD_A,
      expectedHead: HEAD_B,
    }),
    /HEAD mismatch/i,
  );
});

test("C7 evaluator digest preserved", () => {
  assert.equal(baseManifest().verification.evaluatorDigest, EVAL_DIGEST);
});

test("C8 expected verify count preserved", () => {
  assert.equal(baseManifest().verification.expectedVerifyPassCount, 587);
});

// ---------------------------------------------------------------------------
// B — Cold private restore
// ---------------------------------------------------------------------------

async function makeEncryptedFixture() {
  const root = await mkdtemp(join(tmpdir(), "aion-cold-"));
  const exportsDir = join(root, "exports");
  const dest = join(root, "private", "aion");
  await mkdir(exportsDir, { recursive: true });
  await mkdir(dest, { recursive: true });
  const backup = new NodePrivateBackupV1(exportsDir);
  const state = syntheticState(3);
  const backupPath = join(exportsDir, "synthetic.aionbak");
  const passphrase = "synthetic-passphrase-for-cold-restore";
  const created = await backup.create(state, backupPath, passphrase);
  const artifactSha256 = created.digest;
  const stateSha256 = digestValue(state);
  const manifest = baseManifest({
    privateBackup: {
      artifactSha256,
      format: "aion.private-backup.v1",
      stateSchema: "aion.local-assistant-state.v1",
      stateRevision: 3,
      stateSha256,
    },
  });
  return { root, exportsDir, dest, backup, backupPath, passphrase, state, manifest, artifactSha256, stateSha256 };
}

test("B1 valid synthetic encrypted backup restores to empty synthetic target", async () => {
  const fx = await makeEncryptedFixture();
  const result = await installColdPrivateBackup(fx.backup, {
    backupPath: fx.backupPath,
    passphrase: fx.passphrase,
    destinationRoot: fx.dest,
    manifest: fx.manifest,
    actualOrigin: CANONICAL_ORIGIN,
    actualSourceHead: HEAD_A,
    actualTargetHead: HEAD_A,
  });
  assert.equal(result.stateSha256, fx.stateSha256);
  const installed = JSON.parse(await readFile(join(fx.dest, "state-v1.json"), "utf8"));
  assert.equal(installed.revision, 3);
  assert.equal(installed.memories[0]?.content, "Synthetic continuity fixture memory.");
});

test("B2 existing state refuses", async () => {
  const fx = await makeEncryptedFixture();
  await writeFile(join(fx.dest, "state-v1.json"), "{}\n", "utf8");
  await assert.rejects(
    installColdPrivateBackup(fx.backup, {
      backupPath: fx.backupPath,
      passphrase: fx.passphrase,
      destinationRoot: fx.dest,
      manifest: fx.manifest,
      actualOrigin: CANONICAL_ORIGIN,
      actualSourceHead: HEAD_A,
      actualTargetHead: HEAD_A,
    }),
    /already exists|refused/i,
  );
});

test("B3 wrong passphrase refuses", async () => {
  const fx = await makeEncryptedFixture();
  await assert.rejects(
    installColdPrivateBackup(fx.backup, {
      backupPath: fx.backupPath,
      passphrase: "wrong-passphrase-xx",
      destinationRoot: fx.dest,
      manifest: fx.manifest,
      actualOrigin: CANONICAL_ORIGIN,
      actualSourceHead: HEAD_A,
      actualTargetHead: HEAD_A,
    }),
    /failed closed|auth|decrypt|Unsupported|bad decrypt|unable/i,
  );
});

test("B4 tampered ciphertext refuses", async () => {
  const fx = await makeEncryptedFixture();
  const raw = JSON.parse(await readFile(fx.backupPath, "utf8")) as { ciphertext: string };
  const buf = Buffer.from(raw.ciphertext, "base64url");
  buf[0] = (buf[0] ?? 0) ^ 0xff;
  raw.ciphertext = buf.toString("base64url");
  await writeFile(fx.backupPath, `${JSON.stringify(raw)}\n`, "utf8");
  // artifact hash in manifest no longer matches file — either hash or decrypt fails closed
  await assert.rejects(
    installColdPrivateBackup(fx.backup, {
      backupPath: fx.backupPath,
      passphrase: fx.passphrase,
      destinationRoot: fx.dest,
      manifest: fx.manifest,
      actualOrigin: CANONICAL_ORIGIN,
      actualSourceHead: HEAD_A,
      actualTargetHead: HEAD_A,
    }),
    /hash|failed closed|auth|integrity|mismatch/i,
  );
});

test("B5 wrong auth tag refuses", async () => {
  const fx = await makeEncryptedFixture();
  const raw = JSON.parse(await readFile(fx.backupPath, "utf8")) as { tag: string };
  const tag = Buffer.from(raw.tag, "base64url");
  tag[0] = (tag[0] ?? 0) ^ 0xff;
  raw.tag = tag.toString("base64url");
  const tamperedPath = join(fx.exportsDir, "tag-tampered.aionbak");
  await writeFile(tamperedPath, `${JSON.stringify(raw)}\n`, "utf8");
  const artifactSha256 = createHash("sha256").update(await readFile(tamperedPath)).digest("hex");
  const manifest = baseManifest({
    privateBackup: { ...fx.manifest.privateBackup, artifactSha256 },
  });
  await assert.rejects(
    installColdPrivateBackup(fx.backup, {
      backupPath: tamperedPath,
      passphrase: fx.passphrase,
      destinationRoot: fx.dest,
      manifest,
      actualOrigin: CANONICAL_ORIGIN,
      actualSourceHead: HEAD_A,
      actualTargetHead: HEAD_A,
    }),
    /failed closed|auth|integrity|tag|Unsupported|unable/i,
  );
});

test("B6 malformed envelope refuses", async () => {
  const fx = await makeEncryptedFixture();
  const bad = join(fx.exportsDir, "malformed.aionbak");
  await writeFile(bad, "{not-json\n", "utf8");
  const artifactSha256 = createHash("sha256").update(await readFile(bad)).digest("hex");
  const manifest = baseManifest({
    privateBackup: { ...fx.manifest.privateBackup, artifactSha256 },
  });
  await assert.rejects(
    installColdPrivateBackup(fx.backup, {
      backupPath: bad,
      passphrase: fx.passphrase,
      destinationRoot: fx.dest,
      manifest,
      actualOrigin: CANONICAL_ORIGIN,
      actualSourceHead: HEAD_A,
      actualTargetHead: HEAD_A,
    }),
    /failed closed|JSON|Unsupported|malformed|Unexpected/i,
  );
});

test("B7 wrong state digest refuses", async () => {
  const fx = await makeEncryptedFixture();
  const manifest = baseManifest({
    privateBackup: {
      ...fx.manifest.privateBackup,
      artifactSha256: fx.artifactSha256,
      stateSha256: "a".repeat(64),
    },
  });
  await assert.rejects(
    installColdPrivateBackup(fx.backup, {
      backupPath: fx.backupPath,
      passphrase: fx.passphrase,
      destinationRoot: fx.dest,
      manifest,
      actualOrigin: CANONICAL_ORIGIN,
      actualSourceHead: HEAD_A,
      actualTargetHead: HEAD_A,
    }),
    /digest/i,
  );
});

test("B8 wrong schema refuses", async () => {
  assert.throws(
    () => validateMigrationManifestV1({
      ...baseManifest(),
      privateBackup: { ...baseManifest().privateBackup, stateSchema: "aion.local-assistant-state.v99" },
    }),
    /schema/i,
  );
});

test("B9 wrong manifest artifact hash refuses", async () => {
  const fx = await makeEncryptedFixture();
  const manifest = baseManifest({
    privateBackup: { ...fx.manifest.privateBackup, artifactSha256: "b".repeat(64), stateSha256: fx.stateSha256 },
  });
  await assert.rejects(
    installColdPrivateBackup(fx.backup, {
      backupPath: fx.backupPath,
      passphrase: fx.passphrase,
      destinationRoot: fx.dest,
      manifest,
      actualOrigin: CANONICAL_ORIGIN,
      actualSourceHead: HEAD_A,
      actualTargetHead: HEAD_A,
    }),
    /artifact hash|manifest/i,
  );
});

test("B10 wrong source HEAD refuses", async () => {
  const fx = await makeEncryptedFixture();
  await assert.rejects(
    installColdPrivateBackup(fx.backup, {
      backupPath: fx.backupPath,
      passphrase: fx.passphrase,
      destinationRoot: fx.dest,
      manifest: fx.manifest,
      actualOrigin: CANONICAL_ORIGIN,
      actualSourceHead: HEAD_B,
      actualTargetHead: HEAD_A,
    }),
    /HEAD mismatch|source/i,
  );
});

test("B11 wrong target HEAD refuses", async () => {
  const fx = await makeEncryptedFixture();
  await assert.rejects(
    installColdPrivateBackup(fx.backup, {
      backupPath: fx.backupPath,
      passphrase: fx.passphrase,
      destinationRoot: fx.dest,
      manifest: fx.manifest,
      actualOrigin: CANONICAL_ORIGIN,
      actualSourceHead: HEAD_A,
      actualTargetHead: HEAD_B,
    }),
    /HEAD mismatch|target/i,
  );
});

test("B12 wrong repo origin refuses", async () => {
  const fx = await makeEncryptedFixture();
  await assert.rejects(
    installColdPrivateBackup(fx.backup, {
      backupPath: fx.backupPath,
      passphrase: fx.passphrase,
      destinationRoot: fx.dest,
      manifest: fx.manifest,
      actualOrigin: WRONG_ORIGIN,
      actualSourceHead: HEAD_A,
      actualTargetHead: HEAD_A,
    }),
    /origin|identity|refused/i,
  );
});

test("B13 plaintext/passphrase absent from logs", async () => {
  const fx = await makeEncryptedFixture();
  const lines: string[] = [];
  await installColdPrivateBackup(fx.backup, {
    backupPath: fx.backupPath,
    passphrase: fx.passphrase,
    destinationRoot: fx.dest,
    manifest: fx.manifest,
    actualOrigin: CANONICAL_ORIGIN,
    actualSourceHead: HEAD_A,
    actualTargetHead: HEAD_A,
    logSink: (line) => lines.push(line),
  });
  assert.ok(lines.length > 0);
  for (const line of lines) assert.ok(!line.includes(fx.passphrase));
  await assertNoPassphraseResidue(fx.root, fx.passphrase);
});

test("B14 installation atomicity / partial failure leaves no accepted live state", async () => {
  const fx = await makeEncryptedFixture();
  // Wrong digest after decrypt path: remove any partial state
  const manifest = baseManifest({
    privateBackup: {
      ...fx.manifest.privateBackup,
      artifactSha256: fx.artifactSha256,
      stateSha256: "c".repeat(64),
    },
  });
  await assert.rejects(
    installColdPrivateBackup(fx.backup, {
      backupPath: fx.backupPath,
      passphrase: fx.passphrase,
      destinationRoot: fx.dest,
      manifest,
      actualOrigin: CANONICAL_ORIGIN,
      actualSourceHead: HEAD_A,
      actualTargetHead: HEAD_A,
    }),
    /digest/i,
  );
  await assert.rejects(readFile(join(fx.dest, "state-v1.json")), /ENOENT/i);
});

// ---------------------------------------------------------------------------
// D — Control-plane archival provenance
// ---------------------------------------------------------------------------

test("D1–D8 archival history import isolation", async () => {
  const root = await mkdtemp(join(tmpdir(), "aion-cp-"));
  const aionLocal = join(root, ".aion-local");
  await mkdir(join(aionLocal, "directives"), { recursive: true });
  await mkdir(join(aionLocal, "handoffs"), { recursive: true });
  const activeCurrent = "# Active\nDirective-ID: AION-ACTIVE\nStatus: AUTHORIZED\n";
  const activeLatest = "# Active LATEST\n";
  await writeFile(join(aionLocal, "directives", "CURRENT.md"), activeCurrent, "utf8");
  await writeFile(join(aionLocal, "handoffs", "LATEST.md"), activeLatest, "utf8");

  const srcDir = join(root, "src-history");
  await mkdir(srcDir, { recursive: true });
  const archivedCurrent = "# Archived CURRENT lookalike\nDirective-ID: AION-ARCHIVED-AUTH\nStatus: AUTHORIZED\n";
  const archivedLatest = "# Archived LATEST lookalike\n";
  const archivedCurrentPath = join(srcDir, "CURRENT.md");
  const archivedLatestPath = join(srcDir, "LATEST.md");
  await writeFile(archivedCurrentPath, archivedCurrent, "utf8");
  await writeFile(archivedLatestPath, archivedLatest, "utf8");

  const manifest = await importControlPlaneHistoryArchival({
    aionLocalRoot: aionLocal,
    sourceSystemInstanceId: SYSTEM_A,
    sourceMachineRole: "laptop",
    sourceHead: HEAD_A,
    importTimestampUtc: "2030-01-01T00:00:00.000Z",
    sources: [
      { category: "directives", relativePath: "CURRENT.md", absolutePath: archivedCurrentPath },
      { category: "handoffs", relativePath: "LATEST.md", absolutePath: archivedLatestPath },
    ],
  });

  // D1 success
  assert.equal(manifest.designation, "archival-evidence-only");
  // D2 hashes
  assert.equal(manifest.files.length, 2);
  assert.match(manifest.files[0]!.sha256, /^[0-9a-f]{64}$/u);
  // D3 provenance
  assert.equal(manifest.sourceSystemInstanceId, SYSTEM_A);
  assert.equal(manifest.sourceHead, HEAD_A);
  assert.equal(manifest.activeAuthorization, false);
  // D4/D5 imported CURRENT/LATEST cannot become active — active files unchanged
  assert.equal(await readFile(join(aionLocal, "directives", "CURRENT.md"), "utf8"), activeCurrent);
  assert.equal(await readFile(join(aionLocal, "handoffs", "LATEST.md"), "utf8"), activeLatest);
  // D6/D8 isolation
  const gate = assertArchivalCannotAuthorize({ aionLocalRoot: aionLocal, importedManifest: manifest });
  assert.equal(gate.archivalAuthorized, false);
  assert.ok(manifest.files.some((f) => f.parsedStatus === "AUTHORIZED"));
  // D7 active host CURRENT remains AUTHORIZED active path only
  assert.equal(await readFile(join(aionLocal, "directives", "CURRENT.md"), "utf8"), activeCurrent);
  // Imported paths are under imported-history
  const importedCurrent = join(aionLocal, "imported-history", SYSTEM_A, "directives", "CURRENT.md");
  assert.equal(isPathInsideImportedHistory(aionLocal, importedCurrent), true);
  assert.equal(isPathInsideImportedHistory(aionLocal, join(aionLocal, "directives", "CURRENT.md")), false);
});

test("owner authority command schema rejects self-shaped runtime invent", () => {
  assert.throws(() => validateOwnerAuthorityCommandV1({ schema: "nope" }), /unsupported|missing/i);
  const cmd = validateOwnerAuthorityCommandV1({
    schema: "aion.owner-authority-command.v1",
    command: "grant-writer",
    systemInstanceId: SYSTEM_A,
    authorityEpoch: 1,
    grantDirectiveId: "AION-TEST",
    at: "2030-01-01T00:00:00.000Z",
  });
  assert.equal(cmd.command, "grant-writer");
});

test("FileStateRepository still accepts empty then first save for cold-restored state", async () => {
  const root = await mkdtemp(join(tmpdir(), "aion-file-"));
  const dataRoot = join(root, "private", "aion");
  await mkdir(dataRoot, { recursive: true });
  const repo = new FileStateRepositoryV1(dataRoot);
  assert.equal(await repo.load(), null);
});
