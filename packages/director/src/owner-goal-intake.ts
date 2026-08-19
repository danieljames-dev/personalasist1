/**
 * The Owner types a sentence; AION decides whether that sentence is work.
 *
 * Before this, `chat.send` reached the local assistant and stopped there — that package contains no
 * reference to the roadmap at all — so "make routine roadmap work autonomous" produced a pleasant
 * reply and nothing governed. Every goal had to be translated into an implementation prompt by hand.
 *
 * ## Classification is rules, not a model
 *
 * A model asked "is this actionable?" will answer yes more often than it should, and its answer
 * cannot be tested. So classification here is a deterministic, inspectable pass over the text, and
 * the tie-break runs the safe way: anything the rules cannot place confidently is treated as a
 * question. Under-creating work is a conversation. Silently creating work from a question is a
 * system that does things nobody asked for.
 *
 * ## Intent is preserved, never improved
 *
 * `originalText` is stored byte-for-byte. The normalized form exists for matching and is never
 * presented as what the Owner said. Success criteria, constraints and urgency are extracted *only*
 * where the Owner stated them — an unstated field stays unstated rather than being inferred into
 * something plausible, because an invented acceptance criterion is how a milestone completes against
 * a goal the Owner never had.
 *
 * ## This layer executes nothing
 *
 * It classifies, records and hands off. It does not edit files, choose providers, approve gates,
 * mutate authority or call the orchestrator. Everything consequential stays behind `RoadmapPortV1`.
 */

import { createHash } from "node:crypto";

import type { ProviderIdV1 } from "./provider-bridge.js";
import type { RoadmapMilestoneV1, VerificationStepV1 } from "./roadmap-contracts.js";

export const OWNER_GOAL_SCHEMA_V1 = "aion.director.ownerGoalIntent.v1" as const;
export const OWNER_GOAL_STORE_RELATIVE_PATH = ".aion-local/owner-goals";

export const OWNER_INPUT_CLASSES_V1 = [
  "QUESTION",
  "CONTEXT_QUERY",
  "ACTIONABLE_OBJECTIVE",
  "ROADMAP_CONTINUATION",
  "OWNER_DECISION",
] as const;
export type OwnerInputClassV1 = (typeof OWNER_INPUT_CLASSES_V1)[number];

/** The only two classes that may reach roadmap planning. */
export const PLANNABLE_CLASSES_V1: readonly OwnerInputClassV1[] = ["ACTIONABLE_OBJECTIVE", "ROADMAP_CONTINUATION"];

export type AmbiguityStateV1 = "CLEAR" | "AMBIGUOUS";

export interface OwnerGoalIntentV1 {
  readonly schema: typeof OWNER_GOAL_SCHEMA_V1;
  readonly goalId: string;
  /** Exactly what the Owner typed. Never rewritten, never trimmed into a summary. */
  readonly originalText: string;
  /** Lowercased, whitespace-collapsed. For matching only; never shown as the Owner's words. */
  readonly normalizedObjective: string;
  readonly classification: OwnerInputClassV1;
  readonly classificationReason: string;
  readonly confidence: number;
  readonly ambiguity: AmbiguityStateV1;
  readonly domain: string;
  /** Only when the Owner stated it. `null` means they did not. */
  readonly urgency: string | null;
  readonly successCriteria: readonly string[];
  readonly constraints: readonly string[];
  readonly relatedMilestoneIds: readonly string[];
  readonly materiallyNew: boolean;
  readonly provenance: string;
  readonly createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Normalization and identity                                                  */
/* -------------------------------------------------------------------------- */

export function normalizeOwnerText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * A goal's id is a hash of its normalized text.
 *
 * Identity by content rather than by clock is what makes the same goal, typed twice, land on the same
 * record — across a page refresh, a second browser tab, and a server restart alike. A timestamped id
 * would need a separate deduplication pass that a restart could skip.
 */
export function goalIdFor(text: string): string {
  return `goal-${createHash("sha256").update(normalizeOwnerText(text), "utf8").digest("hex").slice(0, 16)}`;
}

/* -------------------------------------------------------------------------- */
/* Classification                                                              */
/* -------------------------------------------------------------------------- */

const INTERROGATIVES = ["what", "why", "how", "when", "where", "who", "which", "whose", "is", "are", "was", "were", "does", "do", "did", "can", "could", "should", "would", "will", "am", "have", "has"];

/** Words that make a question about AION's own state rather than about the world. */
const CONTEXT_WORDS = ["aion", "roadmap", "milestone", "working on", "status", "doing", "progress", "gate", "authority", "provider", "next"];

const ACTION_VERBS = [
  "make", "build", "add", "implement", "fix", "improve", "create", "wire", "remove", "delete",
  "refactor", "update", "enable", "disable", "change", "support", "finish", "write", "set up",
  "setup", "harden", "migrate", "replace", "rename", "extend", "reduce", "speed up", "clean up",
  "document", "test", "automate", "integrate", "expose", "hide", "show", "let",
];

const CONTINUATION_PHRASES = ["continue", "keep going", "carry on", "resume", "proceed", "go ahead", "carry it on", "next step", "keep working"];

const DECISION_PHRASES = ["authorize ", "i approve", "approved", "i authorize", "denied", "i deny", "reject", "do not proceed", "stop that"];

function startsWithAny(text: string, candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    if (text === candidate || text.startsWith(`${candidate} `)) return candidate;
  }
  return null;
}

