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
| T11 | The developer agent modifies files outside the repository or runs arbitrary shell text | Reached only as an approval-gated capability; one pinned approved root; `shell: false` with an argument vector; Windows shell shims ignored | Domain and app suites: foreign root refused, approval required, shim exclusion |
| T12 | Discovery of the developer agent becomes a computer scan | A short fixed candidate list, one `stat` each, owner override must be absolute | App suite: candidate list bounded, absolute, executable-only |
| T13 | A routine silently gains persistence on the machine | The scheduler is in-process only and stops with AION; no service or startup task is installed | Domain suite: scheduler honours enablement and the setting |
| T14 | Unbounded requests or responses exhaust memory | 1 MiB request cap, 16 MiB state cap, 100 000-character message cap, import file and byte caps, capability timeouts and retry limits | Server suite: oversized body rejected |
| T15 | Concurrent writes interleave and corrupt state | One serialized write queue plus expected-revision checks and atomic rename | Domain suite: revision conflict detection |

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
