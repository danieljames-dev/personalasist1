import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  deriveObjectStorageKeyV1,
  FileObjectRepositoryV1,
  InMemoryObjectRepositoryV1,
  ObjectErrorV1,
  type ObjectCommitRequestV1,
  type ObjectRepository,
} from "@aion/object";
import { importCareerEvidenceV1, validateCareerSourcePayloadV1 } from "../src/index.js";
import { evidencePorts, factsRequest, inputFixture, validationPorts } from "./helpers.js";

class FailOnceRepository implements ObjectRepository {
  calls = 0;
  constructor(readonly inner: ObjectRepository, readonly failAt: number) {}
  loadCurrent(objectId: Parameters<ObjectRepository["loadCurrent"]>[0]) {
    return this.inner.loadCurrent(objectId);
  }
  loadRevision(objectId: Parameters<ObjectRepository["loadRevision"]>[0], revision: number) {
    return this.inner.loadRevision(objectId, revision);
  }
  async commit(request: ObjectCommitRequestV1): Promise<void> {
    this.calls += 1;
    if (this.calls === this.failAt) throw new ObjectErrorV1("commit-failed", "$", "Synthetic injected persistence failure.");
    await this.inner.commit(request);
  }
}

test("accepted bounded filesystem repository reloads complete immutable catalogue history", async (t) => {
  const fixture = await factsRequest(t, "phase7.synthetic.file-repository");
  const privateRoot = join(fixture.root, "private");
  const objectRoot = join(privateRoot, "object-store");
  await mkdir(objectRoot, { recursive: true });
  const validation = validationPorts();
  const repository = new FileObjectRepositoryV1({
    approvedRootAbsolutePath: objectRoot,
    approvedRootReference: "synthetic-private-object-store",
    validationPorts: validation,
    temporaryName: () => "synthetic-temporary-name",
  });
  const ports = evidencePorts(repository);
  const result = await importCareerEvidenceV1(fixture.request, ports);
  assert.equal(result.outcome, "success");
  const sourceId = ports.idDeriver.derive(fixture.request.importOperationId, "career-source", "source");
  const reloadedRepository = new FileObjectRepositoryV1({
    approvedRootAbsolutePath: objectRoot,
    approvedRootReference: "synthetic-private-object-store",
    validationPorts: validation,
  });
  const current = await reloadedRepository.loadCurrent(sourceId);
  const first = await reloadedRepository.loadRevision(sourceId, 1);
  assert.ok(current && first);
  assert.equal(current.revision, 2);
  assert.equal(validateCareerSourcePayloadV1(current.data).catalogueEntry.processingOutcome.state, "success");
  assert.equal(validateCareerSourcePayloadV1(first.data).catalogueEntry.processingOutcome.state, "pending");
  assert.equal((await readFile(fixture.sourcePath, "utf8")).includes("Synthetic Role Alpha"), true);
});

test("injected finalization failure is partial, preserves valid revisions, and deterministic retry creates no duplicates", async (t) => {
  const fixture = await factsRequest(t, "phase7.synthetic.recovery");
  const validation = validationPorts();
  const inner = new InMemoryObjectRepositoryV1(validation);
  const failing = new FailOnceRepository(inner, 16);
  const ports = evidencePorts(failing);
  const partial = await importCareerEvidenceV1(fixture.request, ports);
  assert.equal(partial.outcome, "partial");
  assert.equal(partial.createdFacts, 7);
  assert.equal(partial.createdRelationships, 7);
  assert.equal(partial.recoveryRequired, true);
  const sourceId = ports.idDeriver.derive(fixture.request.importOperationId, "career-source", "source");
  const partialSource = await inner.loadCurrent(sourceId);
  assert.ok(partialSource);
  assert.equal(validateCareerSourcePayloadV1(partialSource.data).catalogueEntry.processingOutcome.state, "partial");
  const retry = await importCareerEvidenceV1(fixture.request, ports);
  assert.equal(retry.outcome, "success");
  assert.equal(retry.createdFacts, 0);
  assert.equal(retry.reusedFacts, 7);
  assert.equal(retry.createdRelationships, 0);
  assert.equal(retry.reusedRelationships, 7);
  const completed = await inner.loadCurrent(sourceId);
  assert.ok(completed);
  assert.equal(validateCareerSourcePayloadV1(completed.data).catalogueEntry.processingOutcome.state, "success");
});

test("completed import with missing relationship evidence fails closed and performs no repair write", async (t) => {
  const fixture = await factsRequest(t, "phase7.synthetic.missing-relationship");
  const ports = evidencePorts();
  assert.equal((await importCareerEvidenceV1(fixture.request, ports)).outcome, "success");
  const sourceId = ports.idDeriver.derive(fixture.request.importOperationId, "career-source", "source");
  const factId = ports.idDeriver.derive(
    fixture.request.importOperationId, "career-fact", "synthetic-entry-alpha\0/entries/0/accomplishments/0",
  );
  const hiddenRelationshipId = ports.idDeriver.derive(
    fixture.request.importOperationId, "fact-derived-from-source", `${factId}\0${sourceId}`,
  );
  let commits = 0;
  const hidden: ObjectRepository = {
    loadCurrent: async (objectId) => objectId === hiddenRelationshipId ? null : ports.repository.loadCurrent(objectId),
    loadRevision: (objectId, revision) => ports.repository.loadRevision(objectId, revision),
    commit: async (request) => { commits += 1; await ports.repository.commit(request); },
  };
  const retried = await importCareerEvidenceV1(fixture.request, { ...ports, repository: hidden });
  assert.equal(retried.outcome, "rejected");
  assert.equal(retried.error?.code, "object-invalid");
  assert.equal(commits, 0);
  assert.equal((await ports.repository.loadCurrent(sourceId))!.revision, 2);
});

test("corrupted filesystem revision rejects rather than being silently replaced", async (t) => {
  const fixture = await factsRequest(t, "phase7.synthetic.corruption");
  const objectRoot = join(fixture.root, "private", "object-store");
  await mkdir(objectRoot, { recursive: true });
  const validation = validationPorts();
  const repository = new FileObjectRepositoryV1({ approvedRootAbsolutePath: objectRoot, validationPorts: validation });
  const ports = evidencePorts(repository);
  assert.equal((await importCareerEvidenceV1(fixture.request, ports)).outcome, "success");
  const sourceId = ports.idDeriver.derive(fixture.request.importOperationId, "career-source", "source");
  const revisionPath = join(objectRoot, "v1", "objects", deriveObjectStorageKeyV1(sourceId), "revisions", "2.aion");
  await writeFile(revisionPath, "corrupted synthetic revision", "utf8");
  await assert.rejects(() => repository.loadCurrent(sourceId), (error: unknown) => error instanceof ObjectErrorV1);
});

test("Object repository root rejects paths outside explicit private/object-store convention", async (t) => {
  const fixture = await inputFixture(t);
  assert.throws(() => new FileObjectRepositoryV1({
    approvedRootAbsolutePath: fixture.approved,
    validationPorts: validationPorts(),
  }), (error: unknown) => error instanceof ObjectErrorV1 && error.code === "object-path-rejected");
});
