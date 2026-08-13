/**
 * Working out what the Owner is actually trying to do, then gathering enough to answer it.
 *
 * ## The failure this replaces
 *
 * Chat routed a message to the first regex that matched and handed it to one narrow handler. That
 * design has a specific pathology: it is confidently wrong at the edges. The Owner photographed a
 * car, then asked *"how many other used cars are on the lot?"* — a question about a population — and
 * the first pattern that matched was a vehicle-detail pattern, so AION described the same car again.
 * Nothing errored. The answer was simply about the wrong thing, and there was no stage in the
 * pipeline whose job was to notice.
 *
 * Two structural changes follow from that.
 *
 * **Goals are scored, not raced.** Every goal that has any signal in the message is scored, and the
 * winner has to beat the runner-up by a margin. A near-tie is ambiguity, and ambiguity is worth one
 * clarifying question — not a coin flip resolved in favour of whichever pattern is earlier in the
 * file. Ordering inside this module carries no meaning, which is the point: adding a goal cannot
 * silently steal traffic from an existing one the way inserting a branch could.
 *
 * **Evidence is gathered before the answer is composed, and each piece carries how it is known.**
 * A reply may mix a physical observation, a website fact and an inference, and the Owner needs to
 * know which is which, because he repeats these numbers to customers. So evidence is classified
 * KNOWN / INFERENCE / UNKNOWN and an unknown is a first-class result — something the composer must
 * state, never something it may quietly omit.
 *
 * ## The model does not hold the facts
 *
 * Everything here is deterministic and pure. Inventory, prices, customers, commitments, observations
 * and history come from state; this module decides *which* to fetch and *how to say it*. A local
 * model may later rephrase a composed answer, but it is never the source of a fact, and it is never
 * asked a question whose answer would have to be invented. That ordering — gather, classify, compose,
 * only then optionally rephrase — is what keeps a fluent sentence from becoming a fabricated one.
 *
 * That ordering is not caution for its own sake. Given five short grounded facts and asked which car
 * to focus on, the local fast model wrote that a $34,120 car was "within Sarah Chen's budget of
 * $33,000" and credited it with "AWD availability" that no fact mentioned — one arithmetic error and
 * one invented attribute, in three fluent sentences the Owner would have repeated to a customer.
 *
 * A second consequence: availability is checked, never remembered. This machine's durable settings
 * named two local text models as healthy and installed, and the model store had neither, because the
 * files were deleted four days after the health record was written.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import type { EvidenceClassV1 } from "./lot-scope-reasoning.js";

export const ORCHESTRATION_SCHEMA_V1 = "aion.conversation-orchestration.v1" as const;

// ---------------------------------------------------------------------------
// What the Owner is trying to do
// ---------------------------------------------------------------------------

/**
 * A practical goal is what the Owner wants to be true after the answer, not the grammatical form of
 * the question. "What about the price?" and "how much is it?" are one goal; "what should I do?" and
 * "what do you think I should focus on?" are another.
 */
export type PracticalGoalV1 =
  | "PLAN_MY_DAY"
  | "PRIORITIZE_VEHICLES"
  | "LOT_POPULATION"
  | "VEHICLE_DETAIL"
  | "VEHICLE_BUYER_MATCH"
  | "CUSTOMER_NEEDS"
  | "CUSTOMER_FIT"
  | "DRAFT_MESSAGE"
  | "WHAT_IS_UNKNOWN"
  | "CONTENT_FOR_VEHICLE"
  | "OWNER_HISTORY"
  | "CURRENT_WEB_FACT"
  | "VERIFY_INSTEAD_OF_GUESS"
  | "UNCLEAR";

export interface GoalReadingV1 {
  goal: PracticalGoalV1;
  /** 0..1. Below AMBIGUITY_MARGIN over the runner-up means "ask", not "guess". */
  confidence: number;
  /** Other goals with real signal, strongest first. Empty when the reading is clean. */
  alternatives: PracticalGoalV1[];
  ambiguous: boolean;
  /** Present only when the message genuinely could not be read. */
  clarification: string | null;
}

interface GoalSignal {
  goal: PracticalGoalV1;
  pattern: RegExp;
  weight: number;
}

/**
 * Signals, not a routing table.
 *
 * Several may fire for one message and that is expected — "who might want this one?" is both a
 * buyer-match signal and a weak vehicle signal, and the margin between them is what decides. Weights
 * are coarse on purpose: 3 for a phrase that means one thing, 2 for a strong hint, 1 for a nudge
 * that should only matter when nothing stronger fires.
 */
