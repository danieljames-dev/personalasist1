import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  importCareerEvidenceV1,
  markCareerFactsConflictingV1,
  supersedeCareerFactV1,
  validateCareerFactPayloadV1,
} from "../src/index.js";
import { ACTOR_ID, evidencePorts, inputFixture, OWNER_ID, syntheticFactsInput } from "./helpers.js";

async function importRolePair(t: Parameters<typeof inputFixture>[0]) {
  const fixture = await inputFixture(t);
  const ports = evidencePorts();
  const factIds = [];
  for (const [index, label] of ["Synthetic Role Alpha", "Synthetic Role Beta"].entries()) {
    const input = syntheticFactsInput();
    input.entries[0]!.factId = `synthetic-entry-${index}`;
    input.entries[0]!.value.value = label;
    const path = join(fixture.approved, `facts-${index}.json`);
    await writeFile(path, JSON.stringify(input), "utf8");
    const importOperationId = `phase7.synthetic.role-${index}`;
    const result = await importCareerEvidenceV1({
      version: "1", importOperationId, ownerId: OWNER_ID, actorId: ACTOR_ID,
      approvedInputRoot: { version: "1", reference: "synthetic-career-input", absolutePath: fixture.approved },
      sourcePath: { version: "1", absolutePath: path }, sourceType: "career-facts-json",
    }, ports);
    assert.equal(result.outcome, "success");
    factIds.push(ports.idDeriver.derive(importOperationId, "career-fact", `synthetic-entry-${index}\0/entries/0/value`));
  }
  return { ports, factIds: factIds.sort() };
}

test("explicit conflicts preserve every value and expose no silent winner", async (t) => {
  const { ports, factIds } = await importRolePair(t);
  const before = await Promise.all(factIds.map((id) => ports.repository.loadCurrent(id)));
  const result = await markCareerFactsConflictingV1({
    version: "1", conflictOperationId: "phase7.synthetic.conflict", ownerId: OWNER_ID, actorId: ACTOR_ID,
    factIds, expectedRevisions: [1, 1], fieldLocations: ["/entries/0/value"],
  }, ports);
  assert.equal(result.outcome, "success");
  const after = await Promise.all(factIds.map((id) => ports.repository.loadCurrent(id)));
  for (let index = 0; index < after.length; index += 1) {
    const object = after[index]!;
    assert.ok(object);
    assert.equal(object.revision, 2);
    const payload = validateCareerFactPayloadV1(object.data);
    assert.equal(payload.status.conflict, "conflicting");
    assert.equal(payload.status.assertion, "owner-confirmed");
    assert.equal(payload.conflict.state, "conflicting");
    assert.deepEqual(payload.normalizedValue, validateCareerFactPayloadV1(before[index]!.data).normalizedValue);
  }
  const retry = await markCareerFactsConflictingV1({
    version: "1", conflictOperationId: "phase7.synthetic.conflict", ownerId: OWNER_ID, actorId: ACTOR_ID,
    factIds, expectedRevisions: [1, 1], fieldLocations: ["/entries/0/value"],
  }, ports);
  assert.equal(retry.outcome, "already-completed");
});

test("explicit supersession preserves prior history and replacement provenance", async (t) => {
  const { ports, factIds } = await importRolePair(t);
  const result = await supersedeCareerFactV1({
    version: "1", supersessionOperationId: "phase7.synthetic.supersession", ownerId: OWNER_ID, actorId: ACTOR_ID,
    priorFactId: factIds[0], replacementFactId: factIds[1], expectedPriorRevision: 1,
  }, ports);
  assert.equal(result.outcome, "success");
  const priorCurrent = await ports.repository.loadCurrent(factIds[0]!);
  const priorOriginal = await ports.repository.loadRevision(factIds[0]!, 1);
  const replacement = await ports.repository.loadCurrent(factIds[1]!);
  assert.ok(priorCurrent && priorOriginal && replacement);
  assert.equal(validateCareerFactPayloadV1(priorCurrent.data).supersession.state, "superseded");
  assert.equal(validateCareerFactPayloadV1(priorOriginal.data).supersession.state, "current");
  assert.equal(replacement.revision, 1);
  assert.equal(replacement.provenanceSummary.sourceObjectId, validateCareerFactPayloadV1(replacement.data).sourceObjectId);
  const stale = await supersedeCareerFactV1({
    version: "1", supersessionOperationId: "phase7.synthetic.stale", ownerId: OWNER_ID, actorId: ACTOR_ID,
    priorFactId: factIds[0], replacementFactId: factIds[1], expectedPriorRevision: 1,
  }, ports);
  assert.equal(stale.outcome, "rejected");
  assert.equal((await ports.repository.loadCurrent(factIds[0]!))!.revision, 2);
});

test("conflict intent validates all selected facts before any revision is written", async (t) => {
  const { ports, factIds } = await importRolePair(t);
  const rejected = await markCareerFactsConflictingV1({
    version: "1", conflictOperationId: "phase7.synthetic.conflict-stale", ownerId: OWNER_ID, actorId: ACTOR_ID,
    factIds, expectedRevisions: [1, 99], fieldLocations: ["/entries/0/value"],
  }, ports);
  assert.equal(rejected.outcome, "rejected");
  assert.deepEqual(await Promise.all(factIds.map(async (id) => (await ports.repository.loadCurrent(id))!.revision)), [1, 1]);
});
