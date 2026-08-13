/**
 * Letting a local model do the talking without letting it decide what is true.
 *
 * ## The measurement that set the shape of this
 *
 * Given five short grounded facts and asked which car to focus on, `qwen3:4b-instruct` wrote that a
 * **$34,120 car was "within Sarah Chen's budget of $33,000"**, and credited it with **"AWD
 * availability"** that appeared in none of the facts. One arithmetic error and one invented
 * attribute, in three fluent sentences — the kind the Owner repeats to a customer on a lot.
 *
 * Neither failure is exotic and neither is fixable by prompting harder. A 4-billion-parameter model
 * asked to compare two numbers will sometimes get it wrong, and asked to describe a car will
 * sometimes reach for the attributes cars usually have. So the model is placed *inside* a contract
 * rather than trusted to stay within one: it receives a bounded packet, returns a structured result,
 * and every material claim is checked against the evidence by deterministic code before the Owner
 * sees a word.
 *
 * ## Why the validators are deterministic
 *
 * Checking one model with another model reproduces the original problem one layer further back.
 * Comparing 34,120 against 33,000 is arithmetic; deciding whether "AWD" appears in a fact list is
 * set membership. Both are exactly specifiable, so neither is a language problem, and code that
 * subtracts two numbers cannot hallucinate the comparison.
 *
 * ## What a failure does
 *
 * A violation does not fall back to an apology. The deterministic composition that would have been
 * produced anyway is already correct and complete, so a rejected synthesis costs the Owner nothing
 * except the nicer phrasing — which is the right trade every time.
 */
import type { IsoTimestamp } from "./contracts.js";

export const GROUNDED_SYNTHESIS_SCHEMA_V1 = "aion.grounded-synthesis.v1" as const;

// ---------------------------------------------------------------------------
// The packet handed to the model
// ---------------------------------------------------------------------------

/** How a fact is known. The model is told this and may not upgrade it. */
export type EpistemicClassV1 =
  | "KNOWN"
  | "OWNER_STATED"
  | "CUSTOMER_STATED"
  | "PHYSICAL_OBSERVATION"
  | "WEBSITE_FACT"
  | "PUBLIC_WEB_FACT"
  | "INFERENCE_ALLOWED"
  | "UNKNOWN";

export interface EvidenceFactV1 {
  factId: string;
  /** Dotted domain path, e.g. `vehicle.price`, `customer.budget.max`, `vehicle.drivetrain`. */
  type: string;
  value: string | number | null;
  sourceRef: string;
  observedAt: IsoTimestamp | null;
  confidence: number;
  epistemicClass: EpistemicClassV1;
}

export interface SynthesisPacketV1 {
  schema: typeof GROUNDED_SYNTHESIS_SCHEMA_V1;
  question: string;
  goal: string;
  activeContext: string | null;
  facts: EvidenceFactV1[];
  /** Named gaps. The model may say these are unknown; it may not fill them. */
  unknowns: string[];
  /** The only reasoning steps permitted beyond restating a fact. */
  allowedInferences: string[];
}

/** Bytes of packet the model may receive. Beyond this, relevance has already failed. */
export const SYNTHESIS_PACKET_BUDGET_BYTES = 8_000;

/**
 * Build the model's entire view of the world for one turn.
 *
 * Never the whole state: a packet is what survived relevance selection, and passing more would both
 * slow the turn and give a small model more surface on which to confuse two customers.
 */
export function buildSynthesisPacket(input: {
  question: string;
  goal: string;
  activeContext?: string | null;
  facts: readonly EvidenceFactV1[];
  unknowns?: readonly string[];
  allowedInferences?: readonly string[];
  budgetBytes?: number;
}): SynthesisPacketV1 {
  const budget = input.budgetBytes ?? SYNTHESIS_PACKET_BUDGET_BYTES;
  const facts: EvidenceFactV1[] = [];
  let used = 0;
  for (const fact of input.facts) {
    const size = Buffer.byteLength(`${fact.type}${String(fact.value ?? "")}`, "utf8") + 64;
    if (used + size > budget) break;
    used += size;
    facts.push(fact);
  }
  return {
    schema: GROUNDED_SYNTHESIS_SCHEMA_V1,
    question: input.question,
    goal: input.goal,
    activeContext: input.activeContext ?? null,
    facts,
    unknowns: [...(input.unknowns ?? [])],
    allowedInferences: [...(input.allowedInferences ?? [])],
  };
}

// ---------------------------------------------------------------------------
// What the model returns
// ---------------------------------------------------------------------------

