# CTO-DECISION-004: Sprint 2.7 authorization and timestamp precision

- Status: Recorded
- Date: 2026-08-06
- Decision authority: Founder / CTO
- Subject: Sprint 2.7 fixture-corpus specification scope, and resolution of readiness
  finding NB-7 (timestamp precision)
- Supersedes: Nothing
- Related: [ADR-007](ADR-007-universal-object-model.md),
  [ADR-008](ADR-008-canonical-serialization.md),
  [ADR-009](ADR-009-contract-fixture-corpus.md) (Proposed),
  [CTO-DECISION-002](CTO-DECISION-002-sprint-2.5-approval.md),
  [CTO-DECISION-003](CTO-DECISION-003-canonical-serialization.md)

# Decision 1 — Sprint 2.7 authorization

Authorize an **architecture-only** Sprint 2.7 to define the fixture schema, corpus
organization, fixture lifecycle, negative-test structure, and evidence requirements needed
to satisfy DG-3.

## Authorized

- documentation;
- proposed ADRs;
- language-neutral fixture schemas;
- corpus organization specifications;
- fixture identifier rules;
- fixture metadata requirements;
- validation-stage definitions;
- security and threat analysis;
- readiness review;
- non-normative illustrative examples, clearly marked as such.

## Not authorized

- creation of the first ten normative fixtures;
- canonicalizer implementation;
- validator implementation;
- digest implementation;
- framing implementation;
- conformance-harness implementation;
- production TypeScript or Python;
- Identity, Object, or Memory implementation;
- data ingestion;
- job searching or job applications;
- external service integration;
- persistence or database selection;
- Event Bus, Planner, or Workflow Engine implementation.

**No personal-data ingestion is authorized. No job-search integration is authorized. No
production implementation is authorized.** The implementation freeze remains active.

ADR-009 opens and remains **Proposed**. This decision does not accept it.

# Decision 2 — NB-7 timestamp precision

Readiness finding NB-7 observed that the canonical timestamp representation asserts exactly
three fractional digits without stating what happens to a higher-precision source. Resolved
as follows.

## The rule

The accepted canonical timestamp representation **retains three fractional decimal digits**.
Syntax and UTC rules from
[canonical-serialization §14–§15](../contracts/canonical-serialization.md#14-timestamps)
are **unchanged**.

Higher-precision source timestamps are **not directly representable** in a canonical
timestamp position. Conversion from a higher-precision source is:

- explicit;
- intentional;
- potentially lossy;
- performed **before** canonical contract validation;
- **never** performed silently by the canonicalizer.

When a source timestamp contains precision beyond three digits:

1. Excess fractional digits are **truncated, never rounded.**
2. Truncation **must not move the represented instant forward.**
3. The conversion boundary **must declare that precision was lost.**
4. The original source representation and precision **must remain available through
   provenance** when operationally, legally, scientifically, or historically material.
5. The resulting three-digit canonical contract value is then validated normally.
6. `CanonicalContractValidatorV1` **rejects** canonical-position timestamp values containing
   excess fractional digits.
7. The canonicalizer **never** truncates, rounds, repairs, normalizes, or infers timestamp
   precision.

## Why truncation and not rounding

Rounding can move an instant **forward**, past an event that has not yet occurred. A
timestamp that advances under conversion can reorder a causal sequence, and in an audit or
legal context can assert that something happened later than it did.

Rounding is also not deterministic across runtimes without further specification: half-to-even
and half-away-from-zero are both defensible defaults, and two implementations choosing
differently would produce different digests from one source value — which is precisely the
class of divergence ACJ-1 exists to eliminate. Truncation has one behaviour in every runtime.

## Why the conversion sits before validation, not inside the canonicalizer

Placing it in the canonicalizer would make the canonicalizer a **repairing** component. Every
repair maps two distinct inputs to one output, which hides a producer bug and defeats the
digest. `2026-08-06T05:20:19.999999Z` and `2026-08-06T05:20:19.999000Z` are different source
values; a canonicalizer that silently collapsed them would report success while destroying the
distinction.

The validator rejects instead, which forces the producer to make the conversion — and the
declaration of loss — explicitly. This is the same shape as
[§15](../contracts/canonical-serialization.md#15-time-zone): a producer holding a local time
converts before the value becomes a contract value, and the original offset survives as a
separate declared field. Precision is handled identically.

## Effect on existing accepted contracts

None to syntax. §14 gains a subsection stating conversion semantics; §33's
`invalid-timestamp` category is clarified to cover excess fractional digits as a **rejection**,
never a truncation. No UTC rule, no digit count, and no `Z` requirement changed. The audit
found no direct contradiction requiring Founder/CTO review.

## Effect on the fixture corpus

Recorded in the fixture specification before any timestamp fixture is authored, per this
decision. The corpus schema must distinguish source timestamp, transformed canonical contract
timestamp, conversion rule, whether precision was lost, original precision, and expected
validator result. Required future fixture categories are enumerated in the
[Sprint 2.7 specification](../sprints/sprint-2.7-fixture-corpus/specification.md).

**No timestamp fixture is generated by this decision.**

# Authorization Boundary

## Authorized by this decision

Architecture and specification documents for the fixture corpus; the NB-7 timestamp
resolution recorded in contract, decision, and specification form; proposed ADR-009; a
readiness review.

## Not authorized by this decision

Any normative fixture; any implementation of canonicalizer, validator, digest, framing, or
conformance harness; any production code; any data ingestion; any external integration; any
storage, transport, or vendor selection; acceptance of ADR-009; closure of DG-3.

The implementation freeze remains in effect. No artifact produced under this decision lifts
it; only a separate recorded CTO decision can.

# Gate status after this decision

| Gate | Status |
|---|---|
| DG-1 Identity bootstrap | **Open** |
| DG-2 Canonical serialization | **Closed** (CTO-DECISION-003) |
| DG-3 Representative fixtures | **Open.** Specification authorized; corpus not created; closure conditions defined but unmet |
| DG-4 Measurable limits | **Open.** §29–§31 canonicalizer limits remain provisional |

The Universal Object Contract remains **pre-stable**. ADR-007 and ADR-008 remain Accepted.

# Verification Evidence

Recorded from actual command output.

```
$ npm run verify
# tests 11
# suites 1
# pass 11
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Production typecheck clean; test typecheck clean. No production source, dependency,
manifest, lockfile, or tooling changed. No normative fixture generated. No implementation
generated. No secrets, personal data, or machine-specific absolute paths in changed files.

## What this evidence does not establish

The passing suite covers the Kernel only. **No test exercises canonical serialization or any
fixture**, because neither a canonicalizer, a validator, nor a fixture exists, and none is
authorized. The repository has no linter, formatter, or documentation link checker, so no
configured check inspects the Markdown changed by this decision.

# Review Triggers

- The first continuous-quantity domain schema (carried from CTO-DECISION-003, still open).
- Any proposal to author a normative fixture before ADR-009 is accepted.
- Any proposal to treat an illustrative example as normative.
- DG-4 limits becoming measured, which unblocks boundary fixtures currently unauthorable.
- The decimal representation decision landing, which unblocks scaled-integer fixtures.
- A second runtime being selected, which activates the cross-runtime evidence contract.
- Any request to lift the implementation freeze or record DG-1, DG-3, or DG-4 as met.
