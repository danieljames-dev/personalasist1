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
- [CTO-DECISION-010: Phase 5 completion scope correction](decisions/CTO-DECISION-010-phase-5-completion.md)
- [CTO-DECISION-011: Phase 5 approval and Phase 6 authorization](decisions/CTO-DECISION-011-phase-5-approval-and-phase-6.md)
- [CTO-DECISION-012: Phase 6 approval and Phase 7 authorization](decisions/CTO-DECISION-012-phase-6-approval-and-phase-7.md)
- [Object Model architecture](architecture/object-model.md)

### Normative contracts

- [Universal Object Contract v1](contracts/object-contract-v1.md)
- [Object Lifecycle Contract](contracts/object-lifecycle.md)
- [Object Event Contract](contracts/object-events.md)
- [Object Relationship Contract](contracts/object-relationships.md)
- [Object Versioning Contract](contracts/object-versioning.md)
- [Career Object Family Reference v1](contracts/career-object-family-reference-v1.md)
- [RelationshipObject Reference v1](contracts/relationship-object-reference-v1.md)

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
- [Career Object Family Reference v1](contracts/career-object-family-reference-v1.md)
- [RelationshipObject Reference v1](contracts/relationship-object-reference-v1.md)
- [Object reference implementation](implementation/object-reference.md)
- [Bounded filesystem repository](implementation/object-filesystem-reference.md)
- [Filesystem repository threat model](security/object-filesystem-threat-model.md)
- [Phase 5 record](sprints/sprint-3.0-career-vertical-slice/phase-5-object-reference.md)
- [Phase 5 architecture and security review](reviews/sprint-3.0-phase-5-object-review.md) — APPROVE

Phase 5 implements the local `@aion/object` reference with typed Identity references, closed
mutable-profile envelopes, ACJ-1 framing/integrity, exact DG-4a limits, seven versioned family
boundaries, RelationshipObject as sole edge truth, explicit operations, and in-memory plus bounded
privacy-validated filesystem reference repositories. Detailed career payload schemas remain
deferred and no real Object or career data exists. The Object Contract remains Pre-stable; DG-3 and
DG-4b remain Open; normative fixtures remain unauthorized. Phase 5 was approved by
CTO-DECISION-011.

## Sprint 3.0 Phase 6: career input contracts

- [Career Input Contract v1](contracts/career-input-contract-v1.md)
- [Blank template authoring guidance](implementation/career-input-template-authoring.md)
- [Career input preflight](implementation/career-input-preflight.md)
- [Career input threat model](security/career-input-threat-model.md)
- [Phase 6 record](sprints/sprint-3.0-career-vertical-slice/phase-6-career-input-contract.md)
- [Phase 6 architecture and security review](reviews/sprint-3.0-phase-6-career-input-review.md) — APPROVE

Phase 6 defines closed versioned career-facts, career-preferences, and job-posting inputs; neutral
blank templates; and explicit local preflight. It reads no real owner data, creates no Object, and
performs no ingestion, persistence, inference, network action, or archive access. Templates are not
normative fixtures. Phase 6 is approved by CTO-DECISION-012.

## Sprint 3.0 Phase 7: career evidence catalogue and profile

- [Career Evidence Catalogue Contract v1](contracts/career-evidence-catalogue-v1.md)
- [CareerFact Contract v1](contracts/career-fact-v1.md)
- [CareerProfile Derivation Contract v1](contracts/career-profile-derivation-v1.md)
- [Deterministic parsing reference](implementation/career-evidence-deterministic-parsing.md)
- [Import and recovery boundary](implementation/career-evidence-import-recovery.md)
- [Career evidence threat model](security/career-evidence-threat-model.md)
- [Phase 7 record](sprints/sprint-3.0-career-vertical-slice/phase-7-career-evidence-profile.md)
- [Phase 7 architecture and security review](reviews/sprint-3.0-phase-7-career-evidence-review.md) — APPROVE

Phase 7 adds an explicit local catalogue, deterministic structured CareerFacts, exact provenance,
conflict/supersession history, and evidence-backed profiles using the accepted bounded Object
repository. All verification uses synthetic temporary data. No real owner career input or
permanent career Object exists. Phase 7 is approved by CTO-DECISION-013.

## Sprint 3.0 Phase 8: explicit Job Posting import

- [Job Posting Import Contract v1](contracts/job-posting-import-v1.md)
- [Deterministic Job Posting import reference](implementation/job-posting-import.md)
- [Job Posting import threat model](security/job-posting-import-threat-model.md)
- [Phase 8 record](sprints/sprint-3.0-career-vertical-slice/phase-8-job-posting-import.md)
- [Phase 8 architecture and security review](reviews/sprint-3.0-phase-8-job-posting-review.md) â€” APPROVE

Phase 8 adds explicit structured JSON, Markdown, and text Job Posting import with closed payloads,
exact source provenance, description-only unstructured handling, conservative currentness evidence,
dry run, and atomic create/revision behavior. All proof uses synthetic temporary data. No real Job
Posting, career data, permanent Object, or AI-assistant archive was read.

## Sprint 3.0 first-usable Career demo

- [Milestone specification](sprints/sprint-3.0-career-vertical-slice/specification.md)
- [Acceptance criteria](sprints/sprint-3.0-career-vertical-slice/acceptance-criteria.md)
- [Risk register](sprints/sprint-3.0-career-vertical-slice/risks.md)
- [Job Matching Contract v1](contracts/job-matching-v1.md)
- [Application Preparation Contract v1](contracts/application-preparation-v1.md)
- [Local Career CLI](implementation/career-cli.md)
- [Reference Candidate status](implementation/reference-candidate-status.md)
- [Career data threat model](security/career-data-threat-model.md)
- [Final architecture review](reviews/sprint-3.0-first-usable-career-demo-review.md)

The local Reference Candidate now accepts explicit owner-selected inputs, preserves source/fact
provenance, builds a profile, imports an owner-supplied posting, explains a deterministic match,
creates cited owner-review preparation outputs, exports/reloads locally, and runs a complete neutral
synthetic temporary demo. It cannot discover jobs, fetch URLs, submit applications, send email,
answer forms, sign, attest, use a model, or synchronize career data. Real owner-data ingestion did
not run. DG-3 and DG-4b remain Open, normative fixtures remain unauthorized, and the Universal
Object Contract remains Pre-stable.

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
