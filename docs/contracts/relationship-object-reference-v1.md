# RelationshipObject Reference v1

Status: **Pre-stable Phase 5 reference boundary**

Authority: ADR-007 and the Object Relationship Contract

Canonical edge truth: **RelationshipObject only**

## Closed data

RelationshipObject uses the accepted Relationship profile and records only:

- relationship contract version `1`;
- one closed namespaced relationship kind;
- immutable source and target references containing Object ID, Object type, schema ID, and schema
  version;
- canonical effective start and optional end timestamps; and
- a closed empty attributes object in Phase 5.

Ownership, Actor attribution, lifecycle, revision, provenance, and integrity remain in the accepted
Object envelope. Endpoint entity payloads contain no relationship arrays, relationship IDs, or
duplicated edge fields.

## Allowed combinations

| Relationship kind | Source | Target |
|---|---|---|
| `aion.relationship.career.fact-derived-from-source.v1` | CareerFactObject | CareerSourceObject |
| `aion.relationship.career.profile-contains-fact.v1` | CareerProfileObject | CareerFactObject |
| `aion.relationship.career.profile-references-fact.v1` | CareerProfileObject | CareerFactObject |
| `aion.relationship.career.match-evaluates-posting.v1` | JobMatchReportObject | JobPostingObject |
| `aion.relationship.career.match-uses-profile.v1` | JobMatchReportObject | CareerProfileObject |
| `aion.relationship.career.draft-derived-from-match.v1` | ApplicationDraftObject | JobMatchReportObject |
| `aion.relationship.career.draft-supported-by-fact.v1` | ApplicationDraftObject | CareerFactObject |

No other relationship kind or endpoint pairing is registered. Creation loads both endpoints,
requires the exact registered families, rejects missing, unavailable, reversed, wrong-owner, and
self endpoints, then persists a separate RelationshipObject. Relationship kind and endpoints
remain immutable across revisions; a revision may close the effective interval and make an allowed
non-destructive lifecycle transition with expected-revision protection.

The Phase 5 repository prevents duplicate Object identity and same-revision installation. Broader
graph cardinality and semantic duplicate constraints require future descriptor/query architecture
and are not claimed here. Relationships are references, not access decisions, and no query,
permission, authentication, or authorization API is supplied.
