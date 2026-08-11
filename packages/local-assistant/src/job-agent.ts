import type { IsoTimestamp, OpaqueId, ProvenanceV1 } from "./contracts.js";
import type { OwnerKnowledgeFactV1, OwnerKnowledgeStateV1 } from "./owner-knowledge.js";

/**
 * Job / work agent (Checkpoint O) — durable application tracker + fit prep.
 * Autonomous: search prep, research, rank, draft. Gated: external application submission.
 */

export type JobApplicationStatusV1 =
  | "researching"
  | "tailoring"
  | "ready-to-apply"
  | "applied"
  | "interview"
  | "offer"
  | "rejected"
  | "withdrawn";

export interface JobApplicationV1 {
  id: OpaqueId;
  employer: string;
  title: string;
  source: string;
  url: string;
  status: JobApplicationStatusV1;
  fitScore: number | null;
  fitNotes: string;
  resumeNotes: string;
  coverDraft: string;
  interviewPrep: string;
  /**
   * Whether this application may be submitted under current Owner envelope.
   * Still requires fit/truth safety checks at submit time.
   */
  submissionAuthorized: boolean;
  provenance: ProvenanceV1;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export function buildJobApplication(
  input: Record<string, unknown>,
  context: { id: OpaqueId; now: IsoTimestamp },
): JobApplicationV1 {
  const employer = String(input.employer ?? "").trim().slice(0, 200);
  const title = String(input.title ?? "").trim().slice(0, 200);
  if (!employer) throw new Error("Job application needs an employer.");
  if (!title) throw new Error("Job application needs a title.");
  const statuses: JobApplicationStatusV1[] = [
    "researching", "tailoring", "ready-to-apply", "applied", "interview", "offer", "rejected", "withdrawn",
  ];
  const status = statuses.includes(input.status as JobApplicationStatusV1)
    ? (input.status as JobApplicationStatusV1)
    : "researching";
  let fitScore: number | null = null;
  if (input.fitScore !== undefined && input.fitScore !== null) {
    if (!Number.isSafeInteger(input.fitScore) || (input.fitScore as number) < 0 || (input.fitScore as number) > 100) {
      throw new Error("Fit score must be 0–100.");
    }
    fitScore = input.fitScore as number;
  }
  return {
    id: context.id,
    employer,
    title,
    source: String(input.source ?? "").trim().slice(0, 300),
    url: String(input.url ?? "").trim().slice(0, 2000),
    status,
    fitScore,
    fitNotes: String(input.fitNotes ?? "").trim().slice(0, 8000),
    resumeNotes: String(input.resumeNotes ?? "").trim().slice(0, 8000),
    coverDraft: String(input.coverDraft ?? "").trim().slice(0, 20_000),
    interviewPrep: String(input.interviewPrep ?? "").trim().slice(0, 20_000),
    submissionAuthorized: input.submissionAuthorized === true,
    provenance: {
      sourceType: "owner",
      sourceRef: String(input.sourceRef ?? "job.agent").slice(0, 500),
      recordedAt: context.now,
    },
    createdAt: context.now,
    updatedAt: context.now,
  };
}

/** Deterministic fit score from owner knowledge keywords vs job text — not ML magic. */
export function scoreJobFit(
  knowledge: OwnerKnowledgeStateV1 | null | undefined,
  jobText: string,
): { score: number; matched: string[]; notes: string } {
  const facts = knowledge?.facts?.filter((f) => f.enabled) ?? [];
  const hay = jobText.toLowerCase();
  const matched: string[] = [];
  for (const f of facts) {
    const tokens = `${f.title} ${f.content}`
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .filter((t) => t.length >= 4);
    for (const tok of tokens.slice(0, 40)) {
      if (hay.includes(tok) && !matched.includes(tok)) matched.push(tok);
    }
  }
  const skillFacts = facts.filter((f) => f.category === "skill" || f.category === "experience" || f.category === "employment");
  const score = Math.min(100, matched.length * 8 + (skillFacts.length ? 10 : 0));
  return {
    score,
    matched: matched.slice(0, 20),
    notes: matched.length
      ? `Keyword overlap with owner knowledge: ${matched.slice(0, 12).join(", ")}. Score is heuristic, not a guarantee.`
      : "No keyword overlap with stored owner knowledge yet. Add skills/employment facts under Knowledge.",
  };
}

export function draftCoverLetterSkeleton(app: JobApplicationV1, profileName: string, facts: readonly OwnerKnowledgeFactV1[]): string {
  const skills = facts.filter((f) => f.category === "skill" && f.enabled).slice(0, 5).map((f) => f.title);
  const role = facts.find((f) => f.category === "employment" && f.enabled);
  return [
    `DRAFT ONLY — not submitted. Review and send yourself.`,
    ``,
    `Dear ${app.employer} hiring team,`,
    ``,
    `I am writing to express interest in the ${app.title} role.`,
    profileName ? `I am ${profileName}.` : "",
    role ? `Background: ${role.title} — ${role.content.slice(0, 280)}` : "",
    skills.length ? `Relevant strengths: ${skills.join("; ")}.` : "",
    app.fitNotes ? `Fit notes: ${app.fitNotes.slice(0, 400)}` : "",
    ``,
    `I would welcome a conversation about how I can contribute.`,
    ``,
    `Sincerely,`,
    profileName || "[Your name]",
  ]
    .filter(Boolean)
    .join("\n");
}

export function interviewPrepFromKnowledge(app: JobApplicationV1, facts: readonly OwnerKnowledgeFactV1[]): string {
  const stories = facts
    .filter((f) => (f.category === "experience" || f.category === "sales-experience" || f.category === "project") && f.enabled)
    .slice(0, 5);
  return [
    `Interview prep for ${app.title} at ${app.employer} (from stored owner knowledge only):`,
    ``,
    `1. Why this role: connect your goals/preferences facts to ${app.title}.`,
    `2. Employer research: run Research for ${app.employer} (findings are not facts until you confirm).`,
    `3. Story bank:`,
    ...(stories.length
      ? stories.map((s, i) => `   ${i + 1}. ${s.title}: ${s.content.slice(0, 200)}`)
      : ["   (Add experience facts under Knowledge for richer prep.)"]),
    `4. Questions to ask them: team priorities, success in 90 days, tools/process.`,
    ``,
    `Submission remains owner-gated. AION will not apply for you.`,
  ].join("\n");
}
