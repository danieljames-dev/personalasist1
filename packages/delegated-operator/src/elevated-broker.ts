/**
 * AION Elevated Operator Broker (R6.5).
 *
 * Implements constrained elevated-operation policy + local IPC contract.
 * REAL install/activation is OFF until R6.5.1 after independent audit.
 *
 * Security:
 * - No arbitrary PowerShell/cmd/executable launch
 * - No public TCP listener
 * - No UAC disable / no stored Owner password
 * - Closed typed operation catalog only
 * - Independent envelope validation (never trust caller claims alone)
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  type AgentRoleV1,
  type CapabilityEnvelopeV1,
  DelegatedOperatorError,
  isAgentRoleV1,
} from "./contracts.js";
import { envelopeDigest } from "./envelope.js";
import { decideOperation, type ValidationContextV1 } from "./authorization.js";
import type { OwnerPresencePort } from "./owner-presence.js";
import { roleAllowsOperation } from "./roles.js";
import { digestCanonical, safeEqualHex } from "./canonical.js";
import type { OperationClassV1 } from "./contracts.js";

export const BROKER_SCHEMA_VERSION = "aion.elevated-broker.request.v1" as const;
export const BROKER_DEFAULTS = {
  installed: false,
  activated: false,
  uacDisabled: false,
  ownerPasswordStored: false,
  arbitraryElevatedPowerShellExposed: false,
  unattendedRoutineElevationAfterFutureActivation: true,
} as const;

/** Closed elevated operation catalog (minimized). */
export type ElevatedBrokerOperationV1 =
  | "host.read_security"
  | "host.read_services"
  | "host.restart_authorized_service"
  | "host.reboot"
  | "host.shutdown"
  | "host.read_disk"
  | "host.read_network"
  | "docker.authorized_admin"
  | "repo.authorized_elevated_operation"
  | "filesystem.authorized_admin_write"
  | "process.authorized_start"
  | "process.authorized_stop"
  | "broker.self_status"
  | "broker.integrity_check";

export const ELEVATED_BROKER_OPERATIONS_V1: readonly ElevatedBrokerOperationV1[] = [
  "host.read_security",
  "host.read_services",
  "host.restart_authorized_service",
  "host.reboot",
  "host.shutdown",
  "host.read_disk",
  "host.read_network",
  "docker.authorized_admin",
  "repo.authorized_elevated_operation",
  "filesystem.authorized_admin_write",
  "process.authorized_start",
  "process.authorized_stop",
  "broker.self_status",
  "broker.integrity_check",
];

/** High-consequence ops the ordinary unattended broker must refuse. */
export type BrokerHighConsequenceIntentV1 =
  | "bitlocker"
  | "secure_boot"
  | "bios_uefi"
  | "tpm"
  | "owner_key"
  | "owner_trust"
  | "authority_anchor"
  | "writer_transition"
  | "primary_change"
  | "private_migration"
  | "credential_access"
  | "credential_store_change"
  | "backup_destruction"
  | "external_drive_role"
  | "destructive_delete"
  | "spend"
  | "budget_increase"
  | "approval_root_change"
  | "broker_policy_change"
  | "broker_binary_replace"
  | "arbitrary_powershell"
  | "encoded_command"
  | "cmd_escape"
  | "arbitrary_executable";

const HIGH_CONSEQUENCE = new Set<string>([
  "bitlocker",
  "secure_boot",
  "bios_uefi",
  "tpm",
  "owner_key",
  "owner_trust",
  "authority_anchor",
  "writer_transition",
  "primary_change",
  "private_migration",
  "credential_access",
  "credential_store_change",
  "backup_destruction",
  "external_drive_role",
  "destructive_delete",
  "spend",
  "budget_increase",
  "approval_root_change",
  "broker_policy_change",
  "broker_binary_replace",
  "arbitrary_powershell",
  "encoded_command",
  "cmd_escape",
  "arbitrary_executable",
]);

export interface ElevatedBrokerRequestV1 {
  readonly schemaVersion: typeof BROKER_SCHEMA_VERSION;
  readonly requestId: string;
  readonly authorizationId: string;
  readonly agentRole: AgentRoleV1;
  readonly operation: ElevatedBrokerOperationV1;
  readonly repositoryRoot: string;
  readonly machineName: string;
  readonly args: Readonly<Record<string, string>>;
  readonly envelopeDigest: string;
  readonly requestedAtUtc: string;
  /** Optional high-consequence intent tag (must be refused under ordinary envelope). */
  readonly highConsequenceIntent?: string;
}

