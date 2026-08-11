/**
 * Owner Authority Envelope — explicit expansion of AION-V1.3-R7.1-R9 runway.
 *
 * Not agent self-authorization. Recorded from Owner-approved expansion message.
 * Spend remains APPROVED_IN_PRINCIPLE with USD 0 until Owner sets a numeric cap.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";

export type AuthorityDirectiveIdV1 = "AION-V1.3-R7.1-R9-FUNCTIONAL-AUTONOMY-RUNWAY";

export interface SpendEnvelopeV1 {
  /** APPROVED_IN_PRINCIPLE until numeric budget provided. */
  authority: "APPROVED_IN_PRINCIPLE" | "ACTIVE" | "REVOKED";
  /** Hard total autonomous spend cap in USD. Default 0. */
  totalAutonomousSpendCapUsd: number;
  perTransactionCapUsd: number;
  allowedPurposes: string[];
  timeWindow: string;
  spentUsd: number;
}

export interface AuthorityEnvelopeV1 {
  directiveId: AuthorityDirectiveIdV1;
  /** UTC when Owner expansion message was recorded. */
  expandedAt: IsoTimestamp;
  version: 1;
  /** Category flags (Owner-approved). */
  realDataImport: boolean;
  realDealershipWalk: boolean;
  gmailOauth: boolean;
  metricoolConnect: boolean;
  emailSend: boolean;
  socialPublish: boolean;
  jobApplicationSubmit: boolean;
  businessExternal: boolean;
  spend: SpendEnvelopeV1;
  /** Kill switches — any pause blocks new external work of that class. */
  kill: {
    pauseAllExternal: boolean;
    pauseAutonomy: boolean;
    pauseEmailSend: boolean;
    pauseSocialPublish: boolean;
    pauseJobApply: boolean;
    pauseBusinessExternal: boolean;
    pauseSpend: boolean;
  };
  notes: string;
}

export type ExternalActionKindV1 =
  | "EMAIL_SENT"
  | "SOCIAL_POST_PUBLISHED"
  | "JOB_APPLICATION_SUBMITTED"
  | "EXTERNAL_BUSINESS_ACTION"
  | "MONEY_SPENT"
  | "GMAIL_OAUTH_INITIATED"
  | "METRICOOL_CONNECT_ATTEMPT"
  | "IMPORT_ROOT_APPROVED"
  | "EXTERNAL_BLOCKED";

export interface ExternalActionRecordV1 {
  id: OpaqueId | string;
  kind: ExternalActionKindV1;
  workspace: string;
  reason: string;
  evidence: string[];
  destination: string;
  result: "success" | "failed" | "blocked" | "owner_required" | "simulated";
  detail: string;
  at: IsoTimestamp;
  /** True if no network effect (audit/simulation only). */
  dryRun: boolean;
}

export function defaultAuthorityEnvelope(now: IsoTimestamp): AuthorityEnvelopeV1 {
  return {
    directiveId: "AION-V1.3-R7.1-R9-FUNCTIONAL-AUTONOMY-RUNWAY",
    expandedAt: now,
    version: 1,
    realDataImport: true,
    realDealershipWalk: true,
    gmailOauth: true,
    metricoolConnect: true,
    emailSend: true,
    socialPublish: true,
    jobApplicationSubmit: true,
    businessExternal: true,
    spend: {
      authority: "APPROVED_IN_PRINCIPLE",
      totalAutonomousSpendCapUsd: 0,
      perTransactionCapUsd: 0,
      allowedPurposes: [],
      timeWindow: "until-owner-sets-budget",
      spentUsd: 0,
    },
    kill: {
      pauseAllExternal: false,
      pauseAutonomy: false,
      pauseEmailSend: false,
      pauseSocialPublish: false,
      pauseJobApply: false,
      pauseBusinessExternal: false,
      pauseSpend: false,
    },
    notes:
      "Owner expansion 2026-08-11: real data, walk, Gmail, Metricool, send/post/apply/business external authorized. Spend USD 0 until numeric budget.",
  };
}

export function emptyExternalActionLog(): ExternalActionRecordV1[] {
  return [];
}

export type ExternalGateDecisionV1 =
  | { allowed: true; reason: string }
  | { allowed: false; reason: string; class: "KILL" | "POLICY" | "SPEND" | "DEPENDENCY" | "AMBIGUITY" };

