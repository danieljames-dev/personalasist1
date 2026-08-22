/**
 * How the Owner tells AION something, and what AION is allowed to conclude from it.
 *
 * The Owner types a sentence. That is the whole input contract, deliberately: a form with a
 * confidence slider and a "verified" checkbox would let whatever is on the other side of the request
 * decide how much AION believes it, and the browser is on the other side of the request.
 *
 * So `OwnerAnswerInputV1` carries a workspace, a question and an answer, and **nothing else that
 * matters**. Everything consequential — epistemic state, source class, whether this supersedes an
 * older claim, whether it conflicts, whether a question is now resolved — is decided here, in code
 * the client cannot reach. `recordOwnerAnswer` ignores any field it was not asked for; there is no
 * path for a caller to assert `KNOWN`, name a supersession target, or set an authority id.
 *
 * An Owner statement *is* knowledge-bearing: the Owner is authoritative about their own business,
 * and a system that refused that would be unusable. But it is ranked below an official document, so
 * a certificate still outranks a recollection — which is exactly the case this project already hit.
 */

import {
  type EpistemicStateV1,
  type SensitivityV1,
} from "./business-evidence.js";
import {
  questionIdFor,
  type BusinessEvidenceStoreV1,
  type ImportPlanV1,
  type OwnerQuestionV1,
  type ProposedClaimV1,
} from "./business-evidence-store.js";
import { OWNER_QUESTION_SCHEMA_V1 } from "./business-evidence.js";

/**
 * Everything the untrusted side may say.
 *
 * Note what is absent, and that the absence is the design: no state, no confidence, no source class,
 * no supersession target, no verification flag, no authority id, no effect or permission field.
 */
export interface OwnerAnswerInputV1 {
  readonly workspaceId: string;
  /** What was asked, so the answer can be matched to a durable question. */
  readonly question: string;
  /** The Owner's own words. */
  readonly answer: string;
  /** Structured claims the Owner is asserting, subject and category only. */
  readonly claims: readonly { subject: string; claim: string; value: string }[];
}

/** Fields a caller might try to send that this path refuses to honour. Asserted by tests. */
export const OWNER_INTAKE_REJECTED_FIELDS_V1: readonly string[] = Object.freeze([
  "state",
  "epistemicState",
  "verified",
  "confidence",
  "sourceClass",
  "supersedes",
  "supersededBy",
  "authorityId",
  "ownerAuthorizationId",
  "effectScope",
  "permission",
  "sensitivity",
]);

export interface OwnerAnswerResultV1 {
  readonly plan: ImportPlanV1;
  readonly resolvedQuestionIds: readonly string[];
  /** Fields the caller sent that were ignored. Empty in normal use; loud when someone tries. */
  readonly ignoredFields: readonly string[];
}

/**
 * Record an Owner answer as evidence.
 *
 * The source class is fixed to `OWNER_STATEMENT` here and cannot be supplied. The state the Owner's
 * claims are entitled to is decided downstream by `entitledState`, and conflicts against existing
 * evidence are judged by `judgeConflict` — so an Owner recollection that disagrees with a certificate
 * lands as a conflict for a person, not as a silent overwrite.
 */
export function recordOwnerAnswer(
  store: BusinessEvidenceStoreV1,
  input: OwnerAnswerInputV1,
  now: string,
): OwnerAnswerResultV1 {
  if (String(input.workspaceId).trim() === "") throw new Error("an Owner answer must name a workspace");
  if (String(input.answer).trim() === "") throw new Error("an Owner answer must contain an answer");

  const ignoredFields = OWNER_INTAKE_REJECTED_FIELDS_V1.filter(
    (field) => Object.prototype.hasOwnProperty.call(input as unknown as Record<string, unknown>, field),
  );

  const claims: ProposedClaimV1[] = input.claims.map((claim) => ({
    subject: claim.subject,
    claim: claim.claim,
    value: claim.value,
    // The caller does not get to say. An Owner statement asserts a fact; whether it becomes one is
    // decided by source class and by what it collides with.
    asserted: "KNOWN" as EpistemicStateV1,
    sensitivity: "INTERNAL" as SensitivityV1,
    note: `Owner answer to: ${input.question}`,
  }));

  const plan = store.commitImport(input.workspaceId, {
    sourceClass: "OWNER_STATEMENT",
    reference: `Owner answer ${now}: ${input.question}`,
    readable: true,
    content: `${input.question}\n${input.answer}`,
    observedAtUtc: now,
    claims,
  }, now);

  /* Close any open question this answers. A question already closed stays closed. */
  const resolved: string[] = [];
  const answeredId = questionIdFor(input.workspaceId, input.question);
  for (const question of store.questions(input.workspaceId)) {
    if (question.questionId !== answeredId || question.resolvedAtUtc !== "") continue;
    store.saveQuestion({
      ...question,
      resolvedAtUtc: now,
      resolutionEvidenceId: plan.entries[0]?.evidenceId ?? "",
    });
    resolved.push(question.questionId);
  }

  return { plan, resolvedQuestionIds: resolved, ignoredFields };
}

/**
 * Open a durable question, or leave the existing one alone.
 *
 * Re-opening on restart is the failure this guards: the LocalFinds identity question is answered, and
 * a runtime that recreated it every boot would ask the Owner the same thing forever. A resolved
 * question is only reopened by evidence that genuinely contradicts its resolution, which is a
 * decision for the evidence layer rather than for a startup routine.
 */
export function ensureOwnerQuestion(
  store: BusinessEvidenceStoreV1,
  input: {
    workspaceId: string;
    missingFact: string;
    whyItMatters: string;
    blocking: boolean;
    evidenceNeeded: string;
  },
  now: string,
): { question: OwnerQuestionV1; created: boolean } {
  const questionId = questionIdFor(input.workspaceId, input.missingFact);
  const existing = store.questions(input.workspaceId).find((row) => row.questionId === questionId);
  if (existing !== undefined) return { question: existing, created: false };

  const question: OwnerQuestionV1 = {
    schema: OWNER_QUESTION_SCHEMA_V1,
    questionId,
    workspaceId: input.workspaceId,
    missingFact: input.missingFact,
    whyItMatters: input.whyItMatters,
    blocking: input.blocking,
    evidenceNeeded: input.evidenceNeeded,
    createdAtUtc: now,
    resolvedAtUtc: "",
    resolutionEvidenceId: "",
  };
  store.saveQuestion(question);
  return { question, created: true };
}

/** Close a question directly, for one the Owner has already settled outside an intake exchange. */
export function closeOwnerQuestion(
  store: BusinessEvidenceStoreV1,
  workspaceId: string,
  missingFact: string,
  resolutionEvidenceId: string,
  now: string,
): boolean {
  const questionId = questionIdFor(workspaceId, missingFact);
  const existing = store.questions(workspaceId).find((row) => row.questionId === questionId);
  if (existing === undefined || existing.resolvedAtUtc !== "") return false;
  store.saveQuestion({ ...existing, resolvedAtUtc: now, resolutionEvidenceId });
  return true;
}
