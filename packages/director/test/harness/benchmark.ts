/**
 * Benchmark capture for local and mock providers.
 *
 * The point is not speed. It is that a discovery campaign is only comparable across runs if the
 * conditions it ran under were recorded — which provider answered, how long it took, whether it
 * refused, and how many effects it produced. Without that, "the campaign was clean last week" is a
 * sentence with no content.
 *
 * Strictly local: the only providers a benchmark may name are ones that never leave this machine.
 * A benchmark that quietly reached a paid endpoint would turn a measurement into an expense, so the
 * boundary is checked here rather than assumed of the caller.
 */

export const BENCHMARK_SCHEMA_V1 = "aion.harness.benchmark.v1" as const;

/** Providers a benchmark may measure. Anything else is refused rather than timed. */
export const LOCAL_BENCHMARK_PROVIDERS_V1 = ["local", "mock", "deterministic"] as const;
export type LocalBenchmarkProviderV1 = (typeof LOCAL_BENCHMARK_PROVIDERS_V1)[number];

export interface BenchmarkSampleV1 {
  readonly schema: typeof BENCHMARK_SCHEMA_V1;
  readonly label: string;
  readonly provider: LocalBenchmarkProviderV1;
  readonly runs: number;
  readonly totalMs: number;
  readonly slowestMs: number;
  /** Effects observed across all runs, so a fast benchmark that did nothing is visible as such. */
  readonly effects: number;
  readonly failures: number;
  readonly observedAtSha: string;
}

export interface BenchmarkRunResultV1 {
  readonly effects: number;
  readonly failed: boolean;
}

export interface BenchmarkInputV1 {
  readonly label: string;
  readonly provider: string;
  readonly runs: number;
  readonly observedAtSha: string;
  /** A single measured run. Must be synchronous and local; the harness never awaits a network. */
  readonly once: (index: number) => BenchmarkRunResultV1;
  /** Injected so a test can measure without depending on wall-clock timing. */
  readonly clockMs?: () => number;
}

export function isLocalBenchmarkProvider(candidate: string): candidate is LocalBenchmarkProviderV1 {
  return (LOCAL_BENCHMARK_PROVIDERS_V1 as readonly string[]).includes(candidate);
}

/**
 * Measure a bounded number of local runs.
 *
 * Refuses a non-local provider and a non-positive run count rather than producing a sample that looks
 * like evidence and is not.
 */
export function captureBenchmark(input: BenchmarkInputV1): BenchmarkSampleV1 {
  if (!isLocalBenchmarkProvider(input.provider)) {
    throw new Error(`benchmark refused a non-local provider: ${input.provider}. Only ${LOCAL_BENCHMARK_PROVIDERS_V1.join(", ")} may be measured.`);
  }
  if (!Number.isInteger(input.runs) || input.runs < 1) {
    throw new Error(`benchmark needs a positive run count, received ${input.runs}`);
  }

  const clock = input.clockMs ?? (() => Date.now());
  let totalMs = 0;
  let slowestMs = 0;
  let effects = 0;
  let failures = 0;

  for (let index = 0; index < input.runs; index += 1) {
    const started = clock();
    let result: BenchmarkRunResultV1;
    try {
      result = input.once(index);
    } catch {
      // A throw is a failed run, not an absent one. Dropping it would flatter the sample.
      result = { effects: 0, failed: true };
    }
    const elapsed = Math.max(0, clock() - started);
    totalMs += elapsed;
    if (elapsed > slowestMs) slowestMs = elapsed;
    effects += result.effects;
    if (result.failed) failures += 1;
  }

  return {
    schema: BENCHMARK_SCHEMA_V1,
    label: input.label,
    provider: input.provider,
    runs: input.runs,
    totalMs,
    slowestMs,
    effects,
    failures,
    observedAtSha: input.observedAtSha,
  };
}

/** A one-line summary for a ledger entry: comparable across runs, and honest about doing nothing. */
export function describeBenchmark(sample: BenchmarkSampleV1): string {
  const mean = sample.runs === 0 ? 0 : Math.round(sample.totalMs / sample.runs);
  return `${sample.label} [${sample.provider}] runs=${sample.runs} meanMs=${mean} slowestMs=${sample.slowestMs} effects=${sample.effects} failures=${sample.failures}`;
}
