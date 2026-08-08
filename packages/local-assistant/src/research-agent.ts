import type { IsoTimestamp } from "./contracts.js";
import type { ResearchFindingV1, ResearchJobV1, ResearchSourceV1 } from "./research.js";

/**
 * The research agent loop.
 *
 * A research agent is the part of a system like this most likely to launder a guess into a
 * finding: it reads several pages, notices they broadly agree, and produces a confident sentence
 * that nobody can trace back to anything. So the loop is written around the opposite instinct —
 * every step keeps the source attached, disagreement is surfaced rather than resolved, and the
 * output is explicitly *not* a fact.
 *
 * The steps are: plan the question, discover or accept sources, retrieve, extract evidence,
 * compare sources against each other, name what is still unresolved, and synthesise. The
 * synthesis is the only step that combines anything, and it is the one most carefully bounded:
 * it may state what the sources said and how much they agreed, and nothing else.
 */

export type ResearchStepV1 =
  | "plan" | "discover" | "retrieve" | "extract" | "compare" | "synthesise";

export const RESEARCH_STEPS: readonly ResearchStepV1[] = ["plan", "discover", "retrieve", "extract", "compare", "synthesise"];

export interface ResearchPlanV1 {
  question: string;
  /** The narrower questions the answer depends on. Owner-readable, never executed. */
  subQuestions: string[];
  /** What would have to be true for an answer to be trustworthy. */
  successCriteria: string[];
  /** What this plan deliberately will not attempt. */
  outOfScope: string[];
}

export interface ContradictionV1 {
  statement: string;
  /** The finding ids that disagree. Always at least two. */
  findingIds: string[];
  sourceRefs: string[];
  detail: string;
}

export interface ResearchSynthesisV1 {
  question: string;
  /** What the sources said, with the sources named. Never a conclusion of AION's own. */
  supported: Array<{ statement: string; sourceRefs: string[]; agreement: number }>;
  contradictions: ContradictionV1[];
  unresolved: string[];
  /** How much of this rests on a single source, which is the most common way research misleads. */
  singleSourceCount: number;
  confidence: "none" | "weak" | "moderate" | "contested";
  /** The sentence the owner reads. Written to under-claim rather than over-claim. */
  statement: string;
}

function fail(message: string): never { throw new Error(message); }

/**
 * Turns a question into a plan.
 *
 * Deterministic and modelless: it decomposes on the question's own structure rather than
 * inventing sub-questions, because a plan that hallucinated its own scope would be the first
 * link in exactly the chain this module exists to break. A model may later propose a richer
 * plan; it would arrive as a proposal like anything else.
 */
export function planResearch(question: string, scope: string): ResearchPlanV1 {
  const trimmed = String(question ?? "").trim();
  if (!trimmed || trimmed.length > 2000) fail("A research question must be between 1 and 2000 characters.");
  const terms = [...new Set(trimmed.toLocaleLowerCase().match(/[a-z][a-z-]{3,}/gu) ?? [])].slice(0, 6);
  return {
    question: trimmed,
    subQuestions: [
      `What do the sources actually say about ${terms.slice(0, 3).join(", ") || "this"}?`,
      "Do the sources agree with each other?",
      "What does no source address?",
    ],
    successCriteria: [
      "Every statement is attributable to a source AION actually retrieved.",
      "Disagreement between sources is reported rather than averaged.",
      "Anything unaddressed is listed as an open question.",
    ],
    outOfScope: [
      "Anything behind a login, a paywall, or an access control.",
      "Any private, local, or link-local address.",
      scope === "local-only" ? "Any network request at all: this job is scoped local-only." : "Crawling beyond the sources named or discovered for this job.",
    ],
  };
}

/*
 * Two separate lists, because they answer two different questions.
 *
 * `NEGATIONS` decides which way a claim points. `DIRECTIONAL` words are stripped from the
 * grouping key so that "X reduces Y" and "X does not reduce Y" land in the same group and can
 * then be seen to disagree. Conflating them is a subtle and expensive mistake: if "reduce" counts
 * as a negation, both sentences read as negative and the contradiction disappears silently —
 * which is the exact failure this module exists to prevent.
 */
