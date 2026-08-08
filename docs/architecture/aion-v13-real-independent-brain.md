# AION V1.3 — Real Independent Brain + Governed Live Research

Directive: `AION-V1.3-REAL-INDEPENDENT-BRAIN`.
Builds on [AION V1.2](./aion-v12-independent-business-os.md).
Corrected by [AION V1.3-R1](./aion-v13-r1-gpu-endpoint-bridge.md), which closes the gap between a
provisioned GPU session and a routable Brain endpoint. The verification counts below are this
milestone's; the current ones are in that record.

## What V1.3 is for

V1.2 made model independence an architecture. V1.3 makes it measurable, gives AION a way to
rent capacity without the rented machine becoming a liability, and lets it read the public
web without becoming a crawler.

Three things are new and each has a number or a refusal attached rather than a claim.

## 1. The floor has a number

The deterministic offline provider has no endpoint address, deliberately. V1.2's evaluator
was address-based, so the floor could not be measured — and a baseline you cannot measure
makes every later comparison meaningless.

The fix is a seam, not a fake URL. A runtime adapter now declares which endpoints it can
serve; `InProcessBrainRuntimeV1` runs the deterministic provider directly through the same
`ModelProviderV1` port Chat uses, `HttpBrainRuntimeV1` takes anything with an address, and
`CompositeBrainRuntimeV1` routes each endpoint to whichever can serve it. An endpoint no
adapter can serve is refused **by name** — a silently skipped measurement looks exactly like
a passing one.

### The measured baseline

```text
instruction-following      0/2
structured-output          0/2
planning                   0/1
memory-context             0/2
tool-proposal              0/1
hallucination-resistance   0/2
code                       0/1
failure-behaviour          1/1
                    total  1/12
```

The first run scored **3/12** and that number was wrong. The deterministic provider echoes
its prompt, so `contains "sumOf"` and `contains "ACKNOWLEDGED"` passed on repetition rather
than capability. A `notEcho` check now fails any answer that reads back 80% or more of the
prompt's distinctive words. The corrected floor does exactly one thing: it fails safely on
empty input.

An inflated floor understates every real model measured against it, which is the opposite of
what a baseline is for.

## 2. Rented GPUs, with the money bounded

**Vast.ai supplies compute; it is not AION's brain.** Four separate things:

```text
infrastructure provider -> GPU session -> inference runtime -> open-weight model
```

The model router only ever talks to the last link, through an ordinary endpoint. Nothing
provider-specific reaches the endpoint contracts, so swapping hosts means writing one more
adapter and changing nothing else.

### A rented GPU is an experiment with a deadline

The design target is not correctness under normal operation. It is **the instance nobody
remembered**. Every stop condition — idle timeout, maximum runtime, maximum spend, health
failure, owner stop, and an absolute hard-stop timestamp — is computed at approval and
**stored in state**. Nothing depends on a timer or on a process staying alive. Limits are
enforced on the ordinary tick *and on startup, before anything else runs*, so a session that
outlived a crash is stopped by whatever starts next. The tick enforces them even when the
routine scheduler is off, because a rented box bills regardless of that setting.

### The spending boundary

| Control | Behaviour |
| --- | --- |
| Milestone ceiling | USD 16, checked when the proposal is **built** — a proposal the owner cannot legally approve is never shown |
| Self-consistency | A proposal whose own arithmetic could exceed its own limit is refused, with the arithmetic quoted |
| Approval | One-shot over a digest of the money-bearing fields; cannot be spent on a different offer, price, or duration |
| Price movement | Re-checked before spending; a rise past the approved limit **invalidates** rather than costing more |
| Teardown | Confirmed from the provider, never assumed. Unconfirmed says so and tells the owner to check the console |

Discovery scores **capability before price**: a machine that cannot hold the model is
ineligible at any rate. Recommendations come as three framings — economical, balanced,
maximum-useful — sized well inside the ceiling, deduplicated when tiers land on the same
machine, and absent entirely when nothing is eligible.

### Credentials