function containsAny(text: string, candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    if (text.includes(candidate)) return candidate;
  }
  return null;
}

export interface ClassificationV1 {
  readonly classification: OwnerInputClassV1;
  readonly reason: string;
  readonly confidence: number;
  readonly ambiguity: AmbiguityStateV1;
}

/**
 * Place one piece of Owner input, deterministically.
 *
 * Order matters and is chosen so the *narrow* signals win. A message beginning with an authorization
 * phrase is a decision even though it also contains a verb; a question mark beats an imperative verb
 * appearing later in the sentence, because "should I add caching?" is a question about adding
 * caching, not an instruction to add it.
 */
export function classifyOwnerInput(text: string): ClassificationV1 {
  const raw = typeof text === "string" ? text : "";
  const normalized = normalizeOwnerText(raw);

  if (normalized === "") {
    return { classification: "QUESTION", reason: "empty input is not an instruction", confidence: 1, ambiguity: "AMBIGUOUS" };
  }

  const decision = startsWithAny(normalized, DECISION_PHRASES) ?? (normalized.startsWith("authorize ") ? "authorize " : null);
  if (decision !== null) {
    return { classification: "OWNER_DECISION", reason: `begins with the Owner decision phrase "${decision.trim()}"`, confidence: 0.95, ambiguity: "CLEAR" };
  }

  const endsWithQuestionMark = raw.trim().endsWith("?");
  const interrogative = startsWithAny(normalized, INTERROGATIVES);
  if (endsWithQuestionMark || interrogative !== null) {
    const contextWord = containsAny(normalized, CONTEXT_WORDS);
    if (contextWord !== null) {
      return {
        classification: "CONTEXT_QUERY",
        reason: `asks about AION's own state (${contextWord})`,
        confidence: 0.9,
        ambiguity: "CLEAR",
      };
    }
    return {
      classification: "QUESTION",
      reason: endsWithQuestionMark ? "ends with a question mark" : `begins with the interrogative "${interrogative}"`,
      confidence: 0.9,
      ambiguity: "CLEAR",
    };
  }

  const continuation = startsWithAny(normalized, CONTINUATION_PHRASES);
  if (continuation !== null) {
    // Only a *short* message is a bare continuation. "continue" means resume the roadmap; "continue
    // improving the matching workflow until it handles trade-ins" names work, and resuming something
    // else instead would silently discard everything after the first word.
    if (normalized.split(" ").length <= 5) {
      return { classification: "ROADMAP_CONTINUATION", reason: `asks AION to continue ("${continuation}")`, confidence: 0.9, ambiguity: "CLEAR" };
    }
    return {
      classification: "ACTIONABLE_OBJECTIVE",
      reason: `begins with "${continuation}" but names specific work rather than asking to resume`,
      confidence: 0.75,
      ambiguity: "CLEAR",
    };
  }

  const leadingVerb = startsWithAny(normalized, ACTION_VERBS);
  if (leadingVerb !== null) {
    return { classification: "ACTIONABLE_OBJECTIVE", reason: `begins with the instruction verb "${leadingVerb}"`, confidence: 0.85, ambiguity: "CLEAR" };
  }

  // "I want you to ...", "we should ...", "please ...", "let's ..." — an instruction wearing a polite
  // prefix. Requires a real verb after the prefix, so "I want a coffee" does not become a milestone.
  const prefixes = ["i want you to ", "i want to ", "i need you to ", "i need to ", "we should ", "you should ", "please ", "let's ", "lets ", "can you please "];
  for (const prefix of prefixes) {
    if (!normalized.startsWith(prefix)) continue;
    const rest = normalized.slice(prefix.length);
    const verb = startsWithAny(rest, ACTION_VERBS);
    if (verb !== null) {
      return { classification: "ACTIONABLE_OBJECTIVE", reason: `"${prefix.trim()}" followed by the instruction verb "${verb}"`, confidence: 0.8, ambiguity: "CLEAR" };
    }
  }

  // Nothing matched. This is the branch that decides what an unrecognised sentence costs, and it
  // costs a clarifying question rather than a milestone.
  return {
    classification: "QUESTION",
    reason: "no instruction verb or decision phrase was recognised; treated as something to answer rather than to do",
    confidence: 0.4,
    ambiguity: "AMBIGUOUS",
  };
}

