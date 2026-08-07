# AION V1 local assistant threat model

Status: Reference Candidate. Reviewed for the AION V1 local assistant milestone.

## Scope and assets

In scope: the loopback Command Center, `@aion/local-assistant`, the archive Import Center, the
encrypted private backup, and the developer-agent bridge. Assets are the owner's conversations,
memories, tasks, routines, plans, activity history, imported AI-assistant archives, Career state
held by the accepted Career engine, and any provider credential the owner configures.

Out of scope: the operating system, the browser, disk encryption, physical access, and the
security of any remote provider the owner may later configure.

## Trust boundaries

1. Browser UI to loopback HTTP server — same-origin, bounded, no remote assets.
2. Server to `AionAssistantV1` — typed calls only; the transport never touches storage.
3. `AionAssistantV1` to model provider — messages and explicitly enabled memory context only.
4. `AionAssistantV1` to filesystem — path-contained adapters under an explicit private root.
5. Command Center to the accepted Career engine — a fixed allow-list of commands, no shell.
6. Command Center to a local developer agent — one approved repository root, no shell.

## Threats and controls

| # | Threat | Control | Evidence |
| --- | --- | --- | --- |
| T1 | Another local application or a web page reaches the Command Center | Bind `127.0.0.1` only; require a loopback `Host`; reject a foreign `Origin` | Server suite: loopback bind and 403 on foreign origin |
| T2 | A malicious page loads AION assets or exfiltrates state | Self-only CSP, `nosniff`, `no-referrer`, no remote script/style/font, no `frame-ancestors` | Server suite: CSP headers and no-remote-origin assertions |
| T3 | Provider text causes a privileged action | Proposals are stripped, revalidated, and become `awaiting-approval` records; no capability accepts shell text; models cannot approve | Domain suite: a provider proposal never executes and never self-confirms |
| T4 | An approval is reused, widened, or applied to a different input | Approval binds capability plus canonical input digest; approval is consumed on execution; expiry swept on every write | Domain suite: one-shot approval; one digest only; expired approval fails closed |
| T5 | Path traversal, UNC, device path, or symlink escape during import, export, or backup | Normalized-absolute checks, containment against the real path of the nearest existing parent, symlink rejection, file-count and byte caps | Domain suite: selections outside the approved root fail closed |
| T6 | An import silently overwrites, mutates, or re-imports the owner's archive | Dry run first, exact SHA-256 digests, duplicate reporting, cancellation, sources opened read-only, re-inventory before execute with refusal on change | Domain suite: duplicate detection, cancel, changed-archive refusal |
| T7 | Private data leaks into logs, errors, activity, or source backup | Activity stores summaries and references only; errors are path-rewritten; `private/` and `.aion-local/` are Git-ignored and excluded from source backup | Server suite: no absolute path in state or errors; backup exclusion evidence |
| T8 | A credential is committed, logged, or persisted | Only the *name* of an environment variable is stored; the value is never read into state; source scans assert no literal credential | Domain and architecture suites: settings and source-scan assertions |
| T9 | An encrypted backup is forged, truncated, or tampered with | AES-256-GCM with AAD and auth tag, scrypt-derived key, embedded plaintext digest, decrypt-and-compare after write | Domain suite: wrong passphrase and tampered-ciphertext rejection |
| T10 | Corrupt or downgraded state is silently repaired, losing owner data | Schema and revision validation fail closed; no automatic repair; expected-revision writes | Domain suite: corrupt and unsupported state fail closed |
| T11 | The developer agent modifies files outside the repository or runs arbitrary shell text | Reached only as an approval-gated capability; one pinned approved root; `shell: false` with a fixed argument vector; instruction text travels on standard input and never becomes an argument; control characters rejected; Windows shell shims and script entry points ignored | Domain and app suites: foreign root refused, approval required, shim exclusion, instruction never in the disclosed vector |
| T12 | Discovery of the developer agent becomes a computer scan | A short fixed candidate list per supported CLI, one `stat` each, owner override must be absolute | App suite: candidate lists bounded, absolute, executable-only, for both Codex and Claude Code |
| T16 | An approval for a read-only review is spent on a repository-writing run | The mode is part of the capability input and therefore of the canonical digest; an absent mode resolves to read-only; the approval summary states the boundary before the owner decides | Domain, app, and demo suites: differing digests, read-only default, writing task refused under a read-only approval |
| T17 | A bridge that is merely installed is treated as operational, or an account probe leaks owner identity | Executable availability and account health are separate fields; sign-in is checked only on explicit request using the vendor's local status command; only the sign-in flag is read, never the address, organisation, or plan; remaining quota is never determined because that would need a paid call | Domain suite: no address reaches activity, health is live rather than persisted state |
| T18 | The selected developer bridge is silently substituted, or a local executable path identifies the owner | Settings choose from the registered set only and an unknown identifier fails closed; status reports an executable *name*, and the disclosed argument vector redacts the approved repository root | Domain and app suites: unregistered selection rejected, no absolute path in status, state, or disclosed command |
| T13 | A routine silently gains persistence on the machine | The scheduler is in-process only and stops with AION; no service or startup task is installed | Domain suite: scheduler honours enablement and the setting |
| T14 | Unbounded requests or responses exhaust memory | 1 MiB request cap, 16 MiB state cap, 100 000-character message cap, import file and byte caps, capability timeouts and retry limits | Server suite: oversized body rejected |
| T15 | Concurrent writes interleave and corrupt state | One serialized write queue plus expected-revision checks and atomic rename | Domain suite: revision conflict detection |

