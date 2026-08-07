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
Discovery checks a short fixed list of documented Codex CLI install locations with one `stat`
each; it never scans the computer. Windows npm shell shims are deliberately ignored because AION
never routes instruction text through a shell — the adapter spawns a real executable with
`shell: false` and an argument vector, pinned to one approved repository root. When nothing
suitable is found the bridge reports itself unavailable rather than fabricating support.

## Out of scope for V1

This V1 does not close DG-3 or DG-4b, stabilize the Universal Object Contract, create normative
fixtures, install an OS service, submit applications, send email, browse job boards, scan drives,
make a live model call, or make a production-scale claim.
