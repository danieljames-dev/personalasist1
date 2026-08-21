/**
 * What AION knows about a business, what it does not, and what only the Owner can tell it.
 *
 * The Owner has named four businesses and said he controls them. He has not said what any of them
 * does. This module is where that stops being a policy statement and starts being a data structure,
 * because AION is about to write files about these businesses and a file that fills in a plausible
 * business model is worse than no file — it gets read later as a fact, by AION and by the Owner.
 *
 * So the artifact has four separate places to put things, and they cannot be confused:
 *
 *   **known** — a fact, with where it came from and when. Nothing lands here without provenance.
 *   **unknown** — a named gap, marked blocking or not, with why it matters.
 *   **hypotheses** — explicitly not facts, each carrying what evidence would settle it.
 *   **opportunities** — evidence-based, with any number labelled an estimate.
 *
 * And one rule that the shape alone cannot enforce: **the existence of this artifact never means
 * AION understands the business.** `discoveryStatus` is what says whether it does, and its usual
 * answer at the start is `NEED_OWNER_INFORMATION`.
 */

import type { BusinessWorkspaceV1 } from "./business-workspace.js";

export const DISCOVERY_ARTIFACT_SCHEMA_V1 = "aion.director.businessDiscovery.v1" as const;

export const DISCOVERY_STATUSES_V1 = [
  "KNOWLEDGE_SUFFICIENT_FOR_NEXT_STEP",
  "NEED_OWNER_INFORMATION",
  "NEED_CONNECTED_SOURCE",
  "NEED_MARKET_RESEARCH",
  "BLOCKED_BY_CAPABILITY",
  "NO_ACTIONABLE_EVIDENCE",
] as const;
export type DiscoveryStatusV1 = (typeof DISCOVERY_STATUSES_V1)[number];

/** Statuses where the branch cannot advance without something from outside AION. */
export const DISCOVERY_GATE_STATUSES_V1: readonly DiscoveryStatusV1[] = [
  "NEED_OWNER_INFORMATION",
  "NEED_CONNECTED_SOURCE",
  "NEED_MARKET_RESEARCH",
  "BLOCKED_BY_CAPABILITY",
];

export interface KnownFactV1 {
  readonly fact: string;
  /** Who said so. A fact without this is not a fact, and this module will not store one. */
  readonly provenance: string;
  readonly observedAtUtc: string;
  readonly evidence: "OWNER_STATED" | "REPOSITORY_RECORD" | "VERIFIED_OBSERVATION";
}

export interface UnknownFactV1 {
  readonly question: string;
  /**
   * Whether not knowing this stops useful work.
   *
   * The distinction that keeps AION from interrogating the Owner: a blocking unknown earns a
   * question, a nice-to-know one waits until there is a reason to ask.
   */
  readonly blocking: boolean;
  readonly whyItMatters: string;
}

export interface HypothesisV1 {
  /** Always prefixed `HYPOTHESIS:` when rendered, so it cannot be quoted as a finding. */
  readonly statement: string;
  readonly basis: string;
  readonly evidenceNeeded: string;
}

export interface OpportunityV1 {
  readonly description: string;
  /** Always an estimate. The field name says so, and so does `estimateBasis`. */
  readonly estimatedValueUsd: number | null;
  readonly estimateBasis: string;
  readonly confidence: number;
}

export interface NextSafeActionV1 {
  readonly action: string;
  readonly requiredCapabilities: readonly string[];
  readonly needsOwnerInput: boolean;
}

export interface BusinessDiscoveryArtifactV1 {
  readonly schema: typeof DISCOVERY_ARTIFACT_SCHEMA_V1;
  readonly businessId: string;
  readonly canonicalName: string;
  readonly status: DiscoveryStatusV1;
  readonly known: readonly KnownFactV1[];
  readonly unknown: readonly UnknownFactV1[];
  readonly hypotheses: readonly HypothesisV1[];
  readonly opportunities: readonly OpportunityV1[];
  readonly nextSafeActions: readonly NextSafeActionV1[];
  /** Batched, ordered, and only ever the blocking unknowns. */
  readonly ownerInformationRequest: readonly string[];
  readonly observedAtUtc: string;
}

/**
 * The questions that must be answered before AION can say anything useful about a business.
 *
 * Deliberately short and deliberately fixed. A generated question list grows until it is a
 * questionnaire, and a questionnaire is how an assistant becomes a chore. These five are the ones
 * without which no opportunity can be ranked honestly, and everything else can wait until there is a
 * specific reason to ask it.
 */
