/**
 * Market research tasks, their provenance, and the capability AION does not have.
 *
 * Everything here is built around a fact established before the code: **there is no read-only
 * public web research route.** `apps/aion/outward-effect-guard.mjs` declares six outward routes,
 * every one `REQUIRES_INTEGRATION`, and the authorizer map is empty. Creating one would modify the
 * boundary Findings 2 + 3 closed, which this milestone is not authorized to do.
 *
 * So the research port is an interface with no implementation. When a task needs it, the task
 * records `BLOCKED_BY_CAPABILITY` and stays open with its question intact. That is a durable,
 * inspectable statement of what AION would learn if it could reach the web — which is considerably
 * more useful than a plausible answer, and is the only honest option.
 *
 * The rule that makes provenance real: **a model summary is never the sole source.** A research item
 * with `DERIVED_SUMMARY` and no upstream reference is rejected at construction, not filtered later.
 */

import { digestOf } from "./business-evidence.js";
import { COMPASSIONATE_CHOICE_WORKSPACE_V1 } from "./business-corpus.js";
import type { EvidenceKindV1 } from "./revenue-opportunity.js";

export const RESEARCH_TASK_SCHEMA_V1 = "aion.director.researchTask.v1" as const;
export const RESEARCH_ITEM_SCHEMA_V1 = "aion.director.researchItem.v1" as const;

export const RESEARCH_TASK_STATES_V1 = [
  "OPEN",
  "SATISFIED",
  "BLOCKED_BY_CAPABILITY",
  "NEEDS_OWNER_INFORMATION",
] as const;
export type ResearchTaskStateV1 = (typeof RESEARCH_TASK_STATES_V1)[number];

export const RESEARCH_SOURCE_TYPES_V1 = [
  "PUBLIC_WEB",
  "PUBLIC_GOVERNMENT",
  "PUBLIC_MARKETPLACE",
  "OWNER_STATEMENT",
  "CAPTURED_FIXTURE",
  "DERIVED_SUMMARY",
] as const;
export type ResearchSourceTypeV1 = (typeof RESEARCH_SOURCE_TYPES_V1)[number];

/** The declared vocabularies. Anything outside them is a malformed row, not a weak one. */
export const RESEARCH_EVIDENCE_QUALITIES_V1 = ["STRONG", "MODERATE", "WEAK", "NONE"] as const;
export const RESEARCH_FRESHNESS_V1 = ["CURRENT", "AGING", "STALE", "UNKNOWN"] as const;

/**
 * A single retrieved fact.
 *
 * `CAPTURED_FIXTURE` exists so the operator can be exercised in tests without any source ever being
 * mistaken for a real finding. Fixtures are excluded from evidence quality by
 * `isRealMarketEvidence`, so a test cannot accidentally make a candidate look evidenced.
 */
export interface ResearchItemV1 {
  readonly schema: typeof RESEARCH_ITEM_SCHEMA_V1;
  readonly itemId: string;
  readonly taskId: string;
  readonly workspaceId: string;
  readonly sourceType: ResearchSourceTypeV1;
  /** URL, document name, or the exchange it came from. Never empty. */
  readonly sourceRef: string;
  /** Upstream source for a summary. Required when `sourceType` is `DERIVED_SUMMARY`. */
  readonly derivedFrom: string;
  readonly retrievedAtUtc: string;
  readonly geography: readonly string[];
  readonly fact: string;
  readonly freshness: (typeof RESEARCH_FRESHNESS_V1)[number];
  readonly evidenceQuality: (typeof RESEARCH_EVIDENCE_QUALITIES_V1)[number];
}

export interface ResearchTaskV1 {
  readonly schema: typeof RESEARCH_TASK_SCHEMA_V1;
  readonly taskId: string;
  readonly workspaceId: string;
  /** The question, phrased so an answer would visibly settle it. */
  readonly question: string;
  /** What decision changes once this is answered. A task that changes nothing is not worth running. */
  readonly decisionAffected: string;
  /** 0..1 — how much this improves the next decision, used to order research. */
  readonly informationGain: number;
  readonly requiresPublicWeb: boolean;
  /**
   * What an answer to this question would be evidence *of*.
   *
   * Every retrieved item used to be filed as PRICE, so a caregiver-wage posting could ground a
   * selling price. What a question asks about determines what its answer can support.
   */
  readonly evidenceKind: EvidenceKindV1;
  readonly requiresOwner: boolean;
  readonly state: ResearchTaskStateV1;
  readonly blockedReason: string;
  readonly itemIds: readonly string[];
  readonly createdAtUtc: string;
}

export function researchTaskIdFor(workspaceId: string, question: string): string {
  return digestOf(`${workspaceId}|${question}`);
}

