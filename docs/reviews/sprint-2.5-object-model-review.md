# Sprint 2.5 Object Model Review

Review subject: Universal Object Model contract family and ADR-007  
Reviewer role: Principal Architect / CTO design authority  
Date: 2026-08-06  
Decision scope: Documentation and architecture readiness only. No implementation
authorization is requested, granted, or implied by this review.

> **Disposition — 2026-08-06.** The Founder/CTO accepted this review's
> APPROVE WITH CHANGES recommendation and resolved BI-2 by narrowing the
> architecture-approval gate to the seven incorporated construction-blocking changes,
> with the four remaining matters recorded as enforceable deferred gates DG-1 through
> DG-4. The supersession was ratified. **ADR-007 is now Accepted**; the Universal Object
> Contract remains **pre-stable**; the implementation freeze remains in effect. See
> [CTO-DECISION-002](../decisions/CTO-DECISION-002-sprint-2.5-approval.md). This review
> is retained as written, as the evidence behind that decision — statements below
> describing ADR-007 as Proposed or BI-2 as open reflect the state at review time.

# Executive Summary

Sprint 2.5 was interrupted mid-flight. The interrupted session produced a complete
replacement contract family for the Universal Object Model but did not finish the
completeness and scope audit. This review completes it.

The replacement design is materially correct. It resolves all four construction-blocking
contradictions raised by the [Architecture Readiness Review](architecture-readiness-review.md):
recursive Event and Version Objects, dual relationship truth, unbounded envelope
collections, and generic public mutation. Seven of the review's ten required changes are
fully incorporated; three are explicitly deferred behind named seams and blocking-decision
registers rather than silently dropped.

One blocking defect was found and corrected during this review. **The superseded
pre-review design was still present, still labelled `Proposed normative contract`, and
was the only Object design reachable from `docs/README.md`.** The repository therefore
contained two live, mutually contradictory Object contracts — the exact multiple-sources-of-truth
failure the design itself prohibits, reproduced at the documentation layer. A reader
following the documentation index would have received the rejected design.

Verification passes: strict type checking clean, 11 of 11 tests passing, no production
code touched, no secrets or machine-specific paths in tracked or untracked content.

Recommendation: **APPROVE WITH CHANGES**. ADR-007 remains **Proposed**.

# Repository State

Inspected before any modification.

| Item | Finding |
|---|---|
| Branch | `main` |
| Upstream | `origin/main`, tracking configured |
| Remote | `origin` → `https://github.com/danieljames-dev/personalasist1.git` (fetch and push) |
| Sync at inspection | 0 ahead, 0 behind — synchronized at `8925ed3` |
| Local commits not pushed | None |
| Working tree at inspection | 1 modified tracked file, 11 untracked files, 0 staged |
| Implementation files modified | **None.** `packages/`, `tsconfig*.json`, `package.json`, and lockfile were untouched |
| Secrets / credentials | None detected. All pattern matches were policy prose in `SECURITY.md`, `BACKLOG.md`, `docs/operations/backup-strategy.md`, and threat models |
| Machine-specific absolute paths | None in tracked or untracked content |
| Generated files / local databases | None. `.gitignore` covers `dist/`, `dist-test/`, `node_modules/`, `*.tsbuildinfo`, `*.tgz`, `.env*` |

Files changed by the interrupted session, before this review began:

| Path | State | Lines |
|---|---|---:|
| `docs/decisions/ADR-007-universal-object-model.md` | Modified | +147 / −63 |
| `docs/architecture/object-model.md` | Untracked | 211 |
| `docs/contracts/object-contract-v1.md` | Untracked | 239 |
| `docs/contracts/object-events.md` | Untracked | 131 |
| `docs/contracts/object-lifecycle.md` | Untracked | 214 |
| `docs/contracts/object-relationships.md` | Untracked | 114 |
| `docs/contracts/object-versioning.md` | Untracked | 121 |
| `docs/security/object-threat-model.md` | Untracked | 155 |
| `docs/sprints/sprint-2.5/specification.md` | Untracked | 208 |
| `docs/sprints/sprint-2.5/acceptance-criteria.md` | Untracked | 94 |
| `docs/sprints/sprint-2.5/risks.md` | Untracked | 132 |
| `docs/operations/backup-strategy.md` | Untracked | 469 |

