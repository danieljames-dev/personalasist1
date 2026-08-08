# AION V1.2 — Independent Business OS

Directive: `AION-V1.2-INDEPENDENT-BUSINESS-OS`.
Supersedes nothing; extends [AION V1 Local Assistant](./aion-v1-local-assistant.md).

## What changed, in one paragraph

V1.1 was an assistant with two workspaces and a Work-only relationship record. V1.2 makes
three things true that were not: AION's reasoning no longer depends on any company's API, the
relationship record serves any kind of relationship in any workspace the owner creates, and
everything AION believes carries a stored class so a guess cannot quietly become a fact.

## The foundational rule

**AION owns durable intelligence. A language model is a replaceable reasoning provider.**

Memory, Tasks, Routines, Plans, relationships, workspaces, brands, Product Studio,
research evidence, learned strategies, permissions, approvals, Activity, and agent state
belong to AION. Removing every configured model must leave all of it intact and must leave
AION usable. That is not a design intention: `independenceReport` answers it against the
real configuration, and `npm run aion:v12:demo` deletes every endpoint and then shows AION
still holding everything and still answering.

A model's hidden conversational context is never AION's Memory. `BRAIN_BOUNDARY` states
this as data so the UI and the docs cannot drift from it.

## Workspaces

`WorkspaceIdV1` is an opaque identifier resolved against `state.workspaces`, not a closed
union. Personal and Work are always present and can be relabelled but never removed; the
owner adds business and brand workspaces alongside them, each with an owner-supplied
identity and product list.

Isolation is structural and unchanged. Every record that can hold owner content names its
workspace, every read is filtered by it, and an unresolvable workspace is an error rather
than a fall back to a default that belongs to someone else. A new workspace starts
genuinely empty — nothing is copied into it from anywhere.

Migration `aion.workspace-registry.v1` seeds the registry from the labels the owner already
chose. It invents no workspace they did not have.

## The Relationship Core

The Sales record, promoted. The same shape carries a declared `relationshipType` —
prospect, customer, contact, lead, partner, vendor, support-contact, other — and lives in
any workspace. There is no second implementation: a customer is a relationship whose type
is `customer`, and `sales.ts` is the Sales-facing names pointing at the one domain.

Data ownership survives the promotion. A relationship recorded in the Work workspace still
defaults to `employer-work`; one the owner made in their own business workspace defaults to
`owner-created`. Identity, credit, banking, and financing material is refused by field name
and by value pattern, in every workspace and under every relationship type.

Migration `aion.relationship-core.v1` moves each customer across with its identifier,
reference, workspace, timeline, appointments, follow-ups, links, and provenance untouched.

## Typed knowledge

`knowledge.ts` defines eight classes — fact, observation, evidence, assumption, hypothesis,
inference, owner-confirmed, learned-strategy — and the rules about what may become what.

- A model cannot record a fact or an owner-confirmed claim at all. It produces a hypothesis
  or an inference with the proposal recorded as its source.
- A class that only means something with a citation cannot be created without one.
- Promotion is owner-only, follows a declared path, and is additive: the previous class
  stays in the record, so "when did we start believing this?" always has an answer.
- Superseding disables and points at the replacement rather than deleting.

This is the spine of Product Studio and of the learning loop. Both read from it rather than
each inventing their own idea of confidence.

## Product Studio

An opportunity holds the problem, the target customer, the proposed solution, the
distribution and pricing hypotheses, the risks, competitor notes, validation experiments, a
specification, and its own typed claims.

Scoring is arithmetic and visible: owner-entered severity, reach, advantage and effort,
scaled by the share of live claims that are actually settled. An opportunity built entirely
from assumptions scores zero and says so; rewording the problem statement changes nothing.
An experiment records its success criteria before it runs and its result cannot be rewritten
afterwards. The assessment names untested hypotheses and unresearched competitor notes, and
ends by stating that AION did not gather market evidence and cannot.

## Governed research

A research job is a written question, a declared scope, hard limits on sources, bytes,
duration and cost, an owner approval, and a record of exactly what was consulted. Proposing
runs nothing.

Every finding must cite a source the provider actually returned; a finding citing something
never fetched is discarded and the discard is reported. A finding can only be an
observation, inference, or hypothesis, so research settles nothing by itself. A job costing
more than its limit is refused outright rather than recorded.

**AION ships with no research provider.** A default that could already reach the internet
would make "governed research" a label rather than a property.

The URL guard decides reachability before a request is made and refuses, by name:
non-HTTP schemes, credentials in the URL, loopback, private, link-local and carrier-grade
addresses, the cloud metadata address, `.local` / `.internal` / `.onion` / `.i2p` names, and
bare internal hostnames. IPv6 is judged by an allowlist — global unicast is `2000::/3` and
everything outside it is refused — which is what catches an IPv4-mapped private address
after the URL parser normalises it into hex.

## The brain

`brain.ts` models **endpoints**, not vendors. An endpoint is somewhere inference happens:

| Location | Meaning |
| --- | --- |
| `local-machine` | A runtime on this computer. |
| `owner-controlled-host` | A second machine or a rented GPU the owner controls. |
| `third-party-service` | A vendor API. |

Renting capacity the owner controls is still owner control. What matters is that no single
vendor can end AION's reasoning capability.

### Router modes

| Mode | Behaviour |
| --- | --- |
| Local Only | Never reaches a third-party endpoint, however capable it is. |
| Local Preferred | Prefers what the owner controls; a third party is a proposal, never a switch. |
| Manual | Uses the endpoint the owner named, or refuses and says why. |
| Maximum Capability | Prefers the strongest — and is never consent to send context out. |

Two rules no mode overrides:

