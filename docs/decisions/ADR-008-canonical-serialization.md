# ADR-008: Canonical serialization

- Status: Accepted
- Date: 2026-08-06
- Accepted: 2026-08-06
- Decision owner: CTO
- Decision record: [CTO-DECISION-003](CTO-DECISION-003-canonical-serialization.md)
- Implementation status: **Bounded Phase 5 reference implemented.** Cross-runtime conformance and
  normative fixtures remain absent; the freeze remains outside
  [CTO-DECISION-009](CTO-DECISION-009-phase-4-approval-and-object-reference.md).
- Closes gate: DG-2 in the
  [Sprint 2.5 acceptance criteria](../sprints/sprint-2.5/acceptance-criteria.md)
- Unblocks: DG-3 for design and fixture authoring only, not implementation
- Depends on: [ADR-007](ADR-007-universal-object-model.md) (Accepted)
- Contract stability: ACJ-1 is the approved profile; the Universal Object Contract remains
  **pre-stable**

## Context

Every Object carries a mandatory `integrity` descriptor — a digest over its canonical
committed content. That descriptor is meaningless until one deterministic byte
representation exists: two conforming implementations must produce byte-identical output
for the same logical value, or the same content yields different digests and integrity
verification becomes noise.

This blocks more than integrity. DG-3 fixtures cannot carry expected digests, export
manifests cannot be independently verified, migration cannot prove content was preserved,
and no second runtime can be shown to agree with the first. Canonical serialization is
the narrowest unblocked dependency on the critical path to a stable Object contract.

The prior design fixed `algorithm: "sha-256"` in the contract type. The Architecture
Readiness Review rejected that as conflating hash agility with contract major version,
and separately warned that a digest is not authenticity.

## Decision

AION adopts the **AION Canonical JSON Profile (ACJ-1)**: a strict subset of
[RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785) in which
the *value domain* is constrained so that JCS's encoding rules are exact rather than
merely deterministic.

The full rules are in [canonical-serialization.md](../contracts/canonical-serialization.md).
The load-bearing decisions:

1. **Subset, not variant.** Any ACJ-1 output is valid JCS output. A stock JCS
   implementation produces correct ACJ-1 bytes for any value that satisfies the ACJ-1
   value domain. We do not fork the algorithm; we restrict what may enter it.

