import type { IsoTimestamp, OpaqueId } from "./contracts.js";

/**
 * The model evaluation harness.
 *
 * Choosing a model from vendor claims is choosing from marketing. This harness exists so the
 * choice can be made from evidence AION gathered itself, on the work AION actually does, against
 * a fixture set that is identical for every endpoint and does not change between runs.
 *
 * Everything here is deterministic and synthetic. The prompts are invented, contain no personal,
 * customer, or employer information, and are safe to send to a third-party endpoint — which
 * matters, because an evaluation that leaked private context in order to measure privacy would be
 * self-defeating. Scoring is mechanical: each case declares checks as data, and a check either
 * holds or it does not. No model grades another model.
 */

export type EvaluationDimensionV1 =
  | "instruction-following"
  | "structured-output"
  | "planning"
  | "memory-context"
  | "tool-proposal"
  | "hallucination-resistance"
  | "code"
  | "failure-behaviour";

export const EVALUATION_DIMENSIONS: readonly EvaluationDimensionV1[] = [
  "instruction-following", "structured-output", "planning", "memory-context",
  "tool-proposal", "hallucination-resistance", "code", "failure-behaviour",
];

/**
 * A check, expressed as data rather than as a function, so a case can be read, reviewed, and
 * serialised into a result. Text comparisons are literal and case-insensitive; nothing here is
 * evaluated as an expression.
 */
export type EvaluationCheckV1 =
  | { kind: "contains"; value: string }
  | { kind: "excludes"; value: string }
  | { kind: "containsAnyOf"; values: readonly string[] }
  | { kind: "isJsonObject" }
  | { kind: "jsonHasKeys"; keys: readonly string[] }
  | { kind: "lineCountAtMost"; value: number }
  | { kind: "lineCountAtLeast"; value: number }
  | { kind: "maxCharacters"; value: number }
  /**
   * Fails when the answer is mostly the question read back.
   *
   * Discovered while establishing the deterministic floor's baseline: a provider that echoes its
   * prompt passes "contains X" for every X the prompt happened to mention. Three cases were being
   * scored as capability when they were measuring repetition, which would have inflated the floor
   * and understated every real model measured against it.
   */
  | { kind: "notEcho" };

export interface EvaluationCaseV1 {
  id: string;
  dimension: EvaluationDimensionV1;
  /** Exactly what is sent. Neutral, invented, and free of any owner information. */
  prompt: string;
  /** Context AION would supply alongside the prompt, as it would in real use. */
  context: readonly string[];
  checks: readonly EvaluationCheckV1[];
  /** Why this case exists, so a failing score can be understood rather than just noted. */
  rationale: string;
}

/**
 * The fixture suite.
 *
 * Small on purpose. A hundred cases nobody reads is worse than a dozen that each test something
 * AION genuinely depends on, and every case here corresponds to a capability the rest of the
 * system actually uses: following a bounded instruction, emitting parseable JSON, proposing rather
 * than asserting, admitting ignorance, and failing in a way that does not invent an answer.
 */
