# ADR-010: Measurable resource and complexity limits

- Status: **Proposed**
- Date: 2026-08-06
- Decision owner: CTO
- Implementation status: **Frozen.** No canonicalizer, validator, or enforcement code exists.
- Authorized by: [CTO-DECISION-006](CTO-DECISION-006-sprint-2.8-authorization.md)
- Targets gate: DG-4 — **DG-4 remains OPEN. This ADR does not close it.**
- Depends on: [ADR-007](ADR-007-universal-object-model.md),
  [ADR-008](ADR-008-canonical-serialization.md), [ADR-009](ADR-009-contract-fixture-corpus.md)

## Context

ACJ-1 §29–§31 states limits — depth 64, 4,096 members, 65,536 array elements, 1 MiB string,
16 MiB total — and marks them **provisional**. DG-4 exists because "bounded" is unenforceable
and untestable until the bounds are numbers, and because AFX-1 boundary fixtures cannot be
authored against a provisional value without baking in a guess.

Sprint 2.8 built non-production benchmark probes, measured 64 shapes across seven groups, and
proposes a limit profile. It did **not** produce a closable gate.

## Decision

Adopt the **AION Resource Limits Profile 1 (`arlp-1`)** structure, with its values remaining
Proposed.

1. **Four categories, never conflated.** Encoding capacity (mathematical; **not** authorization
   to accept values near it), universal safety ceiling, required conformance floor, and
   deployment policy limit. Representation capacity, safety ceiling, minimum supported capacity,
   deployment quota, commercial plan limit, owner preference, storage quota, and network
   transport limit are eight different things; this profile governs four.

2. **Limits are assigned to the narrowest owning subsystem.** Canonicalization and framing
   limits belong to ACJ-1; provenance, relationship, and history limits belong to the Object
   contract and are **deferred to it rather than absorbed here**; corpus limits belong to AFX-1.

3. **Inclusivity is exact.** Below *N* accepted, exactly *N* accepted, above *N* rejected. No
   limit uses "approximately", "reasonable", or "large". Where a value is unknown it is
   **Deferred**, not softened.

4. **Twenty invariants** govern handling: check before unbounded allocation; deterministic
   rejection; fail closed; overflow-safe arithmetic; decoded-size limits; compression cannot
   bypass; nesting cannot bypass node limits; deployment limits may be lower but never higher
   and must be discoverable; errors must not reflect oversized input; rejection emits no bytes,
   frame, or digest; limits are not authorization.

5. **Distinct outcomes.** `limit-exceeded` (universal ceiling), `policy-limit-exceeded`
   (deployment), `conformance-floor-unmet` (implementation defect). Outcomes carry the limit
   identifier and category, **never the offending value**.

6. **Benchmark probes are non-production and are fenced by a test.**
   `packages/kernel/test/architecture-boundary.test.mjs` fails if any package under `packages/`
   imports from `tools/` or anything matching `benchmarks`.

## What the evidence established

- **The runtime does not bound nesting depth.** `JSON.parse` accepted 1,000,000 levels without
  error; a recursive traversal threw `RangeError` at 8,000. AION must impose its own depth
  limit, and it must protect **traversal**, not parsing.
- **Integers above 2^53−1 are silently corrupted** — 4 of 4 literals parsed to different values.
  Direct evidence for ACJ-1 §7 and §8.
- **Duplicate members are destroyed by parsing** — 10,000 members collapsed to 1 key. Direct
  evidence for AFX-1's Entry-B routing.
- **Late rejection costs ~100× early rejection** — 0.523 ms vs 0.005 ms.
- **Per-unit cost is stable and differs by container kind** — object members ~72 bytes and
  164–288 ns each; array elements ~8 bytes and ~20–30 ns each.

## What the evidence did not establish, and a correction

**The first benchmark run was wrong and its numbers were used to justify a limit.**

The harness sampled `heapUsed` only after the probe returned — when the value under test was
already unreachable garbage — and excluded external allocation. It reported a 2,120-byte peak
delta for `hex.encode` over 16 MiB, which produces a 33.5 MB output. It reported amplification
factors of 49×–56× and an apparent "plateau at 4,096 members" that was used to derive L-05.

