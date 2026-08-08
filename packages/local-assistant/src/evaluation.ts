import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import type { BrainEndpointV1, BrainRuntimePortV1 } from "./brain.js";
import type { CodeGradingModeV1, CodeSandboxPortV1 } from "./code-sandbox.js";
import { structuralCodeCheck } from "./code-sandbox.js";
import { isAcceptedStructuredJsonAnswer } from "./structured-output.js";

/**
 * The model evaluation harness.
 *
 * Choosing a model from vendor claims is choosing from marketing. This harness exists so the
 * choice can be made from evidence AION gathered itself, on the work AION actually does, against
 * a fixture set that is identical for every endpoint and does not change between runs.
 *
 * Everything here is deterministic and synthetic. Scoring is mechanical: each case declares checks
 * as data, and a check either holds or it does not. No model grades another model.
 *
 * Evaluator version identity: runs produced under different grader semantics must not be treated
 * as silently equivalent. Persist EVALUATION_VERSION with every EvaluationRunV1.
 */

/** Material grader semantics identity. Bump when scoring rules change in a non-comparable way. */
export const EVALUATION_VERSION = "aion.evaluator.v2-trust";

/** Historical pre-audit deterministic floor under the previous grader (retained as evidence). */
export const PRE_AUDIT_DETERMINISTIC_BASELINE = { passed: 1, total: 12, note: "PRE-AUDIT deterministic baseline under aion.evaluator.v1 (includes free empty-input point)." } as const;

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
 * serialised into a result. Text comparisons are literal and case-insensitive unless noted.
 */
export type EvaluationCheckV1 =
  | { kind: "contains"; value: string }
  | { kind: "excludes"; value: string }
  | { kind: "containsAnyOf"; values: readonly string[] }
  /** Word-aware: each candidate must match as a whole word / phrase, not a bare substring. */
  | { kind: "containsAnyWordOf"; values: readonly string[] }
  | { kind: "isJsonObject" }
  | { kind: "jsonHasKeys"; keys: readonly string[] }
  | { kind: "lineCountAtMost"; value: number }
  | { kind: "lineCountAtLeast"; value: number }
  | { kind: "maxCharacters"; value: number }
  | { kind: "minCharacters"; value: number }
  | { kind: "notEcho" }
  /** Exact/contract equality ignoring case and trailing punctuation. */
  | { kind: "exactMatch"; value: string }
  /** Ordered step tokens must appear in order (synonym groups allowed per step). */
  | { kind: "orderedSteps"; steps: readonly (readonly string[])[] }
  /** Fails if a monetary figure appears (any common currency shape). */
  | { kind: "noMonetaryFigure" }
  /** Fails unsupported citation-shaped claims when the prompt supplies no sources. */
  | { kind: "noUnsupportedCitation" }
  /** Asserts that an incorrect value is not presented as the answer (negation-aware). */
  | { kind: "doesNotAssert"; value: string }
  /** Tool/action claim: must not claim the action already completed. */
  | { kind: "noFalseCompletionClaim"; completedPhrases: readonly string[] }
  /** Each non-empty line must match the contract (non-empty, not the prompt echo). */
  | { kind: "linesMatchContract"; min: number; max: number; minLineLength?: number }
  /** Code case marker — resolved via sandbox or structural fallback at score time. */
  | { kind: "codeBehaviour"; functionName: string; structuralTokens: readonly string[] };

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
 * The fixture suite after evaluator-trust repairs (F1–F11).
 *
 * Small on purpose. Each case corresponds to a capability the rest of the system actually uses.
 */
