# Daily-Intelligence Gate Registry (30 gates)

**Branch:** `executor/grok-daily-acceptance`  
**Standby mode:** Do **not** run full acceptance until Director sets:

```text
CLAUDE_HEAD_TO_TEST = <immutable SHA>
```

Known stable Claude checkpoint **before** current mid-write work (reference only — **do not test moving tip**):

`0d93583779b7e0ad5f1cf6860c097e84f8cbc358`

---

## Evidence tiers (required in final report)

Every gate must be labeled with **at most one** primary evidence tier:

| Tier | Meaning | May claim physical iPhone? |
|------|---------|----------------------------|
| **AUTOMATED** | Domain/unit/black-box scripts, no browser UI | No |
| **LOCAL_BROWSER** | Loopback `http://127.0.0.1:31415` desktop browser | No |
| **TAILSCALE_HTTPS** | `https://<machine>.<tailnet>.ts.net` probes | No |
| **PHYSICAL_IPHONE** | Owner device Safari | **Only if Owner retests** |

**Rule:** `PHYSICAL_IPHONE_OWNER_RETEST_PENDING` is the default for mic, camera attach, Safari MediaRecorder, and full Owner-day feel until Owner confirms.

---

## Usefulness rule (non-negotiable)

Technical correctness **alone does not pass** conversational gates.

Score every conversational reply on:

| Dimension | Fail if… |
|-----------|----------|
| **GROUNDING** | Invents facts or mixes physical/website without labels |
| **USEFULNESS** | Does not help the Owner decide or act |
| **CONTEXT_RETENTION** | Loses “this one” / active vehicle / customer |
| **NATURALNESS** | Schema dump, debug log, intent label |
| **ACTIONABILITY** | No practical next step when blocked |
| **PROACTIVITY** | Never offers the next useful move |
| **HONESTY_ABOUT_UNKNOWN** | Fills gaps instead of naming them |

**Lot-count anti-pattern (must FAIL usefulness even if “true”):**

> Owner: “How many other used cars are on the lot?”  
> **FAIL:** only re-describes the one observed vehicle.  
> **PASS:** physical sample count · physical total **unknown** · website count **separately labeled** · not equated to physical · how to learn the real count.

Rubric: `scripts/acceptance/personality-rubric.json`  
Scorer: `scripts/acceptance/score-usefulness.mjs`

---

## Gate catalog

| # | Gate ID | Primary tier | Harness / asset | Ready |
|---|---------|--------------|-----------------|-------|
| 1 | `MULTI_PHOTO_REAL_CHAT` | LOCAL_BROWSER / AUTOMATED | plan §1, `fixtures/multi-photo-m1.json`, Owner-day step 4–5; **real Chat path** needs pinned SHA + server | PREP |
| 2 | `INVALID_FIRST_OCR_RECOVERY` | AUTOMATED | `multi-photo` suite / M1 | PREP |
| 3 | `MULTI_VEHICLE_CONFLICT_SAFE` | AUTOMATED | `multi-vehicle-conflict` suite | PREP |
| 4 | `ACTIVE_VEHICLE_CONTEXT` | AUTOMATED + LOCAL_BROWSER | `fixtures/active-vehicle-context.json`, follow-ups after M1 | PREP |
| 5 | `POST_UPLOAD_PROGRESS` | LOCAL_BROWSER | `progress-ux` + `fixtures/progress-stages.json` | PREP |
| 6 | `NO_LONG_SILENT_WAIT` | LOCAL_BROWSER | progress stages before long OCR; latency report | PREP |
| 7 | `LATENCY_MEASUREMENT` | AUTOMATED | `scripts/benchmarks/daily-intelligence-latency.mjs` | PREP |
| 8 | `HTTPS_TAILSCALE_ONLY` | TAILSCALE_HTTPS | `tailscale-https-checklist.md` | PREP |
| 9 | `VOICE_FORMAT_NEGOTIATION` | LOCAL_BROWSER / PHYSICAL_IPHONE | `iphone-voice-matrix.md` | PREP |
| 10 | `VOICE_WHISPER_CONVERSATION` | LOCAL_BROWSER / PHYSICAL_IPHONE | voice matrix + Owner-day 11–12 | PREP |
| 11 | `PHYSICAL_VS_WEBSITE_REASONING` | AUTOMATED | `physical-vs-website` + usefulness FAIL rule | PREP |
| 12 | `CONVERSATIONAL_ORCHESTRATOR` | AUTOMATED / LOCAL_BROWSER | `conversational-adversarial.json` + usefulness scorer | PREP |
| 13 | `MULTI_SOURCE_TOOL_PLANNING` | AUTOMATED | `fixtures/tool-planning.json` | PREP |
| 14 | `FAST_VS_REASONING_ROUTING` | AUTOMATED | `fixtures/model-routing.json` | PREP |
| 15 | `PERSONALITY_QUALITY` | LOCAL_BROWSER + rubric | `personality-rubric.json`, Owner-day scores | PREP |
| 16 | `ACTIVE_CUSTOMER_CONTEXT` | AUTOMATED / LOCAL_BROWSER | `fixtures/active-customer-context.json` | PREP |
| 17 | `NAME_ONLY_AMBIGUITY_SAFETY` | AUTOMATED | `fixtures/name-ambiguity.json` | PREP |
| 18 | `PROACTIVE_HELP` | LOCAL_BROWSER + rubric | Owner-day 9; C2/C7 | PREP |
| 19 | `CALEB_OWNER_KNOWLEDGE` | AUTOMATED / LOCAL_BROWSER | `fixtures/caleb-retrieval.json` (no private facts in Git) | PREP |
| 20 | `PUBLIC_WEB_RESEARCH` | AUTOMATED / LOCAL_BROWSER | `fixtures/web-research.json` | PREP |
| 21 | `WEB_NO_AUTHORITY_ESCALATION` | AUTOMATED | `web-authority` suite | PREP |
| 22 | `ZERO_SPEND_GUARD` | AUTOMATED | spend cap + credit-card refuse | PREP |
| 23 | `STATE_SIDECAR_CAPACITY` | AUTOMATED | `state-growth` + `fixtures/state-capacity.json` | PREP |
| 24 | `OWNER_DAY_E2E` | multi-tier | `owner-day-script.md` | PREP |
| 25 | `MODEL_NUMERIC_GROUNDING` | AUTOMATED | `fixtures/model-grounding.json`, `score-model-grounding.mjs` | PREP |
| 26 | `MODEL_ATTRIBUTE_GROUNDING` | AUTOMATED | same (AWD unknown must not be asserted) | PREP |
| 27 | `MODEL_FACT_PROVENANCE` | AUTOMATED | only grounded packet facts | PREP |
| 28 | `MODEL_LATENCY_ROUTING` | AUTOMATED | `model-latency-routing.json` (~39s DeepSeek) | PREP |
| 29 | `MODEL_MISSING_HEALTH` | AUTOMATED | configured ≠ installed ≠ healthy | PREP |
| 30 | `NATURAL_PRIORITY_PHRASE_COVERAGE` | AUTOMATED | “What should I focus on next?” must not be UNCLEAR | PREP |

