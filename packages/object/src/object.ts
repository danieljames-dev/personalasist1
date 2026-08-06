import { asActorIdV1, asOwnerIdV1 } from "@aion/identity";
import { randomUUID } from "node:crypto";
import {
  buildAionFrameV1,
  canonicalizeValueV1,
  equalDigestV1,
  validateCanonicalIdentifierV1,
  validateCanonicalStringV1,
} from "./canonical.js";
import {
  ObjectErrorV1,
  type CanonicalValueV1,
  type ObjectConstructionPortsV1,
  type ObjectCreateInputV1,
  type ObjectEnvelopeContentV1,
  type ObjectEnvelopeV1,
  type ObjectIdV1,
  type ObjectIntegrityDescriptorV1,
  type ObjectLifecycleStatusV1,
  type ObjectClock,
  type ObjectIdGenerator,
  type ObjectMetadataV1,
  type ObjectProvenanceV1,
  type ObjectSchemaIdV1,
  type ObjectSchemaRegistryV1,
  type ObjectTypeRegistrationV1,
  type ObjectTypeV1,
} from "./contracts.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NAMESPACED_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:+-]*[.:][A-Za-z0-9._:+-]+$/;
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;
const DIGEST = /^[0-9a-f]{64}$/;

const BASE_CONTENT_KEYS = [
  "createdAt",
  "createdBy",
  "data",
  "lifecycleState",
  "metadata",
  "modifiedAt",
  "modifiedBy",
  "objectContractVersion",
  "objectId",
  "objectProfile",
  "objectType",
  "ownership",
  "provenanceSummary",
  "revision",
  "schemaId",
  "schemaVersion",
] as const;
const OPTIONAL_CONTENT_KEYS = ["auditStreamRef", "permissionSetRef"] as const;
const INTEGRITY_KEYS = [
  "algorithm",
  "canonicalizationProfile",
  "context",
  "contractFamily",
  "contractVersion",
  "digest",
  "frameVersion",
  "purpose",
  "schemaId",
  "schemaVersion",
] as const;
const PROVENANCE_REQUIRED_KEYS = [
  "correlationId",
  "observedAt",
  "originCategory",
  "recordedAt",
  "responsibleActorId",
  "version",
] as const;
const PROVENANCE_OPTIONAL_KEYS = [
  "derivationMethodId",
  "externalSourceRef",
  "sourceObjectId",
] as const;

function fail(
  code: ConstructorParameters<typeof ObjectErrorV1>[0],
  location: string,
  message: string,
): never {
  throw new ObjectErrorV1(code, location, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasClosedKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => required.includes(key) || optional.includes(key))
    && keys.length >= required.length;
}

function freezeDeep<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const item of Object.values(value as Record<string, unknown>)) freezeDeep(item);
  return Object.freeze(value);
}

function cloneFrozen<T>(value: T): T {
  return freezeDeep(structuredClone(value));
}

export function asObjectIdV1(value: unknown): ObjectIdV1 {
  if (typeof value !== "string" || !UUID_V4.test(value)) {
    fail("invalid-identifier", "$.objectId", "ObjectIdV1 must be an opaque canonical UUID v4.");
  }
  return value as ObjectIdV1;
}

function asNamespacedIdentifier(value: unknown, location: string): string {
  validateCanonicalIdentifierV1(value, location);
  if (!NAMESPACED_IDENTIFIER.test(value)) {
    fail("invalid-identifier", location, "Namespaced identifier validation failed.");
  }
  return value;
}

export function asObjectTypeV1(value: unknown): ObjectTypeV1 {
  return asNamespacedIdentifier(value, "$.objectType") as ObjectTypeV1;
}

export function asObjectSchemaIdV1(value: unknown): ObjectSchemaIdV1 {
  return asNamespacedIdentifier(value, "$.schemaId") as ObjectSchemaIdV1;
}

export function isCanonicalObjectTimestampV1(value: unknown): value is string {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

function requireTimestamp(value: unknown, location: string): asserts value is string {
  if (!isCanonicalObjectTimestampV1(value)) {
    fail("invalid-timestamp", location, "Timestamp must be canonical RFC 3339 UTC milliseconds.");
  }
}

function requirePositiveInteger(value: unknown, location: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    fail("invalid-object", location, "Positive safe integer required.");
  }
}

