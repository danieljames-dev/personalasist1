# AION V1.2 — Privacy and boundaries

Companion to [the V1.2 architecture](../architecture/aion-v12-independent-business-os.md)
and to [the V1 privacy note](./aion-v1-local-assistant-privacy.md), which still applies.

This document states what AION does with information, what it refuses to hold, and what it
will not do at all. Everything here is enforced in code and covered by a test; where
something is a declared boundary rather than a working feature, it says so.

## What AION refuses to hold

About anyone, in any workspace, under any relationship type:

- Social-security or national identity numbers
- Driver's-licence numbers, images, or scans
- Credit scores, credit reports, credit applications
- Bank account, routing, IBAN, or sort-code details
- Payment card numbers, CVV, expiry
- Financing accounts, loan numbers, lienholder or payoff details
- Income, salary, pay stubs, employment verification, tax identifiers
- Passport numbers, dates of birth

These are refused **by field name** and **by value shape**: a note containing something
formatted like a social-security number or a payment-card-length number is refused too, so
the boundary survives being routed around by putting the value somewhere else.

## Who owns what

Every relationship record names its data origin.

| Origin | Meaning |
| --- | --- |
| `owner-created` | The owner made this for themselves or their own business. |
| `employer-work` | Recorded while doing a job. It belongs to the employer and their customer. |
| `imported-employer-system` | Reserved for a future authorised import. Nothing produces it. |

A relationship recorded in the Work workspace defaults to `employer-work`. AION does not
quietly reclassify an employer's record as the owner's personal property.

## Workspace isolation

Every record that can hold owner content names its workspace. Reads are filtered by it, an
unresolvable workspace is an error rather than a default, and nothing is ever copied between
workspaces implicitly — not Memory context, not search results, not relationships, not
lessons, not opportunities, not research.

A new business workspace starts genuinely empty. The workspace switcher is the one place
that legitimately spans workspaces, and it shows names only — never a count, never a record.

Archiving a workspace hides it. It moves, merges, and deletes nothing.

## What leaves the machine, and when

By default: **nothing**. AION binds loopback, the offline provider performs no network
request, and no research provider is configured.

When the owner configures an endpoint that is not on this computer, a disclosure is produced
**before** anything is sent, every time, naming:

- the provider, its runtime, and its model
- the destination host, and whether it is owner-controlled or third-party
- the workspace the context came from
- what context classes are included
- whether Memory records are included
- whether work or customer information is included
- whether the connection is encrypted

A disclosure is produced for the owner's own rented GPU too. It is still somewhere the
prompt travels, and pretending otherwise is the kind of small lie that makes the big
statements untrustworthy.

A third-party endpoint additionally requires an approval, and the disclosure says plainly
that the service may retain, log, or train on what it receives and that AION cannot control
that.

**Offline mode** means this computer only — not the owner's other machine, not their rented
GPU. It overrides every other setting, including Maximum Capability.

**Maximum Capability is a capability preference, never consent.** With remote proprietary
fallback off it stays inside owner-controlled infrastructure and says so.

## Credentials

AION stores the **name** of an environment variable and never a value, for model endpoints
exactly as for the V1 provider credential. A copy of the state file grants access to
nothing. Pairing codes and device session tokens are stored only as SHA-256 digests and are
returned exactly once, in the response that issues them.

## Research

AION ships with no research provider, so out of the box it cannot reach the internet at all.

When one is configured, a job runs only after an owner approval and only within limits the
owner set. Before any request the URL guard refuses non-HTTP schemes, credentials in the
URL, loopback and private and link-local and carrier-grade addresses, the cloud metadata
address, private-network and anonymity-network names, and bare internal hostnames — each by
name, so a typo reads differently from a boundary.

AION does not log in, carry a session, follow a login wall, bypass access control, or crawl.
Every finding cites a source that was actually retrieved; one that cites something never
fetched is discarded and the discard is reported.

## Learning and training

AION learns in explicit records outside any model. **It does not fine-tune anything and does
not train on owner data.**

The adaptation boundary is declared and deliberately unimplemented. Any future training
would require its own explicit authorisation and an auditable manifest naming every record
used. The guard refuses in both directions, so nothing can proceed on the assumption that
the capability already exists.

## Evaluation fixtures

The twelve evaluation cases are invented and contain no personal, customer, or employer
information. That is deliberate: they may be sent to a third-party endpoint to measure it,
and an evaluation that leaked private context in order to measure privacy would be
self-defeating.

## Networking

AION will not:

- install or configure Tailscale, WireGuard, or any other network software
- sign in to an overlay network or read its state
- open a port on a router, or ask UPnP to
- create a public tunnel or a relay
- bind a wildcard address
- treat being on a network as authentication

AION will bind loopback always, additionally bind one exact private address the owner names,
say honestly whether that address works away from home, and require a paired session on
every non-loopback request.

## What is intentionally not activated

These exist as ports, records, or declared boundaries, and nothing performs them:

| Area | State |
| --- | --- |
| Research provider | No provider ships. One must be configured. |
| Build pipeline | No pipeline ships. Steps refuse without one. |
| Deployment | No capability performs one. Advancing to `deployed` refuses. |
| Fine-tuning / training | Declared boundary only. The guard refuses. |
| GPU provisioning | Configuration only. AION rents nothing and spends nothing. |
| Model download | Detection reports what exists; downloading is an owner act. |

## Development conduct

No live private state was read, parsed, copied, or modified while building V1.2. Every test
and demo uses invented fixtures in a temporary directory, and every one of them cleans up.
No paid call was made, no account was accessed, and no network request was performed by any
test or demo in this milestone.
