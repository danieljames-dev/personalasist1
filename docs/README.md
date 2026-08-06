# AION documentation

## AION v2 foundation

- [Dependency rules](architecture/dependency-rules.md)
- [Governance](../GOVERNANCE.md)
- [Licensing decision](governance/licensing.md)
- [Engineering templates](templates/feature-specification-template.md)

## Sprint 1

- [Kernel architecture](architecture/kernel.md)
- [ADR-001: Kernel lifecycle boundary](decisions/ADR-001-kernel-lifecycle-boundary.md)
- [ADR-002: TypeScript Kernel baseline](decisions/ADR-002-typescript-kernel-baseline.md)
- [ADR-003: Modular monolith workspaces](decisions/ADR-003-modular-monolith-workspaces.md)
- [ADR-004: Contract-first dependency policy](decisions/ADR-004-contract-first-dependency-policy.md)
- [ADR-005: Kernel v1 cleanup contract](decisions/ADR-005-kernel-v1-cleanup-contract.md)
- [Kernel v1 API](api/kernel-v1.md)
- [Sprint specification](sprints/sprint-1/specification.md)
- [Acceptance criteria](sprints/sprint-1/acceptance-criteria.md)

## Proposed next sprint

- [Identity specification](sprints/sprint-2-identity/specification.md)
- [Identity threat model](sprints/sprint-2-identity/threat-model.md)
- [Identity acceptance criteria](sprints/sprint-2-identity/acceptance-criteria.md)
- [ADR-006: Identity boundary](decisions/ADR-006-identity-boundary.md)

## Sprint 2.5: Universal Object Model

ADR-007 is **Accepted** (2026-08-06) as an architecture-boundary decision. The contract
family is normative but **pre-stable** — not designated stable v1. The implementation
freeze remains in effect; nothing below authorizes implementation. Four deferred gates
remain open: identity bootstrap, canonical serialization, representative fixtures, and
measurable limits.

### Decision and architecture

- [ADR-007: Universal Object Model](decisions/ADR-007-universal-object-model.md) — Accepted
- [CTO-DECISION-002: Sprint 2.5 approval](decisions/CTO-DECISION-002-sprint-2.5-approval.md)
- [Object Model architecture](architecture/object-model.md)

### Normative contracts

- [Universal Object Contract v1](contracts/object-contract-v1.md)
- [Object Lifecycle Contract](contracts/object-lifecycle.md)
- [Object Event Contract](contracts/object-events.md)
- [Object Relationship Contract](contracts/object-relationships.md)
- [Object Versioning Contract](contracts/object-versioning.md)

### Security and sprint records

- [Universal Object Model Threat Model](security/object-threat-model.md)
- [Sprint specification](sprints/sprint-2.5/specification.md)
- [Acceptance criteria](sprints/sprint-2.5/acceptance-criteria.md) — includes the four
  deferred implementation gates
- [Risk register](sprints/sprint-2.5/risks.md)

### Superseded — historical evidence only

The pre-review design below is retained for audit and must not be cited as a contract.

- [Object Specification](sprints/sprint-2.5-object-model/object-specification.md)
- [Object API Contract](sprints/sprint-2.5-object-model/object-api-contract.md)
- [Object Lifecycle](sprints/sprint-2.5-object-model/object-lifecycle.md)
- [Object Relationship Model](sprints/sprint-2.5-object-model/object-relationship-model.md)
- [Object Event Specification](sprints/sprint-2.5-object-model/object-event-specification.md)
- [Object Threat Model](sprints/sprint-2.5-object-model/object-threat-model.md)
- [Acceptance Criteria](sprints/sprint-2.5-object-model/acceptance-criteria.md)

## Sprint 2.6: Canonical serialization

ADR-008 is **Accepted** (2026-08-06) as an architecture-boundary decision, closing deferred
gate **DG-2**. The ACJ-1 profile is normative but no implementation exists; every
threat-model control is specified or structural, none implemented. DG-3 is unblocked for
design and fixture authoring only. Nothing below authorizes implementation.

