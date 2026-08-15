/**
 * The points where a machine must stop and a person must decide.
 *
 * A gate is a durable object rather than a pause in a conversation, and that distinction is the
 * whole feature. The Owner is asked to test something on a phone; he does it four hours later, after
 * a reboot, from a different device. If the question lived in a session it is gone. If it lives in a
 * file with the mission it belongs to, the answer resumes *that* mission — not a new one that has
 * forgotten everything the first one established.
 *
 * ## What a gate stores, and why each part earns its place
 *
 * `safeFrozenState` is what was true when the question was asked; `resumeState` is where the mission
 * goes once it is answered. Keeping them separate means an answer arriving after the world has moved
 * can be detected rather than blindly applied — approving a deployment of a SHA that is no longer
 * the candidate is exactly the sort of thing that should fail loudly.
 *
 * `requiredInput` says what the Owner actually has to supply, because "approve?" with no statement
 * of what is being approved is how consent becomes a reflex.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import type { MissionStateV1 } from "./mission.js";

export const GATE_SCHEMA_V1 = "aion.director.gate.v1" as const;

/**
 * The kinds of thing a machine may not decide alone.
 *
 * Each is here because the consequence is either irreversible, costs money, exposes something, or
 * legally belongs to a person. None is here because the decision is merely difficult.
 */
export const OWNER_GATE_TYPES = [
  "PHYSICAL_IPHONE_TEST_REQUIRED",
  "SPEND_APPROVAL_REQUIRED",
  "OAUTH_REQUIRED",
  "PUBLIC_EXPOSURE_APPROVAL_REQUIRED",
  "DESTRUCTIVE_ACTION_APPROVAL_REQUIRED",
  "PRIMARY_TRANSFER_REQUIRED",
  "PRODUCTION_DEPLOY_APPROVAL_REQUIRED",
  "MAJOR_SECURITY_CHANGE_REQUIRED",
  "CREDENTIAL_STORE_REQUIRED",
  "FINANCIAL_LEGAL_REQUIRED",
  "REAL_EXTERNAL_BUSINESS_WRITE_REQUIRED",
  "UNRECOGNISED_GATE_TYPE",
] as const;

export type OwnerGateTypeV1 = (typeof OWNER_GATE_TYPES)[number];

export function isOwnerGateType(value: unknown): value is OwnerGateTypeV1 {
  return typeof value === "string" && (OWNER_GATE_TYPES as readonly string[]).includes(value);
}

export type GateStatusV1 = "OPEN" | "APPROVED" | "REJECTED" | "SUPERSEDED";

export interface OwnerGateV1 {
  schema: typeof GATE_SCHEMA_V1;
  gateId: OpaqueId;
  missionId: OpaqueId;
  type: OwnerGateTypeV1;
  status: GateStatusV1;
  /** The name the executor asked for, even when it is not an OwnerGateTypeV1. */
  requestedType: string;
  /** Why this is being asked, in the Owner's terms. Never a class name. */
  why: string;
  /** The Director's reason. Distinct from executor testimony in `why`. */
  directorReason: string;
  /** Exactly what the Owner must do or supply. */
  requiredInput: string;
  requestedAt: IsoTimestamp;
  resolvedAt: IsoTimestamp | null;
  /** What was true when the question was asked, so a late answer can be checked against now. */
  safeFrozenState: Record<string, string>;
  /** Where the mission continues once answered. */
  resumeState: MissionStateV1;
  /** The Owner's words, when they gave any. */
  ownerNote: string | null;
}

export function openGate(input: {
  gateId: OpaqueId;
  missionId: OpaqueId;
  type: OwnerGateTypeV1;
  why: string;
  requiredInput: string;
  at: IsoTimestamp;
  safeFrozenState?: Record<string, string>;
  resumeState: MissionStateV1;
  requestedType?: string;
  directorReason?: string;
}): OwnerGateV1 {
  return {
    schema: GATE_SCHEMA_V1,
    gateId: input.gateId,
    missionId: input.missionId,
    type: input.type,
    status: "OPEN",
    requestedType: input.requestedType ?? input.type,
    why: input.why,
    directorReason: input.directorReason ?? input.why,
    requiredInput: input.requiredInput,
    requestedAt: input.at,
    resolvedAt: null,
    safeFrozenState: { ...(input.safeFrozenState ?? {}) },
    resumeState: input.resumeState,
    ownerNote: null,
  };
}

