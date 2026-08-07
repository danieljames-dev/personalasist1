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
  context, cancellation, and streamed provider output. With the offline provider, `propose: …`,
  `remember: …`, and `developer: …` exercise the proposal path end to end.
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
  Dry run is checked by default. Run `init` first; evidence files and Job Postings must then sit
  inside `<workflow root>\private\input\`, which is where `init` writes blank templates and the
  only place the engine will read from. There is no discovery, browsing, submission, or email.
- **Imports** — dry-run inventory of a ChatGPT, Claude, Grok, or Career selection you choose, with
  exact digests, duplicate detection, provenance, cancellation, and a separate execute step.
- **Settings** — provider and model, remote disclosure, memory context, scheduler, approval
  defaults, retention, credential variable *name*, developer-agent bridge selection and health,
  import roots, export root, encrypted backup, complete local export, and data locations.

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

## Developer-agent bridges

AION supports two local developer agents and exposes whichever ones are installed as the single
approval-gated `aion.developer.task.v1` capability, pinned to this repository root and run without
a shell.

| Bridge | Discovered at | Owner override |
| --- | --- | --- |
| Claude Code CLI | the native install location in your local `bin` directory | `AION_CLAUDE_CODE_PATH` |
| Codex CLI | the documented npm vendor executable locations | `AION_DEVELOPER_AGENT_PATH` |

Discovery checks a short fixed list per CLI with one `stat` each; it never scans the computer, and
it ignores Windows npm shell shims and bare script entry points on purpose. **Settings → Developer
-agent bridge** chooses which one AION uses; an unknown selection is refused rather than silently
replaced. When nothing suitable is found, Settings and Approvals say so plainly.

Every task is **read-only** unless you approve a `workspace-write` boundary. The boundary is part
of the approval digest, so a read-only approval can never be spent on a writing run, and an
unstated boundary is read-only. Your instruction is written to the agent's standard input and never
becomes a command-line argument; Settings shows the exact argument vector each bridge would use so
you can read the real command before approving.

Settings reports installation and account health separately — a program that exists is not the same
thing as an account you can use. **Check developer-agent account health** asks each installed CLI
whether it is signed in. That is a local question and never a paid call, and AION reads only the
sign-in flag: your address, organisation, and plan are never parsed or stored. Remaining credit is
not shown, because determining it would require a paid call.

In **Chat**, `developer: <question>` with the offline provider prepares a read-only developer-agent
task for your approval — the model can only propose, and nothing runs until you approve it.

## Workspaces

A switcher at the top of the screen moves between **Personal** and **Work**. Records join the
workspace they were created in and never move on their own. Memory context, search, and conflict
detection all stay inside one workspace. You supply the Work label yourself.

## Sales

Built for a phone on a sales floor. The floor view leads with today -- appointments, follow-ups
due, overdue callbacks -- then the next relationship with Open and Call Prep, then six quick
actions that open inline: add prospect, note, follow-up, appointment, coach, metrics. Tabs cover
TODAY, FOLLOW-UPS, APPOINTMENTS, PROSPECTS, COACH and METRICS.

Opening a person shows stage, interest, last contact and next action, one-tap actions, and the
durable timeline. Nothing is ever overwritten: every stage change, note, appointment and outcome
appends. AION refuses identity, credit, banking and financing details, and stores only what you
enter and are permitted to keep.

Coaching is deterministic and offline. It never states a price, payment, rate, incentive, stock
level, or dealership policy -- it marks those for you to confirm. Drafts are drafts: AION sends
nothing. Metrics are your own counts, never a CRM figure.

## Verify

AION runs a fixed allowlist of read-only commands itself and hands the evidence to a read-only
developer agent for analysis. That is how "what is failing?" gets answered without giving an agent
a shell or write access.

## Private phone access

Off by default; AION binds `127.0.0.1`. Turning it on in Settings lets you create a one-time
pairing code, valid for ten minutes and usable once. Type it on the phone. A private network is not
enough on its own -- a device must be paired. Sessions expire, can be revoked individually or all
at once, and revoking one changes none of your data. AION never opens a public port, creates a
tunnel, or touches your router. Add AION to your home screen for a full-screen app; only the shell
is cached, never your data.

## Verification

| Command | Covers |
| --- | --- |
| `npm run aion:test` | Domain, architecture boundary, and Command Center app suites |
| `npm run aion:server:test` | Command Center HTTP and developer-agent discovery suites |
| `npm run aion:demo` | The complete synthetic product proof |
| `npm run verify` | The whole repository quality gate |