The remote repository name (`personalasist1`) does not identify Project AION.
`docs/reviews/repository-status.md` records it as "the exact URL supplied by the
repository owner," so this is treated as intentional and unverified rather than as a
misconfiguration. It requires owner confirmation before any push.

# Documents Reviewed

Sprint 2.5 replacement family — read in full:

- `docs/architecture/object-model.md`
- `docs/decisions/ADR-007-universal-object-model.md`
- `docs/security/object-threat-model.md`
- `docs/contracts/object-contract-v1.md`
- `docs/contracts/object-lifecycle.md`
- `docs/contracts/object-events.md`
- `docs/contracts/object-relationships.md`
- `docs/contracts/object-versioning.md`
- `docs/sprints/sprint-2.5/specification.md`
- `docs/sprints/sprint-2.5/acceptance-criteria.md`
- `docs/sprints/sprint-2.5/risks.md`

Superseded pre-review family — read in full:

- `docs/sprints/sprint-2.5-object-model/object-specification.md`
- `docs/sprints/sprint-2.5-object-model/object-api-contract.md`
- `docs/sprints/sprint-2.5-object-model/object-lifecycle.md`
- `docs/sprints/sprint-2.5-object-model/object-relationship-model.md`
- `docs/sprints/sprint-2.5-object-model/object-event-specification.md`
- `docs/sprints/sprint-2.5-object-model/object-threat-model.md`
- `docs/sprints/sprint-2.5-object-model/acceptance-criteria.md`

Governance, prior sprints, and conflict sources:

- `FOUNDER.md`, `GOVERNANCE.md`, `README.md`, `docs/README.md`
- `AION_V2_MASTER_PLAN.md`, `ARCHITECTURE_AUDIT.md`, `MIGRATION_PLAN.md`, `BACKLOG.md`
- `CONTRIBUTING.md`, `SECURITY.md`
- `docs/architecture/dependency-rules.md`
- `docs/decisions/ADR-006-identity-boundary.md`
- `docs/sprints/sprint-2-identity/specification.md`, `.../acceptance-criteria.md`
- `docs/sprints/sprint-1/specification.md`, `.../acceptance-criteria.md`
- `docs/reviews/architecture-readiness-review.md`, `docs/reviews/repository-status.md`
- `docs/operations/backup-strategy.md`
- `package.json`, `.gitignore`, `packages/kernel/**` (read-only verification)

# Strengths

1. **The four rejected contradictions are genuinely resolved, not renamed.**
   Entity, Relationship, Version, and Event profiles are defined with non-recursion
   stated as a *contract invariant* rather than an adapter exception
   (`object-contract-v1.md` §Object profiles; `object-model.md` §Object profiles).
   Relationship Objects are the sole canonical edge truth and endpoints carry no
   authoritative arrays (`object-relationships.md` §Responsibility). The envelope
   contains no growing collections (`object-contract-v1.md` §Canonical Entity and
   Relationship envelope). There is no generic public create/update/delete
   (`object-contract-v1.md` §Universal operations).

2. **The commit boundary is now honest about distributed systems.** One Entity or
   Relationship is one aggregate; endpoint Objects are never rewritten for a relationship
   change; cross-aggregate work uses compensation and idempotent events rather than
   assumed distributed transactions (`object-model.md` §Commit boundary).

3. **Lifecycle separates durable state from recorded operation.** The directive's own
   vocabulary mixed the two — Imported, Exported, Merged, and Split are operations, not
   availability states. `object-lifecycle.md` §State and operation distinction resolves
   this rather than inheriting the confusion.

4. **Delete and Destroy are distinct and neither overclaims.** "Deletion cannot claim
   physical erasure" is stated plainly, and Destroyed requires verified erasure across
   replicas, indexes, exports, and expired backups with a minimal non-content
   certificate (`object-lifecycle.md` §Deleted, §Destroyed).

5. **Integrity is not confused with authenticity.** "A digest detects accidental or
   unauthorized content change but does not prove Actor identity or authenticity without
   an approved signature/trust design" (`object-versioning.md` §Canonical serialization
   and integrity). The fixed `sha-256` field from the superseded contract is gone.

