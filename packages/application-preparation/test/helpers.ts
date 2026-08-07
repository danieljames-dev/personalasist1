import { CAREER_FACT_PAYLOAD_VERSION_V1, CAREER_PROFILE_PAYLOAD_VERSION_V1, type CareerFactPayloadV1 } from "@aion/career-evidence";
import { asActorIdV1, asOwnerIdV1 } from "@aion/identity";
import { createJobMatchReportV1, defaultMatchingConfigurationV1, Sha256JobMatchingIdDeriverV1 } from "@aion/job-matching";
import { JOB_POSTING_PAYLOAD_VERSION_V1 } from "@aion/job-posting";
import { Acj1CanonicalSerializerV1, asObjectIdV1, CAREER_FACT_OBJECT_V1, CAREER_PROFILE_OBJECT_V1,
  createObjectV1, InMemoryObjectRepositoryV1, JOB_POSTING_OBJECT_V1, Sha256ObjectDigestV1,
  type CanonicalValueV1, type ObjectIdV1, type ObjectTypeRegistrationV1 } from "@aion/object";
import { ApplicationPreparationSchemaRegistryV1, Sha256ApplicationPreparationIdDeriverV1,
  type ApplicationPreparationOperationPortsV1 } from "../src/index.js";

export const OWNER = asOwnerIdV1("61000000-0000-4000-8000-000000000006");
export const ACTOR = asActorIdV1("62000000-0000-4000-8000-000000000006");
export const PROFILE = asObjectIdV1("63000000-0000-4000-8000-000000000006");
export const POSTING = asObjectIdV1("64000000-0000-4000-8000-000000000006");
const SOURCE = asObjectIdV1("65000000-0000-4000-8000-000000000006");
const TIME = "2026-08-07T04:00:00.000Z";

