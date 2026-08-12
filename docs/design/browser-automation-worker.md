# Browser Automation Worker — Design (AION)

**Status:** DESIGN ONLY — not authorized for implementation, login, or production install  
**Author executor:** GROK (systems / integration)  
**Branch:** `design/grok-browser-automation`  
**Base main:** `origin/main` @ design-time baseline  
**Date (UTC):** 2026-08-12  

## Explicit non-goals of this document

- Do **not** log into Tekion, Informativ, or any dealership system.
- Do **not** install Playwright, browser extensions, or workers into production as part of this design.
- Do **not** automate external dealership records.
- Do **not** store dealership passwords in AION durable state or Git.
- Do **not** grant Claude transcript intelligence authority to invent customer identity for browser writes.

This document defines architecture, contracts, authority mapping, and test strategy so implementation can begin only when Owner authorization and readiness gates are met.

---

## 1. Problem statement

AION already:

- holds local CRM / inventory / relationship context
- enforces an **Owner Authority Envelope** with kill switches and external-action audit (`AuthorityEnvelopeV1`, `evaluateExternalGate`, `ExternalActionRecordV1`)
- requires approval digests for high-consequence capabilities
- prefers grounded evidence over model invention

Dealership day-to-day work often still lives in **authenticated web applications** (primary: **Tekion**; higher-consequence: **Informativ**) that may not expose the needed workflows via official APIs.

The Owner’s future requirement:

> AION should eventually operate authenticated dealership web apps through a Playwright-style browser worker (conceptually similar to “Claude Browser”), while preserving AION’s authority, evidence, and security model.

This is **not** a license for arbitrary agent-generated browser scripting.

---

## 2. Design principles

| # | Principle |
|---|-----------|
| 1 | **Official API / partner integration first** when available and sufficient. |
| 2 | **Playwright is a fallback**, not the default integration path. |
| 3 | **Structured tasks only** — never arbitrary generated JS from a model. |
| 4 | **Intelligence proposes; authority gates; worker executes deterministically.** |
| 5 | **Read ≠ prepare ≠ write** — distinct capability levels mapped to AION envelopes. |
| 6 | **Fail closed** on uncertain page identity, session expiry, wrong customer, or partial write. |
| 7 | **No secrets in Git, chat history, or ordinary state JSON.** |
| 8 | **Owner controls MFA / consent** unless later explicitly authorized otherwise. |
| 9 | **Audit without secrets** — task traces, hashes, redacted DOM/screenshot refs. |
| 10 | **Idempotent reads; non-blind write retries.** |

---

## 3. Policy summary (required return fields)

### OFFICIAL_API_FIRST_POLICY

```
PREFER:
  official REST/GraphQL/webhook/partner SDK
  documented OAuth or dealership-IT-approved integration
  AION connector modules under packages/*/connectors with explicit contracts

WHEN API is sufficient for the task:
  DO NOT use Playwright for that task

WHEN API is missing, incomplete, rate-limited by contract, or owner-blocked:
  document the gap → then consider Playwright for that specific task type only
```

**Decision record (per app / task):**

| Field | Meaning |
|-------|---------|
| `appId` | e.g. `tekion`, `informativ` |
| `taskType` | e.g. `SEARCH_CUSTOMER` |
| `preferredTransport` | `OFFICIAL_API` \| `PLAYWRIGHT` \| `MANUAL_OWNER` |
| `apiGapReason` | null or short non-secret reason |
| `reviewedAt` | ISO timestamp |
| `ownerAuthorityRef` | envelope / directive id authorizing this transport |

### PLAYWRIGHT_FALLBACK_POLICY

```
USE PLAYWRIGHT ONLY IF:
  1. task is on an allowlisted task-type enum
  2. official transport is unavailable or explicitly insufficient for that task
  3. browser capability level is authorized in Owner envelope
  4. workspace isolation rules pass
  5. page/app identity checks pass at runtime
  6. customer identity (when required) is already grounded — not inferred by the worker

NEVER USE PLAYWRIGHT FOR:
  arbitrary URL navigation from model free text
  executing model-produced JavaScript
  credential harvesting / password form autofill from AION state
  high-consequence Informativ financial/credit mutations without Level 4 + exact authority
```

