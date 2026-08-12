/**
 * Reading vehicle wants out of what someone actually said.
 *
 * The whole difficulty is strength, not vocabulary. "I need AWD" and "AWD would be nice" name the
 * same feature and mean completely different things at the point where a salesperson decides which
 * car to walk a customer to. Getting that wrong in the confident direction is worse than extracting
 * nothing: a preference promoted to a hard requirement silently deletes half the inventory, and a
 * hard requirement demoted to a preference walks someone to a car they already told you they can't
 * use.
 *
 * So hedged language never produces a requirement, negation is detected before the feature rather
 * than after, and anything that cannot be read confidently is simply not extracted. Nothing here
 * infers credit, income, financing, equipment-from-trim, or anything about the person.
 */
import type { CustomerNeedV1, NeedAttributeV1, NeedStrengthV1 } from "./customer-needs.js";

export interface ExtractedNeedV1 {
  attribute: NeedAttributeV1;
  value: string;
  numericValue: number | null;
  strength: NeedStrengthV1;
  confidence: number;
  /** The words this came from, so the Owner can check it. */
  quote: string;
  sourceRef: string;
}

// --- Strength cues -----------------------------------------------------------------------------

/** "need", "must", "has to", "have to", "required" — a requirement. */
const HARD = /\b(?:i (?:need|require)|needs? to (?:have|be)|must (?:have|be)|has to (?:have|be)|have to (?:have|be)|required?|non-?negotiable|deal ?breaker)\b/i;
/** "prefer", "would like", "would be nice", "ideally" — a preference. */
const PREF = /\b(?:i(?:'d| would) (?:prefer|like|rather)|prefer|preferably|ideally|would be (?:nice|good|great)|hoping for|leaning toward)\b/i;
/** "maybe", "might", "thinking about", "considering" — not a decision at all. */
const HEDGE = /\b(?:maybe|might|possibly|probably|thinking about|considering|open to|not sure|we'?ll see|perhaps|could go either way|might consider)\b/i;
/** "don't want", "no", "avoid", "anything but" — an exclusion. */
const NEGATION = /\b(?:i (?:don'?t|do not|really don'?t) want|no more|not interested in|avoid|anything but|rule out|ruled out|absolutely no|definitely not|nothing with|won'?t take|can'?t have)\b/i;

/** Emphasis raises confidence in an exclusion but never converts a preference into a requirement. */
const EMPHATIC = /\b(?:absolutely|definitely|really|under no circumstances|no way)\b/i;

// --- Vocabulary --------------------------------------------------------------------------------

const MAKES = ["toyota", "honda", "ford", "chevrolet", "chevy", "nissan", "hyundai", "kia", "subaru", "mazda", "lexus"];
const MODELS = [
  "camry", "corolla", "rav4", "rav-4", "highlander", "tacoma", "tundra", "4runner", "sienna",
  "prius", "venza", "sequoia", "crown", "avalon", "bz4x", "grand highlander", "corolla cross",
];
const TRIMS = ["le", "se", "xle", "xse", "limited", "platinum", "trd", "sr5", "capstone", "nightshade", "adventure", "woodland", "trailhunter"];
const COLORS = ["black", "white", "silver", "grey", "gray", "red", "blue", "dark blue", "navy", "green", "beige", "tan", "brown", "gold"];
const DRIVETRAIN = ["awd", "all wheel drive", "all-wheel drive", "4wd", "four wheel drive", "fwd", "front wheel drive", "rwd"];
const POWERTRAIN = ["hybrid", "plug-in hybrid", "plug in hybrid", "electric", "ev", "gas", "gasoline", "diesel"];

/** Spoken numbers AION can read without guessing. */
const NUMBER_WORDS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/**
 * Read a price when — and only when — the units are clear.
 *
 * "Under thirty-five thousand" is unambiguous. A bare "under 500" is not: it could be a monthly
 * payment or a wildly implausible car price, and picking one would be inventing a fact about
 * someone's budget. Ambiguous magnitudes return null rather than a guess.
 */
export function parseSpokenAmount(text: string): { amount: number; kind: "VEHICLE_PRICE" | "MONTHLY_PAYMENT" | "AMBIGUOUS" } | null {
  const lower = text.toLowerCase();
  const monthly = /\b(?:a|per|each) month\b|\bmonthly\b|\bpayment\b|\/mo\b/.test(lower);

  // "thirty-five thousand", "thirty five grand", "35 thousand", "35k", "$35,000"
  const wordMatch = lower.match(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]?(one|two|three|four|five|six|seven|eight|nine)?\s*(thousand|grand|k)\b/);
  if (wordMatch) {
    const tens = NUMBER_WORDS[wordMatch[1]!] ?? 0;
    const ones = wordMatch[2] ? ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 } as Record<string, number>)[wordMatch[2]] ?? 0 : 0;
    const amount = (tens + ones) * 1000;
    return { amount, kind: monthly ? "MONTHLY_PAYMENT" : "VEHICLE_PRICE" };
  }

  // "five hundred", "two fifty" — how people usually say a monthly payment out loud. Recognised so
  // the amount is not simply lost; the units still come from context, never from the magnitude.
  const hundredsMatch = lower.match(/\b(one|two|three|four|five|six|seven|eight|nine)\s*hundred\b/);
  if (hundredsMatch) {
    const ones = ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 } as Record<string, number>)[hundredsMatch[1]!] ?? 0;
    const amount = ones * 100;
    // Hundreds are a plausible payment and an implausible car price, so without an explicit monthly
    // cue this stays ambiguous rather than becoming a budget.
    return { amount, kind: monthly ? "MONTHLY_PAYMENT" : "AMBIGUOUS" };
  }

  const digitMatch = lower.match(/\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(thousand|grand|k)?\b/);
  if (digitMatch) {
    const raw = Number(digitMatch[1]!.replace(/,/g, ""));
    if (!Number.isFinite(raw)) return null;
    const scaled = digitMatch[2] ? raw * 1000 : raw;
    if (monthly) return { amount: scaled, kind: "MONTHLY_PAYMENT" };
    // A bare number under 1,000 with no unit could be a payment or a truncated price. Refuse it.
    if (!digitMatch[2] && scaled < 1000) return { amount: scaled, kind: "AMBIGUOUS" };
    // Bare four-figure numbers are likewise unsafe as vehicle prices in speech.
    if (!digitMatch[2] && scaled < 10_000) return { amount: scaled, kind: "AMBIGUOUS" };
    return { amount: scaled, kind: "VEHICLE_PRICE" };
  }
  return null;
}

