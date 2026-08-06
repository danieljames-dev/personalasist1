# Local path boundary v1

`@aion/privacy-boundary` defines `ApprovedRootV1`, `ExplicitInputPathV1`,
`PathAuthorizationRequestV1`, `PathAuthorizationResultV1`, `PathBoundaryErrorV1`, and
`LocalOperationRecordV1`.

Requests provide an operation, a named absolute approved root, and one absolute requested path.
Relative paths, empty or padded values, NULs, UNC paths, Windows device namespaces, cross-volume
paths, traversal, sibling-prefix bypasses, root-as-target by default, and canonical link escapes are
rejected. Windows comparisons are case-insensitive. The root itself is accepted only when
`allowApprovedRoot` is explicitly true.

Input-file policy accepts the final extension `.json`, `.md`, or `.txt`, case-insensitively, and
requires an existing regular file. PDF, DOCX, images, OCR, archives, email, browser, and cloud inputs
are unsupported. Phase 6 composes this policy for explicit non-ingesting preflight, adding strict
UTF-8, BOM, NUL, size, and contract checks. The privacy package itself still reads or parses no
owner files.

Operation records contain IDs, operation, approved-root reference, explicitly supplied relative
path, timestamp, a nullable actor-reference placeholder, dry-run state, outcome, counts, stable
reason codes, and policy version. They never contain file contents and are not Identity or
authentication records. Records are local private runtime data and are not committed.
