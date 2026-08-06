# AION v2 Architecture Backlog

Status: Proposed  
Date: 2026-08-05

## Classification

- **Priority:** Critical Path, High, Medium, or Low.
- **Complexity:** XS (hours), S (1–3 days), M (up to 2 weeks), L (multi-sprint),
  XL (program/epic). Estimates express relative engineering complexity, not dates.
- No production item may start without specification, ADR impact review, tests,
  documentation, security analysis, and acceptance criteria.

## Critical Path

| ID | Feature/deliverable | Complexity | Dependencies | Acceptance signal |
|---|---|---:|---|---|
| CP-001 | Approve v2 architecture and dependency rules | M | Audit, master plan | ADRs accepted; prohibited dependencies documented |
| CP-002 | Establish source control and review governance | S | Owner authorization | Reviewable history and ownership rules exist |
| CP-003 | Decide license and contribution policy | S | Founder decision | `LICENSE` and governance agree with distribution model |
| CP-004 | Add architecture/specification/security templates | S | CP-001 | New work cannot omit required evidence |
| CP-005 | Create reproducible CI quality gates | M | CP-002 | Clean checkout runs build, tests, docs, security checks |
| CP-006 | Baseline Kernel v1 API/package compatibility | S | CP-005 | Consumer fixture and API snapshot pass |
| CP-007 | Resolve Kernel partial-start and cleanup semantics | M | CP-006, two participant use cases | ADR and tests define resource ownership |
| CP-008 | Migrate unchanged Kernel into workspace package | M | CP-005, CP-006 | Nine tests and package contract unchanged |
| CP-009 | Define contract versioning and schema evolution | M | CP-001 | Compatibility matrix and conformance harness accepted |
| CP-010 | Threat model platform and owner data | L | CP-001 | Assets, actors, threats, controls, residual risks approved |
| CP-011 | Specify Identity contracts | L | CP-009, CP-010 | Owner/actor/principal fixtures and contract tests pass |
| CP-012 | Specify Universal Object Model | XL | CP-009, CP-011 | Representative objects round-trip and migrate |
| CP-013 | Define ownership, permission, provenance, and history semantics | L | CP-011, CP-012 | No object can omit owner/version/provenance policy |
| CP-014 | Implement Object Model reference library | XL | CP-012, CP-013 approval | Conformance and migration suites pass |
| CP-015 | Specify Memory contracts and data lifecycle | XL | CP-014, CP-010 | Four memory types, export, deletion, retention specified |
| CP-016 | Implement local Memory reference adapter | XL | CP-015 approval, storage ADR | Backup/restore/export/deletion conformance passes |
| CP-017 | Specify Knowledge Graph boundary | L | CP-014, CP-015 | Graph is replaceable and provenance-preserving |
| CP-018 | Specify Event Bus contracts and delivery semantics | XL | CP-009, CP-013 | Replay/idempotency/compatibility plans accepted |
| CP-019 | Implement in-process Event Bus reference adapter | L | CP-018 approval | Conformance, retry, and replay tests pass |
| CP-020 | Implement Knowledge Graph reference adapter | XL | CP-017 approval, CP-016 | Graph conformance and rebuild tests pass |
| CP-021 | Specify Planner and evidence/decision model | XL | CP-016, CP-020, CP-018 | Planner cannot execute; every output cites evidence |
| CP-022 | Specify model-provider abstraction | L | CP-021 | Multiple deterministic/provider fixtures conform |
| CP-023 | Implement recommendation-only Planner | XL | CP-021/22 approval | Shadow-mode value and evidence thresholds met |
| CP-024 | Specify Capability Registry | XL | CP-011, CP-013, CP-018 | Permissions, schemas, budgets, audit defined |
| CP-025 | Implement Capability Registry and conformance SDK | XL | CP-024 approval | Two interchangeable capabilities pass conformance |
| CP-026 | Specify Workflow Engine | XL | CP-023, CP-025 | Durable states, approvals, recovery, validation defined |
| CP-027 | Implement local Workflow Engine | XL | CP-026 approval | Crash recovery and no-duplicate-side-effect tests pass |

## High priority

| ID | Feature/deliverable | Complexity | Dependencies | Acceptance signal |
|---|---|---:|---|---|
| H-001 | Architecture dependency enforcement | M | CP-008 | Forbidden imports fail CI |
| H-002 | Automatic test discovery and coverage policy | S | CP-005 | All test files execute; risk-based thresholds documented |
| H-003 | Package provenance and dependency scanning | M | CP-005 | Lockfile, audit, SBOM, and release checks run |
| H-004 | Logging, metrics, tracing, and audit contracts | L | CP-009, CP-010 | Vendor-neutral signals and redaction rules accepted |
| H-005 | Clock, ID, and randomness ports | M | CP-009 | Deterministic tests use replaceable implementations |
| H-006 | Data classification and retention policy | L | CP-010, CP-013 | Every stored class has retention/deletion behavior |
| H-007 | Encryption and owner key-custody design | XL | CP-010, CP-015 | Recovery and threat analysis accepted |
| H-008 | Backup, restore, and disaster recovery program | XL | CP-016 | Scheduled restore drills meet RPO/RTO targets |
| H-009 | Memory import/export tooling specification | L | CP-015 | Lossless owner-readable export fixture passes |
| H-010 | Event schema registry and compatibility gate | L | CP-018 | Breaking event changes fail CI |
| H-011 | Planner evaluation and benchmark harness | XL | CP-021, CP-022 | Quality/cost/latency evidence is reproducible |
| H-012 | Approval and consent policy engine | XL | CP-011, CP-013, CP-026 | Consequential actions fail closed without approval |
| H-013 | Read-only local capability set | L | CP-025 | Search/read/analyze capabilities are sandboxed and audited |
| H-014 | Temporary Worker contracts | XL | CP-025, CP-027 | Lease, scope, budget, expiry, recovery specified |
| H-015 | Temporary Worker coordinator | XL | H-014 approval | Workers lose authority on expiry and can be replaced |
| H-016 | Dashboard control API specification | XL | CP-027, H-012, H-004 | API exposes evidence/approval without owning state |
| H-017 | Owner Dashboard MVP | XL | H-016 approval | Owner can inspect, approve, stop, export, and delete |
| H-018 | Secrets reference and integration permission model | XL | CP-010, H-012 | Secrets never enter objects/events/logs |
| H-019 | Integration SDK | XL | CP-025, H-018 | Revocable adapter passes conformance tests |
| H-020 | Emergency stop and authority revocation | L | H-012, H-015, H-017 | Owner can halt work and revoke grants deterministically |

