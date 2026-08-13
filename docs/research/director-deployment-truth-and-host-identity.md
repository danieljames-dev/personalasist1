# Director — deployment truth and Windows host identity

Oracle / design freeze. Not Claude runtime. Not the 95-gate catalog.

## Deployment truth

A boolean latch is **not** sufficient.

- Latch that never clears: cannot retry after proof that production is still the old SHA.
- Latch that clears on INTERRUPTED / BLOCKED / PLANNING: the demonstrated second-deploy family.

```text
deploymentTruth =
  NOT_STARTED
  | MAY_HAVE_WRITTEN
  | VERIFIED_OLD_PRODUCTION
  | VERIFIED_TARGET_PRODUCTION
  | VERIFIED_UNEXPECTED
```

`DEPLOY_STARTED` writes `MAY_HAVE_WRITTEN` **before** process launch.

Only production-observation events may leave `MAY_HAVE_WRITTEN`:

| Observation | Next truth | Another deploy later | Mission |
| --- | --- | --- | --- |
| production still old SHA | VERIFIED_OLD_PRODUCTION | yes, from READY_FOR_DEPLOYMENT | not complete |
| production at intended SHA | VERIFIED_TARGET_PRODUCTION | no | POST_DEPLOY_VERIFY |
| production at unexpected SHA | VERIFIED_UNEXPECTED | no | BLOCKED |
| process unavailable / checkout unreadable / ambiguous | stays MAY_HAVE_WRITTEN | no | BLOCKED (still uncertain) |

Director death ≠ deployment failure.

`MISSION_COMPLETED` is illegal while `MAY_HAVE_WRITTEN`, `VERIFIED_UNEXPECTED`, or required post-deploy verify is incomplete.

## Host path

Three functions, not one:

1. `classifyHostPath` — syntax class. Positive permission.
2. `resolveExistingHostPath` — `fs.realpathSync.native` + reclassify. Fail-closed.
3. `hostResourceIdentity` / typed `resourceIdentity` — lock key.

Accepted identity classes: `ABSOLUTE_DRIVE`, `UNC_ABSOLUTE` (well-formed, after resolution when the resource exists).

`\\?\C:\...` may be *peeled* and then resolved. It is not itself an accepted class. `\\.\NUL` must stay rejected even when `stat` succeeds (observed on this host).

Rejected: drive-relative (`C:foo`), rooted driveless (`\Users\...`), relative, NUL, reserved devices (including `NUL.txt`, `CON.`, namespace forms), ADS extra-colon, malformed UNC.

Typed resources: WORKTREE/PREVIEW = existing FS identity; BRANCH = repo+ref; INTEGRATION / PRODUCTION_WRITER = logical singletons.

Containment: no root ⇒ deny. Sibling `C:\foo` vs `C:\foobar` is outside. Naive prefix on slash-folded strings is not containment.
