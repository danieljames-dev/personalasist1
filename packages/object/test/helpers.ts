import { asActorIdV1, asOwnerIdV1, type ActorIdV1, type OwnerIdV1 } from "@aion/identity";
import {
  Acj1CanonicalSerializerV1,
  asObjectSchemaIdV1,
  asObjectTypeV1,
  createObjectV1,
  objectEnvelopeContentV1,
  sealObjectEnvelopeV1,
  Sha256ObjectDigestV1,
  type CanonicalValueV1,
  type ObjectConstructionPortsV1,
  type ObjectEnvelopeV1,
  type ObjectSchemaRegistryV1,
  type ObjectTypeRegistrationV1,
} from "../src/index.js";

export const OWNER_ID: OwnerIdV1 = asOwnerIdV1("10000000-0000-4000-8000-000000000001");
export const ACTOR_ID: ActorIdV1 = asActorIdV1("20000000-0000-4000-8000-000000000002");
export const OTHER_ACTOR_ID: ActorIdV1 = asActorIdV1("20000000-0000-4000-8000-000000000003");
export const OBJECT_ID = "30000000-0000-4000-8000-000000000004";
export const OTHER_OBJECT_ID = "30000000-0000-4000-8000-000000000005";
export const TIMESTAMP = "2026-08-06T12:00:00.000Z";
export const LATER_TIMESTAMP = "2026-08-06T12:00:01.000Z";

export const REGISTRATION: ObjectTypeRegistrationV1 = {
  objectType: asObjectTypeV1("aion.reference.synthetic"),
  objectProfile: "entity",
  schemaId: asObjectSchemaIdV1("aion.schema.synthetic"),
  schemaVersion: 1,
};

export class SyntheticSchemaRegistry implements ObjectSchemaRegistryV1 {
  isRegistered(value: ObjectTypeRegistrationV1): boolean {
    return value.objectType === REGISTRATION.objectType
      && value.objectProfile === REGISTRATION.objectProfile
      && value.schemaId === REGISTRATION.schemaId
      && value.schemaVersion === REGISTRATION.schemaVersion;
  }

  isExtensionNamespaceRegistered(namespace: string): boolean {
    return namespace === "aion.extension.synthetic";
  }

  validateData(_registration: ObjectTypeRegistrationV1, data: CanonicalValueV1): boolean {
    return typeof data === "object"
      && data !== null
      && !Array.isArray(data)
      && (data as { readonly [key: string]: CanonicalValueV1 }).kind === "synthetic-reference";
  }
}

export interface DeterministicPorts extends ObjectConstructionPortsV1 {
  clockCalls: number;
  generatorCalls: number;
}

export function deterministicPorts(objectId = OBJECT_ID, timestamp = TIMESTAMP): DeterministicPorts {
  return {
    clockCalls: 0,
    generatorCalls: 0,
    clock: {
      now(this: DeterministicPorts["clock"]): string {
        return timestamp;
      },
    },
    idGenerator: {
      generate(): string {
        return objectId;
      },
    },
    canonicalizer: new Acj1CanonicalSerializerV1(),
    digest: new Sha256ObjectDigestV1(),
    schemaRegistry: new SyntheticSchemaRegistry(),
  };
}

export function trackingPorts(objectId = OBJECT_ID, timestamp = TIMESTAMP): DeterministicPorts {
  const ports: DeterministicPorts = {
    clockCalls: 0,
    generatorCalls: 0,
    clock: { now: () => { ports.clockCalls += 1; return timestamp; } },
    idGenerator: { generate: () => { ports.generatorCalls += 1; return objectId; } },
    canonicalizer: new Acj1CanonicalSerializerV1(),
    digest: new Sha256ObjectDigestV1(),
    schemaRegistry: new SyntheticSchemaRegistry(),
  };
  return ports;
}

export function createSyntheticObject(ports = deterministicPorts()): ObjectEnvelopeV1 {
  return createObjectV1({
    registration: REGISTRATION,
    ownerId: OWNER_ID,
    actorId: ACTOR_ID,
    lifecycleState: "active",
    metadata: { labels: ["reference", "synthetic"], extensions: {} },
    provenance: {
      version: "1",
      originCategory: "system-produced",
      observedAt: TIMESTAMP,
      correlationId: "phase5.synthetic.create",
    },
    data: { kind: "synthetic-reference", value: 1 },
  }, ports);
}

export function createRevision(
  current: ObjectEnvelopeV1,
  ports = deterministicPorts(),
  overrides: Partial<ReturnType<typeof objectEnvelopeContentV1>> = {},
): ObjectEnvelopeV1 {
  const content = objectEnvelopeContentV1(current);
  return sealObjectEnvelopeV1({
    ...content,
    revision: current.revision + 1,
    modifiedBy: OTHER_ACTOR_ID,
    modifiedAt: LATER_TIMESTAMP,
    provenanceSummary: {
      ...content.provenanceSummary,
      responsibleActorId: OTHER_ACTOR_ID,
      observedAt: LATER_TIMESTAMP,
      recordedAt: LATER_TIMESTAMP,
      correlationId: "phase5.synthetic.revision",
    },
    data: { kind: "synthetic-reference", value: current.revision + 1 },
    ...overrides,
  }, ports);
}
