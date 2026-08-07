import { validateCareerFactPayloadV1, type CareerFactPayloadV1 } from "@aion/career-evidence";
import { validateJobMatchReportPayloadV1, type JobMatchReportPayloadV1 } from "@aion/job-matching";
import {
  APPLICATION_DRAFT_OBJECT_V1,
  CAREER_FACT_OBJECT_V1,
  createObjectV1,
  createRelationshipObjectV1,
  JOB_MATCH_REPORT_OBJECT_V1,
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
  APPLICATION_DRAFT_PAYLOAD_VERSION_V1,
  OWNER_REVIEW_LABEL_V1,
  validateApplicationDraftPayloadV1,
  validateApplicationPreparationRequestV1,
  type ApplicationDraftPayloadV1,
  type ApplicationPreparationRequestV1,
  type ApplicationPreparationResultV1,
  type DraftFactCitationV1,
  type EvidenceBackedClaimV1,
} from "./contracts.js";
import { privateDraftReferenceV1, type ApplicationPreparationIdDeriverV1 } from "./ids.js";

export interface ApplicationPreparationOperationPortsV1 {
  readonly repository: ObjectRepository;
  readonly clock: ObjectClock;
  readonly canonicalizer: ObjectCanonicalSerializerV1;
  readonly digest: ObjectDigestV1;
  readonly schemaRegistry: ObjectSchemaRegistryV1;
  readonly idDeriver: ApplicationPreparationIdDeriverV1;
}
type FactRevision = { readonly revision: number; readonly payload: CareerFactPayloadV1 };

function citation(fact: FactRevision): DraftFactCitationV1 & import("@aion/object").CanonicalValueV1 {
  return { factId: fact.payload.factId, factRevision: fact.revision, factType: fact.payload.factType,
    sourceObjectId: fact.payload.sourceObjectId, sourceLocation: fact.payload.sourceLocation } as DraftFactCitationV1 & import("@aion/object").CanonicalValueV1;
}
function uniqueSorted(values: readonly string[]): string[] { return [...new Set(values)].sort(); }
function citedFactKeys(report: JobMatchReportPayloadV1): string[] {
  return uniqueSorted(report.matchedRequirements.flatMap((item) => item.evidence)
    .filter((item) => item.conflict === "none" && item.assertion !== "missing")
    .map((item) => `${item.factId}:${item.factRevision}`));
}

export function prepareApplicationDraftV1(request: ApplicationPreparationRequestV1, report: JobMatchReportPayloadV1, facts: readonly FactRevision[]): ApplicationDraftPayloadV1 {
  validateApplicationPreparationRequestV1(request); validateJobMatchReportPayloadV1(report);
  const expected = new Set(citedFactKeys(report));
  const usable = facts.filter((item) => expected.has(`${item.payload.factId}:${item.revision}`)
    && item.payload.normalizedValue.state === "supplied" && item.payload.status.assertion !== "missing"
    && item.payload.status.conflict === "none" && item.payload.supersession.state === "current")
    .sort((a, b) => a.payload.factId.localeCompare(b.payload.factId));
  if (usable.length !== expected.size) throw new Error("Every positive Match citation must resolve to a clean pinned CareerFact revision.");
  const evidenceAppendix = usable.map(citation);
  const claims: EvidenceBackedClaimV1[] = usable.map((item) => ({
    text: `${item.payload.factType}: ${item.payload.normalizedValue.state === "supplied" ? item.payload.normalizedValue.value : ""}`,
    citations: [citation(item)],
  }));
  const resumeRecommendations = claims.map((item) => ({ text: `Consider highlighting the supported evidence “${item.text}”.`, citations: item.citations }));
  const coverLetterClaims = claims.map((item) => ({ text: `Supported qualification: ${item.text}.`, citations: item.citations }));
  const coverLetterDraft = [OWNER_REVIEW_LABEL_V1, "", "I am interested in this role.",
    ...coverLetterClaims.map((item) => item.text), "", "Please review, edit, and approve every statement before use."].join("\n");
  const missingInformationChecklist = uniqueSorted([
    ...report.unmatchedRequirements.map((item) => `Unmatched requirement — ${item.category}: ${item.requirement}`),
    ...report.unknownRequirements.map((item) => `Needs owner review — ${item.category}: ${item.requirement}`),
    ...report.unsupportedRequirements.map((item) => `Unsupported by current contract — ${item}`),
    ...report.conflicts.map((item) => `Unresolved conflict — ${item}`),
  ]);
  const applicationQuestionPreparation = uniqueSorted([
    "Confirm availability and start-date answers with the owner.",
    "Confirm compensation expectations with the owner.",
    "Confirm work authorization and any required attestations with the owner.",
    ...report.matchedRequirements.map((item) => `Prepare an owner-reviewed example for ${item.category}: ${item.requirement}`),
  ]);
  const jobMatchMarkdown = [
    `# ${OWNER_REVIEW_LABEL_V1}`,
    "",
    `Overall deterministic match score: ${report.overallScoreBps}/10000 basis points.`,
    `Applied weight: ${report.appliedWeightBps}/10000 basis points.`,
    "",
    "## Matched requirements",
    ...(report.matchedRequirements.length ? report.matchedRequirements.map((item) => `- ${item.category}: ${item.requirement}`) : ["- None"]),
    "", "## Review items",
    ...(missingInformationChecklist.length ? missingInformationChecklist.map((item) => `- ${item}`) : ["- None"]),
  ].join("\n");
  return validateApplicationDraftPayloadV1({
    contractVersion: APPLICATION_DRAFT_PAYLOAD_VERSION_V1,
    preparationOperationId: request.preparationOperationId,
    reviewStatus: OWNER_REVIEW_LABEL_V1,
    jobMatch: { objectId: request.jobMatchObjectId, revision: request.jobMatchRevision, payloadVersion: report.contractVersion },
    jobMatchJson: structuredClone(report), jobMatchMarkdown, resumeRecommendations, coverLetterDraft,
    coverLetterClaims, applicationQuestionPreparation, missingInformationChecklist, evidenceAppendix,
    limitations: [
      "Draft content is not an application submission, signature, attestation, or owner approval.",
      "Only exact supplied CareerFact values cited by the Job Match Report are used as positive claims.",
      "Owner review is required before any external use.",
    ].sort(),
  });
}

