import { CAREER_FACT_PAYLOAD_VERSION_V1, CAREER_PROFILE_PAYLOAD_VERSION_V1, type CareerFactPayloadV1 } from "@aion/career-evidence";
import { asActorIdV1, asOwnerIdV1 } from "@aion/identity";
import { JOB_POSTING_PAYLOAD_VERSION_V1, type JobPostingFieldsV1 } from "@aion/job-posting";
import {
  Acj1CanonicalSerializerV1,
  asObjectIdV1,
  CAREER_FACT_OBJECT_V1,
  CAREER_PROFILE_OBJECT_V1,
  createObjectV1,
  InMemoryObjectRepositoryV1,
  JOB_POSTING_OBJECT_V1,
  Sha256ObjectDigestV1,
  type CanonicalValueV1,
  type ObjectIdV1,
  type ObjectRepository,
  type ObjectTypeRegistrationV1,
} from "@aion/object";
import {
  defaultMatchingConfigurationV1,
  JobMatchingSchemaRegistryV1,
  Sha256JobMatchingIdDeriverV1,
  type JobMatchingOperationPortsV1,
  type MatchingConfigurationV1,
} from "../src/index.js";

export const OWNER_ID = asOwnerIdV1("51000000-0000-4000-8000-000000000005");
export const ACTOR_ID = asActorIdV1("52000000-0000-4000-8000-000000000005");
export const PROFILE_ID = asObjectIdV1("53000000-0000-4000-8000-000000000005");
export const JOB_ID = asObjectIdV1("54000000-0000-4000-8000-000000000005");
const SOURCE_ID = asObjectIdV1("55000000-0000-4000-8000-000000000005");
const TIMESTAMP = "2026-08-07T03:00:00.000Z";

export function matchingPorts(repository?: ObjectRepository): JobMatchingOperationPortsV1 {
  const validation = { canonicalizer: new Acj1CanonicalSerializerV1(), digest: new Sha256ObjectDigestV1(), schemaRegistry: new JobMatchingSchemaRegistryV1() };
  let millisecond = 0;
  return {
    ...validation,
    repository: repository ?? new InMemoryObjectRepositoryV1(validation),
    idDeriver: new Sha256JobMatchingIdDeriverV1(),
    clock: { now: () => new Date(Date.UTC(2026, 7, 7, 3, 0, 0, millisecond++)).toISOString() },
  };
}

function factId(index: number): ObjectIdV1 {
  return asObjectIdV1(`56000000-0000-4000-8000-${index.toString().padStart(12, "0")}`);
}

export interface FactDefinition {
  readonly type: CareerFactPayloadV1["factType"];
  readonly value?: string;
  readonly conflict?: boolean;
  readonly assertion?: CareerFactPayloadV1["status"]["assertion"];
}

export function fields(overrides: Partial<JobPostingFieldsV1> = {}): JobPostingFieldsV1 {
  return {
    title: { state: "supplied", value: "Synthetic Platform Steward" },
    company: { state: "supplied", value: "Neutral Example Cooperative" },
    location: { state: "supplied", value: "Example City" },
    workArrangement: { state: "supplied", value: "remote" },
    employmentType: { state: "supplied", value: "full-time" },
    compensation: { state: "supplied", currency: "USD", minimumMinorUnits: 8000000, maximumMinorUnits: 10000000 },
    description: { state: "supplied", value: "A neutral synthetic position." },
    requiredSkills: { state: "specified", values: ["Deterministic Testing", "TypeScript"] },
    preferredSkills: { state: "specified", values: ["Local Systems"] },
    requiredExperience: { state: "supplied", value: "platform systems testing" },
    educationRequirements: { state: "specified", values: ["Synthetic Technical Certificate"] },
    certificationRequirements: { state: "unknown", values: [] },
    travel: { state: "unknown" }, schedule: { state: "unknown" },
    applicationDeadline: { state: "unknown" }, sourceReference: { state: "explicit-empty" },
    ...overrides,
  };
}

export function configuration(overrides: Partial<MatchingConfigurationV1> = {}): MatchingConfigurationV1 {
  return {
    ...defaultMatchingConfigurationV1(),
    desiredRoleTitles: ["Synthetic Platform Steward"],
    acceptedLocations: ["Example City"],
    acceptedWorkArrangements: ["remote"],
    acceptedEmploymentTypes: ["full-time"],
    industriesOfInterest: ["Neutral Technology"],
    minimumCompensation: { currency: "USD", minimumMinorUnits: 8500000 },
    ...overrides,
  };
}

