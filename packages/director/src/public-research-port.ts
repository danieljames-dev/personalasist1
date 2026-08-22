/**
 * The only way research reaches the network: through the pre-action effect gate, every time.
 *
 * The transport in `@aion/local-assistant` knows how to fetch a public page safely. It does not know
 * whether it is *allowed to*, and deliberately has no opinion — that question belongs to
 * `authorizeEffect`, and asking it here means the answer is computed immediately before the call
 * rather than remembered from earlier.
 *
 * Two properties this file exists to hold:
 *
 * **Authority never predates execution by more than an instant.** The decision is made per call, not
 * per session, so a revoked envelope stops the next fetch rather than the next run.
 *
 * **An unknown capability fails closed.** Ask for a capability the registry has never heard of and
 * the gate refuses; there is no branch here that falls back to "well, it's only a read".
 */

import {
  authorizeEffect,
  EFFECT_REQUEST_SCHEMA_V1,
  type EffectDecisionV1,
  type EffectGateDepsV1,
  type EffectRequestV1,
} from "./pre-action-effect-contract.js";
import {
  RESEARCH_FETCH_CAPABILITY_V1,
  RESEARCH_ROUTE_FOR_CAPABILITY_V1,
  RESEARCH_SEARCH_CAPABILITY_V1,
} from "./research-capability.js";
import { digestOf } from "./business-evidence.js";



/*
 * The transport contract, restated here rather than imported.
 *
 * `@aion/director` does not depend on `@aion/local-assistant` — it only builds it for tests — and
 * adding a dependency so the Director could name a type would couple the orchestrator to the
 * assistant for no runtime benefit. These are the fields the Director actually consumes; the
 * implementation satisfies them structurally, and a test asserts the two shapes still agree.
 */
