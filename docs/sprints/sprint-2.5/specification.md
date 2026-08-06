# Sprint 2.5 Specification: Universal Object Model

Status: **Accepted** — architecture only, 2026-08-06  
Contract stability: Pre-stable; not designated stable v1  
Implementation freeze: **Active**  
Owner: CTO  
Decision record: [CTO-DECISION-002](../../decisions/CTO-DECISION-002-sprint-2.5-approval.md)

## Supersession

This sprint replaces `docs/sprints/sprint-2.5-object-model/` in full. Those documents
are marked Superseded and retained as review evidence only. Where the two sets differ,
the documents listed under Deliverables govern.

`docs/operations/backup-strategy.md` is **not** a Sprint 2.5 deliverable. It was
produced alongside this sprint, addresses repository and future owner-data protection,
and is reviewed and approved independently of ADR-007.

## Mission

Design the durable Object foundation from which every persistent AION entity inherits.
The design must remain modular, local-first, owner-controlled, vendor-neutral, secure,
versioned, testable, and maintainable for at least ten years.

## Problem

AION's future domains need common identity, ownership, provenance, metadata, lifecycle,
relationships, permissions, audit, history, events, and export. Independent definitions
would drift, create vendor/domain coupling, and make Memory, Planner, Knowledge Graph,
Workflow, Capability, Plugin, and owner-data portability unreliable.

## Sprint outcome

An approved language- and storage-neutral architecture and contract family sufficient
to design future domain Objects without redesigning the universal base.

No runtime package, schema file, test, database, adapter, Event Bus, framework, or
automation is delivered in this sprint.

## Responsibility

Universal Object Model defines structural and record-lifecycle invariants. Every
domain owns its business behavior, type-specific state machine, validation, commands,
and interpretation of its relationships.

## Required Object support

Every persistent Object supports:

- immutable UUID identity and namespaced Object type;
- exactly one canonical owner in version 1;
- canonical Identity references for owner, creator, and modifier;
- bounded metadata and provenance;
- version history through immutable Version Objects;
- universal lifecycle plus domain-specific state in type data;
- immutable committed-fact Event Objects;
- permissions and audit references without embedded policy;
- typed Relationships including Knowledge, Planner, Memory, Capability, and Workflow
  references;
- owner-controlled open-format export;
- schema evolution, import, merge, split, delete, and destruction protocols; and
- integrity descriptors independent of storage/vendor.

## Supported initial type horizon

The design is evaluated against:

- Document, Project, Task, Goal, Meeting, Conversation, and Decision;
- Person, Owner record, Company, Customer, Job Posting, and Resume;
- Product, Repository, Commit, Research Note, Calendar Event, and Invoice;
- Email, Message, Image, Video, and Audio;
- Plugin, Capability, Workflow, Agent record, Memory, and Knowledge; and
- Relationship, Version, Event, Audit, Export, and Destruction Certificate Objects.

These examples validate universality. They are not authorized implementations or a
closed list of future types.

## Architecture requirements

1. Structural conformance, not language-specific class inheritance.
2. Compact bounded base envelope.
3. Entity, Relationship, Version, and Event profiles with non-recursive system profiles.
4. Domain-owned commands; no generic public mutation bypass.
5. Relationship Objects as sole canonical edge truth.
6. Independent paginated histories/events/relationships, not embedded growing arrays.
7. One aggregate commit boundary with immutable Version/Event evidence and durable
   publication intent.
8. Event contracts without Event Bus or downstream invocation.
9. Storage-, model-, framework-, and vendor-independent public contracts.
10. Versioned schemas, migrations, coexistence, export, and rollback.

## Deliverables

- `docs/architecture/object-model.md`
- `docs/decisions/ADR-007-universal-object-model.md`
- `docs/security/object-threat-model.md`
- `docs/contracts/object-contract-v1.md`
- `docs/contracts/object-lifecycle.md`
- `docs/contracts/object-events.md`
- `docs/contracts/object-relationships.md`
- `docs/contracts/object-versioning.md`
- `docs/sprints/sprint-2.5/specification.md`
- `docs/sprints/sprint-2.5/acceptance-criteria.md`
- `docs/sprints/sprint-2.5/risks.md`

## Lifecycle scope