export function evaluateExternalGate(
  envelope: AuthorityEnvelopeV1 | null | undefined,
  kind:
    | "email_send"
    | "social_publish"
    | "job_apply"
    | "business_external"
    | "spend"
    | "gmail_oauth"
    | "metricool"
    | "real_import"
    | "dealership_walk",
): ExternalGateDecisionV1 {
  const env = envelope ?? defaultAuthorityEnvelope("1970-01-01T00:00:00.000Z");
  if (env.kill.pauseAllExternal && kind !== "real_import" && kind !== "dealership_walk" && kind !== "gmail_oauth" && kind !== "metricool") {
    return { allowed: false, reason: "All external actions paused (kill switch).", class: "KILL" };
  }
  if (env.kill.pauseAutonomy && (kind === "email_send" || kind === "social_publish" || kind === "job_apply" || kind === "business_external" || kind === "spend")) {
    return { allowed: false, reason: "Autonomy paused (kill switch).", class: "KILL" };
  }

  switch (kind) {
    case "real_import":
      return env.realDataImport
        ? { allowed: true, reason: "Real data import Owner-authorized." }
        : { allowed: false, reason: "Real data import not authorized.", class: "POLICY" };
    case "dealership_walk":
      return env.realDealershipWalk
        ? { allowed: true, reason: "Real dealership walk Owner-authorized." }
        : { allowed: false, reason: "Dealership walk not authorized.", class: "POLICY" };
    case "gmail_oauth":
      return env.gmailOauth
        ? { allowed: true, reason: "Gmail OAuth Owner-authorized." }
        : { allowed: false, reason: "Gmail OAuth not authorized.", class: "POLICY" };
    case "metricool":
      return env.metricoolConnect
        ? { allowed: true, reason: "Metricool connect Owner-authorized." }
        : { allowed: false, reason: "Metricool not authorized.", class: "POLICY" };
    case "email_send":
      if (env.kill.pauseEmailSend) return { allowed: false, reason: "Email send paused.", class: "KILL" };
      return env.emailSend
        ? { allowed: true, reason: "Email send Owner-authorized with safety checks required." }
        : { allowed: false, reason: "Email send not authorized.", class: "POLICY" };
    case "social_publish":
      if (env.kill.pauseSocialPublish) return { allowed: false, reason: "Social publish paused.", class: "KILL" };
      return env.socialPublish
        ? { allowed: true, reason: "Social publish Owner-authorized with Brand DNA checks." }
        : { allowed: false, reason: "Social publish not authorized.", class: "POLICY" };
    case "job_apply":
      if (env.kill.pauseJobApply) return { allowed: false, reason: "Job apply paused.", class: "KILL" };
      return env.jobApplicationSubmit
        ? { allowed: true, reason: "Job apply Owner-authorized when fit/truth criteria pass." }
        : { allowed: false, reason: "Job apply not authorized.", class: "POLICY" };
    case "business_external":
      if (env.kill.pauseBusinessExternal) return { allowed: false, reason: "Business external paused.", class: "KILL" };
      return env.businessExternal
        ? { allowed: true, reason: "Business external Owner-authorized (no binding contracts)." }
        : { allowed: false, reason: "Business external not authorized.", class: "POLICY" };
    case "spend":
      if (env.kill.pauseSpend) return { allowed: false, reason: "Spend paused.", class: "KILL" };
      if (env.spend.authority === "REVOKED") return { allowed: false, reason: "Spend revoked.", class: "POLICY" };
      if (env.spend.totalAutonomousSpendCapUsd <= 0 || env.spend.perTransactionCapUsd <= 0) {
        return {
          allowed: false,
          reason: "SPEND_LIMIT=USD 0 until Owner sets numeric autonomous spend budget.",
          class: "SPEND",
        };
      }
      if (env.spend.spentUsd >= env.spend.totalAutonomousSpendCapUsd) {
        return { allowed: false, reason: "Total autonomous spend cap exhausted.", class: "SPEND" };
      }
      return { allowed: true, reason: "Spend within Owner budget envelope." };
    default:
      return { allowed: false, reason: "Unknown external action kind.", class: "POLICY" };
  }
}

/** Safety checks for outbound email (policy layer; transport is separate). */
export function emailSendSafetyCheck(input: {
  toAddress: string;
  toName: string;
  subject: string;
  body: string;
  workspace: string;
  relationshipId: string | null;
  reason: string;
}): ExternalGateDecisionV1 {
  if (!input.workspace?.trim()) {
    return { allowed: false, reason: "Workspace uncertain — will not send.", class: "AMBIGUITY" };
  }
  if (!input.toAddress?.includes("@") || input.toAddress.length < 5) {
    return { allowed: false, reason: "Recipient address insufficiently certain.", class: "AMBIGUITY" };
  }
  if (!input.subject?.trim() || !input.body?.trim()) {
    return { allowed: false, reason: "Empty subject/body — will not send.", class: "AMBIGUITY" };
  }
  if (!input.reason?.trim()) {
    return { allowed: false, reason: "No grounded reason for send.", class: "AMBIGUITY" };
  }
  // Block obvious high-commitment language without Owner
  if (/\b(i (hereby )?agree|binding contract|guaranteed return|wire transfer|wire \$)\b/i.test(input.body)) {
    return {
      allowed: false,
      reason: "Message appears to create major contractual/financial obligation — Owner required.",
      class: "AMBIGUITY",
    };
  }
  if (/\b(ssn|social security|password|wire to account)\b/i.test(input.body)) {
    return { allowed: false, reason: "Sensitive content blocked from autonomous send.", class: "POLICY" };
  }
  return { allowed: true, reason: "Email safety checks passed." };
}