/* -------------------------------------------------------------------------- */
/* Explicit extraction — stated only                                           */
/* -------------------------------------------------------------------------- */

const SUCCESS_MARKERS = ["so that ", "so i can ", "so i don't ", "so i do not ", "success looks like ", "done when ", "acceptance: ", "so we can "];
const CONSTRAINT_MARKERS = ["without ", "do not ", "don't ", "must not ", "never ", "no more ", "as long as "];
const URGENCY_MARKERS = ["urgent", "asap", "as soon as possible", "today", "tonight", "this week", "no rush", "when you can", "whenever", "immediately", "right now"];

function extractAfterMarkers(text: string, markers: readonly string[]): readonly string[] {
  const found: string[] = [];
  const lower = text.toLowerCase();
  for (const marker of markers) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(marker, from);
      if (at === -1) break;
      // Slice from the original text so the Owner's own casing survives into the criterion.
      const tail = text.slice(at + marker.length).split(/[.;]\s|[.;]$/)[0]?.trim() ?? "";
      if (tail !== "") found.push(`${marker.trim()} ${tail}`);
      from = at + marker.length;
    }
  }
  return found;
}

export function extractSuccessCriteria(text: string): readonly string[] {
  return extractAfterMarkers(text, SUCCESS_MARKERS);
}

export function extractConstraints(text: string): readonly string[] {
  return extractAfterMarkers(text, CONSTRAINT_MARKERS);
}

export function extractUrgency(text: string): string | null {
  const lower = text.toLowerCase();
  for (const marker of URGENCY_MARKERS) {
    if (lower.includes(marker)) return marker;
  }
  return null;
}

const DOMAIN_WORDS: readonly (readonly [string, readonly string[]])[] = [
  ["roadmap", ["roadmap", "milestone", "plan"]],
  ["app", ["app", "page", "ui", "screen", "panel", "button", "browser", "phone"]],
  ["authority", ["authoriz", "authority", "gate", "approve", "envelope", "permission"]],
  ["providers", ["provider", "model", "claude", "codex", "grok", "worker"]],
  ["context", ["context", "personal", "history", "memory"]],
  ["customers", ["customer", "matching", "sales", "lead"]],
  ["operations", ["service", "restart", "watchdog", "scheduled task", "production"]],
];

export function inferDomain(text: string): string {
  const lower = text.toLowerCase();
  for (const [domain, words] of DOMAIN_WORDS) {
    for (const word of words) {
      if (lower.includes(word)) return domain;
    }
  }
  return "unspecified";
}

/* -------------------------------------------------------------------------- */
/* Matching against work that already exists                                   */
/* -------------------------------------------------------------------------- */

function tokens(text: string): Set<string> {
  return new Set(
    normalizeOwnerText(text)
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3),
  );
}

/** Jaccard overlap of content words. Blunt on purpose: a cheap, explainable, testable measure. */
export function objectiveSimilarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Above this, an objective is treated as the same work rather than new work. */
export const DUPLICATE_SIMILARITY_THRESHOLD_V1 = 0.6;

export function findRelatedMilestones(
  text: string,
  milestones: readonly RoadmapMilestoneV1[],
): readonly { readonly milestoneId: string; readonly similarity: number }[] {
  return milestones
    .map((milestone) => ({ milestoneId: milestone.milestoneId, similarity: objectiveSimilarity(text, milestone.objective) }))
    .filter((row) => row.similarity > 0.2)
    .sort((left, right) => right.similarity - left.similarity);
}

/* -------------------------------------------------------------------------- */
/* Intent                                                                      */
/* -------------------------------------------------------------------------- */

export function buildOwnerGoalIntent(input: {
  readonly text: string;
  readonly now: string;
  readonly milestones: readonly RoadmapMilestoneV1[];
  readonly provenance?: string;
}): OwnerGoalIntentV1 {
  const text = typeof input.text === "string" ? input.text : "";
  const classification = classifyOwnerInput(text);
  const related = findRelatedMilestones(text, input.milestones);
  const duplicate = related.find((row) => row.similarity >= DUPLICATE_SIMILARITY_THRESHOLD_V1);

  return {
    schema: OWNER_GOAL_SCHEMA_V1,
    goalId: goalIdFor(text),
    originalText: text,
    normalizedObjective: normalizeOwnerText(text),
    classification: classification.classification,
    classificationReason: classification.reason,
    confidence: classification.confidence,
    ambiguity: classification.ambiguity,
    domain: inferDomain(text),
    urgency: extractUrgency(text),
    successCriteria: extractSuccessCriteria(text),
    constraints: extractConstraints(text),
    relatedMilestoneIds: related.map((row) => row.milestoneId),
    materiallyNew: duplicate === undefined,
    provenance: input.provenance ?? "Owner input via the AION app",
    createdAt: input.now,
  };
}

