/**
 * Owner goals and projects, presented as answers rather than records.
 *
 * Two honesty constraints shape everything here.
 *
 * First, provenance is not decoration. Every goal currently in the system was derived by AION from
 * imported documents — none was ever stated by the Owner. Presenting those as "your goals" without
 * saying so would be AION quietly attributing its own inferences to the person it works for. So the
 * distinction between what the Owner said and what AION inferred is carried into the wording.
 *
 * Second, a project with nothing behind it should read as having nothing behind it. Every project in
 * the system is at the "idea" stage with no specification, plan, or test. The truthful answer is
 * short and slightly disappointing, and that is the answer worth giving — a summary that sounds like
 * progress would be worse than useless to someone deciding what to work on.
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
 * `provenance.sourceType` is the only trustworthy signal: "owner" means the Owner said it in so many
 * words. Everything else — including a confident-looking import — is AION's reading of a document.
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
    for (const g of stated) lines.push(`· ${g.title}${g.detail ? ` — ${trim(g.detail)}` : ""}`);
  }

  if (derived.length) {
    if (stated.length) lines.push("");
    // The phrasing matters: these are AION's readings, and the Owner should be able to correct them.
    lines.push(
      stated.length
        ? "I also worked these out from your documents — you haven't confirmed them:"
        : "You haven't told me a goal directly. From your documents, I think you're working toward:",
    );
    for (const g of derived) lines.push(`· ${g.title}${g.detail ? ` — ${trim(g.detail)}` : ""}`);
    lines.push("");
    lines.push("Tell me if that's wrong, or say \"Remember my goal is …\" to set one yourself.");
  }

  return lines.join("\n");
}

function trim(text: string, max = 220): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
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
 * `standing` is composed by the projects module from the record's own fields. Rendering it verbatim
 * is deliberate: any rewording here would be this layer inventing progress the record does not
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

  // Say plainly when nothing has moved past an idea, rather than letting a list imply momentum.
  if ([...byStage.keys()].every((s) => s.toLowerCase() === "idea")) {
    lines.push("");
    lines.push("None of these has a specification or plan yet — they're all still at the idea stage.");
  }
  return lines.join("\n");
}