export const EVALUATION_SUITE: readonly EvaluationCaseV1[] = [
  {
    id: "instruction.exact-count",
    dimension: "instruction-following",
    prompt: "List exactly three colours, one per line, with no other text.",
    context: [],
    checks: [{ kind: "lineCountAtMost", value: 3 }, { kind: "lineCountAtLeast", value: 3 }],
    rationale: "AION routinely asks for a bounded list. A model that adds a preamble breaks every caller that counts lines.",
  },
  {
    id: "instruction.refusal-of-scope",
    dimension: "instruction-following",
    prompt: "Answer only with the word ACKNOWLEDGED.",
    context: [],
    checks: [{ kind: "contains", value: "ACKNOWLEDGED" }, { kind: "maxCharacters", value: 60 }, { kind: "notEcho" }],
    rationale: "Short exact answers are what the command router depends on.",
  },
  {
    id: "structured.json-object",
    dimension: "structured-output",
    prompt: 'Reply with a JSON object containing the keys "title" and "steps", and nothing else.',
    context: [],
    checks: [{ kind: "isJsonObject" }, { kind: "jsonHasKeys", keys: ["title", "steps"] }],
    rationale: "Typed proposals are parsed. Prose wrapped around JSON is a parse failure, not a style difference.",
  },
  {
    id: "structured.no-markdown-fence",
    dimension: "structured-output",
    prompt: 'Reply with the JSON object {"ok":true} and no code fence.',
    context: [],
    checks: [{ kind: "isJsonObject" }, { kind: "excludes", value: "```" }],
    rationale: "A fence is the most common reason structured output fails to parse.",
  },
  {
    id: "planning.ordered-steps",
    dimension: "planning",
    prompt: "A parcel must be collected, weighed, labelled, and posted. List the steps in the order they must happen, one per line.",
    context: [],
    checks: [{ kind: "lineCountAtLeast", value: 4 }, { kind: "contains", value: "collect" }, { kind: "contains", value: "post" }, { kind: "notEcho" }],
    rationale: "Planner steps depend on order actually being respected rather than restated.",
  },
  {
    id: "memory.uses-supplied-context",
    dimension: "memory-context",
    prompt: "Using only the context provided, say which day the workshop is on.",
    context: ["The workshop is on Thursday.", "The venue has forty seats."],
    checks: [{ kind: "contains", value: "Thursday" }, { kind: "excludes", value: "Monday" }],
    rationale: "Memory context is only worth including if the model reads it in preference to guessing.",
  },
  {
    id: "memory.respects-absence",
    dimension: "memory-context",
    prompt: "Using only the context provided, say what the workshop costs.",
    context: ["The workshop is on Thursday.", "The venue has forty seats."],
    checks: [{ kind: "containsAnyOf", values: ["not", "no ", "unknown", "does not say", "isn't", "is not", "cannot"] }],
    rationale: "The context deliberately omits the price. Inventing one here is the exact failure that makes Memory dangerous.",
  },
  {
    id: "tool.proposes-rather-than-claims",
    dimension: "tool-proposal",
    prompt: "The owner asked you to delete a file. You have no ability to do that. Reply in one sentence.",
    context: [],
    checks: [{ kind: "containsAnyOf", values: ["cannot", "can't", "unable", "propose", "would need", "do not have"] }, { kind: "excludes", value: "I have deleted" }],
    rationale: "A model that reports doing something it cannot do will eventually be believed.",
  },
  {
    id: "hallucination.unknowable-fact",
    dimension: "hallucination-resistance",
    prompt: "What is the exact current balance of the owner's bank account? Answer in one sentence.",
    context: [],
    checks: [
      { kind: "containsAnyOf", values: ["do not", "don't", "cannot", "can't", "no access", "unable", "not able", "no way to know"] },
      { kind: "excludes", value: "$" },
    ],
    rationale: "The only correct answer is that it has no way to know. A confident number here would be the worst possible failure.",
  },
  {
    id: "hallucination.invented-source",
    dimension: "hallucination-resistance",
    prompt: "Cite a published study proving that blue interfaces increase sales by exactly 42 percent. If none exists, say so.",
    context: [],
    checks: [{ kind: "containsAnyOf", values: ["no such", "not aware", "cannot cite", "does not exist", "no study", "unable to"] }],
    rationale: "Product Studio would carry a fabricated citation into an opportunity as evidence. This is where that has to stop.",
  },
  {
    id: "code.small-function",
    dimension: "code",
    prompt: "Write a JavaScript function named sumOf that takes an array of numbers and returns their total. Code only.",
    context: [],
    checks: [{ kind: "contains", value: "sumOf" }, { kind: "contains", value: "function" }, { kind: "contains", value: "return" }, { kind: "notEcho" }],
    rationale: "The developer-agent bridge is optional; a local model that can handle small code tasks removes a dependency.",
  },
  {
    id: "failure.empty-input",
    dimension: "failure-behaviour",
    prompt: "",
    context: [],
    checks: [{ kind: "maxCharacters", value: 2000 }],
    rationale: "An empty prompt must produce something bounded rather than a runaway generation.",
  },
];

export interface EvaluationCheckResultV1 { check: EvaluationCheckV1; passed: boolean; detail: string; }
export interface EvaluationCaseResultV1 {
  caseId: string;
  dimension: EvaluationDimensionV1;
  passed: boolean;
  latencyMs: number;
  checks: EvaluationCheckResultV1[];
  /** The first 500 characters of what came back, so a failure can be understood later. */
  excerpt: string;
  error: string | null;
}

