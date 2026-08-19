# Autonomous Roadmap Orchestrator V1 — operations

AION owns the sequence. The durable unit of work is a **milestone**, not a chat session, so a worker
can die, run out of quota, or be swapped for a different provider without ending the roadmap.

Milestone: `AION-AUTONOMOUS-ROADMAP-ORCHESTRATOR-V1`
Implementation: `packages/director/src/roadmap-*.ts`
Store: `.aion-local/roadmap/` (local, untracked, no secrets)

## What it is not

It is not a second provider router, a second lease system, or a second authority model. It sits
*above* Provider Bridge V1, MVA Real Dispatch V1 and `OWNER_STANDING_AUTHORITY_V1` and calls them.
The focused suite asserts this directly: the orchestrator source must not contain `routeJob(`.

## The loop

```
load roadmap → recover in-flight work → validate the graph → compute ready
  → select deterministically → resolve authority → dispatch → verify → review → complete
  → unlock dependants → repeat
```

Every stop has a name: `NO_ROADMAP`, `ROADMAP_NOT_ACTIVE`, `MALFORMED_GRAPH`, `NO_ELIGIBLE_WORK`,
`STEP_LIMIT_REACHED`. It never stops because a model decided it was finished.

## The parts an operator touches

| Concern | Where |
| --- | --- |
| Contracts, 14 states, legal transitions | `roadmap-contracts.ts` |
| Dependency graph, readiness, selection | `roadmap-dag.ts` |
| Durable store and append-only ledger | `roadmap-store.ts` |
| Authority, verification, review, runaway control | `roadmap-policy.ts` |
| The control loop, recovery, takeover packets | `roadmap-orchestrator.ts` |
| Director-facing port | `roadmap-port.ts` |
| Real acceptance harness | `scripts/roadmap-acceptance.mjs` |

## Rules that decide whether autonomy is safe

**Authority is read, never derived.** `resolveMilestoneAuthority` reads the same
`.aion-local/owner-authority` record the Founder script writes. A milestone with no record, a revoked
record, an expired one, a superseded one, or one that does not cover its sensitivity, spend, external
effect or providers gets an Owner gate — it is never dispatched. Agents cannot create or widen
authority, and the port exposes no `approveGate`, `setAuthority` or `forceComplete`.

**A blocked gate blocks one branch.** A milestone waiting on the Owner moves to
`WAITING_OWNER_AUTHORIZATION` and the loop carries on with whatever else is ready.

**Absence is failure.** A required verification step with no recorded result fails the milestone.
A missing reviewer verdict is not a pass. A verdict from a weaker review than required is not a pass.
There is no path by which the absence of failure text becomes success.

**Review escalates, never relaxes.** The level is computed from the milestone's declared risk classes
and external-effect class and can only rise above what the milestone asked for. Declaring `NONE` on
irreversible work still yields `ADVERSARIAL`.

**Retries are bounded.** Budget exhaustion, the same failure twice, the same patch twice, provider
ping-pong and no observable progress all end in `BLOCKED`. An ambiguous external effect ends in
`RECOVERY_REQUIRED` and is never retried automatically — that retry is how one push becomes two.

**Restart assumes the worst.** Anything caught in `DISPATCHING`, `RUNNING`, `VALIDATING` or
`WAITING_REVIEW` is treated as unfinished. `COMPLETED` is terminal and never reopened.

**The ledger cannot be edited into a success story.** Events are appended and numbered from one with
no gaps; a removed or reordered line is an integrity error, not a shorter history.

## Running it

```bash
node scripts/roadmap-acceptance.mjs               # real autonomous chain over a scratch workspace
npm run test --workspace @aion/director           # focused suite, including 39 roadmap tests
```

There is no CLI verb yet. The port is the interface an app calls:

```js
const port = createRoadmapPort({ storeRoot, authorities, now, dispatchTarget, verify, baselineSha, currentHead, currentDirectiveId });
port.ensureRoadmap(seed);      // idempotent; never re-seeds over existing progress
port.getRoadmapStatus();
port.getPendingOwnerGates();
port.continueRoadmap();        // runs until nothing is eligible
port.pauseRoadmap();
```

## Driving it from the AION app

The app is the practical control surface. Open AION over the private network and pick **Roadmap**.

The panel answers six questions and nothing else: what state the roadmap is in, what the current
milestone is, what is ready next, whether anything is waiting on you, which provider is working, and
whether you can pause it. One button matters — **Continue toward my goals** — and it names no model.
Which milestone runs, whether authority covers it, which provider executes it and whether review is
required are all decided behind that call.