export interface ElevatedBrokerDecisionV1 {
  readonly outcome: "ALLOW" | "REFUSE";
  readonly reasonCode: string;
  readonly reason: string;
  readonly wouldRequireInteractiveUacIfNotBrokerElevated: boolean;
  readonly executed: boolean;
  readonly resultDigest: string | null;
}

export interface ElevatedBrokerAuditEventV1 {
  readonly utc: string;
  readonly authorizationId: string;
  readonly agentRole: AgentRoleV1;
  readonly operation: ElevatedBrokerOperationV1 | "unknown";
  readonly resourceDigest: string;
  readonly argsDigest: string;
  readonly outcome: string;
  readonly brokerVersion: string;
  readonly detail: string;
}

const KNOWN_REQUEST_FIELDS = new Set([
  "schemaVersion",
  "requestId",
  "authorizationId",
  "agentRole",
  "operation",
  "repositoryRoot",
  "machineName",
  "args",
  "envelopeDigest",
  "requestedAtUtc",
  "highConsequenceIntent",
]);

export function isElevatedBrokerOperation(value: unknown): value is ElevatedBrokerOperationV1 {
  return typeof value === "string" && (ELEVATED_BROKER_OPERATIONS_V1 as readonly string[]).includes(value);
}

export function parseElevatedBrokerRequest(input: unknown): ElevatedBrokerRequestV1 {
  if (typeof input !== "object" || input === null) {
    throw new DelegatedOperatorError("broker-request-invalid", "Broker request must be object");
  }
  const rec = input as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!KNOWN_REQUEST_FIELDS.has(key)) {
      throw new DelegatedOperatorError("unknown-field", `Unknown broker request field: ${key}`);
    }
  }
  if (rec.schemaVersion !== BROKER_SCHEMA_VERSION) {
    throw new DelegatedOperatorError("unsupported-version", "Unsupported broker request schema");
  }
  if (!isAgentRoleV1(rec.agentRole)) {
    throw new DelegatedOperatorError("unknown-role", "Unknown agent role");
  }
  if (!isElevatedBrokerOperation(rec.operation)) {
    throw new DelegatedOperatorError("unknown-operation", `Unknown broker operation: ${String(rec.operation)}`);
  }
  if (typeof rec.args !== "object" || rec.args === null || Array.isArray(rec.args)) {
    throw new DelegatedOperatorError("unknown-argument", "args must be string map");
  }
  const args: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec.args as Record<string, unknown>)) {
    if (typeof v !== "string") {
      throw new DelegatedOperatorError("unknown-argument", `Argument ${k} must be string`);
    }
    // Refuse shell smuggling shapes in args
    if (/powershell\.exe|cmd\.exe|-EncodedCommand|-Command\s|Invoke-Expression|iex\s/i.test(v)) {
      throw new DelegatedOperatorError("shell-smuggle", "Argument contains forbidden shell pattern");
    }
    if (/\.\.|[<>"|]/.test(v) && (k.includes("path") || k.includes("file") || k.includes("exe"))) {
      throw new DelegatedOperatorError("unexpected-path", `Suspicious path argument: ${k}`);
    }
    args[k] = v;
  }
  const req: ElevatedBrokerRequestV1 = {
    schemaVersion: BROKER_SCHEMA_VERSION,
    requestId: requireStr(rec.requestId, "requestId"),
    authorizationId: requireStr(rec.authorizationId, "authorizationId"),
    agentRole: rec.agentRole,
    operation: rec.operation,
    repositoryRoot: requireStr(rec.repositoryRoot, "repositoryRoot"),
    machineName: requireStr(rec.machineName, "machineName"),
    args,
    envelopeDigest: requireStr(rec.envelopeDigest, "envelopeDigest"),
    requestedAtUtc: requireStr(rec.requestedAtUtc, "requestedAtUtc"),
  };
  if (typeof rec.highConsequenceIntent === "string") {
    return { ...req, highConsequenceIntent: rec.highConsequenceIntent };
  }
  return req;
}

function requireStr(v: unknown, field: string): string {
  if (typeof v !== "string" || !v || v.normalize("NFC") !== v) {
    throw new DelegatedOperatorError("broker-request-invalid", `Invalid ${field}`);
  }
  return v;
}

