# Sprint 2.5 Object Model acceptance criteria

Status: Proposed

## Design approval

- [ ] ADR-007 is accepted.
- [ ] Object Specification is approved.
- [ ] Object API Contract v1 is approved.
- [ ] Relationship Model is approved.
- [ ] Object Lifecycle is approved.
- [ ] Object Event Specification is approved.
- [ ] Object Threat Model and residual decisions are accepted or resolved.

## Future implementation acceptance

- [ ] Every AION domain entity structurally conforms to `AionObjectV1`.
- [ ] No type-specific business logic enters the base Object Model.
- [ ] IDs are canonical UUIDs, immutable, and non-reusable.
- [ ] Ownership, actor, provenance, and revision are mandatory.
- [ ] Metadata extensions cannot override system or domain fields.
- [ ] Relationships, revisions, and events are first-class immutable/versioned Objects.
- [ ] Permission references confer no authority and policy remains external.
- [ ] All writes use expected revision and atomically commit history/events.
- [ ] Domain events describe committed facts and invoke no downstream service.
- [ ] Tombstoned Objects cannot mutate, resurrect, or reuse identity.
- [ ] Runtime types and language-neutral schemas pass shared fixtures.
- [ ] In-memory adapters pass repository and event conformance suites.
- [ ] Import/export round-trips preserve unknown valid extensions and provenance.
- [ ] Architecture tests prevent database, policy, Event Bus, vendor, and domain imports.
- [ ] Threat-model controls are tested or residual risk is explicitly accepted.
- [ ] Full workspace verification passes.