/**
 * Record an Owner stop from an executor `requiresOwner` result. The
 * requested name is kept even when it is not a recognised gate type.
 * `why` is labelled executor testimony; `directorReason` is the Director's.
 */
export function ownerGateFromExecutorRefusal(input: {
  readonly gateId: OpaqueId;
  readonly missionId: OpaqueId;
  readonly at: IsoTimestamp;
  readonly requestedType: string | null;
  readonly executorSummary: string;
  readonly headAfter?: string;
  readonly branch?: string;
}): OwnerGateV1 {
  const requested = typeof input.requestedType === "string" ? input.requestedType : "";
  const type: OwnerGateTypeV1 = isOwnerGateType(requested) ? requested : "UNRECOGNISED_GATE_TYPE";
  const frozen: Record<string, string> = {};
  if (input.headAfter !== undefined && input.headAfter !== "") frozen.headAfter = input.headAfter;
  if (input.branch !== undefined && input.branch !== "") frozen.branch = input.branch;
  return openGate({
    gateId: input.gateId,
    missionId: input.missionId,
    type,
    requestedType: requested === "" ? "(absent)" : requested,
    why: `executor testimony: ${input.executorSummary || "(none)"}`,
    directorReason: "the executor set requiresOwner; the Director opened a gate and did not adopt the executor summary as its reason",
    requiredInput: "approve or reject this gate",
    at: input.at,
    safeFrozenState: frozen,
    resumeState: "WAITING_FOR_OWNER",
  });
}

export interface GateResolutionV1 {
  ok: boolean;
  gate: OwnerGateV1;
  reason: string;
  /** Set when the world moved between asking and answering. */
  staleFacts: string[];
}

/**
 * Record an answer, and notice if the ground moved underneath it.
 *
 * The staleness check is the reason `safeFrozenState` exists. An approval is consent to a specific
 * situation: approving deployment of one SHA is not approval to deploy whatever happens to be on
 * main an hour later. Where a frozen fact no longer holds, the answer is refused and the difference
 * named, rather than being applied to a world the Owner was not shown.
 */
export function resolveGate(input: {
  gate: OwnerGateV1;
  approved: boolean;
  at: IsoTimestamp;
  ownerNote?: string | null;
  /** The same facts, re-read now. */
  currentFacts?: Record<string, string>;
}): GateResolutionV1 {
  if (input.gate.status !== "OPEN") {
    return {
      ok: false,
      gate: input.gate,
      reason: `this gate was already ${input.gate.status.toLowerCase()}`,
      staleFacts: [],
    };
  }

  const staleFacts: string[] = [];
  if (input.currentFacts) {
    for (const [key, was] of Object.entries(input.gate.safeFrozenState)) {
      const now = input.currentFacts[key];
      if (now === undefined || now !== was) {
        staleFacts.push(
          now === undefined
            ? `${key}: was ${was}, now could not be read`
            : `${key}: was ${was}, now ${now}`,
        );
      }
    }
  }
  if (staleFacts.length > 0 && input.approved) {
    return {
      ok: false,
      gate: { ...input.gate, status: "SUPERSEDED", resolvedAt: input.at },
      reason: "what you were asked about has changed since the question, so the approval no longer applies",
      staleFacts,
    };
  }

  return {
    ok: true,
    gate: {
      ...input.gate,
      status: input.approved ? "APPROVED" : "REJECTED",
      resolvedAt: input.at,
      ownerNote: input.ownerNote ?? null,
    },
    reason: input.approved ? "approved" : "declined",
    staleFacts,
  };
}

/** Owner-facing sentence for a gate. Never names the enum. */
export function describeGate(gate: OwnerGateV1): string {
  return `${gate.why} — what I need from you: ${gate.requiredInput}`;
}

/** Gates still waiting, oldest first, so the dashboard shows what has been waiting longest. */
export function openGates(gates: readonly OwnerGateV1[]): OwnerGateV1[] {
  return gates
    .filter((gate) => gate.status === "OPEN")
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}
