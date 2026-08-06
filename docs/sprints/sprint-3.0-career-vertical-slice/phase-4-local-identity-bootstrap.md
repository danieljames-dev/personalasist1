# Sprint 3.0 Phase 4: local Identity bootstrap

Status: Implemented; pending Founder/CTO review
Directive: `AION-S3-P4-LOCAL-IDENTITY-BOOTSTRAP`

Phase 4 implements only the minimum local single-owner reference bootstrap authorized by the
permanent Sprint 3 directive and ADR-006. The `@aion/identity` workspace defines four distinct
opaque identifier types, lifecycle and provenance contracts, the local state contract, the three
required relationships, and injected clock, generator, and repository ports.

The filesystem adapter stores canonical state only at the explicitly approved ignored
`private/identity/identity-state-v1.json` path. It reuses the Phase 3 privacy boundary, takes an
exclusive initialization lock, flushes a complete same-directory temporary file, and installs it
without overwrite. Valid state makes repeat initialization read-only. Invalid or conflicting state
fails before identifier generation.

The composition CLI implements only initialize, status, and export. Status is redacted; export is
explicit, private-root bounded, exact, atomic, and local-only. No operation runs automatically.

This phase does not create Universal Objects or full Identity Entity Objects. It introduces no
authentication, authorization, credentials, profiles, personal data, career behavior, network,
telemetry, database, vector store, or later-phase implementation. Phase 5 remains unauthorized.

DG-1 history is preserved and split into DG-1a (this local reference bootstrap) and DG-1b (secure
external access and authentication). DG-1a remains open pending completion and CTO acceptance of
the real initialization, idempotence, export, backup-exclusion, and isolated-restore evidence.
DG-1b remains open.
