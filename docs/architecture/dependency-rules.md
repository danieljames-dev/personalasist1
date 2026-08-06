# AION dependency rules

Status: Accepted

## Rules

1. The Kernel depends only on its lifecycle contract and language/runtime primitives.
2. Domain packages depend on platform contracts, never concrete adapters or apps.
3. Application services coordinate their own domain; they do not reach into another
   subsystem's storage.
4. Adapters implement inward-facing ports and contain all vendor-specific concepts.
5. Apps are composition roots and may select adapters; no library package may do so.
6. Cross-subsystem persisted references use versioned object identifiers/contracts.
7. Cross-subsystem notifications use versioned event contracts once the Event Bus is
   approved; no shared tables or ambient service locator are permitted.
8. Cyclic package dependencies are prohibited.

```text
apps -> adapters -> application -> domain -> contracts
  |                                       
  +-------------- composition only ------> Kernel lifecycle port
```

The architectural roadmap is a construction order, not an import chain. Automated
boundary tests begin with the Kernel package and expand with every subsystem.