### PROCESS_ISOLATION

```
┌─────────────────────────────┐
│ AION Command Center         │  loopback / Tailscale UI + /api/action
│  - routing, authority       │
│  - CRM/inventory state      │
└──────────────┬──────────────┘
               │ IPC: structured BrowserTaskV1 (JSON)
               │ no shared mutable memory
               ▼
┌─────────────────────────────┐
│ Browser Worker Process      │  separate OS process (Node + Playwright)
│  - allowlisted task handlers│
│  - deterministic page ops   │
│  - no direct state DB write │
└──────────────┬──────────────┘
               │ local Chromium/Firefox profile dir
               ▼
┌─────────────────────────────┐
│ Browser profile (OS user)   │  outside Git; outside private/aion/state-v1.json
│  - cookies / storage state  │  path under .aion-local/browser-profiles/ (gitignored)
└─────────────────────────────┘
```

Rules:

- Worker **cannot** mutate AION state repository directly; it returns `BrowserTaskResultV1`.
- Command Center applies results only after authority + schema validation.
- Worker runs with **least network surface**: dealership origins only (allowlist).
- One **active write task** per app profile at a time (mutex).
- Worker crash must not leave half-applied AION claims; external side effects are only those already committed by the browser before crash (see fail-closed).

### SESSION_MODEL

```
SESSION_SOURCE (priority order for design):
  1. Owner-authenticated browser profile (reuse storageState / userDataDir)
  2. Official OAuth token connector (API path — preferred when available)
  3. Interactive Owner login ceremony (one-shot, worker pauses, Owner completes MFA)

FORBIDDEN:
  storing dealership passwords in AION state, CRM notes, chat, or Git
  scraping password managers into state
  long-lived refresh tokens in conversation history
```

**Session lifecycle:**

| State | Meaning | Next |
|-------|---------|------|
| `NO_PROFILE` | no local profile | Owner bootstrap ceremony |
| `PROFILE_PRESENT` | files exist | probe session |
| `SESSION_VALID` | app shell recognized | allow Level ≥1 tasks |
| `SESSION_EXPIRED` | login wall | pause tasks; Owner re-auth |
| `MFA_REQUIRED` | challenge page | Owner completes MFA; no auto-bypass |
| `PROFILE_LOCKED` | kill switch / policy | refuse all browser tasks |

**Probe:** deterministic “am I logged into expected app?” check (URL pattern + stable shell landmark). Fail closed if ambiguous.

### SECRET_BOUNDARY

| Asset | Location | Git | AION state JSON | Chat / audit text |
|-------|----------|-----|-----------------|-------------------|
| Dealership passwords | Never in AION | No | No | No |
| Browser cookies / storageState | `.aion-local/browser-profiles/<app>/` (gitignored) | No | No | No (ref path only) |
| Screenshot / DOM capture | `.aion-local/browser-evidence/<taskId>/` | No | No | hash + relative ref only |
| Task payloads | state / activity (redacted) | No | Redacted fields | Redacted |
| Official API tokens | connector secrets store (existing pattern) | No | encrypted / external | presence only |

Audit lines may store: `sessionProbe=VALID`, `profileRef=browser-profiles/tekion`, never cookie values.

### TEKION_CAPABILITIES

**In scope (future, after authority):**

| Task type | Min level | Notes |
|-----------|-----------|--------|
| `SEARCH_CUSTOMER` | L1 | Structured query; return ranked grounded candidates |
| `READ_CUSTOMER` | L1 | Requires exact customer ref from prior ground |
| `READ_CONTACT` | L1 | Phone/email as displayed; mark source page |
| `READ_TIMELINE` | L1 | Interaction history windowed |
| `READ_TASKS` | L1 | Follow-ups / tasks list |
| `READ_VEHICLE_CONTEXT` | L1 | Vehicle/deal context **as displayed** |
| `PREPARE_ADD_NOTE` | L2 | Diff of proposed note text; no submit |
| `PREPARE_CREATE_FOLLOWUP` | L2 | Diff of task fields; no submit |
| `ADD_NOTE` | L3 | Low-risk write after approval digest |
| `CREATE_FOLLOWUP` | L3 | Low-risk write after approval digest |
| `UPDATE_ALLOWED_PREFERENCE` | L3 | Only allowlisted preference fields |

