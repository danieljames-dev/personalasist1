# CTO-DECISION-008: Resource Limits and Vertical-Slice Authorization

- Status: Accepted
- Date: 2026-08-06
- Decision owner: CTO
- Scope: Sprint 3.0 Phase 2 documentation ratification only
- Directive: [Sprint 3.0 Career Vertical Slice](../directives/sprint-3.0-career-vertical-slice.md)

## Decision

The original DG-4 history is preserved and the gate is split into independently tracked
**DG-4a — Canonical Processing Resource Limits** and **DG-4b — Object and Domain Workload
Limits**. ADR-010 is Accepted for DG-4a only. DG-4a is Closed; DG-4b remains Open.

NF-1 is resolved by requiring identical AION exact-integer acceptance across runtimes. The
Minimum Personal Career Vertical Slice is authorized prospectively. The production implementation
freeze is lifted only within that narrow slice; all other implementation remains frozen. This
Phase 2 execution records the authorization and does not begin implementation.

## Context

Sprint 2.9 supplied corrected deterministic canonical-processing limits and benchmark evidence.
The remaining Object and domain workload questions require actual bounded Objects, relationships,
career documents, persistence behavior, and workflows. More foundation-only documentation cannot
produce credible relationship, aggregate, history, concurrency, persistence, or domain-workload
limits without a use case to measure. Splitting the gate permits a small controlled reference
slice while preserving the unresolved workload gate and every production-readiness restriction.

## DG-4a Scope

DG-4a includes:

- raw canonical-contract input limits;
- structural nesting depth;
- object-member, array-element, and total value-node counts;
- canonical-position string and identifier limits;
- canonical output limits;
- AION Frame v1 field and payload limits;
- deterministic accept/reject boundaries;
- overflow-safe accounting; and
- canonical-processing rejection semantics and processing-stage ownership.

## DG-4b Scope

DG-4b remains Open for:

- relationship counts and aggregate sizes;
- provenance sizes;
- history and version retrieval;
- career document counts;
- Memory and Planner workloads;
- workflow batches and concurrent operations;
- persistence and domain-specific workloads;
- service quotas; and
- production time budgets.

DG-4b does not block a local, single-owner, bounded reference vertical slice using small,
explicitly selected inputs. It continues to block claims of production-scale ingestion, hostile
public ingestion, unbounded processing, multi-user readiness, production workload readiness, and
production service readiness.

## ADR-010 Approval Effect

Acceptance ratifies `aion-resource-limits-1` v1 for DG-4a only. One named resource-limits profile
defines one deterministic normative limit for every surface it owns. The same input under the same
schema version, canonicalization profile, resource-limits profile, and processing stage must
receive the same contract-level accept/reject result across conforming implementations.

Deployment admission limits remain separate operational policy. They may be stricter, must be
observable, must return a distinct `policy-limit-exceeded` outcome, and must not claim the
canonical profile rejected the value.

Acceptance closes DG-4a only. It does not close DG-4b, designate the Object Contract stable,
authorize public, hostile, multi-owner, or production-scale ingestion, or claim the documented
limits are enforced by production code. Total value-node counting, processing-stage ownership,
JCS-compatible UTF-16 code-unit member ordering, deterministic rejection, and overflow-safe
accounting remain normative. Insufficiently evidenced limits remain Provisional or Deferred.
Benchmark evidence is not implemented production protection. DG-3 remains Open, the Object
Contract remains Pre-stable, and ADR-010 acceptance alone authorizes no production implementation.

## NF-1 Decision

The canonical profile admits exact integers only in the inclusive range
`−(2^53 − 1) … 2^53 − 1`. A conforming implementation must not trust a host parser merely because
it returned a numeric value. JavaScript must reject precision-lost out-of-range integers; Python
and any runtime preserving larger integers must enforce the same AION range. Host-language
capability does not redefine the contract. The same source value must receive the same AION
accept/reject result across runtimes, and rejection occurs before canonical bytes, frame bytes, or
digest output. A future cross-runtime normative fixture is required but is not authorized or
created by this decision.

## Vertical-Slice Authorization

Sprint 3.0 may later implement only:

- local single-owner Identity bootstrap;
- a minimum Object reference implementation;
- local private career intake;
- owner-supplied job-posting import;
- transparent deterministic matching;
- review-required application drafting;
- tests and synthetic demonstration data;
- local export; and
- documentation.

This Phase 2 execution does not begin that implementation. The freeze remains active outside this
prospective bounded authorization.

## Privacy Boundary

- No owner data has been authorized for ingestion.
- No broad laptop scan is authorized.
- No Gmail, phone, cloud, browser, or arbitrary-folder access is authorized.
- No private data may enter Git.
- No real personal data is included in this commit or backup.

## Remaining Gates

- DG-1 remains Open.
- DG-2 remains Closed.
- DG-3 remains Open.
- DG-4a is Closed.
- DG-4b remains Open.
- The Object Contract remains Pre-stable.
- Normative fixtures remain unauthorized and do not exist.
- Production conformance remains unproven.

## Verification Evidence

At ratification, `npm run verify` completed with production TypeScript typecheck clean, test
TypeScript typecheck clean, **12 tests passed, and 0 failed**.

## Review Triggers

- first real career-data ingestion;
- first hostile or public input path;
- first production deployment;
- first multi-owner design;
- first Object/domain workload benchmark;
- any change to the resource-limits profile; and
- any future reduced profile.
