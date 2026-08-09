import {
  type ApprovalProofV1,
  type CapabilityEnvelopeV1,
  type OperationClassV1,
  type GitPermissionV1,
  type HostPermissionV1,
  type NestedOwnerGateV1,
  type AuthorizationLifecycleV1,
  type RiskClassV1,
  type ExternalActionPolicyV1,
  type CredentialPolicyV1,
  ENVELOPE_SCHEMA_VERSION,
  OPERATION_CLASSES_V1,
  GIT_PERMISSIONS_V1,
  HOST_PERMISSIONS_V1,
  NESTED_OWNER_GATES_V1,
  AUTHORIZATION_LIFECYCLES_V1,
  RISK_CLASSES_V1,
  DelegatedOperatorError,
  isAgentRoleV1,
  isOperationClassV1,
} from "./contracts.js";
import { digestCanonical } from "./canonical.js";
import { roleAllowsOperation } from "./roles.js";

const KNOWN_TOP_LEVEL = new Set([
  "schemaVersion",
  "directiveId",
  "authorizationId",
  "agentRole",
  "repositoryRoot",
  "canonicalOrigin",
  "baselineCommit",
  "allowOrdinaryForwardCommits",
  "machineRole",
  "machineName",
  "systemInstanceId",
  "authorizedOperations",
  "prohibitedOperations",
  "riskClass",
  "issuedAtUtc",
  "expiresAtUtc",
  "completionLifecycle",
  "allowedLifecycleTransitions",
  "gitPermissions",
  "hostPermissions",
  "rebootPolicy",
  "externalActionPolicy",
  "credentialPolicy",
  "spendPolicy",
  "nestedOwnerGates",
  "supersedesAuthorizationId",
  "approvalProof",
]);

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.normalize("NFC") !== value) {
    throw new DelegatedOperatorError("envelope-invalid", `Invalid string field: ${field}`);
  }
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new DelegatedOperatorError("envelope-invalid", `Invalid boolean field: ${field}`);
  }
  return value;
}

function parseOps(value: unknown, field: string): OperationClassV1[] {
  if (!Array.isArray(value)) throw new DelegatedOperatorError("envelope-invalid", `${field} must be array`);
  const out: OperationClassV1[] = [];
  for (const item of value) {
    if (!isOperationClassV1(item)) {
      throw new DelegatedOperatorError("unknown-operation", `Unknown operation in ${field}: ${String(item)}`);
    }
    out.push(item);
  }
  return out;
}

function parseEnumArray<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T[] {
  if (!Array.isArray(value)) throw new DelegatedOperatorError("envelope-invalid", `${field} must be array`);
  const set = new Set<string>(allowed);
  const out: T[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !set.has(item)) {
      throw new DelegatedOperatorError("envelope-invalid", `Unknown value in ${field}: ${String(item)}`);
    }
    out.push(item as T);
  }
  return out;
}

function parseProof(value: unknown): ApprovalProofV1 | null {
  if (value === null) return null;
  if (typeof value !== "object" || value === null) {
    throw new DelegatedOperatorError("envelope-invalid", "approvalProof invalid");
  }
  const rec = value as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!["kind", "algorithm", "signatureHex", "approvedAtUtc", "presenceId"].includes(key)) {
      throw new DelegatedOperatorError("envelope-invalid", `Unknown approvalProof field: ${key}`);
    }
  }
  const kind = rec.kind;
  if (kind !== "synthetic_hmac_v1" && kind !== "unprovisioned_real_v1") {
    throw new DelegatedOperatorError("envelope-invalid", "Unknown approval proof kind");
  }
  if (rec.algorithm !== "hmac-sha256") {
    throw new DelegatedOperatorError("envelope-invalid", "Unsupported proof algorithm");
  }
  return {
    kind,
    algorithm: "hmac-sha256",
    signatureHex: requireString(rec.signatureHex, "approvalProof.signatureHex"),
    approvedAtUtc: requireString(rec.approvedAtUtc, "approvalProof.approvedAtUtc"),
    presenceId: requireString(rec.presenceId, "approvalProof.presenceId"),
  };
}

