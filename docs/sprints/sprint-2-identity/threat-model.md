# Identity v1 threat model

Status: Phase 4 local-bootstrap controls implemented; broader Identity v1 remains Proposed

## Assets

- Stable owner/principal/actor/system references.
- Ownership and resolution relationships.
- Identity history, lifecycle status, and provenance.

Identifiers are sensitive metadata but are not credentials.

## Threats

| Threat | Required control |
|---|---|
| Identifier spoofing or wrong-kind substitution | Branded/kind-safe types plus runtime validation |
| Cross-owner reference injection | Owner consistency invariant and fail-closed resolution |
| ID collision or reuse | Collision-resistant generator, uniqueness constraint, non-reuse tests |
| Disabled identity continues acting | Status validation at resolution/enforcement boundaries |
| Mutable email/vendor ID used as canonical identity | Opaque internal IDs; external claims isolated in adapters |
| Enumeration through logs/errors | Non-enumerating errors and identifier redaction |
| Repository swaps owner relationships | Version/concurrency checks and protected audit history |
| Backup/import rewrites IDs | Integrity validation and exact round-trip tests |
| Identifier mistaken for authentication | Explicit contract prohibition and architecture tests |

## Trust boundaries

- Callers are untrusted until identifier syntax, kind, status, and owner are resolved.
- Repository adapters are infrastructure and cannot bypass domain invariants.
- Future authentication supplies claims but cannot rewrite canonical identity.
- Future policy consumes resolved identity but remains responsible for authorization.

## Residual risks requiring design evidence

- Long-term deletion versus immutable audit references.
- Collision-resistance and privacy properties of the chosen ID representation.
- Compromised local owner account/device; authentication and key custody are outside
  this sprint but must exist before external access.

## Phase 4 local-bootstrap controls

- Exact closed-shape validation rejects unsupported versions, duplicate kinds or identifiers,
  missing or mismatched relationships, invalid lifecycle values, timestamp disorder, and profile or
  credential fields before any replacement identifier can be generated.
- An exclusive lock prevents concurrent initializers; a complete flushed same-directory temporary
  file is installed with no-overwrite hard-link semantics.
- The Phase 3 approved-root boundary is checked and immediately rechecked for state, lock,
  temporary, and export paths. Traversal, cross-volume, device path, and escaping link/junction
  cases fail closed.
- Status exposes short SHA-256 fingerprint prefixes rather than complete identifiers. CLI failures
  omit supplied paths and identifier values.
- `private/` is ignored and excluded from source backups. Restored tests use synthetic temporary
  state and never initialize a real owner.

Residual risks include local-account compromise, filesystem ACL errors, lock-file denial of service,
hard-link availability, and path/reparse TOCTOU after recheck. No external access is safe or
authorized until the separate DG-1b authentication boundary is approved.
