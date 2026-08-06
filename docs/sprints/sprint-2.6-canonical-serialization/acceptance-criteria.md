# Sprint 2.6 Acceptance Criteria

Status: **Proposed**  
Scope: Architecture documentation only  
Gate: Canonicalization-design approval. Not implementation readiness, and not closure of
DG-2, DG-3, or DG-4.

## Deliverable completeness

- [ ] All seven directive documents exist at the exact required paths.
- [ ] ADR-008 remains Proposed until explicit CTO approval.
- [ ] No canonicalizer, encoder, parser, validator, fixture, schema file, test, or runtime
  dependency was generated.
- [ ] No production TypeScript was modified.

## Responsibility and boundaries

- [ ] Canonical serialization has exactly one responsibility: a deterministic,
  language-neutral byte representation for contract values.
- [ ] It is explicitly not a storage format, transport mandate, presentation format,
  compression format, encryption format, object mapper, or schema replacement.
- [ ] It provides no authenticity, confidentiality, trust, authorization, or freshness, and
  says so.
- [ ] The Universal Object Model is not modified to fit the serialization format.

## Design coverage

- [ ] All forty required design questions are answered normatively, not deferred by
  restating the question.
- [ ] The value domain is closed: every admitted kind is listed and everything else is
  rejected.
- [ ] Object member ordering is specified as UTF-16 code unit ordering, distinguished from
  code-point and locale ordering.
- [ ] Array order is semantic and never reordered by the canonicalizer.
- [ ] Numeric rules eliminate ambiguity rather than deferring it to the encoder.
- [ ] Null and absent are distinct, and a schema may not use both for one meaning.
- [ ] Timestamps have exactly one representation per instant.
- [ ] Whitespace, escaping, newline, and trailing-byte behaviour are fully determined.
- [ ] Canonicalizer limits are distinguished from DG-4 business limits, with a stated
  ordering between them.
- [ ] Streaming feasibility is answered honestly, including where it is not achievable.

## Alternatives

- [ ] All six required alternatives are evaluated: RFC 8785 JCS, deterministic CBOR, a
  constrained AION JSON profile, schema-specific encoders, canonical protobuf-style
  encoding, and not standardizing yet.
- [ ] Each is judged on language neutrality, implementation availability, ambiguity,
  numeric behaviour, Unicode behaviour, security, streaming, schema evolution, debugging,
  adoption cost, and long-term survivability.
- [ ] The selection rests on evidence, not popularity.
- [ ] "Do not standardize yet" is genuinely evaluated rather than dismissed.

## Integrity and agility

- [ ] Domain separation is mandatory and unambiguously framed.
- [ ] Contract family, schema identity, and schema version bind into the digest input.
- [ ] The digest descriptor names canonicalization profile, algorithm, digest value,
  contract family, contract and schema version, and optional domain context.
- [ ] `sha-256` is the initial registered algorithm, not a contract constant.
- [ ] Unknown profile or algorithm identifiers fail closed.
- [ ] Profile migration is defined and does not change Object revision.
- [ ] The signature boundary is stated without designing signatures.

## Security

- [ ] All eighteen required threat categories are analysed with a named control.
- [ ] Controls the profile cannot provide — notably Unicode confusables — are declared out
  of reach rather than claimed.
- [ ] Rejection is deterministic and error messages do not echo input content.
- [ ] Residual risks are recorded explicitly.

## Fixtures

- [ ] All fifteen fixture classes are defined.
- [ ] Each future fixture is required to carry source value, expected canonical bytes,
  expected digest, expected validation outcome, applicable versions, and rationale.
- [ ] Rejection fixtures are mandatory, not optional.
- [ ] No fixture is generated in this sprint.

## Relationship to ADR-007

- [ ] The accepted Object architecture is preserved.
- [ ] The Universal Object Contract is not designated stable v1.
- [ ] DG-2 remains open pending ADR-008 acceptance and evidence.
- [ ] DG-3 remains blocked.
- [ ] Every place the serialization rules constrain the Object contract is recorded
  explicitly, with its cost, rather than absorbed silently.

## Approval result

Sprint 2.6 passes only when the CTO accepts every criterion or records explicit exceptions
with owner, rationale, risk, and review trigger. Passing does not authorize implementation,
does not close any deferred gate, and does not designate any contract stable.