export function ports(): ApplicationPreparationOperationPortsV1 {
  const validation = { canonicalizer: new Acj1CanonicalSerializerV1(), digest: new Sha256ObjectDigestV1(), schemaRegistry: new ApplicationPreparationSchemaRegistryV1() };
  let tick = 0;
  return { ...validation, repository: new InMemoryObjectRepositoryV1(validation), idDeriver: new Sha256ApplicationPreparationIdDeriverV1(),
    clock: { now: () => new Date(Date.UTC(2026, 7, 7, 4, 0, 0, tick++)).toISOString() } };
}
function object(registration: ObjectTypeRegistrationV1, id: ObjectIdV1, data: unknown, p: ApplicationPreparationOperationPortsV1) {
  return createObjectV1({ registration, ownerId: OWNER, actorId: ACTOR, lifecycleState: "active", metadata: { labels: [], extensions: {} },
    provenance: { version: "1", originCategory: "derived", observedAt: TIME, correlationId: "phase10.synthetic.setup", derivationMethodId: "aion.synthetic.setup.v1" }, data: data as CanonicalValueV1 },
  { ...p, idGenerator: { generate: () => id }, clock: { now: () => TIME } });
}
function factPayload(id: ObjectIdV1, index: number, type: CareerFactPayloadV1["factType"], value: string, conflict = false): CareerFactPayloadV1 {
  return { contractVersion: CAREER_FACT_PAYLOAD_VERSION_V1, factId: id, factType: type, normalizedValue: { state: "supplied", value },
    sourceObjectId: SOURCE, sourceLocation: `/facts/${index}/value`, confidence: "owner-asserted", ownerConfirmed: true,
    status: { version: "1", verification: "unverified", assertion: "owner-confirmed", conflict: conflict ? "conflicting" : "none" },
    extractionMethod: { version: "1", method: "structured-owner-input", parser: { version: "1", parserId: "aion.parser.synthetic", parserVersion: "1", sourceLocationFormat: "json-pointer-v1" }, ruleId: null },
    createdAt: TIME, conflict: conflict ? { version: "1", state: "conflicting", groupId: "aion.conflict.synthetic", conflictingFactIds: [asObjectIdV1("69000000-0000-4000-8000-000000000006")], fieldLocations: [`/facts/${index}/value`] } : { version: "1", state: "none" },
    supersession: { version: "1", state: "current" } };
}
export async function setup(p: ApplicationPreparationOperationPortsV1, options: { conflict?: boolean; unknownRequirement?: boolean } = {}) {
  const definitions = [["skill", "Deterministic Testing"], ["skill", "TypeScript"], ["role-title", "Synthetic Platform Steward"]] as const;
  const states = [];
  for (const [index, [type, value]] of definitions.entries()) {
    const id = asObjectIdV1(`66000000-0000-4000-8000-${(index + 1).toString().padStart(12, "0")}`);
    const payload = factPayload(id, index, type, value, options.conflict && index === 0);
    await p.repository.commit({ expectedRevision: null, snapshot: object(CAREER_FACT_OBJECT_V1, id, payload, p) });
    states.push({ version: "1" as const, factId: id, factRevision: 1, factType: type, confidence: payload.confidence, status: payload.status, supersessionState: "current" as const });
  }
  states.sort((a, b) => a.factId.localeCompare(b.factId));
  const profile = { contractVersion: CAREER_PROFILE_PAYLOAD_VERSION_V1, buildOperationId: "phase10.synthetic.profile", buildConfigurationVersion: "1" as const,
    processingOutcome: { version: "1" as const, state: "success" as const, acceptedFactCount: states.length, relationshipCount: states.length, reasonCodes: [] }, factStates: states, missingFactTypes: [] };
  const job = { contractVersion: JOB_POSTING_PAYLOAD_VERSION_V1,
    sourceProvenance: { version: "1" as const, importOperationId: "phase10.synthetic.job", sourceType: "structured-json" as const, originalFilename: "synthetic-job.json", approvedRelativePath: "synthetic-job.json", contentDigest: { algorithm: "sha-256" as const, digest: "b".repeat(64) }, parser: { version: "1" as const, parserName: "aion.job-posting.structured-json" as const, parserVersion: "1" as const }, importedAt: TIME, ownerId: OWNER, importingActorId: ACTOR },
    fields: { title: { state: "supplied" as const, value: "Synthetic Platform Steward" }, company: { state: "supplied" as const, value: "Neutral Example Cooperative" }, location: { state: "unknown" as const }, workArrangement: { state: "unknown" as const }, employmentType: { state: "unknown" as const }, compensation: { state: "unknown" as const }, description: { state: "supplied" as const, value: "Synthetic local role." }, requiredSkills: { state: "specified" as const, values: options.unknownRequirement ? ["Deterministic Testing", "Unrecorded Skill"] : ["Deterministic Testing", "TypeScript"] }, preferredSkills: { state: "unknown" as const, values: [] }, requiredExperience: { state: "unknown" as const }, educationRequirements: { state: "unknown" as const, values: [] }, certificationRequirements: { state: "unknown" as const, values: [] }, travel: { state: "unknown" as const }, schedule: { state: "unknown" as const }, applicationDeadline: { state: "unknown" as const }, sourceReference: { state: "explicit-empty" as const } },
    listingCurrentness: { version: "1" as const, state: "unknown" as const } };
  await p.repository.commit({ expectedRevision: null, snapshot: object(CAREER_PROFILE_OBJECT_V1, PROFILE, profile, p) });
  await p.repository.commit({ expectedRevision: null, snapshot: object(JOB_POSTING_OBJECT_V1, POSTING, job, p) });
  const matchOperationId = options.conflict ? "phase10.synthetic.match-conflict" : options.unknownRequirement ? "phase10.synthetic.match-unknown" : "phase10.synthetic.match";
  const matchPorts = { ...p, idDeriver: new Sha256JobMatchingIdDeriverV1() };
  const result = await createJobMatchReportV1({ version: "1", matchOperationId, ownerId: OWNER, actorId: ACTOR, careerProfileObjectId: PROFILE, careerProfileRevision: 1, jobPostingObjectId: POSTING, jobPostingRevision: 1, configuration: defaultMatchingConfigurationV1() }, matchPorts);
  if (!result.matchReference) throw new Error("synthetic match setup failed");
  const matchId = new Sha256JobMatchingIdDeriverV1().derive(matchOperationId, "job-match-report", OWNER);
  return { matchId, facts: states };
}
export function request(matchId: ObjectIdV1, revision = 1) { return { version: "1" as const, preparationOperationId: "phase10.synthetic.prepare", ownerId: OWNER, actorId: ACTOR, jobMatchObjectId: matchId, jobMatchRevision: revision }; }
