import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createObjectV1,
  ObjectErrorV1,
  objectEnvelopeContentV1,
  sealObjectEnvelopeV1,
  validateObjectEnvelopeV1,
} from "../src/index.js";
import {
  ACTOR_ID,
  createSyntheticObject,
  deterministicPorts,
  OWNER_ID,
  REGISTRATION,
  TIMESTAMP,
  trackingPorts,
} from "./helpers.js";

test("construction uses injected ports once and creates the exact minimum envelope", () => {
  const ports = trackingPorts();
  const input = {
    registration: REGISTRATION,
    ownerId: OWNER_ID,
    actorId: ACTOR_ID,
    lifecycleState: "active" as const,
    metadata: { labels: ["reference", "synthetic"], extensions: {} },
    provenance: {
      version: "1" as const,
      originCategory: "system-produced" as const,
      observedAt: TIMESTAMP,
      correlationId: "phase5.synthetic.create",
    },
    data: { kind: "synthetic-reference", value: 1 },
  };
  const before = structuredClone(input);
  const object = createObjectV1(input, ports);
  assert.equal(ports.clockCalls, 1);
  assert.equal(ports.generatorCalls, 1);
  assert.deepEqual(input, before);
  assert.equal(object.ownership.ownerId, OWNER_ID);
  assert.equal(object.createdBy, ACTOR_ID);
  assert.equal(object.modifiedBy, ACTOR_ID);
  assert.equal(object.revision, 1);
  assert.equal(Object.isFrozen(object), true);
  assert.deepEqual(Object.keys(object).sort(), [
    "createdAt", "createdBy", "data", "integrity", "lifecycleState", "metadata", "modifiedAt",
    "modifiedBy", "objectContractVersion", "objectId", "objectProfile", "objectType", "ownership",
    "provenanceSummary", "revision", "schemaId", "schemaVersion",
  ]);
  assert.equal("credential" in object, false);
  assert.equal("authorization" in object, false);
  assert.equal("relationships" in object, false);
});

test("sealing and validation are deterministic and do not mutate content", () => {
  const ports = deterministicPorts();
  const first = createSyntheticObject(ports);
  const content = objectEnvelopeContentV1(first);
  const before = structuredClone(content);
  const second = sealObjectEnvelopeV1(content, ports);
  assert.deepEqual(content, before);
  assert.deepEqual(second, first);
  assert.deepEqual(validateObjectEnvelopeV1(second, ports), first);
  const extended = sealObjectEnvelopeV1({
    ...content,
    metadata: { ...content.metadata, extensions: { "aion.extension.synthetic": { enabled: true } } },
  }, ports);
  assert.deepEqual(extended.metadata.extensions, { "aion.extension.synthetic": { enabled: true } });
  assert.throws(() => sealObjectEnvelopeV1({
    ...content,
    metadata: { ...content.metadata, extensions: { "aion.extension.unknown": { enabled: true } } },
  }, ports), ObjectErrorV1);
});

test("changed committed content changes framed integrity", () => {
  const ports = deterministicPorts();
  const first = createSyntheticObject(ports);
  const content = objectEnvelopeContentV1(first);
  const second = sealObjectEnvelopeV1({ ...content, data: { kind: "synthetic-reference", value: 2 } }, ports);
  assert.notEqual(first.integrity.digest, second.integrity.digest);
  assert.equal(first.objectId, second.objectId);
});

test("injected registry, serializer, and digest failures fail closed", () => {
  const base = deterministicPorts();
  const failures = [
    { ...base, schemaRegistry: { isRegistered: () => { throw new Error("failed"); }, isExtensionNamespaceRegistered: () => true, validateData: () => true } },
    { ...base, canonicalizer: { canonicalize: () => { throw new Error("failed"); } } },
    { ...base, digest: { digest: () => "invalid" } },
  ];
  for (const ports of failures) {
    assert.throws(() => createSyntheticObject(ports), ObjectErrorV1);
  }
});

test("canonical limit failure emits no digest", () => {
  const base = deterministicPorts();
  let digestCalls = 0;
  const ports = {
    ...base,
    digest: {
      digest: (): string => {
        digestCalls += 1;
        return "0".repeat(64);
      },
    },
  };
  assert.throws(() => createObjectV1({
    registration: REGISTRATION,
    ownerId: OWNER_ID,
    actorId: ACTOR_ID,
    lifecycleState: "active",
    metadata: { labels: [], extensions: {} },
    provenance: {
      version: "1",
      originCategory: "system-produced",
      observedAt: TIMESTAMP,
      correlationId: "phase5.synthetic.limit",
    },
    data: {
      kind: "synthetic-reference",
      parts: ["a".repeat(1024 * 1024), "b".repeat(1024 * 1024), "c".repeat(1024 * 1024), "d".repeat(1024 * 1024)],
    },
  }, ports));
  assert.equal(digestCalls, 0);
});
