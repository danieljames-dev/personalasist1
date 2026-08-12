/**
 * From what AION decided to what a worker may attempt.
 *
 * `CrmActionProposalV1` is already the output of a grounded pipeline — audio, transcript,
 * conversation event, resolved identity, extracted needs — and this adapter deliberately adds no
 * intelligence to it. It translates vocabulary and refuses anything it cannot translate honestly.
 * Every judgement was made upstream, where the evidence was.
 *
 * The one thing this layer does contribute is the **external link**. AION's customer id is not the
 * CRM's customer id, and nothing about a proposal tells you what Tekion calls the same person. A
 * name would — which is exactly why it must not be used. So the mapping is an explicit, recorded
 * link, and a proposal for a customer with no link is refused rather than searched for. That refusal
 * is the difference between "AION does not know who this is over there" and "AION picked the first
 * Sarah".
 *
 * Lineage is preserved rather than summarised: the proposal's `sourceRefs` are carried through
 * untouched, so the chain from a sentence in a recording to a preview on screen stays walkable in
 * both directions.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import type { CrmActionKindV1, CrmActionProposalV1 } from "./crm-action-proposal.js";
import type { BrowserTaskRefusalV1, BrowserTaskTypeV1, BrowserTaskV1 } from "./browser-task.js";
import { buildBrowserTask } from "./browser-task.js";

/**
 * A recorded correspondence between an AION relationship and a CRM record.
 *
 * `method` is retained because how a link was made determines how much it can be trusted later, and
 * a link nobody can account for is one nobody can safely un-make.
 */
export interface ExternalCustomerLinkV1 {
  workspace: string;
  /** AION relationship id. */
  relationshipRef: OpaqueId;
  /** Canonical CRM reference, e.g. `tekion:customer:C-100418`. */
  externalRef: string;
  linkedAt: IsoTimestamp;
  method: "OWNER_CONFIRMED" | "EXACT_EXTERNAL_ID";
}

export function resolveExternalCustomerRef(
  links: readonly ExternalCustomerLinkV1[],
  workspace: string,
  relationshipRef: string,
): string | null {
  // Workspace is part of the key, not a filter applied after: the same person may legitimately exist
  // in two workspaces, and a dealership task must resolve to the dealership record.
  const found = links.find((l) => l.workspace === workspace && l.relationshipRef === relationshipRef);
  return found ? found.externalRef : null;
}

/** The only proposal kinds that may become browser work at this milestone. */
const ACTION_MAP: Partial<Record<CrmActionKindV1, BrowserTaskTypeV1>> = {
  PREPARE_CALL_NOTE: "PREPARE_ADD_NOTE",
  PREPARE_FOLLOWUP: "PREPARE_CREATE_FOLLOWUP",
  PREPARE_PREFERENCE_UPDATE: "PREPARE_UPDATE_PREFERENCE",
};

export function browserTaskTypeForProposal(action: CrmActionKindV1): BrowserTaskTypeV1 | null {
  return ACTION_MAP[action] ?? null;
}

export interface ProposalToTaskInputV1 {
  proposal: CrmActionProposalV1;
  links: readonly ExternalCustomerLinkV1[];
  taskId: OpaqueId;
  requestedBy: string;
  createdAt: IsoTimestamp;
  permittedWorkspace?: string;
}

/**
 * Turn one proposal into one task, or refuse and say why.
 *
 * The payload is built per task type rather than by spreading `proposal.fields` everywhere, because
 * the three previews mean different things: a note carries prose, a follow-up carries a title and a
 * date, and a preference update carries field-by-field values that the worker will diff against what
 * the CRM currently holds.
 */
export function browserTaskFromCrmProposal(
  input: ProposalToTaskInputV1,
): BrowserTaskV1 | BrowserTaskRefusalV1 {
  const p = input.proposal;

  const taskType = browserTaskTypeForProposal(p.action);
  if (!taskType) {
    return {
      refused: true,
      code: "UNSUPPORTED_PROPOSAL_ACTION",
      reason: `${p.action} has no browser task at this milestone — only the three PREPARE kinds are mapped`,
    };
  }

  // A proposal that already carries write authority must not be quietly executed as a preview. The
  // caller asked for something this milestone does not do, and should be told so.
  if (p.authorityRequired !== "PREPARE_ONLY") {
    return {
      refused: true,
      code: "PROPOSAL_NOT_PREPARE",
      reason: `proposal ${p.proposalId} requires ${p.authorityRequired}; this worker prepares only`,
    };
  }

  const externalRef = resolveExternalCustomerRef(input.links, p.workspace, p.customerRef);
  if (!externalRef) {
    return {
      refused: true,
      code: "NO_EXTERNAL_LINK",
      reason:
        `no recorded link between AION customer ${p.customerRef} and a record in the CRM. `
        + `Link them once and this will run — searching by name is not a substitute`,
    };
  }

  const payload = payloadFor(taskType, p);

  return buildBrowserTask({
    taskId: input.taskId,
    workspaceId: p.workspace,
    appId: "tekion",
    provider: "TEKION_MOCK",
    taskType,
    authorityMode: "PREPARE_ONLY",
    customerRef: externalRef,
    proposalId: p.proposalId,
    input: payload,
    // Carried verbatim. This is the walkable chain back to the recording.
    sourceRefs: p.sourceRefs,
    confidence: p.confidence,
    expectedExternalEffect: p.expectedExternalEffect,
    idempotencyKey: p.idempotencyKey,
    approvalDigestId: null,
    requestedBy: input.requestedBy,
    createdAt: input.createdAt,
    ...(input.permittedWorkspace ? { permittedWorkspace: input.permittedWorkspace } : {}),
  });
}

function payloadFor(taskType: BrowserTaskTypeV1, p: CrmActionProposalV1): Record<string, string> {
  if (taskType === "PREPARE_ADD_NOTE") {
    return {
      content: p.note,
      noteType: p.fields.channel === "PHONE_CALL" ? "phone_call" : "note",
      ...(p.fields.occurredAt ? { occurredAt: p.fields.occurredAt } : {}),
    };
  }
  if (taskType === "PREPARE_CREATE_FOLLOWUP") {
    return {
      title: p.note,
      ...(p.fields.due ? { due: p.fields.due } : {}),
      ...(p.fields.owed ? { owed: p.fields.owed } : {}),
    };
  }
  // Preference updates pass the proposal's own fields through; the worker decides which of them the
  // CRM actually permits and reports the rest as ignored.
  return { ...p.fields };
}

/**
 * The lineage of one task, as a readable chain.
 *
 * Exists so the audit question is answerable without a join across four record types. If this cannot
 * be printed, the task should not run.
 */
export function describeTaskLineage(task: BrowserTaskV1): string {
  const parts = [
    `evidence: ${task.sourceRefs.length ? task.sourceRefs.join(" + ") : "none"}`,
    task.proposalId ? `proposal: ${task.proposalId}` : null,
    `task: ${task.taskId} (${task.taskType})`,
    `target: ${task.customerRef ?? task.vehicleRef ?? "none"}`,
    `authority: ${task.authorityMode}`,
  ].filter(Boolean);
  return parts.join(" → ");
}