The contract defines Created, Validated, Active, Archived, Deprecated, Deleted, and
Destroyed states and Imported, Exported, Restored, Merged, and Split operations. It
explains every permitted transition, evidence requirement, irreversibility boundary,
and interaction with domain state.

## Event scope

The contract defines universal Object lifecycle, update, relationship, version,
import/export, merge/split, ownership, and migration events. Events are immutable
Objects, committed facts, minimized, idempotent, ordered per subject revision, and
published through a replaceable port. Event routing/transport remains out of scope.

## Relationship scope

The contract defines Owns, Contains, References, DependsOn, DerivedFrom, RelatedTo,
ProducedBy, ConsumedBy, BelongsTo, CreatedBy, ModifiedBy, VerifiedBy, Supports, Blocks,
and Supersedes, plus namespaced domain subtypes. Each descriptor owns endpoint types,
cardinality, uniqueness, cycle, lifecycle, inverse, provenance, and cross-owner rules.

## Integration requirements

### Identity

Object consumes only approved canonical identifier contracts. Persisted Identity
records are Entity Objects through an implementation layer. Bootstrap requires a
subordinate decision.

### Memory

Memory types inherit Object ownership, provenance, revision, lifecycle, export, and
relationships. Assertion-level confidence/lineage remains Memory data. Embeddings and
indexes remain derived projections.

### Knowledge Graph

Canonical Relationship Objects and domain events supply a rebuildable graph projection.
Knowledge Graph never owns Object truth.

### Planner

Goals, plans, evidence, decisions, approvals, and outcomes may be Objects. Transient
reasoning is materialized only when a future Planner specification requires durable,
owner-relevant state. Events do not authorize execution.

### Capability Registry

Capability definitions, versions, invocations, and results may be Objects. Object Type
Registry validates durable entity schemas; Capability Registry discovers invocable
actions. The registries remain separate.

### Workflow Engine

Workflow definitions, runs, tasks, approvals, and outputs may be Objects. Workflow owns
execution state/semantics; Object supplies persistence identity, history, and references.

### Plugins

Plugins may define owned Object/Relationship namespaces. Unknown valid plugin data must
remain readable/exportable without executing plugin code. Signing, sandboxing, removal,
and orphan-data behavior require future plugin design.

## Security requirements

- IDs/references confer no authority.
- Object Model owns no policy or authorization decision.
- Cross-owner behavior fails closed.
- Reserved fields cannot be mass-assigned.
- Schemas, imports, plugins, migrations, repositories, and publishers are treated as
  trust boundaries.
- Secrets are prohibited from Object metadata/events/logs/exports.
- Delete/Destroy semantics cover derived stores and approved backup retention.
- Owner export is scoped, auditable, integrity-verifiable, and open-format.

## Performance requirements

Before version 1 stability, representative fixtures must demonstrate bounded envelope
size. Future benchmarks must cover high-churn Tasks/Workflows, large media/artifacts,
high-degree Relationships, long history, bulk migration, export, and local recovery.
Limits and performance budgets require approval before implementation.

## Versioning requirements

Object contract, type schema identity/version, Object revision, event contract/payload,
relationship descriptor, and package release versions remain distinct. Compatibility
is explicit and fixture-proven. Breaking changes coexist under a new major contract.

## Migration and recovery

Migrations are domain-owned, checkpointed, resumable, idempotent, attributed, and
honest about information loss. Mixed versions remain readable during transition.
Backups/restores reconcile deletion and destruction state before service resumption.

## Documentation verification

Sprint review must verify internal consistency, exact deliverables, required vocabulary,
all readiness-review corrections, unresolved blocking decisions, and absence of
implementation artifacts. No executable tests are produced in this sprint.

## Non-goals

- Implementing Object or Identity.
- Implementing Planner, Memory, Knowledge Graph, Event Bus, Capability, Workflow, Agent,
  Plugin, Dashboard, or integration behavior.
- Choosing storage, vector database, framework, language, cloud, or vendor.
- Creating schemas, production types, migrations, test code, or automation.
- Solving multi-owner collaboration in version 1.

## Approval boundary

Approval of these documents permits subordinate architecture decisions and contract
fixtures only if separately directed. It does not authorize production code. The sprint
stops after documentation and waits for CTO approval.