/** Unsigned body used for digests (approvalProof excluded). */
export function envelopeBodyForDigest(envelope: CapabilityEnvelopeV1): Record<string, unknown> {
  return {
    schemaVersion: envelope.schemaVersion,
    directiveId: envelope.directiveId,
    authorizationId: envelope.authorizationId,
    agentRole: envelope.agentRole,
    repositoryRoot: envelope.repositoryRoot,
    canonicalOrigin: envelope.canonicalOrigin,
    baselineCommit: envelope.baselineCommit,
    allowOrdinaryForwardCommits: envelope.allowOrdinaryForwardCommits,
    machineRole: envelope.machineRole,
    machineName: envelope.machineName,
    systemInstanceId: envelope.systemInstanceId,
    authorizedOperations: [...envelope.authorizedOperations].sort(),
    prohibitedOperations: [...envelope.prohibitedOperations].sort(),
    riskClass: envelope.riskClass,
    issuedAtUtc: envelope.issuedAtUtc,
    expiresAtUtc: envelope.expiresAtUtc,
    completionLifecycle: envelope.completionLifecycle,
    allowedLifecycleTransitions: [...envelope.allowedLifecycleTransitions].sort(),
    gitPermissions: [...envelope.gitPermissions].sort(),
    hostPermissions: [...envelope.hostPermissions].sort(),
    rebootPolicy: {
      allowed: envelope.rebootPolicy.allowed,
      maxReboots: envelope.rebootPolicy.maxReboots,
      oneTimeResumeTokens: envelope.rebootPolicy.oneTimeResumeTokens,
    },
    externalActionPolicy: envelope.externalActionPolicy,
    credentialPolicy: envelope.credentialPolicy,
    spendPolicy: { ceilingCents: envelope.spendPolicy.ceilingCents },
    nestedOwnerGates: [...envelope.nestedOwnerGates].sort(),
    supersedesAuthorizationId: envelope.supersedesAuthorizationId,
  };
}

export function envelopeDigest(envelope: CapabilityEnvelopeV1): string {
  return digestCanonical(envelopeBodyForDigest(envelope));
}

