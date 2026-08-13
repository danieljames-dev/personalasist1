# Independent Daily-Intelligence Final Acceptance

**Executor:** Grok (acceptance only — no Claude implementation edits, no merge, no deploy)  
**Tested at:** 2026-08-13T18:05:00Z  
**Spend:** USD 0  

```text
CLAUDE_HEAD_TESTED = 16e5c3c29c0ec23b09d7ae78960f3a1db710965f
CLAUDE_BRANCH      = executor/claude-daily-intelligence
PREVIOUS_CHECKPOINT = 9a915bef5a5563ccc59af28b98c4b42cc86d1160  (ancestor; not tested)
BASE_MAIN_HEAD     = d18c7927c1e9eec0f876201b36a487b2ac91add0
EXAM_WORKTREE      = C:\AION-HQ-grok-exam-16e5c3c  (detached, isolated)
```

## 1. Repository truth (proved, not copied)

`git fetch --all --prune` was run from `C:\AION-HQ` before any test.

| Source | SHA |
|--------|-----|
| Durable handoff `.aion-local/coordination/CLAUDE-LATEST.md` | `16e5c3c29c0ec23b09d7ae78960f3a1db710965f` |
| Durable handoff `.aion-local/handoffs/LATEST.md` | same |
| `refs/heads/executor/claude-daily-intelligence` | same |
| `refs/remotes/origin/executor/claude-daily-intelligence` | same |
| Claude worktree `C:\AION-HQ-claude-daily-intelligence` | same |
| Isolated exam worktree (this run) | same |

```text
CLAUDE_HEAD_FROM_GIT
== CLAUDE_HEAD_FROM_HANDOFF
== CLAUDE_REMOTE_HEAD
== 16e5c3c29c0ec23b09d7ae78960f3a1db710965f

READY_FOR_FULL_GROK_ACCEPTANCE = YES   (explicit in durable handoff)
READY_TO_INTEGRATE             = NO    (handoff; this exam does not change that)
```

Ancestry: `9a915bef` **is** an ancestor of `16e5c3c`. Single later commit:

`16e5c3c Autonomy at runtime, and the Owner day that proved two things wrong`

The exam never used a moving tip. SHA was re-read after tests and had not advanced.

```text
ORIGIN_MAIN_HEAD        = d18c7927c1e9eec0f876201b36a487b2ac91add0
PRODUCTION_RUNNING_HEAD = d18c7927c1e9eec0f876201b36a487b2ac91add0
PRODUCTION_PROCESS      = PID 29220
  node C:\AION-HQ-main-integrate\apps\aion-command-center.mjs --port 31415
PRODUCTION_MUTATED      = NO
```

## 2. Grok acceptance lab recovered (not recreated)

```text
GROK_ACCEPTANCE_BRANCH      = executor/grok-daily-acceptance
GROK_ACCEPTANCE_HEAD_AT_START = eebe2ca8c7379289cb88efdeea00b650645c7d4c
EXISTING_ACCEPTANCE_GATE_COUNT = 30
WORKTREE                    = C:\AION-HQ-grok-daily-acceptance
```

Frozen assets were **not** edited to accommodate Claude. One **new** post-suite harness was added:

`scripts/acceptance/final-independent-gates.mjs`

It attacks composition defects that post-date the 30-gate lab (rephrasing allowlist, autonomy provenance, Owner-day continuity).

## 3. What was tested

Against **exactly** `16e5c3c`:

1. Existing 30-gate runner (`daily-intelligence-acceptance.mjs`) + usefulness + grounding scorers  
2. New independent composition/autonomy/grounding harness  
3. `npm run verify` in isolated exam worktree  
4. Targeted domain tests (owner-day, autonomy, synthesis, multi-photo, web, orchestrator) — 90/90  
5. Isolated `test/aion/access.test.mjs` — 25/25 (origin, pairing, proxy trust, progress)  
6. Hygiene scan of `d18c792..16e5c3c`  
7. Local bind / Tailscale Serve / Ollama bind inspection  
8. Local GET of preview `:31416` and production `:31415` pages  

Claude's worktree and `C:\AION-HQ` were not used as a writer. Production was not written.

## 4. Build / full verify

```text
BUILD                 = PASS   (typecheck + test, verify exit 0)
FULL_VERIFY           = PASS   1500 tests, 1496 pass, 0 fail, 4 skipped
LOCAL_ASSISTANT_TESTS = PASS   1051 / 1051
SERVER_TESTS          = PASS   112 / 112
NOT_OK_LINES          = 0
```