Verbs, routed through the app's existing `/api/action` dispatcher and its same-origin and pairing
checks:

| Verb | Effect |
| --- | --- |
| `roadmap.status` | everything the panel renders, in one round trip |
| `roadmap.current`, `roadmap.ready`, `roadmap.gates`, `roadmap.workers`, `roadmap.recent` | individual reads |
| `roadmap.continue` | `RoadmapPortV1.continueRoadmap()` |
| `roadmap.pause`, `roadmap.resume` | durable roadmap state |

That list is closed. There is deliberately no `approveGate`, `grantAuthority`, `forceComplete`,
`bypassReview`, `bypassVerification` or `activateProduction` verb, and an unknown verb falls through
to the dispatcher's `Unsupported Command Center action`. **The app observes authority; it never
manufactures it.** A gate can only be satisfied by running the Founder authorization script at the
computer running AION — the panel shows that command as read-only text and cannot execute it.

Responses are minimized: milestone id, title, status, priority, dependencies and blocked reason.
Objectives, provenance, verification plans, takeover packets and filesystem paths stay on the host.
The one deliberate exception is a gate's `exactScope`, which exists so you can see what you are
approving.

Pause is durable state, not a closed browser tab. Reload and restart both preserve it.

## What actually executes the work

`AION-APP-LIVE-PROVIDER-EXECUTION-V1` closed the gap between "the app reaches the orchestrator" and
"the app can finish a milestone". Two things were missing, and neither was the one the previous
handoff predicted.

**Providers are registered explicitly, and the list is short.** `apps/aion/provider-registry.mjs`
registers `local` with the real bounded executor and registers `codex`, `grok` and `claude` as
*unavailable* — an adapter that returns `PROVIDER_UNAVAILABLE` and a health row marked `DISABLED`.
That is not a placeholder. The dispatch layer will otherwise fill any missing adapter with a bounded
*local* executor under the cloud provider's id, and the artifact it writes then reads
`EXECUTOR = claude` while nothing resembling Claude ran. Registering all four honestly is what stops
the system reporting a provider it did not use.

| Provider | State | Why |
| --- | --- | --- |
| `local` | registered | deterministic, offline, zero cost, writes one artifact in an artifact root |
| `codex`, `grok`, `claude` | deliberately not registered | no cloud executor is wired into the app process, and paid providers are not authorized |

The panel says this out loud under **Providers**, so "AION did not run it" and "AION has nothing to
run it with" cannot be confused from a phone.

**Verification produces evidence, or the milestone fails.** The app used to pass `verify: () => []`,
which meant every milestone reached `VALIDATION_FAILED` on missing evidence — the honest rule working
correctly against a chain that could never finish. `apps/aion/verification-runner.mjs` now answers
from durable state: the MVA job record, the artifact on disk, and `git rev-parse HEAD`. It reads; it
never writes, shells out, or reaches the network.

The checks it can perform are a closed set:

| Step name | What it observes |
| --- | --- |
| `durable state reconciled` | a job record exists, reached SUCCEEDED, every artifact it names is on disk, lease released |
| `dispatch artifact validated` | the artifact exists, names this job, and dispatch recorded `artifact-validated` |
| `executor matches selected provider` | the provider the bridge selected is registered *and* is the one the artifact names |
| `no external effect` | the record and every attempt report `NONE` |
| `zero spend` | every attempt reported zero cost |
| `writer released` | the lease is released and the writer is `STOPPED` |
| `repository head unchanged` | HEAD still equals the sha the job started from |

A milestone whose plan names a step outside that table gets **no evidence row for it**, and
`evaluateVerification` fails it as missing. That silence is deliberate: a runner that guessed would
convert "we did not look" into "it passed". Milestones declare their steps through
`SeedMilestoneInputV1.verificationSteps`; the default plan remains the strict one.

**Dispatch is durable.** The port now forwards `dispatchDeps` to `createMvaDispatcher`, so the app
supplies registered adapters, a `createFileJobStore` and the real clock. Without it `submitJob` falls
back to an in-memory store and a frozen timestamp, and the job record disappears at process exit —
after which a restart cannot tell finished work from work that never started.

```bash
node scripts/roadmap-live-acceptance.mjs        # the app's own chain, in a scratch workspace
node --test "test/aion/live-provider-execution.test.mjs"
```

