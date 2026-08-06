# Sprint 3.0 Phase 7: Career Evidence Catalogue and Profile

Status: Implementation complete; awaiting CTO review
Directive: `AION-S3-P7-CAREER-EVIDENCE-PROFILE`

## Delivered boundary

Phase 7 adds `@aion/career-evidence` with closed versioned CareerSource, CareerFact, and
CareerProfile payloads; explicit dry-run/import/profile-build/conflict/supersession operations; a
schema registry layered on the accepted Phase 5 family registry; deterministic ID derivation and
structured extraction; exact source provenance; and retry-aware use of the accepted bounded Object
repository.

Structured career-facts input creates exact fact candidates for primary value, dates, and explicit
arrays. Career preferences, Markdown, and text are catalogue-only. The implementation runs no LLM,
model, network, telemetry, archive reader, directory scanner, database, vector store, job search,
matching, scoring, ranking, drafting, authentication, or authorization behavior.

Conflict recording preserves competing same-type facts. Supersession preserves prior revisions and
replacement provenance. Profiles preserve owner-confirmed, extracted, inferred, missing,
verification, conflict, confidence, and supersession distinctions. RelationshipObjects remain the
sole provenance/membership edge truth.

## Persistence and proof

The multi-Object sequence is deliberately not described as database-atomic. Durable
pending/partial/success source and profile revisions plus deterministic IDs make retries explicit
and duplicate-safe; success is written last. Tests cover injected failure, reload, corruption,
stale revisions, missing completed evidence, path escape, and the accepted repository's immutable
atomic revision installation.

All demonstrations use neutral synthetic temporary input and temporary Object stores. No
permanent career Object or private career file is created. Real Identity state is neither read by
the package nor modified. Private state remains ignored and excluded from source backups.

## Governance

Phase 6 approval is recorded by CTO-DECISION-012. Phase 7 does not close DG-3 or DG-4b, authorize
normative fixtures, designate the Object Contract Stable, or authorize Phase 8. The AI-assistant
archive remains unapproved for access.
