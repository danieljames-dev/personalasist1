# `@aion/local-assistant`

This package contains AION V1's local Chat, Memory, Tasks, Routines, Planner, capability,
approval, activity, import, settings, private-backup, and developer-agent contracts and
application service. Infrastructure enters through explicit ports. The package performs no
network request, owns no UI, stores no credentials, and cannot execute unrestricted shell input.

The file repository is an explicit local adapter for ignored `private/aion/` state. The
deterministic provider and synthetic developer bridge are offline test adapters. Remote and local
model support are replaceable boundaries whose disclosure and availability are visible in
Settings.

A provider may only *propose*. Proposal lines are stripped from the stored message, revalidated
against the capability registry, and become either an `awaiting-approval` action or an
`unconfirmed` memory. Execution requires an approval bound to the exact capability and the exact
canonical digest of the input, and that approval is consumed by the one execution it authorises.

Replaceable ports: `StateRepositoryV1`, `ClockV1`, `IdGeneratorV1`, `ModelProviderV1`,
`CapabilityRegistryV1`, `ImportSourceV1`, `PrivateBackupV1`, and `DeveloperAgentBridgeV1`. Each
ships at least two implementations, and the architecture-boundary suite enforces that no domain
module reaches a network, browser, database, telemetry, or process API.

See [the V1 architecture](../../docs/architecture/aion-v1-local-assistant.md) and
[the Command Center guide](../../docs/implementation/aion-command-center.md).