The acceptance harness seeds a **dedicated disposable milestone**. Proving the wiring must not consume
real planned work, so it never touches `.aion-local/roadmap`.

**After changing this code, restart the AION server.** A long-running process keeps serving the code
it started with, so the Roadmap panel will not appear until it is restarted.

## Telling AION what you want

Type it into Ask, on Home or in Chat. AION classifies the text before anything else happens:

| Class | What happens |
| --- | --- |
| `ACTIONABLE_OBJECTIVE` | becomes at most one `PLANNED` milestone — **gated**, not runnable |
| `ROADMAP_CONTINUATION` | recorded only; use `roadmap.continue` to resume |
| `QUESTION`, `CONTEXT_QUERY` | answered as a question; adds nothing |
| `OWNER_DECISION` | pointed at the console; the page cannot authorize |

`ROADMAP_CONTINUATION` is deliberately **not** plannable. It used to enter planning and then return
"not plannable", so a semantic type advertised behaviour nothing performed — which reads as wired to
anyone auditing it.

Classification is rules in `packages/director/src/owner-goal-intake.ts`, not a model. A model asked
"is this actionable?" answers yes too often and its answer cannot be tested. The tie-break runs the
safe way: anything the rules cannot place confidently is treated as a question, because
under-creating work is a conversation and silently creating it is a system doing things nobody asked
for. "Should I add caching?" stays a question despite containing an instruction verb.

Your exact words are stored byte-for-byte in `.aion-local/owner-goals/`. The normalized form exists
for matching and is never shown as what you said. Success criteria, constraints and urgency are
extracted **only** where you stated them — an invented acceptance criterion is how a milestone
completes against a goal you never had.

A goal's id is a hash of its normalized text and the milestone id derives from it, so the same
sentence typed twice converges: second tab, page refresh and server restart all land on the same
record with no deduplication pass to skip.

**The chat layer executes nothing.** It classifies, records, and calls `port.addMilestone`. It
cannot edit files, pick a provider, approve a gate, mutate authority or reach `advanceRoadmap`. The
`goal.submit` verb accepts *only* text — no milestone id, provider, authority id or status can cross
from a browser, asserted by test.

## Authority envelopes: authorize once, cover the routine children

`resolveMilestoneAuthority` used to bind a milestone to exactly one `ownerAuthorizationId` with no
notion of lineage, so naming a routine technical child of already-approved work produced a fresh
Owner gate. Safe, and the reason the same Founder phrase got typed five times for things nobody would
call a decision.

A milestone may now satisfy authority two ways:

1. **Directly** — it names its own Owner authorization record. Unchanged.
2. **By inheritance** — it names an `authorityEnvelopeId` and a `derivedFromMilestoneId`, and
   `resolveInheritedAuthority` proves it sits inside that envelope.

### What an independent review found, and what changed

The first version of this shipped unsound. grok-4.6 drove six ordinary sentences through the
production intake path and four came back as covered, automatic work — including **"Delete the
production backups without asking."** Nothing lied. Intake had *selected* an envelope for the
sentence, stamped that envelope's objective on as lineage, and left the risk fields at their
planning defaults; the resolver then verified lineage intake had supplied and measured ceilings
against a record that described nothing. A goal was vouching for itself.

Four things changed as a result:

- **No envelope auto-selection.** A sentence typed into Ask has no lineage and claims no envelope. It
  becomes a gated milestone. `lineageForTypedGoal()` returns `null` and there is deliberately no
  function that computes one from text.
- **Lineage is a parent milestone id**, not an objective string — a reference to a node that already
  exists and that the Owner named when granting the envelope. Text cannot conjure one.
- **Consequence is read from the Owner's words** by `owner-boundary-detection.ts`, before authority
  is evaluated, and only ever raises. Planner defaults can no longer erase risk.
- **Only explicitly envelope-granting authorizations are inheritable.** Every ACTIVE record used to
  project an envelope; an authorization to build Provider Bridge is permission to build Provider
  Bridge. A record now needs `grantsRoadmapAuthorityEnvelope: YES` and named approved parents, both
  written by the Founder script from the directive. **No authorization written so far carries that
  grant, so nothing in production is inheritable today** — which is the correct fail-closed state.

