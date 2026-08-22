/**
 * What a retrieval leaves behind, and why a snippet is not a source.
 *
 * Revenue Discovery spent twenty-two review rounds establishing that a number is only worth ranking
 * if it can be traced to something outside the candidate that asserted it. Live research is where
 * that "something outside" finally comes from, so the record it produces has to carry enough for the
 * trace to survive: which task asked, what was asked, what answered, when, in what form, and a digest
 * of exactly what was read.
 *
 * The distinction this module exists to make structural:
 *
 * - a **search hit** is a `DISCOVERY_POINTER`. It says a page might be relevant. It is never evidence
 *   of a fact, because a search engine's one-line summary is a third party's paraphrase of a fourth
 *   party's claim, and the summary is frequently wrong in the direction of being interesting.
 * - a **fetched source** is an `EVIDENCE_SOURCE`. It is the publisher's own words, digested.
 *
 * A pointer can be promoted only by fetching what it points at. Nothing here lets a snippet become
 * evidence by being described as one, which is the laundering path the brief asks to be closed.
 */

import { digestOf } from "./business-evidence.js";
import type { PublicFetchResultV1, PublicSearchResultV1 } from "./public-research-port.js";

export const RESEARCH_RECORD_SCHEMA_V1 = "aion.director.researchRecord.v1" as const;

/** What a record *is*, as opposed to what it says. */
export const RESEARCH_RECORD_ROLES_V1 = ["DISCOVERY_POINTER", "EVIDENCE_SOURCE"] as const;
export type ResearchRecordRoleV1 = (typeof RESEARCH_RECORD_ROLES_V1)[number];

/**
 * The classes a retrieved source can belong to.
 *
 * `OFFICIAL_PUBLIC_DOCUMENT` is separated from `PUBLIC_WEB` because the evidence layer already ranks
 * official regulatory material above ordinary websites, and a statute retrieved from the legislature
 * should not arrive with the same weight as a marketing page that mentions the same statute.
 */
export const RESEARCH_SOURCE_CLASSES_V1 = [
  "OFFICIAL_PUBLIC_DOCUMENT",
  "PUBLIC_MARKETPLACE",
  "PUBLIC_WEB",
] as const;
export type ResearchSourceClassV1 = (typeof RESEARCH_SOURCE_CLASSES_V1)[number];

export interface ResearchRecordV1 {
  readonly schema: typeof RESEARCH_RECORD_SCHEMA_V1;
  readonly recordId: string;
  readonly researchTaskId: string;
  readonly workspaceId: string;
  readonly role: ResearchRecordRoleV1;
  /** The question this retrieval was made for. Kept for readability; see `queries` for matching. */
  readonly query: string;
  /**
   * Every question this exact content has been retrieved for.
   *
   * Identity is workspace, role, URL and digest — deliberately not the question, so the same bytes
   * fetched twice are one record rather than two. But consumption matches on the question, so with
   * only the first query stored a second task that fetched the very same page was told it was a
   * duplicate and then never served it. The page answers both; the record now says so.
   */
  readonly queries: readonly string[];
  /** The publisher's URL, canonicalised. Never the search engine's redirect wrapper. */
  readonly canonicalUrl: string;
  readonly sourceClass: ResearchSourceClassV1;
  readonly title: string;
  /** What was actually read: the snippet for a pointer, the extracted text for a source. */
  readonly extract: string;
  readonly contentDigest: string;
  readonly retrievedAtUtc: string;
  /** Publication date where the page states one. Empty when it does not — never guessed. */
  readonly observedPublicationDate: string;
  readonly geography: readonly string[];
  readonly provider: string;
  readonly retrievalMethod: "SEARCH" | "FETCH";
  readonly httpStatus: number;
  readonly redirectChain: readonly string[];
}