export interface SearchHitV1 {
  readonly rank: number;
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

export interface PublicSearchResultV1 {
  readonly query: string;
  readonly provider: string;
  readonly hits: readonly SearchHitV1[];
  readonly retrievedAtUtc: string;
  readonly adsFiltered: number;
}

export interface PublicFetchResultV1 {
  readonly finalUrl: string;
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly digest: string;
  readonly redirectChain: readonly string[];
  /**
   * The publication date the page stated, where the transport could read it.
   *
   * Optional because not every transport can supply it, and empty when the page said nothing. It is
   * separate from `retrievedAtUtc` on purpose: when AION looked is not when the page was written,
   * and conflating them would make every source look current.
   */
  readonly publishedAtUtc?: string;
  readonly retrievedAtUtc: string;
}

/** Two verbs. No method, no headers, no body, no socket target — see the implementation's note. */
export interface PublicResearchTransportV1 {
  readonly search: (query: string, now: string) => Promise<PublicSearchResultV1>;
  readonly fetchPublic: (url: string, now: string) => Promise<PublicFetchResultV1>;
}

export const RESEARCH_GATE_REFUSAL_PREFIX_V1 = "research effect refused";

export function researchGateRefusalV1(detail: string): Error {
  return new Error(`${RESEARCH_GATE_REFUSAL_PREFIX_V1}: ${detail}`);
}

export function isResearchGateRefusalV1(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(RESEARCH_GATE_REFUSAL_PREFIX_V1);
}

/**
 * What the caller must already hold to do research at all.
 *
 * These are the authority coordinates, not parameters — the port cannot invent a milestone or an
 * envelope for itself, which is what "no execution-created authority" means in practice.
 */
export interface ResearchAuthorityV1 {
  readonly actorId: string;
  readonly ownerId: string;
  readonly parentMilestoneId: string;
  readonly authorityEnvelopeId: string;
  readonly ownerAuthorizationId: string;
  /** Recorded for audit, never read by the decision. */
  readonly proposedByProvider: string;
}

export interface GovernedSearchResultV1 {
  readonly search: PublicSearchResultV1;
  readonly decision: EffectDecisionV1;
}

export interface GovernedFetchResultV1 {
  readonly fetched: PublicFetchResultV1;
  readonly decision: EffectDecisionV1;
}

export interface GovernedResearchPortV1 {
  readonly search: (query: string, now: string) => Promise<GovernedSearchResultV1>;
  readonly fetchPublic: (url: string, now: string) => Promise<GovernedFetchResultV1>;
}

/**
 * Build the effect request for one research call.
 *
 * The target id is the query or the URL, so two different questions are two different requests with
 * two different fingerprints. Reusing one request id for "a search" would make the journal say the
 * same thing happened repeatedly when different things did.
 */
function researchRequest(input: {
  capabilityId: string;
  targetType: string;
  targetId: string;
  authority: ResearchAuthorityV1;
  now: string;
}): EffectRequestV1 {
  return {
    schema: EFFECT_REQUEST_SCHEMA_V1,
    requestId: digestOf(`${input.capabilityId}|${input.targetId}|${input.now}`),
    actorId: input.authority.actorId,
    proposedByProvider: input.authority.proposedByProvider,
    ownerId: input.authority.ownerId,
    parentMilestoneId: input.authority.parentMilestoneId,
    authorityEnvelopeId: input.authority.authorityEnvelopeId,
    ownerAuthorizationId: input.authority.ownerAuthorizationId,
    capabilityId: input.capabilityId,
    capabilityVersion: 1,
    targetType: input.targetType,
    targetId: input.targetId,
    args: Object.freeze({ target: input.targetId }),
    declaredSensitivity: "INTERNAL",
    provenance: Object.freeze([]),
    spend: null,
    idempotencyKey: "",
    requestedAtUtc: input.now,
  };
}

/**
 * Wrap a transport in the gate.
 *
 * `assertRouteActivated` is the second boundary — the activation check in
 * `apps/aion/outward-effect-guard.mjs`. It is injected rather than imported because the guard lives
 * in the application and the Director must not depend on the app's build output; the app supplies it
 * when it wires the runtime, and a runtime that supplies nothing gets a port that refuses.
 */
export function createGovernedResearchPortV1(deps: {
  transport: PublicResearchTransportV1;
  gate: EffectGateDepsV1;
  authority: ResearchAuthorityV1;
  /**
   * Throws if the outward route has not been wired to the gate. Defaults to refusing.
   *
   * The target is passed because the activation boundary authorizes *a call*, not *a route*. Handing
   * it only the route id made every search the same unnamed target, so two different questions
   * produced one indistinguishable decision in the journal.
   */
  assertRouteActivated?: (routeId: string, target: string) => void;
}): GovernedResearchPortV1 {
  const assertRoute = deps.assertRouteActivated ?? ((routeId: string) => {
    throw researchGateRefusalV1(
      `outward route "${routeId}" has no activation check wired into this runtime, so nothing was sent`,
    );
  });

  const authorize = (capabilityId: string, targetType: string, targetId: string, now: string): EffectDecisionV1 => {
    const decision = authorizeEffect(
      researchRequest({ capabilityId, targetType, targetId, authority: deps.authority, now }),
      deps.gate,
    );
    if (decision.outcome !== "ALLOW") {
      throw researchGateRefusalV1(
        `${capabilityId} was not allowed: ${decision.reasonCode} — ${decision.detail}`,
      );
    }
    /*
     * Activation is checked *after* authorization and still before execution.
     *
     * Order matters for the audit trail: an unauthorized call should be refused for being
     * unauthorized, not for happening to hit an unwired route, because the two failures need
     * different fixes.
     */
    const routeId = RESEARCH_ROUTE_FOR_CAPABILITY_V1[capabilityId];
    if (routeId === undefined) {
      throw researchGateRefusalV1(`${capabilityId} names no outward route; it cannot reach the network`);
    }
    assertRoute(routeId, targetId);
    return decision;
  };

  return Object.freeze({
    async search(query: string, now: string): Promise<GovernedSearchResultV1> {
      const decision = authorize(RESEARCH_SEARCH_CAPABILITY_V1, "PublicSearchQuery", query, now);
      const search = await deps.transport.search(query, now);
      return { search, decision };
    },
    async fetchPublic(url: string, now: string): Promise<GovernedFetchResultV1> {
      const decision = authorize(RESEARCH_FETCH_CAPABILITY_V1, "PublicUrl", url, now);
      const fetched = await deps.transport.fetchPublic(url, now);
      return { fetched, decision };
    },
  });
}
