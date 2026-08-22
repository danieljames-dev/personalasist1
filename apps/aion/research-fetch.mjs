import { lookup } from "node:dns/promises";
import { assertOutwardEffectAllowed, outwardFetchPinned } from "./outward-effect-guard.mjs";
import { createHash } from "node:crypto";
import { assertResearchUrl, evaluateResearchUrl, isPrivateIpv4, isPrivateIpv6 } from "../../packages/local-assistant/dist/index.js";

/**
 * The governed public-web fetch.
 *
 * This is the only place AION reaches the open internet, and it is written on the assumption that
 * the URL is hostile. Two threats shape it:
 *
 *   **SSRF.** A research question is text, and text can be talked into naming an address on the
 *   owner's own network — a router admin page, a printer, a service on localhost, a cloud
 *   metadata endpoint. The name guard in `research.ts` refuses those by hostname; this file adds
 *   the two things a hostname check cannot do. It resolves the name and checks the *address*, so
 *   a public name pointing at a private IP is caught, and it re-checks on **every redirect hop**,
 *   so a public URL cannot bounce AION somewhere private.
 *
 *   **Volume and time.** A response is read with a hard byte ceiling and the whole request runs
 *   under a timeout, so a slow or enormous page cannot hold AION open.
 *
 * What it deliberately does not do: send credentials or cookies, follow a login, bypass a
 * paywall, or crawl. One URL in, one bounded document out, with provenance.
 */

const MAX_REDIRECTS = 4;
const DEFAULT_TIMEOUT_MS = 20_000;
const ALLOWED_CONTENT = [/^text\/html/iu, /^text\/plain/iu, /^application\/(?:xhtml\+xml|json|xml)/iu, /^text\/xml/iu];

/**
 * Resolves a hostname and refuses if any address behind it is private.
 *
 * This is the check a hostname allowlist cannot make. A perfectly ordinary-looking public name
 * can resolve to 127.0.0.1 or to a machine on the owner's LAN, deliberately or by accident, and
 * the request would then be an SSRF whatever the URL looked like. Every resolved address must be
 * public — one bad answer is enough to refuse.
 */
export async function assertPublicHost(hostname, resolver = lookup) {
  // A literal address has already been judged by the name guard; resolving it again proves nothing.
  if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
    throw new Error(`${hostname} is a private or loopback address. AION does not fetch from your own network.`);
  }
  let addresses;
  try {
    addresses = await resolver(hostname, { all: true });
  } catch {
    throw new Error(`AION could not resolve ${hostname}, so it will not attempt the request.`);
  }
  if (!Array.isArray(addresses) || !addresses.length) {
    throw new Error(`${hostname} resolved to no address.`);
  }
  for (const entry of addresses) {
    const address = String(entry?.address ?? "");
    const bad = entry?.family === 6 ? isPrivateIpv6(address) : isPrivateIpv4(address);
    if (bad) {
      throw new Error(`${hostname} resolves to ${address}, which is on a private, loopback, or link-local network. AION refuses the request: a public name pointing at a private address is how a research task becomes a request to your router.`);
    }
  }
  return addresses.map((entry) => String(entry.address));
}

/**
 * The publication date a page states about itself, or an empty string.
 *
 * Read from the raw markup, because `extractText` removes the `<meta>` and `<time>` elements that
 * carry it — a document extracted first and dated afterwards is always undated. Nothing is inferred
 * from the URL or from when the fetch happened: a page fetched today is not therefore current, and a
 * freshness that was guessed is worse than one that is absent.
 */
export function extractPublishedAt(html) {
  const patterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/iu,
    /<meta[^>]+name=["'](?:date|pubdate|publish-date|DC\.date)["'][^>]+content=["']([^"']+)["']/iu,
    /"datePublished"\s*:\s*"([^"]+)"/iu,
    /<time[^>]+datetime=["']([^"']+)["']/iu,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(String(html ?? ""));
    if (match?.[1] === undefined) continue;
    const parsed = new Date(match[1]);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return "";
}

/** Strips markup and script content, leaving readable text with its whitespace collapsed. */
export function extractText(html, limit = 200_000) {
  return String(html ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, limit);
}

