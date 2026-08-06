# Sprint 2.7 Specification: Contract Fixture Corpus

Status: **Accepted** — architecture only, 2026-08-06  
Implementation freeze: **Active**  
Normative fixtures: **Not authorized** — seven-condition gate,
[fixture contract §11.1](../../contracts/contract-fixture-corpus.md#111-normative-fixture-authorization-gate)  
Owner: CTO  
Targets gate: DG-3 — **architecture only. DG-3 remains open.**  
Decision records: [CTO-DECISION-004](../../decisions/CTO-DECISION-004-sprint-2.7-authorization.md),
[CTO-DECISION-005](../../decisions/CTO-DECISION-005-fixture-corpus-architecture.md)

## Mission

Define the fixture schema, corpus organization, fixture lifecycle, negative-test structure,
and evidence requirements needed to satisfy DG-3 — without creating a single fixture.

## Problem

ACJ-1 §40 states fixtures are the only proof of conformance, and the Universal Object
Contract's stability gate requires representative fixtures before stable v1. Nothing exists:
no fixture, no loader, no harness, no second implementation.

Authoring fixtures before their schema exists means re-authoring them afterwards — and a
regenerated fixture's expected value *is* the definition of correctness, so regeneration
bugs are undetectable without an independent cross-check. Specification precedes corpus for
the same reason DG-2 preceded DG-3.

## Sprint outcome

An approved fixture record schema, corpus organization, identifier and versioning model,
timestamp-precision rules, coverage matrix, threat analysis, and cross-runtime evidence
contract — sufficient to author the first normative fixtures without redesigning any of it.

**No fixture, loader, harness, schema file, test, or runtime dependency is delivered.**

## Responsibility

The fixture corpus provides stable, versioned, language-neutral evidence that independent
AION implementations interpret, validate, canonicalize, frame, and digest contract values
identically.

It is **not** production data, a database, an object store, a transport format, a logging
format, a snapshot of private owner data, an implementation test framework, a replacement
for schemas, proof that an implementation is secure, or proof that an implementation is
authorized for production.

## Deliverables

- `docs/decisions/ADR-009-contract-fixture-corpus.md` — Proposed
- `docs/decisions/CTO-DECISION-004-sprint-2.7-authorization.md`
- `docs/contracts/contract-fixture-corpus.md`
- `docs/security/contract-fixture-corpus-threat-model.md`
- `docs/sprints/sprint-2.7-fixture-corpus/specification.md`
- `docs/sprints/sprint-2.7-fixture-corpus/acceptance-criteria.md`
- `docs/sprints/sprint-2.7-fixture-corpus/risks.md`
- `docs/reviews/contract-fixture-corpus-readiness-review.md`

## Data prohibition

**All fixture content is synthetic or intentionally approved non-sensitive material.** No
fixture may contain personal data copied from the Founder, email, laptop, private GitHub
content, résumé, phone, calendar, or any connected source. This is a hard prohibition with
**no exception path**. No personal-data ingestion and no job-search integration is authorized
by this sprint or any artifact within it.

## Stage model

Seven stages, defined in
[contract-fixture-corpus.md §2](../../contracts/contract-fixture-corpus.md#2-processing-stages):

| Stage | Scope |
|---|---|
| S0 | Raw input bytes — encoding, JSON syntax, duplicate members, escapes, BOM, trailing content, number syntax, raw size |
| S1 | Parsed contract value — schema/profile resolution, value types, members, identifier and timestamp syntax, numeric and Unicode constraints |
| S2 | Canonical validation — `CanonicalContractValidatorV1` outcomes and ACJ-1 §33 categories |
| S3 | Canonical serialization — exact canonical bytes |
| S4 | AION Frame v1 construction — exact framed bytes and field boundaries |
| S5 | Digest calculation — exact digest under a registered algorithm |
| S6 | Cross-runtime conformance — **reserved**; no harness exists or is authorized |

Every fixture declares `entryStage`, `targetStage`, and `terminalStage`, with
`entryStage ≤ targetStage ≤ terminalStage`. A rejection fixture must not require outputs from
stages it never reaches, and rejecting *earlier* than declared is a conformance failure.

## Raw bytes versus structured values

Two entry points only. **Entry-B (S0)** is mandatory wherever a parsed host-language value
destroys the fact under test — duplicate members being decisive, since JS objects and Python
dicts silently collapse them, so a parsed value is not evidence for ACJ-1 §19. **Entry-V
(S2)** covers cases fully expressible after parsing. Any case JSON cannot represent
unambiguously must be Entry-B. A fixture declares exactly one authoritative artifact.

## Fixture classes

Acceptance, rejection, boundary, equivalence, non-equivalence, migration,
parser-differential, profile-version, algorithm-agility, adversarial.

Rejection fixtures are **first-class**. An acceptance-only corpus is insufficient: an
over-permissive implementation passes every positive fixture while accepting invalid input.
A release where any coverage area lacks a rejection fixture is incomplete.

## Byte evidence

Inline lowercase hexadecimal in `HexBytesV1` (`hex`, `length`, `checksum`). **Sidecars are
prohibited** — verified in this repository, Git destroys `CR` bytes in any sidecar silently.
base64url is prohibited for byte evidence because its decode is non-injective. The
`checksum` is a corpus integrity checksum and is deliberately **not** an ACJ-1 digest, since
digesting bare canonical bytes is an ACJ-1 §23 contract violation.

## Timestamp rules — NB-7

Recorded per CTO-DECISION-004 and
[ACJ-1 §14](../../contracts/canonical-serialization.md#14-timestamps), **before any timestamp
fixture is authored**.

Canonical timestamps keep exactly three fractional digits. Higher-precision sources are
converted explicitly, intentionally, potentially lossily, **before** canonical validation,
and **never** by the canonicalizer. Excess digits are **truncated, never rounded**;
truncation must not move the instant forward; the conversion boundary declares precision was
lost; original precision is retained through provenance where material;
`CanonicalContractValidatorV1` **rejects** canonical-position values with excess digits.

**Truncation floors toward negative infinity, not toward zero.** ACJ-1 §14 permits four-digit
years, so pre-epoch instants are representable, and truncating toward zero on a negative
epoch offset moves the instant **forward** — the outcome the decision prohibits. The two
coincide only at or after the epoch.

Required future fixture categories: exact three-digit precision; higher-precision source
converted before validation; explicit precision-loss declaration; truncation rather than
rounding; no forward movement, **including at least one pre-epoch case**; rejection of excess
precision at S2; rejection of prohibited offset and syntax forms; retention of original
precision through provenance.

The corpus schema distinguishes source timestamp, transformed canonical contract timestamp,
conversion rule, whether precision was lost, original precision, and expected validator
result. `precisionLoss` carries source and canonical instants as exact integers so a harness
asserts `canonicalInstant ≤ sourceInstant` directly.

**No timestamp fixture is generated.**

## Required coverage matrix

The future normative corpus must cover all forty areas below. Each is mapped to its stage
and the classes that must exist for it. **Areas marked BLOCKED cannot be authored yet** —
they depend on a gate that is still open, and authoring them now would bake in a guess.

| # | Coverage area | Stage | Required classes |
|---:|---|---|---|
| 1 | Minimal Object envelope | S2–S5 | acceptance |
| 2 | Every approved Object profile | S2–S5 | acceptance |
| 3 | Every identifier kind | S1–S2 | acceptance, rejection |
| 4 | Every lifecycle state | S2 | acceptance |
| 5 | Every valid lifecycle transition category | S2 | acceptance |
| 6 | Relationship Object | S2–S5 | acceptance |
| 7 | Relationship endpoint references | S2 | acceptance, rejection |
| 8 | Provenance record | S2–S3 | acceptance |
| 9 | Version transition | S2–S5 | acceptance |
| 10 | Unicode edge cases | S0–S3 | acceptance, rejection, boundary |
| 11 | NFC rejection | S0/S2 | rejection |
| 12 | Numeric boundaries ±(2^53−1) | S1–S3 | boundary, rejection |
| 13 | Prohibited binary floats | S0/S2 | rejection |
| 14 | Null versus absent | S2–S5 | non-equivalence |
| 15 | Timestamp normalization and precision | S1–S3 | acceptance, rejection, boundary |
| 16 | Unknown members | S2–S3 | acceptance |
| 17 | Duplicate members | **S0 only** | rejection, parser-differential |
| 18 | Invalid identifiers | S1–S2 | rejection |
| 19 | Wrong-kind identifiers | S2 | rejection |
| 20 | Invalid frame field lengths | S4 | rejection |
| 21 | Truncated frame | S4 | rejection |
| 22 | Trailing frame bytes | S4 | rejection |
| 23 | Domain-purpose separation | S4–S5 | non-equivalence |
| 24 | Empty versus omitted context | S4–S5 | non-equivalence |
| 25 | Maximum-depth rejection | S0–S2 | rejection, boundary |
| 26 | Maximum-member rejection | S0–S2 | boundary — **BLOCKED on DG-4** |
| 27 | Algorithm/profile migration metadata | S5 | migration |
| 28 | Schema-version migration | S2 | migration |
| 29 | Semantic equality | S3 | equivalence |
| 30 | Semantic non-equivalence | S3–S5 | non-equivalence |
| 31 | Parser differential cases | **S0 only** | parser-differential |
| 32 | Digest mismatch | S5 | adversarial |
| 33 | Fixture checksum mismatch | loader | adversarial |
| 34 | Unsupported profile | S1 | profile-version |
| 35 | Unsupported framing version | S4 | rejection |
| 36 | Unsupported digest algorithm | S5 | algorithm-agility |
| 37 | Invalid decimal / scaled-integer | S1–S2 | rejection — **BLOCKED on the decimal decision** |
| 38 | Superseded fixture handling | loader | adversarial |
| 39 | Illustrative fixture rejected by conformance tools | loader | adversarial |
| 40 | Cross-runtime byte agreement | S6 | **BLOCKED — no second runtime selected** |

Three areas are blocked and two more (25, 26) depend on limits ACJ-1 marks provisional.
**A corpus claiming complete coverage before those gates close would be false.**

## Corpus organization

Fixture-ID-major: one self-contained directory per fixture, path a pure function of the ID,
exactly one normative file. Class, stage, and coverage area are manifest metadata, never
directory structure. Artifact-kind layout is rejected — it scatters one assertion across six
diffs.

The manifest is normative and enumerates every fixture. **Harnesses must not discover
fixtures by globbing**; a globbing harness silently loses a deleted or misnamed fixture and
reports green.

**No corpus directory is created by this sprint.**

## Non-vacuity

`node --test` with zero matching files exits 0. Every conformance run must assert that
executed-count equals the pinned manifest's count, that it exceeds zero, that per-class and
per-rule ratchet floors are met, and that every rejection fixture rejected at exactly its
declared stage. A run that cannot establish these is a failure, not a pass.

## Cross-runtime evidence contract

Two genuinely independent implementations; neither using the other as encoder, oracle, or
reference, verified by dependency inspection; exact canonical-byte, framed-byte, and digest
agreement; matching rejection stage and error category; corpus pinned by version and
checksum; reproducible on a clean environment; evidence machine- and human-readable;
comparison **on bytes, not text**.

**No second runtime is selected. No harness is designed or implemented beyond this contract.**

## DG-3 closure conditions

DG-3 **remains open**. Fixture specification alone does not close it. Closure requires all
of: fixture schema accepted; ADR-009 accepted; required initial corpus created; positive and
negative cases present; timestamp precision decision reflected; canonical, framed, and digest
expectations recorded; cross-runtime conformance demonstrated; release manifest produced;
artifacts checksummed; corpus security review passed; no private data or secrets present;
`npm run verify` and future corpus checks pass; Object Contract stability gate requirements
satisfied.

## Non-goals

- Creating the first ten normative fixtures, or any fixture.
- Implementing a canonicalizer, validator, digest, framing, loader, or conformance harness.
- Production TypeScript or Python.
- Identity, Object, Memory, Planner, Event Bus, Knowledge Graph, Capability Registry,
  Workflow Engine, plugin, agent, persistence, or UI implementation.
- Data ingestion, job searching, job applications, or external service integration.
- Selecting storage, database, transport, or a second runtime.
- Closing DG-1, DG-3, or DG-4.
- Designating the Universal Object Contract stable v1.

## Approval boundary

Approval would authorize the fixture contract, corpus organization, and the subordinate
decisions in ADR-009. It would **not** authorize any fixture, any implementation, or DG-3
closure, and would not lift the implementation freeze. ADR-009 remains **Proposed**.
