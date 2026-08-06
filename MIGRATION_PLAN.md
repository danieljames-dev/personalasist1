# AION v2 Migration Plan

Status: Proposed for founder approval  
Date: 2026-08-05

## Migration objective

Evolve the existing Kernel package into the foundation of AION v2 without rewriting
working behavior, silently breaking `kernel/v1`, or introducing multiple subsystems
at once.

## Migration rules

1. Preserve behavior before improving structure.
2. Every architectural change requires an ADR approved before code changes.
3. Each step must leave the repository buildable and testable.
4. Use expand-migrate-contract: add the new path, migrate consumers, verify, then
   deprecate old paths. Do not perform flag-day migrations.
5. Persisted formats receive forward migration, backup, rollback, and verification.
6. No adapter becomes the domain contract.
7. Kernel v1 stays supported until a measured incompatibility justifies v2.

## Current-to-target mapping

| Current asset | Target location/concept | Migration method |
|---|---|---|
| Root `@aion/kernel` package | `packages/kernel` workspace | Move without source changes; compare build and package exports |
| `src/kernel/v1` | Kernel package public API | Preserve versioned path and declarations |
| `test/kernel-v1.test.ts` | Kernel unit/conformance tests | Move intact, then add package-consumer coverage |
| Kernel docs and ADRs | Versioned architecture documentation | Preserve links with redirects/index updates |
| Root TypeScript config | Shared build preset plus package config | Extract only after output-equivalence test |
| Root README | Platform README | Replace Kernel-specific scope after Kernel package owns its README |
| Founder charter | Governance authority | Preserve at root and reference from plans/reviews |

## Stage 0: Freeze and baseline

### Changes

- Initialize source control only with explicit owner approval.
- Record hashes/package contents and the current nine-test result.
- Add a repository inventory and generated-file policy.
- Approve licensing, contribution, security-reporting, and decision governance.

### Verification

- `npm test`, type checking, and package dry-run reproduce the baseline.
- Kernel v1 declaration and runtime exports are captured as compatibility fixtures.

### Rollback

No runtime changes occur. Revert documentation/tooling files independently.

## Stage 1: Introduce workspace boundaries

### Expand

- Add root workspace configuration and shared non-runtime tooling.
- Copy the existing Kernel package into `packages/kernel` without behavior changes.
- Add package-consumer tests against the versioned export.

### Migrate

- Point root scripts and documentation at the workspace package.
- Verify source maps, declarations, errors, and all lifecycle tests.

### Contract

- Remove the duplicate root Kernel source only after byte/API/behavior checks pass.
- Keep the published/import identity `@aion/kernel/kernel/v1` unchanged.

### Rollback

Restore root scripts and source path; no data migration is involved.

## Stage 2: Establish platform contracts package

### Expand

- Create `packages/contracts` containing only language-neutral schemas, fixtures,
  compatibility rules, and generated-type policy.
- Specify IDs, timestamps, provenance, errors, ownership, actor references, and
  schema versioning through ADRs.

### Migrate

- No Kernel changes. New subsystems consume contracts through declared versions.

### Contract

- Remove duplicated primitive schemas only after all consumers pass conformance.

### Rollback

Contracts are additive at this stage; abandon unaccepted versions without affecting
Kernel v1.

## Stage 3: Identity and Object Model

### Expand

- Add Identity and Object Model packages behind ports.
- Begin with in-memory adapters and representative fixtures.
- Define permission references but keep authorization policy outside domain objects.

### Migrate

- There is no existing domain data. Validate fixture migrations and compatibility
  before the first owner record is persisted.
- Register lifecycle participants only if they truly own runtime resources.

### Contract

- Freeze v1 object schemas only after adversarial review and round-trip testing.

### Rollback

Before persistent release, discard provisional schemas. After persistence, require
export, backup, and reverse/forward migration tests.

## Stage 4: Memory

### Expand

- Add Memory domain and repository ports first.
- Implement an in-memory conformance adapter, then select a local durable adapter
  using recorded workloads and an ADR.
- Support dual-read/dual-write migration only when changing persisted adapters.

### Migrate

- Import owner data through validated, provenance-preserving import jobs.
- Reconcile counts, hashes, ownership, relationships, and versions before cutover.

### Contract

- Retire old stores only after owner export, restore, deletion, and rollback tests.

### Rollback

Retain pre-migration backup and old read path until reconciliation is complete.

## Stage 5: Knowledge Graph and Event Bus

### Expand

- Build both as separate ports and packages; neither owns the other's storage.
- Start with in-process delivery and graph projections from committed object changes.
- Add an outbox/inbox boundary before any durable asynchronous adapter.

### Migrate

- Backfill graph projections and events from authoritative object/memory history with
  idempotent jobs and checkpoints.
- Shadow-read graph results against source queries before switching consumers.

### Contract

- Remove direct cross-package notifications only after event conformance and replay
  tests pass.

### Rollback

Rebuild projections from authoritative history; disable new consumers independently.

## Stage 6: Planner and model providers

### Expand

- Add evidence/decision contracts and a deterministic provider for tests.
- Add vendor adapters only outside Planner, selected at runtime by policy.
- Run Planner in recommendation-only shadow mode.

### Migrate

- Compare recommendations with owner decisions; measure usefulness, evidence quality,
  latency, and cost without granting execution authority.

### Contract

- Enable planning workflows only after acceptance thresholds and approval UX exist.

### Rollback

Disable Planner recommendations; stored objects and workflow state remain valid.

## Stage 7: Capability Registry and Workflow Engine

### Expand

- Register read-only local capabilities first.
- Add durable workflow state, simulation, idempotency, validation, and approval gates.
- Run new workflows alongside manual owner processes.

### Migrate

- Convert validated recurring processes into versioned workflow definitions one at a
  time. Never translate every script or procedure automatically.

### Contract

- Retire manual paths only when the owner accepts recovery and audit evidence.

### Rollback

Pause workflows, revoke capability grants, and resume from owner-readable state.

## Stage 8: Workers, Dashboard, and integrations

### Expand

- Add temporary worker coordination after capability and workflow contracts stabilize.
- Add Dashboard as a client of platform APIs, never a canonical store.
- Add each integration as a revocable adapter with independent credentials and scopes.

### Migrate

- Expose one bounded owner journey at a time.
- Keep external writes in dry-run or approval-required mode until explicitly promoted.

### Contract

- Remove provisional operator tools only after Dashboard parity and accessibility,
  security, export, and emergency-stop testing.

### Rollback

Revoke integration credentials and worker leases; canonical local data remains.

## Kernel-specific compatibility plan

Kernel v1 remains unchanged during Stages 0–2. Before any v2 proposal:

1. Document whether a failed participant must self-clean partial startup.
2. Test lifecycle deadlines and stop failure recovery at the composition layer.
3. Gather evidence from at least two real lifecycle participants.
4. Prefer wrappers/policies outside Kernel v1 when they satisfy the need.
5. If v2 is necessary, publish `kernel/v2` beside v1 with a conformance matrix and
   consumer migration guide. Never reinterpret v1 silently.

## Migration completion criteria

- Every target subsystem is independently packaged, tested, documented, and owned.
- No public v1 consumer is broken without a published migration path.
- All owner data passes export, restore, provenance, ownership, and deletion checks.
- Architecture tests enforce allowed dependencies.
- Vendor adapters can be removed without migrating domain state.
- The owner can stop work, revoke authority, inspect evidence, and recover workflows.

