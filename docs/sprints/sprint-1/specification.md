# Sprint 1 specification: Kernel

## Objective

Deliver the smallest production-quality AION Kernel boundary: a deterministic,
versioned, model-agnostic lifecycle coordinator.

## In scope

- Kernel v1 public types and implementation;
- registration and immutable state inspection;
- ordered startup, reverse shutdown, and startup rollback;
- structured Kernel errors;
- unit tests and API/architecture documentation.

## Out of scope

All other AION components, application bootstrapping, process signal handlers,
configuration, persistence, networking, telemetry integrations, model providers,
and plugin loading.

## Constraints

- The Kernel must import no future AION component.
- The public contract must be versioned.
- Participant failures must preserve their original causes.
- Cleanup must be best-effort and report all failures.
- The implementation must have no runtime dependencies.