export function parseCapabilityEnvelope(input: unknown): CapabilityEnvelopeV1 {
  if (typeof input !== "object" || input === null) {
    throw new DelegatedOperatorError("envelope-invalid", "Envelope must be an object");
  }
  const rec = input as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!KNOWN_TOP_LEVEL.has(key)) {
      throw new DelegatedOperatorError("unknown-field", `Unknown envelope field: ${key}`);
    }
  }
  if (rec.schemaVersion !== ENVELOPE_SCHEMA_VERSION) {
    throw new DelegatedOperatorError("unsupported-version", "Unsupported envelope schema version");
  }
  if (!isAgentRoleV1(rec.agentRole)) {
    throw new DelegatedOperatorError("unknown-role", "Unknown agent role");
  }
  const reboot = rec.rebootPolicy;
  if (typeof reboot !== "object" || reboot === null) {
    throw new DelegatedOperatorError("envelope-invalid", "rebootPolicy required");
  }
  const rb = reboot as Record<string, unknown>;
  for (const key of Object.keys(rb)) {
    if (!["allowed", "maxReboots", "oneTimeResumeTokens"].includes(key)) {
      throw new DelegatedOperatorError("unknown-field", `Unknown rebootPolicy field: ${key}`);
    }
  }
  if (typeof rb.allowed !== "boolean" || typeof rb.oneTimeResumeTokens !== "boolean") {
    throw new DelegatedOperatorError("envelope-invalid", "rebootPolicy flags invalid");
  }
  if (typeof rb.maxReboots !== "number" || !Number.isInteger(rb.maxReboots) || rb.maxReboots < 0 || rb.maxReboots > 32) {
    throw new DelegatedOperatorError("envelope-invalid", "rebootPolicy.maxReboots invalid");
  }
  const spend = rec.spendPolicy;
  if (typeof spend !== "object" || spend === null) {
    throw new DelegatedOperatorError("envelope-invalid", "spendPolicy required");
  }
  const sp = spend as Record<string, unknown>;
  for (const key of Object.keys(sp)) {
    if (key !== "ceilingCents") {
      throw new DelegatedOperatorError("unknown-field", `Unknown spendPolicy field: ${key}`);
    }
  }
  if (typeof sp.ceilingCents !== "number" || !Number.isInteger(sp.ceilingCents) || sp.ceilingCents < 0) {
    throw new DelegatedOperatorError("envelope-invalid", "spendPolicy.ceilingCents invalid");
  }

  const riskClass = rec.riskClass;
  if (typeof riskClass !== "string" || !(RISK_CLASSES_V1 as readonly string[]).includes(riskClass)) {
    throw new DelegatedOperatorError("envelope-invalid", "Invalid riskClass");
  }
  const external = rec.externalActionPolicy;
  if (external !== "none" && external !== "allowlisted_public_fetch") {
    throw new DelegatedOperatorError("envelope-invalid", "Invalid externalActionPolicy");
  }
  const credential = rec.credentialPolicy;
  if (credential !== "none" && credential !== "explicit_nested_gate_only") {
    throw new DelegatedOperatorError("envelope-invalid", "Invalid credentialPolicy");
  }
  if (rec.completionLifecycle !== "AWAITING_REVIEW") {
    throw new DelegatedOperatorError("envelope-invalid", "completionLifecycle must be AWAITING_REVIEW");
  }

  const authorizedOperations = parseOps(rec.authorizedOperations, "authorizedOperations");
  const prohibitedOperations = parseOps(rec.prohibitedOperations, "prohibitedOperations");
  // Deny wins: any overlap is invalid to request as authorized.
  for (const op of authorizedOperations) {
    if (prohibitedOperations.includes(op)) {
      throw new DelegatedOperatorError("deny-wins", `Operation both authorized and prohibited: ${op}`);
    }
    if (!roleAllowsOperation(rec.agentRole, op)) {
      throw new DelegatedOperatorError("role-deny", `Role ${rec.agentRole} structurally cannot use ${op}`);
    }
  }

  const envelope: CapabilityEnvelopeV1 = {
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    directiveId: requireString(rec.directiveId, "directiveId"),
    authorizationId: requireString(rec.authorizationId, "authorizationId"),
    agentRole: rec.agentRole,
    repositoryRoot: requireString(rec.repositoryRoot, "repositoryRoot"),
    canonicalOrigin: requireString(rec.canonicalOrigin, "canonicalOrigin"),
    baselineCommit: requireString(rec.baselineCommit, "baselineCommit"),
    allowOrdinaryForwardCommits: requireBoolean(rec.allowOrdinaryForwardCommits, "allowOrdinaryForwardCommits"),
    machineRole: requireString(rec.machineRole, "machineRole"),
    machineName: requireString(rec.machineName, "machineName"),
    systemInstanceId: typeof rec.systemInstanceId === "string" && rec.systemInstanceId.normalize("NFC") === rec.systemInstanceId
      ? rec.systemInstanceId
      : (() => { throw new DelegatedOperatorError("envelope-invalid", "systemInstanceId invalid"); })(),
    authorizedOperations,
    prohibitedOperations,
    riskClass: riskClass as RiskClassV1,
    issuedAtUtc: requireString(rec.issuedAtUtc, "issuedAtUtc"),
    expiresAtUtc: requireString(rec.expiresAtUtc, "expiresAtUtc"),
    completionLifecycle: "AWAITING_REVIEW",
    allowedLifecycleTransitions: parseEnumArray(rec.allowedLifecycleTransitions, "allowedLifecycleTransitions", AUTHORIZATION_LIFECYCLES_V1),
    gitPermissions: parseEnumArray(rec.gitPermissions, "gitPermissions", GIT_PERMISSIONS_V1) as GitPermissionV1[],
    hostPermissions: parseEnumArray(rec.hostPermissions, "hostPermissions", HOST_PERMISSIONS_V1) as HostPermissionV1[],
    rebootPolicy: {
      allowed: rb.allowed,
      maxReboots: rb.maxReboots,
      oneTimeResumeTokens: rb.oneTimeResumeTokens,
    },
    externalActionPolicy: external as ExternalActionPolicyV1,
    credentialPolicy: credential as CredentialPolicyV1,
    spendPolicy: { ceilingCents: sp.ceilingCents },
    nestedOwnerGates: parseEnumArray(rec.nestedOwnerGates, "nestedOwnerGates", NESTED_OWNER_GATES_V1) as NestedOwnerGateV1[],
    supersedesAuthorizationId: typeof rec.supersedesAuthorizationId === "string"
      ? rec.supersedesAuthorizationId
      : (() => { throw new DelegatedOperatorError("envelope-invalid", "supersedesAuthorizationId invalid"); })(),
    approvalProof: parseProof(rec.approvalProof),
  };

  // Ensure closed catalogs are complete references (lint against drift)
  void OPERATION_CLASSES_V1;
  return envelope;
}

export function isExpired(envelope: CapabilityEnvelopeV1, nowUtcIso: string): boolean {
  return Date.parse(nowUtcIso) >= Date.parse(envelope.expiresAtUtc);
}
