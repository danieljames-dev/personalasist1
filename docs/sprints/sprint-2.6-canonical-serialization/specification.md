# Sprint 2.6 Specification: Canonical Serialization

Status: **Accepted** — architecture only, 2026-08-06  
Implementation freeze: **Active**  
Owner: CTO  
Closes gate: DG-2 in the
[Sprint 2.5 acceptance criteria](../sprint-2.5/acceptance-criteria.md)  
Unblocks: DG-3 for design and fixture authoring only  
Decision record: [CTO-DECISION-003](../../decisions/CTO-DECISION-003-canonical-serialization.md)

## Mission

Specify one deterministic, language-neutral byte representation for AION contract values,
sufficient to unblock integrity digests, portable fixtures, export verification, and
cross-runtime conformance — without implementing a canonicalizer.

## Problem

Every Object carries a mandatory `integrity` descriptor whose digest is computed over
canonical committed content. No canonical form exists, so no digest is reproducible, no
fixture can carry an expected hash, no export can be independently verified, and no second
runtime can be shown to agree with the first.

DG-2 blocks DG-3, and DG-3 gates designation of the Universal Object Contract as stable v1.
This is the narrowest unblocked dependency on that path.

## Sprint outcome

An approved canonicalization profile, digest-descriptor design, threat model, and fixture
plan sufficient to author DG-3 fixtures without redesigning the Object contract.

No canonicalizer, encoder, schema file, fixture, test, or runtime dependency is delivered.

## Responsibility

Canonical serialization defines a deterministic byte representation for contract values
where exact equality, hashing, signing, integrity verification, portable fixtures, export,
or cross-runtime conformance requires one.

It is **not** a database storage format, an API transport mandate, a human presentation
format, a compression format, an encryption format, a general-purpose object mapper, or a
replacement for versioned schemas.

## Deliverables

- `docs/decisions/ADR-008-canonical-serialization.md`
- `docs/contracts/canonical-serialization.md`
- `docs/security/canonical-serialization-threat-model.md`
- `docs/sprints/sprint-2.6-canonical-serialization/specification.md`
- `docs/sprints/sprint-2.6-canonical-serialization/acceptance-criteria.md`
- `docs/sprints/sprint-2.6-canonical-serialization/risks.md`
- `docs/reviews/canonical-serialization-readiness-review.md`

## Required design coverage

The contract must resolve all forty directive questions. Grouped by where they are
answered in [canonical-serialization.md](../../contracts/canonical-serialization.md):

| Group | Questions | Section |
|---|---|---|
| Value domain | 1 | §1 |
| Ordering | 2, 3 | §2–§3 |
| Text | 4, 5, 25, 26, 27 | §4–§5, §25–§27 |
| Numbers | 6, 7, 8, 9, 10, 11 | §6–§11 |
| Presence and truth | 12, 13 | §12–§13 |
| Time | 14, 15 | §14–§15 |
| Identity and binary | 16, 17 | §16–§17 |
| Members | 18, 19, 20 | §18–§20 |
| Validation boundary | — | §0 |
| Binding and framing | 21, 22, 23, 24 | §21–§24 |
| Bytes and limits | 28, 29, 30, 31, 32 | §28–§32 |
| Behaviour | 33, 34, 35, 36 | §33–§36 |
| Agility and evidence | 37, 38, 39, 40 | §37–§40 |

## Alternatives requiring evaluation

RFC 8785 JCS; deterministic CBOR; a constrained AION JSON profile; schema-specific
canonical encoders; canonical protocol-buffer-style encoding; and not standardizing
serialization yet.

Each is judged on language neutrality, implementation availability, ambiguity, numeric
behaviour, Unicode behaviour, security, streaming, schema evolution, debugging, adoption
cost, and long-term survivability. Popularity is not a criterion.

## Security requirements