function family(object: ObjectEnvelopeV1, expected: typeof JOB_MATCH_REPORT_OBJECT_V1 | typeof CAREER_FACT_OBJECT_V1): boolean {
  return object.objectType === expected.objectType && object.objectProfile === expected.objectProfile
    && object.schemaId === expected.schemaId && object.schemaVersion === expected.schemaVersion;
}
function construction(ports: ApplicationPreparationOperationPortsV1, objectId: ReturnType<ApplicationPreparationIdDeriverV1["derive"]>, timestamp: string) {
  return { clock: { now: () => timestamp }, idGenerator: { generate: () => objectId }, canonicalizer: ports.canonicalizer, digest: ports.digest, schemaRegistry: ports.schemaRegistry };
}
function exactData(left: unknown, right: unknown, canonicalizer: ObjectCanonicalSerializerV1): boolean {
  const a = canonicalizer.canonicalize(left); const b = canonicalizer.canonicalize(right);
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}
function rejected(code: NonNullable<ApplicationPreparationResultV1["error"]>["code"], stage: NonNullable<ApplicationPreparationResultV1["error"]>["stage"], message: string): ApplicationPreparationResultV1 {
  return { version: "1", outcome: "rejected", draftReference: null, relationshipReferences: [], usedFactCount: 0,
    createdObjectCount: 0, createdRelationshipCount: 0, error: { version: "1", code, stage, message } };
}

