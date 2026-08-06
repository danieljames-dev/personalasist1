# Sprint 3.0 Phase 6: Career Input Contracts and Blank Templates

Status: Implemented; pending Founder/CTO review

Directive: `AION-S3-P6-CAREER-INPUT-CONTRACT`

Decision: [CTO-DECISION-011](../../decisions/CTO-DECISION-011-phase-5-approval-and-phase-6.md)

Phase 6 adds `@aion/career-input`, three closed versioned JSON input contracts, five neutral blank
templates, and a non-ingesting explicit-path preflight. It reuses the Phase 3 privacy boundary and
the accepted ACJ-1 parser and DG-4a raw-input limit from `@aion/object` without importing an Object
repository adapter or Identity persistence.

Preflight accepts one explicitly selected local `.json`, `.md`, or `.txt` regular file beneath an
explicitly selected approved root. It is strict UTF-8 only, rejects BOMs and NUL bytes, validates
JSON contracts, returns no content or full path, and performs no ingestion, persistence, Object
creation, inference, network action, or telemetry.

All tests use synthetic temporary input. No real owner career material or AI-assistant archive was
read, copied, generated, normalized, summarized, or persisted. No private career input or Object
state was initialized. Blank templates are non-normative authoring aids and contain no personal
profile data.

The Universal Object Contract remains Pre-stable. DG-3 and DG-4b remain Open; DG-1b remains Open.
Phase 7 and every later behavior remain unauthorized.