The threat model covers parser differentials, duplicate keys, Unicode confusables,
normalization mismatch, numeric ambiguity, hash confusion, cross-protocol attacks,
domain-label omission, algorithm downgrade, signature wrapping, canonicalization denial of
service, excessive nesting, oversized values, malicious fixtures, ambiguous timestamp
interpretation, schema substitution, version confusion, and digest comparison timing.

It must state plainly that canonical serialization provides no authenticity,
confidentiality, trust, authorization, or freshness.

## Relationship to ADR-007

The accepted Object architecture is preserved. The Universal Object Model is **not**
modified to fit a serialization format. The integrity descriptor is refined to reference
canonicalization profile, digest algorithm, digest value, contract family, contract and
schema version, and optional domain-separation context.

`sha-256` is not hardcoded as the only future algorithm. The Object Contract is not
designated stable v1. DG-2 stays open until ADR-008 is accepted and its evidence exists;
DG-3 fixtures stay blocked until canonicalization is sufficiently specified.

Where the serialization rules constrain the Object contract — notably the prohibition on
binary floats in canonical positions — the constraint is recorded and decided explicitly
rather than absorbed silently. That decision is
[CTO-DECISION-003](../../decisions/CTO-DECISION-003-canonical-serialization.md), which
scopes the prohibition to the canonical integrity context only, leaves domain, transport,
and storage representations unconstrained, defers the universal decimal choice, and
attaches a mandatory review trigger at the first continuous-quantity schema.

## Fixture plan

Defined here, **not implemented in this sprint**. Fifteen required classes:

| # | Class | Must demonstrate |
|---:|---|---|
| 1 | Minimal Object envelope | Smallest conforming Entity; every mandatory field present |
| 2 | Every Object profile | Entity, Relationship, Version, Event — including non-recursion |
| 3 | Every identifier kind | `ObjectId`, `OwnerIdV1`, `ActorIdV1`, namespaced type and relationship identifiers |
| 4 | Every lifecycle status | Created, Validated, Active, Archived, Deprecated, Deleted, Destroyed |
| 5 | Relationship Object | Both endpoints, effective interval, bounded attributes |
| 6 | Provenance record | Every origin category; the confidence representation chosen under §9 |
| 7 | Version transition | Revision *n* to *n+1* with before and after integrity descriptors |
| 8 | Unicode edge cases | NFC vs NFD rejection, astral-plane key ordering, escaping, lone-surrogate rejection |
| 9 | Numeric boundaries | ±(2^53−1), out-of-range rejection, `-0` rejection, float rejection, decimal forms |
| 10 | Null versus absent | Distinct digests for omitted and explicitly-null members |
| 11 | Timestamp normalization | Fixed three-digit precision; offset, precision, and leap-second rejection |
| 12 | Unknown fields | Preserved, canonicalized, digest-covered, never interpreted |
| 13 | Invalid duplicate members | Rejected — not last-wins, not merged |
| 14 | Maximum-depth rejection | Deterministic rejection at the §29 boundary |
| 15 | Algorithm and profile migration | Both descriptors retained; historical verification still possible |

Every future fixture carries: the source contract value; the expected canonical byte
representation; the expected digest under at least one approved algorithm; the expected
validation outcome; the applicable contract and profile version; and a rationale.

Rejection fixtures are mandatory. A set testing only acceptance cannot detect an
over-permissive implementation.

## Non-goals

- Implementing a canonicalizer, encoder, parser, or validator.
- Generating fixtures.
- Implementing signing, key management, or a trust root.
- Selecting storage, transport, compression, or encryption.
- Implementing Object, Identity, Memory, Planner, Event Bus, Knowledge Graph, Capability
  Registry, Workflow, plugins, agents, or adapters.
- Closing DG-2, DG-3, or DG-4.
- Designating the Universal Object Contract stable v1.

## Approval boundary

Approval would authorize the canonicalization contract, its fixture plan, and the
subordinate decisions named in ADR-008. It would not authorize production code and would
not lift the implementation freeze. ADR-008 remains Proposed pending Founder/CTO approval.