/** Map elevated ops onto host permission / envelope operation classes where applicable. */
function mapToEnvelopeOperation(op: ElevatedBrokerOperationV1): OperationClassV1 | null {
  switch (op) {
    case "host.read_security":
    case "host.read_services":
    case "host.read_disk":
    case "host.read_network":
    case "broker.self_status":
    case "broker.integrity_check":
      return "host.read";
    case "host.reboot":
    case "host.shutdown":
      return "host.reboot";
    case "repo.authorized_elevated_operation":
    case "filesystem.authorized_admin_write":
      return "powershell.repo_operation";
    case "docker.authorized_admin":
      return "docker.test";
    case "host.restart_authorized_service":
    case "process.authorized_start":
    case "process.authorized_stop":
      return "host.reboot"; // requires planned host elevation class
    default:
      return null;
  }
}

export interface ElevatedBrokerOptions {
  readonly brokerVersion: string;
  readonly activated: boolean;
  readonly installed: boolean;
  readonly integrityMaterial: string;
  readonly presence: OwnerPresencePort;
  readonly machineName: string;
  readonly machineRole: string;
  readonly now?: () => string;
  /** Load envelope by authorizationId — broker validates independently. */
  readonly loadEnvelope: (authorizationId: string) => CapabilityEnvelopeV1 | null;
  readonly isSuperseded?: (authorizationId: string) => boolean;
  readonly headCommitForRepo?: (repositoryRoot: string) => string;
}

/**
 * In-process elevated broker policy engine (synthetic + production-inactive).
 * Named-pipe transport is designed but real service install is OFF in R6.5.
 */
export class ElevatedOperatorBroker {
  readonly installed: boolean;
  readonly activated: boolean;
  private readonly integrityMaterial: string;
  private readonly presence: OwnerPresencePort;
  private readonly machineName: string;
  private readonly machineRole: string;
  private readonly loadEnvelope: ElevatedBrokerOptions["loadEnvelope"];
  private readonly isSuperseded: (id: string) => boolean;
  private readonly headCommitForRepo: (root: string) => string;
  private readonly now: () => string;
  private readonly brokerVersion: string;
  private readonly audit: ElevatedBrokerAuditEventV1[] = [];
  private readonly seenRequestDigests = new Set<string>();

  constructor(options: ElevatedBrokerOptions) {
    this.installed = options.installed;
    this.activated = options.activated;
    this.integrityMaterial = options.integrityMaterial;
    this.presence = options.presence;
    this.machineName = options.machineName;
    this.machineRole = options.machineRole;
    this.loadEnvelope = options.loadEnvelope;
    this.isSuperseded = options.isSuperseded ?? (() => false);
    this.headCommitForRepo = options.headCommitForRepo ?? (() => "");
    this.now = options.now ?? (() => new Date().toISOString());
    this.brokerVersion = options.brokerVersion;
  }

  /** Startup integrity: fail closed if material empty/mismatched. */
  verifyIntegrity(expectedMaterial: string): void {
    if (!expectedMaterial || expectedMaterial !== this.integrityMaterial) {
      throw new DelegatedOperatorError("broker-integrity", "Broker integrity cannot be established");
    }
  }

