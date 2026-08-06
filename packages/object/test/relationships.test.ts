import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendRelationshipRevisionV1,
  asObjectIdV1,
  createRelationshipObjectV1,
  ObjectErrorV1,
  RELATIONSHIP_DESCRIPTORS_V1,
  type ObjectIdV1,
  validateRelationshipObjectDataV1,
} from "../src/index.js";
import { ACTOR_ID, LATER_TIMESTAMP, OWNER_ID, TIMESTAMP } from "./helpers.js";
import {
  careerPorts,
  createAllCareerFamilies,
  FAMILY_OBJECT_IDS,
  RELATIONSHIP_OBJECT_IDS,
} from "./career-helpers.js";

function relationshipRequest(kind: (typeof RELATIONSHIP_DESCRIPTORS_V1)[number]["relationshipKind"], sourceObjectId: ObjectIdV1, targetObjectId: ObjectIdV1) {
  return {
    relationshipKind: kind,
    sourceObjectId,
    targetObjectId,
    ownerId: OWNER_ID,
    actorId: ACTOR_ID,
    effectiveFrom: TIMESTAMP,
    metadata: { labels: [], extensions: {} },
    provenance: {
      version: "1" as const,
      originCategory: "system-produced" as const,
      observedAt: TIMESTAMP,
      correlationId: "phase5b.synthetic.relationship",
    },
  };
}

test("all seven required relationship kinds create separate RelationshipObjects with valid endpoints", async () => {
  const ports = careerPorts([...FAMILY_OBJECT_IDS, ...RELATIONSHIP_OBJECT_IDS]);
  const ids = await createAllCareerFamilies(ports);
  for (const descriptor of RELATIONSHIP_DESCRIPTORS_V1) {
    const relationship = await createRelationshipObjectV1(relationshipRequest(
      descriptor.relationshipKind,
      ids.get(descriptor.source.objectType)!,
      ids.get(descriptor.target.objectType)!,
    ), ports);
    assert.equal(relationship.objectProfile, "relationship");
    assert.equal(relationship.data.relationshipKind, descriptor.relationshipKind);
    assert.equal(relationship.data.source.objectId, ids.get(descriptor.source.objectType));
    assert.equal(relationship.data.target.objectId, ids.get(descriptor.target.objectType));
    assert.equal(validateRelationshipObjectDataV1(relationship.data), true);
    assert.deepEqual(await ports.repository.loadCurrent(relationship.objectId), relationship);
  }
});

test("reversed, wrong-source, wrong-target, and unsupported relationship combinations fail closed", async () => {
  const ports = careerPorts([...FAMILY_OBJECT_IDS, RELATIONSHIP_OBJECT_IDS[0]]);
  const ids = await createAllCareerFamilies(ports);
  const descriptor = RELATIONSHIP_DESCRIPTORS_V1[0]!;
  const validSource = ids.get(descriptor.source.objectType)!;
  const validTarget = ids.get(descriptor.target.objectType)!;
  const unrelated = ids.get(RELATIONSHIP_DESCRIPTORS_V1[3]!.source.objectType)!;
  for (const request of [
    relationshipRequest(descriptor.relationshipKind, validTarget, validSource),
    relationshipRequest(descriptor.relationshipKind, unrelated, validTarget),
    relationshipRequest(descriptor.relationshipKind, validSource, unrelated),
  ]) {
    await assert.rejects(() => createRelationshipObjectV1(request, ports),
      (error: unknown) => error instanceof ObjectErrorV1 && error.code === "invalid-reference");
  }
  await assert.rejects(() => createRelationshipObjectV1({
    ...relationshipRequest(descriptor.relationshipKind, validSource, validTarget),
    relationshipKind: "aion.relationship.unsupported.v1" as never,
  }, ports), (error: unknown) => error instanceof ObjectErrorV1 && error.code === "invalid-domain-data");
});

