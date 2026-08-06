import assert from "node:assert/strict";
import { test } from "node:test";
import {
  asObjectSchemaIdV1,
  asObjectTypeV1,
  CAREER_ENTITY_FAMILY_REGISTRATIONS_V1,
  CareerObjectSchemaRegistryV1,
  createInitialObjectV1,
  OBJECT_FAMILY_REGISTRATIONS_V1,
  ObjectErrorV1,
  RELATIONSHIP_OBJECT_V1,
  validateObjectEnvelopeV1,
} from "../src/index.js";
import { ACTOR_ID, OWNER_ID, TIMESTAMP } from "./helpers.js";
import { careerPorts, FAMILY_OBJECT_IDS, FAMILY_REGISTRATIONS } from "./career-helpers.js";

test("exactly seven required versioned Object families are registered", () => {
  assert.equal(OBJECT_FAMILY_REGISTRATIONS_V1.length, 7);
  assert.equal(CAREER_ENTITY_FAMILY_REGISTRATIONS_V1.length, 6);
  assert.equal(new Set(OBJECT_FAMILY_REGISTRATIONS_V1.map((item) => item.objectType)).size, 7);
  assert.equal(RELATIONSHIP_OBJECT_V1.objectProfile, "relationship");
  assert.ok(OBJECT_FAMILY_REGISTRATIONS_V1.every((item) => item.schemaVersion === 1));
});

test("registry rejects unsupported families and wrong family/profile/schema tuples", () => {
  const registry = new CareerObjectSchemaRegistryV1();
  assert.ok(OBJECT_FAMILY_REGISTRATIONS_V1.every((item) => registry.isRegistered(item)));
  assert.equal(registry.isRegistered({
    objectType: asObjectTypeV1("aion.career.unsupported"),
    objectProfile: "entity",
    schemaId: asObjectSchemaIdV1("aion.schema.unsupported"),
    schemaVersion: 1,
  }), false);
  assert.equal(registry.isRegistered({ ...FAMILY_REGISTRATIONS[0], objectProfile: "relationship" }), false);
  assert.equal(registry.isRegistered({ ...FAMILY_REGISTRATIONS[0], schemaVersion: 2 }), false);
});

test("each career family constructor preserves the accepted envelope and an empty closed payload", async () => {
  const ports = careerPorts(FAMILY_OBJECT_IDS);
  for (const family of FAMILY_REGISTRATIONS) {
    const snapshot = await createInitialObjectV1({
      family,
      ownerId: OWNER_ID,
      actorId: ACTOR_ID,
      lifecycleState: "active",
      metadata: { labels: [], extensions: {} },
      provenance: {
        version: "1",
        originCategory: "system-produced",
        observedAt: TIMESTAMP,
        correlationId: "phase5b.synthetic.family-test",
      },
    }, ports);
    assert.equal(snapshot.objectType, family.objectType);
    assert.equal(snapshot.objectProfile, "entity");
    assert.equal(snapshot.schemaId, family.schemaId);
    assert.equal(snapshot.schemaVersion, 1);
    assert.deepEqual(snapshot.data, {});
    assert.equal(snapshot.ownership.ownerId, OWNER_ID);
    assert.equal(snapshot.createdBy, ACTOR_ID);
    assert.deepEqual(validateObjectEnvelopeV1(snapshot, ports), snapshot);
    assert.deepEqual(await ports.repository.loadCurrent(snapshot.objectId), snapshot);
  }
});

test("family boundary fails closed instead of accepting arbitrary family identifiers", async () => {
  const ports = careerPorts([FAMILY_OBJECT_IDS[0]]);
  const unsupported = {
    objectType: asObjectTypeV1("aion.career.arbitrary"),
    objectProfile: "entity",
    schemaId: asObjectSchemaIdV1("aion.schema.arbitrary"),
    schemaVersion: 1,
  } as const;
  await assert.rejects(() => createInitialObjectV1({
    family: unsupported as never,
    ownerId: OWNER_ID,
    actorId: ACTOR_ID,
    lifecycleState: "active",
    metadata: { labels: [], extensions: {} },
    provenance: {
      version: "1",
      originCategory: "system-produced",
      observedAt: TIMESTAMP,
      correlationId: "phase5b.synthetic.unsupported",
    },
  }, ports), (error: unknown) => error instanceof ObjectErrorV1 && error.code === "unknown-object-type");
});

test("family payload boundary contains no embedded relationships or deferred career-input fields", () => {
  const forbidden = new Set([
    "relationships", "relationshipIds", "resume", "employmentHistory", "preferences",
    "employer", "jobTitle", "description", "skills", "applicationText",
  ]);
  const emptyPayload = {};
  assert.equal(Object.keys(emptyPayload).some((key) => forbidden.has(key)), false);
  const registry = new CareerObjectSchemaRegistryV1();
  for (const family of FAMILY_REGISTRATIONS) {
    assert.equal(registry.validateData(family, emptyPayload), true);
    assert.equal(registry.validateData(family, { relationships: [] }), false);
    assert.equal(registry.validateData(family, { jobTitle: "synthetic" }), false);
  }
});