6. **Eight version dimensions are named and kept separate**, including relationship
   descriptor version, which the prior design lacked (`object-versioning.md` §Version
   dimensions). Compatibility is declared and fixture-proven, never inferred from a
   number.

7. **The God Object risk is addressed by governance, not assertion.** A base-field
   admission test requires universality, stable semantics, bounded size, and vendor
   independence (`object-model.md` §Governance), and ADR-007 §Object materialization
   boundary states explicitly that not every runtime value is materialized.

8. **The risk register argues against the design rather than for it.** 48 entries with
   severity, failure scenario, and recommendation, closing with "It remains **not ready
   for implementation**" (`risks.md`). Self-critical review posture is the correct
   posture for a pre-approval sprint.

9. **Storage, vendor, and framework neutrality hold throughout.** No database, broker,
   vector store, model provider, or language is selected anywhere in the family. The
   `AbortSignal` leak into a supposedly language-neutral contract is gone.

# Blocking Issues

## BI-1 — Two live, contradictory Object contracts coexisted (corrected)

**Severity: Critical. Corrected in this review; requires CTO ratification.**

The superseded family under `docs/sprints/sprint-2.5-object-model/` remained labelled
`Status: Proposed normative contract`, and `docs/README.md` §"Sprint 2.5 proposal"
linked *only* to it. The replacement family was unreachable from any index.

Direct contradictions between the two live sets:

| Concern | Superseded (indexed) | Replacement (unindexed) |
|---|---|---|
| Envelope collections | `relationshipRefs`, `historyRefs`, `eventRefs`, `permissionRefs[]`, `provenance[]` embedded | No authoritative arrays of any kind |
| Generic mutation | `ObjectServiceV1.update()` is public API | Prohibited; domain-owned commands only |
| Lifecycle states | 3: `active`, `archived`, `tombstoned` | 7: Created, Validated, Active, Archived, Deprecated, Deleted, Destroyed |
| Deletion vocabulary | `tombstoned`; "'Delete' is not exposed as an ambiguous API" | `Deleted` and `Destroyed` are distinct terminal states; `tombstone` is not a state |
| Profiles | None; Events are ordinary Objects with their own `eventRefs` | Four profiles; Version and Event non-recursive by invariant |
| Event types | 11, `…V1`-suffixed | 19, unsuffixed |
| Integrity | `algorithm: "sha-256"` fixed in the type | Versioned, registry-replaceable algorithm |
| Cancellation | `AbortSignal` in the normative contract | Language-neutral semantics |
| Create identity | Optional caller-supplied `id?` | Separate privileged import protocol |
| Atomic scope | Commits relationship changes and subject `eventRefs` together | One aggregate; no endpoint rewrite |
| History naming | "Revision Object", `historyRefs` | "Version Object" |
| Sprint directory | `sprint-2.5-object-model/` | `sprint-2.5/` |

Neither set declared the other superseded, and ADR-007 referenced neither. Under
`GOVERNANCE.md` §Decision lifecycle, a changed decision requires an explicit record.

**Correction applied:** all seven superseded documents now carry a Superseded header
with replacement link, date, and reason; ADR-007 gained "Governing documents" and
"Superseded design artifacts" sections; `docs/README.md` was restructured. The documents
are retained unmodified below their headers so the review trail stays auditable.

**CTO action required:** ratify the supersession. Nothing in this review deletes work.

## BI-2 — Acceptance criteria claim readiness-review incorporation that is only partial

**Severity: High. Not corrected — requires a CTO decision, not an editor's judgement.**

`docs/sprints/sprint-2.5/acceptance-criteria.md` line 12 states unconditionally:
"The earlier Architecture Readiness Review changes are incorporated."

Traced against the ten required changes in `architecture-readiness-review.md`
§"Required architecture changes before implementation":

| # | Required change | Status |
|---:|---|---|
| 1 | Define Object profiles | Incorporated |
| 2 | Eliminate relationship dual truth | Incorporated |
| 3 | Remove unbounded inherited arrays | Incorporated |
| 4 | Narrow the universal API | Incorporated |
| 5 | Specify Identity bootstrap | **Deferred** to a subordinate ADR |
| 6 | Define the authorization seam | Incorporated |
| 7 | Complete version/integrity rules | **Partial** — schema IDs, migration graphs, and hash agility incorporated; canonical serialization deferred |
| 8 | Constrain atomicity | Incorporated |
| 9 | Validate representative fixtures | **Not done** — the contract's own stability gate |
| 10 | Set measurable limits | **Not done** — deferred to "before implementation" |