## Medium priority

| ID | Feature/deliverable | Complexity | Dependencies | Acceptance signal |
|---|---|---:|---|---|
| M-001 | Performance and soak-test harness | L | CP-016, CP-019 | Baseline workloads and regression budgets recorded |
| M-002 | Object full-text and semantic search ports | XL | CP-016, CP-022 | Search adapters are replaceable and provenance-aware |
| M-003 | OCR capability | L | CP-025, H-018 | Local/provider adapters share contract and audit behavior |
| M-004 | Browser capability | XL | CP-025, H-012 | Sandboxed browsing with approval-scoped side effects |
| M-005 | Filesystem capability | L | CP-025, H-012 | Path scopes and destructive-action controls pass tests |
| M-006 | Git capability | L | M-005 | Repository scopes, review gates, and rollback defined |
| M-007 | Email capability and adapter | XL | H-019, H-012 | Draft/read separate from approved send |
| M-008 | Calendar capability and adapter | XL | H-019, H-012 | Read/write scopes and conflict handling verified |
| M-009 | Product opportunity discovery workflow | XL | CP-027, M-002, M-004 | Evidence-backed opportunity objects created |
| M-010 | Product research/specification workflow | XL | M-009 | Owner-approved specification and evidence trail |
| M-011 | Product build/test/document workflow | XL | M-010, M-006 | Workflow is resumable and validation-gated |
| M-012 | Product publishing workflow | XL | M-011, H-019, H-012 | Publish remains approval-gated and reversible where possible |
| M-013 | Resume and skill knowledge domain pack | XL | CP-020, M-002 | Provenance-preserving resume/skill graph |
| M-014 | Job discovery and gap analysis workflow | XL | M-013, M-004 | Ranked results cite source and match evidence |
| M-015 | Resume tailoring and cover-letter workflow | L | M-014, CP-023 | No unsupported claims; changes are reviewable |
| M-016 | Job submission/tracking workflow | XL | M-015, H-012, H-019 | Final submission always requires explicit approval |
| M-017 | Executive briefing workflow | L | CP-023, CP-027 | Briefing separates facts, inference, confidence, and actions |
| M-018 | Knowledge correction and contradiction workflow | XL | CP-020, CP-027 | Owner correction propagates without erasing history |
| M-019 | Plugin packaging and isolation specification | XL | CP-025, CP-010 | Least-privilege lifecycle and conformance defined |
| M-020 | Multi-device synchronization research | XL | CP-016, CP-018 | Conflict/security evidence; no implementation commitment |

## Low priority

| ID | Feature/deliverable | Complexity | Dependencies | Acceptance signal |
|---|---|---:|---|---|
| L-001 | Distributed Event Bus adapter | XL | Proven scale need, CP-019 | Benchmark proves in-process adapter insufficient |
| L-002 | Remote worker execution | XL | H-015, threat model update | Isolation and data residency controls proven |
| L-003 | Multi-owner organization model | XL | Single-owner system mature | Ownership/isolation semantics approved |
| L-004 | Marketplace/discovery for third-party plugins | XL | M-019 | Signing, review, revocation, and trust UX proven |
| L-005 | Automated product publishing expansion | XL | M-012 operational evidence | Policy and incident evidence justify reduced friction |
| L-006 | Forecast capability | XL | CP-023, evaluation datasets | Calibrated uncertainty and backtesting thresholds met |
| L-007 | Voice/multimodal interaction | XL | H-017, provider abstraction | Accessible, private, replaceable modality adapters |
| L-008 | Federated knowledge exchange | XL | M-020, privacy review | Owner-controlled selective disclosure proven |

## Explicitly rejected backlog patterns

- Fixed permanent agents with overlapping responsibilities.
- A named-model integration inside Planner, Memory, or Workflow contracts.
- Dashboard-owned canonical state.
- Direct external submission without approval policy.
- Knowledge entries without source, owner, timestamp, confidence, and version.
- A single database shared directly by all subsystems.
- Microservice extraction without measured isolation or scaling evidence.
- Continuous self-modification under the label of continuous learning.

## Next approval gate

Approval of these planning documents permits work on CP-001 through CP-004 as
architecture/governance tasks. It does not authorize production implementation of
Identity, the Object Model, or any later component.

