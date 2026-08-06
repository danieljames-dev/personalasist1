# Sprint 2.7 Acceptance Criteria

Status: **Proposed**  
Scope: Architecture documentation only  
Gate: Fixture-corpus specification approval. **Does not close DG-3.**  
Authorization: [CTO-DECISION-004](../../decisions/CTO-DECISION-004-sprint-2.7-authorization.md)

## Deliverable completeness

- [ ] All eight directive documents exist at the exact required paths.
- [ ] ADR-009 is **Proposed** and was not changed to Accepted.
- [ ] No normative fixture was created.
- [ ] No canonicalizer, validator, digest, framing, loader, or conformance-harness
  implementation was created.
- [ ] No production TypeScript or Python was created or modified.
- [ ] No fixture corpus directory was created.
- [ ] No dependency was added or changed.

## Scope and prohibitions

- [ ] No personal-data ingestion, job search, job application, or external integration was
  performed or designed.
- [ ] No fixture content derives from the Founder's email, laptop, private GitHub content,
  résumé, phone, calendar, or any connected source.
- [ ] No storage, database, transport, vector store, or second runtime was selected.
- [ ] The implementation freeze remains active and is restated in every governing artifact.

## Fixture corpus responsibility

- [ ] The corpus has exactly one responsibility: evidence that independent implementations
  interpret, validate, canonicalize, frame, and digest identically.
- [ ] It is explicitly not production data, a database, an object store, a transport format,
  a logging format, a snapshot of private owner data, a test framework, a schema
  replacement, proof of security, or proof of production authorization.

## Stage model

- [ ] Stages S0 through S6 are defined with what each consumes, produces, and asserts.
- [ ] `entryStage`, `targetStage`, and `terminalStage` are defined with the invariant
  `entryStage ≤ targetStage ≤ terminalStage`.
- [ ] A rejection fixture cannot require outputs from stages it never reaches.
- [ ] Rejecting earlier than the declared stage is defined as a conformance failure.
- [ ] S6 is reserved; no harness is designed or implemented.

## Raw bytes versus structured values

- [ ] Two entry points are defined: Entry-B (S0, bytes authoritative) and Entry-V (S2,
  structured value authoritative).
- [ ] Duplicate members are routed to Entry-B, with the reason stated: host-language maps
  and dictionaries silently collapse duplicates, so a parsed value is not evidence.
- [ ] No host-language dictionary is treated as proof of original member uniqueness.
- [ ] The rule "any case JSON cannot represent unambiguously must be Entry-B" is normative.
- [ ] A fixture declares exactly one authoritative artifact.
- [ ] The corpus-format bootstrapping constraint is stated rather than hand-waved.

## Fixture classes

- [ ] All ten classes are defined with their purpose.
- [ ] Rejection fixtures are first-class, with rejection stage, stable expected error
  category, whether parsing must fail before schema resolution, forbidden output bytes, and
  the prohibition on producing a digest.
- [ ] A release where any coverage area lacks a rejection fixture is defined as incomplete.

## Fixture record

- [ ] A versioned, language-neutral fixture record is defined.
- [ ] Every candidate field is classified as always required, conditionally required (with
  its condition), prohibited (with when), or optional metadata.
- [ ] A record cannot claim both acceptance and rejection **structurally**, not by prose.
- [ ] A record cannot carry multiple conflicting expected outcomes.
- [ ] The structural argument does not depend on `CanonicalContractValidatorV1`, which is
  specified but unimplemented; the loader performs its own duplicate-key rejection.
- [ ] No machine-specific absolute paths appear anywhere.

## Byte evidence

- [ ] One normative representation is selected, with the four candidate options evaluated
  against all ten criteria.
- [ ] The Git line-ending finding is stated with reproducible evidence.
- [ ] Sidecar files are prohibited, and the consequences (path traversal, symlink and
  junction abuse, case collision, missing sidecars) are noted as unrepresentable.