## V1.1 threats and controls

| # | Threat | Control | Evidence |
| --- | --- | --- | --- |
| T19 | A model causes an arbitrary command to run under the guise of "running the tests" | The verification capability accepts only an operation identifier from a fixed allowlist; `command`, `commandLine`, `args`, `argv`, `shell`, `script`, `exec`, `run`, `cwd`, `env`, `path` and any unexpected field are refused by name; identifiers are looked up, never parsed | Verification suite: every smuggling shape refused, including an identifier containing shell syntax |
| T20 | Verification evidence is forged to make a failing suite look green | Evidence can only be produced by an executed, approved capability; the recording method is a true JavaScript private with no endpoint and no typed or untyped caller outside the class | Domain suite: the method is absent from the runtime surface |
| T21 | Work material leaks into Personal, or the reverse | Workspace on every content record; memory context filtered to the conversation's workspace; search scoped; conflict grouping per workspace; UI filtered; relationships and coaching refuse outside Work | Domain, app and demo suites: search, context, and conflict isolation in both directions |
| T22 | A migration silently loses or moves owner data | Deterministic, idempotent, fail-closed; adds a field and nothing else; never creates a Work record; unrecognised values refuse rather than guess | Migration suite: deep equality against the original after stripping only the added field |
| T23 | Customer identity, credit, or financing material accumulates in AION | Prohibited fields refused by name; free text refused when it looks like a social-security or payment-card number; records default to an employer-work origin | Sales suite: ten field shapes and two text shapes refused |
| T24 | Reaching AION over a VPN is treated as being the owner | Network reachability grants nothing; a non-loopback request additionally requires a session from a console pairing; every failure mode fails closed | Access suite: unpaired device refused 401 with the shell still served |
| T25 | A pairing code or session token is captured from storage, a URL, or a log | Only SHA-256 digests are stored, compared in constant time; codes are single-use and ten-minute; bearer material is header-only; no secret reaches Activity | Access suite: state and activity greps, and a source assertion that no token is read from a query string |
| T26 | A lost phone retains access, or revoking it damages data | Sessions expire and are individually and collectively revocable; turning access off ends every session at once; revocation touches no owner record | Access suite: memories, tasks and conversations byte-identical across a revoke |
| T27 | Pairing is brute-forced | Per-peer failed-attempt counter, eight failures in fifteen minutes then a fifteen-minute block; the counter is committed even when the attempt is rejected | Access suite: twelve bad codes must produce a block |
| T28 | A phone escalates itself to console authority | Loopback is decided from the socket, never a header; a paired device cannot mint a pairing code or change access settings | Access suite and demo: both refused 403 over the wire |
| T29 | AION is exposed publicly, or configures the network on the owner's behalf | Loopback default; bind restricted to loopback or a private range; wildcards and public addresses refused; no tunnel, no port forwarding, no UPnP, and detection runs no configuring subcommand | Access suite: address validation and a source assertion on the detection module |
| T30 | A browser cache outlives a revoked session and exposes private data | The service worker caches the application shell only; every `/api/` request is network-only with no cache read or write | Access suite: path exclusion, shell allowlist, and no API path in the cache list |
| T31 | Source corruption hides a change from review | Repository-wide gate for byte-order marks, double-encoded characters, and raw control bytes, with a self-test proving the rule flags real damage and leaves legitimate Unicode alone | Source-hygiene suite |

## Residual risks

- Anything with the owner's user account can read `private/aion`. AION relies on OS file
  permissions and any disk encryption the owner has enabled; it adds no at-rest encryption for
  live state. The encrypted private backup is the portable protected form.
- A plaintext local export is exactly that: plaintext. The UI says so at the point of export.
- If the owner configures a remote provider, conversation content and any enabled memory context
  leave the machine. AION marks the provider location, requires an explicit disclosure
  acceptance, and ships no remote client of its own.
- An approved developer-agent task runs a third-party CLI that AION does not sandbox beyond the
  repository root and the absence of a shell.
- No off-site or offline rotated backup copy exists yet; this remains a standing operational gap.
