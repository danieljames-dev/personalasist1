/**
 * Closed contracts for the R6.5 delegated-operator control plane.
 * Unknown roles/operations/fields fail closed at parse time.
 */

export const ENVELOPE_SCHEMA_VERSION = "aion.delegated-operator.envelope.v1" as const;

export type AgentRoleV1 = "GROK_BUILD" | "CLAUDE_AUDITOR";
export const AGENT_ROLES_V1: readonly AgentRoleV1[] = ["GROK_BUILD", "CLAUDE_AUDITOR"];

export type RiskClassV1 = "ROUTINE" | "ELEVATED_HOST" | "HIGH_CONSEQUENCE";
export const RISK_CLASSES_V1: readonly RiskClassV1[] = ["ROUTINE", "ELEVATED_HOST", "HIGH_CONSEQUENCE"];

export type OperationClassV1 =
  | "repo.read"
  | "repo.edit"
  | "test.run"
  | "npm.run"
  | "node.run"
  | "docker.test"
  | "git.status"
  | "git.diff"
  | "git.stage"
  | "git.commit_forward"
  | "git.push_canonical"
  | "powershell.read"
  | "powershell.repo_operation"
  | "temp.create"
  | "temp.delete_owned"
  | "handoff.write"
  | "host.read"
  | "host.reboot";

export const OPERATION_CLASSES_V1: readonly OperationClassV1[] = [
  "repo.read",
  "repo.edit",
  "test.run",
  "npm.run",
  "node.run",
  "docker.test",
  "git.status",
  "git.diff",
  "git.stage",
  "git.commit_forward",
  "git.push_canonical",
  "powershell.read",
  "powershell.repo_operation",
  "temp.create",
  "temp.delete_owned",
  "handoff.write",
  "host.read",
  "host.reboot",
];

export type HostPermissionV1 =
  | "elevated_readonly_security"
  | "planned_reboot"
  | "none";

export const HOST_PERMISSIONS_V1: readonly HostPermissionV1[] = [
  "elevated_readonly_security",
  "planned_reboot",
  "none",
];

export type GitPermissionV1 =
  | "read"
  | "stage"
  | "commit_forward"
  | "push_canonical"
  | "none";

export const GIT_PERMISSIONS_V1: readonly GitPermissionV1[] = [
  "read",
  "stage",
  "commit_forward",
  "push_canonical",
  "none",
];

export type ExternalActionPolicyV1 = "none" | "allowlisted_public_fetch";
export type CredentialPolicyV1 = "none" | "explicit_nested_gate_only";
export type SpendPolicyV1 = { readonly ceilingCents: number };

export type NestedOwnerGateV1 =
  | "real_owner_key"
  | "real_trust"
  | "real_writer_transition"
  | "primary_promotion_demotion"
  | "real_private_migration"
  | "credentials"
  | "sensitive_external_communication"
  | "spend"
  | "budget_increase"
  | "bitlocker"
  | "secure_boot"
  | "bios_uefi"
  | "tpm_config"
  | "destructive_data_removal"
  | "backup_destruction"
  | "external_drive_role"
  | "authority_system_modification";

export const NESTED_OWNER_GATES_V1: readonly NestedOwnerGateV1[] = [
  "real_owner_key",
  "real_trust",
  "real_writer_transition",
  "primary_promotion_demotion",
  "real_private_migration",
  "credentials",
  "sensitive_external_communication",
  "spend",
  "budget_increase",
  "bitlocker",
  "secure_boot",
  "bios_uefi",
  "tpm_config",
  "destructive_data_removal",
  "backup_destruction",
  "external_drive_role",
  "authority_system_modification",
];

export type AuthorizationLifecycleV1 =
  | "PENDING_OWNER_AUTHORIZATION"
  | "AUTHORIZED"
  | "RUNNING"
  | "REBOOT_PENDING"
  | "AWAITING_REVIEW"
  | "BLOCKED"
  | "FAILED"
  | "SUPERSEDED"
  | "DENIED"
  | "EXPIRED";

export const AUTHORIZATION_LIFECYCLES_V1: readonly AuthorizationLifecycleV1[] = [
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
];