**Out of scope without separate explicit high authority (default deny):**

- deal structure / pricing modification  
- inventory price commitments  
- credit application / soft or hard pulls  
- e-sign / consent capture  
- payment posting  
- desking finalization  
- bulk customer export  

### INFORMATIV_CAPABILITIES

Treat as **higher consequence**.

**Design first:**

| Task type | Min level | Notes |
|-----------|-----------|--------|
| `SEARCH_CUSTOMER` / `READ_*` (non-financial) | L1 | Read-only identity & file presence if UI allows |
| `PREPARE_*` non-financial note | L2 | Preview only |

**Default deny / Level 4 + exact Owner confirmation always required if ever authorized:**

- credit / fraud / identity verification  
- financial eligibility decisions  
- consumer consent representation  
- payment / deal financials  
- any action that could be construed as underwriting or FCRA-relevant  

**Informativ rule:**  
`IF task.touchesFinancialOrCredit THEN require Level 4 AND dedicated envelope flag informativHighConsequence AND kill-switch not paused; ELSE fail closed.`

### AUTHORITY_LEVELS

Map browser levels to existing AION mechanisms (labels illustrative; final enum may rename):

| Browser level | Name | AION mapping | Effect |
|---------------|------|--------------|--------|
| **L0** | NO ACCESS | default; envelope flag `browserAutomation=false` or missing | refuse all browser tasks |
| **L1** | READ / SEARCH | `businessExternal` + new flag `browserRead` + kill switches clear | navigational reads, search |
| **L2** | PREPARE WRITE + SHOW DIFF | L1 + `browserPrepareWrite` | produce proposal + visual/DOM diff; **no submit** |
| **L3** | LOW-RISK APPROVED WRITE | L2 + one-shot approval digest for task hash + `browserLowRiskWrite` | submit allowlisted note/task only |
| **L4** | HIGH-CONSEQUENCE | L3 + Owner confirm UI + `browserHighConsequence` + app-specific flag (e.g. Informativ) | credit/financial/consent/deal money |

**Kill switches (extend `AuthorityEnvelopeV1.kill` in implementation phase):**

- `pauseAllExternal` → blocks L1–L4  
- `pauseBrowserAutomation` → browser-specific  
- `pauseBrowserWrites` → blocks L3–L4; L1–L2 allowed if read authorized  
- `pauseBusinessExternal` → blocks all dealership browser actions  

**Spend:** browser automation must not spend money; any paid proxy/captcha service remains USD 0 until Owner sets spend budget (existing spend envelope).

### WRITE_IDEMPOTENCY

```
READS:
  may retry with backoff when idempotent and page identity still valid

WRITES:
  never blind-retry
  each write task carries clientIdempotencyKey (UUID)
  before submit:
    - re-verify customer identity landmarks
    - re-verify form content hash matches approved proposal
    - check duplicate evidence (same note body hash within window)
  after submit:
    - capture result landmark (toast, timeline entry id if visible)
    - store writeReceipt; subsequent same key returns prior receipt
  on uncertain post-submit state:
    - RESULT = UNCERTAIN_WRITE
    - do not re-submit
    - require Owner review
```

### FAIL_CLOSED_RULES

Refuse task (no write; read may return empty + error code) when:

1. App origin not on allowlist  
2. Page fingerprint ≠ expected for task step  
3. Session probe ≠ `SESSION_VALID`  
4. MFA / unexpected modal without handler  
5. Customer identity landmarks do not match grounded `customerRef`  
6. Multiple similar customers and no exact ref  
7. Approval digest mismatch or expired  
8. Kill switch active  
9. Workspace ≠ Work (or designated dealership workspace)  
10. Worker version / selector contract version mismatch  
11. Partial form fill detected after navigation loss  
12. Screenshot/DOM evidence store unavailable for L2+ (optional hard gate)

