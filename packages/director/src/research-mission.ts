/**
 * A research mission: search, choose, fetch, record — bounded on every axis, and it stops.
 *
 * The failure this is written against is the one every agent that can browse eventually has: it
 * follows a link, which suggests another link, and the run ends when somebody notices. So the bounds
 * are not advisory limits checked at the end; they are the loop condition. Queries, fetches, bytes
 * and wall-clock all decrement toward zero, and the mission reports which bound it hit.
 *
 * The other property this holds is that a mission **never crawls**. It searches once per question and
 * fetches a small number of results chosen from that one search. A fetched page's own links are not
 * followed, because "the page mentioned another page" is exactly the signal that turns targeted
 * research into an afternoon of browsing.
 */

import { isResearchGateRefusalV1, type GovernedResearchPortV1 } from "./public-research-port.js";
import type { ResearchStoreV1 } from "./research-store.js";
import {
  classifySourceV1,
  pointerRecordsFromSearchV1,
  sourceRecordFromFetchV1,
  type ResearchRecordV1,
} from "./research-record.js";

export const RESEARCH_MISSION_SCHEMA_V1 = "aion.director.researchMission.v1" as const;

export interface ResearchBoundsV1 {
  readonly maxQueries: number;
  readonly maxFetches: number;
  readonly maxBytes: number;
  readonly maxMs: number;
  /** How many results from one search may be fetched. Small on purpose. */
  readonly fetchesPerQuery: number;
}

export const RESEARCH_BOUNDS_V1: ResearchBoundsV1 = Object.freeze({
  maxQueries: 4,
  maxFetches: 6,
  maxBytes: 6_000_000,
  maxMs: 120_000,
  fetchesPerQuery: 2,
});

export const RESEARCH_STOP_REASONS_V1 = [
  "QUESTIONS_EXHAUSTED",
  "QUERY_BUDGET",
  "FETCH_BUDGET",
  "BYTE_BUDGET",
  "TIME_BUDGET",
  "CAPABILITY_REFUSED",
] as const;
export type ResearchStopReasonV1 = (typeof RESEARCH_STOP_REASONS_V1)[number];

export interface ResearchQuestionV1 {
  readonly researchTaskId: string;
  readonly question: string;
  readonly query: string;
  /**
   * Public pages known in advance to bear on this question.
   *
   * Search turned out to be the unreliable half of this capability — the provider serves an anti-bot
   * challenge after a few automated queries — while direct fetch is completely dependable. Seeds are
   * how a mission still makes progress when the search half is unavailable, and they are also the
   * better route for official sources: the statute AION needs has a stable URL, and finding it by
   * searching would be a worse way to arrive at the same document.
   *
   * A seed is a *location*, never a fact. Nothing is assumed about what the page says; it is fetched,
   * digested and recorded like anything else. A seed that has moved or 404s produces **no record at
   * all** — the fetch refuses a non-OK status — so it surfaces as a refusal on this report rather
   * than as a stored error page. An earlier version of this comment claimed the opposite.
   */
  readonly seeds?: readonly { readonly url: string; readonly scope: readonly string[] }[];
}

export interface ResearchMissionReportV1 {
  readonly schema: typeof RESEARCH_MISSION_SCHEMA_V1;
  readonly workspaceId: string;
  readonly stopReason: ResearchStopReasonV1;
  readonly queriesRun: number;
  readonly fetchesRun: number;
  readonly bytesRead: number;
  readonly pointersRecorded: number;
  readonly sourcesRecorded: number;
  readonly duplicatesSkipped: number;
  readonly refusals: readonly string[];
  /**
   * The subset of refusals that came from the effect gate rather than the network.
   *
   * Separate because they mean opposite things: a timeout is a bad afternoon, the gate refusing is
   * AION attempting something it is not authorized to do, and the second should never be buried in a
   * list of the first.
   */
  readonly gateRefusals: readonly string[];
  readonly recordIds: readonly string[];
}