The deferrals are declared honestly inside the documents (ADR-007 §Required subordinate
decisions; `object-threat-model.md` §Residual decisions blocking implementation;
`risks.md` §Improvements required before implementation), so nothing is concealed. But
the acceptance criterion as written is not literally satisfiable, and rewriting a gate
to make it passable is not a reviewer's call.

**CTO action required:** either (a) record items 5, 7-canonicalization, 9, and 10 as
explicit approved exceptions with owner, rationale, risk, and review trigger — which
`acceptance-criteria.md` §Approval result already provides for — or (b) direct that the
criterion be narrowed to the seven construction-blocking changes, with 9 and 10 moved to
the implementation gate where the documents already place them.

## BI-3 — `AION_V2_MASTER_PLAN.md` described the rejected envelope (corrected)

**Severity: Medium-High. Corrected in this review; requires CTO ratification.**

`AION_V2_MASTER_PLAN.md` §"Universal Object Model" listed "typed relationship
references" and "history/event references" as base `AionObject` contract fields —
precisely the embedded collections ADR-007 rejects. A tracked, committed planning
document contradicted the proposed decision it is supposed to sequence.

**Correction applied:** a dated amendment note under that section defers envelope
composition to ADR-007 and the `docs/contracts/object-*` family. The plan's delivery
sequence and milestones are untouched.

# Non-blocking Issues

| ID | Issue | Disposition |
|---|---|---|
| NB-1 | `objectProfile` constraint in the Entity/Relationship envelope table read as a universal invariant excluding `version` and `event` | Corrected — table scope clarified; universality of the field stated |
| NB-2 | Identity namespace boundary not stated in the Object contract; `PrincipalIdV1` and `SystemInstanceIdV1` never mentioned in any Sprint 2.5 document | Corrected — `object-contract-v1.md` §Identity and ownership now names the two consumed namespaces, excludes the other two, and bars the five ADR-006 reserved names |
| NB-3 | Identifier opacity asserted for Object IDs but not for Owner/Actor IDs, and no prohibition on inferring owner, type, location, vendor, or timestamp from structure | Corrected — explicit opacity clause added |
| NB-4 | Relationship endpoints for `Owns`, `CreatedBy`, `ModifiedBy`, `VerifiedBy`, `ProducedBy` name Actors and owners, but endpoints are Object IDs and Actors are `ActorIdV1` — an undefined resolution | Corrected — `object-relationships.md` now requires the persisted Identity Entity Object as endpoint, bars Object Model from resolving the identifier, and confirms envelope attribution remains authoritative when no edge exists |
| NB-5 | Lifecycle state diagram omitted `Active → Deleted` and `Deprecated → Active`, both present in the normative transition table | Corrected — diagram extended; table declared normative on conflict |
| NB-6 | Failure table lists category names only; the superseded contract had stable wire codes, and no statement governed code assignment or reuse | Corrected — codes assigned at v1 designation; meanings immutable; removed codes never reused |
| NB-7 | `Not found` and `Authorization evidence required` were separately enumerated with no non-enumeration rule between them | Corrected — the two must not be distinguishable in a way that confirms existence |
| NB-8 | `docs/operations/backup-strategy.md` (469 lines) is not a Sprint 2.5 deliverable and was unindexed | Corrected — declared out of Sprint 2.5 scope in the specification; indexed under a new Operations section. **Not reviewed for content by this review** |
| NB-9 | The five contract documents do not cross-link to each other or to ADR-007 | Addressed indirectly via ADR-007 §Governing documents and the rebuilt `docs/README.md`. Per-document cross-links deferred as cosmetic |
| NB-10 | No documentation link checker exists; `npm run verify` cannot detect a broken relative link | Open. Recommend adding a link check to the future CI, per `repository-status.md` recommendation 3 |

# Cross-document Conflicts Found