### AUDIT_TRAIL

Every browser task records a durable `BrowserTaskAuditV1` (no secrets):

| Field | Description |
|-------|-------------|
| `TASK_ID` | Opaque id |
| `WORKSPACE` | AION workspace id |
| `REQUESTING_ACTOR` | Owner / agent role id — never “self-authorized model” |
| `CUSTOMER_REF` | Grounded ref or null |
| `INTENDED_EFFECT` | Enum + short description |
| `PAGE_APP` | `tekion` / `informativ` / … |
| `READS` | List of resource keys read |
| `PROPOSED_WRITES` | Diffs / field patches (redacted if sensitive) |
| `ACTUAL_WRITES` | What was submitted, or empty |
| `BEFORE_AFTER_EVIDENCE` | hashes / evidence refs |
| `TIMESTAMP` | ISO start/end |
| `RESULT` | `SUCCESS` \| `BLOCKED` \| `FAILED` \| `UNCERTAIN_WRITE` \| `OWNER_REQUIRED` |
| `ERROR` | stable code + safe message |
| `EVIDENCE_REF` | path ref to screenshot/DOM under gitignored evidence dir |
| `AUTHORITY_USED` | level + envelope flags + approval digest id |

Maps to existing `ExternalActionRecordV1` for L3–L4 as `EXTERNAL_BUSINESS_ACTION` with `dryRun=true` for L2.

### MOCK_TEST_STRATEGY

**Before any real Tekion/Informativ contact:**

1. **Static HTML fixtures** under `packages/.../test/fixtures/browser-apps/tekion/` (sanitized, synthetic names only).  
2. **Local static server** in tests (loopback only).  
3. **Contract tests** for task handlers against fixtures.  
4. **Optional later:** Owner-approved sanitized DOM captures — never real SSNs/full credit payloads.

**Required scenarios:**

| Test | Expect |
|------|--------|
| Correct customer selected | L1 read returns that ref |
| Similar-name wrong customer | refuse / no write |
| Write preview accurate | L2 diff matches fixture fields |
| Duplicate note prevented | second ADD_NOTE same key → receipt / block |
| Expired session stops | SESSION_EXPIRED; no write |
| Unexpected page stops | FAIL_CLOSED |
| Selector drift | contract version fail closed |
| Informativ credit path | always BLOCKED without L4 |

### STRUCTURED_ACTION_CONTRACT

Intelligence layers (including Claude transcript / customer-needs work) may emit **proposals only**:

```ts
// Conceptual TypeScript — design shape, not implemented yet

type BrowserAppIdV1 = "tekion" | "informativ";

type BrowserTaskTypeV1 =
  | "SEARCH_CUSTOMER"
  | "READ_CUSTOMER"
  | "READ_CONTACT"
  | "READ_TIMELINE"
  | "READ_TASKS"
  | "READ_VEHICLE_CONTEXT"
  | "PREPARE_ADD_NOTE"
  | "PREPARE_CREATE_FOLLOWUP"
  | "ADD_NOTE"
  | "CREATE_FOLLOWUP"
  | "UPDATE_ALLOWED_PREFERENCE";

type BrowserAuthorityModeV1 =
  | "READ_ONLY"
  | "PREPARE_ONLY"
  | "APPROVED_WRITE"
  | "HIGH_CONSEQUENCE_OWNER_CONFIRM";

interface BrowserTaskV1 {
  schema: "aion.browser-task.v1";
  taskId: string;
  workspaceId: string;
  appId: BrowserAppIdV1;
  taskType: BrowserTaskTypeV1;
  authorityMode: BrowserAuthorityModeV1;
  /** Grounded AION/Tekion identity — never free-text name alone for writes */
  customerRef: string | null;
  /** Task-specific payload; validated by zod/JSON schema per taskType */
  input: Record<string, unknown>;
  sourceRefs: string[]; // transcript id, CRM note id, etc.
  idempotencyKey: string;
  approvalDigestId: string | null; // required for APPROVED_WRITE+
  requestedBy: string;
  createdAt: string; // ISO
}

interface BrowserTaskResultV1 {
  schema: "aion.browser-task-result.v1";
  taskId: string;
  result: "SUCCESS" | "BLOCKED" | "FAILED" | "UNCERTAIN_WRITE" | "OWNER_REQUIRED";
  errorCode: string | null;
  errorMessage: string | null; // no secrets
  reads: Array<{ key: string; summary: string }>;
  proposedWrites: Array<{ field: string; before: string | null; after: string | null }>;
  actualWrites: Array<{ field: string; valueRedacted: string }>;
  evidenceRef: string | null;
  customerRefConfirmed: string | null;
  pageFingerprint: string | null;
  durationMs: number;
  workerVersion: string;
  selectorContractVersion: string;
}
```

