# Resource-Limit Benchmark Evidence

Status: **Captured measurement record**  
Run date: 2026-08-06  
Probes: `tools/benchmarks/resource-limits/run.mjs`  
Machine-readable: `docs/benchmarks/resource-limits-run.json`  
Methodology: [resource-limits-methodology.md](resource-limits-methodology.md)

> **These are measured facts from one machine and one runtime.** They are not architecture,
> not a guarantee, and not proof of production readiness. The probes are non-production and
> implement no AION contract.

## Environment

| Item | Value |
|---|---|
| OS family / version | Windows_NT 11, build 10.0.26200 |
| Architecture | x64 |
| Processor class | Intel Core Ultra 5 226V |
| Logical cores | 8 |
| Physical memory | 15.7 GB |
| Node | v22.18.0 |
| V8 | 12.4.254.21-node.28 |
| Git commit | `88af664` (working tree dirty — benchmark tooling uncommitted at run time) |
| Runs / warm-up | 9 measured, 3 discarded |
| External drive | **Did not participate.** Run from local NVMe |
| Security software | Windows Defender **active, not disabled** |
| Power | Battery present; not pinned to a performance profile |

No usernames, email addresses, hostnames, or machine identifiers are recorded.

## Headline findings

### 1. The runtime does not bound nesting depth — recursion does

**This is the most important measurement in the set.**

| Observation | Value |
|---|---|
| Deepest nesting `JSON.parse` accepted | **1,000,000** |
| First failing parse depth | **none** — it never failed |
| Parser bounds depth? | **No** |
| Deepest a recursive walk survived | **4,000** |
| First failing walk depth | **8,000** (`RangeError`) |

Node's `JSON.parse` is iterative and will happily accept a million-deep structure. A naive
recursive traversal of that same structure overflows the stack at 8,000.

Two consequences follow directly:

- **AION must impose its own depth limit.** No runtime will do it.
- **The limit must protect *traversal*, not *parsing*.** A limit sized against parse cost would
  be catastrophically wrong, because parse cost is nearly flat while traversal cost is a cliff.

### 2. Integers above 2^53−1 are silently corrupted

Four string literals, parsed by `JSON.parse`. Literals are string constants, so the loss is
the parser's and not the probe's.

| Literal | Parsed as | Lossless |
|---|---|---|
| `9007199254740993` | `9007199254740992` | ✗ |
| `9007199254740995` | `9007199254740996` | ✗ |
| `18014398509481985` | `18014398509481984` | ✗ |
| `123456789012345678901` | `123456789012345680000` | ✗ |

**4 of 4 silently returned a different number, with no error.** This is direct evidence for
ACJ-1 §7's cap and §8's float prohibition: an integrity mechanism cannot be built on a
representation that changes values without saying so.

### 3. Duplicate members are destroyed by parsing

10,000 duplicate `"dup"` members → **1 parsed key**. Last value wins.

Empirical confirmation that AFX-1's Entry-B routing is mandatory: a parsed host value is not
evidence for ACJ-1 §19, because the fact under test no longer exists by the time you can
inspect it.

### 4. Per-unit cost is flat; the amplification *ratio* is not a sound basis for a limit

> **Correction.** A first run of this matrix reported amplification factors of 49×–56× and a
> "plateau at 4,096 members". **Those numbers were wrong.** The harness sampled `heapUsed`
> only *after* the probe returned — by which point the value under test was unreachable
> garbage — and counted `heapUsed` alone, excluding Buffers and other external allocation.
> It reported a **2,120-byte** peak delta for `hex.encode` over 16 MiB, which produces a
> 33.5 MB output. Every figure it produced was garbage-collection scheduling noise.
>
> The harness now collects before each iteration, samples **while the produced value is still
> retained**, and totals `heapUsed + external + arrayBuffers`. The numbers below are from the
> corrected harness. The correction is recorded rather than quietly replaced because the
> original numbers were used to justify a limit, and that justification was void.

**Object members — cost per member is essentially flat, and the knee was not located:**

