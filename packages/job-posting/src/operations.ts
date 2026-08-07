import {
  JOB_POSTING_OBJECT_V1,
  ObjectErrorV1,
  createObjectV1,
  objectEnvelopeContentV1,
  sealObjectEnvelopeV1,
  type CanonicalValueV1,
  type ObjectCanonicalSerializerV1,
  type ObjectClock,
  type ObjectDigestV1,
  type ObjectEnvelopeV1,
  type ObjectIdV1,
  type ObjectMetadataV1,
  type ObjectRepository,
  type ObjectSchemaRegistryV1,
} from "@aion/object";
import {
  JOB_POSTING_PAYLOAD_VERSION_V1,
  JobPostingOperationErrorV1,
  validateJobPostingPayloadV1,
  type JobPostingDryRunResultV1,
  type JobPostingErrorV1,
  type JobPostingFieldsV1,
  type JobPostingImportResultV1,
  type JobPostingPayloadV1,
  type JobPostingSourceProvenanceV1,
} from "./contracts.js";
import { privateJobPostingReferenceV1, type JobPostingIdDeriverV1 } from "./ids.js";
import { prepareJobPostingSourceV1, type PreparedJobPostingSourceV1 } from "./source.js";

export interface JobPostingOperationPortsV1 {
  readonly repository: ObjectRepository;
  readonly clock: ObjectClock;
  readonly canonicalizer: ObjectCanonicalSerializerV1;
  readonly digest: ObjectDigestV1;
  readonly schemaRegistry: ObjectSchemaRegistryV1;
  readonly idDeriver: JobPostingIdDeriverV1;
}

const EMPTY_METADATA: ObjectMetadataV1 = Object.freeze({ labels: [], extensions: {} });

function safeError(error: unknown, stage: JobPostingErrorV1["stage"]): JobPostingOperationErrorV1 {
  if (error instanceof JobPostingOperationErrorV1) return error;
  if (error instanceof ObjectErrorV1) {
    if (error.code === "not-found") return new JobPostingOperationErrorV1("not-found", stage, "The Job Posting Object was not found.");
    if (error.code === "owner-mismatch") return new JobPostingOperationErrorV1("owner-mismatch", stage, "Job Posting ownership does not match the request.");
    if (error.code === "revision-conflict") return new JobPostingOperationErrorV1("revision-conflict", stage, "The expected Job Posting revision changed.");
    if (error.code === "commit-failed") return new JobPostingOperationErrorV1("persistence-failed", "persistence", "Job Posting persistence failed.");
    return new JobPostingOperationErrorV1("object-invalid", stage, "A Job Posting Object failed validation.");
  }
  return new JobPostingOperationErrorV1("persistence-failed", "persistence", "Job Posting persistence failed.");
}

function objectId(prepared: PreparedJobPostingSourceV1, ports: Pick<JobPostingOperationPortsV1, "idDeriver">): ObjectIdV1 {
  return prepared.request.target.mode === "revision"
    ? prepared.request.target.jobPostingObjectId
    : ports.idDeriver.derive(prepared.request.importOperationId, "job-posting", prepared.request.ownerId);
}

function payload(prepared: PreparedJobPostingSourceV1, importedAt: string): JobPostingPayloadV1 {
  return validateJobPostingPayloadV1({
    contractVersion: JOB_POSTING_PAYLOAD_VERSION_V1,
    sourceProvenance: {
      version: "1",
      importOperationId: prepared.request.importOperationId,
      sourceType: prepared.request.sourceType,
      originalFilename: prepared.originalFilename,
      approvedRelativePath: prepared.approvedRelativePath,
      contentDigest: prepared.contentDigest,
      parser: prepared.parser,
      importedAt,
      ownerId: prepared.request.ownerId,
      importingActorId: prepared.request.actorId,
    },
    fields: prepared.fields,
    listingCurrentness: prepared.request.listingCurrentness,
  });
}

function canonicalEqual(left: unknown, right: unknown, canonicalizer: ObjectCanonicalSerializerV1): boolean {
  const leftBytes = canonicalizer.canonicalize(left);
  const rightBytes = canonicalizer.canonicalize(right);
  return leftBytes.length === rightBytes.length && leftBytes.every((value, index) => value === rightBytes[index]);
}

