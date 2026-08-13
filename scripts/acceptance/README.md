# Daily-intelligence acceptance lab (Grok)

Independent QA. Does not modify Claude runtime files.

**Standby:** Do not test Claude mid-write. Wait for Director:

```text
CLAUDE_HEAD_TO_TEST = <immutable SHA>
```

Reference stable (pre mid-write) Claude SHA for context only:  
`0d93583779b7e0ad5f1cf6860c097e84f8cbc358`

## Standby self-check (no Claude domain run)

```powershell
cd C:\AION-HQ-grok-daily-acceptance
node scripts/acceptance/daily-intelligence-acceptance.mjs
node scripts/acceptance/score-usefulness.mjs
node scripts/benchmarks/daily-intelligence-latency.mjs --mode dry-run
```

## Official run (immutable SHA only)

```powershell
$env:CLAUDE_HEAD_TO_TEST = "<immutable SHA from Director>"
git -C C:\AION-HQ-claude-daily-intelligence fetch origin
git -C C:\AION-HQ-claude-daily-intelligence rev-parse $env:CLAUDE_HEAD_TO_TEST
git -C C:\AION-HQ-claude-daily-intelligence checkout --detach $env:CLAUDE_HEAD_TO_TEST
# Build dist in Claude tree if needed — do not edit Claude sources
$env:AION_CLAUDE_WORKTREE = "C:\AION-HQ-claude-daily-intelligence"
$env:AION_ACCEPTANCE_HEAD = $env:CLAUDE_HEAD_TO_TEST
node scripts/acceptance/daily-intelligence-acceptance.mjs
node scripts/acceptance/score-usefulness.mjs
node scripts/benchmarks/daily-intelligence-latency.mjs --mode domain
# Fill docs/reviews/daily-intelligence-final-report-template.md
```

**Do not** set `AION_FORCE_DOMAIN=1` for official grading (debug only).

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
