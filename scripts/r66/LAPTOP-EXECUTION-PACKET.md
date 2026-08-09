# R6.6 LAPTOP EXECUTION PACKET — DINGY (PRIMARY / SOURCE)

**Paste this entire file as ONE prompt into Grok Build on the laptop.**  
**Owner does not run individual PowerShell commands.**  
**Do not move the external drive until this packet prints SAFE TO DISCONNECT = YES.**

---

## ROLE

You are GROK_BUILD on laptop **DINGY**.

Canonical laptop repository (expected):

`C:\Users\nearm\cd\AION`

If that path does not exist, discover the real AION monorepo path that has
origin `https://github.com/danieljames-dev/personalasist1.git` and use it as
`LAPTOP_REPO`. Do not invent a second clone without recording it.

External recovery root (expected before move):

`D:\AION-backups`

Desktop target (do not write on desktop from laptop):

`DESKTOP-INLAQJQ` / `C:\AION-HQ` / HEAD baseline was `469f59108918847e0fd1af68008693330d381b40`

Directive:

`AION-V1.3-R6.6-REAL-DESKTOP-MIGRATION-AND-PRIMARY-CUTOVER`

Owner has authorized R6.6 once. Run the **entire laptop phase** autonomously.
No per-command Owner prompts. Do not answer UAC yourself. Do not spend money.
Do not touch `C:\Users\nearm\all-projects-API`, browser passwords, or commercial
credential stores.

## HARD ORDER

1. PREFLIGHT  
2. FREEZE  
3. FINAL SNAPSHOT (code + private if present)  
4. VERIFY SNAPSHOT (hard gate)  
5. DEMOTE WRITER  
6. PROVE LAPTOP CANNOT WRITE  
7. WRITE EVIDENCE BUNDLE TO D:\AION-backups\r66-cutover\  
8. PRINT MOVE-DRIVE BANNER ONLY IF ALL GATES PASS  

Never demote before verified snapshot. Never request drive move before demotion proof.

## 1. PREFLIGHT

Record without secrets:

- hostname, whoami, OS
- LAPTOP_REPO absolute path
- git branch, full HEAD, origin URL, ahead/behind, porcelain, stash
- whether private state exists: `<LAPTOP_REPO>\private\aion\state-v1.json` (boolean only)
- writer authority files if present (paths only, no key material):  
  `writer-authority-v1.json`, authority anchor roots under private/
- identity private roots if present (paths only)
- D: volume label, free space, that `D:\AION-backups` exists or create structure per runbook
- disk free space on C: and D:

If origin is not the canonical GitHub URL: STOP.

If working tree is dirty with unexplained changes: STOP and report; do not discard.

If laptop HEAD differs from desktop 469f591: **preserve** that state — do not reset.
Record both HEADs. Prefer freeze of actual laptop HEAD. If laptop has unpushed
forward commits that belong in AION, push only if clean ordinary forward commits
and origin is reachable; never force-push.

Write: `D:\AION-backups\r66-cutover\01-laptop-preflight.json`

## 2. FREEZE

Stop real mutable AION workload safely:

- stop AION Command Center / node production listeners for AION if running (do not kill unrelated apps)
- do not destroy state
- no new production mutations after freeze timestamp

Record:

- freezeTimestampUtc
- machineId/hostname
- repo HEAD
- authority/writer status (boolean + state name only)
- private-state inventory: file names/sizes/hashes of **non-secret** metadata only  
  (state-v1.json size + sha256 of file is OK; never print contents or passphrases)
- continuity versions if present

Write: `D:\AION-backups\r66-cutover\02-laptop-freeze.json`

## 3. FINAL SNAPSHOT

### 3a Code / Git durable backup (required)

From LAPTOP_REPO with clean tree (or after recording intentional untracked allowlist
excluding private/ and credentials):

```powershell
Set-Location <LAPTOP_REPO>
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\backup-aion.ps1
```

Require exit 0 and log line RESTORE TEST PASSED / BACKUP SUCCESS.

Do **not** delete older generations under D:\AION-backups.

Capture:

- newest `manifests\backup-*.json` SUCCESS
- bundle path + sha256
- restore test result path

### 3b Private continuity backup (if private state exists)

If `private\aion\state-v1.json` exists:

