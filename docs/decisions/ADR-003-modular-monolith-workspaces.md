# ADR-003: Modular monolith with workspace boundaries

- Status: Accepted
- Date: 2026-08-05

## Context

The repository is a single root Kernel package. AION needs independently testable
subsystems, but currently has no scaling, isolation, or team evidence supporting
distributed services.

## Decision

Adopt a modular monolith repository using npm workspaces. Preserve Kernel v1 as
`packages/kernel`. Future subsystems receive separate packages only after approved
specifications. Executable applications will be composition roots under `apps/`.

## Alternatives

- Keeping all code in one package would make dependency ownership unenforceable.
- Microservices would introduce network, deployment, consistency, and observability
  costs before subsystem boundaries are proven.

## Consequences

Package boundaries can be tested while local development and deployment remain
simple. A package may later move behind a process boundary without changing its
domain contract. Workspaces do not authorize creation of empty future packages.

## Review triggers

Reconsider deployment boundaries only with measured scaling, fault-isolation,
security-isolation, or independent-release requirements.

