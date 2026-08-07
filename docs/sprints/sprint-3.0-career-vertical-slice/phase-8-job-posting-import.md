# Sprint 3.0 Phase 8: Explicit Job Posting Import

Status: Implementation complete; awaiting CTO review
Directive: `AION-S3-P8-JOB-POSTING-IMPORT`

## Delivered boundary

Phase 8 adds `@aion/job-posting`, a closed versioned JobPosting payload, a composed schema registry,
deterministic ID derivation, explicit dry run, atomic create, and expected-revision import. It accepts
only explicitly selected structured JSON, Markdown, or text beneath one approved root. Structured
JSON maps the accepted Phase 6 fields directly; Markdown/text place exact UTF-8 content only in
description and infer nothing from headings or prose.

Source provenance preserves exact digest, parser version, original filename, approved relative path,
injected import timestamp, and typed Owner/Actor references. Unknown and not-supplied remain distinct.
Source references are inert. Listing currentness defaults unknown and changes only through explicit
owner-observation evidence; URL, deadline, source reference, and import time never prove freshness.

Dry run writes nothing and exposes no source body or complete path. Explicit import creates exactly
one JobPostingObject or appends one explicitly revision-checked immutable revision. Deterministic
duplicate, retry, stale-revision, concurrency, and injected-failure behavior is tested. No
RelationshipObject, Identity state, CareerProfile, JobMatchReport, ApplicationDraft, source copy,
network action, model call, database, or vector store is created.

## Governance

Phase 7 approval is recorded by CTO-DECISION-013. Phase 8 uses only neutral synthetic temporary
inputs and repositories. No real Job Posting, real career data, real Identity value, or AI-assistant
archive was accessed. Phase 9 matching, scoring, ranking, and drafting remain absent and
unauthorized. DG-3 and DG-4b remain Open, normative fixtures remain unauthorized, and the Universal
Object Contract remains Pre-stable.
