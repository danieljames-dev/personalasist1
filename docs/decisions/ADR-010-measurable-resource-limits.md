# ADR-010: Measurable resource and complexity limits

- Status: **Accepted** for DG-4a only
- Date: 2026-08-06
- Accepted: 2026-08-06
- Decision owner: CTO
- Decision record: [CTO-DECISION-008](CTO-DECISION-008-resource-limits-and-vertical-slice.md)
- Implementation status: **Implemented only in the bounded Phase 5 Object reference.** This does not
  close DG-4b or establish production workload readiness.
- Authorized by: [CTO-DECISION-006](CTO-DECISION-006-sprint-2.8-authorization.md)
- Corrected by: [CTO-DECISION-007](CTO-DECISION-007-sprint-2.9-resource-limits-corrections.md)
- Profile identifier: `aion-resource-limits-1` (renamed from the Sprint 2.8 draft `arlp-1`)
- Closes gate: DG-4a — Canonical Processing Resource Limits only
- Excludes gate: DG-4b — Object and Domain Workload Limits remains **Open**
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

Adopt **`aion-resource-limits-1` v1** as the deterministic normative profile for the
canonical-processing surfaces it owns. Limits outside that scope remain Provisional or Deferred.

> **Sprint 2.9 correction.** The Sprint 2.8 draft used a floor-to-ceiling band and the identifier
> `arlp-1`. Readiness finding B-1 showed the band contradicts ACJ-1 §Conformance and §34, which
> require conforming implementations to agree on every rejection. The band is removed: **one
> deterministic value per surface**. See
> [CTO-DECISION-007](CTO-DECISION-007-sprint-2.9-resource-limits-corrections.md).

1. **Four categories, never conflated.** Encoding capacity (mathematical; **not** an acceptance
   limit), normative profile limit (one deterministic value), deployment admission limit (local,
   outside the conformance verdict), and separately named reduced profile (a future profile, never
   a deployment setting). Representation capacity, safety ceiling, minimum supported capacity,
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

5. **Distinct outcomes.** `limit-exceeded` (the contract verdict) and `policy-limit-exceeded`
   (deployment admission, outside the verdict). `conformance-floor-unmet` is removed — floors no
   longer exist. Outcomes carry the limit
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
- **Late rejection cost is linear in input size while early rejection is flat** — measured
  ratios 1.4× at 64 KiB, 8.9× at 1 MiB, 35.0× at 4 MiB. The ratio is unbounded as input grows.
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
- Limits sit outside ACJ-1 §24's change trigger (§1–§20, §23), so `aion-resource-limits-1`
  versions independently and a limits revision does not invalidate a single retained digest.
- The benchmark fence is enforced by a passing test, not by a convention.

### Costs

- Seven surfaces are Deferred for lack of evidence, so the profile is visibly incomplete.
- One deterministic value per surface means a genuinely low-resource implementation has no
  conformant option short of a separately named reduced profile, which does not yet exist.
- Every latency-derived number has **less** headroom than it appears: the probes use
  `JSON.parse`, and a real AION canonicalizer will be slower because it checks more.

### Constraints

- No number was chosen because it is a power of two.
- This machine's capability is not universal architecture.
- A benchmarked rule is **not** an implemented production control.

## Blocking findings — disposition after Sprint 2.9

All four were addressed; three fully. See the
[final readiness review](../reviews/resource-limits-final-readiness-review.md).

| | Finding | Status |
|---|---|---|
| **B-1** | Floor/ceiling band contradicts deterministic conformance | **Resolved** — band removed, one value per surface |
| **B-2** | Enforcement stage unspecified | **Resolved** — stage ownership assigned; pre-parse structural scan mandated. CPython's fixed recursion guard measured directly at 2,990/3,000, not tunable |
| **B-3** | Total value node undefined | **Resolved** — normative definition, worked examples, iterative counting, boundary triple verified by execution |
| **B-4** | Workload evidence not supplied | **Partially resolved** — canonicalization and framing evidenced across six size classes, six workload families and two runtimes. Object business limits and the six Object workload families remain unsupplied |

RC-1 is resolved by [CTO-DECISION-008](CTO-DECISION-008-resource-limits-and-vertical-slice.md):
the original DG-4 is retained in history and split prospectively into DG-4a canonical-processing
limits and DG-4b Object and domain workloads. DG-4a closes; DG-4b remains open.

## Original blocking findings (retained)

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

## Historical required subordinate decisions

The following list is retained from the Proposed review record. Items 1–7 were resolved or
dispositioned by Sprint 2.9 and CTO-DECISION-008 for the accepted DG-4a scope; Deferred Object and
domain workload matters remain governed by DG-4b.

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

**ADR-010 is Accepted for DG-4a only.** Acceptance closes DG-4a and ratifies one deterministic
normative limit for each canonical-processing surface owned by `aion-resource-limits-1` v1,
including exact node counting, explicit processing-stage ownership, JCS-compatible UTF-16
code-unit member ordering, overflow-safe accounting, framing limits, and deterministic rejection.

For the same source input under the same schema version, canonicalization profile,
resource-limits profile, and processing stage, conforming implementations must return the same
contract-level accept/reject result. Deployment admission limits are separate operational policy:
they may be stricter, must be observable, must return `policy-limit-exceeded`, and must not claim
that the canonical profile rejected the value.

Acceptance does **not** close DG-4b, designate the Universal Object Contract stable, authorize a
normative fixture, or authorize public, hostile, multi-owner, or production-scale ingestion. It
does not claim that any documented limit is enforced by production code. DG-3 remains Open, the
Object Contract remains Pre-stable, and benchmark evidence remains non-production evidence rather
than an implemented protection. Implementation remains frozen outside the narrow vertical slice
authorized by CTO-DECISION-008 and the Phase 5 reference authorized by CTO-DECISION-009.