- [ ] base64/base64url is excluded for byte evidence with the non-injectivity reason stated.
- [ ] Byte order, encoding, casing, padding, line wrapping, final newline, and empty-sequence
  handling are all specified.
- [ ] The corpus checksum is distinguished from an ACJ-1 digest, and the ACJ-1 §23 reason is
  stated.

## Identifiers and versioning

- [ ] Fixture identifiers are stable, bounded-semantic, unique, non-reusable, and independent
  of file paths, test-framework names, runtime language, and Git commit hashes.
- [ ] All seven version categories are defined and kept distinct.
- [ ] Rules exist for correcting, superseding, requiring a new ID, retaining regression
  evidence, promoting illustrative to normative, and paired migration fixtures.
- [ ] The effect of an `acj-1` → `acj-2` profile advance on an existing corpus is specified.
- [ ] Governance-controlled fields that could silently delete coverage are identified.

## Timestamp rules — NB-7

- [ ] The NB-7 resolution is recorded in a formal decision artifact **and** in the fixture
  specification, before any timestamp fixture is authored.
- [ ] Truncation, not rounding, is normative, with the reason stated.
- [ ] Truncation must not move the represented instant forward.
- [ ] The pre-epoch hazard is identified and floor-toward-negative-infinity is normative.
- [ ] Conversion occurs before canonical validation and never in the canonicalizer.
- [ ] The corpus schema distinguishes source timestamp, canonical timestamp, conversion rule,
  precision-loss flag, original precision, and expected validator result.
- [ ] At least one pre-epoch precision fixture is required by the coverage matrix.
- [ ] No timestamp fixture was generated.

## Coverage, organization, and non-vacuity

- [ ] All forty coverage areas are mapped to stage and required classes.
- [ ] Areas blocked by an open gate are marked BLOCKED rather than silently included.
- [ ] Corpus layout, manifest, ordering, duplicate-ID detection, completeness checks,
  releases, checksums, excluded private data, supersession, and offline verification are
  specified.
- [ ] Harnesses are prohibited from discovering fixtures by directory globbing.
- [ ] Non-vacuity is required: executed-count equals manifest-count, exceeds zero, meets
  ratchet floors, and every rejection fixture rejected at exactly its declared stage.
- [ ] `coversRules` anchors and monotonic non-decrease are required.
- [ ] Expected values carry provenance, and a value produced by the implementation under test
  is forbidden as its own expected value.

## Security

- [ ] All required threat categories are analysed with a named control.
- [ ] Each control is marked structural, specified, or process, and it is stated that none is
  implemented.
- [ ] It is stated plainly that the corpus does not prove implementation security,
  authorization, or replace threat modelling, independent implementations, or production
  monitoring.
- [ ] False confidence from one runtime testing itself is analysed explicitly.
- [ ] Text-versus-byte comparison is identified as a harness failure mode.

## Cross-runtime and DG-3

- [ ] All eleven cross-runtime evidence conditions are stated as testable conditions.
- [ ] No second runtime is selected.
- [ ] DG-3 closure conditions are defined and it is stated that specification alone does not
  close DG-3.
- [ ] DG-3 remains **open**.

## Consistency

- [ ] ADR-007 remains Accepted; ADR-008 remains Accepted.
- [ ] DG-2 remains closed; DG-4 remains open.
- [ ] The Universal Object Contract remains **Pre-stable**.
- [ ] The canonicalizer and `CanonicalContractValidatorV1` remain unimplemented.
- [ ] DG-4 limits are not treated as finalized; boundary fixtures depending on them are
  marked blocked.

## Approval result

Sprint 2.7 passes only when the CTO accepts every criterion or records explicit exceptions
with owner, rationale, risk, and review trigger.

**Not yet recorded.** ADR-009 remains Proposed. The readiness review returned
**APPROVE WITH CHANGES** with blocking findings that must be resolved before ADR-009 could
be accepted. Passing does not authorize implementation, does not create any fixture, and
does not close DG-3.