export function buildResearchItem(input: Omit<ResearchItemV1, "schema" | "itemId">): ResearchItemV1 {
  if (input.sourceRef.trim() === "") throw new Error("a research item must name its source");
  /*
   * The source type has to be one of the declared ones.
   *
   * Every other field on a retrieved row was treated as untrusted and this one was not — which is
   * the field that decides whether the row is a fixture. A caller could relabel a
   * `CAPTURED_FIXTURE` as `PUBLIC_WEB`, or invent a type entirely, and walk straight past the rule
   * that keeps fixtures out of the evidence count.
   */
  if (!(RESEARCH_SOURCE_TYPES_V1 as readonly string[]).includes(input.sourceType)) {
    throw new Error(`unknown research source type "${input.sourceType}"`);
  }
  if (input.sourceType === "DERIVED_SUMMARY" && input.derivedFrom.trim() === "") {
    throw new Error("a derived summary must name the source it summarises; a summary is not a source");
  }
  if (input.fact.trim() === "") throw new Error("a research item must carry a fact");
  /*
   * Quality and freshness are discriminators too, and were copied straight from the source.
   *
   * `isRealMarketEvidence` reads `evidenceQuality !== "NONE"`, so a missing quality, a lowercase
   * "none", a trailing space, or an invented "CERTAIN" all counted as real market evidence. Two
   * fields were validated because they had been caught; the rule is that *nothing* from outside is
   * taken on trust.
   */
  if (!(RESEARCH_EVIDENCE_QUALITIES_V1 as readonly string[]).includes(input.evidenceQuality)) {
    throw new Error(`unknown evidence quality "${input.evidenceQuality}"`);
  }
  if (!(RESEARCH_FRESHNESS_V1 as readonly string[]).includes(input.freshness)) {
    throw new Error(`unknown freshness "${input.freshness}"`);
  }
  /*
   * Geography is checked here rather than at the filter.
   *
   * The out-of-area filter called `item.geography.length` and `area.toLowerCase()` on whatever the
   * port sent, so a missing array or a non-string entry threw out of `attemptResearch` and failed
   * the whole Director step — a malformed row taking down the run instead of being counted as one.
   */
  if (!Array.isArray(input.geography) || input.geography.length === 0
    || input.geography.some((area) => typeof area !== "string" || area.trim() === "")) {
    throw new Error("a research item must name the area or areas it describes");
  }

  /*
   * The spread comes first so the constructor's own fields win.
   *
   * With `...input` last, a caller that happened to carry `itemId` — which is exactly what a port
   * returning `ResearchItemV1` objects does — overwrote the computed digest with its own. The id
   * that is supposed to be derived from the content was whatever the source said it was.
   */
  return {
    ...input,
    schema: RESEARCH_ITEM_SCHEMA_V1,
    itemId: digestOf(`${input.taskId}|${input.sourceRef}|${input.fact}`),
  };
}

/**
 * Whether an item counts as real market evidence.
 *
 * Fixtures and unattributed summaries do not. This is the function that stops the test suite from
 * quietly manufacturing the confidence the milestone is supposed to lack.
 */
/** The source classes that can carry a fact about the *market*. Everything else corroborates. */
export const MARKET_SOURCE_TYPES_V1: readonly ResearchSourceTypeV1[] =
  ["PUBLIC_WEB", "PUBLIC_GOVERNMENT", "PUBLIC_MARKETPLACE"] as const;

export function isRealMarketEvidence(item: ResearchItemV1): boolean {
  /*
   * An allowlist, because the exclusions kept being one member short.
   *
   * Excluding fixtures and summaries left `OWNER_STATEMENT` counting as market evidence, so a port
   * returning that type walked in exactly where the fixture rule had been closed. The Owner knows
   * this business; he is not a source on what competitors charge. Naming what *does* count means a
   * new source type is out until somebody decides it belongs in.
   */
  if (!MARKET_SOURCE_TYPES_V1.includes(item.sourceType)) return false;
  if (item.sourceType === "CAPTURED_FIXTURE") return false;
  /*
   * A summary never counts on its own, attributed or not.
   *
   * Requiring `derivedFrom` to be non-empty was not enough: nothing checks that the named upstream
   * is real, so a summary of a captured fixture — or of an id that does not exist — counted as market
   * evidence and re-admitted through the back door exactly what the fixture rule keeps out. This
   * matches the evidence layer's own rule, where derived summaries corroborate and never govern.
   */
  if (item.sourceType === "DERIVED_SUMMARY") return false;
  return item.evidenceQuality !== "NONE";
}

/* -------------------------------------------------------------------------- */
/* The research port AION does not have                                        */
/* -------------------------------------------------------------------------- */

export interface ResearchQueryV1 {
  readonly question: string;
  readonly geography: readonly string[];
}