- Create encrypted private backup under  
  `D:\AION-backups\r66-cutover\private\`  
  using accepted `NodePrivateBackupV1` / AION `backup.create` path.
- Owner may need to supply the **private backup passphrase once** for encryption
  (not routine commands). Never log the passphrase.
- Build a non-secret `migration-manifest.v1.json` with:
  - source role primary, actual laptop systemInstanceId if known
  - actual origin + full HEADs
  - codeBackup backupId + bundleSha256
  - privateBackup digests/revision (no secrets)
  - cutover.state = frozen
  - authority snapshot descriptive only (does not grant rights)

If private state is **absent**:

- Record `PRIVATE_STATE_PRESENT = NO`
- Code backup alone is the final freeze snapshot for migration of code continuity
- Do not invent synthetic owner private data

### 3c Identity (if present)

If identity private root exists and accepted transfer policy allows cold-copy-empty-target-only:

- export via identity CLI to explicit approved private export under r66-cutover (not secrets to console)

Exclude commercial credentials always.

Write: `D:\AION-backups\r66-cutover\03-final-snapshot.json`

## 4. VERIFY FINAL SNAPSHOT (HARD GATE)

Must all be true before demotion:

- [ ] Code backup manifest SUCCESS
- [ ] Bundle exists and sha256 matches
- [ ] Restore test PASS (backup-aion already runs one; keep evidence)
- [ ] If private present: decrypt/restore test into **TEMP isolated** path under  
      `D:\AION-backups\restore-tests\r66-private-<utc>\` using cold-restore rules  
      (empty destination, no overwrite). Delete or quarantine temp after digest match.
- [ ] Do not expose secrets in logs

If any fail: **STOP**. Do not demote. Do not print MOVE DRIVE.

Write: `D:\AION-backups\r66-cutover\04-snapshot-verify.json` with  
`FINAL_SNAPSHOT_VERIFIED` true/false.

## 5. LAPTOP WRITER DEMOTION

Only if FINAL_SNAPSHOT_VERIFIED = YES.

Use the **accepted Owner Authority V2 / writer-authority protocol** already in the
repository. Do not improvise dual writers.

Required outcomes:

- Apply owner authority command path that results in laptop **not** WRITER  
  (set-read-only or revoke / QUIESCENT per actual architecture present on disk).
- If no real writer grant/anchor exists (authority already fail-closed READ_ONLY):
  - Record `LAPTOP_WRITER_WAS_ABSENT = YES`
  - Still record explicit demotion/ledger evidence that laptop is **not** entitled to write
  - Do not create a new writer on laptop

Record authority epoch, digest fingerprints (not private keys), directive id  
`AION-V1.3-R6.6-REAL-DESKTOP-MIGRATION-AND-PRIMARY-CUTOVER`.

Write: `D:\AION-backups\r66-cutover\05-laptop-demotion.json`

## 6. PROVE LAPTOP CANNOT WRITE

Independently prove:

- `LAPTOP_WRITER_ACTIVE = NO`
- `LAPTOP_CAN_PRODUCTION_WRITE = NO`

Methods:

- Load authority runtime / assertWritable must fail closed
- Attempt a harmless durable mutation through production path must refuse
- Do not erase laptop; leave recoverable

Write: `D:\AION-backups\r66-cutover\06-write-refusal.json`

## 7. EVIDENCE CHECKLIST FILE

Write `D:\AION-backups\r66-cutover\LAPTOP-PHASE-COMPLETE.json`:

```json
{
  "LAPTOP_FROZEN": true,
  "FINAL_SNAPSHOT_CREATED": true,
  "FINAL_SNAPSHOT_VERIFIED": true,
  "RESTORE_TEST": "PASS",
  "LAPTOP_WRITER_DEMOTED": true,
  "LAPTOP_WRITE_REFUSAL_PROVEN": true,
  "PRIVATE_STATE_PRESENT": true/false,
  "LAPTOP_HEAD": "<40-char>",
  "CODE_BACKUP_ID": "...",
  "SAFE_TO_DISCONNECT_FROM_LAPTOP": true,
  "credentials_touched": false,
  "all_projects_api_touched": false,
  "vast": false,
  "spend_usd": 0
}
```

Only if every field is truly satisfied, print exactly:

```
============================================================
MOVE THE EXTERNAL DRIVE TO THE DESKTOP NOW
============================================================
SAFE TO DISCONNECT FROM LAPTOP = YES
```

Also copy a short README for desktop:

`D:\AION-backups\r66-cutover\DESKTOP-NEXT.md` stating desktop must detect volume by
structure (not assume D:), restore, validate, then acquire writer / promote PRIMARY.

## 8. FORBIDDEN ON LAPTOP

- dual writer
- wipe laptop / format D:
- delete historical backups
- migrate all-projects-API / commercial credentials
- Vast / spend
- force-push / reset --hard / rewrite history
- begin R7

## 9. WHEN DONE

Leave laptop powered with evidence on the external drive.  
Owner physically moves the drive to DESKTOP-INLAQJQ.  
Desktop Grok continues R6.6 automatically after drive detection.

STOP after MOVE banner (or STOP with FAILED evidence if gates fail).
