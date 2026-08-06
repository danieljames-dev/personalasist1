# Sprint 3.0 Phase 3: privacy boundary

Phase 3 establishes only the prerequisite local privacy boundary:

- ignored empty runtime directories beneath `private/`;
- explicit approved-root and explicit absolute-path authorization;
- lexical, real-path, link, junction, and reparse containment checks;
- JSON/Markdown/text extension policy for a later ingestion phase;
- privacy-safe errors and a future local operation-record contract;
- network, telemetry, Git, and source-backup exclusions; and
- deterministic tests using synthetic temporary content only.

No owner data was accessed. Nothing was ingested or transmitted. Identity, Universal Objects,
career parsing, job matching, drafting, discovery, applications, databases, vector stores, and
Phase 4 remain unimplemented and unauthorized.