function strengthOf(sentence: string, featureIndex: number): { strength: NeedStrengthV1; confidence: number } {
  // Negation is checked against the words *before* the feature: "I don't want a hybrid" negates,
  // while "I want a hybrid, not a diesel" does not negate the hybrid.
  const before = sentence.slice(0, featureIndex);
  if (NEGATION.test(before)) {
    return { strength: "EXCLUSION", confidence: EMPHATIC.test(before) ? 95 : 85 };
  }
  // Hedging beats everything else. "Maybe I need AWD" is not a requirement.
  if (HEDGE.test(sentence)) return { strength: "UNKNOWN", confidence: 35 };
  if (HARD.test(sentence)) return { strength: "HARD_REQUIREMENT", confidence: 90 };
  if (PREF.test(sentence)) return { strength: "PREFERENCE", confidence: 80 };
  return { strength: "PREFERENCE", confidence: 65 };
}

function findTerm(sentence: string, terms: readonly string[]): { term: string; index: number } | null {
  const lower = sentence.toLowerCase();
  let best: { term: string; index: number } | null = null;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx < 0) continue;
    // Word boundary — "se" must not match inside "sedan", "ev" inside "every".
    const before = idx === 0 ? "" : lower[idx - 1]!;
    const after = lower[idx + term.length] ?? "";
    if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) continue;
    if (!best || term.length > best.term.length) best = { term, index: idx };
  }
  return best;
}

/**
 * Extract needs from one sentence.
 *
 * Sentence-level rather than whole-transcript, because strength cues bind to the clause that
 * contains them: "I need AWD, and dark blue would be nice" holds a requirement and a preference, and
 * reading it as a whole would flatten both into one.
 */
