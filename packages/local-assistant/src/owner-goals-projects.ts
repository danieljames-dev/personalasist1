/**
 * Owner goals and projects, presented as answers rather than records.
 *
 * Two honesty constraints shape everything here.
 *
 * First, provenance is not decoration. Every goal currently stored was derived by AION from imported
 * career and business material — none was ever stated by the Owner. Presenting those back as "your
 * goals" would be AION quietly attributing its own inferences to the person it works for, and the
 * Owner would have no way to know which was which or what to correct. So the distinction is carried
 * into the wording itself.
 *
 * Second, a project with nothing behind it should read as having nothing behind it. Every project on
 * file is at the "idea" stage with no specification, plan, or test. The truthful answer is short and
 * slightly disappointing, and that is the answer worth giving: a summary that sounded like progress
 * would be worse than useless to someone deciding what to work on next.
 */
import type { OwnerKnowledgeFactV1 } from "./owner-knowledge.js";

export type GoalOriginV1 = "OWNER_STATED" | "DERIVED_FROM_DOCUMENTS";

export interface OwnerGoalViewV1 {
  title: string;
  detail: string;
  origin: GoalOriginV1;
  sourceRef: string;
  confidence: number;
}

/**
 * Where a goal actually came from.
 *
 * `provenance.sourceType === "owner"` is the only trustworthy signal that the Owner said it in so
 * many words. Everything else — including a confident-looking import — is AION's reading of a
 * document, and is labelled as such.
 */
export function goalOrigin(fact: Pick<OwnerKnowledgeFactV1, "provenance">): GoalOriginV1 {
  return fact.provenance?.sourceType === "owner" ? "OWNER_STATED" : "DERIVED_FROM_DOCUMENTS";
}

export function buildGoalViews(facts: readonly OwnerKnowledgeFactV1[]): OwnerGoalViewV1[] {
  return facts
    .filter((f) => f.enabled !== false && f.category === "goal")
    .map((f) => ({
      title: String(f.title ?? "").replace(/^goal\s*[—:-]\s*/i, "").trim() || "Untitled goal",
      detail: String(f.content ?? "").trim(),
      origin: goalOrigin(f),
      sourceRef: f.provenance?.sourceRef || "unknown",
      confidence: Number(f.confidence ?? 0),
    }));
}

/**
 * One goal, without saying it twice.
 *
 * A goal the Owner states arrives as a single sentence used for both title and detail, so printing
 * "title — detail" would echo it straight back doubled.
 */
function goalLine(goal: OwnerGoalViewV1): string {
  const detail = trim(goal.detail);
  const same = detail.replace(/[.\s]+$/, "").toLowerCase() === goal.title.replace(/[.\s]+$/, "").toLowerCase();
  return same || !detail ? goal.title : `${goal.title} — ${detail}`;
}

export function formatGoalsAnswer(views: readonly OwnerGoalViewV1[]): string {
  if (!views.length) {
    return [
      "I don't have any goals recorded for you yet.",
      "",
      "Tell me one and I'll keep it — for example: \"Remember my goal is to land a remote dispatcher role.\"",
    ].join("\n");
  }

  const stated = views.filter((v) => v.origin === "OWNER_STATED");
  const derived = views.filter((v) => v.origin === "DERIVED_FROM_DOCUMENTS");
  const lines: string[] = [];

  if (stated.length) {
    lines.push(stated.length === 1 ? "Your goal:" : "Your goals:");
    for (const g of stated) lines.push(`· ${goalLine(g)}`);
  }

  if (derived.length) {
    if (stated.length) lines.push("");
    // Never "you said". These came from imported career and business material and the Owner has not
    // confirmed them, so the wording has to make that correctable rather than authoritative.
    lines.push(
      stated.length
        ? "These came from your imported career and business material — you haven't confirmed them:"
        : "You haven't told me a goal directly. These are the goals I have evidence for, from imported career and business material — you haven't confirmed them:",
    );
    for (const g of derived) lines.push(`· ${goalLine(g)}`);
    lines.push("");
    lines.push("Tell me if that's wrong, or say \"Remember my goal is …\" to set one yourself.");
  }

  return lines.join("\n");
}

function trim(text: string, max = 220): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Pull an Owner-stated goal out of a capture phrase.
 *
 * Returns null when the sentence is a question about goals rather than a statement of one, so
 * "What are my goals?" is never stored as a goal called "what are my goals".
 */
export function parseGoalCapture(text: string): string | null {
  const raw = String(text ?? "").trim();
  if (/^\s*(what|which|show|list|do i|have i)\b/i.test(raw)) return null;
  const m =
    raw.match(/\b(?:remember\s+(?:that\s+)?)?my\s+goal\s+is\s*(?:to\s+)?[:\-]?\s*(.+)$/i)
    ?? raw.match(/\b(?:add|set)\s+(?:a\s+)?goal\b\s*(?:to\s+)?[:\-]?\s*(.+)$/i);
  const statement = m?.[1]?.trim().replace(/[.\s]+$/, "");
  return statement && statement.length >= 3 ? statement : null;
}

export interface ProjectViewV1 {
  title: string;
  stage: string;
  /** Precomputed narrative from the project record. Rendered verbatim; never re-summarised. */
  standing: string;
  createdAt: string;
}

/**
 * Present projects without inflating them.
 *
 * `standing` is composed by the projects module from the record's own fields, and is rendered
 * verbatim on purpose: any rewording here would be this layer inventing progress the record does not
 * claim.
 */
export function formatProjectsAnswer(projects: readonly ProjectViewV1[]): string {
  if (!projects.length) {
    return [
      "I don't have any projects recorded.",
      "",
      "If you're working on something you want tracked, tell me what you're building and I'll start a record.",
    ].join("\n");
  }

  const byStage = new Map<string, ProjectViewV1[]>();
  for (const p of projects) {
    const list = byStage.get(p.stage) ?? [];
    list.push(p);
    byStage.set(p.stage, list);
  }

  const lines: string[] = [];
  lines.push(projects.length === 1 ? "You have one project on file:" : `You have ${projects.length} projects on file:`);
  for (const [stage, list] of byStage) {
    lines.push("");
    lines.push(`${stage.toUpperCase()} (${list.length})`);
    for (const p of list) {
      lines.push(`· ${p.title}`);
      if (p.standing) lines.push(`  ${trim(p.standing, 300)}`);
    }
  }

  // Say plainly when nothing has moved past an idea, rather than letting a tidy list imply momentum.
  if ([...byStage.keys()].every((s) => s.toLowerCase() === "idea")) {
    lines.push("");
    lines.push("None of these has a specification or plan yet — they're all still at the idea stage.");
  }

  // Duplicate titles are a real artefact of repeated prompts; naming it is more useful than hiding it.
  const titles = projects.map((p) => p.title.toLowerCase());
  const dupes = new Set(titles.filter((t, i) => titles.indexOf(t) !== i));
  if (dupes.size) {
    lines.push("");
    lines.push(`Some of these look like duplicates of the same idea (${[...dupes].join(", ")}) — say the word and I'll tidy them up.`);
  }
  return lines.join("\n");
}
