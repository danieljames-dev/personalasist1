# AION Backup Manifest Schema

Status: Operational contract, version 1  
Owner: Project AION CTO  
Produced by: `scripts/backup-aion.ps1`  
Location: `<BackupRoot>\manifests\backup-<UTC>.json`

The manifest is the machine-readable record of one backup run. It is written for
**every** run, successful or failed. A backup with no manifest is not a recovery point.

## Identity

| Field | Type | Meaning |
|---|---|---|
| `schema` | string | Fixed `aion.backup-manifest.v1`. A reader must reject an unknown schema rather than guess |
| `timestampUtc` | string | UTC run stamp, `yyyyMMddTHHmmssZ`. Ties manifest, artifacts, logs, and restore test together |
| `dryRun` | boolean | Always `false` in a written manifest — dry runs write nothing |

## Source

| Field | Type | Meaning |
|---|---|---|
| `repositorySourcePath` | string | Absolute path of the repository backed up |
| `canonicalRemote` | string | Approved remote verified before the run. A mismatch aborts |
| `branch` | string | Branch checked out at run time |
| `commitHash` | string | Full 40-character SHA. **The identity of the recovery point** — the restore test must check out exactly this |

## Artifacts

| Field | Type | Meaning |
|---|---|---|
| `mirrorPath` | string | Bare mirror. Updated in place, so it is *not* point-in-time |
| `bundlePath` | string | Immutable point-in-time bundle. Survives upstream history rewrites |
| `untrackedArchivePath` | string \| null | Archive of declared untracked files, or `null` if none |
| `includedUntracked` | string[] | Repository-relative paths deliberately archived. Empty means untracked work was **not** protected |
| `exclusions` | string[] | Patterns the tooling refuses to archive: dependencies, build output, secrets, caches, editor state |

## Integrity

| Field | Type | Meaning |
|---|---|---|
| `checksums` | object | Absolute path → lowercase SHA-256 hex. Covers the bundle and, when present, the untracked archive |

The mirror is a directory and is not checksummed; its integrity is established by
`git fsck --full` during the run and by the restore test cloning from it.

A checksum proves the artifact has not changed since it was written. It does **not**
prove authenticity — anyone who can rewrite the file can rewrite the manifest. Signing is
a separate, unapproved design.

## Verification

| Field | Type | Meaning |
|---|---|---|
| `verificationCommand` | string | Command the restore test must pass. Currently `npm run verify` |
| `restoreResult` | object \| null | Embedded `aion.restore-test.v1` result. `null` means the restore test never ran, which is itself a failure |
| `outcome` | string | `SUCCESS` or `FAILURE` |
| `failureReason` | string \| null | Exact exception message on failure |

### `restoreResult` object

| Field | Type | Meaning |
|---|---|---|
| `schema` | string | Fixed `aion.restore-test.v1` |
| `timestampUtc` | string | Matches the parent manifest |
| `mirrorPath` | string | Mirror cloned from |
| `expectedCommit` | string | Commit the clone had to check out |
| `restoreDirectory` | string | Isolated timestamped clone. Never the active repository |
| `steps` | object[] | Ordered `{step, status, detail}` — `isolation-check`, `clone`, `checkout`, `npm-ci`, `npm-run-verify` |
| `testsPassed` | integer \| null | Parsed from verify output. Must be `11` |
| `testsFailed` | integer \| null | Must be `0` |
| `outcome` | string | `SUCCESS` or `FAILURE` |
| `failureReason` | string \| null | Exact failure message |

## The success rule, as data

A manifest represents a valid recovery point only when **all** of these hold:

```
outcome                     == "SUCCESS"
restoreResult               != null
restoreResult.outcome       == "SUCCESS"
restoreResult.testsPassed   == 11
restoreResult.testsFailed   == 0
restoreResult.expectedCommit == commitHash
```

Any other combination is a failed run. A reader must not treat the presence of a bundle
and its checksum as evidence of restorability — that is exactly the failure mode this
schema exists to prevent.

## Compatibility

`schema` advances to `aion.backup-manifest.v2` on any breaking change. Additive optional
fields do not bump the version. Readers reject unknown major schemas and never infer
meaning from a field they do not recognise. Retained manifests remain readable: a change
to the tooling must not make an old manifest uninterpretable, because old manifests are
the evidence trail for old backups.

`verificationCommand` and the expected test counts are recorded per run rather than
assumed, so a manifest written before a test-count change remains self-describing.

## Worked example

Abbreviated from the first verified backup, 2026-08-06:

```json
{
  "schema": "aion.backup-manifest.v1",
  "timestampUtc": "20260806T052019Z",
  "repositorySourcePath": "C:\\Users\\...\\AION",
  "canonicalRemote": "https://github.com/danieljames-dev/personalasist1.git",
  "branch": "main",
  "commitHash": "527ba4b5490b5c60233f77dd3ac5499312eb00fd",
  "mirrorPath": "D:\\AION-backups\\repository-mirror\\AION.git",
  "bundlePath": "D:\\AION-backups\\working-snapshots\\AION-20260806T052019Z.bundle",
  "untrackedArchivePath": "D:\\AION-backups\\working-snapshots\\AION-20260806T052019Z-untracked.zip",
  "includedUntracked": ["scripts/backup-aion.ps1", "scripts/restore-test-aion.ps1"],
  "exclusions": ["node_modules", "dist/", "dist-test/", "*.tsbuildinfo", ".env", "..."],
  "checksums": {
    "D:\\AION-backups\\working-snapshots\\AION-20260806T052019Z.bundle":
      "371654f392404a8c9fb5c8a7f9a3d6f004029574f6cf3a2c1833d8d89065c86a"
  },
  "verificationCommand": "npm run verify",
  "restoreResult": {
    "schema": "aion.restore-test.v1",
    "expectedCommit": "527ba4b5490b5c60233f77dd3ac5499312eb00fd",
    "restoreDirectory": "D:\\AION-backups\\restore-tests\\restore-20260806T052019Z",
    "testsPassed": 11,
    "testsFailed": 0,
    "outcome": "SUCCESS"
  },
  "outcome": "SUCCESS",
  "failureReason": null,
  "dryRun": false
}
```

The `repositorySourcePath` is recorded so a restore knows where the backup came from. It
is a local machine path and is deliberately **not** committed to the repository — only
manifests on the backup drive contain it.