/**
 * Canonical form of a URL, for identity.
 *
 * Fragment and common tracking parameters are dropped, host is lowercased, a trailing slash on a
 * bare path is normalised away. Two URLs that differ only in how somebody arrived at the page are
 * the same page, and treating them as different is how a duplicate-evidence problem starts.
 */
export function canonicalUrlV1(candidate: string): string {
  try {
    const url = new URL(candidate);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|msclkid|ref|referrer|source|mc_cid|mc_eid|_ga)/iu.test(key)) {
        url.searchParams.delete(key);
      }
    }
    if (url.pathname !== "/" && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
    return url.toString();
  } catch {
    return candidate.trim();
  }
}

/** Official-looking hosts get the stronger class. Everything else is ordinary public web. */
const OFFICIAL_HOST_PATTERNS: readonly RegExp[] = Object.freeze([
  /(^|\.)([a-z0-9-]+\.)?gov$/iu,
  /(^|\.)([a-z0-9-]+\.)?mil$/iu,
  /(^|\.)state\.fl\.us$/iu,
  /(^|\.)myflorida\.com$/iu,
  /(^|\.)floridahealth\.gov$/iu,
  /(^|\.)leg\.state\.fl\.us$/iu,
]);

const MARKETPLACE_HOST_PATTERNS: readonly RegExp[] = Object.freeze([
  /(^|\.)care\.com$/iu,
  /(^|\.)indeed\.com$/iu,
  /(^|\.)ziprecruiter\.com$/iu,
  /(^|\.)glassdoor\.com$/iu,
  /(^|\.)agingcare\.com$/iu,
  /(^|\.)caring\.com$/iu,
]);

export function classifySourceV1(url: string): ResearchSourceClassV1 {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return "PUBLIC_WEB"; }
  if (OFFICIAL_HOST_PATTERNS.some((pattern) => pattern.test(host))) return "OFFICIAL_PUBLIC_DOCUMENT";
  if (MARKETPLACE_HOST_PATTERNS.some((pattern) => pattern.test(host))) return "PUBLIC_MARKETPLACE";
  return "PUBLIC_WEB";
}

/**
 * Strip a fetched HTML page to readable text.
 *
 * Script and style bodies are removed *before* tags, because a script's contents are not text the
 * page displays and are a favourite place to hide instructions aimed at whatever is reading. The
 * result is still untrusted — this is a legibility step, not a sanitisation one, and nothing
 * downstream may treat the output as anything but data.
 */
export function extractReadableTextV1(html: string, limit = 20_000): string {
  const withoutScripts = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu, " ")
    .replace(/<!--[\s\S]*?-->/gu, " ");
  return withoutScripts
    .replace(/<[^>]+>/gu, " ")
    .replace(/&amp;/gu, "&").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"').replace(/&#x27;/gu, "'").replace(/&#39;/gu, "'")
    .replace(/&nbsp;/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, limit);
}

/**
 * A publication date the page states about itself.
 *
 * Only formats that are unambiguous are read, and nothing is inferred from a URL or from the fetch
 * time. An empty string means the page did not say, which is a fact worth keeping — freshness that
 * was guessed is worse than freshness that is absent.
 */
export function extractPublicationDateV1(html: string): string {
  const patterns: readonly RegExp[] = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/iu,
    /<meta[^>]+name=["'](?:date|pubdate|publish-date|DC\.date)["'][^>]+content=["']([^"']+)["']/iu,
    /<time[^>]+datetime=["']([^"']+)["']/iu,
    /"datePublished"\s*:\s*"([^"]+)"/iu,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1] !== undefined) {
      const parsed = new Date(match[1]);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }
  return "";
}

/**
 * Identity of a record.
 *
 * Deliberately *not* the content digest alone, and deliberately not the URL alone. The URL says which
 * page; the digest says which version of it; the role says whether this is the pointer or the source.
 * Together they make re-retrieving unchanged content idempotent while a genuine change becomes a new
 * record rather than a silent overwrite.
 */