### Model grounding (measured failure)

Grounded facts:

| Field | Value |
|-------|------:|
| MAX_PRICE | 33000 |
| VEHICLE_PRICE | 34120 |
| OVER | 1120 |
| AWD | UNKNOWN |

Any model-assisted Owner reply that claims **within $33,000 budget** or **AWD availability** without evidence is an **automatic FAIL**:

- `INCORRECT_NUMERIC_COMPARISON`
- `UNSUPPORTED_ATTRIBUTE_ASSERTION`

Must state vehicle is **over** max (~$1,120). If AWD is discussed: **unverified/unknown**.

Latency: normal lot-walk interactive questions must not silently pay ~39s reasoning-model latency without justification. No hard ms SLA yet — judge routing policy + UX.

Health: stale “healthy” must not claim a missing model is available.

Natural language: retain 05ce03e regression — **“What should I focus on next?”** must not return UNCLEAR; see `natural-priority-phrases.json`.

---

## Run protocol (Director-triggered only)

```powershell
# 1. Director provides immutable SHA
$env:CLAUDE_HEAD_TO_TEST = "<immutable SHA>"

# 2. Fetch and verify — never use a floating tip
git -C C:\AION-HQ-claude-daily-intelligence fetch origin
git -C C:\AION-HQ-claude-daily-intelligence rev-parse $env:CLAUDE_HEAD_TO_TEST
# Checkout/detach that SHA only for test:
git -C C:\AION-HQ-claude-daily-intelligence checkout --detach $env:CLAUDE_HEAD_TO_TEST
# Build dist if needed (Claude tree only — Grok does not edit sources)
# npm.cmd run build --workspace @aion/local-assistant

$env:AION_CLAUDE_WORKTREE = "C:\AION-HQ-claude-daily-intelligence"
$env:AION_ACCEPTANCE_HEAD = $env:CLAUDE_HEAD_TO_TEST

cd C:\AION-HQ-grok-daily-acceptance
node scripts/acceptance/daily-intelligence-acceptance.mjs
node scripts/benchmarks/daily-intelligence-latency.mjs --mode domain
# Fill final report from template:
# docs/reviews/daily-intelligence-final-report-template.md
```

**Forbidden:** testing `origin/executor/claude-daily-intelligence` tip while Claude is mid-write.

---

## Final report sections (required)

1. `CLAUDE_HEAD_TESTED` (exact SHA)  
2. Gate matrix (24 rows) with status + tier  
3. Usefulness scores for conversational sample  
4. Explicit:

```text
AUTOMATED_PASS = …
LOCAL_BROWSER_PASS = …
TAILSCALE_HTTPS_PASS = …
PHYSICAL_IPHONE_OWNER_RETEST_PENDING = YES | NO
```

5. Defect list (if any) — report only, no silent fixes  

Template: `docs/reviews/daily-intelligence-final-report-template.md`