**There is no envelope file and nothing can write one.** An envelope is *projected* read-only from
the Owner authority record `authorize-current-directive.ps1` writes — same record, same trust
boundary. `packages/director/src/roadmap-authority-envelope.ts` imports no filesystem module and
exposes no `createEnvelope`, `saveEnvelope` or `widenEnvelope`; a test asserts both. The cheapest way
to guarantee code cannot mint an envelope is to have no writer at all. Every ceiling is read out of
Owner-written JSON on each evaluation, so nothing in the process can raise one.

The envelope id is derived from the authorization id, so a milestone naming
`ENVELOPE-anything-i-like` finds nothing and is **denied** — not gated. That distinction is
deliberate: a claim of coverage that does not exist is not "we cannot prove it", and treating it as a
question to ask would reward inventing ids.

Inheritance requires **all** of: an ACTIVE, unexpired, unsuperseded, unrevoked envelope; lineage to
an approved parent objective; write domains a subset; providers a subset; sensitivity within the
ceiling; spend within the ceiling; a permitted external-effect class; reversibility satisfied; no
always-gated boundary crossed; and an authority class below `HIGH_CONSEQUENCE`. A milestone that
declares **no** write domains is gated rather than read as writing nothing.

A failed envelope claim is never retried against the direct-record path. Falling through would let a
refused inheritance be re-asked as a different question until one of them said yes.

Always gated, whatever an envelope says: a materially new objective, spend beyond the ceiling, a new
paid resource, production activation, destructive action, a new external send, an irreversible effect
outside the envelope, new OAuth or credentials, sensitive-data expansion, a security configuration
change, a financial or legal commitment, and envelope expansion itself.

```bash
node scripts/owner-control-loop-acceptance.mjs      # typed goal → completed work, in a scratch workspace
node --test "test/aion/owner-goal-intake.test.mjs"
```

## Reading a stalled roadmap

1. `getRoadmapStatus()` — `byStatus` says where everything sits.
2. `getPendingOwnerGates()` — anything in `WAITING_OWNER_AUTHORIZATION` has a gate naming its exact
   scope and why it was refused.
3. The ledger — the last events for a milestone say whether it was gated, denied, failed validation,
   failed review or ran out of retries.
4. `RECOVERY_REQUIRED` always means a person must look. It is the one state the system will not
   resolve by trying again.

## Known limitations of V1

- **The app drives reads, three verbs and goal intake, not everything.**
  `apps/aion/roadmap-control.mjs` wires the port into the Command Center, and goal intake can add one
  `PLANNED` milestone. **Seeding a roadmap, editing an existing milestone and approving a gate remain
  host-side acts** — a browser cannot create a roadmap or change work that already exists.
- **Classification is rules, and rules have edges.** The classifier will misplace some sentences. It
  is built so the misplacement costs a clarifying question rather than unwanted work, but a goal
  phrased unusually may need rephrasing. Read `classificationReason` on the stored goal to see why it
  landed where it did.
- **An envelope covers routine engineering, not judgement.** Inheritance proves scope, not wisdom. A
  milestone can be perfectly inside an envelope and still be the wrong thing to build; that is what
  the roadmap and the Owner are for.
- **Review is a policy and a hook, not a reviewer.** The orchestrator decides *whether* independent
  review is required and refuses to complete without a verdict; it does not itself summon a second
  model. Wiring a real reviewer is a later milestone. Until then, any milestone whose risk demands
  `INDEPENDENT` or `ADVERSARIAL` review ends in `BLOCKED` with "no verdict was recorded" — the work
  runs, and the completion is refused. That is the intended behaviour, not a bug to route around.
- **One executor.** `local` is deterministic and bounded; it writes an artifact and proves the chain.
  It does not write code. A milestone needing a real coding model needs a cloud executor, which needs
  a fresh Owner decision about paid providers.
- **The artifact's `MILESTONE` line names the MVA dispatch authorization, not the roadmap milestone.**
  It is a constant inside `mva-dispatch.ts` that `validateJobArtifact` checks against, so changing it
  is a dispatch-contract change rather than an app change. Read `JOB_ID` for the milestone.
- **Worker execution is one bounded job per milestone.** A milestone that needs several dispatches
  is not modelled yet.
- **Leases come from the existing layer.** One-writer enforcement lives in `leases.ts` and
  `mva-dispatch.ts`; the roadmap consumes it rather than reimplementing it.

## Not authorized by this milestone

Job discovery, application submission, email, publishing, Metricool operations, Tekion, Informativ,
account actions, OAuth, purchases, spend, production activation, destructive changes, and any
external effect. Read the roadmap; act only where an Owner authority record already covers it.
