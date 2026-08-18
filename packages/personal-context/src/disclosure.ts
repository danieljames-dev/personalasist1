/**
 * Which model may be shown which fact, and why failover cannot change the answer.
 *
 * Provider Bridge V1 already decides which providers are eligible for which sensitivity class; that
 * table is reused rather than restated, because two copies of an eligibility rule is how one of them
 * quietly becomes more generous. What this module adds is the direction the bridge does not cover:
 * given a set of facts and a provider, what may that provider actually see.
 *
 * ## The failover invariant
 *
 * When a job's first executor becomes unavailable, the bridge may hand the job to another provider.
 * That is a change of *who runs the work*, and it must never become a change of *what data is
 * disclosed*. The failure mode is specific and easy to write by accident: build the context payload
 * once for provider A, then reuse the payload when the job moves to provider B. If A was eligible
 * for `INTERNAL` and B is not, the payload has just carried internal facts to an ineligible model,
 * and nothing in the bridge would notice — the bridge chose the provider, not the payload.
 *
 * So disclosure is always recomputed from the fact set for the provider that will actually receive
 * it ({@link discloseForProvider}), and {@link failoverDisclosure} exists to make the comparison
 * explicit and testable rather than implicit in a call order.
 */

import { defaultProviderCapabilities, PROVIDER_IDS_V1, type ProviderIdV1, type SensitivityClassV1 } from "@aion/director";

import type { PersonalContextFactV1 } from "./contracts.js";

/** Whether Provider Bridge V1 considers this provider eligible for this sensitivity class. */
export function providerEligibleForSensitivity(provider: ProviderIdV1, sensitivity: SensitivityClassV1): boolean {
  const capabilities = defaultProviderCapabilities(provider);
  if (capabilities === undefined) return false;
  return capabilities.sensitivityEligibility.includes(sensitivity);
}

/** Every provider Provider Bridge V1 would allow to see this class, in the bridge's own order. */
export function providersEligibleForSensitivity(sensitivity: SensitivityClassV1): readonly ProviderIdV1[] {
  return PROVIDER_IDS_V1.filter((id) => providerEligibleForSensitivity(id, sensitivity));
}

export type WithholdReasonV1 =
  | "PROVIDER_NOT_ELIGIBLE_FOR_SENSITIVITY"
  | "PROVIDER_NOT_ON_FACT_ALLOWLIST";

export interface WithheldFactV1 {
  readonly factId: string;
  readonly sensitivity: SensitivityClassV1;
  readonly reason: WithholdReasonV1;
}

export interface DisclosureV1 {
  readonly provider: ProviderIdV1;
  readonly disclosed: readonly PersonalContextFactV1[];
  /** Ids and reasons only. A withheld fact's value never appears in a disclosure report. */
  readonly withheld: readonly WithheldFactV1[];
}

/**
 * What this provider may see, computed from the facts rather than inherited from an earlier decision.
 *
 * Two independent gates, and a fact must pass both: the bridge's class eligibility, and the fact's
 * own provider allowlist (which a source can narrow further than the bridge would).
 */
export function discloseForProvider(
  facts: readonly PersonalContextFactV1[],
  provider: ProviderIdV1,
): DisclosureV1 {
  const disclosed: PersonalContextFactV1[] = [];
  const withheld: WithheldFactV1[] = [];
  for (const fact of facts) {
    if (!providerEligibleForSensitivity(provider, fact.sensitivity)) {
      withheld.push({ factId: fact.factId, sensitivity: fact.sensitivity, reason: "PROVIDER_NOT_ELIGIBLE_FOR_SENSITIVITY" });
      continue;
    }
    if (!fact.eligibleProviders.includes(provider)) {
      withheld.push({ factId: fact.factId, sensitivity: fact.sensitivity, reason: "PROVIDER_NOT_ON_FACT_ALLOWLIST" });
      continue;
    }
    disclosed.push(fact);
  }
  return { provider, disclosed, withheld };
}

export interface FailoverDisclosureV1 {
  readonly from: DisclosureV1;
  readonly to: DisclosureV1;
  /**
   * Facts the new executor may see that the old one could not.
   *
   * Always empty in practice for a narrowing failover, and the assertion that keeps it that way is
   * {@link failoverBroadensDisclosure} rather than a reviewer's memory.
   */
  readonly newlyDisclosed: readonly string[];
  /** Facts the old executor could see and the new one may not. Expected, and not a fault. */
  readonly newlyWithheld: readonly string[];
}

/**
 * Recompute disclosure for a takeover and report the difference in both directions.
 *
 * The `to` set is derived from the same fact list, never from `from.disclosed` — that is the entire
 * mitigation. Reusing the previous payload is what would leak.
 */
export function failoverDisclosure(
  facts: readonly PersonalContextFactV1[],
  from: ProviderIdV1,
  to: ProviderIdV1,
): FailoverDisclosureV1 {
  const before = discloseForProvider(facts, from);
  const after = discloseForProvider(facts, to);
  const beforeIds = new Set(before.disclosed.map((fact) => fact.factId));
  const afterIds = new Set(after.disclosed.map((fact) => fact.factId));
  return {
    from: before,
    to: after,
    newlyDisclosed: [...afterIds].filter((id) => !beforeIds.has(id)).sort(),
    newlyWithheld: [...beforeIds].filter((id) => !afterIds.has(id)).sort(),
  };
}

/**
 * Whether a takeover would show the new executor anything the old one was not shown.
 *
 * The question a caller should ask before continuing a job on a different provider. A `true` answer
 * means fail closed and pick a different executor, not "continue and hope".
 */
export function failoverBroadensDisclosure(result: FailoverDisclosureV1): boolean {
  return result.newlyDisclosed.length > 0;
}