- [ADR-008: Canonical serialization](decisions/ADR-008-canonical-serialization.md) — Accepted
- [CTO-DECISION-003: Canonical serialization approval](decisions/CTO-DECISION-003-canonical-serialization.md)
- [Canonical Serialization Contract — ACJ-1](contracts/canonical-serialization.md)
- [Canonical Serialization Threat Model](security/canonical-serialization-threat-model.md)
- [Sprint specification](sprints/sprint-2.6-canonical-serialization/specification.md)
- [Acceptance criteria](sprints/sprint-2.6-canonical-serialization/acceptance-criteria.md)
- [Risk register](sprints/sprint-2.6-canonical-serialization/risks.md)

## Sprint 2.7: Contract fixture corpus

ADR-009 is **Accepted** (2026-08-06) as an architecture-boundary decision. It targets deferred
gate **DG-3**, which **remains open** — architecture alone does not close it. **Normative
fixtures are not authorized**, behind a seven-condition gate. No fixture, loader, harness, or
fixtures directory exists.

- [ADR-009: Contract fixture corpus](decisions/ADR-009-contract-fixture-corpus.md) — Accepted
- [CTO-DECISION-005: Fixture corpus architecture](decisions/CTO-DECISION-005-fixture-corpus-architecture.md)
- [CTO-DECISION-004: Sprint 2.7 authorization and timestamp precision](decisions/CTO-DECISION-004-sprint-2.7-authorization.md)
- [Contract Fixture Corpus — AFX-1](contracts/contract-fixture-corpus.md)
- [Contract Fixture Corpus Threat Model](security/contract-fixture-corpus-threat-model.md)
- [Sprint specification](sprints/sprint-2.7-fixture-corpus/specification.md)
- [Acceptance criteria](sprints/sprint-2.7-fixture-corpus/acceptance-criteria.md)
- [Risk register](sprints/sprint-2.7-fixture-corpus/risks.md)

## Sprint 2.8 proposal: Measurable resource limits

ADR-010 is **Proposed**. It targets deferred gate **DG-4**, which **remains open** — the
readiness review returned APPROVE WITH CHANGES with four blocking findings. Non-production
benchmark probes live under `tools/benchmarks/resource-limits/` and are fenced by an
architecture test. No limit is enforced anywhere.

- [ADR-010: Measurable resource limits](decisions/ADR-010-measurable-resource-limits.md) - Proposed
- [CTO-DECISION-006: Sprint 2.8 authorization](decisions/CTO-DECISION-006-sprint-2.8-authorization.md)
- [AION Resource Limits Profile 1 - arlp-1](contracts/resource-limits-profile.md)
- [Resource Limits Threat Model](security/resource-limits-threat-model.md)
- [Benchmark methodology](benchmarks/resource-limits-methodology.md)
- [Benchmark evidence](benchmarks/resource-limits-evidence.md)
- [Sprint specification](sprints/sprint-2.8-resource-limits/specification.md)
- [Acceptance criteria](sprints/sprint-2.8-resource-limits/acceptance-criteria.md)
- [Risk register](sprints/sprint-2.8-resource-limits/risks.md)

## Reviews

- [Resource limits readiness review](reviews/resource-limits-readiness-review.md)

- [Contract fixture corpus readiness review](reviews/contract-fixture-corpus-readiness-review.md)
- [Canonical serialization readiness review](reviews/canonical-serialization-readiness-review.md)

- [Sprint 2.5 Object Model Review](reviews/sprint-2.5-object-model-review.md)
- [Architecture Readiness Review](reviews/architecture-readiness-review.md)
- [Repository status report](reviews/repository-status.md)

## Operations

- [Backup and disaster recovery strategy](operations/backup-strategy.md) — reviewed and
  accepted 2026-08-06. Approved external root `D:\AION-backups`; scheduling not approved.
  Standing gap: no off-site or offline rotated copy yet.
