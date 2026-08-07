import type { IsoTimestamp, OpaqueId, ProvenanceV1 } from "./contracts.js";
import type { ClaimClassV1 } from "./knowledge.js";

/**
 * Governed research.
 *
 * A research agent is the part of a system like this most likely to quietly become something
 * nobody agreed to: one fetch becomes a crawl, a crawl becomes a scraper, and a scraper with the
 * owner's cookies becomes a liability. So research here is a *job* — a written question, a
 * declared scope, hard limits, an approval, and a record of exactly what was consulted — rather
 * than a capability that runs in the background.
 *
 * The rules that keep it honest:
 *
 *   - Every finding cites a source, and a finding with no source is not stored.
 *   - AION never claims a finding is a fact. Findings arrive as observations or inferences and
 *     only the owner promotes them (see `knowledge.ts`).
 *   - Reachability is decided before a request is made, not after: the URL guard below refuses
 *     anything that is not a public HTTP endpoint, and refuses it by name so the reason is legible.
 *   - Nothing here logs in, carries a session, follows a login wall, or bypasses access control.
 */

export type ResearchScopeV1 = "local-only" | "owner-supplied-sources" | "public-web";
export const RESEARCH_SCOPES: readonly ResearchScopeV1[] = ["local-only", "owner-supplied-sources", "public-web"];

export type ResearchJobStateV1 = "proposed" | "approved" | "running" | "complete" | "failed" | "cancelled";

export interface ResearchLimitsV1 {
  /** How many sources the job may consult in total. There is no unbounded crawl. */
  maxSources: number;
  /** Bytes per source. A response larger than this is truncated and marked truncated. */
  maxBytesPerSource: number;
  maxDurationMs: number;
  /** What the owner is willing to spend, in whole cents. Zero means nothing paid may be used. */
  maxCostCents: number;
}

export const DEFAULT_RESEARCH_LIMITS: ResearchLimitsV1 = {
  maxSources: 8,
  maxBytesPerSource: 512 * 1024,
  maxDurationMs: 120_000,
  maxCostCents: 0,
};

export interface ResearchSourceV1 {
  id: OpaqueId;
  /** The exact URL or local reference consulted. Stored so a finding can always be re-checked. */
  reference: string;
  title: string;
  /** Where it came from: which provider, or the owner. */
  retrievedVia: string;
  retrievedAt: IsoTimestamp;
  bytes: number;
  truncated: boolean;
  /** SHA-256 of the retrieved bytes, so a source that changes later is detectable. */
  digest: string;
}

export interface ResearchFindingV1 {
  id: OpaqueId;
  statement: string;
  /** Which classes a finding may take. Never `fact`: a provider does not get to settle anything. */
  class: Extract<ClaimClassV1, "observation" | "inference" | "hypothesis">;
  /** Source ids this finding rests on. A finding with none of these is refused. */
  sourceIds: OpaqueId[];
  confidence: number;
  /** Stated by the job rather than left implicit, so a thin answer looks thin. */
  caveat: string;
}

export interface ResearchJobV1 {
  id: OpaqueId;
  workspace: string;
  question: string;
  scope: ResearchScopeV1;
  limits: ResearchLimitsV1;
  state: ResearchJobStateV1;
  /** Sources the owner supplied up front. In `owner-supplied-sources` scope these are the only ones. */
  seedReferences: string[];
  sources: ResearchSourceV1[];
  findings: ResearchFindingV1[];
  unresolved: string[];
  /** Whole cents actually spent. Zero unless a paid provider was explicitly configured and used. */
  costCents: number;
  /** SHA-256 over the question, scope, limits, sources and findings. Identifies this exact result. */
  outputDigest: string;
  failureReason: string | null;
  provenance: ProvenanceV1;
  createdAt: IsoTimestamp;
  completedAt: IsoTimestamp | null;
}

/**
 * What a research provider must offer. Implementations are adapters: a deterministic synthetic one
 * for tests and demos, an owner-controlled search endpoint, or a governed single-URL fetch.
 * AION never requires any particular one, and the default configuration has none at all.
 */
export interface ResearchProviderV1 {
  readonly id: string;
  /** Whether this provider leaves the machine. Displayed before a job runs, every time. */
  readonly reachesNetwork: boolean;
  health(): Promise<{ available: boolean; detail: string }>;
  run(request: {
    question: string;
    scope: ResearchScopeV1;
    limits: ResearchLimitsV1;
    seedReferences: readonly string[];
    signal: AbortSignal;
  }): Promise<{ sources: Array<Omit<ResearchSourceV1, "id">>; findings: Array<Omit<ResearchFindingV1, "id" | "sourceIds"> & { sourceReferences: string[] }>; unresolved: string[]; costCents: number }>;
}

function fail(message: string): never { throw new Error(message); }

/**
 * Hosts that are never a legitimate research target.
 *
 * This is an SSRF guard, so it is a denylist of *address shapes* rather than of names: the danger
 * is not a rude website, it is AION being talked into fetching something on the owner's own
 * network — a router admin page, a metadata endpoint, another service on localhost — and putting
 * the result somewhere a model can read it.
 */
