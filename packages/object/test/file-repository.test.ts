import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  Acj1CanonicalSerializerV1,
  appendObjectRevisionV1,
  CAREER_SOURCE_OBJECT_V1,
  CareerObjectSchemaRegistryV1,
  createInitialObjectV1,
  createRelationshipObjectV1,
  deriveObjectStorageKeyV1,
  FileObjectRepositoryV1,
  ObjectErrorV1,
  RELATIONSHIP_DESCRIPTORS_V1,
  Sha256ObjectDigestV1,
  type FileObjectRepositoryHooksV1,
  type ObjectIdV1,
} from "../src/index.js";
import { ACTOR_ID, OWNER_ID, TIMESTAMP } from "./helpers.js";
import {
  careerPorts,
  createAllCareerFamilies,
  FAMILY_OBJECT_IDS,
  RELATIONSHIP_OBJECT_IDS,
} from "./career-helpers.js";

const validationPorts = () => ({
  canonicalizer: new Acj1CanonicalSerializerV1(),
  digest: new Sha256ObjectDigestV1(),
  schemaRegistry: new CareerObjectSchemaRegistryV1(),
});

async function storeRoot(t: TestContext): Promise<string> {
  const temporary = await mkdtemp(join(tmpdir(), "aion-object-reference-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = join(temporary, "private", "object-store");
  await mkdir(root, { recursive: true });
  return root;
}

function repository(root: string, hooks?: FileObjectRepositoryHooksV1) {
  return new FileObjectRepositoryV1({
    approvedRootAbsolutePath: root,
    validationPorts: validationPorts(),
    temporaryName: () => "deterministic-temp",
    ...(hooks === undefined ? {} : { hooks }),
  });
}

function createRequest() {
  return {
    family: CAREER_SOURCE_OBJECT_V1,
    ownerId: OWNER_ID,
    actorId: ACTOR_ID,
    lifecycleState: "active" as const,
    metadata: { labels: [], extensions: {} },
    provenance: {
      version: "1" as const,
      originCategory: "system-produced" as const,
      observedAt: TIMESTAMP,
      correlationId: "phase5b.synthetic.file-create",
    },
  };
}

function revisionRequest(objectId: ObjectIdV1) {
  return {
    objectId,
    expectedRevision: 1,
    actorId: ACTOR_ID,
    lifecycleState: "archived" as const,
    metadata: { labels: [], extensions: {} },
    provenance: {
      version: "1" as const,
      originCategory: "system-produced" as const,
      observedAt: TIMESTAMP,
      correlationId: "phase5b.synthetic.file-append",
    },
  };
}

function revisionPath(root: string, objectId: Parameters<typeof deriveObjectStorageKeyV1>[0], revision: number): string {
  return join(root, "v1", "objects", deriveObjectStorageKeyV1(objectId), "revisions", `${revision}.aion`);
}

test("constructor requires an explicit absolute private/object-store root and has no creation side effect", async (t) => {
  const root = await storeRoot(t);
  const before = await readdir(root);
  repository(root);
  assert.deepEqual(await readdir(root), before);
  assert.throws(() => new FileObjectRepositoryV1({ approvedRootAbsolutePath: "private/object-store", validationPorts: validationPorts() }),
    (error: unknown) => error instanceof ObjectErrorV1 && error.code === "object-path-rejected");
  assert.throws(() => new FileObjectRepositoryV1({ approvedRootAbsolutePath: join(root, "..", "object-store-sibling"), validationPorts: validationPorts() }),
    (error: unknown) => error instanceof ObjectErrorV1 && error.code === "object-path-rejected");
  if (process.platform === "win32") {
    assert.throws(() => new FileObjectRepositoryV1({ approvedRootAbsolutePath: "\\\\?\\C:\\private\\object-store", validationPorts: validationPorts() }),
      (error: unknown) => error instanceof ObjectErrorV1 && error.code === "object-path-rejected");
  }
});

test("deterministic domain-separated storage key is safe and traversal input is rejected", () => {
  const objectId = FAMILY_OBJECT_IDS[0] as Parameters<typeof deriveObjectStorageKeyV1>[0];
  const first = deriveObjectStorageKeyV1(objectId);
  assert.equal(first, deriveObjectStorageKeyV1(objectId));
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first.includes(objectId), false);
  assert.throws(() => deriveObjectStorageKeyV1("../../outside" as never),
    (error: unknown) => error instanceof ObjectErrorV1 && error.code === "invalid-identifier");
});

test("atomic creation and revision reload exact ACJ-1 bytes, history, integrity, and provenance", async (t) => {
  const root = await storeRoot(t);
  const fileRepository = repository(root);
  const ports = careerPorts([FAMILY_OBJECT_IDS[0]], fileRepository);
  const first = await createInitialObjectV1(createRequest(), ports);
  const firstBytes = await readFile(revisionPath(root, first.objectId, 1));
  assert.deepEqual(firstBytes, Buffer.from(ports.canonicalizer.canonicalize(first)));
  assert.deepEqual(await fileRepository.loadCurrent(first.objectId), first);

  const second = await appendObjectRevisionV1(revisionRequest(first.objectId), ports);
  const secondBytes = await readFile(revisionPath(root, first.objectId, 2));
  assert.deepEqual(secondBytes, Buffer.from(ports.canonicalizer.canonicalize(second)));
  assert.deepEqual(await fileRepository.loadRevision(first.objectId, 1), first);
  assert.deepEqual(await fileRepository.loadRevision(first.objectId, 2), second);
  assert.equal((await fileRepository.loadCurrent(first.objectId))?.provenanceSummary.correlationId,
    "phase5b.synthetic.file-append");
});

test("filesystem adapter reloads every required family and allowed RelationshipObject kind", async (t) => {
  const root = await storeRoot(t);
  const fileRepository = repository(root);
  const ports = careerPorts([...FAMILY_OBJECT_IDS, ...RELATIONSHIP_OBJECT_IDS], fileRepository);
  const ids = await createAllCareerFamilies(ports);
  for (const objectId of ids.values()) assert.notEqual(await fileRepository.loadCurrent(objectId), null);
  for (const descriptor of RELATIONSHIP_DESCRIPTORS_V1) {
    const relationship = await createRelationshipObjectV1({
      relationshipKind: descriptor.relationshipKind,
      sourceObjectId: ids.get(descriptor.source.objectType)!,
      targetObjectId: ids.get(descriptor.target.objectType)!,
      ownerId: OWNER_ID,
      actorId: ACTOR_ID,
      effectiveFrom: TIMESTAMP,
      metadata: { labels: [], extensions: {} },
      provenance: {
        version: "1",
        originCategory: "system-produced",
        observedAt: TIMESTAMP,
        correlationId: "phase5b.synthetic.file-relationship",
      },
    }, ports);
    assert.deepEqual(await fileRepository.loadCurrent(relationship.objectId), relationship);
  }
});

test("duplicate initial creation and silent overwrite are rejected", async (t) => {
  const root = await storeRoot(t);
  const fileRepository = repository(root);
  const ports = careerPorts([FAMILY_OBJECT_IDS[0], FAMILY_OBJECT_IDS[0]], fileRepository);
  const first = await createInitialObjectV1(createRequest(), ports);
  const before = await readFile(revisionPath(root, first.objectId, 1));
  await assert.rejects(() => createInitialObjectV1(createRequest(), ports),
    (error: unknown) => error instanceof ObjectErrorV1 && error.code === "revision-conflict");
  assert.deepEqual(await readFile(revisionPath(root, first.objectId, 1)), before);
});

test("concurrent initial creation has exactly one winner", async (t) => {
  const root = await storeRoot(t);
  const left = careerPorts([FAMILY_OBJECT_IDS[0]], repository(root));
  const right = careerPorts([FAMILY_OBJECT_IDS[0]], repository(root));
  const outcomes = await Promise.allSettled([
    createInitialObjectV1(createRequest(), left),
    createInitialObjectV1(createRequest(), right),
  ]);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((item) => item.status === "rejected").length, 1);
  assert.equal((await left.repository.loadCurrent(FAMILY_OBJECT_IDS[0] as never))?.revision, 1);
});

