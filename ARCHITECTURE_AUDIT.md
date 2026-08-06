# Project AION Architecture Audit

Status: Baseline audit  
Date: 2026-08-05  
Scope: Repository contents at the start of the AION v2 planning cycle

## Executive assessment

AION is currently a small, coherent Kernel library—not yet an Intelligence
Operating System. The Kernel is worth preserving: it has a narrow responsibility,
a versioned TypeScript API, explicit lifecycle behavior, two ADRs, no runtime
dependencies, and nine passing tests. No evidence supports rewriting it.

The repository lacks the platform-level contracts and engineering controls needed
for the v2 vision. Identity, the Object Model, Memory, Knowledge Graph, Event Bus,
Planner, Capability Registry, Workflow Engine, Workers, Dashboard, integrations,
and a composition root do not exist. Governance, CI, threat modeling, contract
schemas, release policy, and recovery guarantees are also absent.

The correct next move is incremental: preserve Kernel v1, establish platform-wide
contracts and governance, validate lifecycle edge cases, then add one subsystem at
a time behind ports.

## Evidence reviewed

- All repository files outside generated `dist/` and `node_modules/`.
- `npm ls --all`: TypeScript and Node type definitions are the only dependencies;
  there are no runtime dependencies.
- `npm test`: 9 tests passed, 0 failed on Node 22.18.0.
- Kernel source, public declarations, package exports, ADRs, architecture notes,
  Sprint 1 specification, and acceptance criteria.
- Repository environment: no `.git` directory is present.

## Current architecture

```text
Consumer
   |
   v
Kernel v1
   |
   +-- LifecycleParticipantV1[]

No composition root or other AION subsystem exists.
```

The Kernel registers participants, starts them sequentially, stops them in reverse
order, rolls back successfully started participants after startup failure, exposes
an immutable snapshot, and communicates cancellation through `AbortSignal`.

## Strengths

1. **Focused responsibility.** `AionKernelV1` coordinates lifecycle only; it does
   not act as a service locator or contain domain behavior.
2. **Explicit version boundary.** Consumers can import `@aion/kernel/kernel/v1`,
   and breaking changes are documented as requiring a new versioned path.
3. **Deterministic behavior.** Startup and shutdown ordering are simple and tested.
4. **Failure preservation.** Startup and shutdown errors retain underlying causes;
   cleanup failures are aggregated rather than silently discarded.
5. **Replaceable participants.** The Kernel depends on a small behavioral port,
   not concrete future components.
6. **Strict compiler baseline.** Strict mode plus unchecked-index and exact-optional
   checks catch useful classes of errors.
7. **Minimal supply chain.** There are no production dependencies or model/vendor
   integrations.
8. **Architecture records exist.** The implemented decisions have corresponding
   ADRs and API documentation.

## Weaknesses

### Platform structure

- The root package is named `@aion/kernel`; it cannot cleanly become the platform
  composition root while also remaining the reusable Kernel package.
- There is no package boundary for contracts, domain objects, adapters, or apps.
- The documentation index covers only Sprint 1 and is not a system architecture.
- No machine-readable public contracts exist outside TypeScript declarations.

### Kernel behavior

- A participant that allocates resources and then rejects from `start()` is not
  passed to `stop()`. The contract does not clearly require failed startup to clean
  up its own partial work. This can leak resources.
- A failed `stop()` leaves the Kernel terminally failed with the participant still
  marked started, but v1 provides no retry or forced-cleanup operation.
- No lifecycle timeout exists. A participant can block startup, rollback, or
  shutdown indefinitely.
- Cancellation uses one signal for both operational cancellation and cleanup. The
  signal is already aborted when `stop()` runs, which may be misinterpreted by a
  participant as permission to skip cleanup.
- Runtime validation covers identifiers but not malformed participant values.
- Explicit registration order is sufficient today, but no composition-layer rule
  documents how future subsystem dependencies produce that order.

### Delivery and maintenance

- The test script names one compiled test file directly; new test files would not
  run automatically.
- Tests compile into the same `dist/` tree as library output, even though packaging
  filters them out.
- No linting, formatting check, coverage threshold, API extraction, or dependency
  boundary enforcement exists.
- There is no CI pipeline or reproducible release process.
- The workspace is not a Git repository, so ADR and change history cannot yet be
  protected through review.
- `package.json` is `UNLICENSED`, but there is no explicit `LICENSE` or contribution
  governance.

## Technical debt register

| ID | Debt | Severity | Evidence | Recommended disposition |
|---|---|---:|---|---|
| TD-001 | Partial startup can leak resources | High | Failed participant is added to the started set only after `start()` resolves | Specify participant cleanup duty; test it; consider Kernel v2 only if needed |
| TD-002 | Cleanup cannot be retried | High | `failed` is terminal and failed stops remain started | Define recovery semantics via ADR before changing v1 |
| TD-003 | Lifecycle calls can hang forever | High | No deadline or timeout contract | Put time policy at composition boundary; do not hardcode it into v1 |
| TD-004 | Test discovery is brittle | Medium | Script targets `kernel-v1.test.js` | Introduce repository-wide test discovery during tooling migration |
| TD-005 | Root package conflates repository and Kernel | Medium | Root package name is `@aion/kernel` | Move unchanged Kernel into a workspace package incrementally |
| TD-006 | Only language-specific contracts exist | Medium | Public types are TypeScript only | Add JSON Schema/OpenAPI/AsyncAPI where cross-process boundaries emerge |
| TD-007 | No automated architecture enforcement | Medium | Imports are controlled only by convention | Add dependency rules and architecture tests |
| TD-008 | No project history or review mechanism | High | No `.git` directory | Initialize source control and protected review workflow with owner approval |
| TD-009 | Documentation governance is incomplete | Medium | Only two ADRs and Kernel docs exist | Add templates, decision index, glossary, and ownership |
| TD-010 | No licensing decision | Medium | `UNLICENSED`; no `LICENSE` | Founder must select licensing strategy before external distribution |

