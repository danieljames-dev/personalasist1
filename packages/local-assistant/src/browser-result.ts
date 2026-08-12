/**
 * What a browser worker is allowed to report back.
 *
 * The result is an audit record first and a return value second. Months after a call, the Owner has
 * to be able to answer: what ran, against whom, in which workspace, on whose authority, citing what
 * evidence, and — the question that matters most — did anything actually change out there. A result
 * shape that cannot answer the last one turns every incident into an afternoon of clicking through
 * a CRM to find out.
 *
 * `externalEffect` is therefore not a convenience flag. `MockBrowserTaskResultV1` narrows it to the
 * literal `false`, so a mock handler that tried to claim an external effect would not compile. That
 * is a stronger guarantee than a test, because it holds for code nobody has written yet.
 *
 * `UNCERTAIN` is a first-class certainty state rather than a kind of failure. A submission whose
 * response was lost may or may not have landed; recording it as failed invites a retry, and the
 * retry is what turns one note into two. The only safe move is to stop and say so.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import type { BrowserAppIdV1, BrowserProviderV1, BrowserRefusalCodeV1, BrowserTaskTypeV1 } from "./browser-task.js";

export const BROWSER_RESULT_SCHEMA_V1 = "aion.browser-task-result.v1" as const;

export type BrowserResultStatusV1 =
  | "SUCCESS"
  | "BLOCKED"
  | "FAILED"
  | "UNCERTAIN_WRITE"
  | "OWNER_REQUIRED";

export type BrowserCertaintyV1 = "CERTAIN" | "UNCERTAIN";

export interface BrowserReadV1 {
  /** Stable key for what was read, e.g. `customer.header`. Never a DOM selector. */
  key: string;
  summary: string;
}

export interface BrowserProposedWriteV1 {
  field: string;
  before: string | null;
  after: string | null;
}

export interface BrowserTaskResultV1 {
  schema: typeof BROWSER_RESULT_SCHEMA_V1;
  taskId: OpaqueId;
  provider: BrowserProviderV1;
  appId: BrowserAppIdV1;
  taskType: BrowserTaskTypeV1 | string;
  workspaceId: string;
  status: BrowserResultStatusV1;
  observedAt: IsoTimestamp;
  /** What the task acted on — customer ref, VIN, proposal id. */
  targetRefs: string[];
  /** Carried through from the task, so the chain back to the audio stays intact. */
  sourceRefs: string[];
  reads: BrowserReadV1[];
  /** Structured payload for reads. Values are observations, never instructions. */
  resultData: Record<string, unknown>;
  proposedWrites: BrowserProposedWriteV1[];
  /** Empty for every result in this milestone; present so the contract is complete. */
  actualWrites: Array<{ field: string; valueRedacted: string }>;
  /** Plain language: what would happen if the Owner approved this. Null for reads. */
  preparedEffect: string | null;
  externalEffect: boolean;
  certainty: BrowserCertaintyV1;
  /** True when the Owner must check the external system before anything is retried. */
  reconciliationRequired: boolean;
  errorCode: BrowserRefusalCodeV1 | string | null;
  message: string;
  evidenceRef: string | null;
  customerRefConfirmed: OpaqueId | null;
  /** Identifies which mock view answered. Not a real page fingerprint. */
  pageFingerprint: string | null;
  durationMs: number;
  workerVersion: string;
  selectorContractVersion: string;
}

/**
 * A result that cannot claim an external effect.
 *
 * The mock worker returns this type, so the compiler — not a reviewer, and not a test — is what
 * stops a handler in this milestone from reporting that it changed something in a real system.
 */
export type MockBrowserTaskResultV1 = BrowserTaskResultV1 & { externalEffect: false; actualWrites: [] };

export const MOCK_WORKER_VERSION = "browser-mock-tekion/1.0.0" as const;
/** No real selectors exist. The version is carried so drift handling has something to compare. */
export const MOCK_SELECTOR_CONTRACT_VERSION = "mock-fixture/1" as const;

export interface BuildMockResultInputV1 {
  taskId: OpaqueId;
  appId: BrowserAppIdV1;
  provider: BrowserProviderV1;
  taskType: BrowserTaskTypeV1 | string;
  workspaceId: string;
  status: BrowserResultStatusV1;
  observedAt: IsoTimestamp;
  targetRefs?: readonly string[];
  sourceRefs?: readonly string[];
  reads?: readonly BrowserReadV1[];
  resultData?: Record<string, unknown>;
  proposedWrites?: readonly BrowserProposedWriteV1[];
  preparedEffect?: string | null;
  certainty?: BrowserCertaintyV1;
  reconciliationRequired?: boolean;
  errorCode?: string | null;
  message: string;
  customerRefConfirmed?: string | null;
  pageFingerprint?: string | null;
  durationMs?: number;
}

export function buildMockBrowserResult(input: BuildMockResultInputV1): MockBrowserTaskResultV1 {
  return {
    schema: BROWSER_RESULT_SCHEMA_V1,
    taskId: input.taskId,
    provider: input.provider,
    appId: input.appId,
    taskType: input.taskType,
    workspaceId: input.workspaceId,
    status: input.status,
    observedAt: input.observedAt,
    targetRefs: [...(input.targetRefs ?? [])],
    sourceRefs: [...(input.sourceRefs ?? [])],
    reads: [...(input.reads ?? [])],
    resultData: { ...(input.resultData ?? {}) },
    proposedWrites: [...(input.proposedWrites ?? [])],
    actualWrites: [],
    preparedEffect: input.preparedEffect ?? null,
    externalEffect: false,
    certainty: input.certainty ?? "CERTAIN",
    reconciliationRequired: input.reconciliationRequired ?? false,
    errorCode: input.errorCode ?? null,
    message: input.message,
    evidenceRef: null,
    customerRefConfirmed: input.customerRefConfirmed ?? null,
    pageFingerprint: input.pageFingerprint ?? null,
    durationMs: input.durationMs ?? 0,
    workerVersion: MOCK_WORKER_VERSION,
    selectorContractVersion: MOCK_SELECTOR_CONTRACT_VERSION,
  };
}

/** True when a result reports something the Owner has to look at before anything is retried. */
export function needsOwnerReconciliation(result: BrowserTaskResultV1): boolean {
  return result.status === "UNCERTAIN_WRITE" || result.reconciliationRequired;
}

/**
 * The audit line for one result.
 *
 * Deliberately states the external-effect answer even when it is "none". An audit that only mentions
 * effects when they happen reads as silence in the case the Owner most wants confirmed.
 */
export function describeBrowserResult(result: BrowserTaskResultV1): string {
  const target = result.targetRefs.length ? result.targetRefs.join(", ") : "no target";
  const lines = [
    `${result.taskType} — ${result.status} (${result.provider}, workspace ${result.workspaceId})`,
    `  target: ${target}`,
    `  evidence: ${result.sourceRefs.length ? result.sourceRefs.join(", ") : "none cited"}`,
  ];
  if (result.preparedEffect) lines.push(`  would do: ${result.preparedEffect}`);
  lines.push(`  external effect: ${result.externalEffect ? "YES" : "none — nothing was written anywhere"}`);
  if (result.certainty === "UNCERTAIN") {
    lines.push("  certainty: UNCERTAIN — check the system before retrying; AION will not retry on its own");
  }
  if (result.errorCode) lines.push(`  refused: ${result.errorCode} — ${result.message}`);
  return lines.join("\n");
}