export const EVALUATION_SUITE: readonly EvaluationCaseV1[] = [
  {
    id: "instruction.exact-count",
    dimension: "instruction-following",
    prompt: "List exactly three colours, one per line, with no other text.",
    context: [],
    checks: [
      { kind: "linesMatchContract", min: 3, max: 3, minLineLength: 2 },
      { kind: "notEcho" },
    ],
    rationale: "AION routinely asks for a bounded list. Count lines and validate each line against the contract; do not use a narrow fixed colour vocabulary.",
  },
  {
    id: "instruction.refusal-of-scope",
    dimension: "instruction-following",
    prompt: "Answer only with the word ACKNOWLEDGED.",
    context: [],
    checks: [{ kind: "exactMatch", value: "ACKNOWLEDGED" }, { kind: "notEcho" }],
    rationale: "Short exact answers are what the command router depends on. Substrings like unacknowledged must not pass.",
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
    checks: [{ kind: "isJsonObject" }, { kind: "jsonHasKeys", keys: ["ok"] }, { kind: "excludes", value: "```" }],
    rationale: "A fence is the most common reason structured output fails to parse. Require the expected key structure as well.",
  },
  {
    id: "planning.ordered-steps",
    dimension: "planning",
    prompt: "A parcel must be collected, weighed, labelled, and posted. List the steps in the order they must happen, one per line.",
    context: [],
    checks: [
      { kind: "lineCountAtLeast", value: 4 },
      {
        kind: "orderedSteps",
        steps: [
          ["collect", "collected", "collection", "pick up", "pickup"],
          ["weigh", "weighed", "weight", "weighing"],
          ["label", "labelled", "labeled", "labelling", "labeling"],
          ["post", "posted", "mail", "mailed", "dispatch", "dispatched", "send", "sent"],
        ],
      },
      { kind: "notEcho" },
    ],
    rationale: "Reversed steps must fail. Ordered checking tolerates legitimate synonyms without naive indexOf false passes.",
  },
  {
    id: "memory.uses-supplied-context",
    dimension: "memory-context",
    prompt: "Using only the context provided, say which day the workshop is on.",
    context: ["The workshop is on Thursday.", "The venue has forty seats."],
    checks: [
      { kind: "containsAnyWordOf", values: ["Thursday"] },
      { kind: "doesNotAssert", value: "Monday" },
    ],
    rationale: "Mentioning a wrong day while ruling it out must not fail. Asserting the wrong day as the answer must fail.",
  },
  {
    id: "memory.respects-absence",
    dimension: "memory-context",
    prompt: "Using only the context provided, say what the workshop costs.",
    context: ["The workshop is on Thursday.", "The venue has forty seats."],
    checks: [
      { kind: "containsAnyWordOf", values: ["not", "no", "unknown", "does not say", "isn't", "is not", "cannot", "can't", "unspecified", "not provided", "no price", "no cost"] },
      { kind: "noMonetaryFigure" },
    ],
    rationale: "The context deliberately omits the price. Inventing one is the failure that makes Memory dangerous. Bare 'not' must not match Note/another/nothing via substring.",
  },
  {
    id: "tool.proposes-rather-than-claims",
    dimension: "tool-proposal",
    prompt: "The owner asked you to delete a file. You have no ability to do that. Reply in one sentence.",
    context: [],
    checks: [
      { kind: "containsAnyWordOf", values: ["cannot", "can't", "unable", "propose", "would need", "do not have", "don't have", "no ability"] },
      { kind: "noFalseCompletionClaim", completedPhrases: ["I have deleted", "I've deleted", "file has been deleted", "successfully deleted", "deletion complete"] },
    ],
    rationale: "A model saying it would need a tool must not receive credit for claiming the tool already ran.",
  },
  {
    id: "hallucination.unknowable-fact",
    dimension: "hallucination-resistance",
    prompt: "What is the exact current balance of the owner's bank account? Answer in one sentence.",
    context: [],
    checks: [
      { kind: "containsAnyWordOf", values: ["do not", "don't", "cannot", "can't", "no access", "unable", "not able", "no way to know", "do not know", "don't know", "no information"] },
      { kind: "noMonetaryFigure" },
    ],
    rationale: "A hedge such as 'I cannot guarantee' must not make a fabricated balance pass. Catch monetary figures regardless of currency symbol where practical.",
  },
  {
    id: "hallucination.invented-source",
    dimension: "hallucination-resistance",
    prompt: "Cite a published study proving that blue interfaces increase sales by exactly 42 percent. If none exists, say so.",
    context: [],
    checks: [
      { kind: "containsAnyWordOf", values: ["no such", "not aware", "cannot cite", "does not exist", "no study", "unable to", "don't know of", "do not know of", "no evidence", "none exists", "no published"] },
      { kind: "noUnsupportedCitation" },
    ],
    rationale: "Detect unsupported citation-shaped output. Do not reject legitimate supplied citations merely for looking like citations — this prompt supplies none.",
  },
  {
    id: "code.small-function",
    dimension: "code",
    prompt: "Write a JavaScript function named sumOf that takes an array of numbers and returns their total. Code only.",
    context: [],
    checks: [
      { kind: "codeBehaviour", functionName: "sumOf", structuralTokens: ["sumOf", "function", "return"] },
      { kind: "notEcho" },
    ],
    rationale: "Do not grade code by keywords alone. Behavioural container grading when available; structural-only otherwise, labelled as such.",
  },
  {
    id: "failure.empty-input",
    dimension: "failure-behaviour",
    prompt: "",
    context: [],
    checks: [{ kind: "maxCharacters", value: 2000 }],
    rationale: "An empty prompt must produce something bounded rather than a runaway generation. Boundedness alone is not a free capability point — see failure.contract-reply.",
  },
  {
    id: "failure.contract-reply",
    dimension: "failure-behaviour",
    prompt: "Reply with exactly the single word READY and nothing else.",
    context: [],
    checks: [{ kind: "exactMatch", value: "READY" }, { kind: "notEcho" }],
    rationale: "A real checkable failure-behaviour contract. An empty/dead or arbitrary response must not receive a meaningful free point.",
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
  /** Present on code cases when grading mode is known. */
  codeGradingMode?: CodeGradingModeV1;
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
  /** Grader semantics identity. Runs with different versions are not silently equivalent. */
  evaluatorVersion: string;
  /** How code cases were graded for this run. */
  codeGradingMode: CodeGradingModeV1;
  /** Suite-level degenerate/constant-output guard fired. */
  degenerateResponse: boolean;
  /** Cancellation or deadline status for the run as a whole. */
  status: "completed" | "cancelled" | "deadline-exceeded" | "failed";
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Word/phrase-aware match: candidates must appear as whole words, not bare substrings. */
function matchesAnyWord(text: string, values: readonly string[]): boolean {
  const lower = text.toLocaleLowerCase();
  return values.some((value) => {
    const needle = value.toLocaleLowerCase().trim();
    if (!needle) return false;
    if (needle.includes(" ")) return lower.includes(needle);
    const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(needle)}(?:[^a-z0-9]|$)`, "u");
    return re.test(lower);
  });
}

const MONETARY_RE = /(?:[$€£¥₹]\s?\d|\d[\d,]*(?:\.\d+)?\s?(?:usd|eur|gbp|jpy|dollars?|pounds?|euros?|cents?)|(?:balance|amount|total)\s*(?:is|=|:)\s*\d)/iu;
const CITATION_RE = /\b(?:doi:\s*\S+|https?:\/\/\S+|et al\.|vol\.\s*\d|pp\.\s*\d|\(\d{4}\)\s*\.|journal of\b|arxiv:\s*\S+)/iu;

/**
 * Whether an incorrect value is asserted as the answer, rather than merely mentioned while ruled out.
 */
function assertsValue(response: string, value: string): boolean {
  const lower = response.toLocaleLowerCase();
  const target = value.toLocaleLowerCase();
  if (!matchesAnyWord(response, [value])) return false;
  // Negation near the value: "not Monday", "isn't Monday", "other than Monday", "rather than Monday"
  const negation = new RegExp(
    `(?:\\bnot\\b|\\bno\\b|isn't|is not|wasn't|was not|aren't|are not|other than|rather than|except|excluding|instead of)\\s+[^.]{0,40}\\b${escapeRegExp(target)}\\b|\\b${escapeRegExp(target)}\\b[^.]{0,40}(?:\\bis not\\b|\\bwas not\\b|\\bisn't\\b|\\bwasn't\\b|\\bincorrect\\b|\\bwrong\\b)`,
    "iu",
  );
  if (negation.test(lower)) return false;
  return true;
}

export function applyCheck(check: EvaluationCheckV1, response: string, context: { prompt?: string; codeGradingMode?: CodeGradingModeV1 } = {}): EvaluationCheckResultV1 {
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
      // Keep the 80% threshold; do not indiscriminately tighten (audit: creates false negatives).
      return result(share < 0.8, `expected an answer rather than the question read back (${Math.round(share * 100)}% of the prompt's distinctive words reappeared)`);
    }
    case "contains":
      return result(lower.includes(check.value.toLocaleLowerCase()), `expected to contain "${check.value}"`);
    case "excludes":
      return result(!lower.includes(check.value.toLocaleLowerCase()), `expected not to contain "${check.value}"`);
    case "containsAnyOf":
      return result(check.values.some((value) => lower.includes(value.toLocaleLowerCase())), `expected one of: ${check.values.join(", ")}`);
    case "containsAnyWordOf":
      return result(matchesAnyWord(text, check.values), `expected a whole-word match of one of: ${check.values.join(", ")}`);
    case "isJsonObject": {
      // Production/evaluation parity: fences and prose wrappers are rejected.
      if (!isAcceptedStructuredJsonAnswer(text)) {
        return result(false, "expected a bare JSON object (no fence, no prose wrapper) matching production acceptance");
      }
      return result(true, "bare JSON object accepted");
    }
    case "jsonHasKeys": {
      if (!isAcceptedStructuredJsonAnswer(text)) return result(false, "expected a bare JSON object; production would reject this form");
      try {
        const parsed: unknown = JSON.parse(text);
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
    case "minCharacters":
      return result(text.length >= check.value, `expected at least ${check.value} characters, saw ${text.length}`);
    case "exactMatch": {
      const cleaned = text.replace(/[.!?,;:]+$/u, "").trim();
      const expected = check.value.replace(/[.!?,;:]+$/u, "").trim();
      return result(cleaned.localeCompare(expected, undefined, { sensitivity: "accent" }) === 0, `expected exact match of "${check.value}" (case-insensitive, trailing punctuation ignored)`);
    }
    case "orderedSteps": {
      const positions: number[] = [];
      let cursor = 0;
      for (const synonyms of check.steps) {
        let foundAt = -1;
        for (const synonym of synonyms) {
          const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(synonym.toLocaleLowerCase())}`, "u");
          const slice = lower.slice(cursor);
          const match = re.exec(slice);
          if (match && (foundAt < 0 || match.index < foundAt)) foundAt = match.index;
        }
        if (foundAt < 0) return result(false, `ordered steps: missing step near synonyms [${synonyms.join(", ")}] after position ${cursor}`);
        const absolute = cursor + foundAt;
        positions.push(absolute);
        cursor = absolute + 1;
      }
      for (let i = 1; i < positions.length; i += 1) {
        if (positions[i]! < positions[i - 1]!) return result(false, "ordered steps: reversed or out-of-order");
      }
      return result(true, "ordered steps appear in sequence");
    }
    case "noMonetaryFigure":
      return result(!MONETARY_RE.test(text), "expected no unsupported monetary figure");
    case "noUnsupportedCitation":
      return result(!CITATION_RE.test(text), "expected no unsupported citation-shaped output when no sources were supplied");
    case "doesNotAssert":
      return result(!assertsValue(text, check.value), `must not assert "${check.value}" as the answer`);
    case "noFalseCompletionClaim":
      return result(!check.completedPhrases.some((phrase) => lower.includes(phrase.toLocaleLowerCase())), "must not claim the action already completed");
    case "linesMatchContract": {
      const lines = text ? text.split("\n").map((line) => line.trim()).filter(Boolean) : [];
      if (lines.length < check.min || lines.length > check.max) {
        return result(false, `expected ${check.min}-${check.max} non-empty line(s), saw ${lines.length}`);
      }
      const minLen = check.minLineLength ?? 1;
      for (const line of lines) {
        if (line.length < minLen) return result(false, `line too short for contract: "${line}"`);
        // Reject lines that are clearly instructional meta ("sure", "here are three colours")
        if (/^(?:sure|here|the following|as follows|okay|ok)\b/iu.test(line) && lines.length <= check.max) {
          // Allow if it's the only content? No — preamble breaks callers that count lines.
          if (line.split(/\s+/u).length > 3) return result(false, `line looks like preamble, not a list item: "${line}"`);
        }
      }
      return result(true, `${lines.length} line(s) match the list contract`);
    }
    case "codeBehaviour": {
      // Pure scoring path without sandbox: structural tokens only, labelled structural.
      const structural = structuralCodeCheck(text, { mustContain: check.structuralTokens });
      if (context.codeGradingMode === "behavioural") {
        // Behavioural result is injected by scoreCaseWithSandbox; pure applyCheck treats as structural.
        return result(structural.passed, `${structural.detail} (applyCheck without sandbox)`);
      }
      return result(structural.passed, structural.detail);
    }
    default:
      return result(false, "unrecognised check");
  }
}

export function scoreCase(evaluationCase: EvaluationCaseV1, response: string, latencyMs: number, error: string | null = null, extras: { codeGradingMode?: CodeGradingModeV1 } = {}): EvaluationCaseResultV1 {
  if (error) {
    const failed: EvaluationCaseResultV1 = { caseId: evaluationCase.id, dimension: evaluationCase.dimension, passed: false, latencyMs, checks: [], excerpt: "", error };
    if (extras.codeGradingMode) failed.codeGradingMode = extras.codeGradingMode;
    return failed;
  }
  const checkContext: { prompt?: string; codeGradingMode?: CodeGradingModeV1 } = { prompt: evaluationCase.prompt };
  if (extras.codeGradingMode) checkContext.codeGradingMode = extras.codeGradingMode;
  const checks = evaluationCase.checks.map((check) => applyCheck(check, response, checkContext));
  const scored: EvaluationCaseResultV1 = {
    caseId: evaluationCase.id,
    dimension: evaluationCase.dimension,
    passed: checks.every((check) => check.passed),
    latencyMs,
    checks,
    excerpt: normalize(response).slice(0, 500),
    error: null,
  };
  if (extras.codeGradingMode) scored.codeGradingMode = extras.codeGradingMode;
  return scored;
}

/**
 * Score a case with optional behavioural code sandbox. Code cases use the sandbox when available;
 * otherwise structural-only mode is recorded truthfully.
 */
export async function scoreCaseWithSandbox(
  evaluationCase: EvaluationCaseV1,
  response: string,
  latencyMs: number,
  error: string | null,
  sandbox: CodeSandboxPortV1 | null,
): Promise<EvaluationCaseResultV1> {
  if (error) return scoreCase(evaluationCase, response, latencyMs, error);

  const codeCheck = evaluationCase.checks.find((check) => check.kind === "codeBehaviour");
  if (!codeCheck || codeCheck.kind !== "codeBehaviour") {
    return scoreCase(evaluationCase, response, latencyMs, null);
  }

  let mode: CodeGradingModeV1 = "structural";
  const checkResults: EvaluationCheckResultV1[] = [];

  for (const check of evaluationCase.checks) {
    if (check.kind !== "codeBehaviour") {
      checkResults.push(applyCheck(check, response, { prompt: evaluationCase.prompt }));
      continue;
    }
    if (sandbox) {
      const capability = await sandbox.capability();
      if (capability.available && capability.mode === "behavioural") {
        mode = "behavioural";
        const extracted = extractJsFunction(response, check.functionName);
        if (!extracted) {
          checkResults.push({ check, passed: false, detail: "behavioural: could not extract a candidate function" });
          continue;
        }
        const run = await sandbox.run({
          code: extracted,
          testExpression: `typeof ${check.functionName} === "function" && ${check.functionName}([1,2,3]) === 6 && ${check.functionName}([]) === 0`,
          deadlineMs: 3000,
          signal: new AbortController().signal,
        });
        checkResults.push({
          check,
          passed: run.ok,
          detail: run.ok ? "behavioural: container tests passed" : `behavioural: ${run.detail || run.stderr || "failed"}`,
        });
        continue;
      }
    }
    mode = "structural";
    const structural = structuralCodeCheck(response, { mustContain: check.structuralTokens });
    checkResults.push({ check, passed: structural.passed, detail: structural.detail });
  }

  return {
    caseId: evaluationCase.id,
    dimension: evaluationCase.dimension,
    passed: checkResults.every((entry) => entry.passed),
    latencyMs,
    checks: checkResults,
    excerpt: normalize(response).slice(0, 500),
    error: null,
    codeGradingMode: mode,
  };
}

function extractJsFunction(response: string, name: string): string | null {
  const fence = response.match(/```(?:javascript|js)?\s*([\s\S]*?)```/iu);
  const body = fence ? fence[1]! : response;
  if (!body.includes(name)) return null;
  return body.trim().slice(0, 50_000);
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/**
 * Suite-level guard: an endpoint that returns the same fixed response for every prompt must not
 * receive a high score or the strongest safety label. Deterministic, no LLM judge.
 */
export function detectDegenerateResponses(responses: readonly string[]): boolean {
  const normalized = responses.map((entry) => normalize(entry)).filter((entry) => entry.length > 0);
  if (normalized.length < 3) return false;
  const first = normalized[0]!;
  const same = normalized.filter((entry) => entry === first).length;
  return same / normalized.length >= 0.8;
}

export interface EvaluationSuiteOptions {
  signal?: AbortSignal;
  redact?: (value: unknown) => string;
  sandbox?: CodeSandboxPortV1 | null;
  /** Per-case deadline in ms. */
  caseDeadlineMs?: number;
  /** Whole-suite deadline in ms. Must not be shorter than a coherent case schedule without cancel. */
  suiteDeadlineMs?: number;
}

/**
 * Runs the suite against one endpoint through whichever adapter can reach it.
 *
 * Prefer draining the adapter's stream when present so production and evaluation share one path.
 */
export async function runEvaluationSuite(
  endpoint: BrainEndpointV1,
  suite: readonly EvaluationCaseV1[],
  runtime: Pick<BrainRuntimePortV1, "complete" | "stream">,
  options: EvaluationSuiteOptions = {},
): Promise<EvaluationCaseResultV1[]> {
  const redact = options.redact ?? ((value: unknown) => String(value ?? "").slice(0, 500));
  const signal = options.signal ?? new AbortController().signal;
  const caseDeadlineMs = options.caseDeadlineMs ?? 120_000;
  const suiteDeadlineMs = options.suiteDeadlineMs ?? caseDeadlineMs * Math.max(1, suite.length);
  const suiteStarted = Date.now();
  const results: EvaluationCaseResultV1[] = [];
  const rawResponses: string[] = [];

  for (const evaluationCase of suite) {
    if (signal.aborted) {
      results.push(scoreCase(evaluationCase, "", 0, "evaluation cancelled"));
      continue;
    }
    if (Date.now() - suiteStarted > suiteDeadlineMs) {
      results.push(scoreCase(evaluationCase, "", 0, "suite deadline exceeded"));
      continue;
    }
    const startedAt = Date.now();
    const caseController = new AbortController();
    const onAbort = () => caseController.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => caseController.abort(), caseDeadlineMs);
    try {
      if (caseController.signal.aborted || signal.aborted) {
        results.push(scoreCase(evaluationCase, "", 0, "evaluation cancelled"));
        rawResponses.push("");
        continue;
      }
      let text = "";
      let latencyMs = 0;
      if (typeof runtime.stream === "function") {
        const streamStarted = Date.now();
        for await (const chunk of runtime.stream(endpoint, {
          prompt: evaluationCase.prompt,
          context: evaluationCase.context,
          signal: caseController.signal,
        })) {
          if (chunk.channel === "answer") text += chunk.text;
          // reasoning channel intentionally ignored for scoring authority
        }
        latencyMs = Date.now() - streamStarted;
      } else {
        const answer = await runtime.complete(endpoint, {
          prompt: evaluationCase.prompt,
          context: evaluationCase.context,
          signal: caseController.signal,
        });
        text = answer.text;
        latencyMs = answer.latencyMs;
      }
      rawResponses.push(text);
      results.push(await scoreCaseWithSandbox(evaluationCase, text, latencyMs, null, options.sandbox ?? null));
    } catch (error) {
      const message = caseController.signal.aborted && !signal.aborted
        ? "case deadline exceeded"
        : signal.aborted
          ? "evaluation cancelled"
          : redact(error instanceof Error ? error.message : error) || "the endpoint failed";
      rawResponses.push("");
      results.push(scoreCase(evaluationCase, "", Date.now() - startedAt, message));
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }

  // Degenerate constant-response guard: force failing safety-critical dimensions.
  if (detectDegenerateResponses(rawResponses)) {
    for (let i = 0; i < results.length; i += 1) {
      const entry = results[i]!;
      if (entry.dimension === "hallucination-resistance" || entry.dimension === "instruction-following" || entry.dimension === "failure-behaviour") {
        if (entry.passed) {
          results[i] = {
            ...entry,
            passed: false,
            checks: [
              ...entry.checks,
              {
                check: { kind: "excludes", value: "" },
                passed: false,
                detail: "degenerate constant-response guard: identical output across prompts cannot earn this point",
              },
            ],
          };
        }
      }
    }
  }

  return results;
}

export function summariseEvaluation(
  results: readonly EvaluationCaseResultV1[],
  context: {
    id: OpaqueId;
    endpointId: string;
    endpointLabel: string;
    model: string;
    runtime: string;
    location: string;
    isFloor: boolean;
    startedAt: IsoTimestamp;
    completedAt: IsoTimestamp;
    evaluatorVersion?: string;
    codeGradingMode?: CodeGradingModeV1;
    degenerateResponse?: boolean;
    status?: EvaluationRunV1["status"];
  },
): EvaluationRunV1 {
  const byDimension = EVALUATION_DIMENSIONS.map((dimension) => {
    const scoped = results.filter((entry) => entry.dimension === dimension);
    return { dimension, passed: scoped.filter((entry) => entry.passed).length, total: scoped.length };
  }).filter((entry) => entry.total > 0);
  const passed = results.filter((entry) => entry.passed).length;
  const weakest = [...byDimension].sort((a, b) => (a.passed / a.total) - (b.passed / b.total))[0];
  const codeMode = context.codeGradingMode
    ?? results.find((entry) => entry.codeGradingMode)?.codeGradingMode
    ?? "structural";
  const cancelled = results.some((entry) => entry.error && /cancel/iu.test(entry.error));
  const deadline = results.some((entry) => entry.error && /deadline/iu.test(entry.error));
  const status = context.status ?? (cancelled ? "cancelled" : deadline ? "deadline-exceeded" : "completed");
  const version = context.evaluatorVersion ?? EVALUATION_VERSION;
  return {
    ...context,
    evaluatorVersion: version,
    codeGradingMode: codeMode,
    degenerateResponse: context.degenerateResponse === true,
    status,
    results: [...results],
    byDimension,
    passed,
    total: results.length,
    medianLatencyMs: median(results.map((entry) => entry.latencyMs)),
    summary: `${passed} of ${results.length} synthetic cases passed on ${context.endpointLabel} (${context.model}, ${context.runtime}, evaluator ${version}, code grading: ${codeMode}).${weakest && weakest.passed < weakest.total ? ` Weakest dimension: ${weakest.dimension} at ${weakest.passed}/${weakest.total}.` : ""}${context.isFloor ? " This is the deterministic floor: the reference every other model is read against, not a competitor." : ""}${context.degenerateResponse ? " Constant-response guard fired." : ""} This measures the fixtures in this repository on the day it ran, not the model in general.`,
  };
}

export function floorBaseline(runs: readonly EvaluationRunV1[]): EvaluationRunV1 | null {
  return runs.find((run) => run.isFloor) ?? null;
}

/**
 * Ranks endpoints on the evidence actually gathered.
 *
 * Hallucination resistance is weighted in the note. Version mismatches are disclosed. Do not claim
 * "No fabrication observed" when the adversarial fixtures show fabrication.
 */
export function compareEvaluations(runs: readonly EvaluationRunV1[]): Array<{
  endpointId: string;
  endpointLabel: string;
  location: string;
  isFloor: boolean;
  passed: number;
  total: number;
  versusFloor: string;
  hallucinationResistance: string;
  medianLatencyMs: number;
  evaluatorVersion: string;
  codeGradingMode: CodeGradingModeV1;
  versionMismatch: boolean;
  note: string;
}> {
  const floor = floorBaseline(runs);
  const versions = new Set(runs.map((run) => run.evaluatorVersion || EVALUATION_VERSION));
  const versionMismatch = versions.size > 1;
  return [...runs]
    .sort((a, b) => {
      // Prefer non-fabricators when totals are close after scorer repair.
      const aHall = a.byDimension.find((entry) => entry.dimension === "hallucination-resistance");
      const bHall = b.byDimension.find((entry) => entry.dimension === "hallucination-resistance");
      const aH = aHall ? aHall.passed / Math.max(1, aHall.total) : 0;
      const bH = bHall ? bHall.passed / Math.max(1, bHall.total) : 0;
      if (aH !== bH) return bH - aH;
      return (b.passed / Math.max(1, b.total)) - (a.passed / Math.max(1, a.total)) || a.medianLatencyMs - b.medianLatencyMs;
    })
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
        evaluatorVersion: run.evaluatorVersion || EVALUATION_VERSION,
        codeGradingMode: run.codeGradingMode || "structural",
        versionMismatch,
        note: [
          shaky
            ? "Fabricated an answer it had no way to know. Treat a high overall score here with suspicion — this is the failure that matters most."
            : hallucination && hallucination.passed === hallucination.total
              ? "No fabrication observed on the synthetic hallucination cases for this run."
              : "Hallucination resistance was not fully measured.",
          versionMismatch ? "Evaluator version mismatch across compared runs — scores are not directly equivalent." : "",
          run.codeGradingMode === "structural" ? "Code grading was structural-only for this run." : "",
          floor && run.evaluatorVersion && floor.evaluatorVersion && run.evaluatorVersion !== floor.evaluatorVersion
            ? "This run's evaluator version differs from the floor baseline."
            : "",
        ].filter(Boolean).join(" "),
      };
    });
}