function validateRegistration(
  value: Record<string, unknown>,
  registry: ObjectSchemaRegistryV1,
): ObjectTypeRegistrationV1 {
  const objectType = asObjectTypeV1(value.objectType);
  const schemaId = asObjectSchemaIdV1(value.schemaId);
  const objectProfile = value.objectProfile;
  if (objectProfile !== "entity" && objectProfile !== "relationship") {
    fail("invalid-object", "$.objectProfile", "Only mutable Object reference profiles are implemented in Phase 5.");
  }
  requirePositiveInteger(value.schemaVersion, "$.schemaVersion");
  const registration: ObjectTypeRegistrationV1 = {
    objectType,
    objectProfile,
    schemaId,
    schemaVersion: value.schemaVersion,
  };
  let registered = false;
  try {
    registered = registry.isRegistered(registration);
  } catch {
    fail("unknown-object-type", "$.objectType", "Object type registry failed closed.");
  }
  if (!registered) {
    fail("unknown-object-type", "$.objectType", "Object type and schema registration is unknown.");
  }
  return registration;
}

function validateMetadata(value: unknown, registry: ObjectSchemaRegistryV1): asserts value is ObjectMetadataV1 {
  if (!isRecord(value) || !hasClosedKeys(value, ["extensions", "labels"])) {
    fail("invalid-object", "$.metadata", "Object metadata shape is invalid.");
  }
  if (!Array.isArray(value.labels)) fail("invalid-object", "$.metadata.labels", "Metadata labels must be an array.");
  let prior: string | undefined;
  for (const [index, label] of value.labels.entries()) {
    validateCanonicalStringV1(label, `$.metadata.labels[${index}]`);
    if (label.length === 0 || label.trim() !== label || (prior !== undefined && prior >= label)) {
      fail("invalid-object", `$.metadata.labels[${index}]`, "Labels must be non-empty, unique, and UTF-16 sorted.");
    }
    prior = label;
  }
  if (!isRecord(value.extensions)) fail("invalid-object", "$.metadata.extensions", "Metadata extensions must be an Object.");
  for (const namespace of Object.keys(value.extensions)) {
    asNamespacedIdentifier(namespace, "$.metadata.extensions.*");
    let registered = false;
    try {
      registered = registry.isExtensionNamespaceRegistered(namespace);
    } catch {
      fail("invalid-object", "$.metadata.extensions", "Extension namespace registry failed closed.");
    }
    if (!registered) fail("invalid-object", "$.metadata.extensions", "Extension namespace is not registered.");
  }
  canonicalizeValueV1(value);
}

function validateProvenance(value: unknown, modifiedAt: string): asserts value is ObjectProvenanceV1 {
  if (!isRecord(value) || !hasClosedKeys(value, PROVENANCE_REQUIRED_KEYS, PROVENANCE_OPTIONAL_KEYS)) {
    fail("invalid-object", "$.provenanceSummary", "Object provenance shape is invalid.");
  }
  const origins = ["owner-authored", "imported", "derived", "observed", "system-produced"];
  if (value.version !== "1" || !origins.includes(value.originCategory as string)) {
    fail("invalid-object", "$.provenanceSummary", "Object provenance version or origin is invalid.");
  }
  try {
    asActorIdV1(value.responsibleActorId);
  } catch {
    fail("invalid-reference", "$.provenanceSummary.responsibleActorId", "Provenance Actor reference is invalid.");
  }
  requireTimestamp(value.observedAt, "$.provenanceSummary.observedAt");
  requireTimestamp(value.recordedAt, "$.provenanceSummary.recordedAt");
  if (Date.parse(value.observedAt) > Date.parse(value.recordedAt) || Date.parse(value.recordedAt) > Date.parse(modifiedAt)) {
    fail("invalid-timestamp", "$.provenanceSummary", "Provenance timestamp ordering is invalid.");
  }
  validateCanonicalIdentifierV1(value.correlationId, "$.provenanceSummary.correlationId");
  if (value.sourceObjectId !== undefined) asObjectIdV1(value.sourceObjectId);
  if (value.externalSourceRef !== undefined) validateCanonicalIdentifierV1(value.externalSourceRef, "$.provenanceSummary.externalSourceRef");
  if (value.derivationMethodId !== undefined) validateCanonicalIdentifierV1(value.derivationMethodId, "$.provenanceSummary.derivationMethodId");
  if (value.originCategory === "derived" && value.derivationMethodId === undefined) {
    fail("invalid-object", "$.provenanceSummary.derivationMethodId", "Derived provenance requires a method identifier.");
  }
  canonicalizeValueV1(value);
}