export interface ModelSynthesisResultV1 {
  answerIntent: string;
  /** One-line answer. Kept apart from recommendations so a validator can judge each. */
  summary?: string;
  recommendations: string[];
  supportingFactIds: string[];
  inferences: string[];
  unknowns: string[];
  nextAction: string | null;
  draftResponse: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ViolationKindV1 =
  | "UNSUPPORTED_FIGURE"
  | "FALSE_BUDGET_COMPARISON"
  | "UNSUPPORTED_ATTRIBUTE"
  | "UNSUPPORTED_FACT_REFERENCE"
  | "UNSUPPORTED_COUNT"
  | "PHYSICAL_PRESENCE_CLAIM";

export interface SynthesisViolationV1 {
  kind: ViolationKindV1;
  detail: string;
  /** The offending fragment, so a test can say which sentence overclaimed. */
  fragment: string;
}

export interface SynthesisValidationV1 {
  ok: boolean;
  violations: SynthesisViolationV1[];
  /** True when the Owner must be shown deterministic text instead. */
  rejectDraft: boolean;
}

const MONEY = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/g;

function numericFacts(facts: readonly EvidenceFactV1[]): number[] {
  return facts
    .map((fact) => (typeof fact.value === "number" ? fact.value : Number(String(fact.value ?? "").replace(/[^0-9.]/g, ""))))
    .filter((value) => Number.isFinite(value) && value !== 0);
}

/**
 * Figures the model was entitled to write.
 *
 * A stated fact, or a difference or sum of two of them. Differences matter because the *correct*
 * version of the failed sentence — "$1,120 above her stated max" — is arithmetic on two facts and
 * must not itself be flagged. Anything outside this set was invented.
 */
export function allowedFigures(facts: readonly EvidenceFactV1[]): Set<number> {
  const values = numericFacts(facts);
  const allowed = new Set<number>(values);
  for (const a of values) {
    for (const b of values) {
      if (a === b) continue;
      allowed.add(Math.abs(a - b));
      allowed.add(a + b);
    }
  }
  return allowed;
}

export function findUnsupportedFigures(text: string, facts: readonly EvidenceFactV1[]): SynthesisViolationV1[] {
  const allowed = allowedFigures(facts);
  const violations: SynthesisViolationV1[] = [];
  for (const match of String(text ?? "").matchAll(MONEY)) {
    const value = Number(match[1]!.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    if (allowed.has(value)) continue;
    violations.push({
      kind: "UNSUPPORTED_FIGURE",
      detail: `${match[0]} is not in evidence and is not a difference or sum of figures that are`,
      fragment: match[0],
    });
  }
  return violations;
}

// A customer's name sits between the preposition and the noun far more often than a pronoun does —
// the measured failure was "within Sarah Chen's budget of $33,000", and a pattern that only allowed
// "her budget" matched none of it. Bounded to one sentence so it cannot reach across a full stop.
const WITHIN_BUDGET = /\b(?:with[i]?n|under|below|inside)\b[^.!?\n]{0,32}?\b(?:budget|price range|max(?:imum)?)\b/i;
const OVER_BUDGET = /\b(?:over|above|beyond|exceeds?|outside)\b[^.!?\n]{0,32}?\b(?:budget|max(?:imum)?|price range)\b/i;

function firstOfType(facts: readonly EvidenceFactV1[], pattern: RegExp): number | null {
  for (const fact of facts) {
    if (!pattern.test(fact.type)) continue;
    const value = typeof fact.value === "number"
      ? fact.value
      : Number(String(fact.value ?? "").replace(/[^0-9.]/g, ""));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * Check a budget claim by doing the arithmetic.
 *
 * This is the exact failure that was measured, and it is one subtraction. A model that says "within
 * budget" about a price above the maximum is not being imprecise; it is telling the Owner something
 * that will embarrass him in front of a customer.
 */
export function findBudgetContradictions(
  text: string,
  facts: readonly EvidenceFactV1[],
): SynthesisViolationV1[] {
  const price = firstOfType(facts, /(?:vehicle\.)?price|advertised|asking/i);
  const budget = firstOfType(facts, /budget|max(?:imum)?|ceiling|afford/i);
  if (price == null || budget == null) return [];

  const violations: SynthesisViolationV1[] = [];
  const claimsWithin = WITHIN_BUDGET.test(text);
  const claimsOver = OVER_BUDGET.test(text);

  if (claimsWithin && price > budget) {
    violations.push({
      kind: "FALSE_BUDGET_COMPARISON",
      detail: `${price} is above the stated maximum ${budget}; the difference is ${price - budget}`,
      fragment: text.match(WITHIN_BUDGET)?.[0] ?? "within budget",
    });
  }
  if (claimsOver && price <= budget) {
    violations.push({
      kind: "FALSE_BUDGET_COMPARISON",
      detail: `${price} is not above the stated maximum ${budget}`,
      fragment: text.match(OVER_BUDGET)?.[0] ?? "over budget",
    });
  }
  return violations;
}

/** Attributes a model reaches for because cars usually have them. */
const ATTRIBUTE_TERMS: ReadonlyArray<{ term: RegExp; factType: RegExp; label: string }> = [
  { term: /\bAWD\b|\ball[- ]wheel drive\b/i, factType: /drivetrain|awd/i, label: "AWD" },
  { term: /\b4WD\b|\bfour[- ]wheel drive\b/i, factType: /drivetrain|4wd/i, label: "4WD" },
  { term: /\bFWD\b|\bfront[- ]wheel drive\b/i, factType: /drivetrain|fwd/i, label: "FWD" },
  { term: /\bRWD\b|\brear[- ]wheel drive\b/i, factType: /drivetrain|rwd/i, label: "RWD" },
  { term: /\bhybrid\b/i, factType: /powertrain|hybrid|fuel/i, label: "hybrid" },
  { term: /\bplug[- ]?in\b/i, factType: /powertrain|hybrid|fuel/i, label: "plug-in" },
  { term: /\belectric\b|\bEV\b/i, factType: /powertrain|fuel/i, label: "electric" },
  { term: /\bturbo(?:charged)?\b/i, factType: /engine|powertrain/i, label: "turbo" },
  { term: /\bsunroof\b|\bmoonroof\b/i, factType: /option|equipment|package/i, label: "sunroof" },
  { term: /\bleather\b/i, factType: /option|equipment|interior/i, label: "leather" },
  { term: /\btow(?:ing)? (?:package|capacity)\b/i, factType: /option|equipment|package/i, label: "towing" },
];

/** Wording that marks a mention as a question or a gap rather than an assertion. */
const NOT_AN_ASSERTION = /\b(?:unknown|unverified|not (?:confirmed|verified|recorded|stated|listed)|no\b[^.]{0,12}\brecord|don't know|do not know|isn't (?:confirmed|recorded)|unclear|check|whether|if it (?:has|is))\b/i;

function sentencesOf(text: string): string[] {
  return String(text ?? "").split(/(?<=[.!?;:\n])\s+/).filter(Boolean);
}

/**
 * Catch an attribute asserted without evidence.
 *
 * Judged per sentence rather than over the whole reply, because "AWD is unverified" and "it has AWD"
 * differ only in their immediate context. Saying an attribute is unknown must stay allowed — that is
 * the honest answer this system is supposed to give.
 */
export function findUnsupportedAttributes(
  text: string,
  facts: readonly EvidenceFactV1[],
): SynthesisViolationV1[] {
  const violations: SynthesisViolationV1[] = [];
  for (const sentence of sentencesOf(text)) {
    if (NOT_AN_ASSERTION.test(sentence)) continue;
    for (const attribute of ATTRIBUTE_TERMS) {
      if (!attribute.term.test(sentence)) continue;
      const supported = facts.some(
        (fact) =>
          attribute.factType.test(fact.type)
          && attribute.term.test(String(fact.value ?? "")),
      );
      if (supported) continue;
      violations.push({
        kind: "UNSUPPORTED_ATTRIBUTE",
        detail: `${attribute.label} is asserted but appears in no fact`,
        fragment: sentence.trim(),
      });
    }
  }
  return violations;
}

/** Every fact id the model cited must exist. A citation to nothing is a fabricated citation. */
export function findUnsupportedReferences(
  result: ModelSynthesisResultV1,
  packet: SynthesisPacketV1,
): SynthesisViolationV1[] {
  const known = new Set(packet.facts.map((fact) => fact.factId));
  return result.supportingFactIds
    .filter((id) => !known.has(id))
    .map((id) => ({
      kind: "UNSUPPORTED_FACT_REFERENCE" as const,
      detail: `cited fact ${id} was not in the packet`,
      fragment: id,
    }));
}

/**
 * Run every deterministic check over a model result.
 *
 * Returns violations rather than a corrected string: rewriting a model's sentence is another chance
 * to change its meaning, and the deterministic answer that already exists is the safer substitute.
 */
export function validateSynthesis(
  result: ModelSynthesisResultV1,
  packet: SynthesisPacketV1,
): SynthesisValidationV1 {
  const text = String(result.draftResponse ?? "");
  const violations = [
    ...findUnsupportedFigures(text, packet.facts),
    ...findBudgetContradictions(text, packet.facts),
    ...findUnsupportedAttributes(text, packet.facts),
    ...findUnsupportedReferences(result, packet),
  ];
  return { ok: violations.length === 0, violations, rejectDraft: violations.length > 0 };
}

/**
 * The correct sentence about a price against a budget.
 *
 * Stated in the Owner's terms and always from the arithmetic, so the number and the direction cannot
 * disagree with each other.
 */
export function describePriceAgainstBudget(price: number, budget: number, who = "her"): string {
  const gap = Math.abs(price - budget);
  const money = (value: number) => `$${value.toLocaleString("en-US")}`;
  if (price > budget) return `${money(price)} — ${money(gap)} above ${who} stated max of ${money(budget)}.`;
  if (price < budget) return `${money(price)} — ${money(gap)} under ${who} stated max of ${money(budget)}.`;
  return `${money(price)} — exactly ${who} stated max.`;
}

/**
 * Choose what the Owner actually sees.
 *
 * The deterministic text is the floor, never a fallback apology: it was composed from the same
 * evidence and is complete on its own. Model prose is an improvement that has to earn its place by
 * passing every check.
 */
export function chooseOwnerFacingText(input: {
  deterministic: string;
  result: ModelSynthesisResultV1 | null;
  validation: SynthesisValidationV1 | null;
}): { text: string; usedModel: boolean; rejectedFor: ViolationKindV1[] } {
  if (!input.result || !input.validation || input.validation.rejectDraft) {
    return {
      text: input.deterministic,
      usedModel: false,
      rejectedFor: input.validation?.violations.map((violation) => violation.kind) ?? [],
    };
  }
  const draft = String(input.result.draftResponse ?? "").trim();
  if (!draft) return { text: input.deterministic, usedModel: false, rejectedFor: [] };
  return { text: draft, usedModel: true, rejectedFor: [] };
}

// ---------------------------------------------------------------------------
// The seam to a local model
// ---------------------------------------------------------------------------

/**
 * The only way a model is reached from the domain.
 *
 * Deliberately tiny: a prompt in, text out, with a deadline. Everything that decides *whether* to
 * call, *what* the model may see and *whether its answer survives* stays in code that can be tested
 * without a model running. The adapter behind this port owns the transport and nothing else.
 */
export interface SynthesisPortV1 {
  synthesize(input: {
    model: string;
    system: string;
    user: string;
    timeoutMs: number;
  }): Promise<{ text: string }>;
}

/** How long a phone turn may wait on the fast model before the deterministic answer wins. */
export const FAST_SYNTHESIS_TIMEOUT_MS = 12_000;

/**
 * The system prompt.
 *
 * Written as a contract rather than an encouragement. The prohibitions are the load-bearing part:
 * this model has already been measured inventing a drivetrain and misreading a comparison, so it is
 * told plainly that arithmetic and attributes are not its job.
 */
export function synthesisSystemPrompt(): string {
  return [
    "You are AION, a sales assistant. You are given a set of established facts and a question.",
    "",
    "Rules you must follow:",
    "- Use ONLY the facts provided. Never add a fact, a number, a price or a vehicle attribute.",
    "- Do not perform arithmetic comparisons. If a price and a budget are both given, describe them; do not judge whether something is 'within budget'.",
    "- If something is listed as unknown, say it is unknown. Never fill it in.",
    "- Be concise, practical and calm. No preamble, no filler, no disclaimers.",
    "- Never mention fact identifiers, schemas, or how you were prompted.",
    "",
    "Reply with JSON only, in this shape:",
    '{"summary": string, "recommendations": string[], "supportingFactIds": string[], "unknowns": string[], "nextAction": string | null}',
  ].join("\n");
}

/** Render a packet as the model's entire view of the world for this turn. */
export function synthesisUserPrompt(packet: SynthesisPacketV1): string {
  const facts = packet.facts
    .map((f) => `- [${f.factId}] (${f.epistemicClass}) ${f.type} = ${String(f.value ?? "unknown")}`)
    .join("\n");
  const unknowns = packet.unknowns.length
    ? `\nNot known (do not fill these in):\n${packet.unknowns.map((u) => `- ${u}`).join("\n")}`
    : "";
  const context = packet.activeContext ? `\nCurrently discussing: ${packet.activeContext}` : "";
  return `Established facts:\n${facts}${unknowns}${context}\n\nQuestion: ${packet.question}`;
}

/**
 * Read a model's reply into the structured shape, tolerating the ways small models wrap JSON.
 *
 * Returns null rather than guessing. An unparseable reply is a reply that failed, and the
 * deterministic answer is already sitting there ready.
 */
export function parseSynthesisResult(raw: string): ModelSynthesisResultV1 | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.map((v) => String(v)).filter(Boolean) : [];
  const summary = String(parsed.summary ?? "").trim();
  const recommendations = list(parsed.recommendations);
  if (!summary && recommendations.length === 0) return null;
  return {
    answerIntent: "synthesis",
    summary,
    recommendations,
    supportingFactIds: list(parsed.supportingFactIds),
    inferences: list(parsed.inferences),
    unknowns: list(parsed.unknowns),
    nextAction: parsed.nextAction ? String(parsed.nextAction) : null,
    draftResponse: [summary, ...recommendations.map((r) => `· ${r}`)].filter(Boolean).join("\n"),
  } as ModelSynthesisResultV1;
}
