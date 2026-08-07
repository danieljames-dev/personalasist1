# AION Command Center

Status: Reference Candidate. Local-first, loopback-only, offline by default.

## Launch

```text
npm run aion
```

AION prints `http://127.0.0.1:31415`. Open that address in a browser on this computer. Nothing is
exposed to the LAN or the internet. `Ctrl+C` stops it cleanly.

Optional arguments: `--port <0-65535>` and `--data-root <absolute path ending in private\aion>`.

The complete synthetic product proof is:

```text
npm run aion:demo
```

It runs the whole product through the real loopback API twice in temporary directories, proves a
restart reloads identical state, proves a second run is byte-identical, drives the accepted Career
engine, and removes everything afterwards. It uses no owner data, no account, no live provider,
and no network.

## First use

The welcome screen explains where data is stored, what a remote provider would receive, and how
imports and approvals work. Choosing **Start with the offline provider** completes onboarding and
unlocks the ten areas. No source file ever needs editing.

## Areas

- **Chat** — conversations with local history, rename, archive, delete, per-conversation memory
  context, cancellation, and streamed provider output. With the offline provider, `propose: …` and
  `remember: …` exercise the proposal path end to end.
- **Tasks** — create, edit, prioritise, tag, and move through a validated state machine with
  complete history and provenance.
- **Routines** — name, instructions, interval, enablement, next/last run, and history. The
  scheduler runs every 30 seconds **only while AION is open**. No Windows service or startup task
  is installed.
- **Memory** — create, search, correct with preserved history, confirm, disable, forget, and
  export. Conflicting memories about one subject are both kept and flagged.
- **Planner** — a goal with ordered steps, dependencies, required capabilities, approval flags,
  and expected outputs. A plan is a proposal; accepting it allows conversion into Tasks.
- **Approvals** — the capability registry plus every approval and agent action. One decision
  authorises one capability and one input digest, once.
- **Activity** — the local audit history, retained for the window set in Settings.
- **Career** — runs the accepted Career engine: initialize, ingest evidence, build a profile,
  import a Job Posting you supply, match transparently, prepare owner-review materials, export.
  Dry run is checked by default. There is no discovery, browsing, submission, or email.
- **Imports** — dry-run inventory of a ChatGPT, Claude, Grok, or Career selection you choose, with
  exact digests, duplicate detection, provenance, cancellation, and a separate execute step.
- **Settings** — provider and model, remote disclosure, memory context, scheduler, approval
  defaults, retention, credential variable *name*, import roots, export root, encrypted backup,
  complete local export, and data locations.

## Model providers

Three provider slots ship:

| Provider | Location | State |
| --- | --- | --- |
| `deterministic` | local | Ready. Offline, no network, used by every test and the demo. |
| `remote-generic` | remote | Boundary only. Reports unavailable until an approved adapter and a session credential exist. |
| `local-model` | local | Boundary only. Reports unavailable until a local runtime is configured. |

Selecting a remote provider requires accepting the disclosure that the conversation and any
enabled memory context leave this computer. AION stores the **name** of the environment variable
holding a credential and never the value; nothing is written to Git or to a source backup.

## Where data lives

| Content | Location |
| --- | --- |
| Conversations, memories, tasks, routines, plans, approvals, activity, import reports, settings | `private/aion/state-v1.json` |
| Local exports and encrypted private backups | `private/aion/exports/` |
| Career workspace | the explicit root you pass to a Career command |

`private/` and `.aion-local/` are Git-ignored and excluded from source backups. Source backups
contain code and documentation only.

## Encrypted private backup

Settings → **Encrypted private backup** writes an AES-256-GCM envelope with a scrypt-derived key,
random salt and nonce, authenticated metadata, and an embedded digest. AION decrypts and compares
immediately after writing, so a backup that cannot be restored is never reported as written. The
passphrase requires twelve characters and is never stored or logged — if you lose it the backup is
unrecoverable. Destinations must sit inside the export root. There is no cloud synchronisation.

## Developer-agent bridge

If a supported Codex CLI executable is installed, AION exposes it as the approval-gated
`aion.developer.task.v1` capability, pinned to this repository root and run without a shell.
Discovery checks a short fixed list of documented install locations and an optional
`AION_DEVELOPER_AGENT_PATH` override; it never scans the computer, and it ignores Windows npm
shell shims on purpose. When nothing suitable is found, Settings and Approvals say so plainly.

## Verification

| Command | Covers |
| --- | --- |
| `npm run aion:test` | Domain, architecture boundary, and Command Center app suites |
| `npm run aion:server:test` | Command Center HTTP and developer-agent discovery suites |
| `npm run aion:demo` | The complete synthetic product proof |
| `npm run verify` | The whole repository quality gate |
