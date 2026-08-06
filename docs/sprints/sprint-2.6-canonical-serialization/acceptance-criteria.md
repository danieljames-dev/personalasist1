# Sprint 2.6 Acceptance Criteria

Status: **Accepted** by Founder/CTO on 2026-08-06  
Scope: Architecture documentation only  
Gate: Canonicalization-design approval. **Closes DG-2.** Not implementation readiness, and
not closure of DG-1, DG-3, or DG-4.  
Decision record: [CTO-DECISION-003](../../decisions/CTO-DECISION-003-canonical-serialization.md)

## Deliverable completeness

- [x] All seven directive documents exist at the exact required paths.
- [x] ADR-008 remains Proposed until explicit CTO approval.
- [x] No canonicalizer, encoder, parser, validator, fixture, schema file, test, or runtime
  dependency was generated.
- [x] No production TypeScript was modified.

## Responsibility and boundaries

- [x] Canonical serialization has exactly one responsibility: a deterministic,
  language-neutral byte representation for contract values.
- [x] It is explicitly not a storage format, transport mandate, presentation format,
  compression format, encryption format, object mapper, or schema replacement.
- [x] It provides no authenticity, confidentiality, trust, authorization, or freshness, and
  says so.
- [x] The Universal Object Model is not modified to fit the serialization format.

## Design coverage

- [x] All forty required design questions are answered normatively, not deferred by
  restating the question.
- [x] The value domain is closed: every admitted kind is listed and everything else is
  rejected.
- [x] Object member ordering is specified as UTF-16 code unit ordering, distinguished from
  code-point and locale ordering.
- [x] Array order is semantic and never reordered by the canonicalizer.
- [x] Numeric rules eliminate ambiguity rather than deferring it to the encoder.
- [x] Null and absent are distinct, and a schema may not use both for one meaning.
- [x] Timestamps have exactly one representation per instant.
- [x] Whitespace, escaping, newline, and trailing-byte behaviour are fully determined.
- [x] Canonicalizer limits are distinguished from DG-4 business limits, with a stated
  ordering between them.
- [x] Streaming feasibility is answered honestly, including where it is not achievable.

## Alternatives

- [x] All six required alternatives are evaluated: RFC 8785 JCS, deterministic CBOR, a
  constrained AION JSON profile, schema-specific encoders, canonical protobuf-style
  encoding, and not standardizing yet.
- [x] Each is judged on language neutrality, implementation availability, ambiguity,
  numeric behaviour, Unicode behaviour, security, streaming, schema evolution, debugging,
  adoption cost, and long-term survivability.
- [x] The selection rests on evidence, not popularity.
- [x] "Do not standardize yet" is genuinely evaluated rather than dismissed.

## Integrity and agility

- [x] Domain separation is mandatory and unambiguously framed.
- [x] Contract family, schema identity, and schema version bind into the digest input.
- [x] The digest descriptor names canonicalization profile, algorithm, digest value,
  contract family, contract and schema version, and optional domain context.
- [x] `sha-256` is the initial registered algorithm, not a contract constant.
- [x] Unknown profile or algorithm identifiers fail closed.
- [x] Profile migration is defined and does not change Object revision.
- [x] The signature boundary is stated without designing signatures.

## Security

- [x] All eighteen required threat categories are analysed with a named control.
- [x] Controls the profile cannot provide — notably Unicode confusables — are declared out
  of reach rather than claimed.
- [x] Rejection is deterministic and error messages do not echo input content.
- [x] Residual risks are recorded explicitly.

## Fixtures

- [x] All fifteen fixture classes are defined.
- [x] Each future fixture is required to carry source value, expected canonical bytes,
  expected digest, expected validation outcome, applicable versions, and rationale.
- [x] Rejection fixtures are mandatory, not optional.
- [x] No fixture is generated in this sprint.

## Readiness blockers B-1, B-2, B-3

- [x] **B-1** — the binary-float prohibition is recorded as a deliberate architectural
  decision, scoped to canonical integrity positions, with domain, transport, storage, and
  canonical contexts distinguished; no universal decimal representation is selected; and a
  mandatory continuous-quantity review trigger with nine required evidence items exists.
- [x] **B-2** — `CanonicalContractValidatorV1` is defined with its responsibility, seven
  requirements, canonicalizer prohibitions, and the normative processing sequence; NFC is
  described as a specified control dependent on that boundary, not an implemented one.
- [x] **B-3** — delimiter-only framing is replaced by injective length-prefixed AION Frame
  v1, with all thirteen framing specification items resolved, an injectivity argument that
  does not depend on field content, and adversarial examples.

## Relationship to ADR-007

- [x] The accepted Object architecture is preserved; the Universal Object Model is not
  modified to accommodate a numeric encoding.
- [x] The Universal Object Contract is not designated stable v1.
- [x] DG-2 closes on ADR-008 acceptance.
- [x] DG-3 is unblocked for design and fixture authoring only, not implementation.
- [x] DG-1 and DG-4 remain open.
- [x] Every place the serialization rules constrain the Object contract is recorded
  explicitly, with its cost, rather than absorbed silently.

## Approval result

Sprint 2.6 passes only when the CTO accepts every criterion or records explicit exceptions
with owner, rationale, risk, and review trigger.

**Recorded result — 2026-08-06.** The Founder/CTO approved ADR-008 subject to three
mandatory corrections. All three were applied and re-reviewed; the readiness review returns
APPROVE. Every criterion above is accepted. ADR-008 is Accepted, DG-2 is closed, DG-3 is
unblocked for design and fixture authoring only, and the Universal Object Contract remains
pre-stable. The implementation freeze remains in effect. No fixture, canonicalizer,
validator, or production code was produced. See
[CTO-DECISION-003](../../decisions/CTO-DECISION-003-canonical-serialization.md).
