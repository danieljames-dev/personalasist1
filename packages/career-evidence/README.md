# @aion/career-evidence

Sprint 3 Phase 7 reference package for deterministic, local career evidence cataloguing and
evidence-backed profile construction. It composes the Phase 6 explicit preflight, accepted Identity
reference types, and the Phase 5 bounded Object repository and RelationshipObject operations.

Imports are explicit and never automatic. Structured career-facts JSON may create CareerFactObjects;
career-preferences JSON, Markdown, and text create source catalogue records only. Unstructured prose
is never semantically extracted or summarized. Dry run performs no repository write.

Multi-Object filesystem commits are not database transactions. A deterministic source or profile
Object is first persisted with a resumable processing outcome, each planned Object and relationship
has a deterministic identity, and a final revision records completion. Retrying the same operation
verifies and reuses exact prior work; conflicts fail closed and valid history is never deleted.

The package has no CLI, Identity persistence, job-posting import, matching, drafting, Planner,
Memory, model, network, telemetry, database, vector store, archive, backup, or control-plane
behavior. Tests use only neutral synthetic temporary inputs, Identity references, and repositories.
Phase 8 remains unauthorized.
