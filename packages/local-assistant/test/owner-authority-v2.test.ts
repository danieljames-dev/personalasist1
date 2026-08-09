/**
 * Owner Authority V2 — synthetic fixtures only.
 * Never reads real private state, identity, or creates real Owner keys outside temp roots.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AionAssistantV1,
  AuthorityGatedStateRepositoryV1,
  DeterministicClockV1,
  DeterministicIdGeneratorV1,
  DeterministicModelProviderV1,
  FileOwnerAuthorityAnchorV2,
  FileStateRepositoryV1,
  FileWriterAuthorityV1,
  InMemoryStateRepositoryV1,
  LocalArchiveImportSourceV1,
  LocalEchoCapabilityV1,
  NodePrivateBackupV1,
  OfflineOwnerAuthorityWriterV2,
  OwnerAuthorityRuntimeV2,
  SelectableDeveloperAgentRegistryV1,
  StaticCapabilityRegistryV1,
  SyntheticDeveloperAgentBridgeV1,
  authorityRecordBodyV2,
  createEmptyStateV1,
  createSyntheticOwnerAuthorityFixtureV2,
  createWriterGrantForTest,
  generateOwnerKeyPairV2ForTest,
  ownerKeyIdFromSpkiDer,
  recordDigestV2,
  signAuthorityBodyV2,
  validateAuthorityRecordV2,
} from "../src/index.js";

const SI_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SI_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ANCHOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

async function tempRoot(prefix = "aion-auth-v2-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function serviceWith(authority: OwnerAuthorityRuntimeV2 | FileWriterAuthorityV1, repository = new InMemoryStateRepositoryV1()) {
  const root = await tempRoot("aion-svc-");
  const exports = join(root, "exports");
  await mkdir(exports);
  const gated = new AuthorityGatedStateRepositoryV1(repository, authority);
  const service = new AionAssistantV1({
    repository: gated,
    clock: new DeterministicClockV1(),
    ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(),
    backup: new NodePrivateBackupV1(exports),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
    authority,
  });
  return { root, service, authority, repository: gated };
}

// ---------------------------------------------------------------------------
// BOOT
// ---------------------------------------------------------------------------

test("R1-BOOT-1 fresh host / no anchor => READ_ONLY", async () => {
  const runtime = new OwnerAuthorityRuntimeV2({
    getTrustedOwner: () => generateOwnerKeyPairV2ForTest().trust,
    getAnchorRoot: () => null,
    getLocalSystemInstanceId: () => SI_A,
  });
  const decision = await runtime.evaluate();
  assert.equal(decision.effective, "READ_ONLY");
  assert.equal(decision.reasonCode, "NO_ANCHOR");
  await assert.rejects(runtime.assertWritable(), /READ_ONLY|NO_ANCHOR/i);
});

test("R1-BOOT-2 valid anchor / no identity => READ_ONLY", async () => {
  const root = await tempRoot();
  try {
    const fixture = await createSyntheticOwnerAuthorityFixtureV2({
      anchorRoot: root,
      systemInstanceId: SI_A,
      anchorId: ANCHOR,
    });
    const runtime = new OwnerAuthorityRuntimeV2({
      getTrustedOwner: () => fixture.trust,
      getAnchorRoot: () => root,
      getLocalSystemInstanceId: () => null,
    });
    const decision = await runtime.evaluate();
    assert.equal(decision.effective, "READ_ONLY");
    assert.equal(decision.reasonCode, "MISSING_IDENTITY");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("R1-BOOT-3 foreign SI => READ_ONLY", async () => {
  const root = await tempRoot();
  try {
    const fixture = await createSyntheticOwnerAuthorityFixtureV2({
      anchorRoot: root,
      systemInstanceId: SI_A,
      anchorId: ANCHOR,
    });
    const runtime = new OwnerAuthorityRuntimeV2({
      getTrustedOwner: () => fixture.trust,
      getAnchorRoot: () => root,
      getLocalSystemInstanceId: () => SI_B,
    });
    const decision = await runtime.evaluate();
    assert.equal(decision.effective, "READ_ONLY");
    assert.equal(decision.reasonCode, "FOREIGN_SYSTEM_INSTANCE");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("R1-BOOT-4 local cache deleted / no auto-writer", async () => {
  const root = await tempRoot();
  try {
    const fixture = await createSyntheticOwnerAuthorityFixtureV2({
      anchorRoot: root,
      systemInstanceId: SI_A,
      anchorId: ANCHOR,
    });
    await rm(join(root, "current.json"), { force: true });
    await rm(join(root, "ledger"), { recursive: true, force: true });
    const decision = await fixture.runtime.evaluate();
    assert.equal(decision.effective, "READ_ONLY");
    assert.notEqual(decision.reasonCode, "WRITER_BOUND");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("R1-BOOT-5 V1 WRITER file only => READ_ONLY", async () => {
  const root = await tempRoot();
  try {
    const path = join(root, "writer-authority-v1.json");
    const grant = createWriterGrantForTest({ state: "WRITER", systemInstanceId: SI_A });
    await writeFile(path, `${JSON.stringify(grant, null, 2)}\n`, "utf8");
    const v1 = new FileWriterAuthorityV1(root);
    await assert.rejects(v1.assertWritable(), /V1_NOT_AUTHORITATIVE/i);
    const boot = await v1.bootstrapLegacyWriterIfAbsent({
      systemInstanceId: SI_A,
      grantedAt: "2030-01-01T00:00:00.000Z",
    });
    assert.equal(boot.created, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TRUST ROOT
// ---------------------------------------------------------------------------

test("R1-TRUST-1 valid anchor signed by externally trusted Owner key => verifies", async () => {
  const root = await tempRoot();
  try {
    const fixture = await createSyntheticOwnerAuthorityFixtureV2({
      anchorRoot: root,
      systemInstanceId: SI_A,
      anchorId: ANCHOR,
    });
    const decision = await fixture.runtime.evaluate();
    assert.equal(decision.effective, "WRITER");
    assert.equal(decision.reasonCode, "WRITER_BOUND");
    await fixture.runtime.assertWritable("test");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("R1-TRUST-2 replace anchor public metadata + ledger with attacker keypair => REFUSED", async () => {
  const root = await tempRoot();
  try {
    const fixture = await createSyntheticOwnerAuthorityFixtureV2({
      anchorRoot: root,
      systemInstanceId: SI_A,
      anchorId: ANCHOR,
    });
    // Attacker replaces entire anchor with a new key they control
    await rm(join(root, "current.json"), { force: true });
    await rm(join(root, "ledger"), { recursive: true, force: true });
    const attacker = generateOwnerKeyPairV2ForTest();
    const offline = new OfflineOwnerAuthorityWriterV2(
      new FileOwnerAuthorityAnchorV2(root),
      attacker.privateKey,
      attacker.trust,
    );
    await offline.initializeGenesis({
      anchorId: ANCHOR,
      state: "WRITER",
      writerSystemInstanceId: SI_A,
      grantDirectiveId: "ATTACKER",
      issuedAt: "2030-01-01T00:00:00.000Z",
    });
    // Original trusted key still configured externally
    const decision = await fixture.runtime.evaluate();
    assert.equal(decision.effective, "READ_ONLY");
    assert.match(decision.reasonCode, /INVALID_OWNER_KEY|INVALID_SIGNATURE|STALE_OR_BROKEN_CHAIN|ANCHOR_UNAVAILABLE/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("R1-TRUST-3 anchor ownerKeyId differs from configured trusted key => REFUSED", async () => {
  const root = await tempRoot();
  try {
    const fixture = await createSyntheticOwnerAuthorityFixtureV2({
      anchorRoot: root,
      systemInstanceId: SI_A,
      anchorId: ANCHOR,
    });
    const other = generateOwnerKeyPairV2ForTest();
    const runtime = new OwnerAuthorityRuntimeV2({
      getTrustedOwner: () => other.trust,
      getAnchorRoot: () => root,
      getLocalSystemInstanceId: () => SI_A,
    });
    const decision = await runtime.evaluate();
    assert.equal(decision.effective, "READ_ONLY");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("R1-TRUST-4 no externally trusted Owner verification material => READ_ONLY", async () => {
  const runtime = new OwnerAuthorityRuntimeV2({
    getTrustedOwner: () => null,
    getAnchorRoot: () => join(tmpdir(), "unused-anchor"),
    getLocalSystemInstanceId: () => SI_A,
  });
  const decision = await runtime.evaluate();
  assert.equal(decision.effective, "READ_ONLY");
  assert.equal(decision.reasonCode, "NO_TRUSTED_OWNER_KEY");
});

test("R1-TRUST-5 same valid anchor evaluated with wrong trusted Owner public key => READ_ONLY", async () => {
  const root = await tempRoot();
  try {
    await createSyntheticOwnerAuthorityFixtureV2({
      anchorRoot: root,
      systemInstanceId: SI_A,
      anchorId: ANCHOR,
    });
    const wrong = generateOwnerKeyPairV2ForTest();
    const runtime = new OwnerAuthorityRuntimeV2({
      getTrustedOwner: () => wrong.trust,
      getAnchorRoot: () => root,
      getLocalSystemInstanceId: () => SI_A,
    });
    assert.equal((await runtime.evaluate()).effective, "READ_ONLY");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// SIGNATURE / TAMPER
// ---------------------------------------------------------------------------

test("R1-SIG body/digest/signature/writer/epoch/previous/directive tamper refused", async () => {
  const root = await tempRoot();
  try {
    const fixture = await createSyntheticOwnerAuthorityFixtureV2({
      anchorRoot: root,
      systemInstanceId: SI_A,
      anchorId: ANCHOR,
    });
    const path = join(root, "ledger", "0000000001.json");
    const original = JSON.parse(await readFile(path, "utf8"));

    for (const [field, value] of [
      ["writerSystemInstanceId", SI_B],
      ["epoch", 2],
      ["previousRecordDigest", "a".repeat(64)],
      ["grantDirectiveId", "TAMPERED"],
      ["recordDigest", "b".repeat(64)],
      ["signature", "c".repeat(128)],
    ] as const) {
      const tampered = { ...original, [field]: value };
      await writeFile(path, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
      const decision = await fixture.runtime.evaluate();
      assert.equal(decision.effective, "READ_ONLY", `field ${field} must fail closed`);
      await writeFile(path, `${JSON.stringify(original, null, 2)}\n`, "utf8");
    }

    // body field change that keeps structure but breaks digest/signature
    const bodyTampered = { ...original, issuedAt: "2030-01-02T00:00:00.000Z" };
    await writeFile(path, `${JSON.stringify(bodyTampered, null, 2)}\n`, "utf8");
    assert.equal((await fixture.runtime.evaluate()).effective, "READ_ONLY");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("R1-SIG runtime cannot sign or apply owner commands", async () => {
  const root = await tempRoot();
  try {
    const fixture = await createSyntheticOwnerAuthorityFixtureV2({
      anchorRoot: root,
      systemInstanceId: SI_A,
      anchorId: ANCHOR,
    });
    await assert.rejects(fixture.runtime.applyOwnerCommand(), /cannot apply owner authority|offline/i);
    const boot = await fixture.runtime.bootstrapLegacyWriterIfAbsent();
    assert.equal(boot.created, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("R1-SIG valid signature path reconstructs digest over canonical body bytes", () => {
  const keys = generateOwnerKeyPairV2ForTest();
  const body = authorityRecordBodyV2({
    schema: "aion.authority-record.v2",
    anchorId: ANCHOR,
    epoch: 1,
    state: "WRITER",
    writerSystemInstanceId: SI_A,
    grantDirectiveId: "TEST",
    issuedAt: "2030-01-01T00:00:00.000Z",
    previousRecordDigest: null,
    ownerKeyId: keys.ownerKeyId,
  });
  const { recordDigest, signature } = signAuthorityBodyV2(body, keys.privateKey);
  assert.equal(recordDigest, recordDigestV2(body));
  const record = validateAuthorityRecordV2({ ...body, recordDigest, signature }, keys.trust);
  assert.equal(record.recordDigest, recordDigest);
  assert.equal(ownerKeyIdFromSpkiDer(keys.publicKeySpkiDer), keys.ownerKeyId);
});

// ---------------------------------------------------------------------------
// LEDGER
// ---------------------------------------------------------------------------

test("R1-LEDGER valid chain and transfer A→QUIESCENT→B; direct A→B refused", async () => {
  const root = await tempRoot();
  try {
    const fixture = await createSyntheticOwnerAuthorityFixtureV2({
      anchorRoot: root,
      systemInstanceId: SI_A,
      anchorId: ANCHOR,
    });
    assert.equal((await fixture.runtime.evaluate()).effective, "WRITER");

    await assert.rejects(
      fixture.offline.appendTransition({
        state: "WRITER",
        writerSystemInstanceId: SI_B,
        grantDirectiveId: "DIRECT-TRANSFER-FORBIDDEN",
        issuedAt: "2030-01-01T00:01:00.000Z",
      }),
      /QUIESCENT|Direct WRITER transfer refused/i,
    );

    await fixture.offline.appendTransition({
      state: "QUIESCENT",
      writerSystemInstanceId: null,
      grantDirectiveId: "QUIESCE",
      issuedAt: "2030-01-01T00:02:00.000Z",
    });
    assert.equal((await fixture.runtime.evaluate()).effective, "READ_ONLY");
    assert.equal((await fixture.runtime.evaluate()).reasonCode, "QUIESCENT");

    const runtimeB = new OwnerAuthorityRuntimeV2({
      getTrustedOwner: () => fixture.trust,
      getAnchorRoot: () => root,
      getLocalSystemInstanceId: () => SI_B,
    });
    assert.equal((await runtimeB.evaluate()).effective, "READ_ONLY");

    await fixture.offline.appendTransition({
      state: "WRITER",
      writerSystemInstanceId: SI_B,
      grantDirectiveId: "GRANT-B",
      issuedAt: "2030-01-01T00:03:00.000Z",
    });
    assert.equal((await fixture.runtime.evaluate()).effective, "READ_ONLY");
    assert.equal((await fixture.runtime.evaluate()).reasonCode, "FOREIGN_SYSTEM_INSTANCE");
    assert.equal((await runtimeB.evaluate()).effective, "WRITER");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("R1-LEDGER epoch gap / stale current / future current / truncated fail closed", async () => {
  const root = await tempRoot();
  try {
    const fixture = await createSyntheticOwnerAuthorityFixtureV2({
      anchorRoot: root,
      systemInstanceId: SI_A,
      anchorId: ANCHOR,
    });
    await fixture.offline.appendTransition({
      state: "QUIESCENT",
      writerSystemInstanceId: null,
      grantDirectiveId: "Q",
      issuedAt: "2030-01-01T00:02:00.000Z",
    });
    // stale current: point at epoch 1 while epoch 2 exists
    await writeFile(
      join(root, "current.json"),
      `${JSON.stringify({
        schema: "aion.authority-current.v2",
        anchorId: ANCHOR,
        epoch: 1,
        recordDigest: JSON.parse(await readFile(join(root, "ledger", "0000000001.json"), "utf8")).recordDigest,
      }, null, 2)}\n`,
      "utf8",
    );
    assert.equal((await fixture.runtime.evaluate()).effective, "READ_ONLY");

    // restore valid tip then truncate record (gap)
    await writeFile(
      join(root, "current.json"),
      `${JSON.stringify({
        schema: "aion.authority-current.v2",
        anchorId: ANCHOR,
        epoch: 2,
        recordDigest: JSON.parse(await readFile(join(root, "ledger", "0000000002.json"), "utf8")).recordDigest,
      }, null, 2)}\n`,
      "utf8",
    );
    await rm(join(root, "ledger", "0000000001.json"), { force: true });
    assert.equal((await fixture.runtime.evaluate()).effective, "READ_ONLY");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("R1-LEDGER missing current with non-empty ledger fails closed", async () => {
  const root = await tempRoot();
  try {
    const fixture = await createSyntheticOwnerAuthorityFixtureV2({
      anchorRoot: root,
      systemInstanceId: SI_A,
      anchorId: ANCHOR,
    });
    await rm(join(root, "current.json"), { force: true });
    assert.equal((await fixture.runtime.evaluate()).effective, "READ_ONLY");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// LIVE RE-EVALUATION
// ---------------------------------------------------------------------------

test("R1-LIVE-1 Host A WRITER then QUIESCENT refuses next durable mutation", async () => {
  const root = await tempRoot();
  try {
    const fixture = await createSyntheticOwnerAuthorityFixtureV2({
      anchorRoot: root,
      systemInstanceId: SI_A,
      anchorId: ANCHOR,
    });
    const { service } = await serviceWith(fixture.runtime);
    await service.createMemory({ content: "before quiescent", category: "semantic" });
    await fixture.offline.appendTransition({
      state: "QUIESCENT",
      writerSystemInstanceId: null,
      grantDirectiveId: "LIVE-Q",
      issuedAt: "2030-01-01T00:10:00.000Z",
    });
    await assert.rejects(
      service.createMemory({ content: "after quiescent", category: "semantic" }),
      /READ_ONLY|QUIESCENT/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("R1-LIVE-2 Host A WRITER then transfer to B refuses A's next mutation", async () => {
  const root = await tempRoot();
  try {
    const fixture = await createSyntheticOwnerAuthorityFixtureV2({
      anchorRoot: root,
      systemInstanceId: SI_A,
      anchorId: ANCHOR,
    });
    const { service } = await serviceWith(fixture.runtime);
    await service.createMemory({ content: "a owns", category: "semantic" });
    await fixture.offline.appendTransition({
      state: "QUIESCENT",
      writerSystemInstanceId: null,
      grantDirectiveId: "Q",
      issuedAt: "2030-01-01T00:11:00.000Z",
    });
    await fixture.offline.appendTransition({
      state: "WRITER",
      writerSystemInstanceId: SI_B,
      grantDirectiveId: "B",
      issuedAt: "2030-01-01T00:12:00.000Z",
    });
    await assert.rejects(
      service.createMemory({ content: "a after transfer", category: "semantic" }),
      /READ_ONLY|FOREIGN/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("R1-LIVE-3 anchor becomes unavailable after startup refuses next mutation", async () => {
  const root = await tempRoot();
  try {
    const fixture = await createSyntheticOwnerAuthorityFixtureV2({
      anchorRoot: root,
      systemInstanceId: SI_A,
      anchorId: ANCHOR,
    });
    const { service } = await serviceWith(fixture.runtime);
    await service.createMemory({ content: "with anchor", category: "semantic" });
    await rm(root, { recursive: true, force: true });
    await assert.rejects(
      service.createMemory({ content: "without anchor", category: "semantic" }),
      /READ_ONLY|ANCHOR|unavailable|missing/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

test("R1-LIVE-4 signature invalid after startup refuses next mutation", async () => {
  const root = await tempRoot();
  try {
    const fixture = await createSyntheticOwnerAuthorityFixtureV2({
      anchorRoot: root,
      systemInstanceId: SI_A,
      anchorId: ANCHOR,
    });
    const { service } = await serviceWith(fixture.runtime);
    await service.createMemory({ content: "valid sig", category: "semantic" });
    const path = join(root, "ledger", "0000000001.json");
    const record = JSON.parse(await readFile(path, "utf8"));
    record.signature = "d".repeat(128);
    await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    await assert.rejects(
      service.createMemory({ content: "bad sig", category: "semantic" }),
      /READ_ONLY|signature|INVALID/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// INITIALIZATION GATE (M2)
// ---------------------------------------------------------------------------

test("R1-INIT READ_ONLY / QUIESCENT / REVOKED / foreign SI block migration write; WRITER allows", async () => {
  // State that needs migration: missing workspaces triggers migrateStateV1
  const needsMigration = createEmptyStateV1() as ReturnType<typeof createEmptyStateV1> & { workspaces?: unknown };
  // createEmptyStateV1 already has workspaces — force applied migration by using pre-workspace shape
  // Simulate old state without workspaces key if migrate detects it; otherwise use revision and
  // a custom repository that starts with state requiring migration.
  // From adapters: migrate runs on loaded state. If no migration applied, nothing to test.
  // Use a file repository with a deliberately old-ish empty structure by deleting workspaces after load path.
  // Safer: unit-test assertWritable is called by constructing service with authority READ_ONLY and
  // a repository that returns state where migrateStateV1 applies.

  // Inspect migrateStateV1: applied when records.length > 0. workspaces migration assigns default.
  // Looking at adapters — if state already has workspaces, may not apply.
  // Force: strip workspaces from empty state clone if possible.
  const oldState = createEmptyStateV1();
  // @ts-expect-error deliberate migration trigger
  delete oldState.workspaces;
  // @ts-expect-error deliberate migration trigger  
  delete oldState.migrations;
  oldState.revision = 0;

  async function initWith(runtime: OwnerAuthorityRuntimeV2) {
    const repo = new InMemoryStateRepositoryV1();
    await repo.save(-1 as unknown as number, oldState).catch(async () => {
      // InMemory may require expected revision 0 for first save
    });
    // Direct install into in-memory
    (repo as unknown as { state: typeof oldState }).state = structuredClone(oldState);
    const gated = new AuthorityGatedStateRepositoryV1(repo, runtime);
    return new AionAssistantV1({
      repository: gated,
      clock: new DeterministicClockV1(),
      ids: new DeterministicIdGeneratorV1(),
      providers: [new DeterministicModelProviderV1()],
      capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
      importer: new LocalArchiveImportSourceV1(),
      backup: new NodePrivateBackupV1(await tempRoot()),
      developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
      authority: runtime,
    });
  }

  const root = await tempRoot();
  try {
    const fixture = await createSyntheticOwnerAuthorityFixtureV2({
      anchorRoot: root,
      systemInstanceId: SI_A,
      anchorId: ANCHOR,
    });

    // WRITER allows migration
    const writerService = await initWith(fixture.runtime);
    await writerService.snapshot(); // initialize completes

    // QUIESCENT blocks
    await fixture.offline.appendTransition({
      state: "QUIESCENT",
      writerSystemInstanceId: null,
      grantDirectiveId: "Q-INIT",
      issuedAt: "2030-01-01T01:00:00.000Z",
    });
    const qService = await initWith(fixture.runtime);
    await assert.rejects(qService.snapshot(), /READ_ONLY|QUIESCENT|startup migration/i);

    // foreign SI blocks
    const foreign = new OwnerAuthorityRuntimeV2({
      getTrustedOwner: () => fixture.trust,
      getAnchorRoot: () => root,
      getLocalSystemInstanceId: () => SI_B,
    });
    // Grant B after quiescent
    await fixture.offline.appendTransition({
      state: "WRITER",
      writerSystemInstanceId: SI_B,
      grantDirectiveId: "B-INIT",
      issuedAt: "2030-01-01T01:01:00.000Z",
    });
    const foreignService = await initWith(
      new OwnerAuthorityRuntimeV2({
        getTrustedOwner: () => fixture.trust,
        getAnchorRoot: () => root,
        getLocalSystemInstanceId: () => SI_A,
      }),
    );
    await assert.rejects(foreignService.snapshot(), /READ_ONLY|FOREIGN|startup migration/i);

    // B WRITER allows
    const bService = await initWith(foreign);
    await bService.snapshot();

    // REVOKED blocks
    await fixture.offline.appendTransition({
      state: "REVOKED",
      writerSystemInstanceId: null,
      grantDirectiveId: "REV",
      issuedAt: "2030-01-01T01:02:00.000Z",
    });
    const revService = await initWith(foreign);
    await assert.rejects(revService.snapshot(), /READ_ONLY|REVOKED|startup migration/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("R1-INIT injected repository cannot bypass authority gate", async () => {
  const root = await tempRoot();
  try {
    const fixture = await createSyntheticOwnerAuthorityFixtureV2({
      anchorRoot: root,
      systemInstanceId: SI_A,
      anchorId: ANCHOR,
      state: "QUIESCENT",
    });
    const inner = new InMemoryStateRepositoryV1();
    const gated = new AuthorityGatedStateRepositoryV1(inner, fixture.runtime);
    const state = createEmptyStateV1();
    state.revision = 1;
    await assert.rejects(gated.save(0, state), /READ_ONLY|QUIESCENT/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// RESTORE interaction (synthetic)
// ---------------------------------------------------------------------------

test("R1-RESTORE private state alone never implies WRITER; only signed grant for SI", async () => {
  const root = await tempRoot();
  try {
    const dataRoot = join(root, "private", "aion");
    await mkdir(dataRoot, { recursive: true });
    const state = createEmptyStateV1();
    state.revision = 3;
    await writeFile(join(dataRoot, "state-v1.json"), `${JSON.stringify(state)}\n`, "utf8");

    // No anchor
    const noAnchor = new OwnerAuthorityRuntimeV2({
      getTrustedOwner: () => generateOwnerKeyPairV2ForTest().trust,
      getAnchorRoot: () => null,
      getLocalSystemInstanceId: () => SI_B,
    });
    assert.equal((await noAnchor.evaluate()).effective, "READ_ONLY");

    const anchorRoot = join(root, "anchor");
    const fixture = await createSyntheticOwnerAuthorityFixtureV2({
      anchorRoot,
      systemInstanceId: SI_A,
      anchorId: ANCHOR,
    });
    // B with A's grant
    const bRuntime = new OwnerAuthorityRuntimeV2({
      getTrustedOwner: () => fixture.trust,
      getAnchorRoot: () => anchorRoot,
      getLocalSystemInstanceId: () => SI_B,
    });
    assert.equal((await bRuntime.evaluate()).effective, "READ_ONLY");

    await fixture.offline.appendTransition({
      state: "QUIESCENT",
      writerSystemInstanceId: null,
      grantDirectiveId: "Q",
      issuedAt: "2030-01-01T02:00:00.000Z",
    });
    assert.equal((await fixture.runtime.evaluate()).effective, "READ_ONLY");
    assert.equal((await bRuntime.evaluate()).effective, "READ_ONLY");

    await fixture.offline.appendTransition({
      state: "WRITER",
      writerSystemInstanceId: SI_B,
      grantDirectiveId: "B",
      issuedAt: "2030-01-01T02:01:00.000Z",
    });
    assert.equal((await fixture.runtime.evaluate()).effective, "READ_ONLY");
    assert.equal((await bRuntime.evaluate()).effective, "WRITER");

    // Cold path: FileStateRepository loads state without granting authority
    const repo = new FileStateRepositoryV1(dataRoot);
    const loaded = await repo.load();
    assert.ok(loaded);
    assert.equal((await noAnchor.evaluate()).effective, "READ_ONLY");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Same shared current never authorizes both SIs
// ---------------------------------------------------------------------------

test("R1-TRANSFER shared current never authorizes both distinct SI identities", async () => {
  const root = await tempRoot();
  try {
    const fixture = await createSyntheticOwnerAuthorityFixtureV2({
      anchorRoot: root,
      systemInstanceId: SI_A,
      anchorId: ANCHOR,
    });
    const a = new OwnerAuthorityRuntimeV2({
      getTrustedOwner: () => fixture.trust,
      getAnchorRoot: () => root,
      getLocalSystemInstanceId: () => SI_A,
    });
    const b = new OwnerAuthorityRuntimeV2({
      getTrustedOwner: () => fixture.trust,
      getAnchorRoot: () => root,
      getLocalSystemInstanceId: () => SI_B,
    });
    assert.equal((await a.evaluate()).effective, "WRITER");
    assert.equal((await b.evaluate()).effective, "READ_ONLY");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