/**
 * A read-only public web research transport.
 *
 * Same shape as the outward transport port from the Findings 2 + 3 repair, and for the same reason:
 * an absent transport is a refusal, never a fallback. Nothing in this repository implements it.
 */
export interface ResearchPortV1 {
  readonly fetchPublicEvidence: (query: ResearchQueryV1) => readonly ResearchItemV1[];
}

export const RESEARCH_CAPABILITY_BLOCKER_V1 =
  "no read-only public web research route is declared or authorized; "
  + "apps/aion/outward-effect-guard.mjs declares six routes, all REQUIRES_INTEGRATION with no authorizer";

export interface ResearchAttemptV1 {
  readonly taskId: string;
  readonly attempted: boolean;
  readonly items: readonly ResearchItemV1[];
  readonly state: ResearchTaskStateV1;
  readonly detail: string;
}

/**
 * Try to answer a research task.
 *
 * With no port this refuses and says exactly why, leaving the task open. It does not return an empty
 * result that a caller might read as "nothing found" — the difference between *asked and learned
 * nothing* and *never able to ask* is the difference between a market with no data and a system
 * with no capability, and conflating them would hide the blocker.
 */
export function attemptResearch(
  task: ResearchTaskV1,
  port: ResearchPortV1 | null,
  /* The approved counties. Passed explicitly so a retrieval cannot quietly be unscoped. */
  geography: readonly string[] = [],
): ResearchAttemptV1 {
  if (task.requiresOwner) {
    return {
      taskId: task.taskId,
      attempted: false,
      items: [],
      state: "NEEDS_OWNER_INFORMATION",
      detail: "only the Owner can answer this; no amount of research substitutes",
    };
  }
  if (task.requiresPublicWeb && port === null) {
    return {
      taskId: task.taskId,
      attempted: false,
      items: [],
      state: "BLOCKED_BY_CAPABILITY",
      detail: RESEARCH_CAPABILITY_BLOCKER_V1,
    };
  }
  if (port === null) {
    return {
      taskId: task.taskId,
      attempted: false,
      items: [],
      state: "OPEN",
      detail: "no research port supplied and none required; nothing was attempted",
    };
  }
  /*
   * The query carries the geography the caller is authorized for.
   *
   * This used to pass `[]`, which would have asked the world rather than the five approved counties
   * the moment a port existed — an unscoped question is how out-of-area evidence gets in.
   */
  if (geography.length === 0) {
    return {
      taskId: task.taskId,
      attempted: false,
      items: [],
      state: "OPEN",
      detail: "no geography supplied; research is not run unscoped",
    };
  }
  /*
   * Port output is untrusted input, and is re-validated as such.
   *
   * Retrieved rows never passed through `buildResearchItem`, so an item with an empty `fact` or an
   * empty `sourceRef` — construction errors everywhere else — was counted as real market evidence
   * simply because it arrived from outside. It is also scoped to the workspace that asked: a fact
   * retrieved for one business is not evidence for another.
   */
  const raw = port.fetchPublicEvidence({ question: task.question, geography });
  const rawCount = raw.length;
  const rebuilt = raw
    .flatMap((item) => {
      if (item.workspaceId !== task.workspaceId) return [];
      try {
        return [buildResearchItem({ ...item, taskId: task.taskId })];
      } catch {
        return [];
      }
    });
  const retrieved = rebuilt;

  /*
   * Scoping the question was not enough; the answer has to be scoped too.
   *
   * A port is free to return whatever it likes, including national figures or a county nobody here
   * is authorized for. An out-of-area rate is a real fact about somewhere else, and admitting it
   * would let the five-county boundary be crossed by evidence rather than by action — quietly, and
   * in the direction that makes the market look better understood than it is.
   */
  const authorized = new Set(geography.map((area) => area.toLowerCase()));
  /*
   * Every named area must be authorized, not merely one of them.
   *
   * `some` admitted an item tagged `["Polk", "Miami-Dade"]` wholesale — which is how a statewide or
   * national figure gets in wearing one approved county as a badge. An item that also describes
   * somewhere AION is not authorized for is not evidence about the five counties.
   */
  const items = retrieved.filter((item) =>
    item.geography.length > 0 && item.geography.every((area) => authorized.has(area.toLowerCase())));
  const rejected = retrieved.length - items.length;
  const malformed = rawCount - retrieved.length;

  return {
    taskId: task.taskId,
    attempted: true,
    items,
    state: items.some((item) => {
      const real = isRealMarketEvidence(item);
      return real;
    }) ? "SATISFIED" : "OPEN",
    detail: items.length === 0
      ? `the research ran and returned nothing usable`
        + `${rejected > 0 ? ` (${rejected} outside the authorized area)` : ""}`
        + `${malformed > 0 ? ` (${malformed} malformed)` : ""}`
      : `${items.length} item(s) retrieved${rejected > 0 ? `, ${rejected} rejected as outside the authorized area` : ""}`
        + `${malformed > 0 ? `, ${malformed} rejected as malformed` : ""}`,
  };
}

