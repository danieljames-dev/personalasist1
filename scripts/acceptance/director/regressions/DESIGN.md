# Deployment truth + Windows host identity (oracle freeze)

See also `docs/research/director-deployment-truth-and-host-identity.md` if present.

A boolean deploy latch is not sufficient. Required enum:

`NOT_STARTED | MAY_HAVE_WRITTEN | VERIFIED_OLD_PRODUCTION | VERIFIED_TARGET_PRODUCTION | VERIFIED_UNEXPECTED`

Latch `MAY_HAVE_WRITTEN` before process launch. Only production-observation events may clear uncertainty. Inconclusive verification stays `MAY_HAVE_WRITTEN`. Completion forbidden while uncertain, unexpected, or post-deploy incomplete.

Host identity: classify → resolve existing (`realpath.native`) → typed identity. Accepted classes: absolute drive, well-formed UNC. Reject drive-relative, driveless root, relative, devices (even if `stat` works), ADS, NUL, malformed UNC. No containment root means deny.

WORKTREE/PREVIEW = existing FS identity. BRANCH = repo+ref. INTEGRATION and PRODUCTION_WRITER = logical singletons. Future locks derive from an existing parent.
