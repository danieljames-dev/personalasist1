# Project AION

AION is a modular, local-first Personal Intelligence Operating System designed to
increase its owner's effectiveness while keeping data, decisions, and authority
under owner control.

The repository contains the versioned Kernel lifecycle coordinator, the Phase 3 local path boundary,
the Phase 4 local Identity bootstrap, and a bounded Phase 5 Universal Object reference. The Object
Contract remains Pre-stable; later domain and production capabilities remain gated.

## Workspace

- `packages/kernel` — preserved Kernel v1 library.
- `packages/privacy-boundary` — explicit local path-containment reference.
- `packages/identity` — local single-owner opaque Identity bootstrap.
- `packages/object` — pre-stable Object reference with seven family boundaries,
  RelationshipObject, ACJ-1/DG-4a controls, and bounded in-memory/filesystem reference repositories.
- `docs` — architecture, decisions, specifications, governance, and templates.

## Verification

- `npm test` runs every workspace test suite.
- `npm run typecheck` validates every workspace.
- `npm run build` builds every publishable workspace.
- `npm run verify` runs the complete local quality gate.

See [FOUNDER.md](FOUNDER.md), [AION_V2_MASTER_PLAN.md](AION_V2_MASTER_PLAN.md), and
[docs/README.md](docs/README.md) for project direction.
