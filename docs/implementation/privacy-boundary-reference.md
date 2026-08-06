# Privacy boundary reference implementation

The isolated `@aion/privacy-boundary` workspace has no Kernel, Identity, Object, domain, network,
telemetry, browser, model-provider, database, or vector-store dependency. It performs synchronous,
deterministic authorization only; it does not open, parse, import, copy, or write an owner file.

Call `authorizeLocalPath` before local access and `recheckAuthorizedPath` immediately before a
significant write. For the initial file policy, call `authorizeLocalTextInput`. Success returns the
canonical path for the local caller; rejection returns privacy-safe metadata without the supplied
path. Callers must not serialize successful canonical paths into ordinary logs.

The reference checks existing filesystem components with native real-path resolution. For a missing
destination it resolves the nearest existing parent and validates the remaining path. This reduces
link and junction escape risk but cannot eliminate TOCTOU races or replace OS sandboxing.
