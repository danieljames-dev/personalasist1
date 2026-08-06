# Local owner bootstrap

Sprint 3 Phase 4 provides three explicit local commands:

```text
npm run identity:initialize -- --root <absolute-private-identity-root>
npm run identity:status -- --root <absolute-private-identity-root>
npm run identity:export -- --root <absolute-private-identity-root> --output-root <absolute-approved-private-export-root> --output <absolute-output-file>
```

The caller creates and explicitly supplies the approved private roots. The CLI does not infer a home
directory, enumerate candidate directories, or default to Desktop, Documents, Downloads, another
drive, or a network location. It composes `@aion/identity` with the Phase 3 path boundary.

`initialize` creates the four required opaque references and three relationships only when state is
absent. `status` reports a redacted view. `export` copies validated state exactly to a new explicit
private destination and refuses overwrite. Complete identifiers are never written to ordinary CLI
output. All errors use stable fail-closed categories without supplied paths or identifier values.

Installation, module import, ordinary repository verification, backup, and restore do not initialize
an owner. Tests use deterministic synthetic UUIDs and temporary directories. The approved backup
continues to exclude `private/`; restored verification runs only synthetic Identity tests.

This is reference bootstrap state, not a user account. It implements no authentication,
authorization, password, session, token, OAuth, role, permission, profile, Universal Object, career
ingestion, remote service, telemetry, database, or vector store.