export function extractNeedsFromSentence(input: { text: string; sourceRef: string }): ExtractedNeedV1[] {
  const sentence = String(input.text ?? "").trim();
  if (!sentence) return [];
  const out: ExtractedNeedV1[] = [];

  const push = (attribute: NeedAttributeV1, value: string, index: number, numericValue: number | null = null) => {
    const { strength, confidence } = strengthOf(sentence, index);
    out.push({ attribute, value, numericValue, strength, confidence, quote: sentence.slice(0, 200), sourceRef: input.sourceRef });
  };

  const model = findTerm(sentence, MODELS);
  if (model) push("model", model.term.replace("rav-4", "rav4"), model.index);

  const make = findTerm(sentence, MAKES);
  if (make) push("make", make.term === "chevy" ? "chevrolet" : make.term, make.index);

  // A trim is only meaningful alongside a model or an explicit trim word; otherwise "limited" and
  // "se" appear constantly in ordinary speech.
  const trim = findTerm(sentence, TRIMS);
  if (trim && (model || /\btrim\b/i.test(sentence))) push("trim", trim.term, trim.index);

  const color = findTerm(sentence, COLORS);
  if (color) push("color", color.term, color.index);

  const drivetrain = findTerm(sentence, DRIVETRAIN);
  if (drivetrain) {
    const normalized = /awd|all.wheel/.test(drivetrain.term) ? "awd"
      : /4wd|four.wheel/.test(drivetrain.term) ? "4wd"
      : /fwd|front.wheel/.test(drivetrain.term) ? "fwd" : "rwd";
    push("must-have", normalized, drivetrain.index);
  }

  const powertrain = findTerm(sentence, POWERTRAIN);
  if (powertrain) {
    const normalized = /plug/.test(powertrain.term) ? "plug-in hybrid"
      : powertrain.term === "ev" ? "electric"
      : powertrain.term === "gas" ? "gasoline" : powertrain.term;
    push("powertrain", normalized, powertrain.index);
  }

  if (/\b(new|brand new)\b/i.test(sentence)) {
    const idx = sentence.toLowerCase().indexOf("new");
    push("condition", "new", idx);
  } else if (/\b(used|pre-?owned|second hand)\b/i.test(sentence)) {
    const idx = sentence.toLowerCase().search(/\b(used|pre-?owned|second hand)\b/i);
    push("condition", "used", idx);
  }

  const amount = parseSpokenAmount(sentence);
  if (amount && amount.kind !== "AMBIGUOUS") {
    const idx = sentence.search(/\$?\d|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety/i);
    const isCeiling = /\b(?:under|below|less than|no more than|max|maximum|up to|at most|keep it under|stay under)\b/i.test(sentence);
    if (amount.kind === "MONTHLY_PAYMENT") {
      push("payment-target", String(amount.amount), Math.max(0, idx), amount.amount);
    } else if (isCeiling) {
      // A ceiling is a limit the customer stated. It is a requirement unless hedged.
      const { strength, confidence } = strengthOf(sentence, Math.max(0, idx));
      out.push({
        attribute: "max-price",
        value: String(amount.amount),
        numericValue: amount.amount,
        strength: strength === "UNKNOWN" ? "UNKNOWN" : "HARD_REQUIREMENT",
        confidence: strength === "UNKNOWN" ? 35 : Math.max(confidence, 85),
        quote: sentence.slice(0, 200),
        sourceRef: input.sourceRef,
      });
    }
    // "around thirty grand" with no ceiling word is a target, not a maximum — deliberately not
    // recorded as max-price, because treating it as one would hide cars the customer would buy.
  }

  return out;
}

/** Extract across a set of segments, splitting into sentences so strength cues stay local. */
export function extractNeedsFromSegments(
  segments: readonly { index: number; text: string; speaker: string }[],
  eventId: string,
): ExtractedNeedV1[] {
  const out: ExtractedNeedV1[] = [];
  for (const segment of segments) {
    const sentences = String(segment.text ?? "").split(/(?<=[.!?])\s+/).filter(Boolean);
    for (const sentence of sentences) {
      out.push(...extractNeedsFromSentence({ text: sentence, sourceRef: `conversation:${eventId}#${segment.index}` }));
    }
  }
  return out;
}

/**
 * Turn an extraction into a durable need.
 *
 * `UNKNOWN`-strength extractions are dropped here rather than stored: a hedge is something the
 * Owner might want to ask about, not something to record as what the customer wants.
 */
export function toDurableNeeds(input: {
  extracted: readonly ExtractedNeedV1[];
  workspace: string;
  relationshipRef: string;
  observedAt: string;
  nextId: (n: number) => string;
}): CustomerNeedV1[] {
  return input.extracted
    .filter((e) => e.strength !== "UNKNOWN")
    .map((e, i) => ({
      id: input.nextId(i),
      workspace: input.workspace,
      relationshipRef: input.relationshipRef,
      attribute: e.attribute,
      value: e.value,
      numericValue: e.numericValue,
      strength: e.strength,
      confidence: e.confidence,
      sourceRef: e.sourceRef,
      observedAt: input.observedAt,
      supersededAt: null,
      supersededBy: null,
      invalidatedAt: null,
      invalidationReason: null,
    }));
}

/**
 * Explicit change of mind, e.g. "I don't want the Camry anymore, I want a RAV4".
 *
 * Only an explicit reversal supersedes. "I might consider a RAV4" must not overturn a stated Camry
 * requirement — a hedge is not a decision, and treating it as one loses what the customer actually
 * committed to.
 */
export function isExplicitChangeOfMind(sentence: string): boolean {
  if (HEDGE.test(sentence)) return false;
  return /\b(?:changed my mind|instead of|not .* anymore|no longer want|forget the|scratch that|actually,? i want)\b/i.test(sentence);
}
