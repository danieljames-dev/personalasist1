import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import {
  dryRunJobPostingImportV1,
  importJobPostingV1,
  Sha256JobPostingIdDeriverV1,
  validateJobPostingPayloadV1,
} from "../src/index.js";
import { jobPorts, structuredFixture, syntheticPostingInput } from "./helpers.js";

test("dry run validates and proposes one creation while writing no Object, Relationship, or Identity state", async (t) => {
  const fixture = await structuredFixture(t);
  const ports = jobPorts();
  const result = await dryRunJobPostingImportV1(fixture.request, ports);
  assert.equal(result.accepted, true);
  assert.equal(result.proposedOperation, "create");
  assert.deepEqual(result.unknownFields, ["certificationRequirements", "location", "preferredSkills", "travel"]);
  assert.deepEqual(result.notSuppliedFields, []);
  assert.deepEqual(result.summary, {
    contentReturned: false, completePathReturned: false, objectWrites: 0, relationshipWrites: 0,
    identityWrites: 0, sourceCopies: 0, networkActions: 0,
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /Synthetic Systems Steward|Maintain a synthetic/);
  assert.ok(!serialized.includes(fixture.sourcePath));
  const id = new Sha256JobPostingIdDeriverV1().derive(fixture.request.importOperationId, "job-posting", fixture.request.ownerId);
  assert.equal(await ports.repository.loadCurrent(id), null);
});

test("explicit import creates exactly one JobPostingObject and reload preserves digest, provenance, fields, and unknowns", async (t) => {
  const fixture = await structuredFixture(t);
  const ports = jobPorts();
  const result = await importJobPostingV1(fixture.request, ports);
  assert.equal(result.outcome, "success");
  assert.equal(result.createdObjectCount, 1);
  assert.equal(result.relationshipWrites, 0);
  const id = ports.idDeriver.derive(fixture.request.importOperationId, "job-posting", fixture.request.ownerId);
  const stored = await ports.repository.loadCurrent(id);
  assert.equal(stored?.revision, 1);
  const payload = validateJobPostingPayloadV1(stored?.data);
  assert.equal(payload.sourceProvenance.contentDigest.digest, createHash("sha256").update(await readFile(fixture.sourcePath)).digest("hex"));
  assert.equal(payload.sourceProvenance.approvedRelativePath, "synthetic-posting.json");
  assert.equal(payload.sourceProvenance.originalFilename, "synthetic-posting.json");
  assert.equal(payload.sourceProvenance.parser.parserVersion, "1");
  assert.deepEqual(payload.fields, fieldsWithoutVersion(syntheticPostingInput()));
  assert.equal(payload.listingCurrentness.state, "unknown");
});

function fieldsWithoutVersion(input: ReturnType<typeof syntheticPostingInput>) {
  const { contractVersion: _contractVersion, ...fields } = input;
  return fields;
}

test("identical retry is deterministic and changed source bytes under the same operation fail without overwrite", async (t) => {
  const fixture = await structuredFixture(t);
  const ports = jobPorts();
  assert.equal((await importJobPostingV1(fixture.request, ports)).outcome, "success");
  const duplicate = await importJobPostingV1(fixture.request, ports);
  assert.equal(duplicate.outcome, "already-completed");
  assert.equal(duplicate.createdObjectCount, 0);
  await writeFile(fixture.sourcePath, JSON.stringify({ ...syntheticPostingInput(), title: { state: "supplied", value: "Changed Synthetic Role" } }), "utf8");
  const conflict = await importJobPostingV1(fixture.request, ports);
  assert.equal(conflict.outcome, "rejected");
  assert.equal(conflict.error?.code, "revision-conflict");
  const id = ports.idDeriver.derive(fixture.request.importOperationId, "job-posting", fixture.request.ownerId);
  assert.equal((await ports.repository.loadCurrent(id))?.revision, 1);
});

test("explicit revision requires expected current revision, preserves history, and retries deterministically", async (t) => {
  const fixture = await structuredFixture(t);
  const ports = jobPorts();
  await importJobPostingV1(fixture.request, ports);
  const id = ports.idDeriver.derive(fixture.request.importOperationId, "job-posting", fixture.request.ownerId);
  await writeFile(fixture.sourcePath, JSON.stringify({ ...syntheticPostingInput(), title: { state: "supplied", value: "Synthetic Revised Steward" } }), "utf8");
  const revisionRequest = {
    ...fixture.request,
    importOperationId: "phase8.synthetic.revision",
    target: { mode: "revision" as const, jobPostingObjectId: id, expectedRevision: 1 },
  };
  const revised = await importJobPostingV1(revisionRequest, ports);
  assert.equal(revised.outcome, "success");
  assert.equal(revised.revision, 2);
  assert.equal(validateJobPostingPayloadV1((await ports.repository.loadRevision(id, 1))?.data).fields.title.state, "supplied");
  assert.deepEqual(validateJobPostingPayloadV1((await ports.repository.loadRevision(id, 2))?.data).fields.title, { state: "supplied", value: "Synthetic Revised Steward" });
  const retry = await importJobPostingV1(revisionRequest, ports);
  assert.equal(retry.outcome, "already-completed");
  const staleDifferent = await importJobPostingV1({ ...revisionRequest, importOperationId: "phase8.synthetic.stale" }, ports);
  assert.equal(staleDifferent.outcome, "rejected");
  assert.equal(staleDifferent.error?.code, "revision-conflict");
  assert.equal((await ports.repository.loadCurrent(id))?.revision, 2);
});

test("concurrent identical creation has one winner and deterministic duplicate result", async (t) => {
  const fixture = await structuredFixture(t);
  const ports = jobPorts();
  const results = await Promise.all([
    importJobPostingV1(fixture.request, ports),
    importJobPostingV1(fixture.request, ports),
  ]);
  assert.deepEqual(results.map((item) => item.outcome).sort(), ["already-completed", "success"]);
  const id = ports.idDeriver.derive(fixture.request.importOperationId, "job-posting", fixture.request.ownerId);
  assert.equal((await ports.repository.loadCurrent(id))?.revision, 1);
});

test("concurrent different revisions have one winner and preserve one immutable append", async (t) => {
  const fixture = await structuredFixture(t);
  const ports = jobPorts();
  await importJobPostingV1(fixture.request, ports);
  const id = ports.idDeriver.derive(fixture.request.importOperationId, "job-posting", fixture.request.ownerId);
  const requestA = {
    ...fixture.request, importOperationId: "phase8.synthetic.concurrent-a",
    target: { mode: "revision" as const, jobPostingObjectId: id, expectedRevision: 1 },
  };
  const requestB = { ...requestA, importOperationId: "phase8.synthetic.concurrent-b" };
  const results = await Promise.all([importJobPostingV1(requestA, ports), importJobPostingV1(requestB, ports)]);
  assert.equal(results.filter((item) => item.outcome === "success").length, 1);
  assert.equal(results.filter((item) => item.outcome === "rejected" && item.error?.code === "revision-conflict").length, 1);
  assert.equal((await ports.repository.loadCurrent(id))?.revision, 2);
  assert.notEqual(await ports.repository.loadRevision(id, 1), null);
});
