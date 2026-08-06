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

## Reviews

- [Sprint 2.5 Object Model Review](reviews/sprint-2.5-object-model-review.md)
- [Architecture Readiness Review](reviews/architecture-readiness-review.md)
- [Repository status report](reviews/repository-status.md)

## Operations

- [Backup and disaster recovery strategy](operations/backup-strategy.md) — reviewed and
  accepted 2026-08-06. Approved external root `D:\AION-backups`; scheduling not approved.
  Standing gap: no off-site or offline rotated copy yet.
