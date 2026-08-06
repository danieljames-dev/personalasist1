# Project AION

AION is a modular, local-first Personal Intelligence Operating System designed to
increase its owner's effectiveness while keeping data, decisions, and authority
under owner control.

The repository currently contains one production component: the versioned Kernel
lifecycle coordinator. All other AION subsystems remain architecture and backlog
items until their feature-level approval gates are satisfied.

## Workspace

- `packages/kernel` — preserved Kernel v1 library.
- `docs` — architecture, decisions, specifications, governance, and templates.

## Verification

- `npm test` runs every workspace test suite.
- `npm run typecheck` validates every workspace.
- `npm run build` builds every publishable workspace.
- `npm run verify` runs the complete local quality gate.

See [FOUNDER.md](FOUNDER.md), [AION_V2_MASTER_PLAN.md](AION_V2_MASTER_PLAN.md), and
[docs/README.md](docs/README.md) for project direction.