const DENIED_HOST_SUFFIXES = [".local", ".internal", ".localhost", ".home.arpa", ".onion", ".i2p"];
const DENIED_HOST_NAMES = ["localhost", "ip6-localhost", "ip6-loopback", "metadata", "metadata.google.internal"];

function ipv4Octets(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/u.test(part) ? Number(part) : Number.NaN));
  return octets.every((value) => Number.isInteger(value) && value >= 0 && value <= 255) ? octets : null;
}

/** True for any IPv4 address that is not routable on the public internet. */
export function isPrivateIpv4(host: string): boolean {
  const octets = ipv4Octets(host);
  if (!octets) return false;
  const [a, b] = octets as [number, number, number, number];
  return a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

/**
 * True for any IPv6 address that is not globally routable.
 *
 * Stated as an allowlist rather than a list of bad prefixes, because the bad prefixes are the part
 * that gets out of date. Global unicast is 2000::/3; loopback, link-local, unique-local,
 * multicast, IPv4-mapped and every reserved block fall outside it and are refused. The mapped form
 * matters in particular: `http://[::ffff:10.0.0.5]/` is normalised by the URL parser to
 * `::ffff:a00:5`, so a rule that only recognised the dotted spelling would let it through.
 */
export function isPrivateIpv6(host: string): boolean {
  const address = host.replace(/^\[|\]$/gu, "").toLowerCase();
  if (!address.includes(":")) return false;
  const first = address.split(":")[0] ?? "";
  if (first === "") return true;
  if (!/^[0-9a-f]{1,4}$/u.test(first)) return true;
  const leading = Number.parseInt(first, 16);
  return !(leading >= 0x2000 && leading <= 0x3fff);
}

export interface UrlVerdictV1 { allowed: boolean; url: string; reason: string; }

/**
 * Decides whether AION may fetch a URL, before any request is made.
 *
 * Refusals name what was wrong so the owner can tell a typo from a boundary. Note what is *not*
 * checked here: whether the content is useful, whether the site wants to be read, or whether the
 * owner would like it. Those are the owner's calls. This function answers only "could fetching
 * this reach something that is not the public internet, or carry credentials somewhere".
 */
export function evaluateResearchUrl(candidate: string): UrlVerdictV1 {
  const raw = String(candidate ?? "").trim();
  const refuse = (reason: string): UrlVerdictV1 => ({ allowed: false, url: raw, reason });
  if (!raw) return refuse("A research URL is required.");
  if (raw.length > 2048) return refuse("That URL is longer than 2048 characters.");
  let url: URL;
  try { url = new URL(raw); } catch { return refuse("That is not a valid absolute URL."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return refuse(`AION fetches only http and https. "${url.protocol.replace(":", "")}" could reach a file, a device, or another program on this computer.`);
  }
  if (url.username || url.password) {
    return refuse("A URL carrying a username or password is refused. AION never sends credentials to a research target.");
  }
  const host = url.hostname.toLowerCase();
  if (!host) return refuse("That URL has no host.");
  if (DENIED_HOST_NAMES.includes(host)) return refuse(`"${host}" is this computer or its metadata service, not a public source.`);
  if (DENIED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return refuse(`"${host}" is a private-network or anonymity-network name. AION researches the public web only.`);
  }
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    return refuse(`${host} is a private, loopback, or link-local address. AION does not fetch from your own network — that is how a research request turns into a request to your router.`);
  }
  // A bare hostname with no dot is almost always an internal name resolved by a search domain.
  if (!host.includes(".") && !host.includes(":")) return refuse(`"${host}" is not a public hostname.`);
  return { allowed: true, url: url.toString(), reason: `${url.protocol}//${host} is a public HTTP endpoint. AION will send no credentials, follow no login, and read at most the configured byte limit.` };
}

export function assertResearchUrl(candidate: string): string {
  const verdict = evaluateResearchUrl(candidate);
  if (!verdict.allowed) fail(verdict.reason);
  return verdict.url;
}

function text(value: unknown, label: string, max: number, required = true): string {
  if (value === undefined || value === null || value === "") { if (required) fail(`${label} is required.`); return ""; }
  if (typeof value !== "string" || value.length > max) fail(`${label} is invalid.`);
  const trimmed = value.trim();
  if (required && !trimmed) fail(`${label} is required.`);
  return trimmed;
}

export function buildResearchLimits(input: Record<string, unknown> = {}): ResearchLimitsV1 {
  const bounded = (value: unknown, fallback: number, max: number, label: string): number => {
    if (value === undefined || value === null) return fallback;
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) fail(`${label} must be a whole number between 0 and ${max}.`);
    return value as number;
  };
  return {
    maxSources: bounded(input.maxSources, DEFAULT_RESEARCH_LIMITS.maxSources, 50, "Maximum sources"),
    maxBytesPerSource: bounded(input.maxBytesPerSource, DEFAULT_RESEARCH_LIMITS.maxBytesPerSource, 8 * 1024 * 1024, "Maximum bytes per source"),
    maxDurationMs: bounded(input.maxDurationMs, DEFAULT_RESEARCH_LIMITS.maxDurationMs, 600_000, "Maximum duration"),
    maxCostCents: bounded(input.maxCostCents, DEFAULT_RESEARCH_LIMITS.maxCostCents, 10_000, "Maximum cost"),
  };
}

