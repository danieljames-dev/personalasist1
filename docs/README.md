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
family is normative but **pre-stable** — not designated stable v1. The implementation freeze is
lifted only for the bounded Sprint 3.0 phases separately authorized under CTO-DECISION-008.
DG-1 is historically split into DG-1a and DG-1b; DG-1a is Closed by CTO-DECISION-009 and DG-1b
remains Open. DG-3 and DG-4b remain Open; DG-2 and DG-4a are Closed.

### Decision and architecture

- [ADR-007: Universal Object Model](decisions/ADR-007-universal-object-model.md) — Accepted
- [CTO-DECISION-002: Sprint 2.5 approval](decisions/CTO-DECISION-002-sprint-2.5-approval.md)
- [CTO-DECISION-009: Phase 4 approval and Object reference authorization](decisions/CTO-DECISION-009-phase-4-approval-and-object-reference.md)
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
gate **DG-2**. The ACJ-1 profile is normative and has a bounded Phase 5 Object-reference
implementation; no normative fixture or cross-runtime conformance evidence exists. DG-3 is
unblocked for design only and remains Open.

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

## Sprint 2.8–2.9: Measurable resource limits

ADR-010 is **Accepted for DG-4a only**. The historical DG-4 is split: **DG-4a is Closed** for
canonical-processing resource limits and **DG-4b remains Open** for Object and domain workloads.
DG-4b does not block a local, single-owner bounded reference slice with small selected inputs,
but blocks production-scale, hostile/public, unbounded, multi-user, production workload, and
production service claims. Benchmark probes remain non-production. The accepted DG-4a limits are
implemented only in the bounded Phase 5 Object reference and are not production-workload evidence.

- [ADR-010: Measurable resource limits](decisions/ADR-010-measurable-resource-limits.md) — Accepted for DG-4a only
- [CTO-DECISION-008: Resource limits and vertical-slice authorization](decisions/CTO-DECISION-008-resource-limits-and-vertical-slice.md)
- [Permanent Sprint 3.0 directive](directives/sprint-3.0-career-vertical-slice.md)
- [CTO-DECISION-006: Sprint 2.8 authorization](decisions/CTO-DECISION-006-sprint-2.8-authorization.md)
- [AION Resource Limits Profile — aion-resource-limits-1 v1](contracts/resource-limits-profile.md)
- [Resource Limits Threat Model](security/resource-limits-threat-model.md)
- [Benchmark methodology](benchmarks/resource-limits-methodology.md)
- [Benchmark evidence](benchmarks/resource-limits-evidence.md)
- [Sprint specification](sprints/sprint-2.8-resource-limits/specification.md)
- [Acceptance criteria](sprints/sprint-2.8-resource-limits/acceptance-criteria.md)
- [Risk register](sprints/sprint-2.8-resource-limits/risks.md)
- [CTO-DECISION-007: Sprint 2.9 corrections](decisions/CTO-DECISION-007-sprint-2.9-resource-limits-corrections.md)
- [Sprint 2.9 specification](sprints/sprint-2.9-resource-limits-corrections/specification.md)
- [Sprint 2.9 acceptance criteria](sprints/sprint-2.9-resource-limits-corrections/acceptance-criteria.md)
- [Sprint 2.9 risk register](sprints/sprint-2.9-resource-limits-corrections/risks.md)

## Sprint 3.0 Phase 3: privacy boundary

- [Personal data boundary](privacy/personal-data-boundary.md)
- [Threat model](security/personal-data-boundary-threat-model.md)
- [Local path boundary v1](contracts/local-path-boundary-v1.md)
- [Reference implementation](implementation/privacy-boundary-reference.md)
- [Phase 3 record](sprints/sprint-3.0-career-vertical-slice/phase-3-privacy-boundary.md)
- [Phase 3 privacy review](reviews/sprint-3.0-phase-3-privacy-review.md) — APPROVE

Phase 3 establishes an ignored local directory and explicit filesystem-containment boundary only.
It accessed no owner data. Phase 4 composes this boundary without changing the privacy package.

## Sprint 3.0 Phase 4: local Identity bootstrap

- [Local Identity State v1 contract](contracts/local-identity-state-v1.md)
- [Local owner bootstrap operations](implementation/local-owner-bootstrap.md)
- [Phase 4 record](sprints/sprint-3.0-career-vertical-slice/phase-4-local-identity-bootstrap.md)
- [Phase 4 architecture and security review](reviews/sprint-3.0-phase-4-identity-review.md) — APPROVE

Phase 4 implements one local Owner, Principal, Actor, and System Instance reference and their three
required relationships. It is explicit, idempotent, private, atomic, locked, locally exportable, and
redacted by default. It is not authentication, authorization, a profile, a Universal Object, career
ingestion, or implicit later-phase authority. DG-1a is Closed; DG-1b remains Open.

## Sprint 3.0 Phase 5: minimum Object reference

- [Minimum Object Reference Contract v1](contracts/object-reference-v1.md)
- [Object reference implementation](implementation/object-reference.md)
- [Phase 5 record](sprints/sprint-3.0-career-vertical-slice/phase-5-object-reference.md)
- [Phase 5 architecture and security review](reviews/sprint-3.0-phase-5-object-review.md) — APPROVE

Phase 5 implements a domain-neutral, local `@aion/object` reference with typed Identity references,
closed mutable-profile envelopes, ACJ-1 framing/integrity, exact DG-4a limits, and an in-memory
revision repository. No real Object state or career type exists. The Object Contract remains
Pre-stable; DG-3 and DG-4b remain Open; normative fixtures and Phase 6 remain unauthorized.

## Reviews

- [Resource limits FINAL readiness review](reviews/resource-limits-final-readiness-review.md)
- [Resource limits readiness review (Sprint 2.8)](reviews/resource-limits-readiness-review.md)

- [Contract fixture corpus readiness review](reviews/contract-fixture-corpus-readiness-review.md)
- [Canonical serialization readiness review](reviews/canonical-serialization-readiness-review.md)

- [Sprint 2.5 Object Model Review](reviews/sprint-2.5-object-model-review.md)
- [Architecture Readiness Review](reviews/architecture-readiness-review.md)
- [Repository status report](reviews/repository-status.md)

## Operations

- [Codex control plane](operations/codex-control-plane.md) — Founder-authorized local directive,
  interactive execution, ignored run state, and standardized handoff workflow.
- [Codex control-plane architecture review](reviews/codex-control-plane-review.md) — APPROVE.

- [Backup and disaster recovery strategy](operations/backup-strategy.md) — reviewed and
  accepted 2026-08-06. Approved external root `D:\AION-backups`; scheduling not approved.
  Source backups use a durable branch/tag/note ref allowlist and exclude editor/agent refs.
  Standing gap: no off-site or offline rotated copy yet.
