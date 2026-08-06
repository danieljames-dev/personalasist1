# Sprint 2.7 Acceptance Criteria

Status: **Accepted** by Founder/CTO on 2026-08-06  
Scope: Architecture documentation only  
Gate: Fixture-corpus architecture approval. **Does not close DG-3 and does not authorize any
fixture.**  
Decision records: [CTO-DECISION-004](../../decisions/CTO-DECISION-004-sprint-2.7-authorization.md),
[CTO-DECISION-005](../../decisions/CTO-DECISION-005-fixture-corpus-architecture.md)

## Readiness blockers B-1, B-2, B-3

- [x] **B-1** — S0 conformance limited to rejection and stage; parser diagnostic categories
  explicitly non-normative; stable AION error codes begin at S2; S1 normative only where an
  accepted AION contract owns the semantics; inventing parser codes prohibited.
- [x] **B-2** — ADR-009 acceptance explicitly does not authorize normative fixtures; a
  seven-condition gate governs the first corpus; candidate and normative fixtures are formally
  distinguished; Sprint 2.8 prohibits authoring even candidates.
- [x] **B-3** — `expectedDigestInput` mandatory; `expectedDigest` representable only alongside
  it; eleven evidence items required; five artifacts given five never-interchanged names; a
  corpus checksum is never called a contract digest.

## Deliverable completeness

- [x] All eight directive documents exist at the exact required paths.
- [x] ADR-009 status changed only by explicit recorded CTO decision. It was Proposed at the
  close of Sprint 2.7 and became **Accepted** on 2026-08-06 via CTO-DECISION-005, after B-1,
  B-2, and B-3 were resolved.
- [x] No normative fixture was created.
- [x] No canonicalizer, validator, digest, framing, loader, or conformance-harness
  implementation was created.
- [x] No production TypeScript or Python was created or modified.
- [x] No fixture corpus directory was created.
- [x] No dependency was added or changed.

## Scope and prohibitions

- [x] No personal-data ingestion, job search, job application, or external integration was
  performed or designed.
- [x] No fixture content derives from the Founder's email, laptop, private GitHub content,
  résumé, phone, calendar, or any connected source.
- [x] No storage, database, transport, vector store, or second runtime was selected.
- [x] The implementation freeze remains active and is restated in every governing artifact.

## Fixture corpus responsibility

- [x] The corpus has exactly one responsibility: evidence that independent implementations
  interpret, validate, canonicalize, frame, and digest identically.
- [x] It is explicitly not production data, a database, an object store, a transport format,
  a logging format, a snapshot of private owner data, a test framework, a schema
  replacement, proof of security, or proof of production authorization.

## Stage model

- [x] Stages S0 through S6 are defined with what each consumes, produces, and asserts.
- [x] `entryStage`, `targetStage`, and `terminalStage` are defined with the invariant
  `entryStage ≤ targetStage ≤ terminalStage`.
- [x] A rejection fixture cannot require outputs from stages it never reaches.
- [x] Rejecting earlier than the declared stage is defined as a conformance failure.
- [x] S6 is reserved; no harness is designed or implemented.

## Raw bytes versus structured values

- [x] Two entry points are defined: Entry-B (S0, bytes authoritative) and Entry-V (S2,
  structured value authoritative).
- [x] Duplicate members are routed to Entry-B, with the reason stated: host-language maps
  and dictionaries silently collapse duplicates, so a parsed value is not evidence.
- [x] No host-language dictionary is treated as proof of original member uniqueness.
- [x] The rule "any case JSON cannot represent unambiguously must be Entry-B" is normative.
- [x] A fixture declares exactly one authoritative artifact.
- [x] The corpus-format bootstrapping constraint is stated rather than hand-waved.

## Fixture classes

- [x] All ten classes are defined with their purpose.
- [x] Rejection fixtures are first-class, with rejection stage, stable expected error
  category, whether parsing must fail before schema resolution, forbidden output bytes, and
  the prohibition on producing a digest.
- [x] A release where any coverage area lacks a rejection fixture is defined as incomplete.

## Fixture record

- [x] A versioned, language-neutral fixture record is defined.
- [x] Every candidate field is classified as always required, conditionally required (with
  its condition), prohibited (with when), or optional metadata.
- [x] A record cannot claim both acceptance and rejection **structurally**, not by prose.
- [x] A record cannot carry multiple conflicting expected outcomes.
- [x] The structural argument does not depend on `CanonicalContractValidatorV1`, which is
  specified but unimplemented; the loader performs its own duplicate-key rejection.
- [x] No machine-specific absolute paths appear anywhere.

## Byte evidence

