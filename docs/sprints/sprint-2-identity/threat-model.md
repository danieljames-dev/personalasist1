# Identity v1 threat model

Status: Proposed

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