/* -------------------------------------------------------------------------- */
/* The questions worth asking                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The research AION would run first, ordered by how much each changes the decision.
 *
 * Short on purpose. A generated list grows until it is a survey, and a survey is how research
 * becomes an activity rather than a decision aid. Each entry names the decision it moves, and a task
 * that moves nothing does not belong here.
 */
/**
 * The research AION would run first, for the one business it has questions for.
 *
 * These questions are about agency rates, homemaker wages and companion capacity — they are as
 * specific to a §400.509 companion service as the candidate models are, and they were being asked of
 * every workspace. LocalFinds was being asked whether it had companion capacity today. A question
 * list that does not fit the business is worse than no list: it produces an Owner prompt that reads
 * as though AION knows what the business does.
 */
export function revenueResearchTasks(workspaceId: string, now: string): readonly ResearchTaskV1[] {
  if (workspaceId !== COMPASSIONATE_CHOICE_WORKSPACE_V1) return [];
  const rows: readonly Omit<ResearchTaskV1, "schema" | "taskId" | "state" | "blockedReason" | "itemIds" | "createdAtUtc">[] = [
    {
      workspaceId,
      question: "What do comparable non-medical companion agencies charge per hour in the five approved counties, and what minimum visit length do they require?",
      decisionAffected: "every unit-economics figure; without it no candidate can be priced or ranked",
      informationGain: 1,
      requiresPublicWeb: true,
      requiresOwner: false,
      evidenceKind: "PRICE",
    },
    {
      workspaceId,
      question: "What do companion and homemaker caregivers earn per hour in this labour market?",
      decisionAffected: "contribution margin, and whether any candidate is viable at achievable rates",
      informationGain: 0.9,
      requiresPublicWeb: true,
      requiresOwner: false,
      evidenceKind: "COST",
    },
    {
      workspaceId,
      question: "Is the business currently accepting new clients, and is there any available companion capacity today?",
      decisionAffected: "whether the first experiment is demand-side or supply-side; it changes the whole plan",
      informationGain: 0.85,
      requiresPublicWeb: false,
      requiresOwner: true,
      /* A fact about this business's own capacity, which grounds no financial figure. */
      evidenceKind: "CAPABILITY",
    },
    {
      workspaceId,
      question: "Does the business currently carry general liability insurance?",
      decisionAffected: "whether client-facing validation can proceed at all",
      informationGain: 0.7,
      requiresPublicWeb: false,
      requiresOwner: true,
      evidenceKind: "CAPABILITY",
    },
    {
      workspaceId,
      question: "Does Care.com offer an agency or business recruiting product, at what cost, and what does it verify versus leave to the employer?",
      decisionAffected: "whether caregiver sourcing is a solved problem or the first real constraint",
      informationGain: 0.6,
      requiresPublicWeb: true,
      requiresOwner: false,
      /*
       * Whether a sourcing product exists is a capability fact. It is emphatically not evidence of
       * how long the Owner spends, how many hours the work takes, or how soon revenue arrives — and
       * it was grounding all three while `OPERATIONAL` was one bucket.
       */
      evidenceKind: "CAPABILITY",
    },
  ];

  return rows.map((row) => ({
    schema: RESEARCH_TASK_SCHEMA_V1,
    taskId: researchTaskIdFor(row.workspaceId, row.question),
    ...row,
    state: "OPEN" as ResearchTaskStateV1,
    blockedReason: "",
    itemIds: [],
    createdAtUtc: now,
  }));
}

/**
 * Record what the Owner said about a research question, as a research item.
 *
 * This is the one path by which a research task can be satisfied today: no web route exists, so the
 * only source that can answer anything is the Owner. Going through `buildResearchItem` rather than
 * constructing a record directly means an Owner answer carries the same provenance requirements as
 * anything retrieved — a source reference, a date, a geography and a fact.
 */
export function ownerResearchItem(input: {
  taskId: string;
  workspaceId: string;
  answer: string;
  geography: readonly string[];
  now: string;
}): ResearchItemV1 {
  return buildResearchItem({
    taskId: input.taskId,
    workspaceId: input.workspaceId,
    sourceType: "OWNER_STATEMENT",
    sourceRef: `Owner answer ${input.now}`,
    derivedFrom: "",
    retrievedAtUtc: input.now,
    geography: input.geography,
    fact: input.answer,
    freshness: "CURRENT",
    evidenceQuality: "MODERATE",
  });
}
