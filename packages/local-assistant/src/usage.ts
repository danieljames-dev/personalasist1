import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import type { BrainTierV1 } from "./brain.js";
import type { GpuSessionV1 } from "./gpu.js";

/**
 * Usage and cost evidence.
 *
 * This exists to answer one question later, honestly: **should the Founder keep renting GPU
 * capacity, or buy a machine?** That question has a right answer and it depends entirely on how
 * much the rented tier actually gets used — which nobody knows yet, including AION.
 *
 * So the rule here is that nothing is estimated into existence. A token count is recorded only
 * when the runtime reported one. A cost is recorded only where a rate is known. And the
 * rent-versus-buy verdict refuses to have an opinion until there is enough measured evidence to
 * support one, because a confident recommendation built on three requests would be worse than no
 * recommendation at all.
 */

export type TaskCategoryV1 =
  | "chat" | "routing" | "planning" | "research" | "evaluation" | "coding" | "other";
export const TASK_CATEGORIES: readonly TaskCategoryV1[] = ["chat", "routing", "planning", "research", "evaluation", "coding", "other"];

export interface InferenceUsageV1 {
  id: OpaqueId;
  at: IsoTimestamp;
  tier: BrainTierV1;
  endpointId: string;
  model: string;
  category: TaskCategoryV1;
  durationMs: number;
  /** Reported by the runtime, or null. Never estimated from character counts. */
  promptTokens: number | null;
  completionTokens: number | null;
  /** Whole cents, and only when a rate was actually known for this tier. */
  estimatedCents: number | null;
  succeeded: boolean;
}

function fail(message: string): never { throw new Error(message); }

export function buildUsage(input: Record<string, unknown>, context: { id: OpaqueId; now: IsoTimestamp }): InferenceUsageV1 {
  const category = TASK_CATEGORIES.includes(input.category as TaskCategoryV1) ? input.category as TaskCategoryV1 : "other";
  const tokens = (value: unknown): number | null => (Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null);
  const duration = Number.isSafeInteger(input.durationMs) && (input.durationMs as number) >= 0 ? input.durationMs as number : fail("Usage needs a duration in whole milliseconds.");
  return {
    id: context.id,
    at: context.now,
    tier: (input.tier as BrainTierV1) ?? "deterministic-floor",
    endpointId: String(input.endpointId ?? ""),
    model: String(input.model ?? ""),
    category,
    durationMs: duration,
    promptTokens: tokens(input.promptTokens),
    completionTokens: tokens(input.completionTokens),
    estimatedCents: Number.isSafeInteger(input.estimatedCents) && (input.estimatedCents as number) >= 0 ? input.estimatedCents as number : null,
    succeeded: input.succeeded !== false,
  };
}

export interface TierUsageV1 {
  tier: BrainTierV1;
  requests: number;
  failures: number;
  medianDurationMs: number;
  totalCents: number;
  /** Null when no runtime in this tier reported token counts. */
  totalTokens: number | null;
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

export interface CostIntelligenceV1 {
  byTier: TierUsageV1[];
  gpuSessions: number;
  gpuMinutes: number;
  gpuCents: number;
  /** How much of the milestone budget has actually been spent. */
  budgetUsedCents: number;
  /** The rent-versus-buy reading, or an honest refusal to give one. */
  verdict: {
    decidable: boolean;
    recommendation: "keep-renting" | "consider-buying" | "not-enough-evidence";
    detail: string;
  };
}

/**
 * What the measurements actually support.
 *
 * The thresholds are deliberately conservative and are stated in the output rather than hidden:
 * fewer than five rented sessions or under three hours of measured GPU time is not enough to
 * justify buying hardware, and saying so is more useful than producing a number that looks like
 * analysis. A recommendation here would be spent in the hundreds of pounds, so the bar to make
 * one is high.
 */
export function costIntelligence(
  usage: readonly InferenceUsageV1[],
  sessions: readonly GpuSessionV1[],
  budgetCeilingCents: number,
): CostIntelligenceV1 {
  const tiers: BrainTierV1[] = ["deterministic-floor", "local-model", "owner-gpu", "third-party"];
  const byTier = tiers.map((tier) => {
    const scoped = usage.filter((entry) => entry.tier === tier);
    const reportedTokens = scoped.filter((entry) => entry.promptTokens !== null || entry.completionTokens !== null);
    return {
      tier,
      requests: scoped.length,
      failures: scoped.filter((entry) => !entry.succeeded).length,
      medianDurationMs: median(scoped.map((entry) => entry.durationMs)),
      totalCents: scoped.reduce((sum, entry) => sum + (entry.estimatedCents ?? 0), 0),
      totalTokens: reportedTokens.length
        ? reportedTokens.reduce((sum, entry) => sum + (entry.promptTokens ?? 0) + (entry.completionTokens ?? 0), 0)
        : null,
    };
  }).filter((entry) => entry.requests > 0);

  const finished = sessions.filter((session) => session.startedAt);
  const gpuMinutes = finished.reduce((sum, session) => sum + session.measuredMinutes, 0);
  const gpuCents = finished.reduce((sum, session) => sum + session.estimatedCents, 0);

  const enoughSessions = finished.length >= 5;
  const enoughTime = gpuMinutes >= 180;
  const decidable = enoughSessions && enoughTime;
  const verdict = !decidable
    ? {
      decidable: false,
      recommendation: "not-enough-evidence" as const,
      detail: `${finished.length} rented session(s) and ${gpuMinutes} measured minute(s) of GPU time. Buying hardware is a decision worth hundreds of pounds, and AION will not recommend it on this. It needs at least 5 sessions and 3 hours of measured use, and it will say the same thing until it has them.`,
    }
    : gpuMinutes >= 20 * 60
      ? {
        decidable: true,
        recommendation: "consider-buying" as const,
        detail: `${gpuMinutes} minutes of measured GPU use across ${finished.length} session(s), costing about ${gpuCents} cents. At this rate a dedicated machine starts to pay for itself — work out your own break-even against a card that meets the VRAM you actually used, and remember AION measured usage, not resale value or electricity.`,
      }
      : {
        decidable: true,
        recommendation: "keep-renting" as const,
        detail: `${gpuMinutes} minutes across ${finished.length} session(s), about ${gpuCents} cents. That is well below the point where owning hardware is cheaper than renting it. Keep renting and revisit when the usage roughly triples.`,
      };

  return { byTier, gpuSessions: finished.length, gpuMinutes, gpuCents, budgetUsedCents: gpuCents, verdict };
}

/** A one-line reading of where the work actually happens, which is usually not where people guess. */
export function usageSummary(intelligence: CostIntelligenceV1): string {
  if (!intelligence.byTier.length) return "No inference has been recorded yet, so there is nothing to conclude about where your work happens.";
  const total = intelligence.byTier.reduce((sum, entry) => sum + entry.requests, 0);
  const parts = intelligence.byTier
    .sort((a, b) => b.requests - a.requests)
    .map((entry) => `${entry.tier} ${entry.requests} (${Math.round((entry.requests / total) * 100)}%)`);
  return `${total} recorded request(s): ${parts.join(", ")}. ${intelligence.gpuCents} cent(s) of rented GPU time so far.`;
}
