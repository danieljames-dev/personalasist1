# Bounded Object Filesystem Reference Repository

Status: Implemented as **local reference evidence only**

Permanent production storage decision: Not made

`FileObjectRepositoryV1` implements the accepted `ObjectRepository` port. Construction requires an
explicit absolute root whose final path components are `private/object-store`; it never infers a
home directory, scans directories, creates the root, or writes Object state. Every operation
composes the Phase 3 `authorizeLocalPath` and `recheckAuthorizedPath` boundary.

## Versioned layout

```text
private/object-store/
  v1/objects/<safe-key>/revisions/<positive-revision>.aion
```

`<safe-key>` is lower-case SHA-256 over the domain-separated string
`aion.object.storage-key.v1` and a validated opaque Object UUID. It is deterministic, contains no
raw Object ID, and carries no authority.

Each `.aion` file is the exact ACJ-1 byte representation of one complete immutable Object envelope.
A writer opens a unique same-directory temporary file with exclusive creation, writes the complete
bytes, flushes the file, closes it, and installs it with a no-overwrite hard link. The temporary
name is never canonical state and is cleaned only by the writer that created it. Competing writers
therefore have one winner; an existing final revision is never silently replaced.

Loads validate the directory shape, positive continuous revision sequence, raw ACJ-1 bytes,
Object envelope, AION Frame-derived integrity descriptor and digest, Object/path identity,
revision number, immutable fields, lifecycle transition, and exact reserialization. Any gap,
unexpected entry, malformed value, unsupported version, digest mismatch, or chain conflict fails
closed. A directory containing only adapter-owned temporary remnants has no canonical history and
can be retried safely. All historical revisions and their provenance remain intact.

The adapter uses no database, vector store, network, telemetry, authorization, or Identity
persistence. Tests create only temporary synthetic `private/object-store` roots and remove them.
Phase 5 creates no permanent Object state. DG-4b remains Open, so this adapter is not production
workload evidence and makes no durability claim beyond the tested local filesystem primitives.
