# Targeted checkpoint review — Claude `05ce03e`

**Grok branch:** `executor/grok-daily-acceptance`  
**Claude HEAD tested:** `05ce03e986cd2774601d49f3c407eaa279914380`  
**Tip equals SHA:** YES  
**Full 24-gate acceptance:** **NOT_YET**  
**Shared runtime files touched:** 0  
**Spend USD:** 0  
**Date:** 2026-08-13  

## Scope

Independent adversarial review of claimed Phase 8–9 areas only:

multi-photo · lot-scope · orchestrator · active context · usefulness · Caleb retrieval (synthetic structure, no private seed leak) · model-absence impact  

Not graded: HTTPS, voice device, full Owner-day production, web live fetch, state migration.

## Verdict summary

| Area | Result |
|------|--------|
| MULTI_PHOTO | **PASS** |
| LOT_SCOPE_REASONING | **PASS** (usefulness ~4.7/5) |
| ORCHESTRATOR_USEFULNESS | **PASS** with **1 nonblocking pattern gap** |
| ACTIVE_CONTEXT | **PASS** (vehicle + customer) |
| CALEB_RETRIEVAL | **PASS** on synthetic fixtures + unit suite |
| THE_REAL_PLAY_FALSE_POSITIVE | **PASS** (distractor without query tokens rejected) |
| XO_RETRIEVAL | **PASS** |
| HISTORICAL_CURRENT_BOUNDARY | **PASS** |
| MODEL_ABSENCE_IMPACT | Documented — deterministic composition holds |
| FULL_ACCEPTANCE_RUN | **NOT_YET** |

Claude unit tests at this SHA: **61/61 PASS** (`daily-intelligence` + `conversation-orchestrator` dist-test).

---

## MULTI_PHOTO

| Check | Status |
|-------|--------|
| Invalid first OCR `STDAAABS1RS004150` does not terminate | PASS |
| Valid second VIN resolves | PASS |
| Third image enriches; inventory exact join only | PASS |
| Two valid different VINs → no silent merge | PASS |
| FALSE_FUSION | 0 |

Domain service acceptance only (no private physical device).

---

## LOT_SCOPE_REASONING

**Q:** “How many other used cars are on the lot?”  
**Setup:** 1 physically verified Crown; 41 used listed online.

**Observed reply (excerpt):**

> I've physically verified 1 used vehicle… That's my whole physical sample. The dealer website currently lists 41 used vehicles… That's the online inventory, **not proof** they're all standing out there. How many are actually on the lot, **I don't know.** … Keep photographing…

| Requirement | Status |
|-------------|--------|
| Physical sample stated | PASS |
| Physical total UNKNOWN | PASS |
| Website count separate | PASS |
| website ≠ physical proof | PASS |
| Useful next action (once, not doubled in compose) | PASS |
| REPEATED_RECORD_WITHOUT_ANSWERING | **not triggered** |
| Overclaim detector catches “41 used vehicles on the lot” | PASS |

**Usefulness scores (this reply):**

| Dimension | Score |
|-----------|------:|
| GROUNDING | 5 |
| USEFULNESS | 5 |
| CONTEXT_RETENTION | 4 |
| NATURALNESS | 4 |
| ACTIONABILITY | 5 |
| PROACTIVITY | 5 |
| HONESTY_ABOUT_UNKNOWN | 5 |
| **MEAN** | **4.71** |

Compose path uses `alreadyAdvised` so domain next-step is not duplicated when proactive offer overlaps.

---

## ORCHESTRATOR

