/**
 * Where the research routes stop being declarations and become things that can actually run.
 *
 * `outward-effect-guard.mjs` has carried `research.fetch` as `REQUIRES_INTEGRATION` since Findings 2
 * and 3 closed the boundary — declared, understood, and refused in code because nothing had wired it
 * to an authorizer. `research-fetch.mjs` has carried a careful, complete implementation of the fetch
 * itself for just as long, and never ran. This file is the missing join, and it is deliberately the
 * *only* thing that can make either route live.
 *
 * The shape of the join matters:
 *
 *     registerOutwardRoute(routeId, authorize)
 *
 * `authorize` is a **function consulted per call**, not a flag. It runs `authorizeEffect` against the
 * capability registry and the Owner's current envelope, so a revoked envelope stops the next fetch
 * rather than the next restart, and nothing here can decide it is fine on its own behalf.
 *
 * Nothing calls this at import time. A runtime that never calls `activateResearchRoutes` has research
 * routes that refuse, which is the state the repository has been in and the state it returns to if
 * this call is removed.
 */

import { authorizeEffect, RESEARCH_CAPABILITY_REGISTRY_V1 } from "@aion/director";
import { registerOutwardRoute } from "./outward-effect-guard.mjs";

export const RESEARCH_ROUTE_CAPABILITIES_V1 = Object.freeze({
  "research.fetch": "Research.PublicFetch",
  "research.publicSearch": "Research.PublicSearch",
});

/**
 * Wire both research routes to the pre-action effect gate.
 *
 * `envelopeFor` and `authority` are supplied by the caller because they are Owner authority, not
 * configuration — the application cannot mint them, and a caller that has neither gets routes that
 * keep refusing. That is why this returns nothing useful on the unauthorized path rather than
 * throwing: "not authorized to research" is an ordinary state, not a fault.
 */
export function activateResearchRoutes(options = {}) {
  const { authority, envelopeFor, now } = options;
  if (authority == null || typeof envelopeFor !== "function" || typeof now !== "function") {
    return { activated: [], reason: "no Owner authority was supplied, so the research routes stay refused" };
  }

  const activated = [];
  for (const [routeId, capabilityId] of Object.entries(RESEARCH_ROUTE_CAPABILITIES_V1)) {
    registerOutwardRoute(routeId, (request) => {
      /*
       * The decision is made here, per call, against authority read at this moment.
       *
       * `request.url` is whatever the call site named. It becomes the effect's target, so two
       * different pages are two different decisions with two different fingerprints in the journal —
       * and a target the envelope does not cover is refused for that reason specifically.
       */
      /*
       * An empty string is not "absent", which `??` treats it as.
       *
       * The fetch call site sends `{ url, query: "" }` and the search call site sends `{ url: "", query }`,
       * so `request?.url ?? request?.query` read the empty url and never looked at the query — every
       * search authorized the same unnamed target. Emptiness has to be tested, not nullishness.
       */
      const named = [request?.url, request?.query]
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .find((value) => value !== "");
      const target = named ?? "";
      const decision = authorizeEffect(
        {
          schema: "aion.director.effectRequest.v1",
          requestId: `${capabilityId}:${target}:${now()}`,
          actorId: authority.actorId,
          proposedByProvider: authority.proposedByProvider ?? "local",
          ownerId: authority.ownerId,
          parentMilestoneId: authority.parentMilestoneId,
          authorityEnvelopeId: authority.authorityEnvelopeId,
          ownerAuthorizationId: authority.ownerAuthorizationId,
          capabilityId,
          capabilityVersion: 1,
          targetType: routeId === "research.publicSearch" ? "PublicSearchQuery" : "PublicUrl",
          targetId: target === "" ? "(unnamed)" : target,
          args: { target },
          declaredSensitivity: "INTERNAL",
          provenance: [],
          spend: null,
          idempotencyKey: "",
          requestedAtUtc: now(),
        },
        {
          registry: RESEARCH_CAPABILITY_REGISTRY_V1,
          resolveTarget: (targetType, targetId) => ({
            targetType,
            targetId,
            sensitivity: "INTERNAL",
            writeDomain: "packages/director",
          }),
          envelopeFor,
          ownerId: authority.ownerId,
          now: now(),
        },
      );
      /*
       * The target is named in the reason, so the decision is auditable and testable.
       *
       * Without it there was no way to observe what had been authorized — which is how "every search
       * authorizes the same unnamed target" survived a fix and a test that both claimed to close it.
       */
      return {
        allowed: decision.outcome === "ALLOW",
        reason: `${decision.reasonCode} for ${decision.capabilityId} on "${target === "" ? "(unnamed)" : target}": ${decision.detail}`,
      };
    });
    activated.push(routeId);
  }
  return { activated, reason: `${activated.length} research route(s) wired to the pre-action effect gate` };
}