function validateContent(
  value: unknown,
  registry: ObjectSchemaRegistryV1,
): ObjectEnvelopeContentV1 {
  if (!isRecord(value) || !hasClosedKeys(value, BASE_CONTENT_KEYS, OPTIONAL_CONTENT_KEYS)) {
    fail("invalid-object", "$", "Object envelope content has an unknown, missing, or additional field.");
  }
  asObjectIdV1(value.objectId);
  if (value.objectContractVersion !== "1") fail("unsupported-contract", "$.objectContractVersion", "Unsupported Object contract.");
  const registration = validateRegistration(value, registry);
  requirePositiveInteger(value.revision, "$.revision");
  if (!isRecord(value.ownership) || !hasClosedKeys(value.ownership, ["ownerId"])) {
    fail("invalid-object", "$.ownership", "Object ownership shape is invalid.");
  }
  try {
    asOwnerIdV1(value.ownership.ownerId);
    asActorIdV1(value.createdBy);
    asActorIdV1(value.modifiedBy);
  } catch {
    fail("invalid-reference", "$", "Object Identity reference is invalid.");
  }
  requireTimestamp(value.createdAt, "$.createdAt");
  requireTimestamp(value.modifiedAt, "$.modifiedAt");
  if (Date.parse(value.modifiedAt) < Date.parse(value.createdAt)) {
    fail("invalid-timestamp", "$.modifiedAt", "Modified time precedes creation time.");
  }
  const lifecycles: ObjectLifecycleStatusV1[] = [
    "created", "validated", "active", "archived", "deprecated", "deleted", "destroyed",
  ];
  if (!lifecycles.includes(value.lifecycleState as ObjectLifecycleStatusV1)) {
    fail("invalid-object", "$.lifecycleState", "Object lifecycle state is invalid.");
  }
  validateMetadata(value.metadata, registry);
  validateProvenance(value.provenanceSummary, value.modifiedAt);
  if (value.permissionSetRef !== undefined) asObjectIdV1(value.permissionSetRef);
  if (value.auditStreamRef !== undefined) asObjectIdV1(value.auditStreamRef);
  canonicalizeValueV1(value.data);
  let domainValid = false;
  try {
    domainValid = registry.validateData(registration, value.data as CanonicalValueV1);
  } catch {
    fail("invalid-domain-data", "$.data", "Registered Object schema validation failed closed.");
  }
  if (!domainValid) {
    fail("invalid-domain-data", "$.data", "Registered Object schema rejected data.");
  }
  canonicalizeValueV1(value);
  return value as unknown as ObjectEnvelopeContentV1;
}

function canonicalContentProjection(value: ObjectEnvelopeContentV1): CanonicalValueV1 {
  const projection: Record<string, CanonicalValueV1> = {
    objectId: value.objectId,
    objectType: value.objectType,
    objectProfile: value.objectProfile,
    objectContractVersion: value.objectContractVersion,
    schemaId: value.schemaId,
    schemaVersion: value.schemaVersion,
    revision: value.revision,
    ownership: value.ownership as unknown as CanonicalValueV1,
    createdBy: value.createdBy,
    createdAt: value.createdAt,
    modifiedBy: value.modifiedBy,
    modifiedAt: value.modifiedAt,
    lifecycleState: value.lifecycleState,
    metadata: value.metadata as unknown as CanonicalValueV1,
    provenanceSummary: value.provenanceSummary as unknown as CanonicalValueV1,
    data: value.data,
  };
  if (value.permissionSetRef !== undefined) projection.permissionSetRef = value.permissionSetRef;
  if (value.auditStreamRef !== undefined) projection.auditStreamRef = value.auditStreamRef;
  return projection;
}

function integrityContext(content: ObjectEnvelopeContentV1): string {
  const context = `${content.schemaId}:${content.schemaVersion}`;
  if (new TextEncoder().encode(context).byteLength > 1_024) {
    fail("frame-length-overflow", "$.integrity.context", "Integrity context exceeds L-12.");
  }
  return context;
}

function expectedIntegrity(
  content: ObjectEnvelopeContentV1,
  canonicalizer: ObjectConstructionPortsV1["canonicalizer"],
  digest: ObjectConstructionPortsV1["digest"],
): ObjectIntegrityDescriptorV1 {
  let canonical: Uint8Array;
  try {
    canonical = canonicalizer.canonicalize(canonicalContentProjection(content));
  } catch (error) {
    if (error instanceof ObjectErrorV1) throw error;
    fail("invalid-object", "$", "Canonical serializer failed closed.");
  }
  if (!(canonical instanceof Uint8Array)) fail("invalid-object", "$", "Canonical serializer returned invalid bytes.");
  const context = integrityContext(content);
  const framed = buildAionFrameV1({
    frameVersion: "1",
    purpose: "aion.object.integrity",
    profileId: "acj-1",
    contractFamily: "aion.object",
    contractVersion: "1",
    context,
  }, canonical);
  let digestValue: string;
  try {
    digestValue = digest.digest("sha-256", framed);
  } catch (error) {
    if (error instanceof ObjectErrorV1) throw error;
    fail("invalid-object", "$.integrity", "Digest adapter failed closed.");
  }
  if (!DIGEST.test(digestValue)) fail("invalid-object", "$.integrity.digest", "Digest adapter returned invalid output.");
  return {
    frameVersion: "1",
    purpose: "aion.object.integrity",
    canonicalizationProfile: "acj-1",
    algorithm: "sha-256",
    digest: digestValue,
    contractFamily: "aion.object",
    contractVersion: "1",
    schemaId: content.schemaId,
    schemaVersion: content.schemaVersion,
    context,
  };
}