Independent recount of TAP `# tests` / `# pass` / `# skipped` blocks in the verify log matches Claude's claimed 1496 / 0 / 4.

## 5. Existing 30-gate suite (frozen)

```text
PASS = 59
FAIL = 1
SKIP = 0
```

**The one frozen-suite FAIL**

| Field | Value |
|-------|--------|
| ID | `progress.has:Reading the VIN` |
| Severity | nonblocking (static string) |
| Expected (frozen check) | exact substring `Reading the VIN` in `apps/aion/public/app.js` |
| Actual | client emits `Uploading N of M…` / `Reading the photos…`; server/service emits **`Checking the VIN…`**, `Checking inventory…`, `Vehicle identified.`, `Reading sticker details…`, `Preparing answer…` |
| Reproduction | `node scripts/acceptance/daily-intelligence-acceptance.mjs` with `AION_CLAUDE_WORKTREE` at `16e5c3c` |
| Why not a product blocker | Fixture `progress-stages.json` already allows `Checking VIN… / Reading the VIN…`. Runtime matches the first form. Isolated access tests prove live progress stages and truthful close-out. **The frozen check was not weakened.** |

Usefulness scorer self-check: PASS (lot recap-only fails; structured lot answer passes).  
Model-grounding scorer self-check: PASS (measured Qwen fail flagged; grounded pass clean).

## 6. Independent final gates (post-suite)

Harness: `scripts/acceptance/final-independent-gates.mjs`  
Raw: 78 PASS, 1 FAIL (harness false-fail — see below).

A malicious synthesizer that *always* tried to flatten lot/archive answers into “120 cars on the lot” / “entire archive imported” was injected.

| Gate | Verdict | Evidence |
|------|---------|----------|
| MULTI_PHOTO_REAL_CHAT | **PASS** | 3-image bundle RESOLVED to `JTDACAAJ8T3051788` |
| INVALID_FIRST_OCR_RECOVERY | **PASS** | invalid `STDAAABS1RS004150` did not become identity |
| MULTI_VALID_VIN_CONFLICT | **PASS** | `UNRESOLVED_CONFLICTING_VINS`, `validatedVin=null` |
| FALSE_FUSION | **PASS** | no silent pick |
| FALSE_VIN_LINKS | **PASS** | bad OCR never linked |
| CORRUPT_IMAGE_ISOLATED | **PASS** | undecodable + valid still RESOLVED |
| OTHER_VALID_IMAGES_CONTINUE | **PASS** | same |
| ACTIVE_VEHICLE_CONTEXT | **PASS** | “What about the price?” kept Camry after photos **and** after web |
| PROVISIONAL_IDENTITY_NOT_FINAL | **PASS** | conflict path does not leave a VIN in focus |
| POST_UPLOAD_PROGRESS | **PASS** | service stages + access tests 22–25 |
| NO_LONG_SILENT_WAIT | **PASS** | progress board + client stages; no fake % |
| TARGETED_VIN_BAND_RUNTIME | **PASS** | only `vin-strip`; exact inventory corroboration required |
| SAFE_FULL_FRAME_FALLBACK | **PASS** | EasyOCR full-frame still runs when band unproven |
| FALSE_VIN_SHORT_CIRCUIT | **PASS** | `if (!confirmed) continue` |
| PHYSICAL_VS_WEBSITE_REASONING | **PASS** | sample vs website vs unknown total |
| LOT_SCOPE_STRUCTURE_PRESERVED | **PASS** | model **not invoked**; `rejectedFor=["STRUCTURE_IS_THE_ANSWER"]` |
| CALEB_OWNER_KNOWLEDGE | **PASS** | retrieved how-AION-should-work fact |
| OWNER_ARCHIVE_LIMITATION_HONESTY | **PASS** | “not the whole archive” |
| OWNER_ARCHIVE_STRUCTURE_PRESERVED | **PASS** | model **not invoked**; flatten attempt never reached Owner |
| MODEL_REPHRASING_BOUNDARY | **PASS** | allowlist: lot/archive blocked; buyers may rephrase |
| PUBLIC_WEB_RESEARCH_RUNTIME | **PASS** | current-info → web path |
| CURRENT_INFO_TRIGGERS_WEB | **PASS** | goal `CURRENT_WEB_FACT` |
| CURRENT_INFO_WITHOUT_CURRENT_EVIDENCE | **PASS** | no silent model-memory substitute |
| WEB_SOURCE_METADATA_PRESERVED | **PASS** | `tailscale.com (checked 2030-01-01)` |
| WEB_AUTHORITY_ESCALATION | **PASS** | `blockedByOrigin=true`, instruction attempt detected |
| FREE_TOOL_AUTONOMY | **PASS** | research/benchmark/rebuild allowed under Owner request |
| ZERO_SPEND_GUARD | **PASS** | card/trial/paid plan blocked; `estimatedCostUsd=0` |
| HIGH_CONSEQUENCE_BOUNDARY | **PASS** | Funnel, delete production, OAuth/password, contract blocked |
| MODEL/DOCUMENT/OCR/EMAIL_AUTHORITY_ESCALATION | **PASS** | `originGrantsAuthority` false for all four |
| MODEL_NUMERIC_GROUNDING | **PASS** | `$34,120` / `$33,000` “within budget” rejected |
| MODEL_ATTRIBUTE_GROUNDING | **PASS** | “AWD available” rejected |
| MODEL_CANONICAL_FACT_CREATION | **PASS** | invalid synthesis discarded |
| INVALID_MODEL_OUTPUT_REACHES_OWNER | **PASS** | Owner-facing fit reply had no within-budget / AWD-available claim |
| MODEL_AVAILABILITY_HEALTH | **PASS** | configured ≠ installed ≠ stale-healthy ≠ healthy |
| MODEL_LATENCY_ROUTING | **PASS** | interactive synthesizer selects `/qwen/` only |
| INTERACTIVE_DEEPSEEK_DEFAULT | **PASS** | DeepSeek never selected for interactive phrasing |
| NATURAL_PRIORITY_LANGUAGE | **PASS** | 13/13 phrases → `PLAN_MY_DAY`, 0 `UNCLEAR` |
| VOICE_TO_CONVERSATION | **PASS** | same `OWNER_CONVERSATION` layer; transcript authority `NONE` |
| NAME_ONLY_AMBIGUITY_SAFETY | **PASS** | “What does Sarah want?” → which customer |
| PROACTIVE_HELP | **PASS** | honest empty next-step; no invented work |
| EXTERNAL_WRITES | **PASS** | Facebook draft only; no publish language |
| REALISTIC_OWNER_DAY_E2E | **PASS** | continuous conversation + 90/90 domain tests |
| IDENTICAL_CORRECT_ANSWER | **PASS** | focus/next were identical — **not** a failure |

