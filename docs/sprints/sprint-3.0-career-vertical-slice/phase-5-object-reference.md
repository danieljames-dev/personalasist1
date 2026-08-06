# Sprint 3.0 Phase 5: Minimum Universal Object Reference

Status: Implemented; pending Founder/CTO review
Directive: `AION-S3-P5-OBJECT-REFERENCE`
Decision: [CTO-DECISION-009](../../decisions/CTO-DECISION-009-phase-4-approval-and-object-reference.md)

Phase 5 adds `@aion/object`, the smallest domain-neutral Object reference needed before any later
career-domain work can be considered. It supplies typed references, a closed mutable-profile
envelope, deterministic injected construction, schema-registry validation, ACJ-1 canonicalization,
AION Frame v1 SHA-256 integrity, exact DG-4a limits, and a revision-preserving in-memory repository
adapter with fail-closed optimistic concurrency.

No real Object was initialized and no filesystem Object adapter exists. Tests use only synthetic
opaque Identity references and process-local Object values. The package neither reads nor changes
the ignored real Identity state.

This phase contains no career Object type or schema, personal data, import/ingestion, matching,
application drafting, authentication, authorization, permissions, networking, telemetry, database,
vector store, Event Bus, Planner, Memory, or Capability Registry behavior. It does not implement or
prepare Phase 6.

The Universal Object Contract remains Pre-stable. DG-3 and DG-4b remain Open. Normative fixtures
remain unauthorized. Version/Event Object aggregate materialization, durable outbox semantics,
export/import, migration, ownership transfer, delete/destroy, persistent storage, and production
workload claims remain future decisions.

## Verification evidence

- Aggregate product verification: 80 passed, 0 failed, 0 skipped.
- Object verification: 36 passed, 0 failed, 0 skipped.
- Focused Object suites: unit 10, canonical 6, repository 7, resource limits 9, architecture 4.
- Identity regression: 32 passed, 0 failed, 0 skipped.
- Control-plane regression: 22 passed, 0 failed.
- Collection regression: 8 passed, 0 failed.
- Privacy-boundary regression: 15 passed, 0 failed, 1 truthful Windows `EPERM` skip for
  unavailable file-symlink construction.
- Backup-reference regression, backup dry run, and all 11 PowerShell syntax checks: passed.

The separate real-repository gate, normal push, durable backup, and isolated restore are completion
gates and are recorded in the local handoff after they succeed.
