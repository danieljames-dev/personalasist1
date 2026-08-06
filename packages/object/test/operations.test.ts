import assert from "node:assert/strict";
import { test } from "node:test";
import * as objectApi from "../src/index.js";
import {
  appendObjectRevisionV1,
  CAREER_SOURCE_OBJECT_V1,
  createInitialObjectV1,
  loadCurrentObjectV1,
  loadObjectRevisionV1,
  ObjectErrorV1,
} from "../src/index.js";
import { ACTOR_ID, OWNER_ID, TIMESTAMP } from "./helpers.js";
import { careerPorts, FAMILY_OBJECT_IDS } from "./career-helpers.js";

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
      correlationId: "phase5b.synthetic.operation-create",
    },
  };
}

test("explicit initial creation succeeds once and duplicate identity fails closed", async () => {
  const ports = careerPorts([FAMILY_OBJECT_IDS[0], FAMILY_OBJECT_IDS[0]]);
  const first = await createInitialObjectV1(createRequest(), ports);
  await assert.rejects(() => createInitialObjectV1(createRequest(), ports),
    (error: unknown) => error instanceof ObjectErrorV1 && error.code === "revision-conflict");
  assert.deepEqual(await ports.repository.loadCurrent(first.objectId), first);
});

test("explicit expected-revision append succeeds and preserves immutable history", async () => {
  const ports = careerPorts([FAMILY_OBJECT_IDS[0]]);
  const first = await createInitialObjectV1(createRequest(), ports);
  const second = await appendObjectRevisionV1({
    objectId: first.objectId,
    expectedRevision: 1,
    actorId: ACTOR_ID,
    lifecycleState: "archived",
    metadata: { labels: ["synthetic"], extensions: {} },
    provenance: {
      version: "1",
      originCategory: "system-produced",
      observedAt: TIMESTAMP,
      correlationId: "phase5b.synthetic.operation-append",
    },
  }, ports);
  assert.equal(second.revision, 2);
  assert.equal(second.lifecycleState, "archived");
  assert.deepEqual(await ports.repository.loadRevision(first.objectId, 1), first);
  assert.deepEqual(await ports.repository.loadCurrent(first.objectId), second);
});

test("stale revision fails without altering prior valid history", async () => {
  const ports = careerPorts([FAMILY_OBJECT_IDS[0]]);
  const first = await createInitialObjectV1(createRequest(), ports);
  const request = {
    objectId: first.objectId,
    expectedRevision: 1,
    actorId: ACTOR_ID,
    lifecycleState: "archived" as const,
    metadata: { labels: [], extensions: {} },
    provenance: {
      version: "1" as const,
      originCategory: "system-produced" as const,
      observedAt: TIMESTAMP,
      correlationId: "phase5b.synthetic.operation-append",
    },
  };
  const second = await appendObjectRevisionV1(request, ports);
  await assert.rejects(() => appendObjectRevisionV1(request, ports),
    (error: unknown) => error instanceof ObjectErrorV1 && error.code === "revision-conflict");
  assert.deepEqual(await ports.repository.loadCurrent(first.objectId), second);
  assert.equal(await ports.repository.loadRevision(first.objectId, 3), null);
});

test("explicit load operations validate current and historical snapshots", async () => {
  const ports = careerPorts([FAMILY_OBJECT_IDS[0]]);
  const first = await createInitialObjectV1(createRequest(), ports);
  assert.deepEqual(await loadCurrentObjectV1(first.objectId, ports.repository, ports), first);
  assert.deepEqual(await loadObjectRevisionV1(first.objectId, 1, ports.repository, ports), first);
  assert.equal(await loadObjectRevisionV1(first.objectId, 2, ports.repository, ports), null);
});

test("public API exposes no unrestricted mutation, patch, delete, query, search, event, planner, or permission operation", () => {
  const forbidden = [
    "mutateObject", "patchObject", "updateObject", "deleteObject", "queryObjects",
    "searchObjects", "publishEvent", "runPlanner", "setPermission",
  ];
  for (const name of forbidden) assert.equal(Object.hasOwn(objectApi, name), false);
  assert.equal(Object.hasOwn(objectApi, "createInitialObjectV1"), true);
  assert.equal(Object.hasOwn(objectApi, "appendObjectRevisionV1"), true);
  assert.equal(Object.hasOwn(objectApi, "createRelationshipObjectV1"), true);
  assert.equal(Object.hasOwn(objectApi, "appendRelationshipRevisionV1"), true);
});
