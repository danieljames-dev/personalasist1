# Resource Limits Threat Model

Status: **Accepted for DG-4a architecture scope**, 2026-08-06
Scope: `aion-resource-limits-1` v1 and canonical-processing resource exhaustion
Authority: [ADR-010](../decisions/ADR-010-measurable-resource-limits.md) (Accepted for DG-4a only)
Implementation: **Not implemented.** Any future implementation is limited to the bounded Sprint 3.0 slice.

## Control status vocabulary

Every control is exactly one of:

- **Architectural** — a property of the design; holds without runtime code.
- **Specified** — a contract requirement with no implementation. Defends nothing today.
- **Demonstrated by benchmark** — a measured fact about *cost*, from one machine and one
  runtime. **A benchmarked rule is not an implemented production control.**
- **Implemented** — running code. **There are none.**
- **Operational** — a deployment or human control.
- **Deferred** — no control yet exists or is decided.

**No control in this threat model is implemented.** The only enforcement that exists anywhere
in the repository is `packages/kernel/test/architecture-boundary.test.mjs`, which prevents
production packages importing benchmark tooling — and that protects the *repository*, not any
owner data.

## Threats and controls

| # | Threat | Attack or failure | Control | Status |
|---:|---|---|---|---|
| 1 | **Resource-exhaustion DoS** | Adversarial document consumes CPU or memory until the device is unusable | L-01–L-11 ceilings with deterministic rejection | **Specified** |
| 2 | **Memory amplification** | Small input expands to large heap. Measured 2.3×–56.4× across shapes; peak 56.4× at `wideObject(1024)` | L-05, L-07 ceilings. **No amplification cap (L-28) is set** — the factor varied 24× across shapes and a single cap would be trivially loose or untested | **Demonstrated by benchmark**; cap **Deferred** |
| 3 | **CPU amplification** | Superlinear cost: 16× members → 27× time | L-05 ceiling sits below the measured knee | **Demonstrated by benchmark** |
| 4 | **Deep recursion / stack exhaustion** | Nested structure overflows the traversal stack | L-04 depth 64. **Critical measured fact:** `JSON.parse` bounded nothing to 1,000,000, while a recursive walk threw `RangeError` at 8,000. The runtime will not protect this | **Demonstrated by benchmark**; enforcement **Specified** |
| 5 | **Parser bombs** | Pathological shapes designed to maximise parse cost | L-01, L-07, L-24 (Deferred) | **Specified**, partly **Deferred** |
| 6 | **Unicode normalization attacks** | Input chosen to maximise normalization cost or expansion | L-25 expansion budget 4×; observed NFKD expansion 1.5×. ACJ-1 §4 *verifies* NFC rather than normalizing, and verification on already-NFC input is 8× cheaper | **Demonstrated by benchmark** |
| 7 | **Many-small-item attacks** | Thousands of tiny containers stay under every per-container limit. `manySmallContainers(100000)`: 25× amplification, 8.153 ms | L-07 total-node bound — this threat is the reason L-07 exists | **Specified** |
| 8 | **Integer overflow** | Length arithmetic wraps, turning a bound into a bypass | Invariant 4: overflow-safe arithmetic in a non-wrapping width | **Specified** |
| 9 | **Length-prefix overflow** | A declared `u32`/`u64` frame length exceeds remaining input or wraps | ACJ-1 §23 rules 9–11: `frame-truncated`, `frame-length-overflow`, `frame-trailing-bytes` | **Specified** |
| 10 | **Batch amplification** | One request carries many documents, each individually legal | L-27 batch item count | **Deferred** — no batching path exists |
| 11 | **Concurrent-request amplification** | N simultaneous near-limit documents exhaust memory even though each is legal | L-29 in-flight cap | **Deferred** — no server or scheduler exists |
| 12 | **Late rejection** | Attacker forces failure at the end of a large input. Measured ~**100×** cost: 0.523 ms late vs 0.005 ms early | Invariant 1: check limits before unbounded allocation | **Demonstrated by benchmark**; enforcement **Specified** |
| 13 | **Cancellation starvation** | A long operation ignores cancellation, holding resources | Invariant 20 | **Deferred** — unmeasurable, no cancellable implementation |
| 14 | **Logging amplification** | Oversized input is written to logs, multiplying its cost and persisting it | L-16 error-detail 4 KiB; ACJ-1 telemetry rules | **Specified** |
| 15 | **Error-message reflection** | An error echoes attacker-controlled content back to a caller or into logs | L-16; outcomes carry limit **identifier and category, never the offending value** | **Specified** |
| 16 | **Compressed-input expansion** | A small compressed payload decompresses past every limit | Invariant 6: decoded-size limits apply; a decompressed-size bound is **required before any compressed path is admitted** | **Specified** — and the path does not exist |
| 17 | **Fixture-corpus amplification** | A corpus grows until conformance runs are unaffordable and get skipped | AFX-1 4,096-byte literal cap and generator recipes; L-21 | **Specified** |
| 18 | **Inconsistent limits across runtimes** | Implementation A accepts what B rejects; both claim conformance | Category C conformance floor makes the minimum explicit and testable | **Specified**, **unverified** — no second runtime exists |
| 19 | **Profile downgrade** | An older, more permissive profile is claimed to widen what is accepted | Invariant 16: explicit profile versions; unknown profile fails closed | **Specified** |
| 20 | **Silent deployment-limit changes** | An operator tightens a limit and callers cannot tell contract rejection from policy rejection | Invariant 12 and the distinct `policy-limit-exceeded` outcome | **Specified** |
| 21 | **Limit probing and enumeration** | An attacker binary-searches to map exact limits | Accepted: limits are **public contract values**, not secrets. Publishing them removes the incentive to probe. Outcomes reveal the limit identifier, which is already public | **Architectural** |
| 22 | **Bypass through alternate input paths** | Import, migration, or an internal API skips limit checks | Limits attach to the **processing stage**, not the caller | **Specified** |
| 23 | **Bypass through imports or migrations** | Bulk paths treat limits as advisory for throughput | Same. A migration that must exceed a ceiling is a contract change, not an exception | **Specified** |
| 24 | **Bypass through trusted or internal callers** | "Internal" traffic is exempted | **No trusted-caller exemption exists.** Limits are not authorization (invariant 18), so there is no principal to exempt | **Architectural** |
| 25 | **Unavailable benchmark evidence** | A number is asserted where nothing was measured | Every Proposed value states its basis; unmeasured surfaces are marked **Deferred** rather than guessed. Seven surfaces are Deferred for exactly this reason | **Architectural** |
| 26 | **Benchmark manipulation** | Scores improved by disabling protections or using favourable storage | Defender was **not** disabled; benchmarks ran from local NVMe, **not** the external drive; environment is recorded with every run | **Operational** |
| 27 | **Benchmark overfitting to one machine** | A 15.7 GB laptop's capability becomes universal architecture | Conformance floors (C) are set for **portability**, not from this machine's headroom. The ceiling/floor split exists precisely to separate "what this machine can do" from "what every implementation must do" | **Architectural** — and see residuals |

