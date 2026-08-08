# AION V1.3-R1 — From a rented machine to a usable brain

Directive: `AION-V1.3-R1-GPU-SESSION-ENDPOINT-BRIDGE`.
Corrects one omission in [AION V1.3](./aion-v13-real-independent-brain.md).

## The gap

V1.3 built the whole money path — discover, score, propose, approve, provision, track cost, tear
down — and stopped one step short. A provisioned session kept `endpointId: null` for ever. There
was no code path from "the provider says the box is up" to "AION can route to it", and no bounded
wait for the model server to finish loading.

So a real rented instance could bill by the minute while being unreachable for routing, evaluation,
and comparison. Paying for a brain you cannot reach is the worst outcome the design has.

This milestone spends **USD 0.00** and provisions nothing. Everything below is proved against
scripted infrastructure and a scripted runtime.

## Four things, still separate

```text
infrastructure provider  ->  GPU session  ->  inference runtime  ->  Brain endpoint
```

The bridge connects them without merging them. Nothing provider-specific reaches the endpoint
contracts; the endpoint contracts learned one new fact — `rental` — which any infrastructure could
supply.

That separation is now enforced in the type system. `GpuInstanceStateV1` is what a provider says
about a machine; `GpuSessionStateV1` is AION's own lifecycle. They used to be one type, and sharing
it is what let "the instance is running" read as "the brain is ready".

## The lifecycle

```text
proposed -> approved -> provisioning -> booting-runtime -> waiting-for-endpoint
         -> health-checking -> ready -> in-use -> stopping -> stopped
```

Two failure states, kept apart because they mean different things to whoever is paying:

| State | Meaning |
| --- | --- |
| `activation-failed` | It never became usable. You paid for boot time and got nothing. |
| `failed` | It was running and something went wrong — including a teardown AION could not confirm. |

Each state has one owner-facing word, defined once in `GPU_STATUS_LABELS` so the console, the
phone, and Activity cannot describe the same session differently. **"Ready" is never printed for a
state that is not ready.**

## The readiness wait

A model server legitimately takes minutes: pull a container, download weights, fill GPU memory,
open a port. Waiting is fine. Waiting *without a bound* is how a boot failure becomes an overnight
charge.

The allowance is chosen at proposal time, stated in the disclosure, **included in the money
digest** — authorising a 3-minute wait is not the same decision as authorising a 30-minute one —
and stored as a timestamp that can never be later than the hard stop. It is never extended.

Every poll does the same things in the same order:

1. **Stop conditions first**, from stored state, before any network call. A session past its spend
   limit stops even if it is one poll from ready. The owner authorised an amount, not an outcome.
2. **The readiness allowance**, also from stored state.
3. Ask the provider. An error here is redacted, recorded, and retried inside the allowance — a
   provider hiccup is ordinary and is not evidence the machine has failed.
4. Validate the address it reports.
5. Health-verify.
6. Register.

The idle timeout does *not* apply while a model is loading. Nothing can use it yet, and stopping a
session with "nothing has used it" would misdescribe what happened. The readiness deadline is the
bound there, and it is at least as strict.

## What AION refuses to accept as an endpoint

`normaliseServingEndpoint` is where a provider's claim becomes something AION will route to, and it
mostly says no:

| Reported address | Refused because |
| --- | --- |
| unparseable, or not http/https | AION will not guess at it |
| `https://user:pass@host/v1` | a credential in a URL is a credential in the state file |
| `https://host/v1?api_key=…` | so is one in a query string, and that is where hosts put tokens |
| `http://127.0.0.1:8000/v1` | that is this computer, not a machine you are renting |
| `http://192.168.1.40/v1` | that is this network |
| a host with no dot and no colons | not a resolvable name |

A mislabelled endpoint makes every disclosure built from it a lie, so the refusal is total rather
than a correction.

## Health is a completion, not a socket

Two checks, and only the second is evidence:

- **Probe** — something is listening and reports what it holds. If it reports a model list and the
  session's model is not in it, the endpoint is refused: registering an endpoint under a model name
  the host is not running would make every evaluation, comparison, and cost figure from it wrong.
