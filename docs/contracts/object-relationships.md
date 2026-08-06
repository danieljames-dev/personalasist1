# Object Relationship Contract

Status: **Pre-stable** normative contract  
Authority: [ADR-007](../decisions/ADR-007-universal-object-model.md) (Accepted 2026-08-06)  
Implementation: Phase 5 supports the closed Relationship envelope profile only; relationship
descriptors, endpoint behavior, and persistence remain unimplemented

## Responsibility

A Relationship Object is the single canonical truth for one typed, directed connection
between two Objects. Endpoint Objects do not embed authoritative relationship arrays.
The future Knowledge Graph is a projection over Relationship Objects, not their owner.

## Relationship Object data

Every Relationship Object records:

- immutable source Object ID and optional required source type;
- immutable target Object ID and optional required target type;
- immutable namespaced relationship type;
- schema-validated bounded attributes;
- effective start and optional end time;
- relationship owner, Actor attribution, provenance, lifecycle, revision, and integrity
  through its inherited Object envelope; and
- optional inverse semantic type declared by the relationship-type descriptor.

Changing source, target, or relationship type creates a new Relationship Object and
archives/deletes the old edge. Attribute and lifecycle changes create new revisions.

## Standard relationship types

These standard semantic types are registered under the AION namespace. Domains may
define narrower owned subtypes.

| Type | Directional meaning | Typical cardinality |
|---|---|---|
| `Owns` | Source is canonical owner/controller of target | One owner to many targets; target exactly one canonical `Owns` in v1 where used |
| `Contains` | Source forms a domain container for target | One-to-many; target may have one or multiple containers only as descriptor permits |
| `References` | Source cites or points to target | Many-to-many |
| `DependsOn` | Source cannot proceed or remain valid without target condition | Many-to-many; cycles prohibited by default unless subtype permits |
| `DerivedFrom` | Source was created using target as provenance/input | Many-to-many; immutable lineage edge |
| `RelatedTo` | Symmetric non-specific association | Many-to-many; use only when no stronger registered type applies |
| `ProducedBy` | Source artifact/result was produced by target Actor, Capability, Workflow, or Object | Many-to-one or many-to-many by subtype |
| `ConsumedBy` | Source input/resource was consumed by target process/entity | Many-to-many |
| `BelongsTo` | Source is assigned to a target grouping/domain concept | Many-to-one by default; subtype may permit many |
| `CreatedBy` | Source was originally created by target Actor | Many sources to one Actor; immutable; envelope attribution remains authoritative |
| `ModifiedBy` | Source revision was modified by target Actor | Many revisions to one Actor; normally Version-level |
| `VerifiedBy` | Source/revision was verified by target Actor or verification Object | Many-to-many; tied to exact revision |
| `Supports` | Source provides evidence, capability, or enabling support for target | Many-to-many |
| `Blocks` | Source condition prevents progress of target | Many-to-many; active/effective interval required |
| `Supersedes` | Source replaces target for a declared scope | Many-to-many; cycles prohibited; chronological ordering required |

`Owns`, `CreatedBy`, and `ModifiedBy` relationships may provide richer query/navigation
semantics, but they cannot contradict canonical envelope ownership/attribution. A
contradiction is an integrity failure, not an alternate truth.

### Endpoints are Objects, never bare identifiers

Both relationship endpoints are Object IDs. `OwnerIdV1` and `ActorIdV1` are Identity
namespaces and are never valid endpoints. An edge that names an owner or an Actor —
`Owns`, `CreatedBy`, `ModifiedBy`, `VerifiedBy`, `ProducedBy` — targets the persisted
Identity Entity Object for that Owner or Actor, and the descriptor declares the required
endpoint type. Object Model does not resolve an `OwnerIdV1` or `ActorIdV1` to an Object
ID; the owning domain supplies the resolved endpoint.

Consequently these edges are optional navigation, not the source of ownership or
attribution truth: envelope `ownership`, `createdBy`, and `modifiedBy` remain
authoritative and are valid even when no Identity Entity Object has been materialized.
An Object with no `Owns` edge is still owned.

## Cardinality

Each relationship-type descriptor declares minimum/maximum outgoing and incoming
cardinality, uniqueness key, allowed endpoint types, duplicate policy, self-edge rule,
cycle rule, inverse semantics, ownership constraints, and lifecycle coupling.

Cardinality examples:

- one-to-one: one Resume `BelongsTo` one Person for a declared primary-resume subtype;
- one-to-many: one Project `Contains` many Tasks;
- many-to-one: many Commits `BelongTo` one Repository;
- many-to-many: Research Notes `Reference` Documents.

Cardinality is validated against authoritative active Relationship Objects. It is not
inferred from endpoint arrays or a possibly stale graph projection.

## Integrity rules

1. Source and target identities exist and match descriptor type constraints at create.
2. Deleted or Destroyed Objects cannot receive new active Relationships.
3. Relationship owner and cross-owner behavior satisfy the descriptor and external
   policy; cross-owner edges fail closed by default.
4. Relationship identity, type, source, target, and creator are immutable.
5. Duplicate uniqueness and cardinality are enforced at the Relationship aggregate
   boundary using a portable constraint/idempotency protocol.
6. Cycles are rejected for acyclic types such as `Supersedes` and default `DependsOn`.
7. A Relationship confers no read, write, ownership, or capability authority.
8. Provenance identifies who asserted or derived the edge and confidence when relevant.
9. Relationship attributes cannot duplicate secrets, endpoint content, or policy results.
10. Endpoint deletion follows an explicit descriptor disposition: retain protected
    historical edge, redact endpoint, archive edge, or delete edge. No implicit cascade.
11. Inverse views are computed semantics unless a descriptor explicitly requires a
    distinct inverse Relationship Object.
12. Integrity validation never requires direct invocation of endpoint domain services.

## Operations

- **Add** validates type, endpoints, cardinality, ownership, provenance, policy evidence,
  and attributes; commits the Relationship aggregate and events.
- **Modify attributes** uses a domain/type-owned command and expected revision.
- **Archive** temporarily removes the edge from active semantics.
- **Restore** revalidates endpoints, cardinality, schema, and policy.
- **Remove** transitions the Relationship to Deleted according to retention policy and
  emits `ObjectRelationshipRemoved`.
- **Query** filters by source/target, direction, relationship type, lifecycle, effective
  time, owner, and cursor; policy is evaluated outside Object Model.

## Cross-subsystem references

Knowledge, Planner, Memory, Capability, Workflow, audit, and plugin references use
registered relationship subtypes. Their domains define meaning and business rules;
Object Model provides identity, integrity, provenance, lifecycle, cardinality protocol,
and query interoperability.

## Scalability

Relationship queries require stable cursor pagination and bounded page sizes. High
degree does not increase endpoint snapshot size. Indexes and Knowledge Graph projections
are rebuildable from canonical Relationship Objects and events. No storage/index
technology is selected by this contract.