**Harness false-fail (not a product fail):**  
`MODEL_REPHRASING_ALLOWLIST_INVOKED_ON_BUYERS` expected `modelUsed=true` on a *second* “Who might want this one?”. The spy saw `fit|budget|AWD` inside the packet and returned the measured hallucination; runtime correctly rejected it (`UNSUPPORTED_FIGURE`, `UNSUPPORTED_ATTRIBUTE`) and kept the deterministic answer. First buyers turn already produced grounded synthesis. Claude's own `synthesis-runtime` test “a grounded model reply is allowed through” passed independently.

### Owner-facing lot answer (verbatim, exam fixture)

> I've physically verified 1 used vehicle from your photos today — 2024 Toyota Camry XLE. That's my whole physical sample. The dealer website currently lists 2 used vehicles (feed checked about this hour). That's the online inventory, not proof they're all standing out there. How many are actually on the lot, I don't know. … Keep photographing as you walk and I'll build today's real count as you go.

### Owner-facing archive close (verbatim)

> That's from the 3 facts you've had me keep so far — not the whole archive.

## 7. Quality scores (Grok's, not Claude's)

| Dimension | Score | Why |
|-----------|------:|-----|
| GROUNDING | **5** | Claims traced to records or named unknown. Lot/archive structure held under a flattening model. |
| USEFULNESS | **4** | Strong on vehicle, lot, buyers, conflict. Planning is honest but thin (“nothing overdue”). |
| CONTEXT_RETENTION | **5** | Same Camry after price, buyers, unknowns, lot, web, voice-equivalent. |
| NATURALNESS | **4** | Reads as one assistant. Deterministic floor is plainer; archive answer still shows tag chips. |
| ACTIONABILITY | **4** | Lot has a next step. Empty task list is silently honest rather than invented. |
| PROACTIVITY | **4** | Offers a post when no buyer matches. Does not nag. |
| HONESTY_ABOUT_UNKNOWN | **4** | Lot/archive refuse invention. Dedicated “What don't we know?” understates gaps the post later names (AWD/drivetrain, recalls). Not a 3: it scopes to “I'd normally check,” and does not invent. |