/**
 * Which search hits are worth spending a fetch on.
 *
 * Official sources first, then marketplaces, then ordinary pages, and within a class the order the
 * search returned. This is a preference, not a claim about truth — a `.gov` page is not automatically
 * right, it is simply the one whose provenance survives best, and fetch budget is the scarce thing.
 */
export function rankHitsForFetchV1(
  hits: readonly { readonly url: string; readonly rank: number }[],
): readonly { readonly url: string; readonly rank: number }[] {
  const weight = (url: string): number => {
    const cls = classifySourceV1(url);
    if (cls === "OFFICIAL_PUBLIC_DOCUMENT") return 0;
    if (cls === "PUBLIC_MARKETPLACE") return 1;
    return 2;
  };
  return [...hits].sort((a, b) => weight(a.url) - weight(b.url) || a.rank - b.rank);
}

/**
 * Run one bounded mission.
 *
 * `now` is a function rather than a value because a mission spans real time and the records it writes
 * should say when each retrieval happened, not when the mission started. `elapsedMs` is injected for
 * the same reason a clock always is here: a test that has to wait two minutes to prove a two-minute
 * budget works is a test nobody runs.
 */
export async function runResearchMissionV1(input: {
  workspaceId: string;
  geography: readonly string[];
  questions: readonly ResearchQuestionV1[];
  port: GovernedResearchPortV1;
  store: ResearchStoreV1;
  now: () => string;
  elapsedMs: () => number;
  bounds?: ResearchBoundsV1;
}): Promise<ResearchMissionReportV1> {
  const bounds = input.bounds ?? RESEARCH_BOUNDS_V1;
  const refusals: string[] = [];
  /** Refusals that came from the effect gate, kept apart from transport failures. */
  const gateRefusals: string[] = [];
  const recordIds: string[] = [];
  let queriesRun = 0;
  let fetchesRun = 0;
  let bytesRead = 0;
  let pointersRecorded = 0;
  let sourcesRecorded = 0;
  let duplicatesSkipped = 0;
  let stopReason: ResearchStopReasonV1 = "QUESTIONS_EXHAUSTED";
  /*
   * The budget that ran out, tracked separately from the final reason.
   *
   * `stopReason` is written from inside a closure, which the type narrowing cannot follow, and more
   * importantly "did a budget run out" is a different question from "what should the report say".
   * Keeping them apart makes both readable.
   */
  let budgetStop: ResearchStopReasonV1 | null = null;

  const remember = (record: ResearchRecordV1): void => {
    const { stored, created } = input.store.put(record);
    if (created) {
      recordIds.push(stored.record.recordId);
      if (record.role === "EVIDENCE_SOURCE") sourcesRecorded += 1; else pointersRecorded += 1;
    } else {
      duplicatesSkipped += 1;
    }
  };

  const fetchOne = async (
    url: string,
    question: ResearchQuestionV1,
    /* The area this source is evidence about, which is not necessarily the area AION works in. */
    scope: readonly string[],
  ): Promise<boolean> => {
    if (fetchesRun >= bounds.maxFetches) { budgetStop = "FETCH_BUDGET"; return false; }
    if (bytesRead >= bounds.maxBytes) { budgetStop = "BYTE_BUDGET"; return false; }
    if (input.elapsedMs() >= bounds.maxMs) { budgetStop = "TIME_BUDGET"; return false; }
    /*
     * Counted before the call, not after it succeeds.
     *
     * Incrementing on success meant a failing host could be attempted without limit: the budget
     * bounded how much AION *received* rather than how often it left the machine, which is the thing
     * a bound on outbound requests is for.
     */
    fetchesRun += 1;
    try {
      const result = await input.port.fetchPublic(url, input.now());
      bytesRead += result.fetched.bytes;
      remember(sourceRecordFromFetchV1({
        fetched: result.fetched,
        researchTaskId: question.researchTaskId,
        workspaceId: input.workspaceId,
        query: question.question,
        geography: scope,
        provider: "direct-fetch",
      }));
      return true;
    } catch (error) {
      const failure = error as Error;
      refusals.push(`fetch ${url}: ${failure.message}`);
      if (isResearchGateRefusalV1(failure)) gateRefusals.push(failure.message);
      return false;
    }
  };

  for (const question of input.questions) {
    if (input.elapsedMs() >= bounds.maxMs) { stopReason = "TIME_BUDGET"; break; }

    /* Seeds first: they are known-relevant and they do not depend on the provider being willing. */
    for (const seed of question.seeds ?? []) {
      await fetchOne(seed.url, question, seed.scope);
      if (budgetStop !== null) break;
    }
    if (budgetStop !== null) break;

    if (queriesRun >= bounds.maxQueries) { stopReason = "QUERY_BUDGET"; continue; }

    let hits: readonly { url: string; rank: number; title: string; snippet: string }[] = [];
    /*
     * Counted before the call, exactly as fetches are.
     *
     * Incrementing after success meant a search provider that always threw consumed no budget, so
     * every remaining question still called it. A bound on outbound requests has to bound how often
     * AION leaves the machine, not how often it succeeds in doing so.
     */
    queriesRun += 1;
    try {
      const result = await input.port.search(question.query, input.now());
      hits = result.search.hits;
      const pointers = pointerRecordsFromSearchV1({
        search: result.search,
        researchTaskId: question.researchTaskId,
        workspaceId: input.workspaceId,
        geography: input.geography,
      });
      for (const record of pointers) remember(record);
    } catch (error) {
      /*
       * A refused or failed search ends this question, not the mission.
       *
       * One provider hiccup should not discard the questions after it, and a capability refusal is
       * recorded as text rather than thrown because the mission's job is to report what it managed
       * and what it could not — a thrown error would lose the former.
       *
       * The classification happens here, while the error object still exists. An earlier version
       * pushed a formatted string and then asked a later stage whether that string looked like a gate
       * refusal, which it never could: the prefix had already been buried behind `search "…": `.
       * And it matched `/refused/` on the message, which fires on `ECONNREFUSED` — a router being
       * unreachable is not AION being told it may not ask.
       */
      const failure = error as Error;
      refusals.push(`search "${question.query}": ${failure.message}`);
      if (isResearchGateRefusalV1(failure)) gateRefusals.push(failure.message);
      continue;
    }

    let fetchedForThisQuery = 0;
    for (const hit of rankHitsForFetchV1(hits)) {
      if (fetchedForThisQuery >= bounds.fetchesPerQuery) break;
      /*
       * A searched-for page's scope is unknown, so it is recorded as unknown.
       *
       * Nothing about a search result says which area it describes. Stamping the workspace's counties
       * on it would be the same lie the seeds just stopped telling.
       */
      const fetched = await fetchOne(hit.url, question, ["UNKNOWN_AREA"]);
      if (fetched) fetchedForThisQuery += 1;
      if (budgetStop !== null) break;
    }
    if (budgetStop !== null) break;
  }

  return {
    schema: RESEARCH_MISSION_SCHEMA_V1,
    workspaceId: input.workspaceId,
    /* A budget that ran out is the reason, whatever the loop was doing when it noticed. */
    /*
     * A gate refusal is the reason only when nothing else stopped the run.
     *
     * It also has to be derived at the end rather than latched mid-loop: an earlier version set it in
     * the search `catch` and never cleared it, so a mission that went on to fetch four sources
     * successfully still reported that a capability had refused it.
     */
    stopReason: budgetStop ?? (gateRefusals.length > 0 && recordIds.length === 0
      ? "CAPABILITY_REFUSED"
      : stopReason),
    queriesRun,
    fetchesRun,
    bytesRead,
    pointersRecorded,
    sourcesRecorded,
    duplicatesSkipped,
    refusals: Object.freeze(refusals),
    gateRefusals: Object.freeze(gateRefusals),
    recordIds: Object.freeze(recordIds),
  };
}