**Voice / call pipeline contract:**

```
Claude (or any transcript layer):
  → produces structured CRM action proposals only
  → MUST supply customerRef already grounded by AION identity resolution
  → MUST NOT ask browser worker to "find the customer that sounds like…"

Browser worker:
  → accepts BrowserTaskV1
  → does not re-infer customer truth from transcript prose
  → fails closed if customerRef missing on write tasks
```

Example proposal:

```json
{
  "schema": "aion.browser-task.v1",
  "taskType": "ADD_NOTE",
  "appId": "tekion",
  "authorityMode": "PREPARE_ONLY",
  "customerRef": "tekion:customer:EXACT_ID",
  "input": {
    "content": "Grounded call summary…",
    "noteType": "phone_call"
  },
  "sourceRefs": ["transcript:…", "call:…"],
  "idempotencyKey": "…"
}
```

Upgrade to `APPROVED_WRITE` only after Owner/approval-digest path.

### RISKS

| Risk | Severity | Mitigation |
|------|----------|------------|
| Selector / UI drift | High | Versioned selector contracts; fail closed; mock harness |
| Wrong customer write | Critical | Exact ref + on-page landmark verify; similar-name tests |
| Session/MFA handling errors | High | Owner-controlled MFA; no password store |
| Secret leakage in logs | High | Redaction; evidence refs; no cookies in audit |
| Partial write / double submit | High | Idempotency keys; no blind retry; UNCERTAIN_WRITE |
| Scope creep to desking/credit | Critical | Explicit deny lists; L4; Informativ separate flags |
| Model invents browser JS | High | Worker never executes freeform scripts |
| Process isolation breach | Medium | Separate process; no state file handles; allowlisted origins |
| Legal / ToS / dealership policy | High | Owner + dealership IT consent; official API preferred |
| Claude/Grok parallel conflicts | Medium | Worker mutex; single write lane; structured contracts only |

### DEPENDENCIES

| Dependency | Notes |
|------------|-------|
| Existing `AuthorityEnvelopeV1` / external gates | Extend flags; do not bypass |
| Approval digest capability path | L3+ writes |
| Workspace isolation (Work vs Personal) | Dealership apps only in Work |
| Connector secret patterns | Official API tokens if/when available |
| Gitignored `.aion-local/` runtime dirs | profiles + evidence |
| Playwright (implementation phase only) | Pin version; not installed by this design |
| Claude structured CRM proposals | Separate design; this worker is consumer only |
| Official Tekion/Informativ partner docs | Research before Playwright for each task |

### WHEN_IMPLEMENTATION_SHOULD_BEGIN

Implementation **must not** begin until **all** of the following are true:

1. Owner explicit written authority for browser automation design → implement runway.  
2. Decision record exists for Tekion transport per first task (`OFFICIAL_API` vs `PLAYWRIGHT`).  
3. Authority envelope schema extension reviewed (new flags + kill switches).  
4. Mock fixture harness green for Tekion **search + read + prepare note** paths.  
5. Secret/session storage path reviewed against privacy docs.  
6. No production login automated until L1 session probe is proven on mock + Owner-attended dry run.  
7. Claude (or other) structured action contract is agreed so the worker is not asked to invent identity.  
8. Spend remains USD 0 unless a related paid dependency is separately authorized.

