import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActorIdV1, OwnerIdV1 } from "@aion/identity";
import {
  asObjectIdV1,
  asObjectSchemaIdV1,
  asObjectTypeV1,
  ObjectErrorV1,
  validateObjectEnvelopeV1,
  type ObjectIdV1,
} from "../src/index.js";
import { ACTOR_ID, createSyntheticObject, deterministicPorts, OWNER_ID } from "./helpers.js";

function code(operation: () => unknown): string | undefined {
  try {
    operation();
    return undefined;
  } catch (error) {
    return error instanceof ObjectErrorV1 ? error.code : "unexpected";
  }
}

test("Object, Owner, and Actor identifiers remain distinct compile-time contracts", () => {
  const objectId: ObjectIdV1 = asObjectIdV1("30000000-0000-4000-8000-000000000004");
  const ownerId: OwnerIdV1 = OWNER_ID;
  const actorId: ActorIdV1 = ACTOR_ID;
  assert.notEqual(objectId, ownerId);
  assert.notEqual(objectId, actorId);
  // @ts-expect-error Owner identifiers cannot be assigned to Object identifiers.
  const invalidObject: ObjectIdV1 = ownerId;
  // @ts-expect-error Actor identifiers cannot be assigned to Owner identifiers.
  const invalidOwner: OwnerIdV1 = actorId;
  assert.equal(invalidObject, ownerId);
  assert.equal(invalidOwner, actorId);
});

test("Object identifiers and namespaced references fail closed", () => {
  for (const value of ["", " 30000000-0000-4000-8000-000000000004", "30000000-0000-7000-8000-000000000004", "OWNER-1"]) {
    assert.equal(code(() => asObjectIdV1(value)), "invalid-identifier");
  }
  assert.equal(asObjectTypeV1("aion.reference.synthetic"), "aion.reference.synthetic");
  assert.equal(asObjectSchemaIdV1("aion.schema.synthetic"), "aion.schema.synthetic");
  assert.equal(code(() => asObjectTypeV1("not-namespaced")), "invalid-identifier");
});

test("closed envelope rejects missing and additional fields", () => {
  const ports = deterministicPorts();
  const object = createSyntheticObject(ports);
  const withExtra = { ...object, credential: "forbidden" };
  const { data: _data, ...missing } = object;
  assert.equal(code(() => validateObjectEnvelopeV1(withExtra, ports)), "invalid-object");
  assert.equal(code(() => validateObjectEnvelopeV1(missing, ports)), "invalid-object");
});

test("unsupported versions, schemas, lifecycle values, and references reject", () => {
  const ports = deterministicPorts();
  const object = createSyntheticObject(ports);
  assert.equal(code(() => validateObjectEnvelopeV1({ ...object, objectContractVersion: "2" }, ports)), "unsupported-contract");
  assert.equal(code(() => validateObjectEnvelopeV1({ ...object, schemaVersion: 2 }, ports)), "unknown-object-type");
  assert.equal(code(() => validateObjectEnvelopeV1({ ...object, lifecycleState: "enabled" }, ports)), "invalid-object");
  assert.equal(code(() => validateObjectEnvelopeV1({ ...object, ownership: { ownerId: "owner" } }, ports)), "invalid-reference");
});

test("timestamp, provenance, revision, and integrity invariants reject", () => {
  const ports = deterministicPorts();
  const object = createSyntheticObject(ports);
  assert.equal(code(() => validateObjectEnvelopeV1({ ...object, revision: 0 }, ports)), "invalid-object");
  assert.equal(code(() => validateObjectEnvelopeV1({ ...object, modifiedAt: "2026-08-06T11:59:59.000Z" }, ports)), "invalid-timestamp");
  assert.equal(code(() => validateObjectEnvelopeV1({
    ...object,
    provenanceSummary: { ...object.provenanceSummary, recordedAt: "2026-08-06T12:00:00.100Z" },
  }, ports)), "invalid-timestamp");
  assert.equal(code(() => validateObjectEnvelopeV1({
    ...object,
    integrity: { ...object.integrity, digest: "0".repeat(64) },
  }, ports)), "integrity-mismatch");
});