export function extractTitle(html) {
  const match = /<title[^>]*>([\s\S]{0,300}?)<\/title>/iu.exec(String(html ?? ""));
  return match ? extractText(match[1], 300) : "";
}

async function readBounded(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) return { text: "", bytes: 0, truncated: false };
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) { truncated = true; await reader.cancel(); break; }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"), bytes: Math.min(bytes, maxBytes), truncated };
}

/**
 * Fetches one public document, re-validating at every hop.
 *
 * Redirects are followed manually rather than by the runtime, because the runtime would follow
 * them without asking AION's opinion. Each `Location` is re-run through the same guard and the
 * same DNS check as the original, so a redirect chain cannot end anywhere the first URL could
 * not have gone.
 */
export async function fetchPublicDocument(url, options = {}) {
  /*
   * Refuse before resolving anything.
   *
   * `outwardFetch` below is the enforcement, but it runs after the hostname has been resolved and
   * checked -- and a DNS lookup for a URL AION is not permitted to visit is already a request leaving
   * the machine. Checking here as well costs nothing and keeps "disabled" meaning inert.
   */
  assertOutwardEffectAllowed("research.fetch", { url: String(url) });
  // Reaching the open internet is an outward effect, however careful the rest of this file is about
  // where it lands. It runs only once this route is wired to the pre-action effect gate.
  const maxBytes = options.maxBytes ?? 512 * 1024;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const resolver = options.resolver ?? lookup;
  /*
   * The transport is injectable for the same reason the resolver is.
   *
   * Production pins the connection to the addresses that were just validated, which is what closes
   * the rebinding window - and which also means a test cannot reach it by stubbing the global fetch,
   * because the pinned path never calls it. A test that has to drive redirects, oversized bodies and
   * refused content types needs a seam, and inventing a second kind of seam when the resolver already
   * demonstrates the pattern would be the worse choice.
   */
  const transport = options.transport ?? outwardFetchPinned;
  const now = options.now ?? (() => new Date().toISOString());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  options.signal?.addEventListener("abort", () => controller.abort(), { once: true });

  const hops = [];
  try {
    let current = assertResearchUrl(url);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const parsed = new URL(current);
      /*
       * The addresses are kept, not discarded.
       *
       * They were resolved and judged public a line ago; handing the *name* to the fetch would let it
       * resolve again and connect to whatever the second answer said. An independent review caught
       * that: checking one lookup and connecting on another is textbook DNS rebinding, and it is the
       * one SSRF neither the hostname guard nor the address guard sees.
       */
      const validated = await assertPublicHost(parsed.hostname, resolver);
      hops.push(current);

      const response = await transport("research.fetch", current, validated, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        // No cookies, no credentials, no owner identity of any kind. AION is an anonymous reader.
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { accept: "text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.1", "user-agent": "AION/1.3 (owner-run personal assistant; single bounded fetch)" },
      });

      if (response.status >= 300 && response.status < 400) {
        /* Read for its destination and then abandoned, so the socket is closed rather than left. */
        response.destroy?.();
        const location = response.headers.get("location");
        if (!location) throw new Error(`${current} answered ${response.status} with no destination.`);
        const next = new URL(location, current).toString();
        // The whole point: the redirect target is judged exactly as the original was.
        const verdict = evaluateResearchUrl(next);
        if (!verdict.allowed) throw new Error(`${current} tried to redirect to somewhere AION will not follow: ${verdict.reason}`);
        current = verdict.url;
        continue;
      }

      if (!response.ok) { response.destroy?.(); throw new Error(`${current} answered ${response.status}.`); }
      const contentType = response.headers.get("content-type") ?? "";
      if (!ALLOWED_CONTENT.some((pattern) => pattern.test(contentType))) {
        /* Refused before the body is read, and the connection ended rather than left hanging. */
        response.destroy?.();
        throw new Error(`${current} returned ${contentType || "an unstated content type"}. AION reads text documents only.`);
      }
      const { text, bytes, truncated } = await readBounded(response, maxBytes);
      return {
        url: current,
        redirects: hops.slice(0, -1),
        title: extractTitle(text) || new URL(current).hostname,
        text: extractText(text),
        bytes,
        truncated,
        contentType: contentType.split(";")[0]?.trim() ?? "",
        publishedAt: extractPublishedAt(text),
        retrievedAt: now(),
        digest: createHash("sha256").update(text).digest("hex"),
      };
    }
    throw new Error(`${url} redirected more than ${MAX_REDIRECTS} times. AION stops rather than following a chain.`);
  } finally { clearTimeout(timer); }
}