test("missing endpoints and self-relations fail closed", async () => {
  const ports = careerPorts([...FAMILY_OBJECT_IDS, RELATIONSHIP_OBJECT_IDS[0]]);
  const ids = await createAllCareerFamilies(ports);
  const descriptor = RELATIONSHIP_DESCRIPTORS_V1[0]!;
  const source = ids.get(descriptor.source.objectType)!;
  await assert.rejects(() => createRelationshipObjectV1(relationshipRequest(
    descriptor.relationshipKind,
    source,
    asObjectIdV1("43000000-0000-4000-8000-000000000099"),
  ), ports), (error: unknown) => error instanceof ObjectErrorV1 && error.code === "not-found");
  await assert.rejects(() => createRelationshipObjectV1(relationshipRequest(
    descriptor.relationshipKind,
    source,
    source,
  ), ports), (error: unknown) => error instanceof ObjectErrorV1
    && (error.code === "invalid-reference" || error.code === "not-found"));
});

test("RelationshipObject canonicalization is deterministic", async () => {
  const ids = [...FAMILY_OBJECT_IDS, RELATIONSHIP_OBJECT_IDS[0]];
  const leftPorts = careerPorts(ids);
  const rightPorts = careerPorts(ids);
  const leftFamilies = await createAllCareerFamilies(leftPorts);
  const rightFamilies = await createAllCareerFamilies(rightPorts);
  const descriptor = RELATIONSHIP_DESCRIPTORS_V1[0]!;
  const left = await createRelationshipObjectV1(relationshipRequest(
    descriptor.relationshipKind,
    leftFamilies.get(descriptor.source.objectType)!,
    leftFamilies.get(descriptor.target.objectType)!,
  ), leftPorts);
  const right = await createRelationshipObjectV1(relationshipRequest(
    descriptor.relationshipKind,
    rightFamilies.get(descriptor.source.objectType)!,
    rightFamilies.get(descriptor.target.objectType)!,
  ), rightPorts);
  assert.deepEqual(left, right);
  assert.deepEqual(leftPorts.canonicalizer.canonicalize(left), rightPorts.canonicalizer.canonicalize(right));
});

test("relationship revisions retain endpoints, kind, immutable history, and provenance", async () => {
  const ports = careerPorts([...FAMILY_OBJECT_IDS, RELATIONSHIP_OBJECT_IDS[0]]);
  const ids = await createAllCareerFamilies(ports);
  const descriptor = RELATIONSHIP_DESCRIPTORS_V1[0]!;
  const first = await createRelationshipObjectV1(relationshipRequest(
    descriptor.relationshipKind,
    ids.get(descriptor.source.objectType)!,
    ids.get(descriptor.target.objectType)!,
  ), ports);
  const second = await appendRelationshipRevisionV1({
    relationshipObjectId: first.objectId,
    expectedRevision: 1,
    actorId: ACTOR_ID,
    lifecycleState: "archived",
    effectiveUntil: LATER_TIMESTAMP,
    metadata: { labels: [], extensions: {} },
    provenance: {
      version: "1",
      originCategory: "system-produced",
      observedAt: TIMESTAMP,
      correlationId: "phase5b.synthetic.relationship-close",
    },
  }, ports);
  assert.equal(second.revision, 2);
  assert.equal(second.data.relationshipKind, first.data.relationshipKind);
  assert.deepEqual(second.data.source, first.data.source);
  assert.deepEqual(second.data.target, first.data.target);
  assert.equal(second.provenanceSummary.correlationId, "phase5b.synthetic.relationship-close");
  assert.deepEqual(await ports.repository.loadRevision(first.objectId, 1), first);
});

test("only RelationshipObject carries edge truth and duplicate relationship identity fails closed", async () => {
  const ports = careerPorts([...FAMILY_OBJECT_IDS, RELATIONSHIP_OBJECT_IDS[0], RELATIONSHIP_OBJECT_IDS[0]]);
  const ids = await createAllCareerFamilies(ports);
  for (const id of ids.values()) {
    const object = await ports.repository.loadCurrent(id);
    assert.deepEqual(object?.data, {});
    assert.equal(Object.keys(object?.data ?? {}).some((key) => /relationship/i.test(key)), false);
  }
  const descriptor = RELATIONSHIP_DESCRIPTORS_V1[0]!;
  const request = relationshipRequest(
    descriptor.relationshipKind,
    ids.get(descriptor.source.objectType)!,
    ids.get(descriptor.target.objectType)!,
  );
  await createRelationshipObjectV1(request, ports);
  await assert.rejects(() => createRelationshipObjectV1(request, ports),
    (error: unknown) => error instanceof ObjectErrorV1 && error.code === "revision-conflict");
});
