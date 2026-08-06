# Kernel API v1

Import from `@aion/kernel/kernel/v1`. The root export is a convenience alias during
the single-version Sprint 1 period; integrations should prefer the versioned path.

## `KernelV1`

- `register(participant)` adds a uniquely identified lifecycle participant while the
  Kernel is in `created`.
- `start()` starts participants sequentially in registration order.
- `stop()` stops started participants sequentially in reverse order.
- `snapshot()` returns an immutable lifecycle view.

## Participant contract

`LifecycleParticipantV1` contains an immutable non-empty `id`, an asynchronous
`start(context)` operation, and an asynchronous `stop(context)` operation. The
context exposes an `AbortSignal`; cancellation begins before rollback or shutdown.

Participant operations must be idempotent with respect to their own resources.
The Kernel invokes each operation at most once per Kernel instance.

## Compatibility

Breaking behavioral or type changes require a new import path such as `kernel/v2`.
Additive changes may be made only when existing v1 implementations remain valid.