/* -------------------------------------------------------------------------- */
/* Planning                                                                    */
/* -------------------------------------------------------------------------- */

export type PlanKindV1 = "NOT_PLANNABLE" | "MATCHED_EXISTING" | "CREATE_MILESTONE";

export interface GoalPlanV1 {
  readonly kind: PlanKindV1;
  readonly reason: string;
  readonly matchedMilestoneId: string | null;
  readonly milestone: PlannedMilestoneV1 | null;
}

/** The shape the roadmap port seeds from. Kept separate so planning creates data, not roadmap state. */
export interface PlannedMilestoneV1 {
  readonly milestoneId: string;
  readonly title: string;
  readonly objective: string;
  readonly priority: number;
  readonly dependencies: readonly string[];
  readonly ownerAuthorizationId: string | null;
  readonly authorityEnvelopeId: string | null;
  readonly derivedFromObjective: string | null;
  readonly writeDomains: readonly string[];
  readonly allowedProviders: readonly ProviderIdV1[];
  readonly verificationSteps: readonly VerificationStepV1[];
  readonly provenance: string;
}

function titleFor(text: string): string {
  const first = text.trim().split(/[.\n]/)[0]?.trim() ?? text.trim();
  const clipped = first.length > 72 ? `${first.slice(0, 69).trimEnd()}...` : first;
  return clipped.charAt(0).toUpperCase() + clipped.slice(1);
}

/**
 * Turn one actionable goal into at most one milestone.
 *
 * At most one, deliberately. A planner that decomposes a sentence into a task tree produces work
 * nobody asked for and acceptance criteria nobody wrote; the smallest milestone that makes useful
 * progress is the honest unit, and the roadmap already knows how to add dependants later.
 */
export function planFromGoal(input: {
  readonly intent: OwnerGoalIntentV1;
  readonly milestones: readonly RoadmapMilestoneV1[];
  readonly envelopeId: string | null;
  readonly parentObjective: string | null;
  readonly writeDomains: readonly string[];
  readonly allowedProviders: readonly ProviderIdV1[];
  readonly verificationSteps: readonly VerificationStepV1[];
  readonly now: string;
}): GoalPlanV1 {
  const { intent } = input;

  if (!PLANNABLE_CLASSES_V1.includes(intent.classification)) {
    return {
      kind: "NOT_PLANNABLE",
      reason: `${intent.classification} does not create work: ${intent.classificationReason}`,
      matchedMilestoneId: null,
      milestone: null,
    };
  }
  if (intent.ambiguity === "AMBIGUOUS") {
    return {
      kind: "NOT_PLANNABLE",
      reason: "the goal was not clear enough to plan; ask rather than guess",
      matchedMilestoneId: null,
      milestone: null,
    };
  }
  if (intent.classification === "ROADMAP_CONTINUATION") {
    return {
      kind: "NOT_PLANNABLE",
      reason: "continuation resumes the existing roadmap rather than adding to it",
      matchedMilestoneId: null,
      milestone: null,
    };
  }

  const existing = input.milestones.find(
    (milestone) => objectiveSimilarity(intent.originalText, milestone.objective) >= DUPLICATE_SIMILARITY_THRESHOLD_V1,
  );
  if (existing !== undefined) {
    return {
      kind: "MATCHED_EXISTING",
      reason: `this is already on the roadmap as ${existing.milestoneId}`,
      matchedMilestoneId: existing.milestoneId,
      milestone: null,
    };
  }

  return {
    kind: "CREATE_MILESTONE",
    reason: "no existing milestone covers this objective",
    matchedMilestoneId: null,
    milestone: {
      // Derived from the goal id, so replanning the same sentence targets the same milestone.
      milestoneId: `owner-${intent.goalId.replace(/^goal-/, "")}`,
      title: titleFor(intent.originalText),
      objective: intent.originalText,
      priority: 500,
      dependencies: [],
      ownerAuthorizationId: null,
      authorityEnvelopeId: input.envelopeId,
      derivedFromObjective: input.parentObjective,
      writeDomains: [...input.writeDomains],
      allowedProviders: [...input.allowedProviders],
      verificationSteps: [...input.verificationSteps],
      provenance: `Owner goal ${intent.goalId}: ${intent.originalText}`,
    },
  };
}
