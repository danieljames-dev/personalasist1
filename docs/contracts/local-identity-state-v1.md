# Local Identity State v1

Status: Sprint 3 Phase 4 implementation contract
Scope: minimum local single-owner reference bootstrap only

## Responsibility

`LocalIdentityStateV1` records canonical local reference truth before Universal Object
materialization exists. It is not a persisted Universal Object record and does not waive the
Object Contract's pre-stable status. It contains no authentication, authorization, credential,
session, policy, profile, contact, employment, device, or external-account data.

## Identifier contracts

The four distinct TypeScript brands are `OwnerIdV1`, `PrincipalIdV1`, `ActorIdV1`, and
`SystemInstanceIdV1`. Their wire value is a canonical lowercase RFC 9562 UUID v4. The value is
opaque: consumers must not infer type, owner, role, vendor, location, device, sequence, or creation
time from it. Kind separation comes from the versioned contract and record context, never a prefix
encoded into the identifier. An identifier is neither a credential nor evidence of authentication.

The single-owner bootstrap creates exactly one record of each kind and exactly these relationships:

- Actor to Principal;
- Principal to Owner; and
- System Instance to Owner.

All four values must be unique. Each record has contract version `1`, lifecycle status, canonical
timestamps, and revision `1`. The state has schema and contract versions, lifecycle status,
timestamps, and `IdentityProvenanceV1` naming the explicit local bootstrap and generator profile.
Only `active` and `disabled` are valid lifecycle values; Phase 4 exposes no lifecycle mutation.

## Ports and operation

`IdentityClock`, `IdentityIdGenerator`, and `IdentityStateRepository` are injected. The bootstrap
domain does not read the system clock, random source, filesystem, environment, command line, or
network directly. The filesystem adapter additionally requires an injected path-boundary port; the
CLI composes it with the Phase 3 `@aion/privacy-boundary` implementation.

Initialization is explicit and serialized by an exclusive lock. A valid existing state returns
`already-initialized`, invokes neither clock nor generator, preserves every identifier and creation
timestamp, and performs no write. Missing, duplicate, multiple, mismatched, malformed, unsupported,
partial, or unknown-field state fails closed before generation. No conflicting state is repaired or
replaced.

## Persistence and export

The canonical file is `private/identity/identity-state-v1.json`. A complete JSON value is written
to a uniquely named same-directory temporary file, flushed, then installed through exclusive
hard-link creation. Existing final state is never overwritten. The exclusive initialization lock
prevents concurrent owners. Temporary files are non-canonical; the adapter cleans its own temporary
file where safe and ignores unrelated stale temporary files.

Status returns counts, lifecycle, versions, and twelve-hex-character SHA-256 fingerprint prefixes.
It never returns complete identifiers. Export requires explicit approved-root and destination paths,
reuses the Phase 3 containment boundary, preserves the state exactly, installs atomically, and
refuses overwrite. There is no import operation in Phase 4.

Filesystem permissions, a compromised local account, lock-file denial of service, and a root or
reparse-point swap after validation remain residual risks. Immediate rechecks and exclusive
installation reduce but do not eliminate TOCTOU risk. Authentication and authorization are required
before any external access and remain outside this phase.
