# D2 / D4 safety properties (oracle freeze)

## Discovery

Claude: `AION_CLAUDE_CODE_PATH` → highest comparable VS Code `anthropic.claude-code-*-win32-*/resources/native-binary/claude.exe` → unique PATH `claude.exe` (not `.cmd`) → `%USERPROFILE%\.local\bin\claude.exe` → UNAVAILABLE.

Multiple incomparable natives or multiple PATH hits → UNAVAILABLE (fail closed).

Grok: `AION_GROK_PATH` → `%USERPROFILE%\.grok\bin\grok.exe` → unique PATH `grok.exe` → UNAVAILABLE.

Observed on this host (2026-08-13):

- Claude `2.1.231` native-binary `--version` works. `-p/--print` exists. `claude -p <file>` without login exits 1: `Not logged in · Please run /login`. Missing cwd is spawn ENOENT (validate cwd first). `CLAUDE_CODE_SIMPLE=1` help is a short banner and is **not** a complete capability catalog.
- Grok `1.0.3`: `-p` is `--single <PROMPT>` and **requires** the prompt argument. `grok -p --prompt-file FILE` is the wrong shape (`--single` starved). Use `--prompt-file PATH` without `-p`, plus `--cwd`, `--output-format`, `--json-schema`, `--permission-mode dontAsk`.

## Spawn

`spawn(absoluteExe, argvArray, { shell: false, windowsHide, cwd })`. Prompt is a file the Director wrote. Prompt bytes never enter a command line string.

## Process identity

`{ pid, creationDate, executablePath, runNonce }`. PID reuse = same pid, different creationDate. Orphan = nonce/exe mismatch or parent dead and child still running.

## Cancel

SOFT (5s): terminate the tracked root.  
HARD (10s): `TerminateJobObject` (D2 requirement) / oracle stand-in `taskkill /T /F`.  
CHILD_TREE: assign the executor tree to a kill-on-close Job Object at spawn. `child.kill()` is not enough.  
ORPHAN: after cancel, scan by `AION_RUN_NONCE` and recorded creation time; kill leftovers.

## Handoff success

Conjunction: exited + known code 0 + parseable handoff + matching mission/run/work item + artifacts inside run root + independent Git agrees + spend 0 + production claim agrees. Exit 0 alone is not success.

## Durable run record

`RUNS/<runId>/` holds prompt.md, command.json (exe+argv+cwd+nonce, no secrets), stdout/stderr logs (bounded), handoff.json, git-before.json, git-after.json, process-identity.json. Reboot answers: supposed to run, started, still running, target tree, Git changed, handoff present.

## Capacity vs lease

Both must pass. Capacity never bypasses a typed resource key. Lease never bypasses executor concurrency.

## Host lock

Exclusive create (`wx`) of `locks/<typedKey>.lock` containing identity. Two Node processes. Stale: identity mismatch, or pid absent *twice* **and** creationDate was recorded. Not: lock exists forever. Not: pid missing ⇒ mine.

## Recovery

Missing completion record ≠ repeat the action. Especially never second deploy. Reattach if identity still alive. Otherwise INTERRUPTED + verify Git/artifacts/production truth.

## Logs

Live 256 KiB, file 8 MiB, run 16 MiB then halt/kill. Keep tail + truncation marker. Redact tokens.
