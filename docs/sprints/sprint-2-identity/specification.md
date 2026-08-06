# Sprint 2 specification: Identity contracts

Status: Approved with CTO amendments  
Owner: Founder  
Component: Identity

## Problem and evidence

The approved architecture places Identity before the Universal Object Model because
every persistent object requires ownership and history attribution. Kernel participant
strings are lifecycle names, not owner or security identities.

## Responsibility

Identity has one responsibility: establish canonical reference truth by issuing,
validating, and resolving stable opaque references for AION owners and actors.

## Goals

- Define versioned Owner, Principal, Actor, and System Instance identifiers.
- Define canonical identity records and actor-to-principal-to-owner relationships.
- Provide replaceable clock, ID-generator, repository, resolution, and event ports.
- Publish committed, versioned Identity domain events without downstream invocation.
- Support deterministic tests, owner export, correction, disablement, and history.
- Provide runtime and language-neutral contract fixtures.

## Non-goals

- Passwords, authentication protocols, sessions, tokens, or secrets.
- Authorization decisions, roles, permissions, capability grants, or policy.
- Business rules belonging to Objects, workflows, products, or other domains.
- Contacts, biographies, preferences, or profile/CRM content.
- Direct invocation of Memory, an Event Bus implementation, or any downstream service.
- Remote federation, organization tenancy, UI, or external providers in v1.

## Public contract v1

Implemented identifier namespaces:

- `OwnerIdV1`: the person or owner-controlled legal entity that owns data.
- `PrincipalIdV1`: an accountable subject to which authentication claims may resolve.
- `ActorIdV1`: the immediate initiator recorded on actions and history.
- `SystemInstanceIdV1`: one AION installation without device/vendor meaning.

Reserved, not implemented in v1:

- `OrganizationId`
- `WorkspaceId`
- `ServiceAccountId`
- `PluginId`
- `RobotId`

Reservation prevents current extension namespaces from claiming these names. It does
not authorize records, ports, schemas, or runtime behavior for them.

An `IdentityRecordV1` contains its ID, kind, owner ID, lifecycle status, timestamps,
revision, and provenance. Once the Universal Object Model is accepted, persisted
Identity records conform to it. Human-readable profile data remains a separate Object.

Required ports:

- `IdentityIssuerV1`: issues identifiers through injected generator and clock ports.
- `IdentityRepositoryV1`: stores records without exposing a database.
- `IdentityResolverV1`: resolves actor -> principal -> owner with explicit failures.
- `IdentityValidatorV1`: validates namespace, kind, syntax, and invariants.
- `IdentityEventPublisherV1`: accepts committed Identity events and exposes no
  subscription, routing, transport, or downstream behavior.

Ports are asynchronous and accept cancellation. Stable error codes reveal no storage
or authentication-provider details.

## Invariants

1. IDs are globally unique, opaque, immutable, non-reusable, and kind-safe.
2. Every principal, actor, and system instance resolves to exactly one owner in v1.
3. An identity may be disabled but never silently reassigned or reused.
4. Record changes increment revision and retain attribution/provenance.
5. Display names, emails, roles, and vendor subjects never become canonical IDs.
6. Repository adapters cannot alter domain validation semantics.
7. Events describe committed facts and never request downstream work.
8. Identity never calls downstream services as a consequence of state change.
9. Identity owns no policy, authorization, or non-identity business decision.

## Domain events

Identity publishes committed-fact events such as `IdentityIssuedV1`,
`IdentityDisabledV1`, and `IdentityRelationshipChangedV1`. Events use the approved
Object Event contract once available. Consumers react independently; Identity has no
knowledge of them.

Durable persistence must use an atomic outbox or an equivalently proven boundary so a
committed record cannot silently lose its event. That mechanism requires an adapter
ADR and is not part of the Identity domain.

## Data ownership and lifecycle

Identity records are owner-controlled local data. Export includes records,
relationships, provenance, revisions, and lifecycle status. Deletion must reconcile
owner rights with referential and audit integrity before persistence is implemented.

## Security

The contract fails closed on unknown, disabled, wrong-kind, malformed, or cross-owner
references. An identifier is not proof of authentication and must never be treated as
a credential. See [threat model](threat-model.md).

## Failure and recovery

Issuance is atomic: no successful response without a committed record and no ID reuse
after ambiguous failure. Repository, not-found, invalid, disabled, conflict, and event
publication outcomes remain distinguishable. Import and recovery preserve IDs and
revisions exactly.

## Test plan

- Contract fixtures for every implemented kind and failure code.
- Property tests for uniqueness, opacity, non-reuse, and kind separation.
- Repository conformance using an in-memory reference adapter first.
- Cancellation, concurrency, duplicate, disabled, and wrong-owner cases.
- Export/import round-trip and schema migration tests.
- Event tests for committed-fact semantics and idempotent publication metadata.
- Architecture tests preventing authentication, policy, vendor, and downstream imports.

## Delivery slices

1. Reconcile Identity records with the approved Universal Object Model.
2. Add exact v1 schemas, fixtures, and failing conformance tests.
3. Implement pure validation and deterministic ID/clock test adapters.
4. Implement an in-memory repository and event collector only.
5. Do not choose durable storage or implement reserved namespaces.

## Sprint 3 Phase 4 local-bootstrap amendment

The Founder/CTO Sprint 3 vertical-slice decision authorizes one narrower prerequisite before full
Identity Entity Objects: a local single-owner opaque reference state. That state uses the four
approved identifier namespaces and three approved relationships but is not a Universal Object and
does not claim completion of the broader Sprint 2 delivery slices, event/outbox design, import,
recovery, rotation, lifecycle mutation, or full repository conformance.

For this bounded bootstrap only, an ignored filesystem adapter is approved beneath
`private/identity/`. It must use the Phase 3 path boundary, exclusive initialization, atomic
no-overwrite installation, exact validation, explicit status/export operations, and deterministic
synthetic tests. Authentication, authorization, profiles, reserved namespaces, multiple owners,
remote access, and Universal Object implementation remain prohibited.