export function jobApplySafetyCheck(input: {
  employer: string;
  title: string;
  fitScore: number | null;
  coverDraft: string;
  resumeNotes: string;
  minFitScore?: number;
}): ExternalGateDecisionV1 {
  const minFit = input.minFitScore ?? 60;
  if (!input.employer?.trim() || !input.title?.trim()) {
    return { allowed: false, reason: "Employer/title missing.", class: "AMBIGUITY" };
  }
  if (input.fitScore == null || input.fitScore < minFit) {
    return {
      allowed: false,
      reason: `Fit score ${input.fitScore ?? "null"} below threshold ${minFit} — Owner review.`,
      class: "AMBIGUITY",
    };
  }
  const blob = `${input.coverDraft} ${input.resumeNotes}`;
  if (/\b(fabricat|i invent|made up|fake degree|false employment)\b/i.test(blob)) {
    return { allowed: false, reason: "Fabrication language detected — refuse submit.", class: "POLICY" };
  }
  if (!input.coverDraft?.trim() && !input.resumeNotes?.trim()) {
    return { allowed: false, reason: "No application materials prepared.", class: "DEPENDENCY" };
  }
  return { allowed: true, reason: "Job apply safety checks passed." };
}

export function formatAuthorityEnvelopeReport(env: AuthorityEnvelopeV1): string {
  return [
    "OWNER AUTHORITY ENVELOPE",
    `Directive: ${env.directiveId}`,
    `Expanded: ${env.expandedAt}`,
    "",
    `REAL_DATA_IMPORT_AUTHORITY = ${env.realDataImport ? "AUTHORIZED" : "OFF"}`,
    `GMAIL_AUTHORITY = ${env.gmailOauth ? "AUTHORIZED" : "OFF"}`,
    `METRICOOL_AUTHORITY = ${env.metricoolConnect ? "AUTHORIZED" : "OFF"}`,
    `EMAIL_SEND_AUTHORITY = ${env.emailSend && !env.kill.pauseEmailSend ? "AUTHORIZED" : "OFF/PAUSED"}`,
    `SOCIAL_PUBLISH_AUTHORITY = ${env.socialPublish && !env.kill.pauseSocialPublish ? "AUTHORIZED" : "OFF/PAUSED"}`,
    `JOB_APPLICATION_SUBMIT_AUTHORITY = ${env.jobApplicationSubmit && !env.kill.pauseJobApply ? "AUTHORIZED" : "OFF/PAUSED"}`,
    `BUSINESS_EXTERNAL_ACTION_AUTHORITY = ${env.businessExternal && !env.kill.pauseBusinessExternal ? "AUTHORIZED" : "OFF/PAUSED"}`,
    `SPEND_AUTHORITY = ${env.spend.authority}`,
    `SPEND_LIMIT = USD ${env.spend.totalAutonomousSpendCapUsd} (per-tx ${env.spend.perTransactionCapUsd})`,
    `SPENT_USD = ${env.spend.spentUsd}`,
    "",
    "KILL SWITCHES",
    `  pauseAllExternal=${env.kill.pauseAllExternal}`,
    `  pauseAutonomy=${env.kill.pauseAutonomy}`,
    `  pauseEmailSend=${env.kill.pauseEmailSend}`,
    `  pauseSocialPublish=${env.kill.pauseSocialPublish}`,
    `  pauseJobApply=${env.kill.pauseJobApply}`,
    `  pauseBusinessExternal=${env.kill.pauseBusinessExternal}`,
    `  pauseSpend=${env.kill.pauseSpend}`,
    "",
    env.notes,
  ].join("\n");
}

export function formatExternalActionsReport(
  actions: readonly ExternalActionRecordV1[],
  dayPrefix?: string,
): string {
  const list = dayPrefix
    ? actions.filter((a) => a.at.startsWith(dayPrefix))
    : actions.slice(0, 50);
  if (!list.length) {
    return "EXTERNAL ACTIONS: none recorded for this period.";
  }
  return [
    "EXTERNAL ACTIONS",
    ...list.map(
      (a) =>
        `  • [${a.at.slice(0, 19)}] ${a.kind} · ${a.result} · ws=${a.workspace} · ${a.destination.slice(0, 60)} · ${a.reason.slice(0, 80)}`,
    ),
  ].join("\n");
}