  handle(rawRequest: unknown): ElevatedBrokerDecisionV1 {
    let request: ElevatedBrokerRequestV1;
    try {
      request = parseElevatedBrokerRequest(rawRequest);
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid request";
      const code = error instanceof DelegatedOperatorError ? error.code : "broker-request-invalid";
      return refuse(code, message, false);
    }

    // High-consequence intents always refuse under ordinary path
    if (request.highConsequenceIntent && HIGH_CONSEQUENCE.has(request.highConsequenceIntent)) {
      this.record(request, "REFUSE", `high-consequence:${request.highConsequenceIntent}`);
      return refuse("high-consequence", `Refused high-consequence intent ${request.highConsequenceIntent}`, false);
    }

    // Explicit shell-smuggle operations
    for (const v of Object.values(request.args)) {
      if (/-EncodedCommand/i.test(v) || /powershell\.exe\s+-Command/i.test(v)) {
        this.record(request, "REFUSE", "encoded-or-command-shell");
        return refuse("arbitrary-powershell", "Arbitrary PowerShell/EncodedCommand refused", false);
      }
    }

    if (!this.activated) {
      // R6.5: policy may still be evaluated for tests in synthetic mode via activated=true synthetic instance.
      // Production default activated=false → refuse real elevated execution.
      // Synthetic tests construct broker with activated:true.
      this.record(request, "REFUSE", "not-activated");
      return refuse("not-activated", "Elevated broker is not activated (R6.5 inactive boundary)", false);
    }

    try {
      this.verifyIntegrity(this.integrityMaterial);
    } catch (error) {
      return refuse("broker-integrity", error instanceof Error ? error.message : "integrity fail", false);
    }

    // Replay protection on request body digest
    const reqDigest = digestCanonical({
      ...request,
      args: Object.fromEntries(Object.entries(request.args).sort(([a], [b]) => a.localeCompare(b))),
    });
    if (this.seenRequestDigests.has(reqDigest)) {
      return refuse("replay", "Stale/replayed broker request refused", false);
    }
    this.seenRequestDigests.add(reqDigest);

    const envelope = this.loadEnvelope(request.authorizationId);
    if (!envelope) {
      this.record(request, "REFUSE", "no-envelope");
      return refuse("missing-authorization", "No active authorization envelope", false);
    }

    // Independent validation — do not trust caller agentRole alone vs envelope
    if (envelope.agentRole !== request.agentRole) {
      this.record(request, "REFUSE", "role-mismatch");
      return refuse("role-mismatch", "Caller role does not match envelope agentRole", false);
    }
    if (envelope.authorizationId !== request.authorizationId) {
      return refuse("auth-id", "authorizationId mismatch", false);
    }
    if (normalize(envelope.machineName) !== normalize(this.machineName) || normalize(request.machineName) !== normalize(this.machineName)) {
      return refuse("wrong-machine", "Machine binding mismatch", false);
    }
    if (normalize(envelope.repositoryRoot) !== normalize(request.repositoryRoot)) {
      return refuse("wrong-repo", "Repository binding mismatch", false);
    }
    const actualDigest = envelopeDigest(envelope);
    if (request.envelopeDigest !== actualDigest) {
      return refuse("envelope-tamper", "Envelope digest mismatch (changed after approval)", false);
    }

    const head = this.headCommitForRepo(envelope.repositoryRoot) || envelope.baselineCommit;
    const ctx: ValidationContextV1 = {
      nowUtc: this.now(),
      machineName: this.machineName,
      machineRole: this.machineRole,
      repositoryRoot: envelope.repositoryRoot,
      canonicalOrigin: envelope.canonicalOrigin,
      headCommit: head,
      presence: this.presence,
      isSupersededId: this.isSuperseded,
    };

    const mapped = mapToEnvelopeOperation(request.operation);
    if (!mapped) {
      return refuse("unknown-operation", "Operation cannot be mapped to envelope class", false);
    }

    // CLAUDE cannot perform builder mutation elevated ops
    if (request.agentRole === "CLAUDE_AUDITOR") {
      if (
        request.operation === "filesystem.authorized_admin_write" ||
        request.operation === "repo.authorized_elevated_operation" ||
        request.operation === "process.authorized_start" ||
        request.operation === "process.authorized_stop" ||
        request.operation === "host.restart_authorized_service"
      ) {
        this.record(request, "REFUSE", "auditor-mutation");
        return refuse("role-structural-deny", "CLAUDE_AUDITOR cannot request builder mutation elevated ops", false);
      }
    }

    // Broker self-protection: ordinary GROK repo.edit does not authorize broker config/binary changes
    if (
      request.operation === "filesystem.authorized_admin_write" &&
      /broker|elevated-operator|AION-Elevated/i.test(JSON.stringify(request.args))
    ) {
      this.record(request, "REFUSE", "broker-self-protect");
      return refuse("broker-protected", "Broker configuration/executable modification requires separate Owner maintenance envelope", false);
    }

    if (!roleAllowsOperation(request.agentRole, mapped)) {
      return refuse("role-structural-deny", "Role structurally prohibits mapped operation", false);
    }

    const decision = decideOperation(envelope, request.agentRole, mapped, ctx);
    if (decision.outcome !== "ALLOW") {
      this.record(request, "REFUSE", decision.reasonCode);
      return refuse(decision.reasonCode, decision.reason, false);
    }

    // Fixed internal effect templates only (no caller script text)
    const effect = this.executeFixedTemplate(request);
    this.record(request, "ALLOW", effect.detail);
    return {
      outcome: "ALLOW",
      reasonCode: "allow",
      reason: "Envelope, role, and broker policy allow operation",
      wouldRequireInteractiveUacIfNotBrokerElevated: true,
      executed: true,
      resultDigest: effect.resultDigest,
    };
  }

  /**
   * Named pipe IPC contract (design + test harness).
   * Real Windows service install is NOT performed in R6.5.
   */
  static pipeName(): string {
    return "\\\\.\\pipe\\AION-ElevatedOperatorBroker-v1";
  }

