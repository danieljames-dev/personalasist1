import {
  validateCareerFactPayloadV1,
  validateCareerProfilePayloadV1,
  type CareerFactPayloadV1,
} from "@aion/career-evidence";
import { validateJobPostingPayloadV1, type JobPostingListValueV1, type JobPostingPayloadV1 } from "@aion/job-posting";
import {
  CAREER_FACT_OBJECT_V1,
  CAREER_PROFILE_OBJECT_V1,
  createObjectV1,
  createRelationshipObjectV1,
  JOB_MATCH_REPORT_OBJECT_V1,
  JOB_POSTING_OBJECT_V1,
  ObjectErrorV1,
  RELATIONSHIP_OBJECT_V1,
  type ObjectCanonicalSerializerV1,
  type ObjectClock,
  type ObjectDigestV1,
  type ObjectEnvelopeV1,
  type ObjectRepository,
  type ObjectSchemaRegistryV1,
  type RelationshipObjectDataV1,
} from "@aion/object";
import {
  DEFAULT_MATCHING_WEIGHTS_V1,
  JOB_MATCH_REPORT_PAYLOAD_VERSION_V1,
  MATCH_COMPONENT_IDS_V1,
  SCORE_SCALE_BPS_V1,
  validateJobMatchRequestV1,
  validateJobMatchReportPayloadV1,
  type JobMatchEvaluationInputV1,
  type JobMatchReportPayloadV1,
  type JobMatchRequestV1,
  type JobMatchResultV1,
  type MatchComponentIdV1,
  type MatchComponentScoreV1,
  type MatchEvidenceLinkV1,
  type MatchingConfigurationV1,
  type RequirementAssessmentV1,
} from "./contracts.js";
import { privateMatchReferenceV1, type JobMatchingIdDeriverV1 } from "./ids.js";

export interface JobMatchingOperationPortsV1 {
  readonly repository: ObjectRepository;
  readonly clock: ObjectClock;
  readonly canonicalizer: ObjectCanonicalSerializerV1;
  readonly digest: ObjectDigestV1;
  readonly schemaRegistry: ObjectSchemaRegistryV1;
  readonly idDeriver: JobMatchingIdDeriverV1;
}

type Fact = { readonly revision: number; readonly payload: CareerFactPayloadV1 };
const LIMITATIONS = Object.freeze([
  "Deterministic lexical comparison cannot establish semantic equivalence.",
  "Industry alignment remains unknown because JobPostingObject v1 has no structured industry field.",
  "The score does not predict hiring probability or employability.",
  "Unknown and missing evidence are never treated as satisfied.",
  "Protected or sensitive personal attributes are not evaluated.",
].sort());