| # | Documents | Conflict | Status |
|---:|---|---|---|
| 1 | `sprint-2.5-object-model/*` vs `contracts/*` + `sprint-2.5/*` | Two complete, mutually contradictory Object contracts, both labelled normative | Corrected (BI-1) |
| 2 | `docs/README.md` vs replacement family | Index resolved only to the superseded design | Corrected (BI-1) |
| 3 | `AION_V2_MASTER_PLAN.md` vs ADR-007 | Embedded relationship/history/event references in the base contract | Corrected (BI-3) |
| 4 | `ADR-007` vs `sprint-2.5-object-model/*` | ADR-007 recorded no supersession, violating `GOVERNANCE.md` §Decision lifecycle | Corrected (BI-1) |
| 5 | `sprint-2.5/acceptance-criteria.md` vs `architecture-readiness-review.md` | Unconditional incorporation claim over three deferred items | Resolved 2026-08-06 by [CTO-DECISION-002](../decisions/CTO-DECISION-002-sprint-2.5-approval.md) — gate narrowed to seven changes; four matters recorded as deferred gates DG-1–DG-4 |
| 6 | `object-relationships.md` vs `object-contract-v1.md` | Actor/owner-valued edges vs Object-ID-only endpoints | Corrected (NB-4) |
| 7 | `object-lifecycle.md` internal | Diagram vs normative transition table | Corrected (NB-5) |
| 8 | `object-contract-v1.md` internal | `objectProfile` constraint vs four-profile model | Corrected (NB-1) |

Checked and found **not** in conflict:

- `ADR-006` ↔ ADR-007 — ADR-006 already states that identifier contracts must not import
  Object and that persisted Identity records conform once Object is approved. ADR-007
  and `object-model.md` §Layering and dependencies match exactly. No cycle.
- `docs/architecture/dependency-rules.md` rule 6 (cross-subsystem references use
  versioned object identifiers) and rule 7 (event contracts, no shared tables) ↔ the
  Object contracts. Consistent.
- `docs/sprints/sprint-2-identity/*` ↔ Sprint 2.5. Identity's delivery slice 1
  ("Reconcile Identity records with the approved Universal Object Model") and acceptance
  criterion "Persisted Identity records conform to the approved Universal Object Model"
  are correctly conditioned on approval that has not occurred.
- `ARCHITECTURE_AUDIT.md` §Long-term risks "God Object Model" ↔ ADR-007 §Object
  materialization boundary. The audit's warning is answered directly.
- `FOUNDER.md` non-negotiables — no vendor lock-in, no black boxes, evidence for every
  decision, owner controls memory, everything replaceable, everything documented. All
  five are visibly served by the contract family.

# Corrections Applied

Documentation and language-neutral contract text only. No code, schema, fixture, test,
or configuration was created or modified.

| File | Change |
|---|---|
| `docs/sprints/sprint-2.5-object-model/object-specification.md` | Superseded header with replacement link, date, reason |
| `docs/sprints/sprint-2.5-object-model/object-api-contract.md` | Superseded header enumerating rejected elements |
| `docs/sprints/sprint-2.5-object-model/object-lifecycle.md` | Superseded header |
| `docs/sprints/sprint-2.5-object-model/object-relationship-model.md` | Superseded header |
| `docs/sprints/sprint-2.5-object-model/object-event-specification.md` | Superseded header citing the recursion defect |
| `docs/sprints/sprint-2.5-object-model/object-threat-model.md` | Superseded header listing uncovered threats |
| `docs/sprints/sprint-2.5-object-model/acceptance-criteria.md` | Superseded header |
| `docs/decisions/ADR-007-universal-object-model.md` | Added §Governing documents (8 links) and §Superseded design artifacts. **Status unchanged: Proposed** |
| `docs/contracts/object-contract-v1.md` | `objectProfile` scope clarified; Identity namespace boundary and identifier-opacity rules added; failure-code assignment and non-enumeration rules added |
| `docs/contracts/object-lifecycle.md` | State diagram completed; transition table declared normative |
| `docs/contracts/object-relationships.md` | Added §"Endpoints are Objects, never bare identifiers" |
| `docs/sprints/sprint-2.5/specification.md` | Added §Supersession; declared `backup-strategy.md` out of scope |
| `AION_V2_MASTER_PLAN.md` | Dated amendment deferring envelope composition to ADR-007 |
| `docs/README.md` | Sprint 2.5 section rebuilt into Decision / Contracts / Security-and-sprint / Superseded groups; Reviews and Operations sections added |
| `docs/reviews/sprint-2.5-object-model-review.md` | This document (new) |

