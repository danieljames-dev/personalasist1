# Sprint 2.9 Specification: Resource-Limit Corrections

Status: **Proposed**; architecture and benchmark only
Implementation freeze: **Active**
Owner: CTO
Targets gate: DG-4 — **DG-4 remains OPEN**
Authorization: [CTO-DECISION-007](../../decisions/CTO-DECISION-007-sprint-2.9-resource-limits-corrections.md)

## Mission

Resolve the four construction-blocking findings from the Sprint 2.8 readiness review and supply the
workload evidence the DG-4 gate requires — without accepting ADR-010 and without closing DG-4.

## The four findings

| | Finding | Resolution |
|---|---|---|
| **B-1** | The conformance-floor / universal-ceiling band contradicts deterministic accept/reject under one profile | Band removed. One deterministic value per surface. Four categories: encoding capacity, normative profile limit, deployment admission limit, separately named reduced profile |
| **B-2** | Enforcement stages not precisely assigned | Every limit assigned to an exact stage. Pre-parse structural scan mandated for byte-entry input |
| **B-3** | "Total value node" undefined | Normative definition with inclusion and exclusion lists, worked examples, and iterative counting requirements |
| **B-4** | Required workload evidence not supplied | Six size classes × six workload families, two runtimes, 47 probes, 10/10 self-checks |

A fifth matter — cross-runtime member-ordering divergence — was raised separately and is resolved
as a **clarification** of ACJ-1 §2, not a change of accepted semantics.

## Deliverables

- `docs/decisions/CTO-DECISION-007-sprint-2.9-resource-limits-corrections.md`
- `docs/contracts/resource-limits-profile.md` — rewritten as `aion-resource-limits-1`
- `docs/contracts/canonical-serialization.md` — §2 member-ordering clarification
- `docs/benchmarks/resource-limits-evidence.md` — workload evidence added
- `docs/benchmarks/resource-limits-workloads.json`, `resource-limits-python.json`
- `tools/benchmarks/resource-limits/workloads.mjs`, `probe_python.py`
- `docs/sprints/sprint-2.9-resource-limits-corrections/` — specification, acceptance criteria, risks
- `docs/reviews/resource-limits-final-readiness-review.md`
- `docs/reviews/resource-limits-readiness-review.md` — disposition recorded

## Profile

Identifier **`aion-resource-limits-1`**, version 1. Renamed from the Sprint 2.8 draft `arlp-1`
because a three-letter contraction is easily confused with `acj-1` in prose and metadata, and the
two version independently.

The identifier is part of **conformance and fixture metadata**. It is deliberately **not** added to
the Universal Object envelope — ADR-007's admission test requires a universal field to be
meaningful for every Object profile, and a limits identifier is a processing concern.

**No reduced profile is created.** Portability analysis found no contradiction that lowering the
normative values did not resolve.

## Benchmark scope

Two runtimes. Node v22.18.0 (31 probes) and CPython 3.13.7 (16 probes), the latter authorized
because it is already installed and needs standard library only — **no production dependency was
added**. Both are proxies and neither is described as proof of the future production implementation.

Six size classes: minimal, small, moderate, large, candidate-limit boundary, adversarial over-limit.

Six workload families: raw parsing; structural traversal and node counting; canonical member
ordering and serialization proxy; AION Frame v1 construction; digest computation; early and late
rejection.

The harness self-checks for impossible measurements and **exits non-zero if any self-check fails**,
so a run that cannot trust its own numbers cannot be reported as success.

## Evidence classification

Every candidate number is classified: mathematically derived, encoding-derived, benchmark-supported,
security-conservative, workload-required, provisional, or deferred. A number supported only by
convenience, convention, or a power-of-two preference remains **provisional**.

## Low-resource portability

One documented lower-resource evaluation target — 4 GB memory class, two logical cores, interpreted
or slower runtime, no GPU, no database, local-only — **assessed, not physically tested**, and stated
as such. Benchmark-machine performance is not scaled linearly. Three values were **lowered** rather
than kept: raw and canonical bytes 16 MiB → 4 MiB, total nodes 1,048,576 → 262,144, error detail
4 KiB → 512 B, identifier length 1,024 → 256 B.

## Non-goals

Accepting ADR-010; closing DG-4; any fixture, normative or candidate; fixture loader; conformance
harness; production canonicalizer or validator; Identity, Object or Memory implementation;
personal-data ingestion; job search or applications; database, storage or production dependency
selection; amending ADR-008.
