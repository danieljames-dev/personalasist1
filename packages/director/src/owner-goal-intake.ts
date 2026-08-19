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

import {
  describeConsequences,
  detectRequestedConsequences,
  hasAnyConsequence,
} from "./consequence-model.js";
import { assessOwnerBoundaries, describeBoundaries } from "./owner-boundary-detection.js";
import type { ProviderIdV1 } from "./provider-bridge.js";
import type {
  ExternalEffectClassV1,
  ReversibilityClassV1,
  RiskClassV1,
  RoadmapMilestoneV1,
  VerificationStepV1,
} from "./roadmap-contracts.js";

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

/**
 * The only class that may reach roadmap planning.
 *
 * `ROADMAP_CONTINUATION` used to be here and was a lie: it entered planning and then returned
 * `NOT_PLANNABLE`, so a semantic type advertised behaviour nothing performed. Continuing the roadmap
 * is `roadmap.continue`, a separate verb with its own authority path. A classification that claims to
 * resume work and does not is worse than no classification, because it reads as wired.
 */
export const PLANNABLE_CLASSES_V1: readonly OwnerInputClassV1[] = ["ACTIONABLE_OBJECTIVE"];

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
  // Added after an independent review: "Publish this announcement externally" was classified as a
  // question purely because no rule recognised "publish", and it looked like a safe refusal. It was
  // an accident. A missing verb is not a guardrail — the sentence is plainly an instruction, and it
  // must become a milestone the boundary detector can then gate.
  "publish", "post", "send", "deploy", "grant", "install", "upgrade", "connect", "apply", "purchase",
  "buy", "subscribe", "erase", "wipe", "drop", "revoke", "reset", "restore",
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

  /*
   * Imperative shape, for instructions whose verb is not in the list above.
   *
   * An independent review found "Loosen Windows security.", "Purge the old recovery copies." and
   * "Give AION access to my inbox." all classified as questions — not because anything judged them
   * safe, but because no rule recognised the verb. A refusal that happens by accident looks exactly
   * like a refusal that happens on purpose, and only one of them survives the next paraphrase.
   *
   * An English imperative is a sentence that starts with its verb. Detecting that structurally
   * catches verbs no list will ever hold. The confidence is deliberately lower than a recognised
   * verb's, and this creates a *proposal* — a typed goal has no lineage, so it gates either way.
   * Expanding the classifier therefore widens what AION will discuss, never what it will do.
   */
  const ADVERBS = ["just", "please", "also", "now", "then", "quickly", "simply", "actually", "really", "kindly", "maybe", "perhaps"];
  let head = normalized;
  for (;;) {
    const adverb = ADVERBS.find((word) => head.startsWith(`${word} `));
    if (adverb === undefined) break;
    head = head.slice(adverb.length + 1);
  }
  // Words that begin a statement rather than an instruction. A sentence opening with one of these is
  // describing something, not asking for it.
  const NON_IMPERATIVE_STARTERS = [
    "the", "a", "an", "this", "that", "these", "those", "it", "there", "here",
    "my", "our", "your", "his", "her", "their", "its",
    "i", "we", "you", "he", "she", "they", "someone", "nobody", "everything", "nothing",
    "and", "but", "or", "so", "because", "if", "when", "while", "although", "since",
    "not", "no", "yes", "ok", "okay", "thanks", "hi", "hello",
  ];
  const firstWord = head.split(/[^a-z']+/).filter(Boolean)[0] ?? "";
  if (firstWord !== "" && !NON_IMPERATIVE_STARTERS.includes(firstWord)) {
    return {
      classification: "ACTIONABLE_OBJECTIVE",
      reason: `read as an imperative because the sentence begins with "${firstWord}"; not a recognised instruction verb, so this is a proposal for Owner review`,
      confidence: 0.55,
      ambiguity: "CLEAR",
    };
  }

  // Nothing matched, and the sentence does not even have the shape of an instruction. This is the
  // branch that decides what an unrecognised statement costs, and it costs a clarifying question.
  return {
    classification: "QUESTION",
    reason: "no instruction verb, decision phrase or imperative shape was recognised; treated as something to answer rather than to do",
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
  readonly derivedFromMilestoneId: string | null;
  readonly derivedFromObjective: string | null;
  readonly writeDomains: readonly string[];
  readonly allowedProviders: readonly ProviderIdV1[];
  readonly verificationSteps: readonly VerificationStepV1[];
  /** Read from the Owner's own words, never from a planner default. Only ever raises consequence. */
  readonly riskClasses: readonly RiskClassV1[];
  readonly externalEffectClass: ExternalEffectClassV1;
  readonly reversibilityClass: ReversibilityClassV1;
  readonly authorityClass: "ROUTINE" | "MILESTONE_AUTHORIZED" | "HIGH_CONSEQUENCE";
  readonly boundaries: readonly string[];
  readonly provenance: string;
}

/**
 * Explicit, durable lineage supplied by whoever recorded the parent relation.
 *
 * There is deliberately no way to compute this from an Owner sentence. The failure that made this
 * repair necessary was a selector that found "some active compatible envelope" and stamped it onto
 * whatever had just been typed; lineage that a planner can synthesise is not lineage.
 */
export interface GoalLineageV1 {
  readonly envelopeId: string;
  readonly parentMilestoneId: string;
  readonly parentObjective: string;
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
  /** Explicit recorded lineage, or `null` — which is the normal case for a sentence typed into Ask. */
  readonly lineage: GoalLineageV1 | null;
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

  /*
   * Match against *every* milestone, including gated and blocked ones.
   *
   * The bypass this closes: a milestone sitting in `WAITING_OWNER_AUTHORIZATION` could be restated in
   * different words, and the restatement created a fresh `owner-<hash>` sibling that was not the
   * gated node and so was not gated. Rephrasing is not a decision, and it must not act like one.
   */
  const existing = input.milestones.find(
    (milestone) => objectiveSimilarity(intent.originalText, milestone.objective) >= DUPLICATE_SIMILARITY_THRESHOLD_V1,
  );
  if (existing !== undefined) {
    return {
      kind: "MATCHED_EXISTING",
      reason: existing.status === "WAITING_OWNER_AUTHORIZATION" || existing.status === "BLOCKED"
        ? `this is already on the roadmap as ${existing.milestoneId}, and it is ${existing.status}`
        : `this is already on the roadmap as ${existing.milestoneId}`,
      matchedMilestoneId: existing.milestoneId,
      milestone: null,
    };
  }

  /*
   * Consequence comes from the Owner's words, never from a default.
   *
   * The review failure was exactly this step missing: the planner filled in `riskClasses: []`,
   * `REPOSITORY_REVERSIBLE`, `spendCapUsd: 0`, and those defaults were then measured against the
   * envelope's ceilings and found to fit. They fit because they described nothing.
   */
  const assessment = assessOwnerBoundaries(intent.originalText);
  /*
   * Two independent readings, and the union of them.
   *
   * The lexical pass catches named boundaries; the structured pass reads action × target and flags
   * what it cannot resolve. Where they disagree the more restrictive wins, because the failure this
   * guards is one reader missing a paraphrase the other caught.
   */
  const consequences = detectRequestedConsequences(intent.originalText);
  const structural = hasAnyConsequence(consequences);
  const highConsequence = assessment.requiresFreshOwnerApproval || structural;

  const consequenceRisks: RiskClassV1[] = [];
  if (consequences.destructiveImportantData) consequenceRisks.push("PERSISTENCE_OR_RECOVERY");
  if (consequences.accountAccess || consequences.credentialAccess || consequences.securityConfigurationChange) {
    consequenceRisks.push("SECURITY_OR_PRIVACY");
  }
  if (consequences.sensitiveDataExpansion) consequenceRisks.push("SENSITIVE_DATA");
  if (consequences.paidResource || consequences.spendIncrease || consequences.newFinancialObligation) {
    consequenceRisks.push("MONEY");
  }
  if (consequences.externalSend || consequences.externalPublish || consequences.productionMutation) {
    consequenceRisks.push("PRODUCTION_OR_EXTERNAL");
  }
  if (consequences.authorityExpansion) consequenceRisks.push("AUTHORITY_OR_GOVERNANCE");
  if (consequences.uncertainConsequence) consequenceRisks.push("LOW_CONFIDENCE");

  return {
    kind: "CREATE_MILESTONE",
    reason: highConsequence
      ? (assessment.requiresFreshOwnerApproval ? describeBoundaries(assessment) : describeConsequences(consequences))
      : "no existing milestone covers this objective",
    matchedMilestoneId: null,
    milestone: {
      // Derived from the goal id, so replanning the same sentence targets the same milestone.
      milestoneId: `owner-${intent.goalId.replace(/^goal-/, "")}`,
      title: titleFor(intent.originalText),
      objective: intent.originalText,
      priority: 500,
      dependencies: [],
      ownerAuthorizationId: null,
      // A sentence with no recorded parent relation claims no envelope. This is the whole of Fix 2:
      // there is no fallback that finds "some active compatible envelope" to attach it to.
      authorityEnvelopeId: input.lineage?.envelopeId ?? null,
      derivedFromMilestoneId: input.lineage?.parentMilestoneId ?? null,
      derivedFromObjective: input.lineage?.parentObjective ?? null,
      writeDomains: [...input.writeDomains],
      allowedProviders: [...input.allowedProviders],
      verificationSteps: [...input.verificationSteps],
      riskClasses: [...new Set([...assessment.riskClasses, ...consequenceRisks])],
      externalEffectClass:
        consequences.externalSend || consequences.externalPublish || consequences.irreversibleExternalEffect
          ? "IRREVERSIBLE_EXTERNAL"
          : assessment.externalEffectClass ?? "REPOSITORY_REVERSIBLE",
      reversibilityClass:
        consequences.destructiveImportantData || consequences.irreversibleExternalEffect
          ? "IRREVERSIBLE"
          : assessment.reversibilityClass ?? "REVERSIBLE",
      // A request that reaches a boundary is high-consequence by construction, which the authority
      // resolver refuses to inherit regardless of every other field.
      authorityClass: highConsequence ? "HIGH_CONSEQUENCE" : "MILESTONE_AUTHORIZED",
      boundaries: assessment.boundaries.map((row) => row.boundary),
      provenance: `Owner goal ${intent.goalId}: ${intent.originalText}`,
    },
  };
}