export function buildResearchJob(input: Record<string, unknown>, context: { id: OpaqueId; workspace: string; now: IsoTimestamp }): ResearchJobV1 {
  const scope = RESEARCH_SCOPES.includes(input.scope as ResearchScopeV1) ? input.scope as ResearchScopeV1 : "local-only";
  const seeds = Array.isArray(input.seedReferences) ? input.seedReferences.map((entry) => text(entry, "Seed source", 2048)) : [];
  if (seeds.length > 50) fail("A research job may start from at most 50 owner-supplied sources.");
  // In owner-supplied scope the seeds *are* the research, so an empty list is a mistake, not an
  // invitation to go looking. In public-web scope every seed still passes the same URL guard.
  if (scope === "owner-supplied-sources" && !seeds.length) fail("This scope researches only the sources you supply, so at least one is required.");
  if (scope !== "local-only") for (const seed of seeds) assertResearchUrl(seed);
  return {
    id: context.id,
    workspace: context.workspace,
    question: text(input.question, "Research question", 2000),
    scope,
    limits: buildResearchLimits((input.limits ?? {}) as Record<string, unknown>),
    state: "proposed",
    seedReferences: seeds,
    sources: [], findings: [], unresolved: [],
    costCents: 0,
    outputDigest: "",
    failureReason: null,
    provenance: { sourceType: "owner", sourceRef: "owner-entry", recordedAt: context.now },
    createdAt: context.now,
    completedAt: null,
  };
}

/**
 * Turns a provider's raw result into a stored job result, refusing anything unsupported.
 *
 * Every finding must name at least one source the provider actually returned. A finding citing a
 * source that is not in the list is dropped rather than stored with a dangling reference, because
 * a citation nobody can follow is worse than no citation.
 */
export function applyResearchResult(
  job: ResearchJobV1,
  raw: Awaited<ReturnType<ResearchProviderV1["run"]>>,
  context: { now: IsoTimestamp; nextId: (kind: string) => string; digest: (value: unknown) => string },
): { job: ResearchJobV1; dropped: number } {
  const next = structuredClone(job);
  const capped = raw.sources.slice(0, job.limits.maxSources);
  next.sources = capped.map((source) => ({ ...source, id: context.nextId("research-source") }));
  const byReference = new Map(next.sources.map((source) => [source.reference, source.id]));

  let dropped = 0;
  next.findings = [];
  for (const finding of raw.findings) {
    const sourceIds = finding.sourceReferences.map((reference) => byReference.get(reference)).filter((value): value is string => Boolean(value));
    if (!sourceIds.length) { dropped += 1; continue; }
    if (!["observation", "inference", "hypothesis"].includes(finding.class)) { dropped += 1; continue; }
    next.findings.push({
      id: context.nextId("research-finding"),
      statement: text(finding.statement, "Finding", 4000),
      class: finding.class,
      sourceIds,
      confidence: Number.isSafeInteger(finding.confidence) && finding.confidence >= 0 && finding.confidence <= 100 ? finding.confidence : 50,
      caveat: text(finding.caveat, "Finding caveat", 1000, false),
    });
  }
  next.unresolved = raw.unresolved.slice(0, 50).map((entry) => text(entry, "Unresolved question", 1000));
  if (dropped) next.unresolved.push(`${dropped} finding(s) were discarded because they cited no source AION actually retrieved.`);
  if (raw.costCents > job.limits.maxCostCents) fail(`This job cost ${raw.costCents} cents but was limited to ${job.limits.maxCostCents}. The result is refused rather than recorded.`);
  next.costCents = raw.costCents;
  next.state = "complete";
  next.completedAt = context.now;
  next.outputDigest = context.digest({
    question: next.question, scope: next.scope, limits: next.limits,
    sources: next.sources.map(({ reference, digest }) => ({ reference, digest })),
    findings: next.findings.map(({ statement, class: claimClass, sourceIds }) => ({ statement, class: claimClass, sourceIds })),
  });
  return { job: next, dropped };
}

/** An honest one-line account of what a completed job actually established. */
export function researchSummary(job: ResearchJobV1): string {
  if (job.state !== "complete") return `This research job is ${job.state}. Nothing has been established.`;
  if (!job.findings.length) return `Nothing was found for "${job.question}" from ${job.sources.length} source(s). That is a result, not a failure — treat the question as open.`;
  const observations = job.findings.filter((finding) => finding.class === "observation").length;
  const rest = job.findings.length - observations;
  return `${job.findings.length} finding(s) from ${job.sources.length} source(s): ${observations} observation(s) and ${rest} inference(s) or hypotheses. None of them is a fact yet — promote the ones you have checked.`;
}