| Members | Median | ns / member | Bytes / member | Amplification |
|---:|---:|---:|---:|---:|
| 64 | 0.033 ms | 515.6 | 270.6 | — |
| 1,024 | 0.169 ms | 165.0 | 72.4 | 6.69× |
| 4,095 | 0.688 ms | 168.0 | 72.1 | 5.79× |
| 4,096 | 0.671 ms | 163.8 | 72.1 | 5.79× |
| 4,097 | 0.974 ms | 237.7 | 72.1 | 5.79× |
| 65,536 | 18.863 ms | 287.8 | 72.0 | 4.91× |

Heap per member is **constant at ~72 bytes** from 1,024 to 65,536. Time per member is flat at
**164–168 ns** through 4,096, then rises to **288 ns** at 65,536 — a real 1.76× increase, but
the transition between those points **was never measured**. There is no discontinuity at 4,096:
4,096 measured *faster* than 4,095, which is run-to-run noise.

**Array elements — 8 bytes each, exactly one pointer:**

| Elements | Median | ns / element | Bytes / element | Amplification |
|---:|---:|---:|---:|---:|
| 1,024 | 0.018 ms | 17.6 | 8.51 | — |
| 65,535 | 1.286 ms | 19.6 | 8.01 | 1.37× |
| 65,536 | 1.858 ms | 28.4 | 8.01 | 1.37× |
| 65,537 | 1.847 ms | 28.2 | 8.01 | 1.37× |
| 1,000,000 | 30.618 ms | 30.6 | 8.00 | 1.16× |

Array elements cost **~8 bytes and ~20–30 ns each**; object members cost **~72 bytes and
~164–288 ns each**. Members are roughly **9× the memory and 8× the time** of elements — which
is why their limits differ by 16×, and it is the one width finding the evidence genuinely
supports.

Other shapes: `manySmallContainers(100000)` 6.482 ms at 5.00×; `memory.parse.wideObject(65536)`
16.267 ms at 4.91×; `largeArray(1000000)` 19.469 ms at 1.16×.

### 5. Late rejection costs ~100× early rejection

| Probe | Median |
|---|---:|
| `invalidEscape` **early** | 0.005 ms |
| `invalidEscape` **late** | 0.523 ms |
| `trailingContent` | 0.617 ms |
| `malformedNumber` late | 0.942 ms (amp 9.0×) |

An attacker who can force late failure gets a ~100× cost multiplier for free. This is why
limits must be checked before unbounded allocation, and why rejection latency is itself a
threat surface.

Note also `reject.lateInvalidValue.parseOK` (0.618 ms): a prohibited binary float **parses
fine**. Float rejection is an S2 concern, not S0 — which is exactly the B-1 stage split.

### 6. Byte length and scalar count diverge — but a scalar limit set equal to the byte limit is dead

A 1 MiB multibyte string carries **349,525 scalars in 1,048,583 bytes** — roughly a third the
scalars of a 1 MiB ASCII string. The two quantities genuinely diverge by ~3×.

**However**, UTF-8 encodes every scalar in at least one byte, so `scalarCount ≤ byteCount`
**always**. A scalar limit set to the same number as the byte limit can therefore never fire
independently — it is mathematically dead. If a scalar limit is wanted, it must be set
*strictly below* the byte limit, and the divergence measured here (~3×) is what would size it.

This is recorded because an earlier draft of the profile set both to 1,048,576 and cited this
very measurement as justification for having both. The measurement is real; the conclusion
drawn from it was wrong.

### 7. NFC checking is cheap when input is already NFC

| Probe | Median |
|---|---:|
| `isNFC` check on **NFD** input, 200k chars | 3.754 ms |
| `isNFC` check on **already-NFC** input | **0.451 ms** |
| NFC normalize transform | 4.056 ms |

The common case is **8× cheaper** than the adversarial one. ACJ-1 §4's decision to *verify*
NFC at the validator rather than *normalize* in the canonicalizer is cheap in normal operation
and costs only when someone sends non-NFC input — which is the correct incentive.

Observed NFKD expansion factor: **1.5×** on a known expanding sequence. Normalization is not
size-preserving, so a normalization expansion budget is required.

### 8. Hex encoding is the most expensive per byte at scale

