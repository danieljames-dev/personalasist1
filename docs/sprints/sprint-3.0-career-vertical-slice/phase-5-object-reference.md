# Sprint 3.0 Phase 5: Object Reference Slice

Status: Implemented; pending Founder/CTO review

Directives: `AION-S3-P5-OBJECT-REFERENCE`, `AION-S3-P5B-OBJECT-SLICE-COMPLETION`

Decisions: [CTO-DECISION-009](../../decisions/CTO-DECISION-009-phase-4-approval-and-object-reference.md),
[CTO-DECISION-010](../../decisions/CTO-DECISION-010-phase-5-completion.md)

The accepted first Phase 5 increment supplied the generic `@aion/object` envelope, ACJ-1 integrity,
DG-4a processing limits, injected ports, and immutable in-memory revisions. Its initial review was
APPROVE WITH CHANGES because the earlier authorization omitted permanent Phase 5 requirements.

The completion increment adds exactly seven registered families: CareerSourceObject,
CareerFactObject, CareerProfileObject, JobPostingObject, JobMatchReportObject,
ApplicationDraftObject, and RelationshipObject. The six entity payloads are closed empty objects;
detailed career fields are deferred. No résumé, employment, preferences, posting content, matching
content, application content, personal profile, or owner data exists.

RelationshipObject is the sole persisted edge truth. Its closed v1 boundary admits only the seven
approved directed family combinations. Creation loads and validates both endpoints, ownership,
availability, direction, family tuple, and self-edge prohibition. Relationship identity, kind, and
endpoints remain immutable across expected-revision updates. Entity payloads contain no edge arrays.

The public operation surface is limited to explicit initial creation, expected-revision entity
append, relationship create/append, and current/historical load. It exposes no patch callback,
delete, query, search, indexing, permission, event, planner, or synchronization API.

The bounded filesystem reference adapter requires an explicit absolute `private/object-store` root,
reuses the Phase 3 privacy boundary, derives a non-reversible safe path key, stores exact ACJ-1 full
envelopes, and installs each immutable revision through a flushed same-directory temporary file and
no-overwrite hard link. Loads verify bytes, integrity, schema, path identity, continuity, immutable
fields, lifecycle, and provenance. Synthetic tests demonstrate one-winner creation/append,
corruption rejection, traversal rejection, link/junction containment, and failure cleanup.

No real Object was initialized and no permanent `private/object-store` record exists. The adapter is
replaceable reference evidence, not a production storage decision. The Universal Object Contract
remains Pre-stable; DG-3 and DG-4b remain Open; normative fixtures and Phase 6 remain unauthorized.

Final command counts, Git/push state, backup checksum, and isolated-restore proof are recorded in the
ignored local Phase 5 completion handoff after all gates pass.