No file was deleted, truncated, or overwritten. Superseded content is preserved verbatim
beneath its header.

# Remaining Unknowns

Carried from ADR-007 §Required subordinate decisions and `object-threat-model.md`
§Residual decisions blocking implementation. Each blocks *implementation*, not ADR
acceptance — ADR-007 §Approval effect already states approval authorizes neither code
nor vendor selection.

1. **Identity bootstrap.** The first Owner and Actor must exist before any Object, but
   persisted Identity records are Objects. No approved ceremony exists. Second-owner
   injection, recovery, and rotation are unaddressed.
2. **Bootstrap authorization before Policy exists.** Until then, any approved work is
   confined to pure validation and isolated in-memory conformance.
3. **Canonical serialization.** Integrity digests are unreproducible across
   implementations without it. Blocks every integrity claim.
4. **UUID generation profile and entropy requirements.**
5. **Bounded resource limits.** Maximum metadata size, label count, nesting depth,
   provenance size, data size, extension size, and event size are all unspecified.
   Readiness-review change #10 is unmet.
6. **Representative fixtures.** `object-contract-v1.md` §Contract stability gate
   requires ten modelled Object kinds — Owner record, Document, Project, Task, Memory,
   Capability, Workflow, Relationship, Version, Event — before v1 designation. None
   exist. Readiness-review change #9 is unmet.
7. **Portable aggregate commit and outbox conformance semantics.**
8. **Deletion, destruction, retention, and backup-erasure evidence by data class**,
   requiring a subordinate ADR per `object-lifecycle.md` §Destroyed.
9. **Plugin validator and migration isolation**; namespace ownership governance.
10. **Signing and authenticity** for schemas, events, exports, and releases.
11. **Repository identity.** The `origin` remote does not name AION; owner confirmation
    is outstanding.

# Security Assessment

The threat model is the strongest artifact in the family. 33 threats with attack, failure
mode, and required architectural control; 8 trust boundaries; explicit data-minimization
and secure-lifecycle rules; 11 pre-release verification requirements; 8 declared blocking
decisions.

Boundaries verified as intact:

- **Object Model decides no policy.** It receives external authorization evidence bound
  to Actor, Owner, action, subject, revision, scope, and expiry, and validates evidence
  *shape and correlation*, never meaning (`object-threat-model.md` §Authorization
  boundary). This is the correct seam.
- **References confer no authority.** `permissionSetRef` is contractually
  non-authoritative; presence and absence both mean nothing (`object-contract-v1.md`
  §Permission and audit references).
- **Events grant no authority and command nothing.** Consumers re-resolve current
  Identity, lifecycle, and policy before any side effect (`object-events.md` §Security
  and privacy). The confused-deputy path is closed at the contract level.
- **Cross-owner fails closed** for relationships, exports, and event publication.
- **Audit is a protected separate domain, not a log stream.** "Operational logs are not
  audit history."
- **Secrets are contractually invalid** in metadata, data, events, exports, and logs.

Residual security risk concentrates in three places: the identity/authorization bootstrap
(no owner exists yet, so no operation can be authorized), integrity canonicalization
(digests are meaningless until serialization is fixed), and destruction verification
across backups and derived stores (the hardest promise in the design to keep). All three
are correctly listed as blocking rather than assumed solved.

The threat model closes with "No test implementation is authorized by this threat model."
That restraint is correct and was honoured — no test was written.

# Migration Assessment

Migration design is sound and appropriately pessimistic.

- Nine-step privileged protocol: verify source, resolve one approved path, preserve
  backup and original Version Object, transform deterministically, validate target,
  commit one revision plus Version plus `ObjectSchemaMigrated`, checkpoint by immutable
  run identity, remain idempotent and resumable, report loss and rollback capability
  explicitly (`object-versioning.md` §Migration protocol).
- Mixed schema versions must remain readable during the migration window. Startup-blocking
  full migration is explicitly rejected as a default (`risks.md` §Bulk migration).