At 16 MiB, corrected harness:

| Operation | Median | Peak memory delta | Amplification |
|---|---:|---:|---:|
| `hex.encode` | **16.291 ms** | 33,554,904 B | 2.00× |
| `digest.sha256` | 5.473 ms | 2,912 B | ~0 |
| `frame.build` | 4.716 ms | 33,559,078 B | 2.00× |

These are now physically coherent and serve as a self-check on the corrected harness: hex
doubles its input (2.00×), `Buffer.concat` copies it (2.00×), and a digest produces 32 bytes
regardless of input size (~0). The earlier harness reported 0× for hex and 0.001× for frame
build, which was impossible.

AFX-1's inline-hex byte evidence is the costliest of the three, at roughly 3× the digest.
That is an accepted cost of the Git line-ending finding, and it is a reason the fixture literal
cap exists.

Frame length-prefix overhead measured at **32 bytes** — six `u32` plus one `u64` — confirming
the ADR-008 correction from 28.

### 9. Decimal representation: cost does not decide it

| Probe | Median | Amplification |
|---|---:|---:|
| `decimalStrings(20000)` | 2.077 ms | 24.9× |
| `scaledIntegers(20000)` | 2.051 ms | 20.2× |

Near-identical. **The benchmark deliberately does not settle the decimal decision.** Cost was
never the question; correctness, precision, scale, and rounding semantics are, and those are
carried from CTO-DECISION-003.

## Full probe inventory

64 probes across seven groups. Complete per-probe medians, p95, worst case, minima, input and
output bytes, heap deltas, amplification factors, completion rates, and failure types are in
`docs/benchmarks/resource-limits-run.json`.

## Measurements marked unavailable

Recorded as unavailable rather than estimated: CPU duration; cancellation latency; concurrent
in-flight operations; cross-runtime agreement; storage I/O; frame rejection latency (no decoder
exists); full GC attribution.

## Sprint 2.9 workload evidence

Added to satisfy DG-4's requirement for six size classes and six workload families. Commands and
exit codes below. Machine-readable: `resource-limits-workloads.json` (31 Node probes, 10 of 10
self-checks passed) and `resource-limits-python.json` (16 CPython probes).

```bash
# Sprint 2.8 baseline (retained unchanged)
node --expose-gc tools/benchmarks/resource-limits/run.mjs --out docs/benchmarks/resource-limits-run.json

# Sprint 2.9 workload matrix - exit 0, 31 probes, 10/10 self-checks passed
node --expose-gc tools/benchmarks/resource-limits/workloads.mjs --out docs/benchmarks/resource-limits-workloads.json

# Sprint 2.9 second runtime - exit 0, 16 probes, CPython 3.13.7 stdlib only
python tools/benchmarks/resource-limits/probe_python.py --out docs/benchmarks/resource-limits-python.json
```

The workload runner **exits non-zero if any self-check fails**, so a run that cannot trust its own
numbers cannot be reported as success.

### Cross-runtime: the same shapes in two runtimes

| Shape | Node v22.18.0 | CPython 3.13.7 | Ratio |
|---|---:|---:|---:|
| `wideObject(1024)` parse | 0.144 ms | 0.133 ms | 0.9x |
| `wideObject(4096)` parse | 0.685 ms | 0.502 ms | 0.7x |
| `wideObject(65536)` parse | 13.93 ms | 18.95 ms | 1.4x |

Timing is **comparable, not catastrophically divergent**. Python was faster at small sizes and 1.4x
slower at the largest. Raw speed is not the portability risk; memory footprint and the absence of a
concurrency bound are.

### Depth: the runtimes disagree about who enforces it

| Runtime | Parser bounds depth? | Deepest parsed | First failure | Tunable? |
|---|---|---:|---:|---|
| Node | **No** | 1,000,000 | none | - |
| CPython | **Yes** | 2,990 | **3,000** (`RecursionError`) | **No** - `setrecursionlimit(20000)` did not move it |

A document at depth 3,000 rejects at **S0 in Python** and reaches **S1/S2 in Node**. AFX-1 s11 item
6 requires matching rejection stage, so two *correct* implementations would fail conformance against
each other. This is the direct justification for the pre-parse structural scan.

