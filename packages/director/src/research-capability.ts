/**
 * Public research as two registered semantic capabilities, and the gate they must pass.
 *
 * The rule this milestone inherits is the one Findings 2 and 3 closed: no reachable outward effect
 * may run outside a registered semantic capability and pre-action authorization. So the transport in
 * `@aion/local-assistant` is not wired to the Director directly. It is wired through here, where each
 * call becomes an effect request, is judged by `authorizeEffect`, and only then executes.
 *
 * Two capabilities rather than one, because search and fetch disclose different things. A fetch says
 * AION read a page. A search hands the *question* to a third party, and the question is often more
 * revealing than the answer — "what do companion agencies charge in Polk County" says a great deal
 * about what this business is about to do. Authorizing one should not silently authorize the other.
 *
 * Both are `EXTERNAL_SEND` and both are irreversible in the only sense that matters: you cannot
 * un-disclose a query. Neither carries any permission that would let it change anything on the far
 * side, and there is no capability here for one that could.
 */

import {
  DIRECTOR_CAPABILITY_REGISTRY_V1,
  EFFECT_POLICY_VERSION_V1,
  type CapabilityPolicyV1,
  type CapabilityRegistryV1,
} from "./pre-action-effect-contract.js";

export const RESEARCH_SEARCH_CAPABILITY_V1 = "Research.PublicSearch" as const;
export const RESEARCH_FETCH_CAPABILITY_V1 = "Research.PublicFetch" as const;

/** The outward routes these capabilities are allowed to use, and the only ones. */
export const RESEARCH_ROUTE_FOR_CAPABILITY_V1: Readonly<Record<string, string>> = Object.freeze({
  [RESEARCH_SEARCH_CAPABILITY_V1]: "research.publicSearch",
  [RESEARCH_FETCH_CAPABILITY_V1]: "research.fetch",
});

const SEARCH_POLICY_V1: CapabilityPolicyV1 = Object.freeze({
  capabilityId: RESEARCH_SEARCH_CAPABILITY_V1,
  version: 1,
  kind: "SEMANTIC",
  /*
   * `EXTERNAL_SEND`, not `READ`.
   *
   * Calling a search "read-only" and classifying it as a READ would be the label-instead-of-condition
   * mistake the outward boundary exists to prevent. Nothing is written on the far side, but the query
   * leaves this machine and cannot be recalled, and the effect kind should say which of those is true
   * rather than which sounds safer.
   */
  effects: Object.freeze(["EXTERNAL_SEND"] as const),
  externalEffectClass: "IRREVERSIBLE_EXTERNAL",
  reversible: false,
  allowedTargetTypes: Object.freeze(["PublicSearchQuery"] as const),
  sensitivityCeiling: "INTERNAL",
  spend: "NONE",
  requiredPermissions: Object.freeze([]),
  requiresIdempotencyKey: false,
  ownerGateType: null,
});

const FETCH_POLICY_V1: CapabilityPolicyV1 = Object.freeze({
  capabilityId: RESEARCH_FETCH_CAPABILITY_V1,
  version: 1,
  kind: "SEMANTIC",
  effects: Object.freeze(["EXTERNAL_SEND"] as const),
  externalEffectClass: "IRREVERSIBLE_EXTERNAL",
  reversible: false,
  allowedTargetTypes: Object.freeze(["PublicUrl"] as const),
  sensitivityCeiling: "INTERNAL",
  spend: "NONE",
  requiredPermissions: Object.freeze([]),
  requiresIdempotencyKey: false,
  ownerGateType: null,
});

/**
 * The Director's registry with research added.
 *
 * Built by extension rather than replacement so a capability that already existed cannot be dropped
 * by this milestone, and so the policy version stays the registry's rather than becoming this file's.
 */
export const RESEARCH_CAPABILITY_REGISTRY_V1: CapabilityRegistryV1 = Object.freeze({
  policyVersion: EFFECT_POLICY_VERSION_V1,
  capabilities: Object.freeze([
    ...DIRECTOR_CAPABILITY_REGISTRY_V1.capabilities,
    SEARCH_POLICY_V1,
    FETCH_POLICY_V1,
  ]),
});

/** Every capability this milestone adds. Used by tests that assert nothing else crept in. */
export const RESEARCH_CAPABILITY_IDS_V1: readonly string[] = Object.freeze([
  RESEARCH_SEARCH_CAPABILITY_V1,
  RESEARCH_FETCH_CAPABILITY_V1,
]);
