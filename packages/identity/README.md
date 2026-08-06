# @aion/identity

This package implements the explicit local single-owner reference bootstrap authorized for Sprint
3 Phase 4. It creates one opaque Owner, Principal, Actor, and System Instance reference and the
three required resolution relationships. Identifiers are canonical lowercase UUID v4 values and
carry no owner, type, role, vendor, location, device, or time meaning.

Identity is canonical reference truth only. The package contains no authentication, authorization,
credentials, profile data, Object implementation, career behavior, network access, telemetry,
database, or vector store.

The domain uses injected clock, identifier-generator, and repository ports. The filesystem adapter
requires an injected approved-root path boundary, installs complete state atomically with a
same-directory temporary file and exclusive hard-link creation, and serializes initialization with
an exclusive lock. Valid existing state is never rewritten. Corrupt, conflicting, unsupported, or
locked state fails closed.