## Residual risks accepted

- **Nothing is implemented.** Every control is architectural, specified, benchmarked, or
  deferred. A benchmarked cost is not a control; it is a reason a control was sized a certain
  way.
- **Threat 27 is only partially mitigated.** All evidence is from one x86-64 laptop, one
  runtime, one OS. The floors are *intended* to be portable, but portability has not been
  measured. Python's `json` being recursive with a low default recursion limit is a documented
  property, **not something this sprint measured** — and it is the single most likely reason
  L-04's floor is wrong.
- **Threat 2's amplification cap is Deferred**, so the largest measured hazard (56.4×) has a
  ceiling sized against *cost*, not against *ratio*.
- **Threats 10, 11, 13 are entirely deferred** — batching, concurrency, and cancellation have no
  design to attach a limit to.
- **The probes are not the future implementation.** Real AION processing will be slower than
  `JSON.parse` because it checks more, so every latency-derived number has **less** headroom
  than it appears to.

## What this threat model does not establish

It does not establish that any limit is enforced, that any implementation is safe, that limits
are correct on hardware unlike the benchmark machine, or that two runtimes would agree. It
establishes what must be true, and what was measured, and keeps those two categories visibly
apart.

## Residual decisions

1. A low-resource target: what device must the floors actually hold on?
2. A second runtime, and re-measurement of L-04 against a recursive parser.
3. Whether a memory-amplification cap (L-28) is expressible at all.
4. Compressed-input policy, before any compressed path is admitted.
5. Batching, concurrency, and cancellation limits, once those paths exist.
6. Whether `policy-limit-exceeded` risks disclosing deployment configuration to an attacker,
   and whether that matters given limits are public.