export type ActivationModeV1 = "inactive" | "synthetic_test" | "activated";

export interface RebootPolicyV1 {
  readonly allowed: boolean;
  readonly maxReboots: number;
  readonly oneTimeResumeTokens: boolean;
}

export interface ApprovalProofV1 {
  readonly kind: "synthetic_hmac_v1" | "unprovisioned_real_v1" | "provisioned_owner_hmac_v1";
  readonly algorithm: "hmac-sha256";
  /** Hex signature over envelope digest + approval metadata. */
  readonly signatureHex: string;
  readonly approvedAtUtc: string;
  /** Opaque non-secret presence marker (never a reusable bearer secret in logs). */
  readonly presenceId: string;
}

export interface CapabilityEnvelopeV1 {
  readonly schemaVersion: typeof ENVELOPE_SCHEMA_VERSION;
  readonly directiveId: string;
  readonly authorizationId: string;
  readonly agentRole: AgentRoleV1;
  readonly repositoryRoot: string;
  readonly canonicalOrigin: string;
  readonly baselineCommit: string;
  /** When true, HEAD may advance by ordinary forward commits only. */
  readonly allowOrdinaryForwardCommits: boolean;
  readonly machineRole: string;
  readonly machineName: string;
  /** Reserved for future System Instance binding; empty string when unbound. */
  readonly systemInstanceId: string;
  readonly authorizedOperations: readonly OperationClassV1[];
  readonly prohibitedOperations: readonly OperationClassV1[];
  readonly riskClass: RiskClassV1;
  readonly issuedAtUtc: string;
  readonly expiresAtUtc: string;
  readonly completionLifecycle: "AWAITING_REVIEW";
  readonly allowedLifecycleTransitions: readonly AuthorizationLifecycleV1[];
  readonly gitPermissions: readonly GitPermissionV1[];
  readonly hostPermissions: readonly HostPermissionV1[];
  readonly rebootPolicy: RebootPolicyV1;
  readonly externalActionPolicy: ExternalActionPolicyV1;
  readonly credentialPolicy: CredentialPolicyV1;
  readonly spendPolicy: SpendPolicyV1;
  readonly nestedOwnerGates: readonly NestedOwnerGateV1[];
  readonly supersedesAuthorizationId: string;
  readonly approvalProof: ApprovalProofV1 | null;
}

export interface OperatorRequestV1 {
  readonly requestId: string;
  readonly authorizationId: string;
  readonly agentRole: AgentRoleV1;
  readonly operation: OperationClassV1;
  readonly repositoryRoot: string;
  readonly args: Readonly<Record<string, string>>;
  readonly requestedAtUtc: string;
}

export type OperatorDecisionOutcomeV1 = "ALLOW" | "REFUSE";

export interface OperatorDecisionV1 {
  readonly outcome: OperatorDecisionOutcomeV1;
  readonly reasonCode: string;
  readonly reason: string;
  readonly envelopeDigest: string | null;
  readonly operation: OperationClassV1;
  readonly agentRole: AgentRoleV1;
}

export interface OperatorAuditEventV1 {
  readonly seq: number;
  readonly eventId: string;
  readonly utc: string;
  readonly kind: string;
  readonly authorizationId: string | null;
  readonly envelopeDigest: string | null;
  readonly agentRole: AgentRoleV1 | null;
  readonly operation: OperationClassV1 | null;
  readonly outcome: string;
  readonly detail: string;
  readonly prevDigest: string;
  readonly eventDigest: string;
}

export class DelegatedOperatorError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DelegatedOperatorError";
    this.code = code;
  }
}

export function isAgentRoleV1(value: unknown): value is AgentRoleV1 {
  return typeof value === "string" && (AGENT_ROLES_V1 as readonly string[]).includes(value);
}

export function isOperationClassV1(value: unknown): value is OperationClassV1 {
  return typeof value === "string" && (OPERATION_CLASSES_V1 as readonly string[]).includes(value);
}

export function isNestedOwnerGateV1(value: unknown): value is NestedOwnerGateV1 {
  return typeof value === "string" && (NESTED_OWNER_GATES_V1 as readonly string[]).includes(value);
}
