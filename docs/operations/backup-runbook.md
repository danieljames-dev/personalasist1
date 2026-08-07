# AION Backup Runbook

Status: Operational, on-demand only  
Owner: Project AION CTO  
Approved backup root: `D:\AION-backups` (WD easystore, USB)  
Approved canonical remote: `https://github.com/danieljames-dev/personalasist1.git`  
Scheduling: **Not approved.** Run these procedures manually.

Authority: [backup strategy](backup-strategy.md). This runbook is the operator
procedure; the strategy is the design and the standing gaps.

## The one rule

**A backup is SUCCESS only after its restore test passes.** Artifacts plus checksums do
not make a recovery point. If the restore test fails, the run is FAILURE, the evidence is
kept, and the previous known-good backup remains the current recovery point.

## Before you start

1. Connect the WD easystore drive and confirm it mounts as `D:`.
2. Confirm the working tree is clean and local `main` equals `origin/main`, or know exactly which untracked files you intend to
   include. The script refuses to run otherwise — that refusal is deliberate.
3. Confirm `git remote get-url origin` matches the approved remote. The script also
   checks this and aborts on mismatch.

## Procedure — dry run

Always dry run first after any change to the scripts, the drive, or the remote.

```powershell
.\scripts\backup-aion.ps1 -DryRun
```

With untracked files you intend to archive:

```powershell
.\scripts\backup-aion.ps1 -DryRun -IncludeUntracked 'docs/operations/notes.md'
```

A dry run writes **nothing** — no directories, no logs, no evidence file. It reports the
paths it would create and exits 0. If it exits non-zero, fix the cause before proceeding.

## Procedure — real backup

```powershell
.\scripts\backup-aion.ps1
```

Expected output ends with:

```
  [restore] RESTORE TEST PASSED
  [backup] BACKUP SUCCESS - restore test passed
```

Exit code 0 means the run is a valid recovery point. Any other exit code means it is not.

The run takes a few minutes; most of it is `npm ci` in the restored clone, which
downloads dependencies from the network. It also runs the synthetic overlong-Codex-ref
regression test in the restored repository.
When the Codex control plane is present, the restore also requires `npm run control-plane:test`.
It additionally runs the explicit collection matrix and the real repository-gate regression in the
isolated clone. The latter uses synthetic ignored directives, proves correct-HEAD authorization and
wrong-HEAD refusal, and never restores or executes a real pending directive.
Phase 3 restores also run `npm run privacy-boundary:test`, including path/link/network checks and a
synthetic proof that `private/` cannot be selected as untracked working data.
Phase 8 restores additionally run the Identity, Object, career-input, career-evidence, and
`npm run job-posting:test` focused regressions. The Job Posting suite uses only neutral synthetic
temporary input and Object stores and must leave no permanent `private/career` or
`private/object-store` state.

## Procedure — standalone restore test

To re-prove an existing mirror without creating new artifacts:

```powershell
.\scripts\restore-test-aion.ps1 -ExpectedCommit <full-40-char-sha>
```

Each run creates a **new** timestamped directory under `restore-tests\`. It never
restores over the active working repository, and it refuses if the target already exists.

## What gets written

```
D:\AION-backups\
    repository-mirror\AION.git                  verified canonical durable-ref mirror
    repository-mirror\staging\                  timestamped candidates during validation
    repository-mirror\quarantine\               preserved prior mirrors
    working-snapshots\AION-<UTC>.bundle         immutable point-in-time bundle
    working-snapshots\AION-<UTC>-untracked.zip  declared untracked files only
    manifests\backup-<UTC>.json                 machine-readable run record
    logs\backup-<UTC>.log                       run log
    logs\restore-<UTC>.result.json              restore-test verdict
    logs\restore-<UTC>.{npm-ci,verify}.*.log    captured tool output
    restore-tests\restore-<UTC>\                isolated proof clone
    releases\                                   reserved, see strategy §5
    databases\                                  reserved, no engine approved