const GOAL_SIGNALS: readonly GoalSignal[] = [
  // Planning the day. Deliberately does not require the word "today" — the Owner says "what now?".
  { goal: "PLAN_MY_DAY", weight: 3, pattern: /\bwhat should i (?:do|work on|start with)\b/i },
  { goal: "PLAN_MY_DAY", weight: 3, pattern: /\bmy (?:sales )?day\b/i },
  { goal: "PLAN_MY_DAY", weight: 3, pattern: /\bwhat(?:'s| is) (?:my )?(?:the )?plan\b/i },
  { goal: "PLAN_MY_DAY", weight: 2, pattern: /\bwhat should i do next\b/i },
  { goal: "PLAN_MY_DAY", weight: 2, pattern: /\bwhere should i (?:start|focus)\b/i },
  { goal: "PLAN_MY_DAY", weight: 2, pattern: /\bwhat do you think i should (?:do|focus)\b/i },

  { goal: "PRIORITIZE_VEHICLES", weight: 3, pattern: /\bwhich (?:of these |of the )?(?:cars?|vehicles?|units?)\b[^?]*\b(?:spend time|focus|priorit|worth|first)\b/i },
  { goal: "PRIORITIZE_VEHICLES", weight: 2, pattern: /\bwhich (?:one|ones) (?:should i|is worth)\b/i },

  // Population. "How many" plus a population noun; never about one unit.
  { goal: "LOT_POPULATION", weight: 4, pattern: /\bhow many\b[^?]{0,40}\b(?:cars?|vehicles?|units?|used|new|pre[- ]?owned|inventory)\b/i },
  { goal: "LOT_POPULATION", weight: 3, pattern: /\bhow many (?:other|more|else)\b/i },
  { goal: "LOT_POPULATION", weight: 2, pattern: /\b(?:count|total number) of (?:cars?|vehicles?|units?)\b/i },
  { goal: "LOT_POPULATION", weight: 2, pattern: /\bon the lot\b/i },

  { goal: "VEHICLE_DETAIL", weight: 3, pattern: /\bwhat about the (?:price|colou?r|mileage|trim|warranty)\b/i },
  { goal: "VEHICLE_DETAIL", weight: 3, pattern: /\b(?:how much|what(?:'s| is) the price|msrp|sticker price)\b/i },
  { goal: "VEHICLE_DETAIL", weight: 2, pattern: /\bis (?:this|it) (?:a )?(?:hybrid|awd|4wd|certified|new|used)\b/i },
  { goal: "VEHICLE_DETAIL", weight: 2, pattern: /\b(?:recalls?|options?|packages?|equipment)\b/i },
  { goal: "VEHICLE_DETAIL", weight: 1, pattern: /\bthis (?:one|car|vehicle)\b/i },

  { goal: "VEHICLE_BUYER_MATCH", weight: 4, pattern: /\bwho (?:might|would|could|should)\b[^?]{0,30}\b(?:want|like|buy|be interested)\b/i },
  { goal: "VEHICLE_BUYER_MATCH", weight: 3, pattern: /\bwho(?:'s| is) (?:this|it) (?:right )?for\b/i },
  { goal: "VEHICLE_BUYER_MATCH", weight: 3, pattern: /\bany(?:one|body) (?:looking for|want)\b/i },
  { goal: "VEHICLE_BUYER_MATCH", weight: 2, pattern: /\bwhich customers?\b/i },

  { goal: "CUSTOMER_NEEDS", weight: 3, pattern: /\bwhat does \w+ (?:want|need|be looking for)\b/i },
  { goal: "CUSTOMER_NEEDS", weight: 3, pattern: /\bwhat(?:'s| is) \w+ looking for\b/i },
  { goal: "CUSTOMER_NEEDS", weight: 2, pattern: /\bwhat did \w+ (?:say|ask for)\b/i },

  { goal: "CUSTOMER_FIT", weight: 4, pattern: /\b(?:does|would|will) (?:this|it|that)\b[^?]{0,30}\b(?:fit|suit|work for|be right for)\b/i },
  { goal: "CUSTOMER_FIT", weight: 3, pattern: /\bis (?:this|it) right for (?:her|him|them|\w+)\b/i },
  { goal: "CUSTOMER_FIT", weight: 2, pattern: /\bgood (?:fit|match) for\b/i },

  { goal: "DRAFT_MESSAGE", weight: 4, pattern: /\bwhat should i (?:tell|say to|send)\b/i },
  { goal: "DRAFT_MESSAGE", weight: 3, pattern: /\b(?:write|draft|compose) (?:a |an )?(?:message|text|email|reply)\b/i },
  { goal: "DRAFT_MESSAGE", weight: 2, pattern: /\bhow (?:should|do) i (?:answer|reply|respond)\b/i },

  { goal: "WHAT_IS_UNKNOWN", weight: 4, pattern: /\bwhat (?:don't|do not|dont) (?:we|i|you) know\b/i },
  { goal: "WHAT_IS_UNKNOWN", weight: 3, pattern: /\bwhat(?:'s| is) (?:still )?(?:missing|unknown|unverified)\b/i },
  { goal: "WHAT_IS_UNKNOWN", weight: 2, pattern: /\bwhat (?:are we|am i) missing\b/i },

  { goal: "CONTENT_FOR_VEHICLE", weight: 4, pattern: /\b(?:make|write|draft|create) (?:me )?a (?:facebook|instagram|social|marketplace)?\s*post\b/i },
  { goal: "CONTENT_FOR_VEHICLE", weight: 3, pattern: /\bpost (?:this|it|about this)\b/i },
  { goal: "CONTENT_FOR_VEHICLE", weight: 2, pattern: /\bcontent (?:idea|opportunit)/i },

  { goal: "OWNER_HISTORY", weight: 4, pattern: /\bwhat did (?:caleb and i|i and caleb|we) (?:decide|build|do|discuss|agree)\b/i },
  { goal: "OWNER_HISTORY", weight: 3, pattern: /\bwhat did i tell caleb\b/i },
  { goal: "OWNER_HISTORY", weight: 3, pattern: /\bwhat was the real play\b/i },
  { goal: "OWNER_HISTORY", weight: 3, pattern: /\bwhy did we (?:design|build|choose)\b/i },
  { goal: "OWNER_HISTORY", weight: 2, pattern: /\bwhat projects\b[^?]{0,30}\bcaleb\b/i },
  { goal: "OWNER_HISTORY", weight: 2, pattern: /\b(?:xo role|the real play)\b/i },

  { goal: "VERIFY_INSTEAD_OF_GUESS", weight: 4, pattern: /\bcan you find out\b/i },
  { goal: "VERIFY_INSTEAD_OF_GUESS", weight: 3, pattern: /\b(?:instead of|rather than) guessing\b/i },
  { goal: "VERIFY_INSTEAD_OF_GUESS", weight: 3, pattern: /\b(?:look it up|check for real|verify (?:it|that))\b/i },

  { goal: "CURRENT_WEB_FACT", weight: 3, pattern: /\b(?:current|latest|newest|right now|these days)\b[^?]{0,40}\b(?:price|version|api|rules?|regulations?|trend)\b/i },
  { goal: "CURRENT_WEB_FACT", weight: 2, pattern: /\bwhat(?:'s| is) (?:the )?(?:current|latest)\b/i },
  { goal: "CURRENT_WEB_FACT", weight: 2, pattern: /\bsearch (?:the web|online)\b/i },
];

/** How far the winner must lead the runner-up before the reading counts as clean. */
export const AMBIGUITY_MARGIN = 2;

/**
 * Asking for direction, decomposed.
 *
 * Independent review found "What should I focus on next?" reading as UNCLEAR while longer variants
 * worked, and the cause was structural rather than a missing phrase: every planning signal above is
 * a whole-sentence pattern, so each new way of asking the same thing needs its own line, and the
 * ones nobody thought of fall through. Adding the exact string would have fixed one sentence and
 * left the shape of the bug untouched.
 *
 * A request for direction is really two things in one sentence — a frame that asks for a
 * recommendation, and an object that is the Owner's effort rather than a car or a person. Matching
 * them separately covers the combinations nobody enumerated, including "what would you do next?"
 * and "what deserves my attention?".
 */
const DIRECTION_FRAME = new RegExp(
  [
    // "what should I", "where should I", "what do you think I should", "what would you"
    String.raw`\b(?:what|which|where)\s+(?:should\s+i|do\s+you\s+think\s+i\s+should|would\s+you|ought\s+i)\b`,
    // "what matters", "what deserves", "what's most important/urgent"
    String.raw`\bwhat\s+(?:matters|deserves)\b`,
    String.raw`\bwhat(?:'s|\s+is)\s+(?:the\s+)?most\s+(?:important|urgent|pressing)\b`,
  ].join("|"),
  "i",
);

/**
 * The object of the effort. Deliberately excludes speech verbs — "what should I tell her?" is a
 * drafting request, not a planning one, and must keep reaching its own goal.
 */
const DIRECTION_OBJECT = new RegExp(
  [
    String.raw`\b(?:do|doing|work\s+on|focus(?:\s+on)?|start(?:\s+with)?|begin\s+with|tackle)\b`,
    String.raw`\bpriorit(?:y|ise|ize|izing|ising)\b`,
    String.raw`\bspend\s+(?:my\s+)?time\b`,
    String.raw`\b(?:attention|attend\s+to)\b`,
    String.raw`\bmatters?(?:\s+most)?\b`,
  ].join("|"),
  "i",
);

/**
 * Asking whether something is still true.
 *
 * The same lesson as the direction frames, learned again: enumerating whole sentences leaves out the
 * phrasings nobody thought of. *"Does Tailscale still require this, or has it changed recently?"*
 * matched none of the literal current-information patterns and fell through to a handler about
 * overdue follow-ups — a confident answer about the wrong subject, from stale knowledge, which is
 * the exact failure this path exists to prevent.
 *
 * Two shapes count. Either the sentence asks about the present state of something outside AION
 * ("what's current", "has it changed", "does it still exist"), or it asks for verification instead
 * of recall ("can you check", "look it up", "find out"). Both mean: do not answer from memory.
 */
const CURRENCY_FRAME = new RegExp(
  [
    String.raw`\bwhat(?:'s|\s+is)\s+(?:the\s+)?(?:current|latest|newest)\b`,
    String.raw`\b(?:has|have|did|does)\b[^?]{0,40}\b(?:changed?|updated?)\b`,
    String.raw`\bstill\s+(?:exists?|works?|required?|available|supported|true|the\s+case|require)\b`,
    String.raw`\b(?:current|currently|latest|nowadays|these\s+days|right\s+now)\b[^?]{0,40}\b(?:price|version|api|rule|regulation|trend|says?|policy|option|detail|model)\b`,
  ].join("|"),
  "i",
);

const VERIFICATION_FRAME = new RegExp(
  [
    String.raw`\bcan\s+you\s+(?:check|find\s+out|look\s+(?:it\s+)?up|verify|confirm)\b`,
    String.raw`\b(?:look\s+it\s+up|find\s+out|check\s+for\s+real|double[-\s]?check)\b`,
    String.raw`\b(?:instead\s+of|rather\s+than)\s+guessing\b`,
    String.raw`\bfind\s+(?:me\s+)?(?:a\s+)?free\b`,
    String.raw`\bsearch\s+(?:the\s+web|online)\b`,
  ].join("|"),
  "i",
);

/** True when answering from memory would risk presenting something stale as current. */
export function asksForCurrentInformation(text: string): boolean {
  return CURRENCY_FRAME.test(String(text ?? ""));
}

/** True when the Owner is explicitly asking AION to verify rather than recall. */
export function asksForVerification(text: string): boolean {
  return VERIFICATION_FRAME.test(String(text ?? ""));
}

/** True when the sentence asks what the Owner should put his effort into. */
export function asksForDirection(text: string): boolean {
  const message = String(text ?? "");
  return DIRECTION_FRAME.test(message) && DIRECTION_OBJECT.test(message);
}

/**
 * Score every goal, then decide whether the winner is clear enough to act on.
 *
 * Scoring rather than racing is the whole change. Under the old chain, "how many other used cars are
 * on the lot?" hit a vehicle pattern first and never reached the population handler. Here both score
 * and the population signal wins on weight, which is a property of the sentence rather than of file
 * order.
 */
export function understandGoal(text: string): GoalReadingV1 {
  const message = String(text ?? "");
  const scores = new Map<PracticalGoalV1, number>();

  for (const signal of GOAL_SIGNALS) {
    if (!signal.pattern.test(message)) continue;
    scores.set(signal.goal, (scores.get(signal.goal) ?? 0) + signal.weight);
  }

  // The compositional reading, scored alongside the literal ones rather than short-circuiting them.
  // Weighted below a named drafting or population phrase so "what should I tell her?" and "how many
  // are on the lot?" keep their own goals.
  if (asksForDirection(message)) {
    const goal: PracticalGoalV1 = /\b(?:cars?|vehicles?|units?|inventory)\b/i.test(message)
      ? "PRIORITIZE_VEHICLES"
      : "PLAN_MY_DAY";
    scores.set(goal, (scores.get(goal) ?? 0) + 3);
  }

  // Temporal and verification questions, scored compositionally for the same reason as direction.
  // Weighted above the literal signals so "what does Toyota currently say about this model?" is a
  // question about the world rather than a question about the car in front of him.
  if (asksForCurrentInformation(message)) {
    scores.set("CURRENT_WEB_FACT", (scores.get("CURRENT_WEB_FACT") ?? 0) + 4);
  }
  if (asksForVerification(message)) {
    scores.set("VERIFY_INSTEAD_OF_GUESS", (scores.get("VERIFY_INSTEAD_OF_GUESS") ?? 0) + 4);
  }

  if (scores.size === 0) {
    return { goal: "UNCLEAR", confidence: 0, alternatives: [], ambiguous: false, clarification: null };
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [topGoal, topScore] = ranked[0]!;
  const runnerUp = ranked[1]?.[1] ?? 0;
  const ambiguous = ranked.length > 1 && topScore - runnerUp < AMBIGUITY_MARGIN;

  // Confidence is the winner's share of all signal, so a lone weak match does not read as certainty.
  const total = ranked.reduce((sum, [, score]) => sum + score, 0);
  const confidence = Math.round((topScore / total) * 100) / 100;

  return {
    goal: topGoal,
    confidence,
    alternatives: ranked.slice(1).filter(([, s]) => s > 0).map(([g]) => g),
    ambiguous,
    clarification: ambiguous
      ? `I can read that two ways — ${describeGoal(topGoal)}, or ${describeGoal(ranked[1]![0])}. Which did you mean?`
      : null,
  };
}

/** Owner-facing description of a goal. Never the enum name. */
export function describeGoal(goal: PracticalGoalV1): string {
  switch (goal) {
    case "PLAN_MY_DAY": return "what to work on";
    case "PRIORITIZE_VEHICLES": return "which vehicles are worth your time";
    case "LOT_POPULATION": return "how many vehicles there are";
    case "VEHICLE_DETAIL": return "a detail about this vehicle";
    case "VEHICLE_BUYER_MATCH": return "who might buy this one";
    case "CUSTOMER_NEEDS": return "what a customer is looking for";
    case "CUSTOMER_FIT": return "whether this vehicle fits a customer";
    case "DRAFT_MESSAGE": return "what to say to someone";
    case "WHAT_IS_UNKNOWN": return "what we still don't know";
    case "CONTENT_FOR_VEHICLE": return "a post for this vehicle";
    case "OWNER_HISTORY": return "something from your own history";
    case "CURRENT_WEB_FACT": return "something current from the web";
    case "VERIFY_INSTEAD_OF_GUESS": return "checking rather than guessing";
    case "UNCLEAR": return "something else";
  }
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * The domains the orchestrator may draw on. Each maps to an existing deterministic system that
 * remains the source of truth for its facts.
 *
 * There is deliberately no shell, filesystem, process or arbitrary-query tool. The list is closed
 * and enumerated rather than derived, so widening it is a visible edit rather than a side effect.
 */
export type ToolIdV1 =
  | "vehicle_inventory"
  | "lot_walk_observations"
  | "website_inventory"
  | "vehicle_prices"
  | "customer_identity"
  | "customer_needs"
  | "commitments"
  | "customer_vehicle_match"
  | "vehicle_customer_reverse_match"
  | "conversation_history"
  | "active_context"
  | "owner_knowledge"
  | "mail_read"
  | "photo_evidence"
  | "content_opportunities"
  | "website_content_status"
  | "public_web_research"
  | "crm_prepare";

export const ORCHESTRATOR_TOOLS: readonly ToolIdV1[] = [
  "vehicle_inventory", "lot_walk_observations", "website_inventory", "vehicle_prices",
  "customer_identity", "customer_needs", "commitments", "customer_vehicle_match",
  "vehicle_customer_reverse_match", "conversation_history", "active_context",
  "owner_knowledge", "mail_read", "photo_evidence", "content_opportunities",
  "website_content_status", "public_web_research", "crm_prepare",
];

/**
 * Surfaces that must never become tools, checked rather than merely intended.
 *
 * A model that can name a tool must not be able to name a way to run code. This is asserted in the
 * test suite against the tool list itself, so adding "run_command" would fail a build rather than
 * quietly widen what model output can reach.
 */
export const FORBIDDEN_TOOL_SURFACES: readonly string[] = [
  "shell", "command", "exec", "process", "filesystem", "file_write", "delete",
  "sql", "query_raw", "eval", "script", "install", "deploy", "publish", "send",
];

export function toolSurfaceIsSafe(tools: readonly string[] = ORCHESTRATOR_TOOLS): {
  ok: boolean;
  violations: string[];
} {
  const violations = tools.filter((tool) =>
    FORBIDDEN_TOOL_SURFACES.some((banned) => tool.toLowerCase().includes(banned)),
  );
  return { ok: violations.length === 0, violations };
}

export interface ToolPlanV1 {
  schema: typeof ORCHESTRATION_SCHEMA_V1;
  goal: PracticalGoalV1;
  /** Run these to answer at all. */
  required: ToolIdV1[];
  /** Run these if they are cheap or the required set came back thin. */
  enriching: ToolIdV1[];
  /** Why these tools, in one line, for the Owner-visible explanation of an unknown. */
  rationale: string;
}

export interface OrchestrationContextV1 {
  workspace: string;
  conversationId: string | null;
  activeVehicleRef: OpaqueId | null;
  activeCustomerRef: OpaqueId | null;
  /** Vehicles identified from photographs in the current walk. */
  physicallyVerifiedVehicleIds: readonly string[];
  hasAttachments: boolean;
  now: IsoTimestamp;
  /** Whether a bounded public web lookup is permitted this turn. */
  webResearchAllowed: boolean;
}

/**
 * Choose the evidence to gather.
 *
 * Required versus enriching is a latency decision as much as a correctness one: the Owner is standing
 * on a lot holding a phone, and an answer that waits for customer matching before saying which car it
 * is has already failed him. Required is the minimum that makes the answer true; enriching is what
 * makes it better if it arrives in time.
 */
export function planTools(goal: PracticalGoalV1, context: OrchestrationContextV1): ToolPlanV1 {
  const plan = (required: ToolIdV1[], enriching: ToolIdV1[], rationale: string): ToolPlanV1 => ({
    schema: ORCHESTRATION_SCHEMA_V1,
    goal,
    required,
    enriching,
    rationale,
  });

  switch (goal) {
    case "PLAN_MY_DAY":
      return plan(
        ["commitments", "customer_identity", "active_context"],
        ["vehicle_inventory", "content_opportunities", "mail_read"],
        "what you owe people, and who has gone quiet",
      );

    case "PRIORITIZE_VEHICLES":
      return plan(
        ["vehicle_inventory", "vehicle_customer_reverse_match"],
        ["vehicle_prices", "content_opportunities"],
        "which units have real demand behind them",
      );

    case "LOT_POPULATION":
      // Both halves are required: the physical sample alone reads as evasion, and the website count
      // alone reads as a physical claim. The answer is the pair, or it is misleading.
      return plan(
        ["lot_walk_observations", "website_inventory"],
        [],
        "what you have actually verified versus what the site lists",
      );

    case "VEHICLE_DETAIL":
      return plan(
        ["active_context", "vehicle_inventory"],
        ["vehicle_prices", "photo_evidence"],
        "the record for the vehicle in front of you",
      );

    case "VEHICLE_BUYER_MATCH":
      return plan(
        ["active_context", "vehicle_customer_reverse_match"],
        ["customer_needs", "commitments"],
        "customers whose recorded needs match this unit",
      );

    case "CUSTOMER_NEEDS":
      return plan(
        ["customer_identity", "customer_needs"],
        ["commitments", "conversation_history"],
        "what this customer has actually told you",
      );

    case "CUSTOMER_FIT":
      return plan(
        ["active_context", "customer_identity", "customer_vehicle_match"],
        ["customer_needs", "vehicle_prices"],
        "this unit measured against her recorded requirements",
      );

    case "DRAFT_MESSAGE":
      return plan(
        ["customer_identity", "customer_needs", "commitments"],
        ["active_context", "vehicle_inventory", "crm_prepare"],
        "what you promised and what she asked for",
      );

    case "WHAT_IS_UNKNOWN":
      return plan(
        ["active_context", "vehicle_inventory", "photo_evidence"],
        ["vehicle_prices", "website_content_status"],
        "the gaps in what we have on this vehicle",
      );

    case "CONTENT_FOR_VEHICLE":
      return plan(
        ["active_context", "vehicle_inventory"],
        ["vehicle_prices", "content_opportunities"],
        "verified facts that are safe to publish",
      );

    case "OWNER_HISTORY":
      return plan(
        ["owner_knowledge"],
        ["conversation_history"],
        "what you recorded at the time",
      );

    case "CURRENT_WEB_FACT":
    case "VERIFY_INSTEAD_OF_GUESS":
      return plan(
        context.webResearchAllowed ? ["public_web_research"] : [],
        ["vehicle_inventory", "owner_knowledge"],
        context.webResearchAllowed
          ? "this changes over time, so it is worth checking rather than recalling"
          : "web lookup is not available this turn",
      );

    case "UNCLEAR":
      return plan(["active_context"], ["conversation_history"], "context for an unclear message");
  }
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export type EvidenceStatusV1 = "KNOWN" | "INFERENCE" | "UNKNOWN";

export interface EvidenceItemV1 {
  tool: ToolIdV1;
  status: EvidenceStatusV1;
  /** The claim in the Owner's language. Never a schema fragment. */
  claim: string;
  evidenceClass: EvidenceClassV1;
  sourceRefs: string[];
  observedAt: IsoTimestamp | null;
}

export interface EvidencePacketV1 {
  schema: typeof ORCHESTRATION_SCHEMA_V1;
  goal: PracticalGoalV1;
  items: EvidenceItemV1[];
  known: EvidenceItemV1[];
  inference: EvidenceItemV1[];
  unknown: EvidenceItemV1[];
  /** True when nothing grounded came back, which is an answer in itself. */
  empty: boolean;
}

/**
 * How a claim is known follows from where it came from, not from how confident it sounds.
 *
 * A physical observation and a website reading can assert the same sentence and mean different
 * things; collapsing them into one "confidence" number is precisely how a listing count becomes a
 * claim about the lot.
 */
export function statusForEvidenceClass(evidenceClass: EvidenceClassV1): EvidenceStatusV1 {
  switch (evidenceClass) {
    case "PHYSICAL_OBSERVATION":
    case "CURRENT_WEBSITE_FACT":
    case "OWNER_DIRECT_FACT":
    case "CUSTOMER_STATEMENT":
    case "PUBLIC_WEB_FACT":
      return "KNOWN";
    case "INFERENCE":
      return "INFERENCE";
    case "UNKNOWN":
      return "UNKNOWN";
  }
}

export function buildEvidencePacket(input: {
  goal: PracticalGoalV1;
  items: readonly Omit<EvidenceItemV1, "status">[];
}): EvidencePacketV1 {
  const items: EvidenceItemV1[] = input.items.map((item) => ({
    ...item,
    status: statusForEvidenceClass(item.evidenceClass),
  }));
  const known = items.filter((i) => i.status === "KNOWN");
  const inference = items.filter((i) => i.status === "INFERENCE");
  const unknown = items.filter((i) => i.status === "UNKNOWN");
  return {
    schema: ORCHESTRATION_SCHEMA_V1,
    goal: input.goal,
    items,
    known,
    inference,
    unknown,
    empty: known.length === 0 && inference.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Reasoning tier
// ---------------------------------------------------------------------------

/**
 * Which engine should produce the words.
 *
 * DETERMINISTIC covers exact state answers, where a model could only add risk. FAST_LOCAL is
 * language shaping over evidence already gathered. REASONING_LOCAL is for genuine synthesis across
 * sources, comparison and planning. None of the three may add a fact.
 */
export type ReasoningTierV1 = "DETERMINISTIC" | "FAST_LOCAL" | "REASONING_LOCAL";

export interface TierDecisionV1 {
  tier: ReasoningTierV1;
  reason: string;
  /** Set when the chosen tier has no model installed and composition fell back. */
  degradedFrom: ReasoningTierV1 | null;
}

const SYNTHESIS_GOALS: readonly PracticalGoalV1[] = [
  "PLAN_MY_DAY", "PRIORITIZE_VEHICLES", "CUSTOMER_FIT", "DRAFT_MESSAGE", "OWNER_HISTORY",
];

export interface TierInputV1 {
  goal: PracticalGoalV1;
  packet: EvidencePacketV1;
  ambiguous: boolean;
  /** Text models actually available locally. Empty is the current real state of this machine. */
  availableTextModels: readonly string[];
}

/** Vision models cannot answer a text question, however local and however healthy they are. */
const VISION_ONLY_MODEL = /llava|moondream|vision|clip|bakllava/i;

/**
 * How long a health check may stand before it stops counting as evidence.
 *
 * Falling back to deterministic composition when health is stale costs the Owner nothing he would
 * notice — the answer is still complete — whereas routing to a model that has been deleted costs him
 * an error in place of an answer. That asymmetry is the whole argument for the bound.
 */
export const MODEL_HEALTH_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Which configured endpoints can actually serve a text turn right now.
 *
 * Configuration is not availability, and the gap is not theoretical. This machine's durable brain
 * settings named `qwen3:4b-instruct` as primary and `deepseek-r1:8b` beside it, both pointed at a
 * healthy local Ollama, and Ollama answered "model not found" for both: the model files had been
 * removed from the store while the configuration stayed intact.
 *
 * Age matters more than contents. The stored health record was four days old, said `available: true`
 * and listed both missing models *by name* — so checking the installed list alone would have
 * confirmed exactly the wrong answer. An endpoint counts only when its probe succeeded, named the
 * configured model, and is recent enough to still mean something.
 */
export function availableTextModelsFrom(
  endpoints: ReadonlyArray<{
    location: string;
    enabled: boolean;
    runtime: string;
    model: string;
    lastHealth: { available: boolean; checkedAt?: string; installedModels?: readonly string[] } | null;
  }>,
  now: string = new Date().toISOString(),
): string[] {
  const nowMs = Date.parse(now);
  return endpoints
    .filter((endpoint) => endpoint.location === "local-machine" && endpoint.enabled)
    .filter((endpoint) => endpoint.runtime !== "deterministic-offline")
    .filter((endpoint) => {
      const health = endpoint.lastHealth;
      if (!health?.available) return false;
      const checkedAt = Date.parse(String(health.checkedAt ?? ""));
      if (!Number.isFinite(checkedAt)) return false;
      if (Number.isFinite(nowMs) && nowMs - checkedAt > MODEL_HEALTH_MAX_AGE_MS) return false;
      const installed = health.installedModels ?? [];
      // An empty list is not a claim of presence; it is the absence of one.
      return installed.some((name) => name === endpoint.model || name.startsWith(`${endpoint.model}:`));
    })
    .map((endpoint) => endpoint.model)
    .filter((model) => Boolean(model) && !VISION_ONLY_MODEL.test(model) && model !== "aion-offline-v1");
}

export function routeReasoningTier(input: TierInputV1): TierDecisionV1 {
  const wanted: ReasoningTierV1 =
    input.ambiguous || SYNTHESIS_GOALS.includes(input.goal)
      ? "REASONING_LOCAL"
      : input.packet.items.length > 3
        ? "FAST_LOCAL"
        : "DETERMINISTIC";

  if (wanted === "DETERMINISTIC") {
    return { tier: "DETERMINISTIC", reason: "an exact answer from recorded state", degradedFrom: null };
  }

  // No local text model on this machine today. Composition never depended on one, so this degrades
  // to a complete answer rather than to an apology.
  if (input.availableTextModels.length === 0) {
    return {
      tier: "DETERMINISTIC",
      reason: "no local text model is installed, so the answer is composed from evidence directly",
      degradedFrom: wanted,
    };
  }

  return {
    tier: wanted,
    reason: wanted === "REASONING_LOCAL"
      ? "this needs several sources weighed against each other"
      : "straightforward phrasing over gathered evidence",
    degradedFrom: null,
  };
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/** Openers that spend the first line of a phone screen saying nothing. */
const FILLER_OPENERS: readonly RegExp[] = [
  /^\s*(?:great|good|excellent)\s+question\b[.,!]?\s*/i,
  /^\s*(?:sure|certainly|of course|absolutely)\s*[,!.]\s*/i,
  /^\s*i(?:'ll| will| can) (?:help|check|look into)[^.]*\.\s*/i,
  /^\s*based on (?:the )?(?:available )?(?:data|information)\s*[,:]?\s*/i,
  /^\s*(?:as an ai|i'm an ai)\b[^.]*\.\s*/i,
];

/** Vocabulary from inside the system that must never reach the Owner. */
const INTERNAL_LEAKS: readonly RegExp[] = [
  /\b[A-Za-z][A-Za-z0-9]*V1\b/,
  /\b(?:sourceRef|relationshipRef|vehicleRef|customerRef|idempotencyKey|workspaceId|schema)\b/,
  /\b(?:GENERAL_ASSISTANT_QUERY|HARD_REQUIREMENT|UNRESOLVED_[A-Z_]+|PROPOSED|PREPARE_ONLY)\b/,
  /\b(?:PLAN_MY_DAY|LOT_POPULATION|VEHICLE_DETAIL|VEHICLE_BUYER_MATCH|CUSTOMER_NEEDS|CUSTOMER_FIT|DRAFT_MESSAGE|WHAT_IS_UNKNOWN|CONTENT_FOR_VEHICLE|OWNER_HISTORY|CURRENT_WEB_FACT|VERIFY_INSTEAD_OF_GUESS|UNCLEAR)\b/,
  /\b(?:DETERMINISTIC|FAST_LOCAL|REASONING_LOCAL)\b/,
];

export interface StyleFindingV1 {
  ok: boolean;
  problems: string[];
}

/**
 * Enforce the voice on the way out.
 *
 * Personality lives here rather than in a prompt so that it survives changing the local model — the
 * Owner should not be able to tell which engine produced a turn. Stripping is preferred to rejecting:
 * a reply that opens with filler is still a correct reply, and deleting four words is better than
 * discarding the answer.
 */
export function applyPersonality(reply: string): string {
  let text = String(reply ?? "");
  for (const opener of FILLER_OPENERS) text = text.replace(opener, "");
  // Collapse the blank lines that stripping can leave behind at the top.
  text = text.replace(/^\s+/, "");
  // Three or more newlines is a dump, not a paragraph break.
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trimEnd();
}

export function reviewComposedReply(reply: string): StyleFindingV1 {
  const text = String(reply ?? "");
  const problems: string[] = [];
  if (FILLER_OPENERS.some((p) => p.test(text))) problems.push("opens with filler instead of the answer");
  for (const leak of INTERNAL_LEAKS) {
    if (leak.test(text)) { problems.push(`leaks internal vocabulary: ${text.match(leak)?.[0]}`); break; }
  }
  if (/\b(?:as a language model|I cannot browse|I am an AI)\b/i.test(text)) {
    problems.push("talks about itself instead of the work");
  }
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Proactive help
// ---------------------------------------------------------------------------

export interface ProactiveOfferV1 {
  /** One line, or nothing at all. Never filler. */
  offer: string | null;
  reason: string | null;
}

/**
 * Decide whether a next step is genuinely worth offering.
 *
 * The bar is that the step must change something the Owner would otherwise have to work out for
 * himself. "Let me know if you need anything else" fails it, which is why this returns null far more
 * often than it returns a suggestion — a suggestion on every turn trains the Owner to stop reading
 * the last line.
 */
export function chooseProactiveHelp(input: {
  goal: PracticalGoalV1;
  packet: EvidencePacketV1;
  strongMatchCount: number;
  vinResolved: boolean;
  missingPhotoHint: string | null;
  unverifiedCustomerIssue: string | null;
}): ProactiveOfferV1 {
  if (!input.vinResolved && input.missingPhotoHint) {
    return {
      offer: input.missingPhotoHint,
      reason: "the vehicle is not identified yet and one photograph would fix it",
    };
  }
  if (input.goal === "VEHICLE_BUYER_MATCH" && input.strongMatchCount === 0) {
    // Carries only the part the body does not already say. The body has just explained that nobody
    // matches; repeating that and then adding the suggestion reads as padding.
    return {
      offer: "Want me to draft a post for it instead?",
      reason: "no demand on file, so content is the useful move",
    };
  }
  if (input.unverifiedCustomerIssue) {
    return {
      offer: `Worth knowing before you call: ${input.unverifiedCustomerIssue}`,
      reason: "a close match with one unverified problem",
    };
  }
  if (input.goal === "LOT_POPULATION") {
    return {
      offer: "Keep sending photos as you walk and I'll build today's real count as you go.",
      reason: "the only action that reduces this unknown",
    };
  }
  return { offer: null, reason: null };
}

// ---------------------------------------------------------------------------
// The orchestrated result
// ---------------------------------------------------------------------------

export interface OrchestrationResultV1 {
  schema: typeof ORCHESTRATION_SCHEMA_V1;
  reading: GoalReadingV1;
  plan: ToolPlanV1;
  packet: EvidencePacketV1;
  tier: TierDecisionV1;
  reply: string;
  proactive: ProactiveOfferV1;
  /** Every tool that actually contributed a claim, for the Owner-visible source list. */
  toolsUsed: ToolIdV1[];
}

/**
 * Assemble the final reply from evidence.
 *
 * Order is load-bearing: what is known, then what is inferred and marked as such, then what is not
 * known, then the one useful next step. Leading with a number and qualifying it afterwards is how a
 * caveat gets skipped, and this is the Owner's own vocabulary he will repeat to a customer.
 */
export function composeOrchestratedReply(input: {
  reading: GoalReadingV1;
  plan: ToolPlanV1;
  packet: EvidencePacketV1;
  tier: TierDecisionV1;
  proactive: ProactiveOfferV1;
  /** A better-phrased body from a deterministic domain module, when one produced it. */
  body?: string | null;
}): OrchestrationResultV1 {
  const lines: string[] = [];

  if (input.reading.ambiguous && input.reading.clarification) {
    lines.push(input.reading.clarification);
  } else if (input.body) {
    lines.push(input.body);
  } else if (input.packet.empty) {
    lines.push(`I don't have anything recorded that answers that yet.`);
  } else {
    for (const item of input.packet.known) lines.push(item.claim);
    for (const item of input.packet.inference) lines.push(`Probably ${lowerFirst(item.claim)} — that's my read, not something recorded.`);
    for (const item of input.packet.unknown) lines.push(item.claim);
  }

  // A domain module that already ends with the useful next step must not have a second one bolted
  // on. The two are rarely word-for-word identical — "keep photographing" versus "keep sending
  // photos" — so identity matching would miss it and the Owner would read the same advice twice.
  if (input.proactive.offer && !alreadyAdvised(lines.join(" "), input.proactive.offer)) {
    lines.push(input.proactive.offer);
  }

  const reply = applyPersonality(lines.filter(Boolean).join("\n\n"));

  return {
    schema: ORCHESTRATION_SCHEMA_V1,
    reading: input.reading,
    plan: input.plan,
    packet: input.packet,
    tier: input.tier,
    reply,
    proactive: input.proactive,
    toolsUsed: [...new Set(input.packet.items.map((i) => i.tool))],
  };
}

function lowerFirst(text: string): string {
  return text.length ? text[0]!.toLowerCase() + text.slice(1) : text;
}

const STOPWORDS = new Set([
  "a", "an", "and", "as", "at", "be", "but", "by", "for", "from", "i", "if", "ill", "in", "is", "it",
  "its", "me", "my", "of", "on", "or", "so", "that", "the", "then", "there", "they", "this", "to",
  "up", "was", "we", "what", "when", "will", "with", "you", "your",
]);

function contentWords(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

/** Overlap threshold above which two sentences are giving the Owner the same instruction. */
export const ADVICE_OVERLAP_THRESHOLD = 0.6;

/**
 * Whether a body already tells the Owner what the offer would tell him.
 *
 * Compares content words rather than strings, because the duplication that actually occurs is a
 * paraphrase: one module says "keep photographing", another says "keep sending photos", and the
 * Owner reads the same next step twice in one reply.
 */
export function alreadyAdvised(body: string, offer: string): boolean {
  const offerWords = new Set(contentWords(offer));
  if (offerWords.size === 0) return false;
  const bodyWords = new Set(contentWords(body));
  let shared = 0;
  for (const word of offerWords) if (bodyWords.has(word)) shared += 1;
  return shared / offerWords.size >= ADVICE_OVERLAP_THRESHOLD;
}

/**
 * The gaps a model must be told about rather than left to fill.
 *
 * Naming an unknown explicitly is what makes "AWD is unverified" a legitimate sentence and "it has
 * AWD" a rejected one. Silence about a field is how a small model decides the field is its to
 * invent.
 */
export function packetUnknownsFor(
  goal: PracticalGoalV1,
  vehicle: { trim?: string | null; mileage?: number | null; exteriorColor?: string | null } | null,
): string[] {
  const unknowns: string[] = [];
  if (!vehicle) return unknowns;
  // Drivetrain is never carried on the dealer record, so it is always unknown unless separately read.
  unknowns.push("drivetrain (AWD/FWD) is not recorded");
  if (!vehicle.trim) unknowns.push("trim is not recorded");
  if (vehicle.mileage == null) unknowns.push("mileage is not recorded");
  if (!vehicle.exteriorColor) unknowns.push("exterior colour is not recorded");
  if (goal === "CUSTOMER_FIT" || goal === "VEHICLE_BUYER_MATCH") {
    unknowns.push("whether the customer has seen this vehicle");
  }
  return unknowns;
}
