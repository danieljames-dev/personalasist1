import {
  type AgentRoleV1,
  type CapabilityEnvelopeV1,
  type OperationClassV1,
  type NestedOwnerGateV1,
  ENVELOPE_SCHEMA_VERSION,
  NESTED_OWNER_GATES_V1,
} from "./contracts.js";
import { newAuthorizationId } from "./host.js";
import { ROLE_PROFILES_V1 } from "./roles.js";

export function buildUnsignedEnvelope(input: {
  directiveId: string;
  agentRole: AgentRoleV1;
  repositoryRoot: string;
  canonicalOrigin: string;
  baselineCommit: string;
  machineRole: string;
  machineName: string;
  authorizedOperations: readonly OperationClassV1[];
  prohibitedOperations?: readonly OperationClassV1[];
  expiresAtUtc: string;
  issuedAtUtc: string;
  riskClass?: CapabilityEnvelopeV1["riskClass"];
  spendCeilingCents?: number;
  allowReboot?: boolean;
  supersedesAuthorizationId?: string;
}): CapabilityEnvelopeV1 {
  const profile = ROLE_PROFILES_V1[input.agentRole];
  return {
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    directiveId: input.directiveId,
    authorizationId: newAuthorizationId(),
    agentRole: input.agentRole,
    repositoryRoot: input.repositoryRoot,
    canonicalOrigin: input.canonicalOrigin,
    baselineCommit: input.baselineCommit,
    allowOrdinaryForwardCommits: true,
    machineRole: input.machineRole,
    machineName: input.machineName,
    systemInstanceId: "",
    authorizedOperations: [...input.authorizedOperations],
    prohibitedOperations: [...(input.prohibitedOperations ?? [])],
    riskClass: input.riskClass ?? "ROUTINE",
    issuedAtUtc: input.issuedAtUtc,
    expiresAtUtc: input.expiresAtUtc,
    completionLifecycle: "AWAITING_REVIEW",
    allowedLifecycleTransitions: [
      "PENDING_OWNER_AUTHORIZATION",
      "AUTHORIZED",
      "RUNNING",
      "REBOOT_PENDING",
      "AWAITING_REVIEW",
      "BLOCKED",
      "FAILED",
      "SUPERSEDED",
      "DENIED",
      "EXPIRED",
    ],
    gitPermissions: [...profile.defaultGit],
    hostPermissions: [...profile.defaultHost],
    rebootPolicy: {
      allowed: input.allowReboot === true,
      maxReboots: input.allowReboot ? 3 : 0,
      oneTimeResumeTokens: true,
    },
    externalActionPolicy: "none",
    credentialPolicy: "none",
    spendPolicy: { ceilingCents: input.spendCeilingCents ?? 0 },
    nestedOwnerGates: [...NESTED_OWNER_GATES_V1] as NestedOwnerGateV1[],
    supersedesAuthorizationId: input.supersedesAuthorizationId ?? "",
    approvalProof: null,
  };
}