function equivalentRequest(current: JobPostingPayloadV1, proposed: JobPostingPayloadV1, canonicalizer: ObjectCanonicalSerializerV1): boolean {
  const currentSource = current.sourceProvenance as JobPostingSourceProvenanceV1;
  return canonicalEqual(
    { ...current, sourceProvenance: { ...currentSource, importedAt: proposed.sourceProvenance.importedAt } },
    proposed,
    canonicalizer,
  );
}

function requirePosting(current: ObjectEnvelopeV1, prepared: PreparedJobPostingSourceV1): JobPostingPayloadV1 {
  if (current.objectType !== JOB_POSTING_OBJECT_V1.objectType || current.objectProfile !== JOB_POSTING_OBJECT_V1.objectProfile
    || current.schemaId !== JOB_POSTING_OBJECT_V1.schemaId || current.schemaVersion !== JOB_POSTING_OBJECT_V1.schemaVersion) {
    throw new JobPostingOperationErrorV1("object-invalid", "persistence", "The target Object is not a Job Posting.");
  }
  if (current.ownership.ownerId !== prepared.request.ownerId) {
    throw new JobPostingOperationErrorV1("owner-mismatch", "persistence", "Job Posting ownership does not match the request.");
  }
  return validateJobPostingPayloadV1(current.data);
}

function fieldStates(fields: JobPostingFieldsV1) {
  const unknown: string[] = [];
  const notSupplied: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value.state === "unknown") unknown.push(key);
    if (value.state === "not-supplied") notSupplied.push(key);
  }
  return { unknown: unknown.sort(), notSupplied: notSupplied.sort() };
}

const DRY_SUMMARY = Object.freeze({
  contentReturned: false as const,
  completePathReturned: false as const,
  objectWrites: 0 as const,
  relationshipWrites: 0 as const,
  identityWrites: 0 as const,
  sourceCopies: 0 as const,
  networkActions: 0 as const,
});

export async function dryRunJobPostingImportV1(
  request: unknown,
  ports: Pick<JobPostingOperationPortsV1, "clock" | "idDeriver">,
): Promise<JobPostingDryRunResultV1> {
  try {
    const prepared = await prepareJobPostingSourceV1(request);
    const proposed = payload(prepared, ports.clock.now());
    const states = fieldStates(proposed.fields);
    const warningCodes = [
      ...(proposed.listingCurrentness.state === "unknown" ? ["listing-currentness-unknown"] : []),
      ...(prepared.request.sourceType === "structured-json" ? [] : ["unstructured-description-only"]),
      ...(proposed.fields.sourceReference.state === "supplied" ? ["source-reference-inert-not-fetched"] : []),
    ].sort();
    return {
      version: "1",
      accepted: true,
      proposedOperation: prepared.request.target.mode,
      proposedObjectReference: privateJobPostingReferenceV1(objectId(prepared, ports)),
      sourceType: prepared.request.sourceType,
      contentDigest: prepared.contentDigest,
      unknownFields: states.unknown,
      notSuppliedFields: states.notSupplied,
      currentnessState: proposed.listingCurrentness.state,
      warningCodes,
      error: null,
      summary: DRY_SUMMARY,
    };
  } catch (error) {
    const safe = safeError(error, "source");
    return {
      version: "1", accepted: false, proposedOperation: null, proposedObjectReference: null,
      sourceType: null, contentDigest: null, unknownFields: [], notSuppliedFields: [], currentnessState: null,
      warningCodes: [], error: safe.toResult(), summary: DRY_SUMMARY,
    };
  }
}

function createEnvelope(
  prepared: PreparedJobPostingSourceV1,
  id: ObjectIdV1,
  importedAt: string,
  data: JobPostingPayloadV1,
  ports: JobPostingOperationPortsV1,
): ObjectEnvelopeV1 {
  return createObjectV1({
    registration: JOB_POSTING_OBJECT_V1,
    ownerId: prepared.request.ownerId,
    actorId: prepared.request.actorId,
    lifecycleState: "active",
    metadata: EMPTY_METADATA,
    provenance: {
      version: "1",
      originCategory: "imported",
      observedAt: importedAt,
      correlationId: prepared.request.importOperationId,
    },
    data: data as unknown as CanonicalValueV1,
  }, {
    clock: { now: () => importedAt },
    idGenerator: { generate: () => id },
    canonicalizer: ports.canonicalizer,
    digest: ports.digest,
    schemaRegistry: ports.schemaRegistry,
  });
}

