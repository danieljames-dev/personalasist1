# Daily-intelligence acceptance lab (Grok)

Independent QA. Does not modify Claude runtime files.

## Run fixture self-check (no Claude worktree)

```powershell
cd C:\AION-HQ-grok-daily-acceptance
node scripts/acceptance/daily-intelligence-acceptance.mjs
node scripts/benchmarks/daily-intelligence-latency.mjs --mode dry-run
```

## Run against a pinned Claude checkpoint

```powershell
git -C C:\AION-HQ-claude-daily-intelligence fetch origin
$h = git -C C:\AION-HQ-claude-daily-intelligence rev-parse origin/executor/claude-daily-intelligence
# Build domain package in Claude worktree (Claude/Owner action — Grok does not edit sources)
# npm.cmd run build --workspace @aion/local-assistant
$env:AION_CLAUDE_WORKTREE = "C:\AION-HQ-claude-daily-intelligence"
$env:AION_ACCEPTANCE_HEAD = $h
node scripts/acceptance/daily-intelligence-acceptance.mjs
node scripts/benchmarks/daily-intelligence-latency.mjs --mode domain
```

## Suites

| Suite | `--suite` |
|-------|-----------|
| Fixtures | `fixtures` |
| Multi-photo | `multi-photo` |
| Multi-VIN conflict | `multi-vehicle-conflict` |
| Physical vs website | `physical-vs-website` |
| Web authority | `web-authority` |
| State growth | `state-growth` |
| Progress UX static | `progress-ux` |
| Claude unit tests | `claude-tests` |

Reports write to `scripts/acceptance/out/` and `scripts/benchmarks/out/` (local; may be gitignored).