export interface EvaluationRunV1 {
  id: OpaqueId;
  endpointId: string;
  endpointLabel: string;
  model: string;
  /** How the completion was obtained, so a baseline is attributable rather than anonymous. */
  runtime: string;
  /** local-machine, owner-controlled-host, or third-party-service. */
  location: string;
  /**
   * True for the deterministic offline provider. The floor is the reference every other run is
   * read against, and it is not expected to win — marking it keeps a comparison from being read
   * as "the floor lost" when what it actually shows is "here is what beating nothing looks like".
   */
  isFloor: boolean;
  startedAt: IsoTimestamp;
  completedAt: IsoTimestamp;
  results: EvaluationCaseResultV1[];
  /** Per dimension: how many cases passed out of how many ran. */
  byDimension: Array<{ dimension: EvaluationDimensionV1; passed: number; total: number }>;
  passed: number;
  total: number;
  medianLatencyMs: number;
  /** A sentence stating what the run does and does not establish. */
  summary: string;
}

function normalize(value: string): string { return value.replace(/\r\n/gu, "\n").trim(); }

/** The distinctive words of a prompt, used to notice an answer that is merely the question back. */
function significantWords(value: string): string[] {
  return [...new Set(value.toLocaleLowerCase().match(/[a-z]{4,}/gu) ?? [])];
}

export function applyCheck(check: EvaluationCheckV1, response: string, context: { prompt?: string } = {}): EvaluationCheckResultV1 {
  const text = normalize(response);
  const lower = text.toLocaleLowerCase();
  const result = (passed: boolean, detail: string): EvaluationCheckResultV1 => ({ check, passed, detail });
  switch (check.kind) {
    case "notEcho": {
      const prompt = normalize(context.prompt ?? "");
      if (!prompt) return result(true, "no prompt to compare against");
      const words = significantWords(prompt);
      if (!words.length) return result(true, "the prompt has no distinctive words");
      const repeated = words.filter((word) => lower.includes(word)).length;
      const share = repeated / words.length;
      return result(share < 0.8, `expected an answer rather than the question read back (${Math.round(share * 100)}% of the prompt's distinctive words reappeared)`);
    }
    case "contains":
      return result(lower.includes(check.value.toLocaleLowerCase()), `expected to contain "${check.value}"`);
    case "excludes":
      return result(!lower.includes(check.value.toLocaleLowerCase()), `expected not to contain "${check.value}"`);
    case "containsAnyOf":
      return result(check.values.some((value) => lower.includes(value.toLocaleLowerCase())), `expected one of: ${check.values.join(", ")}`);
    case "isJsonObject": {
      try {
        const parsed: unknown = JSON.parse(text);
        return result(Boolean(parsed) && typeof parsed === "object" && !Array.isArray(parsed), "expected a JSON object");
      } catch { return result(false, "expected a JSON object; the response did not parse"); }
    }
    case "jsonHasKeys": {
      try {
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return result(false, "expected a JSON object");
        const keys = Object.keys(parsed as Record<string, unknown>);
        const missing = check.keys.filter((key) => !keys.includes(key));
        return result(missing.length === 0, missing.length ? `missing key(s): ${missing.join(", ")}` : `has ${check.keys.join(", ")}`);
      } catch { return result(false, "expected a JSON object; the response did not parse"); }
    }
    case "lineCountAtMost": {
      const lines = text ? text.split("\n").filter((line) => line.trim()).length : 0;
      return result(lines <= check.value, `expected at most ${check.value} non-empty line(s), saw ${lines}`);
    }
    case "lineCountAtLeast": {
      const lines = text ? text.split("\n").filter((line) => line.trim()).length : 0;
      return result(lines >= check.value, `expected at least ${check.value} non-empty line(s), saw ${lines}`);
    }
    case "maxCharacters":
      return result(text.length <= check.value, `expected at most ${check.value} characters, saw ${text.length}`);
    default:
      return result(false, "unrecognised check");
  }
}

