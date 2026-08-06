# Sprint 2.9 Acceptance Criteria

Status: **Proposed**
Scope: Architecture and benchmark only
Gate: DG-4 — **does not close DG-4**
Authorization: [CTO-DECISION-007](../../decisions/CTO-DECISION-007-sprint-2.9-resource-limits-corrections.md)

## Blocking findings

- [x] **B-1** — floor/ceiling band removed; one deterministic normative value per surface; the
  determinism rule stated over value, schema version, canonicalization profile, limits profile and
  stage; four categories defined; `conformance-floor-unmet` removed.
- [x] **B-2** — every normative limit assigned to an exact stage and owning subsystem; pre-parse
  structural scan mandated; earliest enforceable stage stated per entry path with residual risk;
  implementation strategy specified.
- [x] **B-3** — total value node defined normatively with inclusion list, exclusion list, four
  worked examples, iterative counting, overflow-safe counters, crossing-node behaviour, and
  execution-verified boundary triple.
- [x] **B-4** — six size classes and six workload families measured across two runtimes; every
  number classified by evidence category. **Partially met**: Object business-size classes and the
  six Object workload families were not supplied and cannot be until an Object implementation
  exists.

## Determinism and categories

- [x] One named profile defines one deterministic accept/reject boundary per limit it owns.
- [x] No ambiguous range in which one conforming implementation may accept and another reject.
- [x] Encoding capacity is explicitly not an acceptance limit.
- [x] Deployment admission rejection occurs before or outside the conformance verdict, returns a
  distinct outcome, is observable, and does not claim the contract profile rejected the value.
- [x] A reduced profile may exist only as a separately identified and versioned profile.
- [x] No reduced profile was created.
- [x] The profile identifier is stable and is part of conformance and fixture metadata.
- [x] The identifier was **not** added to the Universal Object envelope for convenience.

## Stage ownership

- [x] S0 owns raw input bytes, encoding, malformed-byte rejection, trailing content, BOM handling,
  and the pre-parse structural scan.
- [x] S1 owns schema and profile resolution and structural re-verification.
- [x] S2 owns identifier, member-name, string byte, Unicode, timestamp, numeric range, float
  prohibition and error-detail limits.
- [x] S3 owns canonical output bytes and deterministic member ordering.
- [x] S4 owns frame field limits, context length, payload length, total framed length, overflow-safe
  arithmetic, truncation and trailing-byte rejection.
- [x] S5 owns registered algorithm support and inherited digest input size.
- [x] Deployment policy owns batch count, in-flight operations, time budgets, queue limits and
  quotas — not forced into the canonical profile.
- [x] Where a parser cannot enforce before allocation, the earliest enforceable stage, residual
  risk, implementation strategy, streaming need and determinism rationale are documented.

## Total value node

- [x] Root, scalars, objects, arrays, member values and element values counted recursively.
- [x] Member names, punctuation, whitespace, tokens, raw bytes, canonical bytes, frame fields and
  absent provenance not counted.
- [x] Worked examples given for `null`, `{"a": 1}`, `[1, 2]` and `{"a": [true, null]}`.
- [x] Member count, member-name length and element count remain separate limits.
- [x] Iterative counting required, with measured justification.
- [x] Overflow-safe counters, crossing-node behaviour, cancellation and boundary triple specified.
- [x] Counting does not differ across runtimes by construction.

## Benchmark discipline

- [x] No network access, no external service calls, no personal data, no private repository content
  as input.
- [x] No production import path; no production package imports benchmark tooling; boundary test
  passes.
- [x] No new production dependency — the second runtime was already installed.
- [x] Machine-readable output, stable synthetic seeds, warm-up and repeated runs.
- [x] Median, p95, worst and standard deviation recorded.
- [x] Exact exit codes recorded.
- [x] Unavailable measurements marked unavailable, not estimated.
- [x] Self-checks for impossible measurements; the run exits non-zero if any fails.
- [x] Benchmarks did not run from the external drive; security software was not disabled.

## Evidence

- [x] Every required workload mapped to command, shape, size, node count, depth, counts, runs,
  warm-up, median, p95, worst, memory, amplification, rejection point, environment, classification
  and affected limit.
- [x] Direct measurement, proxy measurement, mathematical derivation, inference and unavailable
  evidence distinguished.
- [x] Failed and contradictory runs not concealed.
- [x] Superseded findings preserved with explanation rather than deleted.

## Member ordering

- [x] Ordering specified as JCS-compatible UTF-16 code-unit comparison.
- [x] Host-default, code-point, locale and culture-sensitive ordering explicitly excluded.
- [x] Explicit comparator required for runtimes not natively ordering by UTF-16 code units.
- [x] Non-normative worked example with a BMP key, a supplementary-plane key, and a key whose
  code-point order differs — showing code points, UTF-16 code units, required order, and why
  Python default ordering differs.
- [x] No normative fixture created; recorded as a required future fixture.
- [x] Confirmed as a **clarification**, not a change of accepted semantics; ADR-008 not amended.

## Gate status

- [x] ADR-007, ADR-008, ADR-009 remain Accepted.
- [x] **ADR-010 remains Proposed.**
- [x] DG-2 remains closed; DG-3 remains open; **DG-4 remains open.**
- [x] Object Contract remains **Pre-stable**.
- [x] No normative fixtures; no fixture directory; no canonicalizer; no validator.
- [x] No provisional number described as accepted architecture.
- [x] Implementation freeze not lifted.

## Approval result

**Not yet recorded.** ADR-010 remains **Proposed**. The final readiness review returned
**APPROVE WITH CHANGES** with one required change: **RC-1**, split DG-4 into canonicalization
limits (DG-4a, closable on this evidence) and Object business limits with their six workload
families (DG-4b, remaining open). That is a scope decision reserved to the Founder/CTO.

## Subsequent ratification — 2026-08-06

[CTO-DECISION-008](../../decisions/CTO-DECISION-008-resource-limits-and-vertical-slice.md)
subsequently made RC-1: ADR-010 is Accepted for DG-4a only, DG-4a is Closed, and DG-4b remains
Open. The checklist above remains the historical Sprint 2.9 completion record; no production
protection or implementation is retroactively claimed.
