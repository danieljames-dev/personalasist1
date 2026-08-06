# Sprint 2.8 Specification: Measurable Resource Limits

Status: **Proposed**; architecture and benchmark only  
Implementation freeze: **Active**  
Owner: CTO  
Targets gate: DG-4 — **DG-4 remains OPEN**  
Authorization: [CTO-DECISION-006](../../decisions/CTO-DECISION-006-sprint-2.8-authorization.md)

## Mission

Define measurable and enforceable resource and complexity limits for AION canonical contract
processing **without binding the architecture to one machine, runtime, storage engine, or
deployment**.

## Problem

ACJ-1 §29–§31 marks its limits **provisional**. "Bounded" is unenforceable and untestable until
the bounds are numbers, and AFX-1 boundary fixtures cannot be authored against a provisional
value without baking in a guess. AFX-1 §11.1 gate condition 1 blocks the first normative corpus
on DG-4 limits being accepted where fixture boundaries require them.

## Deliverables

- `docs/decisions/ADR-010-measurable-resource-limits.md` — **Proposed**
- `docs/decisions/CTO-DECISION-006-sprint-2.8-authorization.md`
- `docs/contracts/resource-limits-profile.md` — the `arlp-1` profile
- `docs/security/resource-limits-threat-model.md`
- `docs/benchmarks/resource-limits-methodology.md`
- `docs/benchmarks/resource-limits-evidence.md` and `resource-limits-run.json`
- `docs/sprints/sprint-2.8-resource-limits/` — specification, acceptance criteria, risks
- `docs/reviews/resource-limits-readiness-review.md`
- `tools/benchmarks/resource-limits/` — non-production probes

## Limit taxonomy

Four categories, never conflated:

| | Category | Purpose |
|---|---|---|
| **A** | Encoding capacity | The theoretical capacity of a representation field. **Not authorization to accept values near it** |
| **B** | Universal safety ceiling | A versioned hard maximum no conforming implementation may exceed. Deterministic rejection and DoS protection |
| **C** | Required conformance floor | The minimum an implementation must support to claim conformance |
| **D** | Deployment or owner policy limit | Configurable, may be stricter than B, never higher, and must be discoverable |

Representation capacity, safety ceiling, minimum supported capacity, deployment quota,
commercial plan limit, owner preference, storage quota, and network transport limit are eight
distinct concepts. This profile governs four.

## Limit surfaces

Thirty surfaces evaluated, each assigned to the **narrowest** owning subsystem — canonicalization
and framing to ACJ-1; provenance, relationship, and history to the Object contract; corpus limits
to AFX-1; time, batch, and concurrency to a future host. Surfaces are **not** forced into the
universal Object contract.

Twelve carry Proposed values, two are already Accepted in ACJ-1 §23, one is **withdrawn** as
mathematically dead, and the remainder are **Deferred** for lack of evidence.

## Benchmark scope

Seven shape groups — depth, width, strings and Unicode, numeric representations, parser failures,
framing, and combined adversarial — across 64 probes, 9 measured runs with 3 warm-up. Synthetic
data only. No personal or owner data. No network access.

Probes are **non-production and non-conformant**, fenced by a test that fails if any package
under `packages/` imports them.

## Invariants

Twenty limit-handling invariants: check before unbounded allocation; deterministic rejection;
fail closed; overflow-safe arithmetic; decoded-size limits; compression cannot bypass; Unicode
byte and scalar limits distinct; nesting cannot bypass node limits; many small members cannot
bypass byte limits; one large string cannot bypass member limits; deployment limits lower but
never higher; stricter deployment limits discoverable; errors must not reproduce oversized input;
rejection emits no bytes, frame, or digest; boundary defined at *N*−1, *N*, *N*+1; profile
versions explicit; migration cannot silently reinterpret an immutable object; limits are not
authorization; exhaustion is not reported as not-found or success; cancellation stays responsive.

## DG-4 closure conditions

Twenty conditions: taxonomy accepted; ownership assigned; ceilings specified; floors specified;
deployment limits distinguished; stable outcomes defined; boundary semantics defined; overflow
behaviour defined; methodology reviewed; synthetic evidence captured; every number traced to
evidence or a mathematical bound; adversarial shapes tested; memory amplification considered;
cancellation considered; at least one realistic low-resource target considered; cross-runtime
risks documented; fixture boundary cases authorable deterministically; readiness review
approving; no production implementation claim; and Founder/CTO acceptance of ADR-010 through a
later directive.

**DG-4 remains open during and after this sprint.** Four blocking findings stand.

## Non-goals

Production canonicalizer or validator implementation; Object or Identity implementation; any
fixture, normative or candidate; fixture loader; conformance harness; personal-data ingestion;
job search or applications; database, storage, or second-runtime selection; closing DG-3 or
DG-4; designating the Object Contract stable v1.
