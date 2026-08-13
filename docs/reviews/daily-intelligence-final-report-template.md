# Daily-Intelligence Acceptance Final Report

**Fill only after Director sets `CLAUDE_HEAD_TO_TEST` and Grok runs against that immutable SHA.**

```text
GROK_BRANCH = executor/grok-daily-acceptance
GROK_HEAD =
CLAUDE_HEAD_TESTED =
TESTED_AT_UTC =
BASE_MAIN_HEAD =
```

## Evidence tiers (summary)

```text
AUTOMATED_PASS =
LOCAL_BROWSER_PASS =
TAILSCALE_HTTPS_PASS =
PHYSICAL_IPHONE_OWNER_RETEST_PENDING = YES
```

Do **not** set PHYSICAL_IPHONE to PASS without Owner device confirmation.

## Gate results

| # | Gate | Status | Tier | Notes |
|---|------|--------|------|-------|
| 1 | MULTI_PHOTO_REAL_CHAT | | | |
| 2 | INVALID_FIRST_OCR_RECOVERY | | | |
| 3 | MULTI_VEHICLE_CONFLICT_SAFE | | | |
| 4 | ACTIVE_VEHICLE_CONTEXT | | | |
| 5 | POST_UPLOAD_PROGRESS | | | |
| 6 | NO_LONG_SILENT_WAIT | | | |
| 7 | LATENCY_MEASUREMENT | | | |
| 8 | HTTPS_TAILSCALE_ONLY | | | |
| 9 | VOICE_FORMAT_NEGOTIATION | | | |
| 10 | VOICE_WHISPER_CONVERSATION | | | |
| 11 | PHYSICAL_VS_WEBSITE_REASONING | | | |
| 12 | CONVERSATIONAL_ORCHESTRATOR | | | |
| 13 | MULTI_SOURCE_TOOL_PLANNING | | | |
| 14 | FAST_VS_REASONING_ROUTING | | | |
| 15 | PERSONALITY_QUALITY | | | |
| 16 | ACTIVE_CUSTOMER_CONTEXT | | | |
| 17 | NAME_ONLY_AMBIGUITY_SAFETY | | | |
| 18 | PROACTIVE_HELP | | | |
| 19 | CALEB_OWNER_KNOWLEDGE | | | |
| 20 | PUBLIC_WEB_RESEARCH | | | |
| 21 | WEB_NO_AUTHORITY_ESCALATION | | | |
| 22 | ZERO_SPEND_GUARD | | | |
| 23 | STATE_SIDECAR_CAPACITY | | | |
| 24 | OWNER_DAY_E2E | | | |
| 25 | MODEL_NUMERIC_GROUNDING | | | |
| 26 | MODEL_ATTRIBUTE_GROUNDING | | | |
| 27 | MODEL_FACT_PROVENANCE | | | |
| 28 | MODEL_LATENCY_ROUTING | | | |
| 29 | MODEL_MISSING_HEALTH | | | |
| 30 | NATURAL_PRIORITY_PHRASE_COVERAGE | | | |

### Model grounding sample (required when models used)

```text
MAX_PRICE = 33000
VEHICLE_PRICE = 34120
AWD = UNKNOWN

INCORRECT_NUMERIC_COMPARISON =
UNSUPPORTED_ATTRIBUTE_ASSERTION =
STATES_OVER_BUDGET =
AWD_TREATED_AS_UNKNOWN =
```

## Usefulness scores (conversational sample)

| QID | Question | GROUNDING | USEFULNESS | CONTEXT | NATURALNESS | ACTIONABILITY | PROACTIVITY | HONESTY | Mean | Fail flags |
|-----|----------|-----------|------------|---------|-------------|-----------------|-------------|---------|------|------------|
| LOT | How many other used cars… | | | | | | | | | |
| C2 | What should I focus on… | | | | | | | | | |
| C4 | Good match for Sarah? | | | | | | | | | |
| C8 | Caleb decision… | | | | | | | | | |
| C9 | Find out what's current… | | | | | | | | | |

**Lot-count special rule:** FAIL if answer only repeats the one observed vehicle.

Mean threshold for “feels useful”: **≥ 3.5** and **zero** fail flags.

## Latency

| Case | t_first_useful ms | t_full_result ms | Bottleneck note |
|------|-------------------|------------------|-----------------|
| L1 1 image | | | |
| L2 3 images | | | |
| L3 bad-first | | | |
| L4 warm | | | |

## Defects

```text
DEFECT_ID =
SEVERITY =
GATE =
OBSERVED =
EXPECTED =
```

## Recommendation

```text
READY_FOR_MAIN_INTEGRATION = YES | NO | CONDITIONAL
CONDITIONS =
```
