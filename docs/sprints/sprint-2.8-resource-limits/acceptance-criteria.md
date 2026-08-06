# Sprint 2.8 Acceptance Criteria

Status: **Proposed**  
Scope: Architecture and benchmark only  
Gate: DG-4 — **does not close DG-4**  
Authorization: [CTO-DECISION-006](../../decisions/CTO-DECISION-006-sprint-2.8-authorization.md)

## Deliverable completeness

- [x] All ten directive documents exist at the exact required paths.
- [x] ADR-010 is **Proposed** and was not marked Accepted.
- [x] No production canonicalizer or validator was implemented.
- [x] No fixture — normative or candidate — was generated.
- [x] No fixtures directory was created.
- [x] No fixture loader or conformance harness was implemented.
- [x] No dependency was added or changed.
- [x] No database, storage, transport, or second runtime was selected.

## Scope prohibitions

- [x] No personal-data ingestion, job search, job application, or external integration.
- [x] No benchmark input contains personal or owner data.
- [x] No network access or external service call in any probe.
- [x] The implementation freeze remains active and is restated in every governing artifact.

## Limit taxonomy

- [x] Four categories defined: encoding capacity, universal safety ceiling, required conformance
  floor, deployment or owner policy limit.
- [x] Encoding capacity is explicitly **not** an authorization to accept values near it.
- [x] Representation capacity, safety ceiling, minimum supported capacity, deployment quota,
  commercial plan limit, owner preference, storage quota, and network transport limit are kept
  distinct.

## Limit surfaces

- [x] All thirty directive surfaces evaluated and assigned a category or marked Deferred.
- [x] Each limit assigned to the **narrowest** owning subsystem.
- [x] Surfaces are not forced into the universal Object contract.
- [x] Provenance, relationship, and history limits deferred to the Object contract rather than
  absorbed.

## Invariants and outcomes

- [x] All twenty limit-handling invariants stated.
- [x] Inclusivity stated exactly: below *N* accepted, *N* accepted, above *N* rejected.
- [x] No limit uses "approximately", "reasonable", or "large".
- [x] Distinct stable outcomes: `limit-exceeded`, `policy-limit-exceeded`,
  `conformance-floor-unmet`.
- [x] Outcomes carry the limit identifier and category, never the offending value.

## Benchmark authorization boundary

- [x] Probes live only under `tools/benchmarks/resource-limits/`.
- [x] Probes are clearly marked non-production and non-conformant.
- [x] An architecture test prevents production packages importing benchmark tooling, and it
  passes.
- [x] Probes use synthetic data only, no network, no external calls, no production dependencies.
- [x] Environment and exact commit recorded with the run.
- [x] Output is reproducible and machine-readable.
- [x] Measured facts are separated from architectural recommendation.
- [x] No probe is presented as the canonicalizer, validator, fixture loader, conformance harness,
  a security boundary, or proof of production readiness.

## Benchmark execution

- [x] All seven shape groups exercised: depth, width, strings, numeric, parser failures, framing,
  combined adversarial.
- [x] Repeated runs with warm-up; median, p95, worst, and minimum recorded.
- [x] A single run is not treated as evidence.
- [x] Unavailable measurements are labelled unavailable rather than fabricated.
- [x] Benchmarks did not run from the external drive.
- [x] Security software was not disabled.
- [x] No usernames, email addresses, or unnecessary machine identifiers in committed evidence.

## Limit-selection method

- [x] The basis for selecting a candidate limit is explained.
- [x] Numbers are not chosen solely because they are powers of two.
- [x] The current machine's capability is not encoded as universal architecture.
- [x] Mathematical bounds, benchmark-supported ceilings, conservative floors, and configurable
  defaults are distinguished.
- [x] Where evidence is insufficient the value is retained as Proposed or Deferred.
- [x] **DG-4 is not claimed closed merely because a table contains numbers.**

## Honesty of the record

- [x] The first benchmark harness's memory metric was found to be invalid and is corrected.
- [x] The correction is **recorded**, not silently applied, because the void numbers had been
  used to justify a limit.
- [x] The L-05 derivation built on those numbers is **withdrawn** and restated as ratification.
- [x] L-09 is **withdrawn** as mathematically dead.
- [x] Blocking findings from the readiness review are carried into ADR-010 rather than dismissed.

## Security

- [x] All required threat categories addressed.
- [x] Every control marked architectural, specified, demonstrated-by-benchmark, implemented,
  operational, or deferred.
- [x] **No benchmarked rule is described as an implemented production control.**
- [x] It is stated that no control is implemented.

## Gate status

- [x] ADR-007, ADR-008, ADR-009 remain Accepted.
- [x] DG-2 remains closed.
- [x] DG-3 remains open; normative fixtures remain unauthorized.
- [x] **DG-4 remains open.**
- [x] The Universal Object Contract remains **Pre-stable**.
- [x] No provisional number is described as accepted architecture.

## Approval result

**Not yet recorded.** ADR-010 remains **Proposed**. The readiness review returned
**APPROVE WITH CHANGES** with four blocking findings — floor/ceiling conformance contradiction,
unspecified enforcement stage, undefined node counting, and DG-4's unmet evidence requirements.

Passing these criteria does not authorize implementation, does not create any fixture, and does
not close DG-4.