```

Nothing is ever deleted automatically. Prior backups, restore-test directories, and
failure logs accumulate until pruned deliberately.

Ignored `.aion-local/` directives, handoffs, prompts, and logs and everything beneath `private/`
are never accepted as declared untracked working-data archives. They are absent from bundles,
untracked archives, included-working-file manifests, and restore expectations. Tracked
control-plane source remains protected through Git history; local run state does not enter
code/documentation backups.

## Ref policy and mirror replacement

The code backup includes only `refs/heads/*`, `refs/tags/*`, and intentionally used
`refs/notes/*`. It excludes every other namespace, including `refs/codex/*`, because editor and
agent checkpoints are local recovery metadata rather than canonical AION source history. The
manifest records included ref names, excluded namespace counts, the total excluded count, and the
longest excluded ref length without logging unreadably long names.

The mirror comes from the approved canonical origin. The bundle comes from the active local
repository. Both use the durable allowlist; neither uses `--all` or a catch-all mirror refspec.

For every real run, the script:

1. creates a timestamped bare candidate under `repository-mirror\staging\`;
2. configures only durable refspecs and fetches from the approved origin;
3. verifies object integrity, exact `main`, absence of `refs/codex/*`, and independent cloning;
4. moves the existing mirror intact into `repository-mirror\quarantine\`; and
5. installs the verified candidate as `repository-mirror\AION.git`.

If validation or replacement fails, the candidate, prior mirror, manifest, and logs remain
failure evidence. Recover by selecting the newest mirror whose manifest and restore result are
`SUCCESS`; never relabel a failed run. Adding any future durable custom namespace requires a
reviewed update to the policy helper, manifest contract, strategy, runbook, and regression test.

The historical failure manifest
`D:\AION-backups\manifests\backup-20260806T163039Z.json` records the catch-all-refspec failure.
No source data was lost: commit `5d4599873569cfbfbea68ae6999f44c4cf1a6627` was already pushed,
the working tree remained clean, and earlier verified recovery points remained available.

Run the policy regression directly with:

```powershell
npm run test:backup-refs
```

It creates only a temporary synthetic repository, adds a deliberately long
`refs/codex/turn-diffs/checkpoints/*` ref, proves durable mirror/bundle recovery, and removes the
temporary repository after success. Failure evidence is preserved for diagnosis.

## Refusals and what they mean

| Message | Cause | Action |
|---|---|---|
| `Not a Git repository root` | `-RepositoryPath` is wrong | Point at the repository root |
| `Repository root mismatch` | Running from a subdirectory or a symlinked path | Run from the true root |
| `Remote mismatch` | `origin` is not the approved canonical remote | Do not override. Confirm which repository is canonical first |
| `Refusing to back up a dirty working tree` | Staged or modified tracked files | Commit or revert. A backup of half-finished work is not a recovery point |
| `Undeclared untracked files present` | Untracked files exist that were not named | Name them with `-IncludeUntracked`, or remove them |
| `matches forbidden pattern` | A declared file is a secret, dependency, build output, or editor state | Do not archive it. Fix the declaration |
| `Restore directory already exists` | Timestamp collision | Re-run; the timestamp advances |
| `Refusing to restore into the active working repository` | `-RestoreTestsRoot` points inside the live repo | Correct the path. This guard prevents destroying live work |
| `expected 11 passing tests, observed …` | The restored clone does not verify | **Investigate before trusting any backup.** Do not record success |

## Do not pipe the script's output

Run the scripts **directly**. Do not pipe them through `Select-String`, `Tee-Object`,
`Out-File`, or any other command:

```powershell
.\scripts\backup-aion.ps1                          # correct
.\scripts\backup-aion.ps1 | Select-String 'SUCCESS' # WRONG - will fail the run
```

Piping causes Windows PowerShell 5.1 to merge the native `git` command's stderr into the
success stream. Git writes ordinary progress there — `From C:\...`, `Cloning into...` — and
under `$ErrorActionPreference = 'Stop'` those lines become terminating errors. The run aborts
partway with a message like `FAIL: From C:\Users\...` and is recorded as FAILURE.

Observed on 2026-08-06: a piped run of commit `d3ec67c` failed at the mirror-update step; the
identical unpiped run immediately afterwards succeeded with a passing restore test. The script
behaved correctly — it recorded FAILURE, retained the evidence, and did not relabel — but the
failure was an artefact of invocation, not of the backup.

If you need the output saved, redirect the whole invocation from outside PowerShell, or read
`logs\backup-<UTC>.log` afterwards.

## Reading `git fsck` output

The mirror integrity check prints `dangling blob …` lines. These are **informational**,
not errors — they are unreferenced objects left by ordinary Git operations. The check
fails only on a non-zero exit code, which aborts the run. Missing or corrupt objects
would appear as `missing`, `broken link`, or `error`, and those are real.

## After a successful run

For the Career milestone, success additionally means the isolated exact-HEAD clone passed Job
Matching, Application Preparation, Career CLI, and `npm run career:demo`. The demo must show export
reload plus deterministic `already-completed` reruns and leave no `private/` state in the restored
repository. The source mirror and bundle continue to exclude real/private career inputs and local
exports; they back up source and documentation only.

For the AION V1 milestone, success additionally means the isolated clone passed `npm run aion:test`
and `npm run aion:demo`. The V1 demo must show the loopback Command Center starting, a one-shot
approval gating capability execution, the encrypted private backup verifying, the Career screen
driving the accepted Career engine, a restart reloading identical state, and a byte-identical
rerun. It must leave no `private/` or `private\aion` state in the restored repository. Assistant
state, local exports, and encrypted private backups are never included in a source backup.

Record in the drive log or asset register: date, commit hash, manifest path, and restore
result. Then safely eject the drive through **Safely Remove Hardware** before
disconnecting. Do not leave the drive permanently mounted — a permanently attached backup
drive is reachable by the same ransomware that reaches the workstation.

## After a failed run

1. Do **not** record success anywhere.
2. Keep every log and the manifest — the failure evidence is the point.
3. Confirm the previous known-good backup is still present and still passes a standalone
   restore test.
4. Diagnose from `logs\restore-<UTC>.verify.err.log` and `…npm-ci.err.log`.
5. A restore-test failure with a healthy working repository usually means the backup is
   bad. A failure that also reproduces in the working repository means the *repository*
   is bad — treat it as repository corruption per the strategy, and do not update the
   mirror, which would carry the fault forward.

## Standing gaps

- **No off-site copy and no offline rotated copy.** One drive is approved, so
  single-site loss remains unmitigated. Strategy §3 requires a second drive.
- **Scheduling is not approved.** Every run is manual, so the real RPO is "time since
  someone last ran this," not 24 hours.
- **No encryption is enforced by the tooling.** BitLocker To Go on the drive is an
  operator responsibility; the scripts do not verify it.
- **`databases\` is empty and reserved.** No database engine is approved, so no
  application data is protected by this procedure yet.