test("concurrent same-revision append has exactly one winner and no history loss", async (t) => {
  const root = await storeRoot(t);
  const initialPorts = careerPorts([FAMILY_OBJECT_IDS[0]], repository(root));
  const first = await createInitialObjectV1(createRequest(), initialPorts);
  const left = careerPorts([], repository(root));
  const right = careerPorts([], repository(root));
  const outcomes = await Promise.allSettled([
    appendObjectRevisionV1(revisionRequest(first.objectId), left),
    appendObjectRevisionV1(revisionRequest(first.objectId), right),
  ]);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((item) => item.status === "rejected").length, 1);
  assert.equal((await initialPorts.repository.loadCurrent(first.objectId))?.revision, 2);
  assert.deepEqual(await initialPorts.repository.loadRevision(first.objectId, 1), first);
});

test("injected installation failure leaves no partial revision and permits a clean retry", async (t) => {
  const root = await storeRoot(t);
  let attempts = 0;
  const fileRepository = repository(root, { beforeInstall: () => {
    attempts += 1;
    if (attempts === 1 || attempts === 3) throw new Error("synthetic failure");
  } });
  const ports = careerPorts([FAMILY_OBJECT_IDS[0], FAMILY_OBJECT_IDS[0]], fileRepository);
  await assert.rejects(() => createInitialObjectV1(createRequest(), ports),
    (error: unknown) => error instanceof ObjectErrorV1 && error.code === "commit-failed");
  const revisions = join(root, "v1", "objects", deriveObjectStorageKeyV1(FAMILY_OBJECT_IDS[0] as never), "revisions");
  assert.deepEqual(await readdir(revisions), []);
  const retry = await createInitialObjectV1(createRequest(), ports);
  assert.deepEqual(await fileRepository.loadCurrent(retry.objectId), retry);
  await assert.rejects(() => appendObjectRevisionV1(revisionRequest(retry.objectId), ports),
    (error: unknown) => error instanceof ObjectErrorV1 && error.code === "commit-failed");
  assert.deepEqual(await fileRepository.loadCurrent(retry.objectId), retry);
  assert.deepEqual(await readdir(revisions), ["1.aion"]);
  const second = await appendObjectRevisionV1(revisionRequest(retry.objectId), ports);
  assert.equal(second.revision, 2);
});