function revisionEnvelope(
  current: ObjectEnvelopeV1,
  prepared: PreparedJobPostingSourceV1,
  importedAt: string,
  data: JobPostingPayloadV1,
  ports: JobPostingOperationPortsV1,
): ObjectEnvelopeV1 {
  return sealObjectEnvelopeV1({
    ...objectEnvelopeContentV1(current),
    revision: current.revision + 1,
    modifiedBy: prepared.request.actorId,
    modifiedAt: importedAt,
    lifecycleState: "active",
    metadata: EMPTY_METADATA,
    provenanceSummary: {
      version: "1",
      originCategory: "imported",
      responsibleActorId: prepared.request.actorId,
      observedAt: importedAt,
      recordedAt: importedAt,
      correlationId: prepared.request.importOperationId,
    },
    data: data as unknown as CanonicalValueV1,
  }, ports);
}

function result(outcome: JobPostingImportResultV1["outcome"], id: ObjectIdV1 | null, revision: number | null, created: 0 | 1, error: JobPostingErrorV1 | null): JobPostingImportResultV1 {
  return {
    version: "1", outcome, objectReference: id === null ? null : privateJobPostingReferenceV1(id),
    revision, createdObjectCount: created, relationshipWrites: 0, identityWrites: 0, sourceCopies: 0,
    networkActions: 0, error,
  };
}

export async function importJobPostingV1(
  request: unknown,
  ports: JobPostingOperationPortsV1,
): Promise<JobPostingImportResultV1> {
  let id: ObjectIdV1 | null = null;
  try {
    const prepared = await prepareJobPostingSourceV1(request);
    id = objectId(prepared, ports);
    const importedAt = ports.clock.now();
    const proposed = payload(prepared, importedAt);
    let current = await ports.repository.loadCurrent(id);
    if (prepared.request.target.mode === "create") {
      if (current !== null) {
        const actual = requirePosting(current, prepared);
        if (!equivalentRequest(actual, proposed, ports.canonicalizer)) {
          throw new JobPostingOperationErrorV1("revision-conflict", "persistence", "The import operation is already bound to different source bytes or values.");
        }
        return result("already-completed", id, current.revision, 0, null);
      }
      const snapshot = createEnvelope(prepared, id, importedAt, proposed, ports);
      try {
        await ports.repository.commit({ expectedRevision: null, snapshot });
        return result("success", id, 1, 1, null);
      } catch (error) {
        if (!(error instanceof ObjectErrorV1) || error.code !== "revision-conflict") throw error;
        current = await ports.repository.loadCurrent(id);
        if (current === null) throw error;
        const actual = requirePosting(current, prepared);
        if (!equivalentRequest(actual, proposed, ports.canonicalizer)) throw error;
        return result("already-completed", id, current.revision, 0, null);
      }
    }

    if (current === null) throw new JobPostingOperationErrorV1("not-found", "persistence", "The Job Posting revision target was not found.");
    const actual = requirePosting(current, prepared);
    const expected = prepared.request.target.expectedRevision;
    if (current.revision === expected + 1 && equivalentRequest(actual, proposed, ports.canonicalizer)) {
      return result("already-completed", id, current.revision, 0, null);
    }
    if (current.revision !== expected) {
      throw new JobPostingOperationErrorV1("revision-conflict", "persistence", "The expected Job Posting revision is stale.");
    }
    const snapshot = revisionEnvelope(current, prepared, importedAt, proposed, ports);
    try {
      await ports.repository.commit({ expectedRevision: expected, snapshot });
      return result("success", id, snapshot.revision, 0, null);
    } catch (error) {
      if (!(error instanceof ObjectErrorV1) || error.code !== "revision-conflict") throw error;
      const winner = await ports.repository.loadCurrent(id);
      if (winner === null) throw error;
      const winnerPayload = requirePosting(winner, prepared);
      if (winner.revision === expected + 1 && equivalentRequest(winnerPayload, proposed, ports.canonicalizer)) {
        return result("already-completed", id, winner.revision, 0, null);
      }
      throw error;
    }
  } catch (error) {
    const safe = safeError(error, "persistence");
    return result("rejected", id, null, 0, safe.toResult());
  }
}
