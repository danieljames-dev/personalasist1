# Resource-Limit Benchmark Methodology

Status: **Proposed**  
Authority: [ADR-010](../decisions/ADR-010-measurable-resource-limits.md) (Proposed)  
Probes: `tools/benchmarks/resource-limits/`  
Implementation: **Not authorized.** These probes are not production code.

## What the probes are, and are not

> **NON-PRODUCTION. NON-CONFORMANT. NOT A SECURITY BOUNDARY.**

The probes are **not** the AION canonicalizer, **not** `CanonicalContractValidatorV1`, **not**
a fixture loader, **not** a conformance harness, and **not** proof of production readiness.
They approximate the *cost shape* of future operations using Node built-ins. They implement
no AION contract.

This distinction is enforced, not merely asserted: `packages/kernel/test/architecture-boundary.test.mjs`
fails if any package under `packages/` imports anything from `tools/` or matching `benchmarks`.

### Where the approximation is weakest

Stated up front, because a methodology that hides its own limits is worthless:

- **`JSON.parse` is not the future parser.** It is iterative, written in C++, and does not
  enforce any AION rule. A real AION parser will be slower and will check more. Measured
  parse costs are therefore a **lower bound** on real cost, and limits derived from them have
  less headroom than the numbers suggest.
- **`countNodes` is a naive recursive walker.** Its stack-overflow depth is a property of
  V8's stack and this probe's frame size, not of any AION implementation. It is used as
  evidence that *recursion is the binding constraint*, not to fix a number.
- **One machine, one runtime, one OS.** Everything here is Node v22 on one x86-64 laptop with
  antivirus active. Nothing measured generalizes to another runtime without re-measurement.
- **Memory is measured via `process.memoryUsage().heapUsed` deltas**, which is coarse,
  allocator-dependent, and perturbed by GC timing. Amplification below a 4 KiB input floor is
  reported as `null` rather than as a misleading ratio.

## Design of the harness

Each probe runs `WARMUP` discarded iterations then `RUNS` measured iterations — 3 and 9 in the
full matrix, 1 and 3 with `--quick`. Recorded per probe: median, p95, worst, and minimum
wall-clock milliseconds; operations per second derived from the median; input bytes; peak heap
delta; memory-amplification factor; and completion rate against the *expected* outcome, so a
rejection probe that fails to reject is scored as a failure rather than a success.

Repeated runs and variance are recorded. **A single run is not evidence** and no limit in this
sprint is derived from one.

### Measurements deliberately marked unavailable

Not estimated, not inferred, not silently omitted:

| Measurement | Why unavailable |
|---|---|
| CPU duration | `process.cpuUsage()` deltas are not attributable per-probe at this granularity |
| Cancellation latency | No cancellable implementation exists to cancel |
| Concurrent in-flight operations | No server, scheduler, or request path exists |
| Cross-runtime agreement | No second runtime exists |
| Storage I/O | Deliberately not measured; benchmarks avoid the external drive |
| GC observations | Only partially available; `--expose-gc` gives control, not attribution |

## Environment discipline

Benchmarks run from the local NVMe working repository. **They do not run from `D:\`** — the
external backup drive participates only when a benchmark explicitly measures storage, and none
does. Security software was **not** disabled to improve scores; Windows Defender was active
throughout, and its background load is part of the measured reality rather than something
tuned away.

Committed evidence records the OS family and version, architecture, processor class, logical
core count, physical memory, Node and V8 versions, the exact Git commit, and whether the
working tree was clean. It records **no** usernames, email addresses, hostnames, or machine
identifiers.

## The shape matrix

Synthetic only. No personal or owner data, ever.

| Group | Shapes |
|---|---|
| **A. Depth** | shallow; moderate; candidate−1; candidate; candidate+1; extreme adversarial |
| **B. Width** | narrow objects; many-member objects; large arrays; many small values; one very large value |
| **C. Strings** | ASCII; multibyte UTF-8; combining characters; already-NFC; non-NFC; long member names; long values |
| **D. Numeric** | minimum and maximum allowed integers; values beyond the exact range; decimal-string candidates; scaled-integer candidates; prohibited binary-float sources |
| **E. Parser failures** | invalid UTF-8 as raw bytes; duplicate members; invalid escapes; trailing content; malformed numbers; early failure; failure near end of input |
| **F. Framing** | empty permitted fields; maximum textual fields; maximum context; large payload; truncated frame; length overflow; trailing bytes |
| **G. Combined adversarial** | deep and wide; many long strings; nodes distributed across containers; late invalid value; repeated rejection |

Group F is measured for **construction and size only**. Truncation, overflow, and trailing-byte
*rejection latency* are recorded as unavailable, because no frame decoder exists to reject
anything.

The decimal-versus-scaled-integer probes exist to measure cost, and they measured it as
near-identical. **That deliberately does not settle the decimal decision**, which is a
correctness and modelling question carried from CTO-DECISION-003. Choosing a representation on
benchmark convenience would be exactly the wrong basis.

## How a candidate limit is selected

A number is admissible only with a stated derivation. Permitted bases:

1. **Mathematical or encoding bound** — a `u32` cannot exceed 4,294,967,295. Requires no
   measurement, and confers no authorization to accept values near it.
2. **Measured amplification** — peak heap delta per input byte under adversarial shapes.
3. **Measured latency** — median and worst-case cost, including the cost of *rejecting*.
4. **Overflow safety** — the value must keep all derived length arithmetic inside a
   non-wrapping width.
5. **Portability** — the value must be enforceable in a runtime whose parser is recursive and
   whose default recursion limit is low, not only in one that happens to be iterative.
6. **Low-resource target** — a limit that only a 16 GB laptop can honour is not universal.
7. **Attacker-controlled worst case** — the shape an adversary would actually send.
8. **Future migration cost** — raising a ceiling later is cheap; lowering one breaks data.
9. **Headroom** — the gap between the limit and observed failure.
10. **Contract simplicity** — fewer, clearer limits beat many precise ones.

Explicitly **not** permitted:

- choosing a number because it is a power of two, absent another basis;
- encoding this laptop's exact capability as universal architecture;
- inferring a universal ceiling from a single run.

Where evidence is insufficient, the value stays **Proposed** or **Deferred**. A table
containing numbers is not a closed gate, and this methodology does not claim DG-4 can close
merely because §17 of the profile has rows.

## Reproducing

```bash
# Sprint 2.8 baseline
node tools/benchmarks/resource-limits/run.mjs --quick
node --expose-gc tools/benchmarks/resource-limits/run.mjs --out docs/benchmarks/resource-limits-run.json

# Sprint 2.9 workload matrix (six size classes x six workload families)
node --expose-gc tools/benchmarks/resource-limits/workloads.mjs --out docs/benchmarks/resource-limits-workloads.json

# Sprint 2.9 second runtime (CPython, standard library only)
python tools/benchmarks/resource-limits/probe_python.py --out docs/benchmarks/resource-limits-python.json
```

The workload runner self-checks for physically impossible measurements and **exits non-zero if any
self-check fails**. A benchmark run that cannot trust its own numbers must not be reported as
success.

The second form is what produced the committed evidence. `--expose-gc` is used so heap deltas
are taken after an explicit collection rather than at an arbitrary point in the GC cycle.
