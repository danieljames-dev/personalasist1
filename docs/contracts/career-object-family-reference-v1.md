# Career Object Family Reference v1

Status: **Pre-stable Phase 5 reference boundary**

Authority: Sprint 3 Phase 5 completion directive and ADR-007

Detailed career payload schemas: **Deferred and unauthorized**

## Purpose

This contract registers exactly the seven Object families required before career-domain payload
design may begin. Each uses the accepted Object envelope, typed Owner and Actor references,
lifecycle, immutable revision history, provenance, ACJ-1 integrity, and DG-4a limits.

| Family | Object type | Profile | Schema ID | Version | Phase 5 data |
|---|---|---|---|---|---|
| CareerSourceObject | `aion.career.source` | Entity | `aion.schema.career-source` | 1 | closed empty object |
| CareerFactObject | `aion.career.fact` | Entity | `aion.schema.career-fact` | 1 | closed empty object |
| CareerProfileObject | `aion.career.profile` | Entity | `aion.schema.career-profile` | 1 | closed empty object |
| JobPostingObject | `aion.career.job-posting` | Entity | `aion.schema.job-posting` | 1 | closed empty object |
| JobMatchReportObject | `aion.career.job-match-report` | Entity | `aion.schema.job-match-report` | 1 | closed empty object |
| ApplicationDraftObject | `aion.career.application-draft` | Entity | `aion.schema.application-draft` | 1 | closed empty object |
| RelationshipObject | `aion.object.relationship` | Relationship | `aion.schema.relationship` | 1 | closed relationship data |

The six career entity payloads accept no members. This is intentional: family identity and the
schema/profile boundary are implemented without inventing résumé, employment-history, preference,
posting, matching, or application fields. Any non-empty entity payload fails closed. Phase 6 must
receive separate authorization before defining career input or payload fields.

RelationshipObject is the only family with Phase 5 domain data. Its closed contract is defined in
[RelationshipObject Reference v1](relationship-object-reference-v1.md). Family identifiers are
code-owned registrations, never arbitrary user strings. No family identity, Object ID, Owner ID,
Actor ID, or relationship confers authentication, authorization, or a permission grant.

No real family Object is initialized by Phase 5. Test Objects use deterministic synthetic opaque
references and temporary repositories only.
