# Project AION

AION is a modular, local-first Personal Intelligence Operating System designed to
increase its owner's effectiveness while keeping data, decisions, and authority
under owner control.

The repository contains the versioned Kernel lifecycle coordinator, the Phase 3 local path boundary,
the Phase 4 local Identity bootstrap, a bounded Phase 5 Universal Object reference, Phase 6 career
input contracts/preflight, the Phase 7 local career evidence catalogue and evidence-backed profile
reference, the Phase 8–11 Job Posting, matching, and application-preparation slice, and the AION V1
local assistant with its loopback Command Center. The Object Contract remains Pre-stable; normative
conformance and production capabilities remain gated.

## Start AION

```text
npm run aion
```

This starts the local Command Center on `http://127.0.0.1:31415`. It binds loopback only, loads no
hosted dependency, and sends nothing anywhere. Chat is offline by default through a deterministic
local provider. The ten areas are Chat, Tasks, Routines, Memory, Planner, Approvals, Activity,
Career, Imports, and Settings; no source file needs editing to use them.

`npm run aion:demo` runs the complete synthetic product proof on neutral temporary data — including
a restart reload and a byte-identical rerun — and leaves nothing behind.

If a supported developer agent is installed — Claude Code CLI or Codex CLI — Settings lets you
choose which one AION uses. Developer tasks are approval-gated, confined to this repository, and
read-only unless you approve a writing boundary; your instruction reaches the agent on its standard
input and never becomes a command-line argument.

Owner data lives only in the Git-ignored `private/aion` directory and is excluded from source
backups. See [the Command Center guide](docs/implementation/aion-command-center.md).

## Workspace

- `packages/local-assistant` — local-first V1 assistant domains and replaceable ports: chat,
  memory, tasks, routines, scheduler, planner, capability registry, agent controller, approvals,
  activity, archive import, and encrypted private backup.
- `apps/aion` — the loopback Command Center: same-origin UI, HTTP boundary, developer-agent
  resolution, and integration with the accepted Career engine.
- `packages/kernel` — preserved Kernel v1 library.
- `packages/privacy-boundary` — explicit local path-containment reference.
- `packages/identity` — local single-owner opaque Identity bootstrap.
- `packages/object` — pre-stable Object reference with seven family boundaries,
  RelationshipObject, ACJ-1/DG-4a controls, and bounded in-memory/filesystem reference repositories.
- `packages/career-input` — versioned owner-input contracts and explicit local validation with no
  ingestion, persistence, Object creation, or network behavior.
- `packages/career-evidence` — explicit dry-run/import/profile operations, deterministic structured
  fact extraction, provenance relationships, conflict/supersession history, and synthetic-only tests.
- `templates/career` — neutral blank authoring aids; completed owner copies belong only in ignored
  private storage and must never be committed.
- `docs` — architecture, decisions, specifications, governance, and templates.

## Verification

- `npm test` runs every workspace test suite.
- `npm run typecheck` validates every workspace.
- `npm run build` builds every publishable workspace.
- `npm run verify` runs the complete local quality gate.

See [FOUNDER.md](FOUNDER.md), [AION_V2_MASTER_PLAN.md](AION_V2_MASTER_PLAN.md), and
[docs/README.md](docs/README.md) for project direction.
