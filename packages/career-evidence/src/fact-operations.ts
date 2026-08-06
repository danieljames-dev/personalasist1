import {
  asObjectIdV1,
  CAREER_FACT_OBJECT_V1,
  validateCanonicalIdentifierV1,
  type CanonicalValueV1,
  type ObjectEnvelopeV1,
  type ObjectIdV1,
} from "@aion/object";
import { asActorIdV1, asOwnerIdV1 } from "@aion/identity";
import {
  CareerEvidenceOperationErrorV1,
  validateCareerFactPayloadV1,
  type CareerFactConflictRequestV1,
  type CareerFactOperationResultV1,
  type CareerFactPayloadV1,
  type CareerFactSupersessionRequestV1,
} from "./contracts.js";
import { privateObjectReferenceSummaryV1, stableConflictGroupIdV1 } from "./ids.js";
import {
  appendDomainRevisionV1,
  operationErrorV1,
  requireOwnedRegistrationV1,
  type CareerEvidenceOperationPortsV1,
} from "./object-helpers.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function positive(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function sortedUnique(values: unknown, validator: (value: unknown) => boolean): values is readonly string[] {
  if (!Array.isArray(values)) return false;
  let prior: string | undefined;
  for (const item of values) {
    if (!validator(item) || (prior !== undefined && prior >= item)) return false;
    prior = item as string;
  }
  return true;
}

function validOperationId(value: unknown): value is string {
  try { validateCanonicalIdentifierV1(value, "$.operationId"); return true; } catch { return false; }
}

function validateConflictRequest(value: unknown): CareerFactConflictRequestV1 {
  if (!isRecord(value) || !exactKeys(value, [
    "actorId", "conflictOperationId", "expectedRevisions", "factIds", "fieldLocations", "ownerId", "version",
  ]) || value.version !== "1" || !validOperationId(value.conflictOperationId)
    || !sortedUnique(value.factIds, (item) => { try { asObjectIdV1(item); return true; } catch { return false; } })
    || value.factIds.length < 2 || !Array.isArray(value.expectedRevisions)
    || value.expectedRevisions.length !== value.factIds.length || !value.expectedRevisions.every(positive)
    || !sortedUnique(value.fieldLocations, (item) => typeof item === "string" && (/^line:[1-9][0-9]*$/.test(item) || /^(?:\/(?:[^~/]|~0|~1)*)+$/.test(item)))) {
    throw new CareerEvidenceOperationErrorV1("request-invalid", "request", "A closed explicit conflict request is required.");
  }
  try { asOwnerIdV1(value.ownerId); asActorIdV1(value.actorId); } catch {
    throw new CareerEvidenceOperationErrorV1("request-invalid", "request", "Synthetic or approved typed Identity references are required.");
  }
  return value as unknown as CareerFactConflictRequestV1;
}

function validateSupersessionRequest(value: unknown): CareerFactSupersessionRequestV1 {
  if (!isRecord(value) || !exactKeys(value, [
    "actorId", "expectedPriorRevision", "ownerId", "priorFactId", "replacementFactId", "supersessionOperationId", "version",
  ]) || value.version !== "1" || !validOperationId(value.supersessionOperationId)
    || !positive(value.expectedPriorRevision) || value.priorFactId === value.replacementFactId) {
    throw new CareerEvidenceOperationErrorV1("request-invalid", "request", "A closed explicit supersession request is required.");
  }
  try { asOwnerIdV1(value.ownerId); asActorIdV1(value.actorId); } catch {
    throw new CareerEvidenceOperationErrorV1("request-invalid", "request", "Synthetic or approved typed Identity references are required.");
  }
  try { asObjectIdV1(value.priorFactId); asObjectIdV1(value.replacementFactId); } catch {
    throw new CareerEvidenceOperationErrorV1("request-invalid", "request", "Valid distinct CareerFact references are required.");
  }
  return value as unknown as CareerFactSupersessionRequestV1;
}

async function loadFact(
  factId: ObjectIdV1,
  ownerId: CareerFactConflictRequestV1["ownerId"],
  ports: CareerEvidenceOperationPortsV1,
): Promise<{ readonly object: ObjectEnvelopeV1; readonly payload: CareerFactPayloadV1 }> {
  const object = await ports.repository.loadCurrent(factId);
  if (object === null) throw new CareerEvidenceOperationErrorV1("not-found", "persistence", "A required CareerFact was not found.");
  requireOwnedRegistrationV1(object, CAREER_FACT_OBJECT_V1, ownerId);
  return { object, payload: validateCareerFactPayloadV1(object.data) };
}

