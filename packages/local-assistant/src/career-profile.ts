/**
 * Grounded career profile from Owner knowledge.
 *
 * The knowledge store holds two very different kinds of "fact". Some are curated statements with
 * descriptive titles — "Employer — U.S. Army", "Core strengths — ops and support". Others are raw
 * document bodies that ingestion filed under a category because the file mentioned work, titled
 * `owner: CLAUDE.md` or `skill: ADR-001-memory-first.md`. Both sit at high confidence, so
 * confidence alone cannot separate them.
 *
 * Answering "what are my strongest skills?" by listing the second kind would be worse than saying
 * nothing: it reads as though AION believes a README is a skill. So the selector prefers curated
 * facts and treats document dumps as supporting evidence at best, never as the answer.
 *
 * Evidence strength is reported rather than flattened. One incidental mention is not proficiency,
 * and saying so is the difference between a profile the Owner can hand to a recruiter and one they
 * have to fact-check.
 */
import type { IsoTimestamp } from "./contracts.js";

export type EvidenceStrengthV1 =
  | "DIRECTLY_EVIDENCED"
  | "REPEATEDLY_EVIDENCED"
  | "INFERRED"
  | "UNCERTAIN";

export interface OwnerKnowledgeFactLikeV1 {
  id?: string;
  category?: string;
  title?: string;
  content?: string;
  confidence?: number;
  enabled?: boolean;
  provenance?: { sourceRef?: string; recordedAt?: string } | null;
  updatedAt?: IsoTimestamp;
}

export interface CareerSkillV1 {
  area: string;
  detail: string;
  strength: EvidenceStrengthV1;
  confidence: number;
  evidence: string[];
}

export interface CareerHistoryEntryV1 {
  employer: string;
  detail: string;
  dateRange: string | null;
  confidence: number;
  evidence: string[];
}

export interface CareerProfileV1 {
  summary: string | null;
  employers: CareerHistoryEntryV1[];
  roles: string[];
  skills: CareerSkillV1[];
  credentials: string[];
  goals: string[];
  /** Things a recruiter would ask for that the store cannot currently support. */
  gaps: string[];
  factsConsidered: number;
  documentDumpsExcluded: number;
}

/**
 * A fact whose title is `owner: <file>` / `skill: <file>` is an ingested document body, not a
 * curated statement. Ingestion files these by keyword, so they carry high confidence while saying
 * nothing specific about the Owner's career.
 */
export function isDocumentDumpFact(fact: OwnerKnowledgeFactLikeV1): boolean {
  const title = String(fact.title ?? "").trim();
  if (/^(owner|skill|employment|note|doc)\s*:\s*/i.test(title)) return true;
  // Titles that are bare filenames are the same problem wearing a different hat.
  if (/\.(md|txt|json|csv|pdf|docx?|ya?ml)$/i.test(title)) return true;
  return false;
}

function evidenceRef(fact: OwnerKnowledgeFactLikeV1): string {
  const ref = fact.provenance?.sourceRef;
  return ref ? String(ref).slice(0, 120) : String(fact.title ?? "owner-knowledge").slice(0, 120);
}

function strengthFor(confidence: number, mentions: number): EvidenceStrengthV1 {
  if (mentions >= 2 && confidence >= 80) return "REPEATEDLY_EVIDENCED";
  if (confidence >= 80) return "DIRECTLY_EVIDENCED";
  if (confidence >= 60) return "INFERRED";
  return "UNCERTAIN";
}

/** Split a curated "Core strengths — a; b; c" style fact into its individual skill areas. */
function splitSkillAreas(content: string): string[] {
  return String(content ?? "")
    .split(/[;\n•]|(?:,\s(?=[a-z]))/i)
    .map((s) => s.replace(/^[\s\-–—]+/, "").trim())
    .filter((s) => s.length >= 3 && s.length <= 120);
}

const DATE_RANGE = /\b(1\d{3}|20\d{2})\s*[–—-]\s*((?:1\d{3}|20\d{2})|present|current)\b/i;

