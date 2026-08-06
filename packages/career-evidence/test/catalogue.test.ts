import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  CAREER_SOURCE_OBJECT_V1,
  type ObjectIdV1,
} from "@aion/object";
import {
  dryRunCareerEvidenceImportV1,
  importCareerEvidenceV1,
  validateCareerSourcePayloadV1,
} from "../src/index.js";
import { evidencePorts, factsRequest, inputFixture, OWNER_ID, ACTOR_ID } from "./helpers.js";

test("dry run reports digest and proposed objects without writes, source body, copies, or paths", async (t) => {
  const fixture = await factsRequest(t);
  const ports = evidencePorts();
  const result = await dryRunCareerEvidenceImportV1(fixture.request, ports);
  assert.equal(result.accepted, true);
  assert.equal(result.proposedFactCount, 7);
  assert.equal(result.proposedRelationshipCount, 7);
  assert.deepEqual(result.summary, {
    contentReturned: false, completePathReturned: false, objectWrites: 0,
    identityWrites: 0, sourceCopies: 0, networkActions: 0,
  });
  const sourceId = ports.idDeriver.derive(fixture.request.importOperationId, "career-source", "source");
  assert.equal(await ports.repository.loadCurrent(sourceId), null);
  assert.equal(JSON.stringify(result).includes("Synthetic Role Alpha"), false);
  assert.equal(JSON.stringify(result).includes(fixture.root), false);
});

test("structured import creates a catalogue entry with exact digest and completes idempotently", async (t) => {
  const fixture = await factsRequest(t);
  const ports = evidencePorts();
  const first = await importCareerEvidenceV1(fixture.request, ports);
  assert.equal(first.outcome, "success");
  assert.equal(first.createdFacts, 7);
  assert.equal(first.createdRelationships, 7);
  assert.equal(first.factReferences.length, 7);
  const second = await importCareerEvidenceV1(fixture.request, ports);
  assert.equal(second.outcome, "already-completed");
  assert.equal(second.createdFacts, 0);
  assert.equal(second.reusedFacts, 7);
  const sourceId = ports.idDeriver.derive(fixture.request.importOperationId, "career-source", "source");
  const source = await ports.repository.loadCurrent(sourceId);
  assert.ok(source);
  assert.equal(source.revision, 2);
  assert.equal(source.objectType, CAREER_SOURCE_OBJECT_V1.objectType);
  const payload = validateCareerSourcePayloadV1(source.data);
  assert.equal(payload.catalogueEntry.processingOutcome.state, "success");
  assert.equal(payload.catalogueEntry.approvedRelativePath, "synthetic-facts.json");
  assert.equal(payload.catalogueEntry.contentDigest.algorithm, "sha-256");
  assert.match(payload.catalogueEntry.contentDigest.digest, /^[0-9a-f]{64}$/);
  assert.equal(payload.catalogueEntry.contentDigest.digest, createHash("sha256").update(await readFile(fixture.sourcePath)).digest("hex"));
  assert.equal(JSON.stringify(payload).includes(fixture.root), false);
});

test("Markdown and text create catalogue entries and line indexes but no semantic facts", async (t) => {
  for (const item of [
    { name: "synthetic-resume.md", sourceType: "resume-evidence-markdown", body: "# Synthetic section\nNeutral evidence line.\n" },
    { name: "synthetic-evidence.txt", sourceType: "plain-text-evidence", body: "Neutral line one.\nNeutral line two.\n" },
  ] as const) {
    const fixture = await inputFixture(t);
    const sourcePath = join(fixture.approved, item.name);
    await writeFile(sourcePath, item.body, "utf8");
    const ports = evidencePorts();
    const operationId = `phase7.synthetic.${item.sourceType}`;
    const request = {
      version: "1", importOperationId: operationId, ownerId: OWNER_ID, actorId: ACTOR_ID,
      approvedInputRoot: { version: "1", reference: "synthetic-career-input", absolutePath: fixture.approved },
      sourcePath: { version: "1", absolutePath: sourcePath }, sourceType: item.sourceType,
    };
    const result = await importCareerEvidenceV1(request, ports);
    assert.equal(result.outcome, "success");
    assert.equal(result.factReferences.length, 0);
    const sourceId = ports.idDeriver.derive(operationId, "career-source", "source");
    const source = await ports.repository.loadCurrent(sourceId as ObjectIdV1);
    assert.ok(source);
    const payload = validateCareerSourcePayloadV1(source.data);
    assert.equal(payload.catalogueEntry.locationIndex.format, "line-number-v1");
    assert.equal(JSON.stringify(payload).includes("Neutral evidence"), false);
  }
});

test("job-posting input and source-type ambiguity fail before persistence", async (t) => {
  const fixture = await inputFixture(t);
  const sourcePath = join(fixture.approved, "posting.json");
  await writeFile(sourcePath, JSON.stringify({ contractVersion: "aion.job-posting-input.v1" }), "utf8");
  const ports = evidencePorts();
  const request = {
    version: "1", importOperationId: "phase7.synthetic.posting", ownerId: OWNER_ID, actorId: ACTOR_ID,
    approvedInputRoot: { version: "1", reference: "synthetic-career-input", absolutePath: fixture.approved },
    sourcePath: { version: "1", absolutePath: sourcePath }, sourceType: "career-facts-json",
  };
  const result = await importCareerEvidenceV1(request, ports);
  assert.equal(result.outcome, "rejected");
  assert.equal(result.sourceReference, null);
  assert.equal(await ports.repository.loadCurrent(ports.idDeriver.derive(request.importOperationId, "career-source", "source")), null);
});
