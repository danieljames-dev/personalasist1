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