function create(registration: ObjectTypeRegistrationV1, objectId: ObjectIdV1, data: unknown, ports: JobMatchingOperationPortsV1) {
  return createObjectV1({
    registration, ownerId: OWNER_ID, actorId: ACTOR_ID, lifecycleState: "active",
    metadata: { labels: [], extensions: {} },
    provenance: { version: "1", originCategory: "derived", observedAt: TIMESTAMP, correlationId: "phase9.synthetic.setup", derivationMethodId: "aion.synthetic.setup.v1" },
    data: data as CanonicalValueV1,
  }, { ...ports, idGenerator: { generate: () => objectId }, clock: { now: () => TIMESTAMP } });
}

export async function setupMatchInputs(ports: JobMatchingOperationPortsV1, definitions: readonly FactDefinition[] = [
  { type: "role-title", value: "Synthetic Platform Steward" },
  { type: "skill", value: "Deterministic Testing" },
  { type: "skill", value: "TypeScript" },
  { type: "tool-or-technology", value: "Local Systems" },
  { type: "responsibility", value: "Platform systems testing" },
  { type: "education", value: "Synthetic Technical Certificate" },
]) {
  const states = [];
  for (const [index, definition] of definitions.entries()) {
    const id = factId(index + 1);
    const assertion = definition.assertion ?? "owner-confirmed";
    const missing = definition.value === undefined;
    const payload: CareerFactPayloadV1 = {
      contractVersion: CAREER_FACT_PAYLOAD_VERSION_V1,
      factId: id, factType: definition.type,
      normalizedValue: missing ? { state: "unknown" } : { state: "supplied", value: definition.value! },
      sourceObjectId: SOURCE_ID, sourceLocation: `/entries/${index}/value`,
      confidence: missing ? "not-assessed" : assertion === "owner-confirmed" ? "owner-asserted" : "deterministic-extraction",
      ownerConfirmed: assertion === "owner-confirmed",
      status: { version: "1", verification: "unverified", assertion: missing ? "missing" : assertion, conflict: definition.conflict ? "conflicting" : "none" },
      extractionMethod: { version: "1", method: missing ? "deterministic-missing-state" : assertion === "owner-confirmed" ? "structured-owner-input" : "deterministic-structured-extraction", parser: { version: "1", parserId: "aion.parser.synthetic", parserVersion: "1", sourceLocationFormat: "json-pointer-v1" }, ruleId: null },
      createdAt: TIMESTAMP,
      conflict: definition.conflict ? { version: "1", state: "conflicting", groupId: `aion.conflict.synthetic-${index}`, conflictingFactIds: [factId(index + 20)], fieldLocations: [`/entries/${index}/value`] } : { version: "1", state: "none" },
      supersession: { version: "1", state: "current" },
    };
    await ports.repository.commit({ expectedRevision: null, snapshot: create(CAREER_FACT_OBJECT_V1, id, payload, ports) });
    states.push({ version: "1" as const, factId: id, factRevision: 1, factType: definition.type, confidence: payload.confidence, status: payload.status, supersessionState: "current" as const });
  }
  states.sort((a, b) => a.factId.localeCompare(b.factId));
  const profilePayload = {
    contractVersion: CAREER_PROFILE_PAYLOAD_VERSION_V1,
    buildOperationId: "phase9.synthetic.profile", buildConfigurationVersion: "1" as const,
    processingOutcome: { version: "1" as const, state: "success" as const, acceptedFactCount: states.length, relationshipCount: states.length, reasonCodes: [] },
    factStates: states, missingFactTypes: [],
  };
  const jobPayload = {
    contractVersion: JOB_POSTING_PAYLOAD_VERSION_V1,
    sourceProvenance: { version: "1" as const, importOperationId: "phase9.synthetic.job", sourceType: "structured-json" as const, originalFilename: "synthetic-job.json", approvedRelativePath: "synthetic-job.json", contentDigest: { algorithm: "sha-256" as const, digest: "a".repeat(64) }, parser: { version: "1" as const, parserName: "aion.job-posting.structured-json" as const, parserVersion: "1" as const }, importedAt: TIMESTAMP, ownerId: OWNER_ID, importingActorId: ACTOR_ID },
    fields: fields(), listingCurrentness: { version: "1" as const, state: "unknown" as const },
  };
  await ports.repository.commit({ expectedRevision: null, snapshot: create(CAREER_PROFILE_OBJECT_V1, PROFILE_ID, profilePayload, ports) });
  await ports.repository.commit({ expectedRevision: null, snapshot: create(JOB_POSTING_OBJECT_V1, JOB_ID, jobPayload, ports) });
  return { profilePayload, jobPayload, facts: states.map((state) => state.factId) };
}

export function matchRequest(config: MatchingConfigurationV1 = configuration()) {
  return { version: "1" as const, matchOperationId: "phase9.synthetic.match", ownerId: OWNER_ID, actorId: ACTOR_ID, careerProfileObjectId: PROFILE_ID, careerProfileRevision: 1, jobPostingObjectId: JOB_ID, jobPostingRevision: 1, configuration: config };
}
