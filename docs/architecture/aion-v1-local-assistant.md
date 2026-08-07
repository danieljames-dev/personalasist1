# AION V1 local assistant architecture

Status: Reference Candidate implementation contract

## Boundary

AION V1 adds one cohesive `@aion/local-assistant` domain package and one local Command Center
composition app. A package per screen would add dependency ceremony without independent lifecycle
or replacement evidence. The package contains versioned records and application policy; the app
selects adapters, serves the same-origin UI, resolves the developer-agent executable, and
integrates the already accepted Career workflow.

```text
Command Center UI -> loopback HTTP app -> AionAssistantV1
                                         |-- StateRepositoryV1
                                         |-- ModelProviderV1
                                         |-- ClockV1 / IdGeneratorV1
                                         |-- CapabilityRegistryV1
                                         |-- ImportSourceV1
                                         |-- PrivateBackupV1
                                         `-- DeveloperAgentBridgeV1

Career screen -> fixed allow-listed Career commands -> accepted Career packages/object repository
```

The UI never reads files. Providers never receive repositories. Every port above is replaceable,
and the deterministic clock, id generator, provider, repository, and bridge implementations used
by the tests and the demo are the substitution evidence.

## Proposal, approval, and execution

A provider may end its response with `AION-PROPOSE-ACTION <json>` or `AION-PROPOSE-MEMORY <json>`
lines. AION strips those lines from the stored message, discards anything malformed or
unregistered with a recorded activity note, and revalidates the remainder. A surviving action
proposal becomes a normal `AgentActionV1` in `awaiting-approval`; a surviving memory proposal
becomes an `unconfirmed` memory. Provider origin is recorded and grants no additional authority.

Execution requires an approval bound to the exact capability and the exact canonical digest of
the input. Approving consumes the approval, so a second execution of the same action fails and a
materially different input requires its own approval. Expiry is swept on every write, so a lapsed
approval can never be decided. No capability accepts shell text, and the model can never approve.

## Persistence and privacy

Assistant state is a single versioned JSON document below an explicitly supplied ignored
`private/aion/` root; the repository refuses any other location. Writes use a same-directory
temporary file with mode `0600`, `fsync`, and atomic rename, guarded by an expected-revision
check and serialized through one write queue. Records use opaque IDs, canonical timestamps,
explicit provenance, revision/history fields, and deterministic ordering. Corrupt or unsupported
state fails closed rather than being repaired. Activity stores summaries and references only —
never credentials, passphrases, or imported document bodies — and is pruned to the owner's
retention window on every write.

Memory keeps provenance, source timestamps, correction history, enablement, deletion, and export.
Two enabled memories in one category whose contents differ but whose subject matches — the text
before the first colon, or the first four words — are both preserved and both flagged
`conflicting`. AION never silently merges or replaces a memory.

Imports start with an explicit root/path and a dry run. Parsers preserve platform, conversation
boundaries, timestamps when supplied, exact SHA-256 digests, and source references; duplicate
digests are reported; sources are never modified. Executing an import re-inventories the selection
and refuses to proceed if it changed after the dry run.

Private backup uses Node's established `scrypt` and AES-256-GCM primitives with a random salt and
nonce, authenticated versioned metadata, and a post-write decrypt-and-compare verification.
Passphrases and derived keys are never persisted or logged. Source backup remains separate and
continues to exclude every private runtime location.

## Security properties

The server binds `127.0.0.1` by default, enforces same-origin `Host`/`Origin` checks, bounds
request bodies to 1 MiB, sets a self-only CSP with `nosniff` and `no-referrer`, and serves no
remote script, style, or font. Errors are rewritten to remove absolute local paths before they
reach the browser. File adapters reject relative, device, UNC, traversal, symlink, and escaping
real-path selections. Scheduler work is process-local, serialized, clock-injected, and records the
scheduled instant before calculating the next run; AION installs no Windows service or startup
task. External or irreversible capability classes default to approval-required, and the owner may
additionally require approval for every action. Settings persist only the *name* of a credential
environment variable, never its value.

The developer-agent bridge is reached only as the registered `aion.developer.task.v1` capability,
so it inherits validation, digest binding, one-shot approval, cancellation, and activity records.
Two bridges ship — Codex CLI and Claude Code CLI — behind one `DeveloperAgentBridgeV1` port and a
`DeveloperAgentRegistryV1` the owner selects through Settings. Selection is owner policy: an
unregistered identifier fails closed and the registry never substitutes a different bridge.

Discovery checks a short fixed list of documented install locations for each supported CLI with
one `stat` each; it never scans the computer. Windows npm shell shims and script entry points are
deliberately ignored because AION never routes instruction text through a shell or an interpreter
of its own choosing — the adapter spawns a real executable with `shell: false` and a fixed argument
vector, pinned to one approved repository root, with a timeout and cancellation. **Instruction text
is written to the child's standard input and never appears in the argument vector**, so no part of
a task can be read as a flag, a path, or shell syntax; control characters are rejected outright.
Each bridge discloses the exact argument vector it would use, with the local repository path
redacted, so the owner can read the real command before approving.

A task is `read-only` or `workspace-write`, and the mode is part of the capability input, so it is
covered by the canonical digest the owner approves: a read-only approval can never be spent on a
writing run. An absent mode resolves to read-only, so the boundary fails closed. Codex maps the
mode to its own sandbox policy; Claude Code restricts a read-only task three ways at once —
planning permission mode, an explicit read-only built-in tool set, and an explicit denial of the
writing tools — with configured MCP servers excluded from every task.

Executable availability and account health are separate questions and are reported separately. A
version probe proves only that the program exists; sign-in state is checked with the vendor's own
local status command, and only when the owner asks. Remaining credit or quota is never determined,
because that would require a paid call. When nothing suitable is found the registry holds a single
truthful unavailable bridge rather than fabricating support.

The offline provider can hand a repository question to the developer agent: a `developer:` turn in
Chat produces an ordinary read-only proposal that AION revalidates against the registry and queues
for approval. It carries no extra authority, and no capability accepts shell text.

## V1.1: workspaces, Sales, verification, and phone access

**Workspace separation.** Every record that can hold owner content — conversations, memories,
tasks, routines, plans, activity — carries a `workspace` of `personal` or `work`. Separation is
enforced in four independent places: memory context is filtered to the conversation's own
workspace, search never crosses the boundary, conflict detection groups *within* a workspace
because the same statement in two workspaces is two facts rather than a conflict, and the UI
renders every list through an explicit filter. A deterministic, idempotent, fail-closed migration
assigns the documented default of `personal` to every pre-workspace record, adding a field and
changing nothing else; it never creates a `work` record, so migration cannot move material across
the boundary. It applies only when it actually assigns something, so reopening writes nothing.

**Durable relationships.** `CustomerV1` is a long-lived work-scoped record — stable opaque
reference, lifecycle, contacts, interests, objections, appointments, follow-ups, next action,
linked tasks and plans, outcome, archival flag, provenance — with an append-only interaction
timeline. Lifecycle changes, appointments, follow-ups and outcomes all append; an owner edit
enumerates its editable fields, so the timeline, identifiers, provenance and outcome cannot be
edited away. Nothing is automotive-specific: a vehicle is one kind of interest and the workplace
name is a label the owner types. Identity, credit, banking and financing fields are refused by
name, and free text that looks like a social-security or payment-card number is refused too.
Records carry a `DataOriginV1`, defaulting to `employer-work`, so AION does not imply that
customer information is the owner's personal property.

**Deterministic coaching.** `sales-coach.ts` is pure templates over recorded material. No model is
called, so it works offline and identically every time. Wherever a current commercial fact would
be needed the template emits an explicit confirm marker instead of a number, and a test asserts no
output contains a currency amount, a percentage, an APR, an MSRP, or an availability claim. Drafts
state that AION sends nothing.

**AION-owned verification.** `aion.verify.run.v1` accepts one field — an operation identifier from
a fixed allowlist — and refuses `command`, `args`, `shell`, `cwd`, `env` and any unexpected field
by name. The runner lives in the composition root beside the Career bridge, spawns with
`shell: false` and a frozen argument vector, and reaches npm through its CLI entry point rather
than a shell shim. Evidence is bounded, digested, and recordable only by an executed capability —
the recording method is a true JavaScript private, because `server.mjs` is untyped and TypeScript's
`private` would not have stopped it. That evidence then feeds a **read-only** developer-agent
analysis, which is how "what is failing?" is answered without granting shell or write access.

**Phone access.** Two independent things must hold before a non-loopback request is served: the
owner has turned private access on, and the request carries a session from a pairing performed at
the console. Network reachability is never authentication. Pairing codes are single-use and expire
in ten minutes; issuing a new one invalidates the old. Only SHA-256 digests are stored, compared in
constant time, so the state file grants no access. Bearer material travels in a header, never a
URL. Sessions expire and are individually and collectively revocable, and revocation touches no
owner record. Turning access off ends every live session immediately. Pairing is rate-limited per
peer. A paired phone may drive AION but may never mint a code or change access settings. The bind
address must be loopback or a private range; wildcards and public addresses are refused, and AION
creates no tunnel and no router configuration. The service worker caches the application shell
only — every `/api/` request is network-only, so no private response is ever persisted by a
browser that may later be lost or revoked.

## Out of scope for V1

This V1 does not close DG-3 or DG-4b, stabilize the Universal Object Contract, create normative
fixtures, install an OS service, submit applications, send email, browse job boards, scan drives,
make a live model call, or make a production-scale claim.
