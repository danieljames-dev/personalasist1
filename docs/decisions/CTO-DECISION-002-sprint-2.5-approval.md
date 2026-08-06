# CTO-DECISION-002: Sprint 2.5 Universal Object Model approval

- Status: Recorded
- Date: 2026-08-06
- Decision authority: Founder / CTO
- Subject: ADR-007 and the Sprint 2.5 Universal Object Model contract family
- Supersedes: Nothing
- Numbering note: No `CTO-DECISION-001` exists in this repository. The identifier was
  assigned by the Founder/CTO directive and is preserved as issued rather than renumbered.

# Decision

Approve ADR-007 after narrowing BI-2 as directed.

The Sprint 2.5 architecture-approval gate is narrowed to the **seven construction-blocking
Architecture Readiness Review changes that have been incorporated**:

| # | Change | Where satisfied |
|---:|---|---|
| 1 | Define Object profiles | `contracts/object-contract-v1.md` §Object profiles; `architecture/object-model.md` §Object profiles |
| 2 | Eliminate relationship dual truth | `contracts/object-relationships.md` §Responsibility |
| 3 | Remove unbounded inherited arrays | `contracts/object-contract-v1.md` §Canonical Entity and Relationship envelope |
| 4 | Narrow the universal API | `contracts/object-contract-v1.md` §Universal operations; `architecture/object-model.md` §Domain mutation boundary |
| 6 | Define the authorization seam | `security/object-threat-model.md` §Authorization boundary |
| 7 | Complete version/integrity rules, other than canonical serialization | `contracts/object-versioning.md` §Schema identity and compatibility, §Canonical serialization and integrity |
| 8 | Constrain atomicity | `architecture/object-model.md` §Commit boundary; `contracts/object-contract-v1.md` §Commit contract |

On that basis:

- **ADR-007 status: Accepted**, dated 2026-08-06.
- **Universal Object Contract: pre-stable.** Not designated stable v1.
- **Implementation freeze: remains in effect.**
- The documentation supersession performed during the Sprint 2.5 review is **ratified**.

Readiness-review changes 5, 7-remainder, 9, and 10 are **not** satisfied and are **not**
waived. They are recorded as enforceable deferred gates DG-1 through DG-4 below.

# Rationale

## Why architecture-boundary approval is distinct from implementation readiness

Approving an architecture answers "is this the right shape?" Authorizing implementation
answers "do we know enough to build it safely?" These are different questions with
different evidence, and conflating them is how unvalidated designs reach production.

The Sprint 2.5 design answers the first question. All four construction-blocking
contradictions identified by the
[Architecture Readiness Review](../reviews/architecture-readiness-review.md) — recursive
Event and Version Objects, dual relationship truth, unbounded envelope collections, and
generic public mutation — are resolved in contract text as invariants rather than as
adapter exceptions. Nothing in the design needs rebuilding. Withholding approval would
not produce better architecture; it would only delay the subordinate decisions that
depend on a settled shape.

It does not answer the second question, and the design says so itself. No owner or actor
can exist yet (DG-1), no digest is reproducible yet (DG-2), no envelope has been validated
against a real Object (DG-3), and no bound is a number (DG-4). Implementation under those
conditions would be guesswork committed to durable storage.

Approving the boundary while holding the freeze is what lets the four subordinate
decisions proceed in parallel against a stable target, instead of each re-litigating the
envelope.

## Why contract stability is a third, separate gate