2. **No binary floating point in canonical positions — a deliberate contract decision.**
   JCS serialises numbers through IEEE 754 double semantics. That is deterministic but
   *lossy*: integers above 2^53 silently lose precision, and `0.1 + 0.2` is not `0.3`.
   Silent precision loss inside an integrity mechanism is unacceptable, so ACJ-1 forbids
   binary floats in canonical positions.

   This constraint would apply to **any** format chosen for integrity purposes; it is not
   an artefact of choosing JSON. It is scoped to the canonical integrity context and does
   not restrict domain, transport, or storage representations. Continuous quantities
   remain expressible in AION, exactly and versioned. No universal decimal representation
   is selected — that choice is deferred until real domain evidence exists — and a
   mandatory review trigger fires at the first schema modelling a continuous quantity.
   See [contract §8](../contracts/canonical-serialization.md#8-floating-point).

3. **An explicit pre-canonicalization validation boundary.**
   `CanonicalContractValidatorV1` is a named, language-neutral responsibility that runs
   before canonicalization, fails closed, returns stable non-enumerating error codes, and
   never silently rewrites an invalid value. It verifies NFC; canonicalization never
   normalizes, coerces, repairs, or reorders. The canonicalizer accepts only values
   already validated against a named schema and profile.

   At ADR acceptance the boundary was **specified, not implemented**. Phase 5 later implemented it
   only for the bounded Object reference; controls elsewhere remain specified. See
   [contract §0](../contracts/canonical-serialization.md#0-validation-boundary--canonicalcontractvalidatorv1).

4. **Domain separation by injective length-prefixed framing.** A digest or signature is
   computed over an **AION Frame v1**: seven length-prefixed fields — frame version,
   purpose, profile, contract family, contract version, context, and canonical payload.

   Delimiter-only framing is rejected. Its safety depended on a separator byte never
   occurring inside a field, which rests on a grammar that can later be widened and fails
   silently when it is. Length-prefixed framing is injective **regardless of field
   content**: decoding is a deterministic left inverse of encoding, so distinct field
   tuples cannot collide. See
   [contract §23](../contracts/canonical-serialization.md#23-domain-separation--aion-frame-v1).

5. **Algorithm and profile are both versioned and replaceable.** The integrity descriptor
   names the canonicalization profile *and* the digest algorithm. Neither is fixed by the
   Object contract. Migration between profiles is a defined operation, not a rebuild.

6. **Canonical serialization provides integrity evidence only.** It provides no
   authenticity, confidentiality, trust, authorization, or freshness. Signature design is
   a separate future decision; ACJ-1 defines only the bytes a signature would cover.

## Scope

Canonical serialization applies where exact equality, hashing, signing, integrity
verification, portable fixtures, export, or cross-runtime conformance is required.

It is **not** a database storage format, an API transport mandate, a human presentation
format, a compression format, an encryption format, a general-purpose object mapper, or a
replacement for versioned schemas. Storage engines and transports remain free to use any
representation, provided the canonical form is reproducible on demand.

## Alternatives considered

### RFC 8785 JCS, unconstrained

Rejected as a whole, adopted as a base. Mature, specified, multiple implementations,
human-readable, debuggable. But its numeric model is IEEE 754 double: integers beyond
2^53 truncate silently and decimal fractions are approximations. Inside an integrity
mechanism, silent lossiness is the one property we cannot accept. Constraining the value
domain keeps every benefit and removes the defect.

### Deterministic CBOR (RFC 8949 §4.2)

Rejected, with genuine regret. Technically superior on several axes: exact big integers,
native byte strings without base64 inflation, compact output, good streaming. Rejected
because it is opaque to inspection — a corrupted fixture cannot be read by eye or diffed
in review — the deterministic profile has more than one interpretation in the wild
(canonical CBOR versus core deterministic encoding), and the debugging cost compounds over
a ten-year horizon where most canonicalization work will be forensic. Reconsider if
payload size or streaming becomes a measured constraint.

### Unconstrained AION JSON profile

Rejected. Writing our own canonicalization from scratch means owning every edge case that
JCS has already litigated — escaping, code-unit ordering, lone surrogates — with no
external implementations to cross-check against. ACJ-1 is deliberately a *subset* so that
independent JCS implementations serve as the cross-check.

### Schema-specific canonical encoders

Rejected. One encoder per type multiplies the bug surface by the number of types, and the
purpose of the exercise is a single rule that every type obeys. It also makes
cross-runtime conformance N problems instead of one.

### Canonical protocol-buffer-style encoding

Rejected. Protobuf explicitly does not guarantee deterministic serialization across
implementations or library versions; field ordering and unknown-field handling are
implementation-defined. A format whose own specification declines to promise determinism
cannot underpin an integrity contract.

### Do not standardize serialization yet

Rejected, but it is the strongest challenger and the readiness review examines it
seriously. Deferral costs nothing today because nothing is implemented. It is rejected
because DG-2 blocks DG-3, DG-3 gates contract stability, and every artifact authored
before the rule exists must be re-authored afterwards. Deferring does not avoid the work;
it duplicates it.

## Consequences

### Benefits

- Digests become reproducible across languages and runtimes.
- DG-3 fixtures can carry expected canonical bytes and expected digests.
- Export manifests become independently verifiable without the original vendor.
- Existing JCS implementations can be used and cross-checked against.
- Canonical output stays human-readable, so failures are diagnosable.

### Costs

- **Domain schemas may not use binary floats in canonical positions.** This is a real
  constraint on future type data, deliberately accepted. Provenance `confidence` — a
  number in 0..1 — must become a scaled integer or a bounded decimal string, and so must
  money, probability, measurement, score, geographic coordinate, scientific value, and
  statistical output. The cost lands on every schema author, not only on one field, and
  the review trigger in contract §8 is the mechanism for re-testing it against reality.
- A wrong declared scale or ambiguous rounding rule produces wrong data that
  canonicalizes perfectly. The format removes encoding ambiguity, never modelling error.
- `CanonicalContractValidatorV1` must exist before any string can be accepted as a
  contract value. It does not exist, so NFC and several threat-model controls are
  specified rather than active.
- Framing adds 32 bytes of fixed length-prefix overhead per digest input — six `u32`
  textual-field lengths (24 bytes) plus one `u64` payload length (8 bytes). Negligible, and
  the price of injectivity that does not depend on field content.
- Base64url encoding of binary inflates payloads by roughly one third; large artifacts
  must stay out of canonical envelopes and use content-addressed references.
- Profile migration re-canonicalizes and re-digests every retained Object, Version, Event,
  and export. Retained descriptors avoid an eager sweep for verification, but any
  operation needing a uniform current profile pays the full cost.

### Constraints

- ACJ-1 output must remain valid JCS output. A change that breaks that relationship
  requires a new profile, not an amendment.
- The Object contract must not be modified to suit the serialization format. Where the two
  are in tension, the tension is recorded and decided explicitly.
- No digest algorithm is permanent. `sha-256` is the initial registered algorithm, not a
  contract constant.

## Relationship to ADR-007

ADR-007 is unchanged by this decision. The Object integrity descriptor is refined, not
redefined: it references canonicalization profile, digest algorithm, digest value,
contract family, contract and schema version, and an optional domain-separation context.

ADR-007 already required contract values to be "deterministic, finite, JSON-compatible."
ACJ-1 makes that requirement precise rather than adding a new one. The float prohibition
is the one place where precision narrows what was previously ambiguous, and it is recorded
as an open question for the readiness review rather than assumed benign.

The Universal Object Contract remains **pre-stable**. DG-2 remains open until this ADR is
accepted *and* the required evidence exists. DG-3 fixtures remain blocked until
canonicalization is sufficiently specified to compute an expected digest.

## Required subordinate decisions

None of these are closed by acceptance of this ADR.

1. **Exact decimal representation** — scaled integer versus bounded decimal string versus a
   versioned exact-decimal contract type, decided against real Memory, Invoice, and
   Memory-confidence data at the contract §8 review trigger.
2. **Registered digest algorithm set** and the process for adding or retiring one.
3. **Signature and trust architecture**, including key rotation against retained digests.
   Constrained in advance: a signature covers the AION Frame, never raw bytes.
4. **Algorithm retirement over immutable records** — Version and Event Objects cannot be
   re-digested without violating an ADR-007 invariant, and Destroyed content cannot be
   re-digested at all. Retirement policy must state what happens to each.
5. **Canonicalizer limits versus DG-4 business limits.** The stated invariant is that DG-4
   limits must be less than or equal to the §29–§31 canonicalizer limits; the specific
   values remain provisional pending DG-4 measurement.
6. **Constant-time comparison boundaries** — whether required everywhere or only where an
   untrusted party influences input and observes the outcome.

Implementing `CanonicalContractValidatorV1` is not a subordinate decision; it is implementation.
CTO-DECISION-009 authorizes it only inside the bounded Phase 5 Object reference.

## Review triggers

- **The first production or candidate domain schema modelling a continuous quantity** —
  money, probability, measurement, score, geographic coordinate, scientific value, or
  statistical output. The schema owner supplies the nine evidence items in contract §8
  before approval, and that review re-tests the float constraint against reality.
- Measured payload size or streaming cost makes deterministic CBOR the better trade.
- A JCS implementation divergence is discovered that the subset does not exclude.
- A digest algorithm in the registry is weakened or withdrawn.
- Cross-runtime fixtures fail to agree byte-for-byte.
- A proposal to widen the framing identifier grammar beyond ASCII.

## Approval effect

Acceptance is an **architecture-boundary decision only**.

### Acceptance authorizes

- canonical serialization architecture;
- language-neutral contract definitions;
- canonicalization profile registration rules;
- future representative fixtures;
- future conformance tests;
- future reference test adapters;
- subordinate design ADRs.

### Acceptance does NOT authorize

- production implementation of any kind;
- a canonicalizer, parser, encoder, or validator implementation;
- generating fixtures;
- Identity, Object, Memory, Planner, Event Bus, Knowledge Graph, Capability Registry,
  Workflow Engine, plugin, agent, persistence, or UI implementation;
- storage, transport, compression, or encryption selection;
- signing or key-management infrastructure.

At acceptance the implementation freeze remained in effect. DG-2 closed and DG-3 became unblocked
for design only. CTO-DECISION-009 later authorized only the bounded Phase 5 implementation; DG-3
remains Open and the Universal Object Contract remains Pre-stable.