## Missing abstractions

These are missing boundaries, not permission to implement them immediately:

1. **Identity port:** stable owner, actor, principal, and authorization-subject IDs.
2. **Universal Object Model:** versioned object identity, metadata, ownership,
   relationships, permissions, history references, and provenance.
3. **Repository and Unit of Work ports:** persistence semantics independent of a
   database vendor.
4. **Event contracts:** immutable envelope, causation, correlation, provenance,
   schema version, delivery semantics, and idempotency.
5. **Clock and identifier ports:** deterministic tests and portable ID generation.
6. **Policy decision port:** authorization decisions separated from enforcement.
7. **Memory contracts:** typed memory records, provenance, confidence, retention,
   export, deletion, and retrieval policies.
8. **Knowledge Graph port:** relationships and queries without choosing a graph
   database.
9. **Capability contracts:** descriptors, invocation, results, permissions,
   resource limits, and conformance.
10. **Model provider port:** model discovery and invocation without fixed model or
    vendor names.
11. **Workflow contracts:** goal, plan, task, execution, validation, approval, and
    recovery state machines.
12. **Observability ports:** structured log, metric, trace, and audit-event sinks.
13. **Composition root:** the only place concrete adapters and lifecycle order are
    selected.

## Dependency issues

Current dependency risk is low because there are no runtime packages. The larger
problem is that dependency policy is undocumented and unenforced.

The target rule should be inward dependency toward stable contracts:

```text
apps/adapters -> subsystem application layer -> subsystem domain/contracts
                                            -> platform contracts
Kernel -> lifecycle contract only
```

The architectural direction in the directive is a build sequence, not permission
for every lower layer to import every higher layer. In particular, Memory and the
Knowledge Graph must not become coupled implementations, and the Event Bus must not
own domain objects. These boundaries require ADRs before implementation.

## Testing gaps

- No test covers a participant that partially initializes before rejecting.
- No test covers never-resolving lifecycle methods or external cancellation.
- No mutation/property testing exists for transition invariants.
- No package-export consumer test verifies the published artifact.
- No compatibility test protects v1 declaration shape.
- No architecture test prevents forbidden imports.
- No security, fuzz, performance, soak, recovery, migration, or backup test exists.
- No end-to-end test can exist yet because there is no application composition.

Nine passing unit tests establish confidence in documented happy paths and common
failures, but they do not establish production readiness for a long-running host.

## Security concerns

1. There is no threat model, asset inventory, trust-boundary map, or abuse-case set.
2. Identity, authentication, authorization, consent, and audit semantics are absent.
3. There is no owner-data export, deletion, encryption, retention, or backup policy.
4. Plugin/capability isolation and permission grants are unspecified.
5. There is no secrets-management boundary.
6. Dependency scanning, provenance, lockfile review, and build attestation are absent.
7. Lifecycle participant IDs may enter future logs; logging classification and
   redaction rules are not defined.

The current Kernel handles no owner data and exposes no network interface, so its
immediate attack surface is small. Risk grows sharply as soon as persistence,
plugins, model providers, or external integrations are introduced.

## Quick wins

1. Ratify the v2 architecture, vocabulary, and dependency rules through ADRs.
2. Initialize source control and CI, if approved by the owner.
3. Convert the repository into workspaces while moving Kernel code without behavior
   changes; verify package contents before and after.
4. Add ADR, specification, threat-model, and interface templates.
5. Make test discovery automatic and add package-consumer and API-compatibility tests.
6. Clarify failed-start cleanup and shutdown-retry semantics before registering real
   subsystems.
7. Define the Object Model as a minimal contract and validate it with representative
   objects before selecting storage.

## Long-term risks

- **God Object Model:** forcing runtime concerns and every data shape into one base
  class would centralize coupling. Treat “everything is an Object” as a persistent
  domain-resource contract with composition and extension points, subject to ADR.
- **Kernel accretion:** adding lookup, policy, events, or orchestration to the Kernel
  would make it irreplaceable and untestable.
- **Event-driven opacity:** events without ownership, schemas, correlation, and
  idempotency become a distributed monolith that is difficult to debug.
- **Memory without provenance:** derived facts can become indistinguishable from
  owner-provided facts, eroding trust and safe deletion.
- **Capability privilege creep:** reusable capabilities can become an ambient
  authority layer unless every invocation is policy-scoped and audited.
- **Planner overreach:** planning and execution must remain separated, with explicit
  approval policies for consequential actions.
- **Premature distribution:** microservices would add operational failure modes before
  subsystem boundaries are proven. Start as a modular monolith.
- **Schema stagnation:** universal objects and events require tested migrations and
  compatibility windows from their first persisted release.
- **Vendor leakage:** provider-specific concepts can contaminate Memory, Planner, and
  Workflow contracts unless isolated in adapters.
- **Unbounded autonomy:** continuous learning must never silently become continuous
  system modification; code/config changes require review and audit.

## Audit conclusion

Preserve Kernel v1. Do not add new behavior to it during the v2 foundation work.
Before another production subsystem, establish governance, platform contracts,
security requirements, repository boundaries, and lifecycle recovery decisions.

