# Sprint 1 acceptance criteria

- [x] Architecture and implementation decisions precede the Kernel source.
- [x] The Kernel has one documented responsibility.
- [x] Public exports are available from `kernel/v1`.
- [x] Duplicate and invalid participant identifiers are rejected.
- [x] Registration is closed after startup begins.
- [x] Participants start sequentially in registration order.
- [x] Participants stop sequentially in reverse startup order.
- [x] Partial startup is rolled back in reverse order.
- [x] Shutdown and rollback attempt all required cleanup operations.
- [x] Failures retain their causes and leave an observable terminal state.
- [x] Snapshots cannot mutate Kernel state.
- [x] No non-Kernel AION component is implemented.
- [x] Type checking, build, and automated tests pass.

