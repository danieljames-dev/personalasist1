# Personal data boundary

Status: Sprint 3.0 Phase 3 reference boundary.

Owner data belongs only beneath the local `private/` tree. That tree is ignored by Git and
forbidden from source-code/documentation backups. The initial layout is `career/input`,
`career/workspace`, `career/exports`, `career/quarantine`, `config`, `logs`, and `tmp`. It contains
no tracked placeholders. Phase 3 created only empty local directories and accessed no owner data.

Every future access must name both an approved root and an explicit absolute path. The boundary
does not infer a home directory, Desktop, Documents, Downloads, drives, or candidate files. It does
not enumerate directories unless a separately authorized caller supplies such an operation.

Ordinary errors expose a stable reason code, operation, approved-root reference, and generic
remediation only. They do not contain complete paths, file bodies, environment values, credentials,
or personal identifiers. Local operation records are private runtime data and must not be committed.

No data is sent externally. Network access, telemetry, analytics, browser launch, service SDKs,
model providers, databases, and vector stores remain absent. Sprint 3 Phase 4 composes this boundary
for local opaque Identity state and export paths; Phase 5 composes it for the bounded Object
filesystem reference; Phase 6 composes it for an explicitly selected career-input preflight; and
Phase 7 composes both boundaries for explicit catalogue dry-run/import and temporary synthetic
Object proof.
The privacy package has no Identity, Object, or career dependency. Phase 6 preflight returns no
content or complete path and performs no ingestion or persistence. No real owner career data was
read. Phase 7 reads no real owner data and creates no permanent career Object. Future real inputs
and Objects would remain under explicit ignored private roots and excluded from source backups.
Phase 8 composes the same boundaries for one explicit Job Posting path, dry run, and synthetic
temporary Object proof. It adds no directory discovery, source copy, network action, or real owner
ingestion. Any future real Job Posting input and Object remain beneath explicit ignored private
roots and excluded from source backups. Phase 9 remains unauthorized.
