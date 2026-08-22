import { isPrivateIpv4, isPrivateIpv6 } from "../../packages/local-assistant/dist/index.js";

/** What the pinned transport calls itself. It does not impersonate a browser. */
export const PINNED_USER_AGENT_V1 = "AION/1.3 (owner-run personal assistant; single bounded fetch)";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

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
  /*
   * Search is its own route, not a special case of fetch.
   *
   * The two disclose different things. A fetch says AION looked at a page somebody already pointed
   * it at; a search hands a third party the question AION is asking, which is often the more
   * revealing of the two. Collapsing them would mean authorizing one authorizes the other.
   */
  "research.publicSearch": Object.freeze({
    status: "REQUIRES_INTEGRATION",
    detail: "governed public web search; read-only externally, but the query itself is disclosed to the search provider",
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
 * The same outward call, but connected to an address that was already judged public.
 *
 * `outwardFetch` hands the URL to `globalThis.fetch`, which resolves the name itself. A caller that
 * resolved the name, checked every answer and then called it is checking one lookup and connecting on
 * a second — and between the two, a DNS answer is free to change. That is rebinding, and it is the
 * one SSRF a hostname guard and an address guard both miss.
 *
 * So the addresses the caller validated are the addresses the socket uses. `node:https` is used
 * rather than `fetch` for the single reason that it accepts a `lookup` hook; the authorization check
 * above is identical, so this is not a second door into the network but the same door with the
 * destination nailed down.
 *
 * The returned object carries the small part of the `Response` surface this repository's readers use
 * — `status`, `ok`, `headers.get` and a `body` reader — rather than pretending to be a `Response`.
 */
export async function outwardFetchPinned(routeId, url, addresses, init = undefined) {
  /*
   * The method is not the caller's to choose.
   *
   * An independent review put it plainly: the Director's port exposes two verbs and no method, but
   * this function took `init.method` and `init.headers`, so the door beneath the structurally
   * read-only door was an ordinary one. A caller could POST, and send cookies while doing it.
   * "Read-only" has to be true of the thing that opens the socket, not only of the interface above
   * it, so the method is fixed here and the caller's is refused rather than ignored — silently
   * downgrading a POST to a GET would send a request nobody asked for.
   */
  const requested = String(init?.method ?? "GET").toUpperCase();
  if (requested !== "GET") {
    throw new Error(`outwardFetchPinned is read-only and cannot issue ${requested}`);
  }
  assertOutwardEffectAllowed(routeId, { url: String(url), method: "GET" });
  const pinned = (Array.isArray(addresses) ? addresses : []).filter((entry) => typeof entry === "string" && entry !== "");
  if (pinned.length === 0) throw new Error(`outwardFetchPinned needs the validated addresses for ${String(url)}`);
  /*
   * The addresses are re-checked here, not merely trusted from the caller.
   *
   * Pinning is only as strong as whoever produced the list, and this function is exported: a future
   * caller that forgets to validate would otherwise get a socket pinned straight to a private host.
   * The check is cheap and it makes the guarantee local to the guard rather than to a convention.
   */
  for (const address of pinned) {
    if (isPrivateIpv4(address) || isPrivateIpv6(address)) {
      throw new Error(`outwardFetchPinned refused a private address for ${String(url)}: ${address}`);
    }
  }

  const target = new URL(String(url));
  const transport = target.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const request = transport({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port === "" ? undefined : Number(target.port),
      path: `${target.pathname}${target.search}`,
      method: "GET",
      /*
       * The complete header set, composed here.
       *
       * A caller-supplied map is how a cookie or an authorization header reaches a request that is
       * meant to be anonymous. Only `accept` and `accept-language` are taken from the caller, and
       * only as strings — everything else this transport sends, it decides.
       */
      headers: {
        "user-agent": PINNED_USER_AGENT_V1,
        accept: typeof init?.headers?.accept === "string"
          ? init.headers.accept
          : "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "accept-language": typeof init?.headers?.["accept-language"] === "string"
          ? init.headers["accept-language"]
          : "en-US,en;q=0.9",
      },
      signal: init?.signal,
      /*
       * Only the validated answers, and only those.
       *
       * A name that now resolves somewhere else does not get a second chance: the lookup returns what
       * the guard already approved, so a changed record cannot move the connection.
       */
      lookup: (_hostname, options, callback) => {
        const family = pinned[0].includes(":") ? 6 : 4;
        if (options && options.all === true) {
          callback(null, pinned.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
          return;
        }
        callback(null, pinned[0], family);
      },
    }, (response) => {
      const headers = new Map(Object.entries(response.headers).map(([key, value]) => [
        key.toLowerCase(), Array.isArray(value) ? value[0] : value,
      ]));
      resolve({
        status: response.statusCode ?? 0,
        ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
        headers: { get: (name) => headers.get(String(name).toLowerCase()) ?? null },
        /*
         * Every caller can end the response, and a redirect hop must.
         *
         * A 3xx is read for its `Location` and then abandoned, so without this the socket stays open
         * until the peer or the process gives up — one leaked connection per redirect, on a path
         * built specifically to follow redirects carefully.
         */
        destroy: () => { response.destroy(); },
        body: {
          getReader: () => {
            const iterator = response[Symbol.asyncIterator]();
            return {
              async read() {
                const next = await iterator.next();
                return next.done === true
                  ? { done: true, value: undefined }
                  : { done: false, value: new Uint8Array(next.value) };
              },
              async cancel() { response.destroy(); },
            };
          },
        },
      });
    });
    request.on("error", reject);
    /* No body is ever written: this transport is read-only by construction, not by convention. */
    request.end();
  });
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
