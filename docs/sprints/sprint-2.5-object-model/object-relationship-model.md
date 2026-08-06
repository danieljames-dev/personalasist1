# Object Relationship Model v1

Status: Proposed normative design

## Purpose

Represent all cross-Object connections as independently identifiable, versioned,
provenance-bearing Objects rather than embedded IDs with undefined semantics.

## Relationship Object

`ObjectRelationshipV1` inherits the full Object envelope. Its type data is:

```ts
interface ObjectRelationshipDataV1 extends JsonObjectV1 {
  readonly relationshipType: RelationshipTypeV1;
  readonly source: ObjectEndpointV1;
  readonly target: ObjectEndpointV1;
  readonly inverseType?: RelationshipTypeV1;
  readonly attributes: JsonObjectV1;
  readonly validFrom: TimestampV1;
  readonly validUntil?: TimestampV1;
}

interface ObjectEndpointV1 {
  readonly objectId: ObjectIdV1;
  readonly expectedObjectType?: ObjectTypeV1;
}
```

Relationship type names are immutable reverse-domain-style namespaces such as
`org.aion.project.contains-task`. A registry descriptor defines allowed endpoint
types, direction, inverse semantics, cardinality, duplicate policy, lifecycle coupling,
and attribute schema.

## Invariants

1. A relationship has one source and one target; direction is meaningful.
2. Both endpoints must exist, match declared type constraints, and not be tombstoned
   when the relationship is created.
3. Relationship ownership is explicit and need not be inferred from either endpoint.
4. Same-owner relationships are the v1 default. Cross-owner relationships fail closed
   unless future policy evidence and a relationship-type rule permit them.
5. A relationship ID is immutable. Changing endpoints or type creates a new
   relationship and archives/tombstones the previous edge.
6. Attributes cannot contain authorization decisions or duplicate endpoint data.
7. Provenance records who or what asserted the relationship and confidence when
   derived.
8. Duplicate and cardinality rules are enforced atomically using expected revisions.
9. Removing an edge archives or tombstones the Relationship Object; it never erases
   history silently.
10. Inverse relationships are semantic views unless the descriptor explicitly
    requires a separately persisted inverse Object.

## Relationship categories

The model supports categories without hardcoding domain types:

- containment (`Project contains Task`);
- reference (`Document references Company`);
- derivation (`Research Note derived from Document`);
- association (`Meeting concerns Project`);
- dependency (`Task depends on Task`);
- identity attribution (`Object created by Actor` is normally envelope attribution,
  not a separate edge unless richer domain meaning is needed).

The category informs validation and UX only; the fully namespaced relationship type
is authoritative.

## Ownership and permissions

A relationship never grants access to either endpoint. A caller must be authorized
independently for the relationship and each endpoint it reads. Query results must not
reveal the existence, type, or identifier of an inaccessible endpoint.

Deleting/tombstoning an endpoint does not automatically delete edges. The endpoint
type and relationship descriptor define whether edges are archived, tombstoned,
redacted, or retained as protected historical references. Cascades require explicit,
audited plans.

## Operations

- `relate`: validate endpoints/type/cardinality and atomically commit the Relationship.
- `reviseAttributes`: update allowed attributes with expected revision.
- `archive` / `restore`: temporarily remove/reinstate an active edge.
- `tombstone`: permanently close the relationship identity.
- `listForObject`: query through a replaceable relationship repository with explicit
  direction, type, lifecycle, owner, pagination, and policy context.

Relationship operations publish Object Relationship events; they never call endpoint
owners or downstream services.

## Graph boundary

Relationships are canonical Objects. The future Knowledge Graph is a replaceable
projection/query subsystem built from these Objects and events. It does not become
the canonical owner of relationships, and Object Model does not depend on a graph
database.

