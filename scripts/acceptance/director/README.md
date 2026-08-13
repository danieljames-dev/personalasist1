# Director v0.1 independent acceptance lab (Grok)

Frozen **before** Claude implements `executor/claude-director-v01`.

Do **not** weaken fixtures to make Claude pass.

## Standby (now)

```powershell
cd C:\AION-HQ-grok-director-v01-acceptance
node scripts/acceptance/director/director-acceptance.mjs
```

Runs fixture integrity, authority/git/crash/retry oracles, and real Claude/Grok `--help` probes.
Domain Director runtime is **SKIP** until an immutable SHA is set.

## Official run (immutable Claude SHA only)

```powershell
$env:CLAUDE_DIRECTOR_SHA = "<40-char SHA>"
$env:AION_DIRECTOR_WORKTREE = "C:\AION-HQ-claude-director-v01"  # example; do not invent
node scripts/acceptance/director/director-acceptance.mjs
```

Never test a moving branch tip.

## Isolated

Does not write `private/aion/state-v1.json`.
Does not start production.
Does not modify Claude's implementation.

## Verdicts

`PASS` `FAIL` `BLOCKED` `OWNER_RETEST_PENDING`

Automated Director PASS + physical iPhone still pending is allowed:
Director's correct action is to **stop work that depends on that gate**.
It must **not** freeze unrelated authorized work solely because the gate is open.
`WAITING_FOR_OWNER` is only the mission presentation when no independent READY/RUNNING work remains.

## Addendum (95 gates)

Gates 86–95 (`work-items.json`) freeze Owner gates as local dependency blocks.
Do not weaken gates 1–85. Do not inspect a future Claude SHA to reshape these fixtures.

## Known-defect regression pack (separate)

Implementation defects found later live under `scripts/acceptance/director/regressions/`.
They do **not** edit the 95-gate catalog. Final acceptance runs both runners.
