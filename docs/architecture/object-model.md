# Universal Object Model Architecture

Status: **Accepted** — [ADR-007](../decisions/ADR-007-universal-object-model.md),
2026-08-06  
Contract family: Object version 1, **pre-stable**; not designated stable v1  
Implementation: Bounded mutable-profile, seven-family, RelationshipObject, and local filesystem
reference implemented in Sprint 3 Phase 5; full contract remains frozen outside
[CTO-DECISION-009](../decisions/CTO-DECISION-009-phase-4-approval-and-object-reference.md) and
[CTO-DECISION-010](../decisions/CTO-DECISION-010-phase-5-completion.md)

## Architectural intent

The Universal Object Model is AION's common language for durable truth. Every
persistent entity—from a Document or Task to a Memory, Capability, Plugin, Event, or
Object Version—has the same stable identity, ownership, provenance, versioning, and
export foundation.

Uniform structure does not mean uniform behavior. Each domain owns its business rules.
Object Model standardizes how durable entities exist, change, relate, and remain
recoverable without becoming a central business-logic service.

## Responsibility

Object Model has one responsibility: define and enforce the universal structural and
record-lifecycle invariants of persistent AION entities.

It owns:

- Object identity, type naming, and structural conformance;
- universal ownership and actor attribution;
- contract/schema/revision distinctions;
- common record lifecycle rules;
- bounded metadata and provenance requirements;
- Object profile rules;
- type/schema registration protocols;
- relationship, version, event, export, and commit contracts; and
- stable failure categories for universal invariant violations.

It does not own:

- authentication, authorization, policy, credentials, or secrets;
- type-specific state machines or business decisions;
- Memory retrieval, Knowledge Graph queries, planning, capability selection, workflow
  execution, plugin loading, or UI;
- event routing, subscriptions, retries, or an Event Bus;
- database, vector store, framework, serialization library, or vendor selection; or
- direct invocation of downstream services.

## Universal applicability

At minimum, these future entities conform to Object:

| Domain | Object examples |
|---|---|
| Work | Project, Task, Goal, Decision, Meeting, Calendar Event |
| Communication | Conversation, Email, Message |
| People and organizations | Person, Owner record, Company, Customer |
| Career | Job Posting, Resume |
| Product | Product, Invoice |
| Knowledge and media | Document, Research Note, Image, Video, Audio, Knowledge |
| Engineering | Repository, Commit, Plugin, Capability |
| Intelligence operations | Workflow, Agent record, Memory |

“Agent” here is a durable record describing a bounded worker concept, not permission
to introduce permanent fixed-agent architecture. Workers and capabilities remain
governed by their future approved subsystems.

Future types register under owned namespaces and inherit the same contract without
changing the base envelope.

## Layering and dependencies

```text
Identity identifier contracts
            |
            v
Universal Object contracts and invariants
            |
            +--> Domain Object schemas and commands
            |      Identity, Memory, Planner, Capability, Workflow, Plugin, ...
            |
            +--> Replaceable persistence/export/event-publisher ports
                       |
                       v
                    Adapters
```

Identity identifier primitives do not depend on Object. Persisted Identity records
depend on both Identity primitives and Object. Object depends on no domain package.
Apps select adapters at the composition root.

## Compact base envelope

The canonical Entity snapshot contains:

| Concern | Architectural rule |
|---|---|
| Identity | Immutable UUID and immutable namespaced Object type |
| Versions | Object contract version, type schema version, and monotonic revision |
| Ownership | Exactly one canonical owner in version 1; not an authorization grant |
| Attribution | Immutable creator and creation time; latest modifier and update time |
| Lifecycle | Current universal record state only; domain state remains in type data |
| Metadata | Bounded labels and registered namespaced extensions |
| Provenance | Bounded origin summary; detailed assertion provenance may be related Objects |
| Access control | Optional scalar reference to a policy/permission-set Object |
| Audit | Optional stable audit-stream reference; audit entries remain separate Objects |
| Integrity | Versioned canonical-content digest descriptor |
| Data | Type-specific immutable snapshot validated by the owning schema |

Relationships, version history, domain events, Knowledge links, Planner links, Memory
links, Capability links, and Workflow links are supported through first-class
Relationship Objects and query contracts. They are not unbounded arrays embedded in
the Entity snapshot.