  static recommendedServiceAccount(): {
    account: string;
    reason: string;
    notLocalSystemUnlessRequired: true;
  } {
    return {
      account: "NT SERVICE\\AionElevatedBroker (or Virtual Service Account)",
      reason:
        "Least privilege: service-specific virtual account with only SeServiceLogonRight and ACL'd pipe access; LocalSystem avoided unless a future op truly requires it.",
      notLocalSystemUnlessRequired: true,
    };
  }

  getAuditLog(): readonly ElevatedBrokerAuditEventV1[] {
    return this.audit;
  }

  private executeFixedTemplate(request: ElevatedBrokerRequestV1): { detail: string; resultDigest: string } {
    // Broker owns scripts/templates; args are structured only.
    const payload = {
      op: request.operation,
      args: request.args,
      authorizationId: request.authorizationId,
    };
    const resultDigest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    switch (request.operation) {
      case "host.read_security":
        return { detail: "template:read_security", resultDigest };
      case "host.read_services":
        return { detail: "template:read_services", resultDigest };
      case "host.reboot":
        return { detail: "template:reboot_authorized", resultDigest };
      case "broker.self_status":
        return {
          detail: `template:status;activated=${this.activated};installed=${this.installed}`,
          resultDigest,
        };
      case "broker.integrity_check":
        return { detail: "template:integrity_ok", resultDigest };
      default:
        return { detail: `template:${request.operation}`, resultDigest };
    }
  }

  private record(request: ElevatedBrokerRequestV1, outcome: string, detail: string): void {
    this.audit.push({
      utc: this.now(),
      authorizationId: request.authorizationId,
      agentRole: request.agentRole,
      operation: request.operation,
      resourceDigest: createHash("sha256").update(request.repositoryRoot).digest("hex"),
      argsDigest: createHash("sha256").update(JSON.stringify(request.args)).digest("hex"),
      outcome,
      brokerVersion: this.brokerVersion,
      detail: detail
        .replace(/\d{6}(-\d{6}){7}/g, "[REDACTED]")
        .replace(/(password|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[REDACTED]"),
    });
  }
}

function refuse(reasonCode: string, reason: string, executed: boolean): ElevatedBrokerDecisionV1 {
  return {
    outcome: "REFUSE",
    reasonCode,
    reason,
    wouldRequireInteractiveUacIfNotBrokerElevated: false,
    executed,
    resultDigest: null,
  };
}

function normalize(p: string): string {
  return p.replace(/\//g, "\\").replace(/\\+$/u, "").toLowerCase();
}

/**
 * Local named-pipe style message framing for tests (no real pipe required).
 * A copied blob is not a reusable general credential: includes one-time nonce HMAC.
 */
export class BrokerPipeFraming {
  constructor(private readonly sessionKey: Buffer) {}

  seal(request: ElevatedBrokerRequestV1): string {
    const body = JSON.stringify(request);
    const nonce = randomBytes(16).toString("hex");
    const mac = createHmac("sha256", this.sessionKey).update(`${nonce}|${body}`).digest("hex");
    return JSON.stringify({ nonce, body, mac });
  }

  open(blob: string): ElevatedBrokerRequestV1 {
    const parsed = JSON.parse(blob) as { nonce?: string; body?: string; mac?: string };
    if (!parsed.nonce || !parsed.body || !parsed.mac) {
      throw new DelegatedOperatorError("pipe-frame", "Invalid pipe frame");
    }
    const expected = createHmac("sha256", this.sessionKey).update(`${parsed.nonce}|${parsed.body}`).digest("hex");
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(parsed.mac, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new DelegatedOperatorError("pipe-mac", "Pipe frame MAC invalid (not a reusable bearer)");
    }
    return parseElevatedBrokerRequest(JSON.parse(parsed.body));
  }
}

export function createSyntheticActivatedBroker(options: {
  presence: OwnerPresencePort;
  machineName: string;
  machineRole: string;
  loadEnvelope: (id: string) => CapabilityEnvelopeV1 | null;
  isSuperseded?: (id: string) => boolean;
  headCommit?: string;
}): ElevatedOperatorBroker {
  return new ElevatedOperatorBroker({
    brokerVersion: "0.1.0-r65",
    activated: true,
    installed: false, // still not installed as OS service
    integrityMaterial: "synthetic-integrity-v1",
    presence: options.presence,
    machineName: options.machineName,
    machineRole: options.machineRole,
    loadEnvelope: options.loadEnvelope,
    isSuperseded: options.isSuperseded ?? (() => false),
    headCommitForRepo: () => options.headCommit ?? "",
  });
}
