# Director v0.1 Gate Registry (independent)

**Branch:** `executor/grok-director-v01-acceptance`  
**Base:** `1ce25ba2e82e576618ab3c9a007af92940a94bfd`  
**Design:** `executor/grok-director-v01-design` @ `1e0abab87ee8faf157598399e02e9ad77252c837`  
**Do not weaken.**

Machine catalog: `scripts/acceptance/director/fixtures/gate-catalog.json` (95 gates).

Addendum (forward-only, before Claude's final Director SHA): Owner gates are **local dependency blocks**. An unresolved gate must not freeze unrelated authorized work. Gates 1–85 are unchanged. Gates 86–95 encode the local-blocking contract.

Wait for:

```text
CLAUDE_DIRECTOR_SHA = <immutable>
```

## Evidence tiers

| Tier | Meaning |
|------|---------|
| AUTOMATED | Fixtures + oracle + later Director module import |
| LOCAL_PROCESS | Real CLI discovery / loopback bind |
| COMMAND_CENTER_BRIDGE | `/api/director/*` pairing/origin |
| TAILSCALE_HTTPS | Funnel off / private Serve |
| OWNER_GATE | Physical iPhone remains pending until Owner |

## Hard questions (not “unit tests passed”)

Can it continue an authorized mission? Tell Git/process truth? Coordinate executors? Survive crash? Stop at Owner gates? Refuse hostile text as authority? Avoid being a second business-state writer? Avoid worktree races and infinite Claude↔Grok loops? Spend $0?

## Review must report

```text
AUTOMATED_DIRECTOR_VERDICT =
FIRST_REAL_MISSION_STATUS =
PRODUCTION_MUTATED =
OWNER_GATE_STATUS =
RECOMMEND_DIRECTOR_INTEGRATION =
```

## Addendum gates 86–95 (local Owner-gate blocking)

| Id | Gate |
|----|------|
| 86 | OWNER_GATE_LOCAL_BLOCKING |
| 87 | OWNER_GATE_DEPENDENT_WORK_BLOCKED |
| 88 | OWNER_GATE_RESOLUTION_UNBLOCKS_DEPENDENT |
| 89 | WAITING_FOR_OWNER_ONLY_WHEN_NO_READY_WORK |
| 90 | GLOBAL_PAUSE_OVERRIDES_READY_WORK |
| 91 | WORK_ITEM_LEASE_COLLISION |
| 92 | SAFE_PARALLEL_NONCONFLICTING_WORK |
| 93 | HIGH_CONSEQUENCE_GATE_NOT_BYPASSED_BY_PARALLELISM |
| 94 | REBOOT_PRESERVES_OPEN_GATE_AND_READY_WORK |
| 95 | DASHBOARD_DISTINGUISHES_WORKING_VS_WAITING |

`WAITING_FOR_OWNER` is the presentation when **every remaining unfinished work item** depends on an Owner gate. Opening a physical iPhone gate must not idle a mission that still has independent READY/RUNNING work. Global `PAUSED` still stops everything.

Grok does not fix Director runtime. Failures return to Claude.