export function researchRecordIdV1(input: {
  workspaceId: string;
  canonicalUrl: string;
  role: ResearchRecordRoleV1;
  contentDigest: string;
}): string {
  return digestOf(`${input.workspaceId}|${input.role}|${input.canonicalUrl}|${input.contentDigest}`);
}

/** Build the pointer records a search produced. Snippets, explicitly labelled as such. */
export function pointerRecordsFromSearchV1(input: {
  search: PublicSearchResultV1;
  researchTaskId: string;
  workspaceId: string;
  geography: readonly string[];
}): readonly ResearchRecordV1[] {
  return input.search.hits.map((hit) => {
    const canonicalUrl = canonicalUrlV1(hit.url);
    const contentDigest = digestOf(`${canonicalUrl}|${hit.title}|${hit.snippet}`);
    return {
      schema: RESEARCH_RECORD_SCHEMA_V1,
      recordId: researchRecordIdV1({ workspaceId: input.workspaceId, canonicalUrl, role: "DISCOVERY_POINTER", contentDigest }),
      researchTaskId: input.researchTaskId,
      workspaceId: input.workspaceId,
      role: "DISCOVERY_POINTER" as const,
      query: input.search.query,
      queries: Object.freeze([input.search.query]),
      canonicalUrl,
      sourceClass: classifySourceV1(canonicalUrl),
      title: hit.title,
      extract: hit.snippet,
      contentDigest,
      retrievedAtUtc: input.search.retrievedAtUtc,
      observedPublicationDate: "",
      geography: Object.freeze([...input.geography]),
      provider: input.search.provider,
      retrievalMethod: "SEARCH" as const,
      httpStatus: 200,
      redirectChain: Object.freeze([]),
    };
  });
}

/** Build the evidence record a fetch produced. The publisher's own words. */
export function sourceRecordFromFetchV1(input: {
  fetched: PublicFetchResultV1;
  researchTaskId: string;
  workspaceId: string;
  query: string;
  geography: readonly string[];
  provider: string;
  title?: string;
}): ResearchRecordV1 {
  const canonicalUrl = canonicalUrlV1(input.fetched.finalUrl);
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(input.fetched.body);
  return {
    schema: RESEARCH_RECORD_SCHEMA_V1,
    recordId: researchRecordIdV1({
      workspaceId: input.workspaceId, canonicalUrl, role: "EVIDENCE_SOURCE", contentDigest: input.fetched.digest,
    }),
    researchTaskId: input.researchTaskId,
    workspaceId: input.workspaceId,
    role: "EVIDENCE_SOURCE",
    query: input.query,
    queries: Object.freeze([input.query]),
    canonicalUrl,
    sourceClass: classifySourceV1(canonicalUrl),
    title: input.title ?? extractReadableTextV1(titleMatch?.[1] ?? "", 200),
    extract: extractReadableTextV1(input.fetched.body),
    contentDigest: input.fetched.digest,
    retrievedAtUtc: input.fetched.retrievedAtUtc,
    /*
     * The transport's answer first, because it saw the markup.
     *
     * A transport that strips HTML before returning it — which the one in `apps/aion` does — leaves
     * nothing here for `extractPublicationDateV1` to find, so a date read downstream is always empty.
     * The local extraction stays as the fallback for a transport that hands back raw markup, and a
     * live run caught the difference: every source came back "unstated" until this preferred the
     * value the fetch already had.
     */
    observedPublicationDate: input.fetched.publishedAtUtc !== undefined && input.fetched.publishedAtUtc !== ""
      ? input.fetched.publishedAtUtc
      : extractPublicationDateV1(input.fetched.body),
    geography: Object.freeze([...input.geography]),
    provider: input.provider,
    retrievalMethod: "FETCH",
    httpStatus: input.fetched.status,
    redirectChain: Object.freeze([...input.fetched.redirectChain]),
  };
}
