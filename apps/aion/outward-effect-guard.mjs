/**
 * The activation boundary for effects that leave this machine.
 *
 * An independent review found the previous boundary was a label. `apps/` carried an inventory marking
 * Gmail sync and the research fetch `NOT_ACTIVATED_FOR_REAL_EFFECTS`, and the routes ran anyway the
 * moment credentials were READY — because a declaration in a test file is not a condition in the code
 * path. Credential readiness is not authority; having a token says nothing about being permitted to
 * use it.
 *
 *     NO REACHABLE OUTWARD EFFECT MAY RUN OUTSIDE A REGISTERED SEMANTIC CAPABILITY
 *     AND PRE-ACTION AUTHORIZATION.
 *
 * So this is the condition, not the label. Every route that reaches the network names itself here
 * before acting. A route that has not been wired to a registered capability and the pre-action effect
 * gate is refused *in code*, whatever else is configured, and no comment or inventory entry can
 * change that. Flipping one to `GATED` requires supplying an authorizer — there is deliberately no
 * way to mark a route active without one.
 *
 * This is an activation boundary, not an authorization system. Authorization is the effect gate in
 * `packages/director/src/pre-action-effect-contract.ts`; this is what stops a route running before it
 * has been connected to that gate at all.
 */

/** Routes that leave this machine. Every outbound call site must appear here. */
export const OUTWARD_ROUTES_V1 = Object.freeze({
  "gmail.sync": Object.freeze({
    status: "REQUIRES_INTEGRATION",
    detail: "live Gmail OAuth token refresh and message reads; needs a registered semantic capability and Owner authority for account access before it may run",
  }),
  "gmail.oauthExchange": Object.freeze({
    status: "REQUIRES_INTEGRATION",
    detail: "exchanges an OAuth code or refresh token with Google; contacts a third party and obtains credentials, so it needs a registered capability and Owner authority before it may run",
  }),
  "research.fetch": Object.freeze({
    status: "REQUIRES_INTEGRATION",
    detail: "governed public-web fetch; read-only externally but still leaves the machine",
  }),
  "brain.remoteInference": Object.freeze({
    status: "REQUIRES_INTEGRATION",
    detail: "inference against a non-loopback brain endpoint; a loopback runtime stays on this machine and is not an outward effect, a third-party endpoint sends context off it",
  }),
  "vast.api": Object.freeze({
    status: "REQUIRES_INTEGRATION",
    detail: "paid GPU provider API; spend-capable, must carry spend authority before it may run",
  }),
  /*
   * The four routes Discovery Campaign 02 found already reaching the internet without declaring
   * themselves. They were not new capabilities; they were undeclared ones, and declaring them is
   * what makes their current unavailability a fact about the code rather than about the data.
   */
  "vehicle.vinDecode": Object.freeze({
    status: "REQUIRES_INTEGRATION",
    detail: "VIN decode against the public NHTSA vPIC service; read-only externally, but a VIN the Owner typed leaves the machine",
  }),
  "vehicle.recalls": Object.freeze({
    status: "REQUIRES_INTEGRATION",
    detail: "safety recall lookup against the public NHTSA recall API; read-only externally, and it discloses which vehicles AION is asked about",
  }),
  "dealership.inventoryCrawl": Object.freeze({
    status: "REQUIRES_INTEGRATION",
    detail: "paginated crawl of a dealer's public website; sustained outbound load on someone else's server, so it needs authority even though every page is public",
  }),
  "vision.remoteInference": Object.freeze({
    status: "REQUIRES_INTEGRATION",
    detail: "image description against a non-loopback vision endpoint; the submitted photo itself is the payload, so this is the most disclosing route declared here",
  }),
});

/**
 * The authorizers a route has been wired to.
 *
 * Empty, and it stays empty until a route is genuinely wired: registering one is how a route becomes
 * `GATED`, and the only way. A future `Gmail.ReadMessages` capability registers its authorizer here,
 * and until then the route below refuses rather than running unauthorised.
 */
const AUTHORIZERS = new Map();

/**
 * Wire a route to the pre-action effect gate.
 *
 * `authorize` must return `{ allowed: boolean, reason: string }` after consulting the real gate. It is
 * not a flag: a route cannot be activated by asserting that it is fine, only by supplying something
 * that decides per call against current authority.
 */