export const BLOCKING_DISCOVERY_QUESTIONS_V1: readonly UnknownFactV1[] = Object.freeze([
  {
    question: "What does this business actually do — what does it sell or deliver, and to whom?",
    blocking: true,
    whyItMatters: "Nothing can be prioritised for a business whose output is unknown; every value estimate would be fiction.",
  },
  {
    question: "Where does its revenue come from today, if any?",
    blocking: true,
    whyItMatters: "Revenue-generating work is what AION should protect and repeat; without it there is no baseline to improve.",
  },
  {
    question: "Which recurring work takes the most of the Owner's time?",
    blocking: true,
    whyItMatters: "The Owner wants fewer hours; repetitive work is the only place automation buys them back.",
  },
  {
    question: "What is currently blocking the business from doing more of what works?",
    blocking: true,
    whyItMatters: "A stated bottleneck outranks any opportunity AION could infer on its own.",
  },
  {
    question: "Are there legal, licensing or compliance prerequisites in play?",
    blocking: false,
    whyItMatters: "Worth surfacing early, but it does not stop AION from learning the rest of the business first.",
  },
]);

/**
 * Build the discovery artifact for a business from the facts actually available.
 *
 * The only facts a freshly registered business has are the ones the Owner stated by naming it: that
 * it exists, and that he controls it. That is what appears under `known`. Everything else is a
 * question — which is the honest starting position and the whole reason this function refuses to
 * accept a business model as an argument.
 */
export function buildDiscoveryArtifact(input: {
  business: BusinessWorkspaceV1;
  now: string;
  /** Extra facts from authoritative sources. Each must carry provenance or it is rejected. */
  additionalKnown?: readonly KnownFactV1[];
}): BusinessDiscoveryArtifactV1 {
  const { business, now } = input;

  const known: KnownFactV1[] = [
    {
      fact: `${business.canonicalName} is an Owner-controlled business.`,
      provenance: business.provenance,
      observedAtUtc: business.createdAt,
      evidence: "OWNER_STATED",
    },
  ];
  if (business.category !== null && business.category.trim() !== "") {
    known.push({
      fact: `${business.canonicalName} is categorised as ${business.category}.`,
      provenance: business.provenance,
      observedAtUtc: business.updatedAt,
      evidence: "OWNER_STATED",
    });
  }
  for (const extra of input.additionalKnown ?? []) {
    if (String(extra.provenance).trim() === "") {
      throw new Error(`a known fact about ${business.businessId} has no provenance: ${extra.fact}`);
    }
    known.push(extra);
  }

  // A question already answered is not an unknown. Matching is on the whole recorded fact, which is
  // conservative: a near-miss stays a question rather than being quietly treated as answered.
  const answered = new Set(known.map((fact) => fact.fact.toLowerCase()));
  const unknown = BLOCKING_DISCOVERY_QUESTIONS_V1.filter(
    (question) => ![...answered].some((fact) => fact.includes(question.question.toLowerCase())),
  );
  const blocking = unknown.filter((question) => question.blocking);

  const status: DiscoveryStatusV1 = blocking.length > 0
    ? "NEED_OWNER_INFORMATION"
    : "KNOWLEDGE_SUFFICIENT_FOR_NEXT_STEP";

  return {
    schema: DISCOVERY_ARTIFACT_SCHEMA_V1,
    businessId: business.businessId,
    canonicalName: business.canonicalName,
    status,
    known,
    unknown,
    // Empty on purpose. AION has been told a name and nothing else; a hypothesis about what a
    // business does, formed from its name, is exactly the invention this milestone forbids.
    hypotheses: [],
    opportunities: [],
    nextSafeActions: blocking.length > 0
      ? [{
        action: `Ask the Owner the ${blocking.length} blocking questions about ${business.canonicalName}.`,
        requiredCapabilities: [],
        needsOwnerInput: true,
      }]
      : [{
        action: `Draft bounded next actions for ${business.canonicalName} from the recorded facts.`,
        requiredCapabilities: [],
        needsOwnerInput: false,
      }],
    ownerInformationRequest: blocking.map((question) => question.question),
    observedAtUtc: now,
  };
}

/**
 * Whether an artifact justifies a claim that AION understands the business.
 *
 * Separate from the artifact so the claim has to be made explicitly and can be tested. Writing a
 * file is not learning something, and this is the function that refuses to confuse the two.
 */
export function understandsBusiness(artifact: BusinessDiscoveryArtifactV1): {
  readonly understood: boolean;
  readonly reason: string;
} {
  const blocking = artifact.unknown.filter((question) => question.blocking);
  if (blocking.length > 0) {
    return {
      understood: false,
      reason: `${blocking.length} blocking question(s) unanswered; an artifact exists but it records questions, not knowledge`,
    };
  }
  if (artifact.known.length <= 1) {
    return { understood: false, reason: "the only recorded fact is that the business exists" };
  }
  return { understood: true, reason: `${artifact.known.length} facts recorded with provenance` };
}