**Suggested implementation phases (future):**

| Phase | Scope | Real login |
|-------|--------|------------|
| P0 | Contracts + mock harness + authority flags (no Playwright required for pure schema) | No |
| P1 | Worker process + L1 read against mock | No |
| P2 | L2 prepare write + audit | No |
| P3 | Owner-attended Tekion L1 session probe (manual login) | Owner only |
| P4 | L3 note/follow-up with approval digests | Owner-attended |
| P5 | Informativ L1 read design only until separate L4 authority | Default deny writes |

---

## 4. Architecture detail

### 4.1 Components

1. **BrowserAutomationPortV1** (domain port)  
   - `submitTask(task: BrowserTaskV1): Promise<BrowserTaskResultV1>`  
   - `probeSession(appId): Promise<SessionProbeV1>`  
   - Implemented by process host; domain package stays free of Playwright imports (same boundary discipline as other ports).

2. **Browser Worker (host process)**  
   - Loads selector contracts JSON for app+version.  
   - Maps `taskType` → handler function (hand-written, tested).  
   - Uses Playwright only inside this process.

3. **Selector contract**  
   - Stable names: `loginShell`, `customerSearchInput`, `customerRowById`, `noteComposer`, `submitNote`.  
   - Multiple candidate selectors with priority; if none match → fail closed.

4. **Evidence store**  
   - Screenshots + optional accessibility tree snapshot.  
   - Hash in audit; full files gitignored.

5. **Idempotency store**  
   - Under `.aion-local/browser-idempotency/` or bounded state map (no secrets).

### 4.2 Task execution pipeline

```
Proposal (Claude/Grok/Owner UI)
    → schema validate BrowserTaskV1
    → workspace gate
    → evaluateExternalGate + browser level
    → (L3+) verify approval digest binds task hash
    → enqueue to worker
    → session probe
    → page identity check per step
    → execute deterministic steps
    → capture evidence
    → return BrowserTaskResultV1
    → Command Center records ExternalAction + audit
    → (optional) update CRM note with grounded summary + sourceRefs
```

### 4.3 Tekion adapter (logical)

```
TekionAdapter
  searchCustomer({ query }) -> Candidate[]
  openCustomer({ customerRef }) -> void
  readContact() -> ContactDto
  readTimeline({ limit }) -> TimelineDto
  readTasks() -> TaskDto[]
  readVehicleContext() -> VehicleContextDto
  prepareAddNote({ content }) -> Diff
  commitAddNote({ content, idempotencyKey }) -> Receipt
  prepareCreateFollowup({ fields }) -> Diff
  commitCreateFollowup({ fields, idempotencyKey }) -> Receipt
```

Each method is either:

- API implementation, or  
- Playwright handler with the **same** DTO surface  

so the rest of AION does not care which transport won the decision record.

### 4.4 Informativ adapter (logical)

Same port pattern; **write methods default to `BLOCKED`** until L4 authority objects exist. Prefer read/prepare only in first implementation seasons.

### 4.5 Coordination with Claude Owner-knowledge / sales / call intelligence

| Layer | Owns | Must not own |
|-------|------|--------------|
| Claude transcript / needs | Summary, structured proposals, sourceRefs | Browser execution, password, customer invent |
| Grok browser worker | Deterministic page ops, session probe, audit | Business inference from free text |
| AION authority | Levels, digests, kill switches | — |
| Owner | MFA, high-consequence confirm, dealership policy | — |

**No modification to Claude knowledge goals is required by this design document.** Only a shared **JSON contract** for `BrowserTaskV1` when both sides implement.

---

## 5. Security & privacy notes

- Align with existing local-assistant privacy docs: dealership customer PII is Work-workspace data.  
- Screenshots may contain PII → gitignored evidence dir; retention policy (e.g. 14–30 days) to be set at implementation.  
- Tailscale/phone UI must not stream live VNC of the dealership browser by default.  
- Ollama and any local models must not receive cookie jars or full DOM with secrets.  
- Worker network allowlist should not open outbound access to arbitrary hosts.