export function registerOutwardRoute(routeId, authorize) {
  if (!Object.prototype.hasOwnProperty.call(OUTWARD_ROUTES_V1, routeId)) {
    throw new Error(`unknown outward route: ${routeId}`);
  }
  if (typeof authorize !== "function") {
    throw new Error(`outward route ${routeId} needs an authorizer, not a flag`);
  }
  AUTHORIZERS.set(routeId, authorize);
}

/** Test seam: forget a wiring. Never called by the app. */
export function clearOutwardRoute(routeId) {
  AUTHORIZERS.delete(routeId);
}

/**
 * May this outward route act right now?
 *
 * Returns a refusal rather than throwing, so callers that already speak in result objects can report
 * it the way they report any other unmet precondition. `assertOutwardEffectAllowed` is the throwing
 * form for call sites with nowhere to put a result.
 */
export function outwardEffectDecision(routeId, request = {}) {
  const route = Object.prototype.hasOwnProperty.call(OUTWARD_ROUTES_V1, routeId)
    ? OUTWARD_ROUTES_V1[routeId]
    : null;
  if (route === null) {
    return { allowed: false, reason: `outward route "${routeId}" is not declared; declare and gate it before it can run` };
  }
  const authorize = AUTHORIZERS.get(routeId);
  if (authorize === undefined) {
    return { allowed: false, reason: `outward route "${routeId}" is not wired to the pre-action effect gate: ${route.detail}` };
  }
  const decision = authorize(request);
  if (decision === null || typeof decision !== "object" || decision.allowed !== true) {
    return { allowed: false, reason: typeof decision?.reason === "string" ? decision.reason : "the effect gate refused" };
  }
  return { allowed: true, reason: typeof decision.reason === "string" ? decision.reason : "authorized" };
}

export function assertOutwardEffectAllowed(routeId, request = {}) {
  const decision = outwardEffectDecision(routeId, request);
  if (!decision.allowed) {
    throw new Error(`outward effect refused: ${decision.reason}`);
  }
  return decision;
}

/** What each route's status is right now, for the inventory test and for an Owner-facing report. */
export function outwardRouteStatus(routeId) {
  if (!Object.prototype.hasOwnProperty.call(OUTWARD_ROUTES_V1, routeId)) return "UNDECLARED";
  return AUTHORIZERS.has(routeId) ? "GATED" : "TECHNICALLY_DISABLED";
}

export function outwardRouteReport() {
  return Object.keys(OUTWARD_ROUTES_V1).map((routeId) => ({
    routeId,
    status: outwardRouteStatus(routeId),
    detail: OUTWARD_ROUTES_V1[routeId].detail,
  }));
}

/* -------------------------------------------------------------------------- */
/* Trusted transports                                                          */
/* -------------------------------------------------------------------------- */

/*
 * Why wrappers rather than a rule about imports.
 *
 * The first version of this boundary asserted that a runtime file *imports* the guard. `server.mjs`
 * did — for `gmail.sync` — and carried four other `fetch` calls that never consulted anything,
 * including a second OAuth token exchange. A file-level fact cannot prove a call-site property, and a
 * verification pass found exactly that gap.
 *
 * So the network is reached through one of two named transports and repository validation forbids a
 * bare `fetch` in runtime code. Adding an outward call now means choosing a declared route, which is
 * the decision the boundary exists to force.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** True when a URL stays on this machine. */
export function isLoopbackUrl(candidate) {
  try {
    return LOOPBACK_HOSTS.has(new URL(String(candidate)).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * The only way runtime code may leave this machine.
 *
 * Refuses unless the named route is wired to the pre-action effect gate and its authorizer allows
 * this call. Nothing is sent, and no name is resolved, when it refuses.
 */
export async function outwardFetch(routeId, input, init = undefined) {
  assertOutwardEffectAllowed(routeId, { url: String(input), method: init?.method ?? "GET" });
  return globalThis.fetch(input, init);
}

/**
 * A request that provably stays on this machine.
 *
 * Local model runtimes and local servers are not outward effects, and requiring Owner authority for
 * them would make the private-by-default path ask permission to talk to itself. The loopback claim is
 * checked rather than trusted: a non-loopback URL here is a mistake, and it is refused rather than
 * quietly sent.
 */
export async function loopbackFetch(input, init = undefined) {
  if (!isLoopbackUrl(input)) {
    throw new Error(`loopbackFetch refused a non-loopback address: ${String(input)}. Declare an outward route and use outwardFetch.`);
  }
  return globalThis.fetch(input, init);
}
