# Deterministic Job Posting Import Reference

Status: Sprint 3 Phase 8 reference implementation

`@aion/job-posting` composes Phase 3 approved-root/reparse controls, Phase 6 preflight and Job
Posting input validation, Phase 7's composed schema registry, and the accepted bounded Object
repository. Production operations accept one explicit root and one explicit file path. They do not
discover roots, enumerate directories, scan the computer, infer a home folder, or follow a source
reference.

The preparation sequence runs preflight, reauthorizes and rechecks the resolved path, performs one
bounded read, compares the byte count with preflight, computes SHA-256 over those exact bytes,
decodes strict UTF-8, selects the versioned parser from the explicit source type, and constructs the
closed payload. JSON uses direct field projection. Markdown/text preserve the exact body only in
description and mark every other field `not-supplied`.

Create Object identity is a domain-separated deterministic UUIDv4 derived from the explicit
operation ID and typed owner. A retry compares all request-bound payload content while retaining
the winning injected import timestamp. Reusing an operation ID with changed source bytes, path,
field values, or currentness evidence rejects. Explicit revision targets an existing JobPosting
Object and expected revision; an exact post-commit retry is recognized without appending again.

There is one Object commit and no multi-Object transaction. The existing repository provides
immutable revision files, canonical validation, integrity verification, atomic temporary-file
installation, no-overwrite links, and expected-revision conflict handling. Consequently a failed
install cannot leave a partially accepted Job Posting. Filesystem link-swap and directory-durability
risks remain those of the accepted Phase 3/Phase 5 reference adapters. The implementation is a
bounded reference candidate, not a production datastore or DG-4b workload claim.
