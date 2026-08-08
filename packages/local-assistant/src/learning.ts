import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import type { KnowledgeClaimV1 } from "./knowledge.js";
import { claimClassPolicy, settledClaims } from "./knowledge.js";

/**
 * The learning loop.
 *
 * AION learns by accumulating typed, provenance-backed records outside any model, not by the model
 * getting better at remembering. That is the whole design: swap the model and nothing AION learned
 * is lost, because none of it was ever inside the model.
 *
 * The unit of learning is a lesson: something that turned out to be worth knowing, with the
 * evidence it came from attached and its class stated. A model may propose one. It may not decide
 * that its own guess is now how things are done, which is the failure this file exists to prevent.
 *
 * Fine-tuning is not how AION learns and is not required for it to learn. The adaptation port at
 * the bottom of this file is a declared future boundary and nothing implements it: no owner data is
 * ever used for training without a separate explicit authorisation and an auditable manifest.
 */

export type LessonScopeV1 = "general" | "workspace" | "relationship" | "opportunity" | "project";

export interface LessonOutcomeV1 {
  at: IsoTimestamp;
  /** Did following this lesson help? Recorded whichever way it went. */
  result: "worked" | "did-not-work" | "mixed" | "not-applicable";
  detail: string;
}

/**
 * One durable lesson.
 *
 * `claim` carries the class, so the same distinction that governs Product Studio governs learning:
 * an inference proposed by a model is stored as an inference, and only the owner can turn it into
 * a learned strategy or an owner-confirmed fact.
 */