1. **Offline mode means this computer.** Not the owner's other machine, not their rented
   GPU. It refuses rather than reaching out.
2. **A third-party endpoint always discloses and always needs approval.** Remote
   proprietary fallback is off by default.

There is no silent switch anywhere. Every endpoint the router considered and rejected is
returned with the reason.

### Disclosure

Produced before anything leaves, and produced for owner-controlled hosts too — a rented GPU
is still somewhere the prompt travels. It names the provider, the destination, whether it is
owner-controlled, the workspace, the context classes, whether Memory is included, and
whether work or customer information is included. Plain HTTP is called out. A third party is
told plainly that it may retain, log, or train on what it receives.

### Credentials

AION stores the **name** of an environment variable and never a value. The adapter reads it
at the moment of the request; it never reaches state, Activity, a log, or the browser.

### The offline floor

The built-in offline provider has no address, needs no credential, and cannot be removed. It
is restored if a state file arrives without it. It is what makes the acceptance criterion
true.

### Runtime adapter

`apps/aion/brain-runtime.mjs` is the only place AION talks to a runtime, keeping the package
free of network code as the architecture boundary requires. Detection tries a short fixed
list of documented loopback addresses — Ollama, an OpenAI-compatible server, llama.cpp,
vLLM — and reports what answered. It installs nothing, downloads nothing, starts nothing,
and searches no part of the computer. Turning a detected runtime into a configured endpoint
is an explicit owner act.

## Model evaluation

Twelve deterministic synthetic cases across eight dimensions, each declaring its checks as
data. No model grades another model. The fixtures contain no personal, customer, or employer
information and are safe to send to a third-party endpoint — an evaluation that leaked
private context in order to measure privacy would be self-defeating.

Two cases test the failure that matters most: inventing a number it has no way to know, and
citing a study that does not exist. The comparison calls out a high overall score sitting on
a hallucination failure rather than averaging it away.

## The learning loop

AION learns in typed, provenance-backed records outside any model. Replace the model and
nothing learned is lost, because none of it was ever inside the model.

A model may propose a lesson; whatever class it asks for, it gets a hypothesis. "Did not
work" is a first-class outcome, and a lesson that has failed more often than it has worked
stops being recommended and says so. Turning one off keeps it.

**The adaptation boundary is declared and unimplemented.** Fine-tuning is never required for
AION to learn, nothing here trains on owner data, and the guard refuses in both directions:
without authorisation and a manifest it refuses on those grounds, and with them it still
refuses, because the boundary exists so a future change has to be deliberate.

## Development projects

Stages run idea → specification → plan → tasks → implementation → verification → review →
preview → owner-approved, and are not skipped. Each refusal names the actual obstacle: a
review cannot be recorded without evidence, a preview stage needs a preview that actually
built, and an implementation stage needs an approval naming that exact stage.

An agent proposal is attributable and grants nothing — running it still goes through the
ordinary capability, digest, and one-shot approval machinery. Nothing in a project record
can hold a command: the pipeline takes a step from a closed set of four.

**AION cannot deploy.** Preparing a deployment records what would happen and what it would
cost if it were wrong; approving it records intent; advancing to `deployed` refuses. AION
also ships no build pipeline by default, because one that ran a project's own build commands
would be the shell exposure the rest of the design exists to avoid.

## The command router

Ordinary sentences resolve to **typed proposals**, never to commands. It is deterministic and
uses no model, so the same sentence always resolves the same way and a model cannot influence
what its own output is interpreted as.

A verification request produces an operation identifier chosen from AION's own list; the
payload type has nowhere to put a command. Triggers separated by real content are a compound
request; triggers competing for the same words are an ambiguity and produce a question.
`assertNoExecutableText` walks every routed payload for shell-shaped text and refuses.

## Autonomy governance

| Level | Meaning | Approval |
| --- | --- | --- |
| 0 | Read and analyse | no |
| 1 | Create locally | no |
| 2 | Modify locally | yes |
| 3 | External, reversible | yes |
| 4 | External communication or deployment | yes, plus standing authorisation |
| 5 | Financial, legal, or irreversible | yes, plus standing authorisation |

Two rules are enforced rather than remembered: **no agent raises its own authority**,
because the granted ceiling is owner policy supplied separately from the actor; and **no
model approves its own proposal**, because only the owner can approve at all. A capability's
level is derived from what it structurally does, and where properties conflict the more
serious one wins.

## Away from home

`classifyBindAddress` recognises what kind of network an accepted address is and whether it
reaches beyond the building. `NETWORK_BOUNDARY` states the refusals as data: AION will not
install or configure overlay software, sign in to one, open a router port, create a public
tunnel, bind a wildcard, or treat being on the network as authentication. A paired session is
required on every non-loopback request whatever carried it.

## State and migrations

`AssistantStateV1` gains `workspaces`, `relationships`, `opportunities`, `researchJobs`,
`brain`, `evaluations`, `lessons`, and `projects`, and loses `customers` to the promotion.

Three migrations, all deterministic, idempotent, and fail-closed:

| Migration | What it does |
| --- | --- |
| `aion.workspace-separation.v1` | V1.1: assigns the documented default workspace. |
| `aion.workspace-registry.v1` | Seeds Personal and Work from the owner's labels. |
| `aion.relationship-core.v1` | Moves customers into the Relationship Core intact. |

A migration records itself only when owner records actually moved; a collection that simply
never existed gains an empty one silently, the same way every other additive collection
does. That is what keeps a restart byte-identical.

## Verification

`npm run verify` — 459 total, 455 passed, 0 failed, 4 skipped.
`npm run aion:v12:demo` — 27 behaviours proved with no network call of any kind.

Zero third-party runtime dependencies were added. `npm audit --omit=dev` reports no
vulnerabilities.
