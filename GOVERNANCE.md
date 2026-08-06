# AION Governance

## Authority

The founder owns product mission, licensing, data-control policy, and final approval
of architectural direction. Maintainers own implementation decisions within approved
specifications and ADRs.

## Required artifacts

Every production feature requires:

1. an approved specification and acceptance criteria;
2. an ADR when architecture or a public contract changes;
3. a threat-model update when assets, permissions, or trust boundaries change;
4. automated tests and user-facing/engineering documentation; and
5. a migration and rollback plan for persisted or public behavior.

## Decision lifecycle

ADRs progress through Proposed, Accepted, Superseded, or Rejected. Accepted ADRs are
immutable except for status and links; changed decisions receive a new ADR. Evidence,
alternatives, consequences, and review triggers are mandatory.

## Compatibility

Public interfaces and persisted schemas are versioned. Breaking changes require a
new major contract, coexistence period, migration guide, and rollback path.

## Approval boundaries

Planning approval does not waive feature-level gates. Consequential external actions,
owner-data policy changes, licensing, and reduced approval requirements always return
to the founder for explicit approval.

