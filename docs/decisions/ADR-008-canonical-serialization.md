# ADR-008: Canonical serialization

- Status: Proposed
- Date: 2026-08-06
- Decision owner: CTO
- Implementation status: Frozen
- Opens gate: DG-2 in the
  [Sprint 2.5 acceptance criteria](../sprints/sprint-2.5/acceptance-criteria.md)
- Depends on: [ADR-007](ADR-007-universal-object-model.md) (Accepted)

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

2. **No binary floating point in canonical positions.** JCS serialises numbers through
   IEEE 754 double semantics. That is deterministic but *lossy*: integers above 2^53
   silently lose precision, and `0.1 + 0.2` is not `0.3`. Rather than accept silent
   corruption inside an integrity mechanism, ACJ-1 forbids floats. Numbers are integers
   in the exactly-representable range; decimals and large integers are strings with
   declared scale and radix. The ambiguity is removed from the value domain instead of
   being papered over in the encoder.

3. **Unicode normalization happens at validation, not canonicalization.** JCS does not
   normalize, and adding normalization would fork it. ACJ-1 requires all strings to be
   NFC-normalized *before* they become contract values, and rejects non-NFC input at the
   validation boundary. Canonicalization then stays a pure function of already-normalized
   input.

4. **Domain separation is mandatory.** A digest is computed over
   `domain-label ‖ profile-id ‖ canonical-bytes`, never over bare content. This prevents
   a digest computed for one purpose from being accepted for another.

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
  constraint on future type data, not a formality. Provenance `confidence`, currently
  described as a number in 0..1, must become a scaled integer or a decimal string.
- Large integers and decimals become strings, so schemas must declare scale and radix and
  validators must enforce them.
- An NFC normalization rule must exist at the validation boundary before any string is
  accepted as a contract value.
- Base64url encoding of binary inflates payloads by roughly one third; large artifacts
  must stay out of canonical envelopes and use content-addressed references.

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

1. Registered digest algorithm set and the process for adding or retiring one.
2. Signature and trust design, including what a signature covers and how key rotation
   interacts with retained digests.
3. NFC normalization enforcement point and rejection behaviour in the validation contract.
4. Decimal representation: declared-scale integer string versus arbitrary-precision
   decimal string, decided against real Memory and Invoice data.
5. Canonicalizer resource limits versus DG-4 business limits, and which bounds which.

## Review triggers

- A domain demonstrates a canonical value it cannot represent without binary floats.
- Measured payload size or streaming cost makes deterministic CBOR the better trade.
- A JCS implementation divergence is discovered that the subset does not exclude.
- A digest algorithm in the registry is weakened or withdrawn.
- Cross-runtime fixtures fail to agree byte-for-byte.

## Approval effect

Acceptance would authorize the canonical serialization contract, its fixture plan, and
subordinate decisions above. It would **not** authorize implementation of a canonicalizer,
production code, storage selection, or signing infrastructure, and it would not lift the
implementation freeze.

ADR-008 remains **Proposed** pending Founder/CTO approval.
