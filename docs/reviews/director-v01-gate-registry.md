# Director v0.1 Gate Registry (independent)

**Branch:** `executor/grok-director-v01-acceptance`  
**Base:** `1ce25ba2e82e576618ab3c9a007af92940a94bfd`  
**Design:** `executor/grok-director-v01-design` @ `1e0abab87ee8faf157598399e02e9ad77252c837`  
**Do not weaken.**

Machine catalog: `scripts/acceptance/director/fixtures/gate-catalog.json` (85 gates).

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

Grok does not fix Director runtime. Failures return to Claude.