export async function createApplicationDraftV1(value: ApplicationPreparationRequestV1, ports: ApplicationPreparationOperationPortsV1): Promise<ApplicationPreparationResultV1> {
  let request: ApplicationPreparationRequestV1;
  try { request = validateApplicationPreparationRequestV1(value); } catch { return rejected("request-invalid", "request", "A valid closed preparation request is required."); }
  try {
    const matchObject = await ports.repository.loadCurrent(request.jobMatchObjectId);
    if (matchObject === null) return rejected("not-found", "load", "The private Job Match Report was not found.");
    if (!family(matchObject, JOB_MATCH_REPORT_OBJECT_V1)) return rejected("object-invalid", "load", "The referenced Object is not a Job Match Report.");
    if (matchObject.ownership.ownerId !== request.ownerId) return rejected("owner-mismatch", "load", "Private Object ownership does not match the request.");
    if (matchObject.revision !== request.jobMatchRevision) return rejected("revision-conflict", "load", "The Job Match Report revision is stale.");
    const report = validateJobMatchReportPayloadV1(matchObject.data);
    const keys = citedFactKeys(report); const facts: FactRevision[] = [];
    for (const key of keys) {
      const split = key.lastIndexOf(":"); const factId = key.slice(0, split); const revision = Number(key.slice(split + 1));
      const object = await ports.repository.loadRevision(factId as Parameters<ObjectRepository["loadRevision"]>[0], revision);
      if (object === null) return rejected("not-found", "load", "Pinned CareerFact evidence was not found.");
      if (!family(object, CAREER_FACT_OBJECT_V1) || object.ownership.ownerId !== request.ownerId) return rejected("object-invalid", "load", "Pinned CareerFact evidence is invalid.");
      facts.push({ revision: object.revision, payload: validateCareerFactPayloadV1(object.data) });
    }
    const data = prepareApplicationDraftV1(request, report, facts);
    const draftId = ports.idDeriver.derive(request.preparationOperationId, "application-draft", request.ownerId);
    const timestamp = ports.clock.now(); let draft = await ports.repository.loadCurrent(draftId); let createdObjectCount: 0 | 1 = 0;
    if (draft === null) {
      const snapshot = createObjectV1({ registration: APPLICATION_DRAFT_OBJECT_V1, ownerId: request.ownerId, actorId: request.actorId,
        lifecycleState: "active", metadata: { labels: [], extensions: {} },
        provenance: { version: "1", originCategory: "derived", observedAt: timestamp, correlationId: request.preparationOperationId,
          sourceObjectId: request.jobMatchObjectId, derivationMethodId: "aion.application-preparation.deterministic.v1" }, data,
      }, construction(ports, draftId, timestamp));
      try { await ports.repository.commit({ expectedRevision: null, snapshot }); draft = snapshot; createdObjectCount = 1; }
      catch (error) { if (!(error instanceof ObjectErrorV1) || error.code !== "revision-conflict") throw error; draft = await ports.repository.loadCurrent(draftId); }
    }
    if (draft === null || draft.objectType !== APPLICATION_DRAFT_OBJECT_V1.objectType || draft.ownership.ownerId !== request.ownerId || !exactData(draft.data, data, ports.canonicalizer)) return rejected("revision-conflict", "persistence", "Deterministic draft identity conflicts with existing content.");
    const relations = [
      { purpose: "match", kind: "aion.relationship.career.draft-derived-from-match.v1" as const, target: request.jobMatchObjectId },
      ...facts.map((item) => ({ purpose: "fact", kind: "aion.relationship.career.draft-supported-by-fact.v1" as const, target: item.payload.factId })),
    ];
    const refs = []; let createdRelationshipCount = 0;
    for (const relation of relations) {
      const id = ports.idDeriver.derive(request.preparationOperationId, `relationship-${relation.purpose}`, relation.target);
      let stored = await ports.repository.loadCurrent(id);
      if (stored === null) {
        try { stored = await createRelationshipObjectV1({ relationshipKind: relation.kind, sourceObjectId: draftId, targetObjectId: relation.target,
          ownerId: request.ownerId, actorId: request.actorId, effectiveFrom: timestamp, metadata: { labels: [], extensions: {} },
          provenance: { version: "1", originCategory: "derived", observedAt: timestamp, correlationId: request.preparationOperationId,
            sourceObjectId: draftId, derivationMethodId: "aion.application-preparation.relationship.v1" },
        }, { ...construction(ports, id, timestamp), repository: ports.repository }); createdRelationshipCount++; }
        catch (error) { if (!(error instanceof ObjectErrorV1) || error.code !== "revision-conflict") throw error; stored = await ports.repository.loadCurrent(id); }
      }
      if (stored === null || stored.objectType !== RELATIONSHIP_OBJECT_V1.objectType) return rejected("persistence-failed", "persistence", "Draft relationship persistence failed.");
      const relationData = stored.data as unknown as RelationshipObjectDataV1;
      if (relationData.relationshipKind !== relation.kind || relationData.source.objectId !== draftId || relationData.target.objectId !== relation.target) return rejected("revision-conflict", "persistence", "Deterministic relationship identity conflicts.");
      refs.push(privateDraftReferenceV1(id));
    }
    return { version: "1", outcome: createdObjectCount === 0 && createdRelationshipCount === 0 ? "already-completed" : "success",
      draftReference: privateDraftReferenceV1(draftId), relationshipReferences: refs, usedFactCount: facts.length,
      createdObjectCount, createdRelationshipCount, error: null };
  } catch (error) {
    if (error instanceof ObjectErrorV1 && error.code === "revision-conflict") return rejected("revision-conflict", "persistence", "The private Object revision changed.");
    return rejected("object-invalid", "preparation", "Application preparation failed closed on invalid private evidence.");
  }
}