A contract is stable when its shape can be depended upon across a major version. The
Universal Object Contract has never been instantiated. Its
[stability gate](../contracts/object-contract-v1.md#contract-stability-gate) requires ten
representative Object kinds to round-trip, export, and migrate first.

Freezing before that evidence exists is the OBJ-048 failure in the
[risk register](../sprints/sprint-2.5/risks.md): an unvalidated field shape that requires
a breaking v2 almost immediately. The `v1` in the document title names the contract
family, not a frozen shape, and every status header now says so.

## Why the deferrals are gates and not exceptions

An exception permits work to proceed despite an unmet requirement. A gate blocks specific
work until specific evidence exists. These four are gates. Each names the work it blocks,
the evidence that opens it, and the trigger that forces re-examination. None may be
recorded as met without its evidence, and none is optional.

# Ratified Corrections

## Contradictions corrected

| # | Contradiction | Resolution |
|---:|---|---|
| 1 | Two complete, mutually contradictory Object contracts existed, both labelled normative — differing on lifecycle states (3 vs 7), embedded `relationshipRefs`/`historyRefs`/`eventRefs` vs none, public `update()` vs prohibited, fixed `sha-256` vs algorithm-agile, `AbortSignal` in a language-neutral contract, optional caller-supplied create identity, and atomic endpoint rewrites | Pre-review family marked Superseded; replacement family is sole normative source |
| 2 | `docs/README.md` resolved only to the superseded design; the replacement family was unreachable from any index | Index rebuilt into Decision / Contracts / Security-and-sprint / Superseded groups |
| 3 | `AION_V2_MASTER_PLAN.md` described the rejected envelope, listing typed relationship references and history/event references as base contract fields | Dated amendment defers envelope composition to ADR-007 and the contract family |
| 4 | ADR-007 recorded no supersession, contrary to `GOVERNANCE.md` §Decision lifecycle | §Governing documents and §Superseded design artifacts added |
| 5 | Relationship types naming Actors and owners (`Owns`, `CreatedBy`, `ModifiedBy`, `VerifiedBy`, `ProducedBy`) had no defined endpoint resolution, since endpoints are Object IDs and Actors are `ActorIdV1` | §"Endpoints are Objects, never bare identifiers" added; envelope attribution remains authoritative |
| 6 | Lifecycle state diagram omitted `Active → Deleted` and `Deprecated → Active`, both present in the transition table | Diagram completed; transition table declared normative on conflict |
| 7 | `objectProfile` constraint read as a universal invariant excluding the `version` and `event` profiles | Table scope clarified; field universality stated |
| 8 | Identity namespace boundary unstated; `PrincipalIdV1` and `SystemInstanceIdV1` appeared nowhere in Sprint 2.5 | Object consumes `OwnerIdV1` and `ActorIdV1` only; the other two and the five ADR-006 reserved names are barred |
| 9 | Identifier opacity asserted for Object IDs but not Owner/Actor IDs, with no rule against inferring structure | Explicit opacity clause added |
| 10 | Failure table listed category names with no rule governing wire-code assignment or reuse, and `Not found` / `Authorization evidence required` were separately enumerable | Codes assigned at v1 designation, meanings immutable, removed codes never reused; the two failures must not be distinguishable in a way that confirms existence |

## Supersession ratified

The seven pre-review documents under `docs/sprints/sprint-2.5-object-model/` are
**non-normative historical evidence**. Each carries a Superseded header naming its
replacement, the date, and the reason. Their bodies are preserved verbatim so the review
trail stays auditable. They must not be cited as contracts.

The single normative family is:

- [`docs/architecture/object-model.md`](../architecture/object-model.md)
- [`docs/contracts/object-contract-v1.md`](../contracts/object-contract-v1.md)
- [`docs/contracts/object-lifecycle.md`](../contracts/object-lifecycle.md)
- [`docs/contracts/object-events.md`](../contracts/object-events.md)
- [`docs/contracts/object-relationships.md`](../contracts/object-relationships.md)
- [`docs/contracts/object-versioning.md`](../contracts/object-versioning.md)
- [`docs/security/object-threat-model.md`](../security/object-threat-model.md)
- [`docs/sprints/sprint-2.5/`](../sprints/sprint-2.5/) — specification, acceptance
  criteria, risks

Discoverable from [`docs/README.md`](../README.md) and from ADR-007 §Governing documents.

# Deferred Implementation Gates

Full records — owner, rationale, risk, affected components, blocking gate, required
evidence, review trigger — are held in the
[Sprint 2.5 acceptance criteria](../sprints/sprint-2.5/acceptance-criteria.md)
§Deferred implementation gates. Summary:

| Gate | Matter | Owner | Blocks | Opening evidence |
|---|---|---|---|---|
| **DG-1** | Identity bootstrap | CTO | Implementation of Identity-backed Object creation | Accepted subordinate ADR defining the ceremony, bootstrap actor limits, second-owner injection prevention, recovery, rotation, provenance, and historical identity references — without raw temporary identifiers or implied authorization |
| **DG-2** | Canonical serialization | CTO | Integrity digests, signatures, durable persistence, fixture hashing, cross-runtime conformance | Accepted subordinate ADR fixing canonicalization version, deterministic encoding, digest algorithm registry and agility, and cross-runtime agreement fixtures |
| **DG-3** | Representative fixtures | CTO | Designation of the Object Contract as stable v1 | Language-neutral fixtures for Owner record, Document, Project, Task, Memory, Capability, Workflow, Relationship, Version, and Event Objects proving bounded size, round-trip export, migration, and domain-boundary conformance |
| **DG-4** | Measurable resource and complexity limits | CTO | Production adapters and untrusted ingestion | Approved limits specification fixing maximum envelope, data, metadata, label count, nesting depth, provenance, extension, relationship page, and event sizes, plus benchmarked high-churn, high-degree, large-artifact, migration, export, and restore workloads |

DG-3 depends partly on DG-2: any fixture carrying a digest cannot be authored until
canonicalization is fixed.

These are not completed requirements, not approved exceptions without controls, and not
optional future enhancements.

# Authorization Boundary

## Authorized by this decision

- subordinate architectural decisions;
- language-neutral schemas;
- representative fixtures;
- failing contract and conformance tests;
- deterministic test adapters;
- further design validation.

## Not authorized by this decision

- production Object implementation;
- Identity implementation;
- persistence adapters;
- databases;
- Event Bus implementation;
- Planner implementation;
- Memory implementation;
- Knowledge Graph implementation;
- Workflow Engine implementation;
- Capability Registry implementation;
- plugins;
- agents;
- user interfaces;
- external integrations.

The implementation freeze remains in effect. No artifact produced under this decision
lifts it; only a separate recorded CTO decision can. Producing a failing conformance test
or a deterministic test adapter is design validation, not implementation, and must not be
used to introduce production behaviour by increment.

Also unauthorized by this decision and still outstanding at the time of recording:

- **Push to the configured remote.** `origin` is
  `https://github.com/danieljames-dev/personalasist1.git`, which does not name Project
  AION. Owner confirmation of the canonical repository is required before any push.
- **Any write to `D:\AION-backups` or elsewhere on the external drive.** Explicit
  backup-root approval is required.

# Verification Evidence

Recorded from actual command output. No evidence below is inferred.

```
$ npm run verify
> aion-platform@0.2.0 verify
> npm run typecheck && npm test

> @aion/kernel@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json --noEmit

> @aion/kernel@0.1.0 test
> npm run build && npm run build:test
>   && node --test "dist-test/test/**/*.test.js" "test/**/*.test.mjs"

# tests 11
# suites 1
# pass 11
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

| Check | Result |
|---|---|
| TypeScript production typecheck (`tsconfig.json --noEmit`) | Clean, 0 diagnostics |
| TypeScript test typecheck (`tsconfig.test.json --noEmit`) | Clean, 0 diagnostics |
| Build (`tsc -p tsconfig.json`, `tsc -p tsconfig.test.json`) | Pass |
| `AionKernelV1` unit tests | 9 of 9 pass |
| Architecture boundary test — "Kernel source has no external or cross-subsystem imports" | Pass |
| Package-consumer test — "published versioned export is consumable" | Pass |
| `npm run verify` | **Pass — 11 of 11, 0 failures** |
| Production code modified | **None.** `packages/`, `package.json`, `package-lock.json`, and `tsconfig*.json` untouched |
| Implementation generated | **None** |
| Secrets, credentials, tokens, keys, machine-specific paths | **None detected** across all changed and untracked files |

## What this evidence does not establish

No test exercises the Universal Object Model, because none exists and none is authorized.
The passing suite covers the Kernel only. `npm run verify` runs strict type checking and
tests; the repository has **no** linter, formatter, or documentation link checker, so no
configured check inspects the Markdown changed by this decision. Documentation
consistency was verified by review, not by tooling.

# Follow-up Decisions

Required next, in dependency order:

1. **Canonical serialization ADR** (opens DG-2). Blocks DG-3 fixtures that carry digests,
   all integrity and signing work, and cross-runtime conformance. Highest leverage
   because the largest number of downstream artifacts cannot be authored correctly
   without it.
2. **Identity bootstrap ADR** (opens DG-1). Blocks any persisted Object, since no Owner
   or Actor can exist. Independent of DG-2 and may proceed in parallel.
3. **Representative Object contract fixtures** (opens DG-3, gates stable v1). Partly
   blocked by DG-2.
4. **Measurable Object limits specification** (opens DG-4). Blocks production adapters and
   untrusted ingestion. Requires benchmark evidence on representative local hardware.

Also outstanding, outside the deferred gates:

- UUID generation profile and entropy requirements (ADR-007 subordinate decision 2).
- Deletion, destruction, retention, and backup-erasure evidence by data class (subordinate
  decision 6; `object-lifecycle.md` §Destroyed requires its own ADR).
- Portable aggregate commit and outbox conformance semantics (subordinate decision 7).
- Plugin validator and migration isolation; namespace ownership governance.
- Signing and authenticity for schemas, events, exports, and releases.
- Owner confirmation of the canonical remote repository.
- Owner approval of the external backup root, and a backup design that includes a restore
  test before any backup is recorded as successful.
- Documentation link checking in future CI, per
  [repository-status.md](../reviews/repository-status.md) recommendation 3.

# Review triggers

- Any representative fixture that cannot conform without violating its domain's
  responsibility.
- Envelope size or write amplification failing an approved local-device benchmark.
- A multi-owner, organization, or federation requirement arriving before the version 1
  ownership seam is exercised.
- A bounded domain demonstrating a justified need for event sourcing.
- Any request to lift the implementation freeze, designate the contract stable v1, or
  record a deferred gate as met.
