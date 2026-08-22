/**
 * The Director's research transport, built on the fetch this repository already had.
 *
 * An earlier pass of this milestone wrote a second SSRF guard, a second bounded reader and a second
 * redirect walker in `packages/local-assistant`. That was wrong twice over: the package is
 * architecturally forbidden from containing network code — a test enforces it — and `research-fetch.mjs`
 * already did all of it, better. Its guard refuses `::ffff:7f00:1`, which the replacement did not
 * until a live probe caught it. The parallel stack was deleted; this adapter is what remains, and it
 * is deliberately thin.
 *
 * What it adds is shape, not behaviour. The Director speaks in `search(query, now)` and
 * `fetchPublic(url, now)` — two verbs, no method, no headers, no body — and `fetchPublicDocument`
 * speaks in documents. This translates between them and nothing else.
 *
 * On search: there is no zero-cost search provider available here. `SearxngSearchProviderV1` needs a
 * SearXNG instance the Owner runs, and none is configured. So `search` refuses in a way the caller
 * can tell apart from "found nothing", and research proceeds by seeded fetch — which is exactly what
 * `PublicUrlResearchProviderV1` was written for: "a search API being unavailable must not mean
 * research is unavailable."
 */

import { fetchPublicDocument, SearxngSearchProviderV1 } from "./research-fetch.mjs";

export const SEARCH_UNAVAILABLE_MARKER_V1 = "no public search provider is configured";

/**
 * Why the absence of search is reported rather than papered over.
 *
 * A search that returns an empty list when it was never able to run tells the operator the market has
 * no data, when what happened is that nobody was asked. Those are opposite facts, and Revenue
 * Discovery's whole design rests on being able to distinguish them.
 */
export function searchUnavailableError(detail) {
  return new Error(`${SEARCH_UNAVAILABLE_MARKER_V1}: ${detail}`);
}

export function isSearchUnavailable(error) {
  return error instanceof Error && error.message.startsWith(SEARCH_UNAVAILABLE_MARKER_V1);
}

/**
 * Build the transport the Director's governed port wraps.
 *
 * `searchProvider` is optional and absent by default. When the Owner runs a SearXNG instance it can
 * be supplied here and search starts working with no other change; until then every search refuses
 * with a reason naming the missing dependency.
 */
export function createResearchTransportV1(options = {}) {
  /*
   * The provider is built from a URL, never accepted as an object.
   *
   * An injected `searchProvider` was a hole the types could not see: anything with a `.search()` could
   * be handed in, and nothing forced it through `fetchPublicDocument`, the SSRF walker, GET-only or
   * `credentials: "omit"`. "Read-only is structural" cannot survive a caller supplying the transport.
   * Taking a URL and constructing `SearxngSearchProviderV1` here means every byte of search traffic
   * goes down the same governed path as every fetch.
   */
  const searchProvider = typeof options.searxngBaseUrl === "string" && options.searxngBaseUrl.trim() !== ""
    ? new SearxngSearchProviderV1(options.searxngBaseUrl)
    : null;
  const maxBytes = options.maxBytes ?? 512 * 1024;
  const timeoutMs = options.timeoutMs ?? 20_000;

  return Object.freeze({
    async search(query, now) {
      if (searchProvider === null) {
        throw searchUnavailableError(
          "SearxngSearchProviderV1 needs a SearXNG instance the Owner runs and none is configured;"
          + " research proceeds by seeded public fetch instead",
        );
      }
      const results = await searchProvider.search(String(query), options.maxHits ?? 10);
      return {
        query: String(query),
        provider: searchProvider.id ?? "search",
        hits: results.map((entry, index) => ({
          rank: index + 1,
          title: String(entry.title ?? ""),
          url: String(entry.url ?? ""),
          /*
           * No snippet from this provider, and none invented.
           *
           * A hit with an empty snippet is a pointer with nothing said about it, which is honest. A
           * fabricated summary would be a model-generated claim wearing a retrieval's provenance.
           */
          snippet: "",
        })),
        retrievedAtUtc: now,
        adsFiltered: 0,
      };
    },

    async fetchPublic(url, now) {
      const document = await fetchPublicDocument(String(url), { maxBytes, timeoutMs, now: () => now });
      /*
       * Re-shaped, not re-fetched.
       *
       * `redirects` from the underlying fetch excludes the final hop, and the Director's record wants
       * the whole chain including where it landed, so the final URL is appended rather than the walk
       * being repeated.
       */
      return {
        finalUrl: document.url,
        status: 200,
        contentType: document.contentType,
        body: document.text,
        bytes: document.bytes,
        truncated: document.truncated,
        digest: document.digest,
        redirectChain: [...document.redirects, document.url],
        publishedAtUtc: document.publishedAt ?? "",
        retrievedAtUtc: document.retrievedAt,
      };
    },
  });
}