- Lossy migrations may not claim reversibility. Information loss is a declared property
  of the migration edge, not a discovered surprise.
- "Old data is never made unreadable merely because application code upgrades." Removing
  a reader requires proof that no retained Object, export, or backup depends on it
  (`object-versioning.md` §Coexistence and support).
- Merge and Split preserve independent source histories via `DerivedFrom` to an exact
  source revision rather than splicing revision sequences.
- Backup restore must reconcile deletion and destruction state before cutover, closing
  the resurrection path (OBJ-029, `object-lifecycle.md` §Failure and recovery).

Weaknesses: no migration has been executed or benchmarked, no golden fixtures exist, and
canonicalization changes can invalidate every stored hash without any content change
(`risks.md` §Migration risks). The write amplification of one snapshot plus one Version
plus N Events plus outbox per mutation is acknowledged but unmeasured.

# Testability Assessment

No tests were written, and none were authorized. The design's *testability* is assessed
from its contracts.

Positive: injected clock and UUID generator; expected-revision concurrency with
last-write-wins prohibited; stable failure categories; language-neutral fixtures required;
crash-point conformance demanded at every aggregate commit boundary rather than happy-path
repository calls only; deterministic canonical serialization required for reproducible
digests; the `AbortSignal` leak removed so cancellation can be specified semantically and
mapped per language.

`object-threat-model.md` §Verification requirements enumerates eleven behavioural areas
including one-winner concurrency, non-recursive profile behaviour, relationship inference
and cross-owner controls, migration interruption and resume, event tamper/duplicate/gap/replay,
and delete-restore-rebuild non-resurrection.

Gaps: no conformance suite, fixture, or benchmark exists; "language-neutral cancellation
and deadline semantics" are required but not yet defined; and there is no way to prove a
durable adapter honours atomicity until the portable commit contract (unknown 7) is
written.

Repository verification available today is `npm run verify` — strict `tsc --noEmit` over
source and tests, then the workspace test suite. Results below.

# Scope Assessment

The sprint stayed inside its boundary.

| Prohibition | Observed |
|---|---|
| No production code | Held. `git diff` covers `.md` files only; `packages/` untouched |
| No Identity implementation | Held |
| No Object Model implementation | Held |
| No Memory, Planner, Event Bus, Knowledge Graph, Capability Registry, Workflow Engine, plugins, agents, storage adapters | Held. Each appears only as a named future boundary or reserved relationship subtype |
| No storage, vector store, framework, broker, or model provider selected | Held |
| No dependency added | Held. `package.json` and `package-lock.json` unmodified |

One scope overflow: `docs/operations/backup-strategy.md` (469 lines) is not among the
eleven directive deliverables. It is operations content, not Object architecture. It has
been declared out of Sprint 2.5 scope, indexed separately, and **not reviewed for content
by this review**. It requires its own review before it carries any authority.

Under-delivery: none. All eleven required documents exist at the exact required paths.

# Decision on "Everything Is an Object"

**Accept, as narrowed by ADR-007's materialization boundary. Reject the slogan reading.**

The phrase is dangerous in its literal form and `ARCHITECTURE_AUDIT.md` §Long-term risks
already warned that it "would centralize coupling." ADR-007 answers with two separable
rules, and both are needed:

1. *Every persistent domain entity has Object identity and envelope.* This is structural
   conformance, not a base class — "Implementations may use composition, records, traits,
   interfaces, generated schemas, or inheritance; no programming-language inheritance
   mechanism is mandated."
2. *Not every runtime value is materialized as a durable Object.* An AION value becomes an
   Object only when it is persistent, independently addressable, owned, shared across a
   domain boundary, related, permissioned, audited, versioned, or event-producing. Private
   variables, transient calculations, tokens, and rebuildable indexes are excluded.

Three further constraints make the acceptance safe:

- **The envelope is compact.** Universality is enforced by an admission test requiring a
  field to be meaningful for *every* profile, stable, bounded, and vendor-independent
  (`object-model.md` §Governance). Empty-array proliferation — the classic symptom of a
  God Object — is structurally impossible because there are no arrays.
- **Behaviour does not follow structure.** Object Model owns invariants; domains own
  commands. There is no universal `update()`. This prevents the God *Service* that the
  readiness review identified as a distinct failure from the God *Object*.