export interface LessonV1 {
  id: OpaqueId;
  workspace: string;
  scope: LessonScopeV1;
  /** What the lesson is about, when it is scoped to something specific. */
  subjectRef: string | null;
  claim: KnowledgeClaimV1;
  /** What to do differently. Empty for a lesson that is an observation rather than a practice. */
  guidance: string;
  /** Outcomes recorded from actually following it. Append-only. */
  outcomes: LessonOutcomeV1[];
  /** Off means AION stops offering it, without pretending it was never learned. */
  enabled: boolean;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

function fail(message: string): never { throw new Error(message); }

function text(value: unknown, label: string, max: number, required = true): string {
  if (value === undefined || value === null || value === "") { if (required) fail(`${label} is required.`); return ""; }
  if (typeof value !== "string" || value.length > max) fail(`${label} is invalid.`);
  const trimmed = value.trim();
  if (required && !trimmed) fail(`${label} is required.`);
  return trimmed;
}

export const LESSON_SCOPES: readonly LessonScopeV1[] = ["general", "workspace", "relationship", "opportunity", "project"];

export function buildLesson(
  input: Record<string, unknown>,
  context: { id: OpaqueId; claim: KnowledgeClaimV1; now: IsoTimestamp },
): LessonV1 {
  const scope = LESSON_SCOPES.includes(input.scope as LessonScopeV1) ? input.scope as LessonScopeV1 : "general";
  const subjectRef = input.subjectRef === undefined || input.subjectRef === null || input.subjectRef === ""
    ? null
    : text(input.subjectRef, "Lesson subject", 200);
  if (scope !== "general" && scope !== "workspace" && !subjectRef) {
    fail(`A ${scope} lesson must name what it is about.`);
  }
  return {
    id: context.id,
    workspace: context.claim.workspace,
    scope,
    subjectRef,
    claim: context.claim,
    guidance: text(input.guidance, "Lesson guidance", 4000, false),
    outcomes: [],
    enabled: true,
    createdAt: context.now,
    updatedAt: context.now,
  };
}

/**
 * Records what happened when the lesson was followed.
 *
 * "Did not work" is a first-class outcome and is never quietly dropped. A lesson that keeps
 * failing should look like a lesson that keeps failing, which is what `lessonStanding` below
 * reports rather than leaving the owner to notice.
 */
export function recordLessonOutcome(lesson: LessonV1, input: Record<string, unknown>, now: IsoTimestamp): LessonV1 {
  const results: readonly LessonOutcomeV1["result"][] = ["worked", "did-not-work", "mixed", "not-applicable"];
  const result = results.includes(input.result as LessonOutcomeV1["result"]) ? input.result as LessonOutcomeV1["result"] : fail(`An outcome must be one of: ${results.join(", ")}.`);
  const next = structuredClone(lesson);
  next.outcomes.push({ at: now, result, detail: text(input.detail, "Outcome detail", 2000, false) });
  if (next.outcomes.length > 200) next.outcomes = next.outcomes.slice(-200);
  next.updatedAt = now;
  return next;
}

export interface LessonStandingV1 {
  lessonId: OpaqueId;
  worked: number;
  didNotWork: number;
  mixed: number;
  /** Whether AION should still be offering this. False once the record argues against it. */
  stillRecommended: boolean;
  summary: string;
}

/**
 * How a lesson is actually doing.
 *
 * A lesson with more failures than successes stops being recommended, and says so, rather than
 * persisting because it was written down once. Learning that cannot be unlearned is not learning.
 */
export function lessonStanding(lesson: LessonV1): LessonStandingV1 {
  const worked = lesson.outcomes.filter((entry) => entry.result === "worked").length;
  const didNotWork = lesson.outcomes.filter((entry) => entry.result === "did-not-work").length;
  const mixed = lesson.outcomes.filter((entry) => entry.result === "mixed").length;
  const tried = worked + didNotWork + mixed;
  const stillRecommended = lesson.enabled && (tried === 0 || worked >= didNotWork);
  const summary = !lesson.enabled
    ? "You turned this lesson off. It is kept so the history is intact, but AION does not offer it."
    : tried === 0
      ? "Never actually tried. It is a suggestion, not a track record."
      : worked >= didNotWork
        ? `Followed ${tried} time(s): ${worked} worked, ${didNotWork} did not${mixed ? `, ${mixed} mixed` : ""}.`
        : `Followed ${tried} time(s) and it has failed more often than it has worked (${didNotWork} against ${worked}). AION has stopped recommending it.`;
  return { lessonId: lesson.id, worked, didNotWork, mixed, stillRecommended, summary };
}

/**
 * The lessons AION will actually offer for a piece of work.
 *
 * Workspace-scoped like everything else, filtered to what is still recommended, and ordered so a
 * lesson with a real track record comes before one that has never been tried. A model's unpromoted
 * proposal is included but is never presented as settled — its class travels with it.
 */
export function applicableLessons(
  lessons: readonly LessonV1[],
  scope: { workspace: string; kind?: LessonScopeV1; subjectRef?: string },
): Array<LessonV1 & { standing: LessonStandingV1 }> {
  return lessons
    .filter((lesson) => lesson.workspace === scope.workspace)
    .filter((lesson) => !scope.kind || lesson.scope === "general" || lesson.scope === scope.kind)
    .filter((lesson) => !scope.subjectRef || !lesson.subjectRef || lesson.subjectRef === scope.subjectRef)
    .map((lesson) => ({ ...structuredClone(lesson), standing: lessonStanding(lesson) }))
    .filter((lesson) => lesson.standing.stillRecommended)
    .sort((a, b) => (b.standing.worked - b.standing.didNotWork) - (a.standing.worked - a.standing.didNotWork)
      || a.claim.statement.localeCompare(b.claim.statement));
}

/**
 * An honest account of what AION has actually learned.
 *
 * Deliberately separates what has been confirmed from what a model merely suggested, because a
 * count of "lessons learned" that mixes the two is the kind of number that flatters a system into
 * looking cleverer than it is.
 */
export function learningSummary(lessons: readonly LessonV1[]): {
  total: number; confirmed: number; proposed: number; retired: number; summary: string;
} {
  const live = lessons.filter((lesson) => lesson.enabled);
  const confirmed = settledClaims(live.map((lesson) => lesson.claim)).length
    + live.filter((lesson) => lesson.claim.class === "learned-strategy").length;
  const retired = lessons.length - live.length + live.filter((lesson) => !lessonStanding(lesson).stillRecommended).length;
  const proposed = live.length - confirmed;
  return {
    total: lessons.length, confirmed, proposed, retired,
    summary: lessons.length === 0
      ? "AION has learned nothing yet. It will not pretend otherwise."
      : `${confirmed} confirmed lesson(s) and ${proposed} still only proposed${retired ? `, with ${retired} retired or turned off` : ""}. The proposed ones are suggestions AION has not verified.`,
  };
}

/**
 * The adaptation boundary.
 *
 * Declared, not implemented. Fine-tuning is never required for AION to learn — the first learning
 * mechanism is everything above this comment — and nothing in this repository trains on owner data.
 * If that ever changes it needs its own authorisation and a manifest naming every record used, and
 * this constant is where the rule is written down so a future change has to argue with it.
 */
export const ADAPTATION_BOUNDARY = {
  implemented: false,
  mechanisms: ["adapters", "LoRA", "task-specific fine-tuning", "retrieval augmentation", "prompt and policy adaptation"],
  requiresSeparateAuthorization: true,
  requiresDatasetManifest: true,
  statement: "AION does not fine-tune anything and does not train on your data. Learning happens in explicit records outside the model, so replacing the model loses none of it. Any future training would need its own authorisation and an auditable manifest naming every record used.",
} as const;

/** Guard for the boundary above: refuses to describe training as something AION does. */
export function assertNoOwnerDataTraining(request: { usesOwnerData: boolean; authorized: boolean; manifestRef: string }): void {
  if (!request.usesOwnerData) return;
  if (!request.authorized || !request.manifestRef.trim()) {
    fail("Training on owner data requires a separate explicit authorisation and a dataset manifest naming every record used. AION has neither, so it refuses.");
  }
  fail("AION does not implement training. The adaptation boundary is declared so a future change has to be deliberate, not so it can be assumed already present.");
}

/** The class a lesson may hold, mirroring the knowledge rules rather than restating them. */
export function assertLessonClaimClass(claim: KnowledgeClaimV1): void {
  const policy = claimClassPolicy(claim.class);
  if (policy.class === "evidence") fail("A lesson is something learned, not the artefact it came from. Cite the evidence rather than storing it as the lesson.");
}