- [x] One normative representation is selected, with the four candidate options evaluated
  against all ten criteria.
- [x] The Git line-ending finding is stated with reproducible evidence.
- [x] Sidecar files are prohibited, and the consequences (path traversal, symlink and
  junction abuse, case collision, missing sidecars) are noted as unrepresentable.
- [x] base64/base64url is excluded for byte evidence with the non-injectivity reason stated.
- [x] Byte order, encoding, casing, padding, line wrapping, final newline, and empty-sequence
  handling are all specified.
- [x] The corpus checksum is distinguished from an ACJ-1 digest, and the ACJ-1 §23 reason is
  stated.

## Identifiers and versioning

- [x] Fixture identifiers are stable, bounded-semantic, unique, non-reusable, and independent
  of file paths, test-framework names, runtime language, and Git commit hashes.
- [x] All seven version categories are defined and kept distinct.
- [x] Rules exist for correcting, superseding, requiring a new ID, retaining regression
  evidence, promoting illustrative to normative, and paired migration fixtures.
- [x] The effect of an `acj-1` → `acj-2` profile advance on an existing corpus is specified.
- [x] Governance-controlled fields that could silently delete coverage are identified.

## Timestamp rules — NB-7

- [x] The NB-7 resolution is recorded in a formal decision artifact **and** in the fixture
  specification, before any timestamp fixture is authored.
- [x] Truncation, not rounding, is normative, with the reason stated.
- [x] Truncation must not move the represented instant forward.
- [x] The pre-epoch hazard is identified and floor-toward-negative-infinity is normative.
- [x] Conversion occurs before canonical validation and never in the canonicalizer.
- [x] The corpus schema distinguishes source timestamp, canonical timestamp, conversion rule,
  precision-loss flag, original precision, and expected validator result.
- [x] At least one pre-epoch precision fixture is required by the coverage matrix.
- [x] No timestamp fixture was generated.

## Coverage, organization, and non-vacuity

- [x] All forty coverage areas are mapped to stage and required classes.
- [x] Areas blocked by an open gate are marked BLOCKED rather than silently included.
- [x] Corpus layout, manifest, ordering, duplicate-ID detection, completeness checks,
  releases, checksums, excluded private data, supersession, and offline verification are
  specified.
- [x] Harnesses are prohibited from discovering fixtures by directory globbing.
- [x] Non-vacuity is required: executed-count equals manifest-count, exceeds zero, meets
  ratchet floors, and every rejection fixture rejected at exactly its declared stage.
- [x] `coversRules` anchors and monotonic non-decrease are required.
- [x] Expected values carry provenance, and a value produced by the implementation under test
  is forbidden as its own expected value.

## Security

- [x] All required threat categories are analysed with a named control.
- [x] Each control is marked structural, specified, or process, and it is stated that none is
  implemented.
- [x] It is stated plainly that the corpus does not prove implementation security,
  authorization, or replace threat modelling, independent implementations, or production
  monitoring.
- [x] False confidence from one runtime testing itself is analysed explicitly.
- [x] Text-versus-byte comparison is identified as a harness failure mode.

## Cross-runtime and DG-3

- [x] All eleven cross-runtime evidence conditions are stated as testable conditions.
- [x] No second runtime is selected.
- [x] DG-3 closure conditions are defined and it is stated that specification alone does not
  close DG-3.
- [x] DG-3 remains **open**.

## Consistency

- [x] ADR-007 remains Accepted; ADR-008 remains Accepted.
- [x] DG-2 remains closed; DG-4 remains open.
- [x] The Universal Object Contract remains **Pre-stable**.
- [x] The canonicalizer and `CanonicalContractValidatorV1` remain unimplemented.
- [x] DG-4 limits are not treated as finalized; boundary fixtures depending on them are
  marked blocked.

## Approval result

Sprint 2.7 passes only when the CTO accepts every criterion or records explicit exceptions
with owner, rationale, risk, and review trigger.

**Recorded result — 2026-08-06.** The Founder/CTO resolved B-1, B-2, and B-3 by directive.
All three corrections were applied and re-reviewed across twenty dimensions; the readiness
review returns **APPROVE**. Every criterion above is accepted.

**ADR-009 is Accepted.** Normative fixtures remain **unauthorized** behind a seven-condition
gate. **DG-3 remains open.** DG-1 and DG-4 remain open. The Universal Object Contract remains
**pre-stable**. The implementation freeze remains in effect. No fixture, loader, harness, or
fixtures directory exists. See
[CTO-DECISION-005](../../decisions/CTO-DECISION-005-fixture-corpus-architecture.md).
