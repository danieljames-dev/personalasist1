# ADR-002: TypeScript Kernel baseline

- Status: Accepted
- Date: 2026-08-05

## Context

The repository already uses TypeScript and Node.js. Sprint 1 needs a testable public
contract, while the architecture requires that language choice not bind future
components or external protocols.

## Decision

Implement the in-process Kernel API in strict TypeScript targeting supported Node.js
22 or newer. Publish declarations and expose the API through an explicitly versioned
module path. Keep all participant contracts behavioral and free of Node-specific
types.

## Alternatives considered

- Changing languages now lacks evidence and would discard the only established
  repository direction.
- Defining a network protocol for an in-process lifecycle coordinator would add an
  unnecessary distributed-systems boundary.

## Consequences

TypeScript consumers receive compile-time contracts. Future components may use other
languages behind their own versioned interfaces. The runtime baseline and public API
version are independent and may evolve separately.

