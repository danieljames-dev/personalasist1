# AION V1.2 — Threat model

Extends [the V1 threat model](./aion-v1-local-assistant-threat-model.md), which still
applies in full. This document covers only what V1.2 added.

## What V1.2 changed about the attack surface

Three things widen it, and each has a specific containment:

| New surface | Containment |
| --- | --- |
| Sentences become typed proposals | The payload types have nowhere to put a command; a guard refuses shell-shaped text anyway. |
| AION can be pointed at HTTP endpoints | Endpoint addresses and research URLs are validated before any request; location must match address. |
| Projects orchestrate a developer agent | Stage transitions require an owner approval naming the stage; no field carries a command. |

## Threats and how they are answered

### An instruction becomes a command

The command router resolves a sentence into a record whose free-text fields are titles,
descriptions, and questions. A verification request produces an operation *identifier*
chosen from AION's own list, so the type cannot express a command at all. The developer
instruction still travels on standard input, never as an argument, and defaults to
read-only.

`assertNoExecutableText` walks every routed payload and refuses anything shell-shaped. It
is belt and braces — nothing downstream executes anything — but if a future field ever did
reach a process, that test would fail before the exploit did.

**Covered by:** five injection attempts in `command-router.test.ts`, and one in the demo.

### AION is talked into fetching something on the owner's own network

This is the classic SSRF shape, and it is the reason research is a job rather than a
capability. The URL guard runs before any request and refuses loopback, private,
link-local, and carrier-grade addresses, the cloud metadata address, `.local` /
`.internal` / `.onion` / `.i2p` names, bare internal hostnames, non-HTTP schemes, and
credentials in the URL.

IPv6 is judged by an allowlist rather than a denylist of prefixes, because the denylist is
the part that goes out of date: global unicast is `2000::/3` and everything outside it is
refused. That is what catches an IPv4-mapped private address after the URL parser
normalises it into hex form.

**Residual risk:** DNS rebinding. The guard validates the hostname, and a name that
resolves to a private address at request time would not be caught by the name check alone.
The containment today is that no research provider ships, so nothing performs the fetch; a
future networked provider must re-check the resolved address at connection time.

**Covered by:** seventeen refusal cases in `research.test.ts`, including the mapped-IPv6 form.

### An endpoint is mislabelled to make a disclosure lie

An endpoint's declared location must match its address: a `local-machine` endpoint pointed
at someone else's server is refused rather than corrected, because the location label is
what the disclosure is built from. A `third-party-service` endpoint on loopback is refused
for the same reason in reverse.

**Covered by:** `an endpoint's declared location must match its address` in `brain.test.ts`.

### A credential leaks through state, logs, or the browser

AION stores the *name* of an environment variable. The adapter reads the value at the moment
of the request and it never reaches state, Activity, a log, or the browser. Probe and
completion errors are passed through a redactor that removes local paths and
credential-shaped tokens before they are shown.

**Covered by:** `AION stores the name of a credential variable and never a value`.

### A model quietly becomes the authority

Three separate mechanisms, because this is the threat the whole milestone is about:

- **Autonomy.** The granted ceiling is owner policy supplied separately from the actor, so
  an actor cannot raise its own authority. Only the owner can approve anything.
- **Knowledge.** A model cannot record a fact. Whatever class it asks for, it gets a
  hypothesis or an inference with the proposal recorded as its source.
- **Projects.** An agent proposal grants nothing; a stage that changes the repository needs
  an approval naming that exact stage.

**Covered by:** `autonomy.test.ts`, `product-studio.test.ts`, `projects.test.ts`, and the demo.

### Context reaches a third party without the owner realising

A disclosure is produced before anything leaves, for owner-controlled hosts as well as third
parties, and a third party additionally requires approval. Remote proprietary fallback is
off by default and AION never switches on its own initiative — with fallback on it produces
a proposal, not a switch. Offline mode overrides every mode including Maximum Capability.

**Residual risk:** the owner can, deliberately, configure a third-party endpoint and approve
sending private context to it. That is their decision to make; AION's obligation is that it
is never made accidentally or silently, which is what the disclosure and the default-off
fallback are for.

**Covered by:** the router-mode tests, and four routing paths in the demo.

### A build or deployment escapes the sandbox

There is no build pipeline by default, because one that ran a project's own build commands
would be exactly the shell exposure the rest of the design avoids. The pipeline port takes a
step from a closed set of four; `canPublish` is typed `false`, so an adapter that could
publish cannot satisfy the port without the port being changed. Advancing a project to
`deployed` refuses unconditionally.

**Covered by:** `projects.test.ts` and the demo's deployment refusal.

### A private address is baked into shipped code

The bind address is owner-supplied configuration, so runtime source has no legitimate reason
to contain any private address at all. The rule is enforced across everything under `apps/`,
`scripts/`, and `packages/*/src`, excluding tests and demos, which are fixtures — a demo that
proves AION refuses to research the router has to name something that looks like a router.

**Covered by:** `no machine-specific private address is committed` in `bind-runtime.test.mjs`.

### Network reachability is mistaken for authentication

Unchanged from V1.1 and restated as data in `NETWORK_BOUNDARY`: an overlay decides which
machines can open a socket, not who is holding the phone. Every non-loopback request needs a
paired session regardless of what carried it.

## Dependencies

Zero third-party runtime dependencies were added in V1.2. Every new module is standard
library plus workspace-internal code. `npm audit --omit=dev` reports no vulnerabilities.

## Things a reviewer should push on

Stated here rather than left to be discovered:

1. **The command router's rule table is a denylist of triggers, not a parser.** A sentence
   it does not recognise becomes conversation, which is the safe direction, but a sentence
   that happens to contain a trigger phrase in an unexpected way will produce a proposal the
   owner has to read. The proposals are always shown before anything happens.
2. **`assertNoExecutableText` is a heuristic.** It is a second line behind types that cannot
   express a command; it is not the primary defence and should not be treated as one.
3. **The evaluation harness measures fixtures, not models.** Its summary says so explicitly,
   and a comparison flags a high score sitting on a hallucination failure, but a reader who
   skips both could still over-read a number.
4. **Detection reaches loopback ports.** That is a network operation, however local. It is
   bounded to four documented addresses with a four-second timeout and reads only a model
   list.
