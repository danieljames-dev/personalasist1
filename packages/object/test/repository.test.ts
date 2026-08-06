import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InMemoryObjectRepositoryV1,
  objectEnvelopeContentV1,
  ObjectErrorV1,
  sealObjectEnvelopeV1,
  type ObjectEnvelopeV1,
} from "../src/index.js";
import {
  createRevision,
  createSyntheticObject,
  deterministicPorts,
  LATER_TIMESTAMP,
  OTHER_ACTOR_ID,
} from "./helpers.js";

async function code(operation: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await operation();
    return undefined;
  } catch (error) {
    return error instanceof ObjectErrorV1 ? error.code : "unexpected";
  }
}

test("create, load, and historical reload preserve immutable snapshots", async () => {
  const ports = deterministicPorts();
  const repository = new InMemoryObjectRepositoryV1(ports);
  const first = createSyntheticObject(ports);
  await repository.commit({ expectedRevision: null, snapshot: first });
  assert.deepEqual(await repository.loadCurrent(first.objectId), first);
  assert.deepEqual(await repository.loadRevision(first.objectId, 1), first);

  const second = createRevision(first, ports);
  await repository.commit({ expectedRevision: 1, snapshot: second });
  assert.deepEqual(await repository.loadCurrent(first.objectId), second);
  assert.deepEqual(await repository.loadRevision(first.objectId, 1), first);
  assert.deepEqual(await repository.loadRevision(first.objectId, 2), second);
});

test("expected-revision conflict fails closed and preserves prior state", async () => {
  const ports = deterministicPorts();
  const repository = new InMemoryObjectRepositoryV1(ports);
  const first = createSyntheticObject(ports);
  const second = createRevision(first, ports);
  await repository.commit({ expectedRevision: null, snapshot: first });
  assert.equal(await code(() => repository.commit({ expectedRevision: 2, snapshot: second })), "revision-conflict");
  assert.deepEqual(await repository.loadCurrent(first.objectId), first);
  assert.equal(await repository.loadRevision(first.objectId, 2), null);
});

test("concurrent same-revision commits produce one winner without partial history", async () => {
  const ports = deterministicPorts();
  const repository = new InMemoryObjectRepositoryV1(ports);
  const first = createSyntheticObject(ports);
  const secondA = createRevision(first, ports);
  const secondB = createRevision(first, ports, { data: { kind: "synthetic-reference", value: 99 } });
  await repository.commit({ expectedRevision: null, snapshot: first });
  const outcomes = await Promise.allSettled([
    repository.commit({ expectedRevision: 1, snapshot: secondA }),
    repository.commit({ expectedRevision: 1, snapshot: secondB }),
  ]);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((item) => item.status === "rejected").length, 1);
  const current = await repository.loadCurrent(first.objectId);
  assert.equal(current?.revision, 2);
  assert.deepEqual(await repository.loadRevision(first.objectId, 1), first);
});

test("invalid revision, immutable-field change, and deletion transition reject", async () => {
  const ports = deterministicPorts();
  const repository = new InMemoryObjectRepositoryV1(ports);
  const first = createSyntheticObject(ports);
  await repository.commit({ expectedRevision: null, snapshot: first });

  const skipped = createRevision(first, ports, { revision: 3 });
  assert.equal(await code(() => repository.commit({ expectedRevision: 1, snapshot: skipped })), "revision-conflict");

  const ownerChanged = createRevision(first, ports, { ownership: { ownerId: "10000000-0000-4000-8000-000000000099" as never } });
  assert.equal(await code(() => repository.commit({ expectedRevision: 1, snapshot: ownerChanged })), "invalid-object");

  const deleted = createRevision(first, ports, { lifecycleState: "deleted" });
  assert.equal(await code(() => repository.commit({ expectedRevision: 1, snapshot: deleted })), "invalid-lifecycle-transition");
  assert.deepEqual(await repository.loadCurrent(first.objectId), first);
});

test("corrupted or unsupported snapshots never partially write", async () => {
  const ports = deterministicPorts();
  const repository = new InMemoryObjectRepositoryV1(ports);
  const first = createSyntheticObject(ports);
  const corrupted = {
    ...first,
    integrity: { ...first.integrity, digest: "0".repeat(64) },
  } as ObjectEnvelopeV1;
  assert.equal(await code(() => repository.commit({ expectedRevision: null, snapshot: corrupted })), "integrity-mismatch");
  assert.equal(await repository.loadCurrent(first.objectId), null);
  assert.throws(() => new InMemoryObjectRepositoryV1(ports, [{ ...first, objectContractVersion: "2" }]));
});

test("stored state is isolated from caller-owned mutable values", async () => {
  const ports = deterministicPorts();
  const repository = new InMemoryObjectRepositoryV1(ports);
  const first = createSyntheticObject(ports);
  const mutable = structuredClone(first) as unknown as ObjectEnvelopeV1;
  await repository.commit({ expectedRevision: null, snapshot: mutable });
  assert.equal(Object.isFrozen(await repository.loadCurrent(first.objectId)), true);
});

test("allowed non-destructive lifecycle changes preserve expected revision", async () => {
  const ports = deterministicPorts();
  const repository = new InMemoryObjectRepositoryV1(ports);
  const first = createSyntheticObject(ports);
  await repository.commit({ expectedRevision: null, snapshot: first });
  const archived = sealObjectEnvelopeV1({
    ...objectEnvelopeContentV1(first),
    revision: 2,
    lifecycleState: "archived",
    modifiedBy: OTHER_ACTOR_ID,
    modifiedAt: LATER_TIMESTAMP,
    provenanceSummary: {
      ...first.provenanceSummary,
      responsibleActorId: OTHER_ACTOR_ID,
      observedAt: LATER_TIMESTAMP,
      recordedAt: LATER_TIMESTAMP,
      correlationId: "phase5.synthetic.archive",
    },
  }, ports);
  await repository.commit({ expectedRevision: 1, snapshot: archived });
  assert.equal((await repository.loadCurrent(first.objectId))?.lifecycleState, "archived");
});
