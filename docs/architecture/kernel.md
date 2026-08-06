# Kernel architecture

Status: Accepted for Sprint 1

## Responsibility

The Kernel has one responsibility: coordinate the deterministic lifecycle of
independently replaceable participants inside one AION process.

It owns:

- participant registration before startup;
- lifecycle state transitions;
- sequential startup in registration order;
- reverse-order shutdown;
- reverse-order rollback after partial startup failure; and
- cancellation notification when shutdown or rollback begins.

It does not own domain behavior, dependency injection, event transport, storage,
planning, capability discovery, plugins, knowledge, authorization, UI behavior,
process signals, configuration loading, or model selection.

## Boundary

Participants implement the versioned `LifecycleParticipantV1` port. The Kernel
knows only the participant identifier and `start`/`stop` operations. Consequently,
future components can be replaced without changing the Kernel.

Registration order is the composition root's explicit startup order. The Kernel
does not infer a dependency graph. A future requirement for dependency resolution
would require a new ADR and a compatible contract revision.

## State machine

```text
created --start--> starting --success--> running --stop--> stopping --> stopped
                        |                    |                 |
                        +--failure---------->+----------------> failed
```

`failed` and `stopped` are terminal in v1. Registration is allowed only in
`created`. Startup and shutdown are serialized, and invalid transitions fail
without invoking participants.

## Failure semantics

If startup fails, every participant that started successfully is stopped in
reverse order. Rollback attempts all eligible stops even if one fails. The Kernel
enters `failed` and reports the startup cause plus any rollback failures.

Normal shutdown also attempts every stop in reverse order. Any stop failures are
reported together and leave the Kernel in `failed`; otherwise it enters `stopped`.

## Security and ownership

The Kernel grants no capabilities and moves no owner data. Its public snapshot is
immutable and contains only lifecycle state and participant identifiers. Concrete
security policy belongs behind a future component boundary.

## Observability

The immutable snapshot is the Sprint 1 observability surface. Logging and telemetry
providers are deliberately excluded until their vendor-neutral ports are specified.