---

## 6. Observability (expanded)

Minimum log event (structured JSON line):

```json
{
  "TASK_ID": "…",
  "WORKSPACE": "work",
  "REQUESTING_ACTOR": "owner|agent:…",
  "CUSTOMER_REF": "tekion:customer:…",
  "INTENDED_EFFECT": "ADD_NOTE",
  "PAGE_APP": "tekion",
  "READS": ["customer.header", "timeline.head"],
  "PROPOSED_WRITES": [{ "field": "note.body", "contentHash": "…" }],
  "ACTUAL_WRITES": [],
  "BEFORE_AFTER_EVIDENCE": { "beforeHash": "…", "afterHash": null },
  "TIMESTAMP": "…",
  "RESULT": "BLOCKED",
  "ERROR": "SESSION_EXPIRED",
  "EVIDENCE_REF": "browser-evidence/…/before.png",
  "AUTHORITY_USED": { "level": 1, "digest": null }
}
```

---

## 7. Resilience matrix

| Condition | Read behavior | Write behavior |
|-----------|---------------|----------------|
| Selector missing | fail closed | fail closed |
| Route changed | fail closed | fail closed |
| Slow load | wait + timeout | wait + timeout; no submit if overdue approval |
| Modal unexpected | fail closed unless catalogued | fail closed |
| Session expiry | OWNER_REQUIRED | OWNER_REQUIRED; no retry write |
| MFA | OWNER_REQUIRED | OWNER_REQUIRED |
| Partial write | n/a | UNCERTAIN_WRITE; no resubmit |
| Duplicate submission | n/a | return prior receipt / block |

---

## 8. Open questions (do not invent answers)

1. Does Tekion offer a dealership-approved API for notes/tasks on this store’s plan?  
2. Does dealership IT permit persistent browser profiles on the AION desktop?  
3. Retention period for screenshot evidence under local privacy policy?  
4. Exact Owner UX for L4 Informativ confirms (modal vs Chat)?  
5. Multi-dealership / multi-profile support needed in v1?

---

## 9. Document control

| Field | Value |
|-------|--------|
| OFFICIAL_API_FIRST_POLICY | Prefer partner/API; Playwright only on documented gap |
| PLAYWRIGHT_FALLBACK_POLICY | Allowlisted tasks + authority + page identity; no freeform JS |
| PROCESS_ISOLATION | Separate worker process; gitignored profiles; no direct state writes |
| SESSION_MODEL | Reuse Owner-authenticated profile; Owner MFA; no password in state |
| SECRET_BOUNDARY | Profiles/evidence/secrets outside Git and chat |
| TEKION_CAPABILITIES | Search/read/timeline/tasks/vehicle; prepare+low-risk note/follow-up |
| INFORMATIV_CAPABILITIES | Read/prepare first; financial/credit/consent fail closed without L4 |
| AUTHORITY_LEVELS | L0–L4 mapped to envelope flags + digests + kill switches |
| WRITE_IDEMPOTENCY | Keys + no blind write retry + UNCERTAIN_WRITE |
| FAIL_CLOSED_RULES | Uncertain page/session/customer/authority → refuse |
| AUDIT_TRAIL | Full task audit fields without secrets |
| MOCK_TEST_STRATEGY | Fixtures before real apps; wrong-customer and session tests |
| STRUCTURED_ACTION_CONTRACT | `BrowserTaskV1` / `BrowserTaskResultV1`; grounded customerRef |
| RISKS | Wrong customer, secret leak, ToS, selector drift, scope creep |
| DEPENDENCIES | Authority envelope, approvals, workspace isolation, Claude contract |
| WHEN_IMPLEMENTATION_SHOULD_BEGIN | After Owner authority + API decision + mock harness + secret review |

**Implementation status:** not started  
**External automation performed for this design:** none  
**Production installation performed for this design:** none  
