# ADR-006: Identity is canonical reference authority

- Status: Accepted
- Date: 2026-08-05
- Approved by: CTO

## Context

The Object Model needs stable owner, actor, and principal references. Conflating those
references with login credentials, sessions, policy, authorization, or business rules
would bind every domain object to unrelated mechanisms and make each difficult to
replace.

## Decision

Identity v1 establishes canonical reference truth. It defines and validates opaque
identifiers for owners, principals, actors, and system instances and resolves the
relationships needed to map actor to principal and owner.

Identity owns no business logic, authorization decision, policy evaluation,
credential, session, or profile content. Authentication adapters may prove claims;
a separate future policy subsystem will make authorization decisions.

Identity publishes versioned domain events through an injected publisher port after
successful state changes. It never invokes downstream services directly and never
depends on an event transport implementation.

Identifiers carry no vendor, location, email, role, or mutable profile meaning.
Canonical records are local-first and owner-exportable.

The following future identifier namespaces are reserved but not implemented in v1:
`OrganizationId`, `WorkspaceId`, `ServiceAccountId`, `PluginId`, and `RobotId`.

## Alternatives

- Embedding email or provider subject IDs would leak mutable vendor identities into
  every object.
- Combining identity, authorization, and business policy would create an oversized
  security subsystem and prevent independent replacement.
- Direct downstream calls would couple canonical reference updates to service
  availability and behavior.
- Arbitrary strings would mix identifier namespaces silently.

## Consequences

Explicit reference types, resolution ports, and committed-fact event contracts are
required. Authentication and authorization remain separate future decisions. The
Object Model may retain stable ownership while credentials and display profiles
change.

Identity identifier contracts remain lower-level primitives. Once the Universal
Object Model is approved, persisted Identity records must conform to Object through
the Identity implementation layer; the identifier-contract package must not import
Object, preventing a dependency cycle.

## Review triggers

Multi-owner organizations, federation, anonymous collaboration, or evidence that the
implemented identity kinds cannot represent owner-controlled use cases.

