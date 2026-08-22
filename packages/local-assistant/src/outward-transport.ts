/**
 * The one seam through which this package may reach the network.
 *
 * Discovery Campaign 02 measured four live HTTP actions on the Command Center reaching the public
 * internet — NHTSA vPIC, the NHTSA recall API, a paginated dealer-site crawl, and a vision endpoint
 * named by an environment variable that carried the submitted photo. None of them consulted any
 * boundary. They were not evading one: each held an injectable `fetchImpl` parameter that defaulted
 * to the global `fetch`, written for testability, and a default that reaches the network is
 * indistinguishable from no boundary at all.
 *
 *     AN ABSENT TRANSPORT IS A REFUSAL, NEVER A FALLBACK.
 *
 * So the default is this module's refusing port. A connector that wants the network must be handed
 * something that decides per call, and the only thing the application hands it is backed by
 * apps/aion/outward-effect-guard.mjs — a declared route, checked against the pre-action effect
 * gate. While a route is unwired the call refuses here, in code, with the route named.
 *
 * This module holds no transport of its own, not even a loopback one. The assistant package carries
 * an older invariant that its source contains no network implementation, and that invariant is
 * right: every socket in this repository belongs to the application boundary. The loopback port
 * below is a contract the application fills, exactly like the outward one.
 *
 * This is an activation boundary, not an authorization system: it is what stops a call running
 * before it has been connected to the gate at all.
 */

/**
 * Routes this package can ask for. Each one must also be declared in `OUTWARD_ROUTES_V1` in
 * `apps/aion/outward-effect-guard.mjs`, and a test asserts the two lists agree — a route this
 * package can name but the boundary has never heard of would refuse for the wrong reason.
 */
export const OUTWARD_ROUTE_IDS_V1 = [
  "vehicle.vinDecode",
  "vehicle.recalls",
  "dealership.inventoryCrawl",
  "vision.remoteInference",
  "research.fetch",
  "research.publicSearch",
] as const;

export type OutwardRouteIdV1 = (typeof OUTWARD_ROUTE_IDS_V1)[number];

/**
 * A transport that decides per call.
 *
 * Deliberately not `typeof fetch`. A bare fetch function carries no route, so a caller could hand
 * one connector's transport to another and reach a destination nobody authorised; requiring the
 * route id at the call site means the thing being permitted is named where it happens.
 */
export interface OutwardTransportPortV1 {
  /**
   * Deliberately not named after the global. Repository validation rejects a direct call to it in
   * runtime code, and a port method sharing its name would both trip that rule and blur the
   * distinction between the boundary and the thing it replaces.
   */
  request(routeId: OutwardRouteIdV1, url: string, init?: RequestInit): Promise<Response>;
}

/** The prefix every refusal shares, so callers and tests can recognise one without string surgery. */
export const OUTWARD_REFUSAL_PREFIX_V1 = "outward effect refused";

export function outwardRefusalV1(routeId: string, detail: string): Error {
  return new Error(`${OUTWARD_REFUSAL_PREFIX_V1}: ${routeId} — ${detail}`);
}

/** True when the message came from this boundary rather than from a real transport failure. */
export function isOutwardRefusalV1(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(OUTWARD_REFUSAL_PREFIX_V1);
}

/**
 * The default port everywhere in this package.
 *
 * It never resolves a name, opens a socket, or reads a credential. A runtime that has wired no
 * outward transport cannot make an outward call, and that is the current state of this repository.
 */
export const REFUSING_OUTWARD_TRANSPORT_V1: OutwardTransportPortV1 = {
  request(routeId: OutwardRouteIdV1): Promise<Response> {
    return Promise.reject(outwardRefusalV1(
      routeId,
      "no approved outward transport is wired into this runtime, so nothing was sent",
    ));
  },
};

/*
 * Loopback classification.
 *
 * `apps/aion/outward-effect-guard.mjs` carries the same four hosts and the same logic. That is a
 * deliberate duplicate rather than an import: the guard is the application's security boundary and
 * making it depend on this package's build output would mean a stale `dist/` could change how the
 * boundary behaves. The risk a duplicate carries is drift, so
 * `test/aion/outward-runtime-routes.test.mjs` runs both implementations over a shared table and
 * fails if they ever disagree.
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** True when a URL provably stays on this machine. Same rule as the application boundary's. */
export function isLoopbackUrlV1(candidate: unknown): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(String(candidate)).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export type EndpointClassV1 = "LOOPBACK" | "REMOTE" | "UNUSABLE";

/**
 * What an endpoint the Owner configured actually is.
 *
 * `UNUSABLE` covers absent, unparseable, and non-HTTP schemes. It is separate from `REMOTE` because
 * "you configured nothing" and "you configured a third party" need different answers: the first is a
 * setup step, the second is an authority question.
 */
export function classifyEndpointV1(candidate: string | null | undefined): EndpointClassV1 {
  if (candidate === null || candidate === undefined || String(candidate).trim() === "") return "UNUSABLE";
  let url: URL;
  try {
    url = new URL(String(candidate));
  } catch {
    return "UNUSABLE";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "UNUSABLE";
  return isLoopbackUrlV1(url.toString()) ? "LOOPBACK" : "REMOTE";
}

/**
 * A transport for calls that stay on this machine.
 *
 * Local model runtimes are not outward effects, and requiring Owner authority to talk to ourselves
 * would make the private-by-default path ask permission for the one thing it is meant to do. It is
 * still a port rather than a bare call: the socket belongs to the application, which checks the
 * loopback claim before honouring it.
 */
export interface LoopbackTransportPortV1 {
  request(url: string, init?: RequestInit): Promise<Response>;
}

/** The default. A runtime that wired no local transport makes no local call either. */
export const REFUSING_LOOPBACK_TRANSPORT_V1: LoopbackTransportPortV1 = {
  request(url: string): Promise<Response> {
    return Promise.reject(outwardRefusalV1("loopback", `no local transport is wired into this runtime, so ${url} was not called`));
  },
};