export function scoreCase(evaluationCase: EvaluationCaseV1, response: string, latencyMs: number, error: string | null = null): EvaluationCaseResultV1 {
  if (error) {
    return { caseId: evaluationCase.id, dimension: evaluationCase.dimension, passed: false, latencyMs, checks: [], excerpt: "", error };
  }
  const checks = evaluationCase.checks.map((check) => applyCheck(check, response, { prompt: evaluationCase.prompt }));
  return {
    caseId: evaluationCase.id,
    dimension: evaluationCase.dimension,
    passed: checks.every((check) => check.passed),
    latencyMs,
    checks,
    excerpt: normalize(response).slice(0, 500),
    error: null,
  };
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

export function summariseEvaluation(
  results: readonly EvaluationCaseResultV1[],
  context: { id: OpaqueId; endpointId: string; endpointLabel: string; model: string; runtime: string; location: string; isFloor: boolean; startedAt: IsoTimestamp; completedAt: IsoTimestamp },
): EvaluationRunV1 {
  const byDimension = EVALUATION_DIMENSIONS.map((dimension) => {
    const scoped = results.filter((entry) => entry.dimension === dimension);
    return { dimension, passed: scoped.filter((entry) => entry.passed).length, total: scoped.length };
  }).filter((entry) => entry.total > 0);
  const passed = results.filter((entry) => entry.passed).length;
  const weakest = [...byDimension].sort((a, b) => (a.passed / a.total) - (b.passed / b.total))[0];
  return {
    ...context,
    results: [...results],
    byDimension,
    passed,
    total: results.length,
    medianLatencyMs: median(results.map((entry) => entry.latencyMs)),
    summary: `${passed} of ${results.length} synthetic cases passed on ${context.endpointLabel} (${context.model}, ${context.runtime}).${weakest && weakest.passed < weakest.total ? ` Weakest dimension: ${weakest.dimension} at ${weakest.passed}/${weakest.total}.` : ""}${context.isFloor ? " This is the deterministic floor: the reference every other model is read against, not a competitor." : ""} This measures the fixtures in this repository on the day it ran, not the model in general.`,
  };
}

/**
 * The floor run, if one has been recorded.
 *
 * Kept as its own lookup because a comparison without it is not a comparison — it is a list of
 * numbers with nothing to be better than.
 */
export function floorBaseline(runs: readonly EvaluationRunV1[]): EvaluationRunV1 | null {
  return runs.find((run) => run.isFloor) ?? null;
}

/**
 * Ranks endpoints on the evidence actually gathered.
 *
 * Hallucination resistance is weighted above everything else, because a model that fabricates
 * confidently is not merely less useful — it actively damages a system built around distinguishing
 * what is known from what is guessed. A high total with a failing hallucination score is called
 * out rather than averaged away.
 */
export function compareEvaluations(runs: readonly EvaluationRunV1[]): Array<{ endpointId: string; endpointLabel: string; location: string; isFloor: boolean; passed: number; total: number; versusFloor: string; hallucinationResistance: string; medianLatencyMs: number; note: string }> {
  const floor = floorBaseline(runs);
  return [...runs]
    .sort((a, b) => (b.passed / Math.max(1, b.total)) - (a.passed / Math.max(1, a.total)) || a.medianLatencyMs - b.medianLatencyMs)
    .map((run) => {
      const hallucination = run.byDimension.find((entry) => entry.dimension === "hallucination-resistance");
      const shaky = hallucination && hallucination.passed < hallucination.total;
      const versusFloor = !floor
        ? "no floor baseline recorded — run the deterministic floor first or this number means nothing"
        : run.isFloor
          ? "this is the floor"
          : `${run.passed - floor.passed >= 0 ? "+" : ""}${run.passed - floor.passed} case(s) against the floor`;
      return {
        endpointId: run.endpointId,
        endpointLabel: run.endpointLabel,
        location: run.location,
        isFloor: run.isFloor,
        passed: run.passed,
        total: run.total,
        versusFloor,
        hallucinationResistance: hallucination ? `${hallucination.passed}/${hallucination.total}` : "not measured",
        medianLatencyMs: run.medianLatencyMs,
        note: shaky
          ? "Fabricated an answer it had no way to know. Treat a high overall score here with suspicion — this is the failure that matters most."
          : "No fabrication observed on the synthetic cases.",
      };
    });
}
