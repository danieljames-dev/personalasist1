# @aion/privacy-boundary

This package authorizes an explicitly supplied local path against an explicitly supplied approved
root. It performs lexical and real-filesystem containment checks, rejects unsupported local text
input types, and returns privacy-safe reason codes.

It is not authentication, Identity, career ingestion, or a complete filesystem sandbox. Callers
must recheck immediately before significant writes. Filesystem state can change between a check and
use; OS permissions and a dedicated sandbox remain separate controls.
