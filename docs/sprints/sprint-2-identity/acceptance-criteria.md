# Sprint 2 Identity acceptance criteria

Status: Approved with CTO amendments

- [x] ADR-006 is approved.
- [ ] Identity has exactly one documented responsibility: canonical reference truth.
- [ ] Owner, Principal, Actor, and System Instance IDs are distinct and versioned.
- [ ] IDs are opaque, immutable, non-reusable, and vendor-neutral.
- [ ] Runtime and language-neutral contracts agree through fixtures.
- [ ] Identity contains no authentication, authorization, profile, policy, or
  downstream business logic.
- [ ] Identity publishes committed domain events through a port and directly invokes
  no downstream service.
- [ ] Organization, Workspace, Service Account, Plugin, and Robot namespaces are
  reserved but have no v1 implementation.
- [ ] Every non-owner identity resolves to exactly one owner in v1.
- [ ] Unknown, malformed, disabled, wrong-kind, and cross-owner cases fail closed.
- [ ] Persisted Identity records conform to the approved Universal Object Model.
- [ ] Export/import preserves IDs, relationships, provenance, and revisions.
- [ ] Repository implementations pass a shared conformance suite.
- [ ] Threat controls have automated verification or accepted residual risk.
- [ ] Public API, schemas, adapter guide, and operations are documented.
- [ ] Full workspace verification passes.

## Sprint 3 Phase 4 scoped evidence

These checks apply only to the authorized local reference bootstrap and do not mark the unchecked
broader Sprint 2 Identity program complete.

- [x] Owner, Principal, Actor, and System Instance references are distinct branded v1 contracts.
- [x] First explicit initialization creates exactly four references and three required relationships.
- [x] Clock, identifier generator, and repository are injected; deterministic tests make exactly four
  generator calls on the first run and zero on the second.
- [x] Existing valid state is preserved without rewrite; conflict and corruption fail closed.
- [x] Local persistence is privacy-bounded, exclusively locked, flushed, atomic, and no-overwrite.
- [x] Status is redacted and export requires an explicit approved private destination.
- [x] Architecture tests exclude authentication, authorization, profiles, network, telemetry, Object,
  career, Kernel, database, vector-store, backup, and test dependencies.
- [ ] DG-1a closure evidence is accepted by the CTO after real initialization and isolated restore.
- [ ] DG-1b secure external-access and authentication boundary is approved.
