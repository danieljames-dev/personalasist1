# ADR-007: Universal Object Model

- Status: Proposed
- Date: 2026-08-05
- Decision owner: CTO

## Context

AION must manage many durable concepts—documents, tasks, projects, memories,
workflows, identities, products, companies, and future types—without each subsystem
inventing identity, ownership, metadata, relationships, permissions, history, events,
versioning, or provenance independently.

The directive requires everything in AION to inherit from Object. Literal class
inheritance across languages would create lock-in, while an unbounded base class would
become a coupled God Object.

## Proposed decision

Every AION domain entity conforms structurally to the versioned `AionObjectV1<TData>`
contract. “Inherits from Object” means the entity carries the complete canonical
Object envelope and type-specific data validated by a versioned schema. Implementations
may use composition, generated types, interfaces, traits, or language-native inheritance;
class inheritance is not required.

The Object envelope owns only universal reference truth and invariants:

- UUID identity and type;
- contract/schema version and optimistic revision;
- ownership and actor attribution;
- timestamps and lifecycle status;
- metadata and provenance;
- relationship, permission, history, and event references; and
- integrity/concurrency information.

Type-specific business rules remain in the owning domain. Permission references do
not grant access; a future policy subsystem decides authorization. Relationship edges,
revision records, and Object events are themselves Objects. Domain events describe
committed facts and never invoke downstream services.

Internal language primitives are not standalone domain entities. Once data becomes
persisted, addressable, shared across a public boundary, related, permissioned,
historical, or event-producing, it must be represented by an Object.

Identity identifier primitives remain below Object. Persisted Identity records
conform to Object in the Identity implementation layer, preventing a package cycle.

## Alternatives

- Independent base fields per subsystem would drift and make cross-domain tooling
  unreliable.
- A shared mutable base class would bind all implementations to one language and
  inheritance mechanism.
- One schemaless property bag would weaken validation and move business rules into
  runtime conventions.
- Event sourcing every Object was rejected because no evidence requires events to be
  the sole source of truth; Object events are committed-fact notifications in v1.
- Embedding complete relationship/history/event collections would cause unbounded
  object growth and inconsistent concurrent updates.

## Consequences

All domain schemas pay a small uniform-envelope cost and must pass Object conformance.
Generic export, search, graph projection, audit, migration, and owner controls become
possible across domains. References keep envelopes bounded, but readers need explicit
ports to resolve related Objects. Schema governance becomes critical.

The base contract cannot absorb domain convenience fields. Additive base changes need
compatibility evidence; breaking changes require `Object/v2`, migration, coexistence,
and rollback.

## Review triggers

- Envelope overhead is measured as material for a validated workload.
- Cross-owner collaboration requires ownership semantics not representable in v1.
- Event sourcing is proven necessary for a bounded domain.
- A required domain entity cannot conform without violating its responsibility.