export function sealObjectEnvelopeV1(
  value: unknown,
  ports: Pick<ObjectConstructionPortsV1, "canonicalizer" | "digest" | "schemaRegistry">,
): ObjectEnvelopeV1 {
  const content = validateContent(value, ports.schemaRegistry);
  const envelope = { ...cloneFrozen(content), integrity: expectedIntegrity(content, ports.canonicalizer, ports.digest) };
  canonicalizeValueV1(envelope);
  return cloneFrozen(envelope);
}

export function validateObjectEnvelopeV1(
  value: unknown,
  ports: Pick<ObjectConstructionPortsV1, "canonicalizer" | "digest" | "schemaRegistry">,
): ObjectEnvelopeV1 {
  if (!isRecord(value) || !Object.hasOwn(value, "integrity")) {
    fail("invalid-object", "$", "Object envelope is missing integrity.");
  }
  const contentKeys = Object.keys(value).filter((key) => key !== "integrity");
  const contentValue: Record<string, unknown> = {};
  for (const key of contentKeys) contentValue[key] = value[key];
  const content = validateContent(contentValue, ports.schemaRegistry);
  const integrity = value.integrity;
  if (!isRecord(integrity) || !hasClosedKeys(integrity, INTEGRITY_KEYS)) {
    fail("invalid-object", "$.integrity", "Object integrity descriptor shape is invalid.");
  }
  const expected = expectedIntegrity(content, ports.canonicalizer, ports.digest);
  if (
    integrity.frameVersion !== expected.frameVersion
    || integrity.purpose !== expected.purpose
    || integrity.canonicalizationProfile !== expected.canonicalizationProfile
    || integrity.algorithm !== expected.algorithm
    || integrity.contractFamily !== expected.contractFamily
    || integrity.contractVersion !== expected.contractVersion
    || integrity.schemaId !== expected.schemaId
    || integrity.schemaVersion !== expected.schemaVersion
    || integrity.context !== expected.context
    || typeof integrity.digest !== "string"
    || !DIGEST.test(integrity.digest)
    || !equalDigestV1(integrity.digest, expected.digest)
  ) {
    fail("integrity-mismatch", "$.integrity", "Object integrity verification failed.");
  }
  canonicalizeValueV1(value);
  return cloneFrozen(value as unknown as ObjectEnvelopeV1);
}

export function createObjectV1<TData extends CanonicalValueV1>(
  input: ObjectCreateInputV1<TData>,
  ports: ObjectConstructionPortsV1,
): ObjectEnvelopeV1<TData> {
  let registered = false;
  try {
    registered = ports.schemaRegistry.isRegistered(input.registration);
  } catch {
    fail("unknown-object-type", "$.objectType", "Object type registry failed closed.");
  }
  if (!registered) {
    fail("unknown-object-type", "$.objectType", "Object type and schema registration is unknown.");
  }
  const objectId = asObjectIdV1(ports.idGenerator.generate());
  const timestamp = ports.clock.now();
  requireTimestamp(timestamp, "$.createdAt");
  const content: ObjectEnvelopeContentV1<TData> = {
    objectId,
    objectType: input.registration.objectType,
    objectProfile: input.registration.objectProfile,
    objectContractVersion: "1",
    schemaId: input.registration.schemaId,
    schemaVersion: input.registration.schemaVersion,
    revision: 1,
    ownership: { ownerId: input.ownerId },
    createdBy: input.actorId,
    createdAt: timestamp,
    modifiedBy: input.actorId,
    modifiedAt: timestamp,
    lifecycleState: input.lifecycleState,
    metadata: input.metadata,
    provenanceSummary: {
      ...input.provenance,
      responsibleActorId: input.actorId,
      recordedAt: timestamp,
    },
    data: input.data,
  };
  return sealObjectEnvelopeV1(content, ports) as ObjectEnvelopeV1<TData>;
}

export class SystemObjectClock implements ObjectClock {
  now(): string {
    return new Date().toISOString();
  }
}

export class RandomUuidObjectIdGenerator implements ObjectIdGenerator {
  generate(): string {
    return randomUUID();
  }
}

export function objectEnvelopeContentV1(value: ObjectEnvelopeV1): ObjectEnvelopeContentV1 {
  const { integrity: _integrity, ...content } = value;
  return cloneFrozen(content);
}
