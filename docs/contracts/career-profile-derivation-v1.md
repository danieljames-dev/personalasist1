# CareerProfile Derivation Contract v1

Status: Sprint 3 Phase 7 reference contract

An explicit `buildCareerProfileV1` request selects typed CareerFact IDs, an Owner/Actor, required
fact types, a versioned configuration, and either a new profile or an existing profile with its
expected revision. The operation loads only those selected facts from the injected Object
repository. Owner mismatch, missing facts, malformed state, and stale revisions fail closed.

The closed `CareerProfilePayloadV1` records build operation/configuration versions, processing
outcome, sorted compact fact-state summaries, and sorted missing fact types. Each fact summary
preserves fact ID/revision, type, confidence, verification/assertion/conflict status, and
supersession status. It does not contain prose biography, matching/scoring fields, job-posting
fields, drafting content, or relationship descriptors.

Current facts are included; superseded facts are excluded by default. Missing required types are
reported rather than invented. Conflicting facts remain visible with no silent winner.
Owner-confirmed, extracted, inferred, and missing states stay distinct.

`aion.relationship.career.profile-contains-fact.v1` RelationshipObjects are the sole membership
truth. A rebuilt profile ends removed membership relationships and reopens or creates requested
memberships with immutable revision history. Repeating the same operation and fact/configuration
selection is deterministic and reports already completed. Profile updates require exact
expected-revision protection.
