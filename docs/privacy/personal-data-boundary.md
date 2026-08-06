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
model providers, databases, vector stores, Identity, Objects, career ingestion, and Phase 4 remain
unimplemented and unauthorized.