AION does not search for one. It reads a **named** environment variable at the moment of a
request and stores only the name. `redactCredentials` strips key-shaped text from any
provider message before it can reach state, Activity, or the browser. Two locks guard
provisioning: the service requires an approved proposal, and the adapter refuses unless
`allowProvisioning` was deliberately set — which it is not.

## 3. Governed live research

The V1.2 name guard refused private hostnames. That is not enough on its own, and V1.3 adds
the two things a hostname check cannot do:

- **DNS resolution is checked.** Every resolved address must be public. A perfectly ordinary
  public name pointing at `192.168.x.x` is caught, and one bad answer among several refuses.
- **Every redirect hop is re-checked.** Redirects are followed manually rather than by the
  runtime, so a public URL cannot bounce AION somewhere private. More than four hops stops.

Requests carry no cookies, no credentials, no referrer. Responses are read under a byte
ceiling and a timeout; non-text content types are refused; script and style bodies are
removed before extraction rather than merely un-rendered.

Findings are literal quotations attributed to the page, classed as observations, with a
caveat saying AION has checked nothing. There is no summarisation in the transport, because
a summary with no model behind it is a paraphrase pretending to be a reading.

Search is optional and replaceable. SearXNG is the reference because the owner can run it
themselves; with no instance configured, public-URL research still works.

### The research agent

`question -> plan -> discover -> retrieve -> extract -> compare -> synthesise`

The step most likely to launder a guess into a finding is synthesis, so it is the most
bounded: it may state what the sources said and how many said it, and nothing else.
Disagreement is surfaced, never resolved — *"AION has not decided which is right, and will
not."*

Confidence describes the **evidence**, not the answer: two sources agreeing is `moderate`,
never proof; one source is `weak` and single-source claims are counted, because resting on
one page is the commonest way research misleads; nothing found is `none` and says the
question is open rather than answered in the negative.

Proposed learning is limited to observation, inference, and hypothesis. There is no path
from research to a fact.

## Routing and context

Four tiers, walked cheapest and most private first:

```text
deterministic-floor -> local-model -> owner-gpu -> third-party
```

Local Preferred takes the first tier that can do the work. When it reaches for a rented
machine the reason says so out loud: *"nothing cheaper could do this, so AION reached for X,
a machine you rent. It costs money while it runs."*

Context minimisation is a **whitelist**, not a redaction pass — a new context class added
later is excluded until somebody deliberately includes it. Memory records are capped by
destination (20 local, 8 owner-controlled host, 3 third party), and five classes never leave
this computer under any mode: credential values, pairing codes and session tokens, other
workspaces, the complete Memory database, and complete relationship records.

An endpoint you control is better than a vendor's API. It is not the same as nothing leaving
the machine, and the disclosure says so.

## Cost intelligence

Nothing is estimated into existence: a token count is recorded only when the runtime reported
one, a cost only where a rate was known, and a tier with no usage is absent rather than zero.

The rent-versus-buy verdict refuses to have an opinion below **5 rented sessions and 3 hours
of measured GPU time**, and says how much more it needs. Buying hardware is a decision worth
hundreds of pounds; a confident recommendation built on three requests would be worse than
none. Above that threshold it gives a reading and names its own blind spots — it measured
usage, not resale value or electricity.

## Verification

`npm run verify` — 542 total, 538 passed, 0 failed, 4 skipped.
`npm run aion:v13:demo` — 21 behaviours, no GPU rented, no money spent, no model downloaded,
no credential read, no real network request.

Zero third-party runtime dependencies added. `npm audit --omit=dev` reports no
vulnerabilities.

## What is deliberately not activated

| Area | State |
| --- | --- |
| Local inference runtime | Detection only. AION installs nothing. |
| Local model | Profiles only, as planning estimates. AION downloads nothing. |
| Vast.ai credential | Read by name if set. AION never searches for one. |
| Paid provisioning | Adapter lock is closed. No instance has been created and nothing spent. |
| Search provider | Optional. Public-URL research works without one. |
| Training on owner data | Declared boundary; the guard refuses. |