## Object profiles

### Entity Object

Represents the current canonical state of a domain entity. It is revised only through
commands owned by its domain. Each successful mutation advances revision exactly once
and creates immutable Version and Event Objects.

### Relationship Object

Represents one canonical typed edge between source and target Objects. It has its own
identity, owner, provenance, lifecycle, schema, revision, and domain attributes. It is
the only canonical relationship truth; endpoints do not maintain authoritative edge
arrays.

### Version Object

Represents one immutable committed revision of an Entity or Relationship Object. It
is created within the subject aggregate commit, contains or securely references the
canonical revision representation, and never mutates. It does not create another
Version Object or emit a meta-event.

### Event Object

Represents one immutable fact produced by a committed mutation. It carries subject,
revision, actor, owner, provenance, correlation, causation, and a minimized payload.
It never mutates and does not create another Version Object or Event Object.

The non-recursive Version and Event rules are formal profile invariants, not adapter
exceptions.

## Domain mutation boundary

Object Model does not expose a universal public “update any Object” operation. A Task
domain might expose complete, assign, or reschedule; a Memory domain might expose
correct or supersede. Those commands validate domain invariants and then submit one
universal aggregate commit request.

Trusted import and schema migration use separate privileged protocols. They cannot be
used as ordinary mutation shortcuts.

## Reference integration model

Cross-subsystem references use typed Relationships rather than direct service calls:

- Knowledge relationships connect Objects to claims, sources, and concepts.
- Planner relationships connect goals, plans, evidence, decisions, and outcomes.
- Memory relationships connect memory records to sources and derived knowledge.
- Capability relationships connect definitions, invocations, inputs, and results.
- Workflow relationships connect definitions, runs, tasks, approvals, and outputs.

Object Model validates relationship structure and endpoint identity. The owning
subsystem defines relationship semantics and business rules. A reference never grants
authority or transfers ownership.

## Commit boundary

One Entity or Relationship is one aggregate. A successful mutation atomically records:

1. the new canonical aggregate snapshot;
2. exactly one immutable Version Object for the new revision;
3. zero or more immutable committed-fact Event Objects required by the command; and
4. durable pending-publication records when publication is outside the transaction.

Endpoint Objects are not rewritten when a Relationship changes. Cross-aggregate
business processes use workflows, compensating actions, and idempotent events rather
than assumed distributed transactions.

## Owner control and portability

Every Object is exportable by its owner in a documented, open, versioned format.
Export includes the Entity or Relationship, schema identity, applicable Version and
Event Objects, relationships permitted for export, provenance, integrity descriptors,
and a manifest. Unknown valid extensions survive round trips.

An export is a recorded operation, not an ownership transfer. Import preserves source
identity and provenance while resolving collision, ownership, and trust explicitly.

## Scalability posture

- Base snapshots remain bounded and do not grow with history or relationship count.
- History, events, and relationships are paginated and independently indexed.
- Large binary media use content/artifact Objects or references; bytes are not forced
  into every envelope or event.
- Vector embeddings and search indexes are derived projections, not canonical base
  fields.
- Every collection query requires stable ordering, cursor pagination, limits, and
  cancellation/deadline semantics.
- Local-first reference workloads must be benchmarked before contract version 1 is
  declared stable.

## Governance

Adding a universal field requires evidence that it is meaningful for every Object
profile, has stable semantics, is bounded, remains storage/vendor independent, and
cannot be represented safely as a facet or Relationship. Breaking changes require a
new Object contract major version, coexistence, migration, and rollback.

ADR-007 was accepted on 2026-08-06 as an architecture-boundary decision. The contract
family is normative but pre-stable, and no implementation followed from ADR acceptance alone. The
bounded Phase 5 reference follows from the later CTO-DECISION-009 and its scope correction in
CTO-DECISION-010. The filesystem adapter remains non-production reference evidence. See
[ADR-007 §Approval effect](../decisions/ADR-007-universal-object-model.md#approval-effect)
for what acceptance does and does not authorize, and the
[Sprint 2.5 acceptance criteria](../sprints/sprint-2.5/acceptance-criteria.md)
§Deferred implementation gates for the four matters that remain open.