- **Derived data is excluded by name.** Embeddings, indexes, and Knowledge Graph
  projections are rebuildable projections, never canonical fields.

Specific answers the CTO asked for:

- **Identity records** are Entity Objects. Identity *identifier contracts* stay below
  Object and must not import it — this is stated in both ADR-006 and ADR-007, and no cycle
  exists. Correct on both counts.
- **Events and Versions** are Objects, because they are persistent, addressable, owned,
  provenance-bearing, permissionable, auditable, and exportable — but under immutable
  non-recursive profiles. Putting them outside Object would have cost owner export and
  provenance; leaving them recursive would have been fatal. The profile answer is right.
- **Ten-year evolution** does not force one giant schema: types register under owned
  namespaces with their own versioned schemas, and extension namespaces round-trip
  without execution. New types require no base-contract change.

The remaining risk is cultural, not structural: teams may still read the slogan as
permission to persist everything. The materialization boundary must be quoted in every
future domain specification, not merely referenced.

# ADR-007 Recommendation

# APPROVE WITH CHANGES

ADR-007 remains **Proposed**. It is not marked Accepted, because acceptance is the CTO's
act and because BI-2 remains open.

**Why not REJECT.** The architecture is sound and the four construction-blocking
contradictions from the readiness review are genuinely resolved — verifiably, in contract
text, as invariants rather than exceptions. Nothing in the design needs to be rebuilt.

**Why not APPROVE outright.** Three conditions are unmet:

1. **BI-2 is unresolved.** `acceptance-criteria.md` line 12 asserts unconditional
   incorporation of the readiness-review changes, while items 5, 7-canonicalization, 9,
   and 10 are deferred. The CTO must either record those as approved exceptions with
   owner, rationale, risk, and review trigger, or narrow the criterion. A reviewer must
   not loosen an approval gate on the CTO's behalf.
2. **The corrections in this review are unratified.** Seven supersession headers, four
   contract clarifications, one master-plan amendment, and a rebuilt index were applied
   under Phase 4 authority. They change what the repository asserts and require the CTO's
   confirmation.
3. **The contract's own stability gate is unmet.** `object-contract-v1.md` §Contract
   stability gate requires ten representative fixtures before v1 designation. Approving
   ADR-007 is compatible with this — ADR-007 §Approval effect explicitly permits
   subordinate ADRs and contract fixtures without authorizing production code — but the
   contract must not be described as stable v1 in the interim.

**What approval would authorize.** Per ADR-007 §Approval effect: subordinate ADRs and
contract fixtures only. It authorizes no production code, no Object Model implementation,
no Identity implementation, no Planner implementation, and no storage or Event Bus vendor
selection. This review does not request any of those.

**Sequence recommended before implementation is separately considered:** resolve
unknowns 1–3 (identity bootstrap, bootstrap authorization, canonical serialization) as
subordinate ADRs, then produce the ten representative fixtures, then set the bounded
limits in unknown 5, then benchmark the high-churn and high-degree workloads. Implementation
authorization should be a distinct CTO decision taken after that evidence exists.

# Verification Results

Executed at the repository root after all corrections. No dependency was installed and no
tool was added.

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

| Check | Command | Result |
|---|---|---|
| Strict type checking | `tsc -p tsconfig.json --noEmit`, `tsc -p tsconfig.test.json --noEmit` | Pass, no diagnostics |
| Build | `tsc -p tsconfig.json`, `tsc -p tsconfig.test.json` | Pass |
| Unit tests — `AionKernelV1` | `node --test` | 9 of 9 pass |
| Architecture boundary test | "Kernel source has no external or cross-subsystem imports" | Pass |
| Package-consumer test | "published versioned export is consumable" | Pass |
| Full gate | `npm run verify` | **Pass — 11 of 11, 0 failures** |
| Formatting / docs validation | — | **Not configured.** `package.json` defines only `build`, `typecheck`, `test`, `verify`. No linter, formatter, or link checker exists |

Results are identical before and after the corrections, as expected: every change was to
Markdown, which no configured check inspects. This is itself a finding — see NB-10.

---

Prepared for CTO decision. No commit, push, or backup has been performed.
