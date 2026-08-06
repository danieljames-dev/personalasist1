import {
  Acj1CanonicalSerializerV1,
  APPLICATION_DRAFT_OBJECT_V1,
  CAREER_FACT_OBJECT_V1,
  CAREER_PROFILE_OBJECT_V1,
  CAREER_SOURCE_OBJECT_V1,
  CareerObjectSchemaRegistryV1,
  createInitialObjectV1,
  InMemoryObjectRepositoryV1,
  JOB_MATCH_REPORT_OBJECT_V1,
  JOB_POSTING_OBJECT_V1,
  Sha256ObjectDigestV1,
  type CareerEntityRegistrationV1,
  type ObjectIdV1,
  type ObjectOperationPortsV1,
  type ObjectRepository,
} from "../src/index.js";
import { ACTOR_ID, OWNER_ID, TIMESTAMP } from "./helpers.js";

export const FAMILY_OBJECT_IDS = [
  "41000000-0000-4000-8000-000000000001",
  "41000000-0000-4000-8000-000000000002",
  "41000000-0000-4000-8000-000000000003",
  "41000000-0000-4000-8000-000000000004",
  "41000000-0000-4000-8000-000000000005",
  "41000000-0000-4000-8000-000000000006",
] as const;

export const RELATIONSHIP_OBJECT_IDS = [
  "42000000-0000-4000-8000-000000000001",
  "42000000-0000-4000-8000-000000000002",
  "42000000-0000-4000-8000-000000000003",
  "42000000-0000-4000-8000-000000000004",
  "42000000-0000-4000-8000-000000000005",
  "42000000-0000-4000-8000-000000000006",
  "42000000-0000-4000-8000-000000000007",
] as const;

export const FAMILY_REGISTRATIONS = [
  CAREER_SOURCE_OBJECT_V1,
  CAREER_FACT_OBJECT_V1,
  CAREER_PROFILE_OBJECT_V1,
  JOB_POSTING_OBJECT_V1,
  JOB_MATCH_REPORT_OBJECT_V1,
  APPLICATION_DRAFT_OBJECT_V1,
] as const;

export function careerPorts(
  ids: readonly string[],
  repository?: ObjectRepository,
  timestamps: readonly string[] = [TIMESTAMP],
): ObjectOperationPortsV1 {
  const idQueue = [...ids];
  const timeQueue = [...timestamps];
  const validationPorts = {
    canonicalizer: new Acj1CanonicalSerializerV1(),
    digest: new Sha256ObjectDigestV1(),
    schemaRegistry: new CareerObjectSchemaRegistryV1(),
  };
  return {
    ...validationPorts,
    repository: repository ?? new InMemoryObjectRepositoryV1(validationPorts),
    idGenerator: {
      generate: () => {
        const next = idQueue.shift();
        if (next === undefined) throw new Error("Synthetic Object ID queue exhausted.");
        return next;
      },
    },
    clock: {
      now: () => timeQueue.length > 1 ? timeQueue.shift()! : timeQueue[0]!,
    },
  };
}

export async function createCareerFamily(
  family: CareerEntityRegistrationV1,
  ports: ObjectOperationPortsV1,
) {
  return createInitialObjectV1({
    family,
    ownerId: OWNER_ID,
    actorId: ACTOR_ID,
    lifecycleState: "active",
    metadata: { labels: [], extensions: {} },
    provenance: {
      version: "1",
      originCategory: "system-produced",
      observedAt: TIMESTAMP,
      correlationId: "phase5b.synthetic.family",
    },
  }, ports);
}

export async function createAllCareerFamilies(ports: ObjectOperationPortsV1): Promise<Map<string, ObjectIdV1>> {
  const ids = new Map<string, ObjectIdV1>();
  for (const family of FAMILY_REGISTRATIONS) {
    const object = await createCareerFamily(family, ports);
    ids.set(family.objectType, object.objectId);
  }
  return ids;
}