function normalize(value: string): string { return value.toLocaleLowerCase("en-US").trim().replace(/\s+/g, " "); }
function tokens(value: string): string[] {
  return [...new Set(normalize(value).split(/[^\p{L}\p{N}+#.-]+/u).filter((item) => item.length > 1))].sort();
}
function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.floor((numerator * SCORE_SCALE_BPS_V1) / denominator);
}
function evidence(fact: Fact): MatchEvidenceLinkV1 {
  return {
    factId: fact.payload.factId, factRevision: fact.revision, factType: fact.payload.factType,
    assertion: fact.payload.status.assertion, verification: fact.payload.status.verification,
    conflict: fact.payload.status.conflict, sourceObjectId: fact.payload.sourceObjectId,
    sourceLocation: fact.payload.sourceLocation,
  };
}
function suppliedFacts(facts: readonly Fact[], types: readonly string[]): Fact[] {
  return facts.filter((fact) => types.includes(fact.payload.factType)
    && fact.payload.normalizedValue.state === "supplied" && fact.payload.supersession.state === "current");
}
function assessment(category: string, requirement: string, outcome: RequirementAssessmentV1["outcome"], facts: readonly Fact[], reason: string): RequirementAssessmentV1 {
  return { category, requirement, outcome, evidence: facts.map(evidence).sort((a, b) => a.factId.localeCompare(b.factId)), reason };
}
function assessList(category: string, input: JobPostingListValueV1, facts: readonly Fact[], factTypes: readonly string[]): RequirementAssessmentV1[] {
  if (input.state !== "specified") return [];
  const candidates = suppliedFacts(facts, factTypes);
  return [...input.values].sort().map((requirement) => {
    const matching = candidates.filter((fact) => fact.payload.normalizedValue.state === "supplied"
      && normalize(fact.payload.normalizedValue.value) === normalize(requirement));
    const clean = matching.filter((fact) => fact.payload.status.conflict === "none");
    const conflicted = matching.filter((fact) => fact.payload.status.conflict === "conflicting");
    if (clean.length > 0) return assessment(category, requirement, "matched", clean, "Exact evidence-backed match.");
    if (conflicted.length > 0) return assessment(category, requirement, "conflict", conflicted, "Only unresolved conflicting evidence supports this requirement.");
    if (candidates.length === 0) return assessment(category, requirement, "unknown", [], "No current evidence of the required fact type is available.");
    return assessment(category, requirement, "unmatched", [], "Current evidence contains no exact supported match.");
  });
}
function component(component: MatchComponentIdV1, weightBps: number, applied: boolean, scoreBps: number | null, status: MatchComponentScoreV1["status"], facts: readonly Fact[], reasons: readonly string[]): MatchComponentScoreV1 {
  return { component, weightBps, applied, scoreBps, status, evidence: facts.map(evidence).sort((a, b) => a.factId.localeCompare(b.factId)), reasons: [...new Set(reasons)].sort() };
}
function statusFor(items: readonly RequirementAssessmentV1[]): MatchComponentScoreV1["status"] {
  if (items.some((item) => item.outcome === "conflict")) return "conflict";
  const matched = items.filter((item) => item.outcome === "matched").length;
  if (matched === items.length && items.length > 0) return "matched";
  if (matched > 0) return "partial";
  if (items.some((item) => item.outcome === "unknown")) return "unknown";
  return "unmatched";
}
function fieldUnknown(payload: JobPostingPayloadV1, key: keyof JobPostingPayloadV1["fields"]): boolean {
  const value = payload.fields[key] as { readonly state: string };
  return value.state === "unknown" || value.state === "not-supplied";
}

export function evaluateJobMatchV1(input: JobMatchEvaluationInputV1): JobMatchReportPayloadV1 {
  const request = validateJobMatchRequestV1(input.request);
  const configuration = request.configuration;
  const job = validateJobPostingPayloadV1(input.jobPosting);
  const profile = validateCareerProfilePayloadV1(input.careerProfile);
  const facts = input.facts.map((item) => ({ revision: item.revision, payload: validateCareerFactPayloadV1(item.payload) }));
  const stateById = new Map(profile.factStates.map((state) => [state.factId, state]));
  if (facts.length !== profile.factStates.length || facts.some((fact) => stateById.get(fact.payload.factId)?.factRevision !== fact.revision)) {
    throw new Error("CareerProfile fact revisions do not match the supplied evidence.");
  }

  const requiredSkills = assessList("required-skill", job.fields.requiredSkills, facts, ["skill", "tool-or-technology"]);
  const preferredSkills = assessList("preferred-skill", job.fields.preferredSkills, facts, ["skill", "tool-or-technology"]);
  const education = assessList("education", job.fields.educationRequirements, facts, ["education"]);
  const certifications = assessList("certification", job.fields.certificationRequirements, facts, ["certification", "license"]);
  const mandatory = [...education, ...certifications];
  const components: MatchComponentScoreV1[] = [];
  const listComponent = (id: MatchComponentIdV1, weight: number, items: RequirementAssessmentV1[]) => {
    const applied = items.length > 0;
    const matched = items.filter((item) => item.outcome === "matched");
    components.push(component(id, weight, applied, applied ? ratio(matched.length, items.length) : null,
      applied ? statusFor(items) : "not-applicable", [], applied ? items.map((item) => item.reason) : ["Job Posting supplied no requirements for this component."]));
  };
  listComponent("required-skills", configuration.weights.requiredSkills, requiredSkills);
  listComponent("preferred-skills", configuration.weights.preferredSkills, preferredSkills);

  const experienceFacts = suppliedFacts(facts, ["role-title", "responsibility", "accomplishment", "project"]);
  if (job.fields.requiredExperience.state === "supplied") {
    const requiredTokens = tokens(job.fields.requiredExperience.value);
    const matching = experienceFacts.filter((fact) => fact.payload.normalizedValue.state === "supplied"
      && tokens(fact.payload.normalizedValue.value).some((token) => requiredTokens.includes(token))
      && fact.payload.status.conflict === "none");
    const careerTokens = new Set(matching.flatMap((fact) => fact.payload.normalizedValue.state === "supplied" ? tokens(fact.payload.normalizedValue.value) : []));
    const scoreBps = ratio(requiredTokens.filter((token) => careerTokens.has(token)).length, requiredTokens.length);
    components.push(component("relevant-experience", configuration.weights.relevantExperience, true, scoreBps,
      experienceFacts.length === 0 ? "unknown" : scoreBps === 10000 ? "matched" : scoreBps > 0 ? "partial" : "unmatched",
      matching, [experienceFacts.length === 0 ? "No current experience evidence is available." : "Score is deterministic token coverage over current experience evidence."]));
  } else components.push(component("relevant-experience", configuration.weights.relevantExperience, false, null, "not-applicable", [], ["Job Posting supplied no structured experience requirement."]));

  const titleFacts = suppliedFacts(facts, ["role-title"]);
  const title = job.fields.title.state === "supplied" ? job.fields.title.value : null;
  const excludedTitle = title !== null && configuration.excludedRoleTitles.some((item) => normalize(item) === normalize(title));
  if (title !== null) {
    const clean = titleFacts.filter((fact) => fact.payload.normalizedValue.state === "supplied" && fact.payload.status.conflict === "none");
    const exact = clean.filter((fact) => fact.payload.normalizedValue.state === "supplied" && normalize(fact.payload.normalizedValue.value) === normalize(title));
    const titleTokens = tokens(title);
    const scoreBps = exact.length > 0 ? 10000 : Math.max(0, ...clean.map((fact) => {
      const value = fact.payload.normalizedValue;
      return value.state === "supplied"
        ? ratio(titleTokens.filter((token) => tokens(value.value).includes(token)).length, titleTokens.length)
        : 0;
    }));
    components.push(component("role-title-alignment", configuration.weights.roleTitleAlignment, true, excludedTitle ? 0 : scoreBps,
      excludedTitle ? "conflict" : clean.length === 0 ? "unknown" : scoreBps === 10000 ? "matched" : scoreBps > 0 ? "partial" : "unmatched",
      exact.length > 0 ? exact : clean.filter((fact) => fact.payload.normalizedValue.state === "supplied" && tokens(fact.payload.normalizedValue.value).some((token) => titleTokens.includes(token))),
      [excludedTitle ? "The role title is explicitly excluded by owner configuration." : "Role titles use exact or deterministic token coverage."]));
  } else components.push(component("role-title-alignment", configuration.weights.roleTitleAlignment, false, null, "not-applicable", [], ["Job Posting title is unknown or not supplied."]));

  components.push(component("industry-alignment", configuration.weights.industryAlignment, false, null, "unknown", [], ["JobPostingObject v1 has no structured industry field; no industry is inferred from prose."]));

  const exactPreferenceComponent = (id: MatchComponentIdV1, weight: number, value: string | null, accepted: readonly string[], label: string) => {
    if (value === null) { components.push(component(id, weight, false, null, "not-applicable", [], [`Job Posting ${label} is unknown or not supplied.`])); return; }
    if (accepted.length === 0) { components.push(component(id, weight, true, 0, "unknown", [], [`Owner ${label} preference is unknown.`])); return; }
    const matched = accepted.some((item) => normalize(item) === normalize(value));
    components.push(component(id, weight, true, matched ? 10000 : 0, matched ? "matched" : "conflict", [], [matched ? `Job Posting ${label} matches explicit owner preference.` : `Job Posting ${label} conflicts with explicit owner preference.`]));
  };
  exactPreferenceComponent("location-compatibility", configuration.weights.locationCompatibility,
    job.fields.location.state === "supplied" ? job.fields.location.value : null, configuration.acceptedLocations, "location");
  exactPreferenceComponent("work-arrangement", configuration.weights.workArrangement,
    job.fields.workArrangement.state === "supplied" ? job.fields.workArrangement.value : null, configuration.acceptedWorkArrangements, "work arrangement");
  exactPreferenceComponent("employment-type", configuration.weights.employmentType,
    job.fields.employmentType.state === "supplied" ? job.fields.employmentType.value : null, configuration.acceptedEmploymentTypes, "employment type");

  const compensation = job.fields.compensation;
  if (compensation.state === "supplied" && configuration.minimumCompensation !== null) {
    const sameCurrency = compensation.currency === configuration.minimumCompensation.currency;
    const jobCeiling = compensation.maximumMinorUnits ?? compensation.minimumMinorUnits;
    const compatible = sameCurrency && jobCeiling !== null && jobCeiling >= configuration.minimumCompensation.minimumMinorUnits;
    components.push(component("compensation-compatibility", configuration.weights.compensationCompatibility, true, compatible ? 10000 : 0,
      compatible ? "matched" : "conflict", [], [sameCurrency ? (compatible ? "Explicit compensation ranges are compatible." : "Explicit Job Posting maximum is below the owner minimum.") : "Explicit compensation currencies differ."]));
  } else components.push(component("compensation-compatibility", configuration.weights.compensationCompatibility, false, null, "not-applicable", [], ["Compensation is evaluated only when both Job Posting and owner configuration contain evidence."]));
  listComponent("mandatory-qualifications", configuration.weights.mandatoryQualifications, mandatory);

  const matchedRequirements = [...requiredSkills, ...preferredSkills, ...mandatory].filter((item) => item.outcome === "matched");
  const unmatchedRequirements = [...requiredSkills, ...preferredSkills, ...mandatory].filter((item) => item.outcome === "unmatched");
  const unknownRequirements = [...requiredSkills, ...preferredSkills, ...mandatory].filter((item) => item.outcome === "unknown" || item.outcome === "conflict");
  if (job.fields.requiredExperience.state === "supplied") {
    const experienceComponent = components.find((item) => item.component === "relevant-experience")!;
    const outcome = experienceComponent.status === "matched" ? "matched" : experienceComponent.status === "unknown" ? "unknown" : "unmatched";
    const item = assessment("required-experience", job.fields.requiredExperience.value, outcome, experienceFacts.filter((fact) => experienceComponent.evidence.some((link) => link.factId === fact.payload.factId)), experienceComponent.reasons[0]!);
    (outcome === "matched" ? matchedRequirements : outcome === "unmatched" ? unmatchedRequirements : unknownRequirements).push(item);
  }
  const conflicts = [
    ...facts.filter((fact) => fact.payload.status.conflict === "conflicting").map((fact) => `Unresolved CareerFact conflict: ${fact.payload.factId}`),
    ...components.filter((item) => item.status === "conflict").map((item) => `Component conflict: ${item.component}`),
  ].sort();
  const unsupportedRequirements = [
    ...(job.fields.travel.state === "supplied" ? ["travel"] : []),
    ...(job.fields.schedule.state === "supplied" ? ["schedule"] : []),
    ...(configuration.industriesOfInterest.length > 0 || configuration.industriesToAvoid.length > 0 ? ["industry-job-evidence-unavailable"] : []),
    ...(["educationRequirements", "certificationRequirements"] as const).filter((key) => fieldUnknown(job, key)).map((key) => `${key}-unknown`),
  ].sort();
  const applied = components.filter((item) => item.applied && item.scoreBps !== null);
  const appliedWeightBps = applied.reduce((sum, item) => sum + item.weightBps, 0);
  const weighted = applied.reduce((sum, item) => sum + item.weightBps * item.scoreBps!, 0);
  const disqualifying = excludedTitle || components.some((item) => ["location-compatibility", "work-arrangement", "employment-type"].includes(item.component) && item.status === "conflict");
  const overallScoreBps = disqualifying || appliedWeightBps === 0 ? 0 : Math.floor(weighted / appliedWeightBps);
  return validateJobMatchReportPayloadV1({
    contractVersion: JOB_MATCH_REPORT_PAYLOAD_VERSION_V1,
    matchOperationId: request.matchOperationId,
    matchingConfiguration: structuredClone(configuration),
    scoreScale: { unit: "basis-points", maximum: 10000, rounding: "floor" },
    overallScoreBps, appliedWeightBps, componentScores: components,
    matchedRequirements: matchedRequirements.sort(requirementSort),
    unmatchedRequirements: unmatchedRequirements.sort(requirementSort),
    unknownRequirements: unknownRequirements.sort(requirementSort),
    conflicts, unsupportedRequirements,
    careerProfile: { objectId: request.careerProfileObjectId, revision: request.careerProfileRevision, payloadVersion: profile.contractVersion },
    jobPosting: { objectId: request.jobPostingObjectId, revision: request.jobPostingRevision, payloadVersion: job.contractVersion },
    limitations: LIMITATIONS,
  });
}

function requirementSort(a: RequirementAssessmentV1, b: RequirementAssessmentV1): number {
  return a.category.localeCompare(b.category) || a.requirement.localeCompare(b.requirement);
}
function matchesFamily(object: ObjectEnvelopeV1, family: typeof CAREER_PROFILE_OBJECT_V1): boolean;
function matchesFamily(object: ObjectEnvelopeV1, family: typeof JOB_POSTING_OBJECT_V1): boolean;
function matchesFamily(object: ObjectEnvelopeV1, family: typeof CAREER_FACT_OBJECT_V1): boolean;
function matchesFamily(object: ObjectEnvelopeV1, family: typeof CAREER_PROFILE_OBJECT_V1 | typeof JOB_POSTING_OBJECT_V1 | typeof CAREER_FACT_OBJECT_V1): boolean {
  return object.objectType === family.objectType && object.objectProfile === family.objectProfile
    && object.schemaId === family.schemaId && object.schemaVersion === family.schemaVersion;
}
function construction(ports: JobMatchingOperationPortsV1, objectId: ReturnType<JobMatchingIdDeriverV1["derive"]>, timestamp: string) {
  return { clock: { now: () => timestamp }, idGenerator: { generate: () => objectId }, canonicalizer: ports.canonicalizer, digest: ports.digest, schemaRegistry: ports.schemaRegistry };
}
function exact(left: unknown, right: unknown, canonicalizer: ObjectCanonicalSerializerV1): boolean {
  const a = canonicalizer.canonicalize(left); const b = canonicalizer.canonicalize(right);
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}
function rejected(code: NonNullable<JobMatchResultV1["error"]>["code"], stage: NonNullable<JobMatchResultV1["error"]>["stage"], message: string): JobMatchResultV1 {
  return { version: "1", outcome: "rejected", matchReference: null, relationshipReferences: [], overallScoreBps: null, createdObjectCount: 0, createdRelationshipCount: 0, error: { version: "1", code, stage, message } };
}

export async function createJobMatchReportV1(requestValue: JobMatchRequestV1, ports: JobMatchingOperationPortsV1): Promise<JobMatchResultV1> {
  let request: JobMatchRequestV1;
  try { request = validateJobMatchRequestV1(requestValue); } catch { return rejected("request-invalid", "request", "A valid closed match request is required."); }
  try {
    const [profileObject, jobObject] = await Promise.all([
      ports.repository.loadCurrent(request.careerProfileObjectId), ports.repository.loadCurrent(request.jobPostingObjectId),
    ]);
    if (profileObject === null || jobObject === null) return rejected("not-found", "load", "A required private Object was not found.");
    if (!matchesFamily(profileObject, CAREER_PROFILE_OBJECT_V1) || !matchesFamily(jobObject, JOB_POSTING_OBJECT_V1)) return rejected("object-invalid", "load", "A required Object has an unexpected family.");
    if (profileObject.ownership.ownerId !== request.ownerId || jobObject.ownership.ownerId !== request.ownerId) return rejected("owner-mismatch", "load", "Private Object ownership does not match the request.");
    if (profileObject.revision !== request.careerProfileRevision || jobObject.revision !== request.jobPostingRevision) return rejected("revision-conflict", "load", "A required Object revision is stale.");
    const profile = validateCareerProfilePayloadV1(profileObject.data);
    const job = validateJobPostingPayloadV1(jobObject.data);
    const facts: Fact[] = [];
    for (const state of profile.factStates) {
      const object = await ports.repository.loadRevision(state.factId, state.factRevision);
      if (object === null) return rejected("not-found", "load", "A CareerProfile evidence revision was not found.");
      if (!matchesFamily(object, CAREER_FACT_OBJECT_V1) || object.ownership.ownerId !== request.ownerId) return rejected("object-invalid", "load", "CareerProfile evidence is invalid.");
      facts.push({ revision: object.revision, payload: validateCareerFactPayloadV1(object.data) });
    }
    const data = evaluateJobMatchV1({ request, careerProfile: profile, jobPosting: job, facts });
    const matchId = ports.idDeriver.derive(request.matchOperationId, "job-match-report", request.ownerId);
    const timestamp = ports.clock.now();
    let match = await ports.repository.loadCurrent(matchId);
    let createdObjectCount: 0 | 1 = 0;
    if (match === null) {
      const snapshot = createObjectV1({
        registration: JOB_MATCH_REPORT_OBJECT_V1, ownerId: request.ownerId, actorId: request.actorId,
        lifecycleState: "active", metadata: { labels: [], extensions: {} },
        provenance: { version: "1", originCategory: "derived", observedAt: timestamp, correlationId: request.matchOperationId, sourceObjectId: request.careerProfileObjectId, derivationMethodId: "aion.job-matching.deterministic.v1" },
        data,
      }, construction(ports, matchId, timestamp));
      try { await ports.repository.commit({ expectedRevision: null, snapshot }); match = snapshot; createdObjectCount = 1; }
      catch (error) { if (!(error instanceof ObjectErrorV1) || error.code !== "revision-conflict") throw error; match = await ports.repository.loadCurrent(matchId); }
    }
    if (match === null || match.objectType !== JOB_MATCH_REPORT_OBJECT_V1.objectType || match.ownership.ownerId !== request.ownerId || !exact(match.data, data, ports.canonicalizer)) {
      return rejected("revision-conflict", "persistence", "Deterministic match identity conflicts with existing content.");
    }
    const relations = [
      { purpose: "evaluates", kind: "aion.relationship.career.match-evaluates-posting.v1" as const, target: request.jobPostingObjectId },
      { purpose: "uses", kind: "aion.relationship.career.match-uses-profile.v1" as const, target: request.careerProfileObjectId },
    ];
    const refs = []; let createdRelationshipCount = 0;
    for (const relation of relations) {
      const id = ports.idDeriver.derive(request.matchOperationId, `relationship-${relation.purpose}`, relation.target);
      let stored = await ports.repository.loadCurrent(id);
      if (stored === null) {
        try {
          stored = await createRelationshipObjectV1({
            relationshipKind: relation.kind, sourceObjectId: matchId, targetObjectId: relation.target,
            ownerId: request.ownerId, actorId: request.actorId, effectiveFrom: timestamp,
            metadata: { labels: [], extensions: {} }, provenance: { version: "1", originCategory: "derived", observedAt: timestamp, correlationId: request.matchOperationId, sourceObjectId: matchId, derivationMethodId: "aion.job-matching.relationship.v1" },
          }, { ...construction(ports, id, timestamp), repository: ports.repository });
          createdRelationshipCount++;
        } catch (error) { if (!(error instanceof ObjectErrorV1) || error.code !== "revision-conflict") throw error; stored = await ports.repository.loadCurrent(id); }
      }
      if (stored === null || stored.objectType !== RELATIONSHIP_OBJECT_V1.objectType) return rejected("persistence-failed", "persistence", "Match relationship persistence failed.");
      const relationData = stored.data as unknown as RelationshipObjectDataV1;
      if (relationData.relationshipKind !== relation.kind || relationData.source.objectId !== matchId || relationData.target.objectId !== relation.target) return rejected("revision-conflict", "persistence", "Deterministic relationship identity conflicts.");
      refs.push(privateMatchReferenceV1(id));
    }
    return { version: "1", outcome: createdObjectCount === 0 && createdRelationshipCount === 0 ? "already-completed" : "success", matchReference: privateMatchReferenceV1(matchId), relationshipReferences: refs, overallScoreBps: data.overallScoreBps, createdObjectCount, createdRelationshipCount, error: null };
  } catch (error) {
    if (error instanceof ObjectErrorV1 && error.code === "revision-conflict") return rejected("revision-conflict", "persistence", "The private Object revision changed.");
    return rejected("object-invalid", "evaluation", "Job matching failed closed on invalid private evidence.");
  }
}
