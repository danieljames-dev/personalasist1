# ADR-005: Preserve Kernel v1 and clarify cleanup ownership

- Status: Accepted
- Date: 2026-08-05

## Context

The audit found that Kernel v1 rolls back participants whose `start()` completed,
but does not call `stop()` on the participant whose `start()` rejected. Shutdown
failure is terminal and has no retry. No real subsystem participant yet demonstrates
which different semantics are required.

## Decision

Preserve Kernel v1 behavior and compatibility. Clarify that a participant owns
cleanup of resources acquired by its own failed `start()`. Composition must apply
external lifecycle deadlines. Failed-stop retry semantics remain unresolved until
evidence from at least two resource-owning participants exists.

## Alternatives

- Calling `stop()` after any rejected `start()` could help some participants but is a
  breaking behavioral reinterpretation and may invoke stop on invalid state.
- Adding retries/timeouts to v1 would embed policy without evidence.

## Consequences

Kernel v1 remains stable. Participant specifications and conformance tests must prove
failed-start cleanup. A future Kernel v2 requires real use cases, an ADR, coexistence,
and a migration guide.

## Review triggers

Two concrete participants demonstrate common retry, deadline, or failed-start cleanup
behavior that cannot be handled safely by participant/composition policy.

