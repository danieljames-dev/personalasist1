# Personal data boundary threat model

## Assets and trust boundary

Future owner-selected files and derived local records are sensitive. The approved local root is the
filesystem trust boundary; repository paths, backups, logs, networks, and inferred owner locations
are outside it.

## Threats and controls

- Traversal and sibling-prefix bypass: normalize absolute paths and compare whole path components.
- Cross-volume, UNC, and device paths: reject before filesystem access.
- Symlink, junction, and reparse escape: resolve the approved root and nearest existing component;
  reject a canonical destination outside the root. Internal directory links may remain contained.
- New destinations: resolve the nearest existing parent and validate the unresolved tail.
- Data leakage: return stable reason codes without path or content values; keep records under
  ignored local storage.
- Accidental Git or backup inclusion: `private/` is ignored and is a forbidden backup pattern.
- Hidden egress: production privacy code has an import boundary prohibiting network, telemetry,
  analytics, browser, model-provider, and cross-subsystem dependencies.

## Residual risk

This is not a complete filesystem sandbox. A path can change after authorization (TOCTOU), a mount
or reparse point can be swapped, and OS permissions remain authoritative. Callers must recheck
immediately before significant writes, use least-privilege handles where available, and avoid
assuming a prior result remains valid. Static import scanning cannot prove that every future runtime
path lacks network behavior. File-symlink creation was unavailable under the test account; the same
canonical containment branch is covered by directory-link/junction tests and deterministic path
tests, but the unavailable OS capability is not claimed as demonstrated.