A recursive Node walker failed at depth 8,000; the iterative counter handled 200,000.

### Member ordering: the divergence, reproduced

Keys `a` (U+0061), U+E000, U+FFFF, and U+10000 (UTF-16 `D800 DC00`):

| Order | Result | Conformant |
|---|---|---|
| Required (UTF-16 code units) | `a`, U+10000, U+E000, U+FFFF | - |
| JavaScript default sort | matches required | **Yes** |
| Python default `sorted()` | `a`, U+E000, U+FFFF, U+10000 | **No** |

U+10000 is the highest code point of the four, but its UTF-16 form begins `D800`, below `E000` and
`FFFF`. Python's conformant comparator (`s.encode('utf-16-be')`) cost **0.384 ms vs 0.035 ms** for
the default - roughly 11x - and allocates one UTF-16 copy per key.

### Node counting

| Nodes | Median | ns/node | Bytes/node |
|---:|---:|---:|---:|
| 65,536 | 0.823 ms | 12.6 | 29.2 |
| 262,144 | 2.557 ms | 9.8 | 24.4 |
| 1,048,576 | 13.326 ms | 12.7 | 21.7 |

Boundary triple at limit 65,536 - *exceeded* flag at limit-1 / limit / limit+1: **false / false /
true**. Accepted below, accepted at, rejected above, verified by execution.

L-07 was set to **262,144** rather than 1,048,576: the higher value costs 13.3 ms and ~22.8 MB per
document here, which on a 4 GB two-core interpreted target is a plausible stall, and with no
in-flight bound it multiplies.

### Late rejection scales with input size

| Padding | Early | Late | Ratio |
|---:|---:|---:|---:|
| 64 KiB | 0.080 ms | 0.112 ms | 1.4x |
| 1 MiB | 0.076 ms | 0.674 ms | 8.9x |
| 4 MiB | 0.074 ms | 2.592 ms | **35.0x** |

Early-rejection cost is **flat**; late-rejection cost is **linear in input size**. The earlier
"~100x" figure was a single point on this curve. The ratio is unbounded as input grows, which is why
limits must be checked before allocation.

### Framing and digest

| Payload | Frame build | Digest sha-256 |
|---:|---:|---:|
| 1 KiB | 0.064 ms | 0.082 ms |
| 64 KiB | 0.081 ms | 0.108 ms |
| 1 MiB | 0.375 ms | 0.410 ms |
| 16 MiB | 5.159 ms | 5.158 ms |

Frame amplification is exactly **2.00x** (`Buffer.concat` copies); digest amplification ~0 (32 bytes
regardless of input). Both are physically coherent and act as harness self-checks.

### New cross-runtime hazard: integer precision

| Literal | Node | CPython |
|---|---|---|
| `9007199254740993` | `9007199254740992` WRONG | `9007199254740993` exact |
| `9007199254740995` | `9007199254740996` WRONG | `9007199254740995` exact |
| `18014398509481985` | `18014398509481984` WRONG | `18014398509481985` exact |
| `123456789012345678901` | `123456789012345680000` WRONG | exact |

CPython returns arbitrary-precision `int` and is **lossless where Node is lossy**. The same document
yields different numeric values in the two runtimes. This strengthens ACJ-1 s7's cap - and means a
conformant implementation must **reject** out-of-range integers rather than trust its parser,
because in Python the value survives and looks correct.

### Duplicate members - confirmed in both runtimes

10,000 duplicate members collapsed to **1 key**, last-wins, in **both** Node and CPython.

## What this evidence cannot support

- **Any claim about a second runtime.** Python's `json` is recursive with a default recursion
  limit near 1,000 — a fact from its documented behaviour, **not measured here**. Any limit
  intended to be portable must be re-measured there.
- **Any claim about the real AION canonicalizer**, which does not exist and will be slower than
  `JSON.parse` because it checks more.
- **Any claim about concurrency, cancellation, or sustained load.**
- **Any claim that a limit is safe on hardware unlike this one.** A 15.7 GB laptop is not a
  low-resource target.