/**
 * A research provider that reads exactly the URLs the owner supplied.
 *
 * No search, no discovery, no crawling: seeds in, documents out. This is the provider that works
 * without any search service configured at all, which is the point — a search API being
 * unavailable must not mean research is unavailable.
 */
export class PublicUrlResearchProviderV1 {
  id = "public-url";
  reachesNetwork = true;
  constructor(options = {}) { this.options = options; }
  async health() {
    return { available: true, detail: "Reads public URLs you supply. It performs no search, follows no links, and sends no credentials or cookies." };
  }
  async run(request) {
    if (request.scope === "local-only") {
      return { sources: [], findings: [], unresolved: ["This job is scoped local-only, so AION made no network request."], costCents: 0 };
    }
    const sources = [];
    const findings = [];
    const unresolved = [];
    for (const seed of request.seedReferences.slice(0, request.limits.maxSources)) {
      try {
        const document = await fetchPublicDocument(seed, { ...this.options, maxBytes: request.limits.maxBytesPerSource, signal: request.signal });
        sources.push({
          reference: document.url, title: document.title, retrievedVia: `${this.id} (${document.contentType || "text"})`,
          retrievedAt: document.retrievedAt, bytes: document.bytes, truncated: document.truncated, digest: document.digest,
        });
        // Findings are literal: the passage that mentions the question, quoted and attributed.
        // AION does not summarise here, because a summary with no model behind it would be a
        // paraphrase pretending to be a reading.
        const needle = request.question.toLowerCase().split(/\s+/u).filter((word) => word.length > 3)[0] ?? "";
        const index = needle ? document.text.toLowerCase().indexOf(needle) : -1;
        if (index >= 0) {
          const passage = document.text.slice(Math.max(0, index - 160), index + 400).trim();
          findings.push({
            statement: `${document.title} states: "${passage}"`,
            class: "observation",
            sourceReferences: [document.url],
            confidence: 55,
            caveat: "This is what one page says, quoted directly. It is not a fact and AION has not checked it against anything else.",
          });
        } else {
          unresolved.push(`${document.url} was retrieved but does not appear to address "${request.question}".`);
        }
      } catch (error) {
        unresolved.push(`${seed} could not be read: ${error instanceof Error ? error.message : "the request failed"}`);
      }
    }
    return { sources, findings, unresolved, costCents: 0 };
  }
}

/**
 * A search-provider port with a SearXNG-compatible adapter.
 *
 * Deliberately not tied to any commercial search API. SearXNG is the reference implementation
 * because the owner can run it themselves, which keeps the search tier owner-controlled in the
 * same way the inference tier is. Any provider exposing a compatible JSON endpoint works.
 */
export class SearxngSearchProviderV1 {
  id = "searxng";
  constructor(baseUrl, options = {}) {
    this.baseUrl = assertResearchUrl(baseUrl);
    this.options = options;
  }
  async health() {
    return { available: true, detail: `Search through the SearXNG-compatible instance at ${new URL(this.baseUrl).host}. AION does not require any commercial search API.` };
  }
  async search(question, limit, signal) {
    const url = new URL("/search", this.baseUrl);
    url.searchParams.set("q", question);
    url.searchParams.set("format", "json");
    const document = await fetchPublicDocument(url.toString(), { ...this.options, maxBytes: 1024 * 1024, signal });
    let parsed;
    try { parsed = JSON.parse(document.text); } catch { throw new Error("The search instance did not return JSON."); }
    const results = Array.isArray(parsed?.results) ? parsed.results : [];
    return results
      .map((entry) => ({ url: String(entry?.url ?? ""), title: String(entry?.title ?? "") }))
      .filter((entry) => evaluateResearchUrl(entry.url).allowed)
      .slice(0, Math.max(1, limit));
  }
}