- **Completion** — one bounded, synthetic prompt through the same runtime adapter ordinary work
  uses. An empty answer is a failure.

Three consecutive health failures abandon activation. Retrying inside an allowance is reasonable;
retrying forever is a bill.

**AION will not register an endpoint it cannot verify.** With no runtime adapter configured, the
machine is stopped rather than trusted.

## What the endpoint is

`owner-controlled-host`, tier `owner-gpu`, carrying a `rental` record: session id, provider,
instance reference, GPU, hourly rate, and the hard stop. No credential value — the runtime's
credential, if it has one, lives in a named environment variable like every other endpoint's.

Routing is unchanged. Local Preferred still walks the tiers cheapest-and-most-private first; Local
Only now does the same rather than taking the strongest thing present, and when it does reach a
rented machine the reason names the rate. Offline mode excludes it: renting capacity you control is
still control, and it is still not this computer. The disclosure says both, every time:

> This machine is rented from *provider* at *N* cents/hour and stops at *T*. You control it and you
> are paying for it; it is still not this computer, and the host could in principle see what is in
> its memory.

## Evaluation

`runEvaluationSuite` moved into the domain package, so the deterministic floor, a local runtime, and
a machine rented by the minute are measured by literally the same function rather than by two
implementations that could drift. A rented endpoint is an ordinary registered endpoint by the time
the harness sees it — if it needed a special path, "measured against the same suite" would not be
true.

Evaluating counts as using it, so a long benchmark is not stopped halfway through for inactivity.

## Teardown

The endpoint is removed **first**, in its own write, before the provider is asked anything. A stop
that cannot be confirmed must still leave the router unable to reach a machine that may already be
gone; the alternative is requests failing against a dead address while AION insists the endpoint is
fine.

Removal is idempotent by construction — it works from what is in the registry, not from what the
session believes. If the removed endpoint was the manual choice, the mode falls back to Local
Preferred rather than AION silently picking a replacement destination for the owner's context.

`teardownConfirmed` still comes only from the provider actually saying it stopped.

## Restart

On startup, in this order:

1. Enforce every stop condition, including the readiness allowance. A session that outlived a crash
   is torn down before anything reconnects to it.
2. Ask the provider what still exists. Local belief yields to it.
3. Resume only what is legitimately alive: an activating session continues where it was, a ready one
   keeps its endpoint if the endpoint is still registered and is re-verified from scratch if not.

**`start` is never called during reconciliation.** Uncertainty about local state is not a reason to
create a second machine somebody has to pay for. If the provider is unreachable, the endpoint is
withdrawn from routing and nothing is created to replace it.

A session recorded before this milestone said "running" when it meant "the box is on". The
migration remaps it to `waiting-for-endpoint` rather than `ready`, because promoting it would invent
exactly the fact this correction exists to stop AION asserting.

## Cost

Boot and model-load time bill exactly like inference time, so cost accounting starts when the
provider creates the machine, not when the endpoint becomes usable. Starting the clock at READY
would make every failed activation look free — the one case where the owner most needs the number.

The report separates provisioning, model loading, and serving, and the note is different when
activation failed:

> This session never reached a usable endpoint, so every minute of it was paid for boot time that
> produced nothing.

## Verification

`npm run verify` — 568 total, 564 passed, 0 failed, 4 skipped.
`npm run aion:v13r1:demo` — 15 behaviours, including five distinct failures.

The twenty failure-safety cases the directive named are in
`packages/local-assistant/test/gpu-endpoint-bridge.test.ts`, numbered in its order. Zero third-party
runtime dependencies added.

## What is still deliberately not activated

Unchanged from V1.3, and this milestone activated none of it.

| Area | State |
| --- | --- |
| Local inference runtime | Detection only. AION installs nothing. |
| Local model | Profiles only. AION downloads nothing. |
| Vast.ai credential | Read by name if set. AION never searches for one. |
| Paid provisioning | Adapter lock is closed. No instance has been created and nothing spent. |
| Real GPU experiment | Not run. USD 0.00 spent across this milestone. |