const NEGATIONS = ["not", "no", "never", "cannot", "cant", "doesnt", "dont", "without", "fails", "failed", "neither", "nor"];
const DIRECTIONAL = ["reduce", "reduces", "reduced", "decrease", "decreases", "increase", "increases", "improve", "improves", "worsen", "worsens", "worse", "better", "lower", "higher"];

/**
 * Auxiliaries and connectives that say nothing about the subject.
 *
 * "It works" and "It does not work" are the same claim disagreeing with itself, and they only
 * group if "does" is ignored and "works" and "work" collapse together. Getting this wrong makes
 * the detector quietly miss real conflicts, which is worse than being noisy.
 */
const AUXILIARY = ["does", "will", "have", "has", "had", "been", "being", "that", "this", "with", "from", "they", "them", "their", "there", "would", "could", "should", "into", "than", "then", "when", "what", "which", "were", "was", "are", "and", "the", "for", "but"];

/** Very light stemming: enough to collapse a plural or a third person, and no more. */
function stem(word: string): string {
  if (word.length >= 6 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length >= 6 && (word.endsWith("es") || word.endsWith("ed"))) return word.slice(0, -2);
  if (word.length >= 5 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function claimKey(statement: string): string {
  const ignored = new Set([...NEGATIONS, ...DIRECTIONAL, ...AUXILIARY].map(stem));
  return [...new Set((statement.toLocaleLowerCase().match(/[a-z]{3,}/gu) ?? []).map(stem).filter((word) => !ignored.has(word) && word.length >= 3))]
    .sort()
    .slice(0, 8)
    .join(" ");
}
function polarity(statement: string): "affirmative" | "negative" {
  const words = (statement.toLocaleLowerCase().match(/[a-z']+/gu) ?? []).map((word) => word.replace(/'/gu, ""));
  return words.some((word) => NEGATIONS.includes(word)) ? "negative" : "affirmative";
}

/**
 * Finds findings that disagree.
 *
 * Deliberately crude and deliberately loud. Two findings about the same subject pointing in
 * opposite directions are reported as a contradiction rather than reconciled, because reconciling
 * them is the owner's judgement and doing it silently is how a research tool starts lying. A false
 * positive here costs a sentence the owner can dismiss; a false negative hides a real conflict.
 */
export function findContradictions(findings: readonly ResearchFindingV1[], sources: readonly ResearchSourceV1[]): ContradictionV1[] {
  const byId = new Map(sources.map((source) => [source.id, source.reference]));
  const groups = new Map<string, ResearchFindingV1[]>();
  for (const finding of findings) {
    const key = claimKey(finding.statement);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }
  const contradictions: ContradictionV1[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const polarities = new Set(group.map((finding) => polarity(finding.statement)));
    if (polarities.size < 2) continue;
    contradictions.push({
      statement: group[0]!.statement.slice(0, 300),
      findingIds: group.map((finding) => finding.id),
      sourceRefs: [...new Set(group.flatMap((finding) => finding.sourceIds.map((id) => byId.get(id) ?? id)))],
      detail: `${group.length} findings about the same subject point in opposite directions. AION has not decided which is right, and will not.`,
    });
  }
  return contradictions;
}

/**
 * Combines findings into something readable without turning them into a conclusion.
 *
 * Everything stated here is a report of what a source said, with the source attached. Agreement
 * is a count, not a verdict. The confidence label describes the *evidence*, not the answer, and
 * the statement is written to under-claim: a reader who only reads the last line should still
 * come away knowing that AION checked nothing.
 */
export function synthesise(job: ResearchJobV1): ResearchSynthesisV1 {
  const byId = new Map(job.sources.map((source) => [source.id, source.reference]));
  const groups = new Map<string, ResearchFindingV1[]>();
  for (const finding of job.findings) {
    const key = claimKey(finding.statement) || finding.id;
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }
  const contradictions = findContradictions(job.findings, job.sources);
  const contradicted = new Set(contradictions.flatMap((entry) => entry.findingIds));

  const supported = [...groups.values()]
    .filter((group) => !group.some((finding) => contradicted.has(finding.id)))
    .map((group) => ({
      statement: group[0]!.statement,
      sourceRefs: [...new Set(group.flatMap((finding) => finding.sourceIds.map((id) => byId.get(id) ?? id)))],
      agreement: group.length,
    }))
    .sort((a, b) => b.agreement - a.agreement || a.statement.localeCompare(b.statement));

  const singleSourceCount = supported.filter((entry) => entry.sourceRefs.length === 1).length;
  const confidence: ResearchSynthesisV1["confidence"] = contradictions.length
    ? "contested"
    : supported.length === 0
      ? "none"
      : supported.some((entry) => entry.sourceRefs.length > 1)
        ? "moderate"
        : "weak";

  const statement = (() => {
    if (job.state !== "complete") return `This research job is ${job.state}. Nothing has been established.`;
    if (!supported.length && !contradictions.length) {
      return `Nothing in ${job.sources.length} source(s) addressed "${job.question}". That is a result: treat the question as open rather than answered in the negative.`;
    }
    const base = `${supported.length} statement(s) from ${job.sources.length} source(s)`;
    const single = singleSourceCount ? ` ${singleSourceCount} of them rest on a single source.` : "";
    const conflict = contradictions.length ? ` ${contradictions.length} contradiction(s) were found and are reported rather than resolved — AION has not decided which side is right.` : "";
    return `${base}.${single}${conflict} None of this is a fact: it is what those pages said, and AION has verified none of it. Promote anything you have checked yourself.`;
  })();

  return { question: job.question, supported, contradictions, unresolved: [...job.unresolved], singleSourceCount, confidence, statement };
}

/**
 * What the agent proposes AION should learn from a completed job.
 *
 * Never a fact and never an owner-confirmed memory: the classes here are exactly the three a
 * non-owner actor is allowed to produce. A statement several sources agreed on is still only an
 * observation, because agreement between pages is not verification.
 */
export function proposeLearning(synthesis: ResearchSynthesisV1): Array<{ class: "observation" | "inference" | "hypothesis"; statement: string; supportedBy: string[]; confidence: number }> {
  const proposals: Array<{ class: "observation" | "inference" | "hypothesis"; statement: string; supportedBy: string[]; confidence: number }> = [];
  for (const entry of synthesis.supported) {
    proposals.push({
      class: "observation",
      statement: entry.statement,
      supportedBy: entry.sourceRefs,
      confidence: Math.min(70, 35 + entry.agreement * 10),
    });
  }
  for (const contradiction of synthesis.contradictions) {
    proposals.push({
      class: "hypothesis",
      statement: `Sources disagree about: ${contradiction.statement}`,
      supportedBy: contradiction.sourceRefs,
      confidence: 20,
    });
  }
  // An inference only when several *independent sources* line up, not merely several sentences.
  if (synthesis.confidence === "moderate" && synthesis.supported.some((entry) => entry.sourceRefs.length >= 2)) {
    proposals.push({
      class: "inference",
      statement: `Several independent sources point the same way on "${synthesis.question}".`,
      supportedBy: [...new Set(synthesis.supported.flatMap((entry) => entry.sourceRefs))],
      confidence: 45,
    });
  }
  return proposals;
}

/** A readable trace of the loop, so the owner can see what the agent did rather than trusting it. */
export function describeRun(plan: ResearchPlanV1, job: ResearchJobV1, synthesis: ResearchSynthesisV1, at: IsoTimestamp): Array<{ step: ResearchStepV1; at: IsoTimestamp; detail: string }> {
  return [
    { step: "plan", at, detail: `Question: ${plan.question}. ${plan.subQuestions.length} sub-question(s); out of scope: ${plan.outOfScope.join("; ")}` },
    { step: "discover", at, detail: job.seedReferences.length ? `${job.seedReferences.length} source(s) supplied by the owner.` : "No sources supplied; discovery depends on a configured search provider." },
    { step: "retrieve", at, detail: `${job.sources.length} source(s) retrieved, ${job.sources.filter((source) => source.truncated).length} truncated at the byte limit.` },
    { step: "extract", at, detail: `${job.findings.length} finding(s), each attributed to a retrieved source.` },
    { step: "compare", at, detail: synthesis.contradictions.length ? `${synthesis.contradictions.length} contradiction(s) found.` : "No contradictions found among the findings." },
    { step: "synthesise", at, detail: synthesis.statement },
  ];
}
