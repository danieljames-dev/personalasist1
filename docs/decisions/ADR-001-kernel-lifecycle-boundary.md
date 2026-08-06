# ADR-001: Kernel lifecycle boundary

- Status: Accepted
- Date: 2026-08-05

## Context

AION needs a stable center without creating a central object that accumulates every
system responsibility. Its future components require predictable startup, cleanup,
and failure behavior while remaining replaceable and independently testable.

## Decision

The first Kernel is a lifecycle coordinator only. It accepts participants through a
versioned port, starts them sequentially in explicit registration order, stops them
in reverse order, and rolls back partial startup. Terminal instances cannot restart.

## Alternatives considered

- A service locator was rejected because it hides dependencies and couples all
  components to the Kernel.
- A dependency graph was deferred because Sprint 1 has no evidence that graph
  resolution is necessary; explicit composition order is sufficient and testable.
- Concurrent startup was rejected because it makes ordering and rollback ambiguous.

## Consequences

Composition remains explicit and deterministic. Applications must create a new
Kernel instance to restart. Adding orchestration, dependency resolution, or service
lookup later requires another ADR rather than expanding this responsibility silently.