test("digest and integrity-frame corruption fail closed", async (t) => {
  const root = await storeRoot(t);
  const fileRepository = repository(root);
  const ports = careerPorts([FAMILY_OBJECT_IDS[0]], fileRepository);
  const first = await createInitialObjectV1(createRequest(), ports);
  const path = revisionPath(root, first.objectId, 1);
  const corruptedDigest = { ...first, integrity: { ...first.integrity, digest: "0".repeat(64) } };
  await writeFile(path, ports.canonicalizer.canonicalize(corruptedDigest));
  await assert.rejects(() => fileRepository.loadCurrent(first.objectId),
    (error: unknown) => error instanceof ObjectErrorV1 && error.code === "integrity-mismatch");

  const corruptedFrame = { ...first, integrity: { ...first.integrity, purpose: "aion.object.other" } };
  await writeFile(path, ports.canonicalizer.canonicalize(corruptedFrame));
  await assert.rejects(() => fileRepository.loadCurrent(first.objectId),
    (error: unknown) => error instanceof ObjectErrorV1 && error.code === "integrity-mismatch");
});

test("revision gaps and unsupported stored contract versions fail closed", async (t) => {
  const root = await storeRoot(t);
  const fileRepository = repository(root);
  const ports = careerPorts([FAMILY_OBJECT_IDS[0]], fileRepository);
  const first = await createInitialObjectV1(createRequest(), ports);
  await appendObjectRevisionV1(revisionRequest(first.objectId), ports);
  const unexpected = join(root, "v1", "objects", deriveObjectStorageKeyV1(first.objectId), "unexpected.txt");
  await writeFile(unexpected, "synthetic corruption", "utf8");
  await assert.rejects(() => fileRepository.loadCurrent(first.objectId),
    (error: unknown) => error instanceof ObjectErrorV1 && error.code === "object-storage-invalid");
  await rm(unexpected);
  await rename(revisionPath(root, first.objectId, 2), revisionPath(root, first.objectId, 3));
  await assert.rejects(() => fileRepository.loadCurrent(first.objectId),
    (error: unknown) => error instanceof ObjectErrorV1 && error.code === "object-storage-invalid");

  await rename(revisionPath(root, first.objectId, 3), revisionPath(root, first.objectId, 2));
  const unsupported = { ...first, objectContractVersion: "2" };
  await writeFile(revisionPath(root, first.objectId, 1), ports.canonicalizer.canonicalize(unsupported));
  await assert.rejects(() => fileRepository.loadCurrent(first.objectId),
    (error: unknown) => error instanceof ObjectErrorV1 && error.code === "unsupported-contract");

  const unsupportedSchema = { ...first, schemaVersion: 2 };
  await writeFile(revisionPath(root, first.objectId, 1), ports.canonicalizer.canonicalize(unsupportedSchema));
  await assert.rejects(() => fileRepository.loadCurrent(first.objectId),
    (error: unknown) => error instanceof ObjectErrorV1 && error.code === "unknown-object-type");
});

test("external link or junction escape is rejected, with truthful platform skip", async (t) => {
  const root = await storeRoot(t);
  const external = await mkdtemp(join(tmpdir(), "aion-object-external-"));
  t.after(() => rm(external, { recursive: true, force: true }));
  try {
    await symlink(external, join(root, "v1"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("OS denied synthetic link/junction creation with EPERM.");
      return;
    }
    throw error;
  }
  const fileRepository = repository(root);
  await assert.rejects(() => fileRepository.loadCurrent(FAMILY_OBJECT_IDS[0] as never),
    (error: unknown) => error instanceof ObjectErrorV1 && error.code === "object-path-rejected");
});

test("missing cross-volume approved root is rejected without inference or scanning", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Cross-volume drive syntax is Windows-specific.");
    return;
  }
  const currentDrive = process.cwd().slice(0, 2).toLocaleUpperCase("en-US");
  const otherDrive = currentDrive === "C:" ? "Z:" : "C:";
  const fileRepository = repository(`${otherDrive}\\synthetic\\private\\object-store`);
  await assert.rejects(() => fileRepository.loadCurrent(FAMILY_OBJECT_IDS[0] as never),
    (error: unknown) => error instanceof ObjectErrorV1 && error.code === "object-path-rejected");
});