| Question | Goal expected | Observed | Status |
|----------|---------------|----------|--------|
| How many other used cars… | LOT_POPULATION | LOT_POPULATION | PASS |
| What about the price? | VEHICLE_DETAIL | VEHICLE_DETAIL | PASS |
| Who might want this one? | VEHICLE_BUYER_MATCH | VEHICLE_BUYER_MATCH | PASS |
| What don't we know yet? | WHAT_IS_UNKNOWN | WHAT_IS_UNKNOWN | PASS |
| Make a post for this one. | CONTENT_FOR_VEHICLE | CONTENT_FOR_VEHICLE | PASS |
| What should I do next? | PLAN_MY_DAY | PLAN_MY_DAY | PASS |
| What do you think I should focus on next? | PLAN_MY_DAY | PLAN_MY_DAY | PASS |
| **What should I focus on next?** | PLAN_MY_DAY | **UNCLEAR** | **FAIL (nonblocking)** |
| What was THE REAL PLAY? | OWNER_HISTORY | OWNER_HISTORY | PASS |
| Can you find out instead of guessing? | VERIFY_INSTEAD_OF_GUESS | PASS |
| Is this actually a good match for Sarah? | CUSTOMER_FIT | PASS |

### Defect (nonblocking)

```
ID = ORCH-PLAN-PHRASE-GAP
SEVERITY = nonblocking
EXPECTED = "What should I focus on next?" → PLAN_MY_DAY (or prioritization)
OBSERVED = UNCLEAR (confidence 0)
EVIDENCE = understandGoal patterns cover "what should i do next", "where should i focus",
  "what do you think i should focus" but not bare "what should i focus on next"
RECOMMENDED_FIX_DIRECTION = extend PLAN_MY_DAY / PRIORITIZE signal patterns for
  "what should i focus…" without requiring "do you think" / "do next" wording
```

Tool planning: LOT_POPULATION requires `lot_walk_observations` + `website_inventory`. CUSTOMER_FIT multi-source tools present. PASS.

---

## ACTIVE_CONTEXT

| Check | Status |
|-------|--------|
| Vehicle focus → “this one” / price | PASS |
| Customer + vehicle → “good match for her” | PASS (both refs retained) |

---

## CALEB / OWNER KNOWLEDGE (structure)

Private seed contents **not** copied into Git or this report. Synthetic fixtures + unit tests only.

| Check | Status |
|-------|--------|
| THE REAL PLAY not stolen by “real-estate” title | PASS (with clean distractor) |
| XO short token (2-char terms) | PASS |
| Trading + collaborator retrieval | PASS |
| Unsupported question admits insufficiency | PASS |
| AION design retrieval | PASS |
| History answer not framed as live lot authority | PASS |

Unit suite also asserts archive false-positive resistance and re-ingest idempotency.

---

## MODEL_ABSENCE_IMPACT

Claude reports no FAST/REASONING local text models installed.

**Observed routing** (`routeReasoningTier` with empty `availableTextModels`):

```json
{
  "tier": "DETERMINISTIC",
  "reason": "no local text model is installed, so the answer is composed from evidence directly",
  "degradedFrom": "REASONING_LOCAL"
}
```

| Still correct/useful without LLM | Weak until models exist |
|----------------------------------|-------------------------|
| Lot-scope composition | Nuanced multi-car prioritization prose |
| Goal scoring for covered phrases | Open “what should I focus…” without pattern match |
| Tool plan selection | Cross-domain synthesis tone |
| Memory retrieve + admit unknown | Long-form personality polish |
| Multi-photo VIN consensus | — |

**Do not fail checkpoint solely for model absence.** Deterministic orchestrator meets the Owner-critical lot and multi-photo semantics under review.

---

## Personality / usefulness flags

| Flag | Observed |
|------|----------|
| Enum / schema leak in Owner lot reply | No |
| Debug dump | No |
| Generic chatbot filler | No |
| Duplicate next-step after compose | No |
| Contradictory physical vs website | No |

---

## Defects inventory

| Severity | Count | Items |
|----------|------:|-------|
| CRITICAL | **0** | — |
| NONBLOCKING | **1** | ORCH-PLAN-PHRASE-GAP (`What should I focus on next?` → UNCLEAR) |

---

## Full acceptance

**FULL_ACCEPTANCE_RUN = NOT_YET**

Wait for Director: `READY_FOR_GROK_ACCEPTANCE = YES` + later immutable SHA for the complete 24-gate suite.
