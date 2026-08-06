# CTO-DECISION-006: Sprint 2.8 authorization

- Status: Recorded
- Date: 2026-08-06
- Decision authority: Founder / CTO
- Subject: Sprint 2.8 measurable resource and complexity limits (DG-4)
- Related: [ADR-008](ADR-008-canonical-serialization.md), [ADR-009](ADR-009-contract-fixture-corpus.md),
  [ADR-010](ADR-010-measurable-resource-limits.md) (Proposed),
  [CTO-DECISION-005](CTO-DECISION-005-fixture-corpus-architecture.md)

# Decision

Authorize Sprint 2.8 to define measurable, enforceable resource and complexity limits for AION
canonical contract processing **without binding the architecture to one machine, runtime,
storage engine, or deployment**.

# Authorized

Architecture documentation; a proposed ADR; language-neutral limit profiles; threat modelling;
benchmark methodology; synthetic benchmark data; **non-production benchmark probes**; benchmark
execution; captured benchmark evidence; a readiness review.

# Not authorized

Production canonicalizer or validator implementation; Object or Identity implementation; fixture
generation of any kind, normative or candidate; fixture loader; conformance harness;
personal-data ingestion; job search; job applications; database or storage selection; production
service changes.

**No normative fixture, no candidate fixture, and no fixtures directory** — carried from
CTO-DECISION-005's seven-condition gate, which this sprint does not open.

# Benchmark authorization boundary

Non-production probes are authorized **only** under `tools/benchmarks/resource-limits/`. They
must be clearly marked non-production and non-conformant; never imported by `packages/kernel` or
any future production package; use synthetic data only; contain no personal or owner data;
perform no network access; make no external service calls; add no production dependencies;
record the environment and exact commit; produce reproducible machine-readable output; and
separate measured facts from architectural recommendation.

A probe must never be presented as the production canonicalizer, `CanonicalContractValidatorV1`,
the fixture loader, the conformance harness, a security boundary, or proof of production
readiness.

**Enforcement:** `packages/kernel/test/architecture-boundary.test.mjs` gained a second test —
"Production packages do not import benchmark tooling" — which fails if any package under
`packages/` imports from `tools/` or anything matching `benchmarks`. This raised the suite from
11 tests to **12**.

# Verification Evidence

```
$ npm run verify
ok 1 - AionKernelV1
ok 2 - Kernel source has no external or cross-subsystem imports
ok 3 - Production packages do not import benchmark tooling
ok 4 - published versioned export is consumable
# tests 12
# pass 12
# fail 0
```

**Deviation recorded.** The directive specified an expected result of 11 passed. Adding the
directed boundary check necessarily raises the count to 12. The substantive instruction — add
the check — was followed, and the true figure is reported rather than a commit message asserting
a count that no longer holds.

Production typecheck clean; test typecheck clean. No production source, dependency, manifest, or
lockfile changed. No fixture exists. No fixtures directory exists.

# Gate status

| Gate | Status |
|---|---|
| DG-1 Identity bootstrap | **Open** |
| DG-2 Canonical serialization | **Closed** |
| DG-3 Representative fixtures | **Open.** Normative fixtures unauthorized |
| DG-4 Measurable limits | **Open.** ADR-010 Proposed; four blocking findings |

The Universal Object Contract remains **pre-stable**. The implementation freeze remains active.

# Review triggers

A low-resource target being measured; a second runtime being selected; any Deferred limit
acquiring evidence; a production canonicalizer existing; any request to close DG-4 or lift the
freeze.