export function buildCareerProfile(
  facts: readonly OwnerKnowledgeFactLikeV1[],
  profileSummary?: string | null,
): CareerProfileV1 {
  const enabled = facts.filter((f) => f.enabled !== false);
  const dumps = enabled.filter(isDocumentDumpFact);
  const curated = enabled.filter((f) => !isDocumentDumpFact(f));

  const byCategory = (cat: string) => curated.filter((f) => String(f.category ?? "").toLowerCase() === cat);

  const employers: CareerHistoryEntryV1[] = byCategory("employer").map((f) => {
    const content = String(f.content ?? "");
    const range = content.match(DATE_RANGE);
    return {
      employer: String(f.title ?? "").replace(/^employer\s*[—-]\s*/i, "").trim() || "Unnamed employer",
      detail: content.slice(0, 400),
      // Never synthesise a date range — absent stays absent.
      dateRange: range ? range[0] : null,
      confidence: Number(f.confidence ?? 0),
      evidence: [evidenceRef(f)],
    };
  });

  const roles = byCategory("role").flatMap((f) =>
    splitSkillAreas(String(f.content ?? "")).slice(0, 8),
  );

  const skills: CareerSkillV1[] = [];
  const seen = new Map<string, CareerSkillV1>();
  for (const f of byCategory("skill")) {
    const conf = Number(f.confidence ?? 0);
    for (const area of splitSkillAreas(String(f.content ?? ""))) {
      const key = area.toLowerCase();
      const existing = seen.get(key);
      if (existing) {
        existing.evidence.push(evidenceRef(f));
        existing.strength = strengthFor(Math.max(existing.confidence, conf), existing.evidence.length);
        existing.confidence = Math.max(existing.confidence, conf);
        continue;
      }
      const skill: CareerSkillV1 = {
        area,
        detail: String(f.title ?? "").slice(0, 160),
        strength: strengthFor(conf, 1),
        confidence: conf,
        evidence: [evidenceRef(f)],
      };
      seen.set(key, skill);
      skills.push(skill);
    }
  }

  const credentials = byCategory("accomplishment").map((f) => String(f.content ?? "").slice(0, 300));
  const goals = byCategory("goal").map((f) => {
    const title = String(f.title ?? "").replace(/^goal\s*[—:-]\s*/i, "").trim();
    const detail = String(f.content ?? "").slice(0, 220).trim();
    // A goal the Owner stated uses the same sentence for title and content; joining them would
    // print it back twice.
    const same = detail.replace(/[.\s]+$/, "").toLowerCase() === title.replace(/[.\s]+$/, "").toLowerCase();
    return same || !detail ? title : `${title}: ${detail}`;
  });

  // Career-summary facts live under "employment" alongside the document dumps.
  const summaryFact = byCategory("employment").sort((a, b) => Number(b.confidence ?? 0) - Number(a.confidence ?? 0))[0];

  const gaps: string[] = [];
  if (!employers.some((e) => e.dateRange)) gaps.push("employment date ranges for some employers");
  if (!roles.length) gaps.push("specific job titles held");
  if (!credentials.length) gaps.push("certifications / education evidence");
  if (skills.length < 3) gaps.push("breadth of evidenced skills — only a few are grounded");
  gaps.push("recent accomplishments with measurable outcomes");

  return {
    summary: profileSummary?.trim() || (summaryFact ? String(summaryFact.content ?? "").slice(0, 400) : null),
    employers,
    roles: [...new Set(roles)],
    skills: skills.sort((a, b) => b.confidence - a.confidence),
    credentials,
    goals,
    gaps,
    factsConsidered: curated.length,
    documentDumpsExcluded: dumps.length,
  };
}

/** Owner-facing skills answer: what, why AION believes it, and how strongly. */
export function formatSkillsAnswer(profile: CareerProfileV1): string {
  const out: string[] = ["STRONGEST SKILLS (from stored Owner evidence)"];
  if (!profile.skills.length) {
    out.push("  No skill facts are grounded yet. Import a resume or state skills directly.");
  }
  for (const s of profile.skills.slice(0, 10)) {
    out.push(`  • ${s.area}`);
    out.push(`      evidence: ${s.strength.replace(/_/g, " ").toLowerCase()} (confidence ${s.confidence}) — ${s.detail}`);
  }
  if (profile.roles.length) out.push(`\nRoles held: ${profile.roles.join(" · ")}`);
  if (profile.credentials.length) out.push(`Credentials: ${profile.credentials.join(" | ")}`);
  out.push(`\nNot yet established: ${profile.gaps.join("; ")}.`);
  out.push(`Based on ${profile.factsConsidered} curated Owner fact(s); ${profile.documentDumpsExcluded} raw document import(s) excluded as non-specific.`);
  return out.join("\n");
}

/** Owner-facing work-history answer. Absent dates stay absent. */
export function formatWorkHistoryAnswer(profile: CareerProfileV1): string {
  const out: string[] = ["WORK HISTORY (from stored Owner evidence)"];
  if (profile.summary) out.push(`  Summary: ${profile.summary}`);
  if (!profile.employers.length) out.push("  No employer facts are grounded yet.");
  for (const e of profile.employers) {
    out.push(`  • ${e.employer}${e.dateRange ? ` (${e.dateRange})` : " (dates not established)"}`);
    out.push(`      ${e.detail}`);
  }
  if (profile.roles.length) out.push(`\nRoles held: ${profile.roles.join(" · ")}`);
  out.push(`\nNot yet established: ${profile.gaps.join("; ")}.`);
  return out.join("\n");
}

/**
 * Role-fit reasoning.
 *
 * Fit is derived from evidenced skills and stated goals only. Crucially this never implies a
 * vacancy exists — "this suits your background" and "this job is open" are different claims, and
 * conflating them would have the Owner chasing openings AION invented.
 */
export function formatJobFitAnswer(profile: CareerProfileV1): string {
  const out: string[] = ["ROLE FIT (based on your stored background — not current openings)"];
  if (!profile.skills.length && !profile.employers.length) {
    out.push("  Not enough grounded career evidence yet to reason about fit.");
    return out.join("\n");
  }

  for (const goal of profile.goals) out.push(`  Stated goal: ${goal}`);

  out.push("\n  Why your background supports it:");
  for (const s of profile.skills.slice(0, 6)) {
    out.push(`    • ${s.area} — ${s.strength.replace(/_/g, " ").toLowerCase()}`);
  }
  for (const e of profile.employers) {
    out.push(`    • ${e.employer}${e.dateRange ? ` (${e.dateRange})` : ""} — transferable experience`);
  }

  out.push("\n  Known gaps / needs confirmation:");
  for (const g of profile.gaps) out.push(`    • ${g}`);

  out.push(
    "\n  ROLE FIT is not a CURRENT OPENING. Nothing here means a job is posted or available —"
    + " no live job-search evidence is stored.",
  );
  return out.join("\n");
}