Corrected — sampling while the value is retained, totalling `heapUsed + external + arrayBuffers`,
collecting between iterations — the residual difference tracks **key-name digit length**
(`"m0"` vs `"m4095"`), not member count: per-member heap differs by 0.47% across the sweep.

**The L-05 derivation was void and is withdrawn.** L-05 now records that it **ratifies** the
ACJ-1 §31 provisional value because the sweep found no reason to move it — not that a cost
transition selects it. The knee lies between 4,096 and 65,536 and was never located.

**L-09 was mathematically dead and is withdrawn.** It set a scalar limit equal to the byte
limit, but UTF-8 encodes every scalar in at least one byte, so `scalarCount ≤ byteCount` always.
It could never fire independently.

## Consequences

### Benefits

- Bounds become numbers with stated derivations, so a boundary fixture can be written.
- The four-category split separates "what this machine can do" from "what every implementation
  must do" — the distinction that keeps limits portable.
- Limits sit outside ACJ-1 §24's change trigger (§1–§20, §23), so `arlp-1` versions
  independently and a limits revision does not invalidate a single retained digest.
- The benchmark fence is enforced by a passing test, not by a convention.

### Costs

- Seven surfaces are Deferred for lack of evidence, so the profile is visibly incomplete.
- The floor/ceiling band creates two normative numbers per limit and a permanent maintenance
  burden — and see the blocking finding below.
- Every latency-derived number has **less** headroom than it appears: the probes use
  `JSON.parse`, and a real AION canonicalizer will be slower because it checks more.

### Constraints

- No number was chosen because it is a power of two.
- This machine's capability is not universal architecture.
- A benchmarked rule is **not** an implemented production control.

## Blocking findings carried forward

The readiness review returned **APPROVE WITH CHANGES**, with two of three reviewers initially
returning REJECT. Four findings must be resolved before ADR-010 could be accepted:

1. **The floor/ceiling band contradicts ACJ-1 §Conformance and §34**, which require byte-identical
   output *and* identical rejection between conforming implementations. A floor implementation
   rejecting at depth 40 what a ceiling implementation accepts leaves both "conforming" and
   disagreeing — and leaves every boundary fixture without a single declared limit to sit either
   side of.
2. **The enforcement stage is unspecified.** Independent review measured CPython 3.13.7 raising
   `RecursionError` at depth 2,999 in `json.loads`, a fixed C-level guard. The same input would
   reject at S0 in Python and S2 in TypeScript, which AFX-1 §11 counts as a conformance failure.
3. **"Total value node" (L-07) is undefined** — no counting rule, so two implementations count
   differently and the boundary is untestable.
4. **DG-4 cannot close on this evidence.** Its required evidence names metadata, label count,
   provenance, extension, relationship page, and event sizes plus six benchmarked workloads;
   none was supplied.

## Required subordinate decisions

1. Resolve the floor/ceiling conformance contradiction — one normative value per limit, or a
   separately identified reduced profile.
2. Specify the enforcement stage, including a pre-parse structural scan for byte-entry input.
3. Publish a normative node-counting rule with a worked example.
4. Locate the member-count knee, or state the value as ratified engineering judgment.
5. Set L-09 strictly below L-08, or leave it withdrawn.
6. Define a low-resource target the conformance floors must actually hold on.
7. Bind a limits-profile identifier into the digest descriptor and AFX-1 `subjectBinding`, so a
   retained record shows which limits applied.

## Review triggers

A low-resource target being measured; a second runtime being measured; any Deferred value
acquiring evidence; a recursive-parser runtime failing the L-04 floor; a production canonicalizer
existing and being slower than the probes assumed; ACJ-1 §29–§31 being updated to match.

## Approval effect

**ADR-010 is Proposed and is not accepted by this directive.**

Acceptance would authorize the limit profile and its subordinate decisions. It would **not**
authorize any implementation, any fixture, closure of DG-4, or lifting the freeze. DG-4 remains
open; production adapters and untrusted ingestion remain unauthorized.