Nothing below 4. The 4s are ceilings of current data/checklists, not release blockers.

**Usefulness is a hard gate:** the lot answer is useful (sample / website / unknown / next photo). A record recap would have failed. It did not.

## 8. HTTPS / production / exposure

```text
TAILSCALE_CONTROL_PLANE_CAPABILITY = PASS
  Serve (tailnet only):
    https://desktop-inlaqjq.tail177dc2.ts.net      -> 127.0.0.1:31415  (production / main)
    https://desktop-inlaqjq.tail177dc2.ts.net:8443 -> 127.0.0.1:31416  (Claude preview)
TAILSCALE_FUNNEL                   = OFF   (both routes labelled tailnet only)
OLLAMA_REMOTE                      = BLOCKED
  11434 listen = 127.0.0.1 only (PID 2948)
  loopback GET /api/tags = 200
LOCAL_PREVIEW_PAGE                 = 200   (http://127.0.0.1:31416/)
LOCAL_PRODUCTION_PAGE              = 200   (http://127.0.0.1:31415/, still main)
PREVIEW_PROCESS                    = PID 29824
  apps/aion-command-center.mjs --port 31416
  --data-root C:\AION-HQ-claude-daily-intelligence\private\aion
LIVE_MAGICDNS_GET_THIS_RUN         = NOT_PROBED
  (bounded tailnet URL probe was not executed in this session)
```

Origin / pairing / proxy-trust (isolated `access.test.mjs`, 25/25):

```text
FORGED_ORIGIN                              = 403  PASS
PREVIEW_UNAUTH_API (proxied unpaired)      = 401  PASS
TAILSCALE_PROXY_LOCALHOST_TRUST_BYPASS     = 0    PASS
  viaTailscaleServe => isLoopbackPeer false
  unpaired MagicDNS still 401
  foreign Host + X-Forwarded-* still 403
HTTPS_ORIGIN_GATE                          = PASS
PRIVATE_TAILSCALE_HTTPS                    = PASS (control plane + origin tests)
```

Do **not** promote this to physical iPhone PASS.

## 9. Hygiene

Diff `d18c792..16e5c3c`: 37 files. No committed images, `.pem`/`.key`, env secrets, or `private/aion` state.

```text
RAW_CONTROL_BYTES_INTRODUCED     = 0
PRIVATE_IMAGES_COMMITTED         = 0
PRIVATE_OWNER_STATE_COMMITTED    = 0
SECRETS_COMMITTED                = 0
TAILSCALE_PRIVATE_KEYS_COMMITTED = 0
```

`git grep` for private-key armor / `tskey-` / `AKIA` on the SHA: empty.

## 10. Physical device

```text
PHYSICAL_IPHONE_MULTI_PHOTO   = OWNER_RETEST_PENDING
PHYSICAL_IPHONE_VOICE         = OWNER_RETEST_PENDING
PHYSICAL_IPHONE_CONVERSATION  = OWNER_RETEST_PENDING
```

This status alone does not fail automated integration acceptance.

## 11. Nonblocking issues (not integration blockers)

1. Frozen suite still looks for the literal string `Reading the VIN` in `app.js`. Runtime says `Checking the VIN…`. Do not “fix” Claude to match the old string; optionally update the Grok static check later.  
2. `WHAT_IS_UNKNOWN` checklist is narrower than the content-draft unknowns (no drivetrain/recall). Owner-facing “everything I'd normally check” is scoped, not false, but thinner than it could be.  
3. Live MagicDNS `:8443` / `:443` HTTP codes were not re-fetched this run. Local pages + Serve map + access tests cover the security properties.  
4. Real-photo latency was not re-benchmarked. VIN-band runtime (decode bound 512 MB, `vin-strip`, corroboration, full-frame fallback) is present. No OCR bakeoff required.  
5. Planning answers are identical for synonymous questions — correct, not a defect.

## 12. Verdict

```text
AUTOMATED_VERDICT              = PASS
PHYSICAL_DEVICE_STATUS         = OWNER_RETEST_PENDING
CRITICAL_FAILURES              = none
NONBLOCKING_ISSUES             = 5 (listed above)
RECOMMEND_INTEGRATION          = YES
READY_TO_MERGE                 = NO
```

Director may integrate. This exam does **not** merge, does **not** deploy, and does **not** change PRIMARY.

STOP.