export async function markCareerFactsConflictingV1(
  value: unknown,
  ports: CareerEvidenceOperationPortsV1,
): Promise<CareerFactOperationResultV1> {
  let request: CareerFactConflictRequestV1;
  try { request = validateConflictRequest(value); } catch (error) {
    const safe = operationErrorV1(error, "request");
    return { version: "1", outcome: "rejected", factReferences: [], recoveryRequired: false, error: safe.toResult() };
  }
  const references = request.factIds.map(privateObjectReferenceSummaryV1);
  const groupId = stableConflictGroupIdV1(request.factIds, request.fieldLocations);
  let changed = 0;
  try {
    const loaded = await Promise.all(request.factIds.map((id) => loadFact(id, request.ownerId, ports)));
    if (new Set(loaded.map((item) => item.payload.factType)).size !== 1) {
      throw new CareerEvidenceOperationErrorV1("contract-invalid", "persistence", "A conflict group must compare one CareerFact type.");
    }
    for (let index = 0; index < loaded.length; index += 1) {
      const current = loaded[index]!;
      const expectedRevision = request.expectedRevisions[index]!;
      if (current.payload.conflict.state === "conflicting" && current.payload.conflict.groupId === groupId) {
        if (current.object.revision !== expectedRevision + 1) {
          throw new CareerEvidenceOperationErrorV1("revision-conflict", "persistence", "A previously marked conflict has an unexpected revision.");
        }
        continue;
      }
      if (current.payload.conflict.state !== "none" || current.object.revision !== expectedRevision) {
        throw new CareerEvidenceOperationErrorV1("revision-conflict", "persistence", "A CareerFact changed before explicit conflict recording.");
      }
    }
    const timestamp = ports.clock.now();
    for (let index = 0; index < loaded.length; index += 1) {
      const current = loaded[index]!;
      if (current.payload.conflict.state === "conflicting") continue;
      const otherFactIds = request.factIds.filter((id) => id !== current.object.objectId);
      const next: CareerFactPayloadV1 = {
        ...current.payload,
        status: {
          version: "1",
          verification: current.payload.status.verification,
          assertion: current.payload.status.assertion,
          conflict: "conflicting",
        },
        conflict: {
          version: "1", state: "conflicting", groupId,
          conflictingFactIds: otherFactIds,
          fieldLocations: request.fieldLocations,
        },
      } as CareerFactPayloadV1;
      await appendDomainRevisionV1(
        current.object,
        request.expectedRevisions[index]!,
        request.actorId,
        timestamp,
        "owner-authored",
        request.conflictOperationId,
        next as unknown as CanonicalValueV1,
        ports,
      );
      changed += 1;
    }
    return {
      version: "1", outcome: changed === 0 ? "already-completed" : "success",
      factReferences: references, recoveryRequired: false, error: null,
    };
  } catch (error) {
    const safe = operationErrorV1(error, "persistence");
    return {
      version: "1", outcome: changed > 0 ? "partial" : "rejected", factReferences: references,
      recoveryRequired: changed > 0, error: safe.toResult(),
    };
  }
}

export async function supersedeCareerFactV1(
  value: unknown,
  ports: CareerEvidenceOperationPortsV1,
): Promise<CareerFactOperationResultV1> {
  let request: CareerFactSupersessionRequestV1;
  try { request = validateSupersessionRequest(value); } catch (error) {
    const safe = operationErrorV1(error, "request");
    return { version: "1", outcome: "rejected", factReferences: [], recoveryRequired: false, error: safe.toResult() };
  }
  const references = [request.priorFactId, request.replacementFactId].map(privateObjectReferenceSummaryV1);
  try {
    const [prior, replacement] = await Promise.all([
      loadFact(request.priorFactId, request.ownerId, ports),
      loadFact(request.replacementFactId, request.ownerId, ports),
    ]);
    if (prior.payload.factType !== replacement.payload.factType) {
      throw new CareerEvidenceOperationErrorV1("contract-invalid", "persistence", "Supersession requires the same CareerFact type.");
    }
    if (prior.payload.supersession.state === "superseded") {
      if (prior.payload.supersession.replacementFactId === request.replacementFactId
        && prior.object.revision === request.expectedPriorRevision + 1
        && prior.object.provenanceSummary.correlationId === request.supersessionOperationId) {
        return { version: "1", outcome: "already-completed", factReferences: references, recoveryRequired: false, error: null };
      }
      throw new CareerEvidenceOperationErrorV1("revision-conflict", "persistence", "The prior CareerFact already has a different supersession state.");
    }
    if (prior.object.revision !== request.expectedPriorRevision || replacement.payload.supersession.state !== "current") {
      throw new CareerEvidenceOperationErrorV1("revision-conflict", "persistence", "CareerFact revisions do not permit the requested supersession.");
    }
    const timestamp = ports.clock.now();
    const next: CareerFactPayloadV1 = {
      ...prior.payload,
      supersession: { version: "1", state: "superseded", replacementFactId: request.replacementFactId, supersededAt: timestamp },
    } as CareerFactPayloadV1;
    await appendDomainRevisionV1(
      prior.object,
      request.expectedPriorRevision,
      request.actorId,
      timestamp,
      "owner-authored",
      request.supersessionOperationId,
      next as unknown as CanonicalValueV1,
      ports,
    );
    return { version: "1", outcome: "success", factReferences: references, recoveryRequired: false, error: null };
  } catch (error) {
    const safe = operationErrorV1(error, "persistence");
    return { version: "1", outcome: "rejected", factReferences: references, recoveryRequired: false, error: safe.toResult() };
  }
}
