# Career Input Preflight

Status: Sprint 3 Phase 6 reference implementation

`preflightCareerInputV1` performs explicit validation only. Its request names one absolute approved
root and one absolute file path; it never discovers a root, enumerates directories, searches for
candidate files, or infers a home or common user folder.

The preflight:

1. validates the closed version-1 request;
2. applies the Phase 3 approved-root boundary and immediately rechecks the resolved path;
3. opens one existing regular file read-only;
4. enforces the inclusive 4 MiB raw-input limit before and after reading;
5. accepts only `.json`, `.md`, or `.txt` by the final extension, case-insensitively;
6. requires strict UTF-8 without a BOM or NUL bytes; and
7. validates JSON with the accepted ACJ-1 parser and the matching career contract.

Markdown and text evidence are decoded only to establish valid UTF-8. Their contents are not
normalized, returned, summarized, inferred from, copied, or persisted. The result exposes only
kind, extension, byte count, encoding/BOM status, contract version where relevant, stable safe
error information, and fixed flags confirming no content/path return, ingestion, persistence, or
network action. It never exposes the full selected path or document body.

Unsupported encodings, multi-extension tricks, traversal, cross-volume/device paths, links or
reparse points escaping the approved root, unsupported or malformed contracts, and file races that
invalidate the repeated checks fail closed. Preflight is not ingestion and creates no Object.
