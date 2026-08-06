# CareerFact Contract v1

Status: Sprint 3 Phase 7 reference contract

`CareerFactPayloadV1` is the closed non-empty payload accepted only for the Phase 7
`CareerFactObject` registration. It contains a typed fact/source Object reference, fact type,
normalized value state, exact source location, confidence, owner-confirmed boolean, status,
extraction method and parser, creation timestamp, conflict state, and supersession state.

## Evidence states

- `owner-confirmed` requires the explicit Phase 6 owner marker, a non-missing value,
  `owner-asserted` confidence, and `structured-owner-input`. Extraction never upgrades a claim to
  owner-confirmed.
- `extracted` means a deterministic structural projection from an explicit structured field. It
  is unverified and uses `deterministic-extraction` confidence.
- `inferred` is valid only with an explicit accepted deterministic rule ID and
  `deterministic-inference` confidence. The Phase 7 production importer runs no inference rule;
  the type preserves the distinction for compatible evidence.
- `missing` represents explicit `unknown` or `not-applicable`, never a guessed value.
- verification (`unverified` or `verified`) is independent of assertion and conflict status.

Structured extraction emits the entry's primary fact plus explicit start/end dates and each
responsibility, accomplishment, skill, and tool item. JSON Pointer identifies the exact field or
array element. Values are never synthesized from prose. There is no LLM or external model.

## Conflicts and supersession

Conflict recording is an explicit expected-revision operation over at least two facts of the same
type. Every fact remains present with its original value and provenance. Each receives the same
stable group ID, peer fact IDs, field locations, and `conflicting` status; there is no winner and
owner-confirmed is evaluated independently.

Supersession is a separate explicit expected-revision operation identifying one prior fact and one
same-type replacement fact. It appends a revision only to the prior fact, recording replacement ID
and time. The prior revision and replacement provenance remain immutable. It is not conflict
resolution and no unrestricted patch/delete API exists.

Relationships are not embedded in this payload. A
`aion.relationship.career.fact-derived-from-source.v1` RelationshipObject is the sole edge truth
between every imported fact and its source.
