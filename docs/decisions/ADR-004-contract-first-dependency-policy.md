# ADR-004: Contract-first dependency and versioning policy

- Status: Accepted
- Date: 2026-08-05

## Context

AION must remain replaceable across languages, vendors, storage engines, and future
AI models. TypeScript types alone cannot govern persisted or cross-process data.

## Decision

Stable dependencies point inward toward versioned ports and schemas. Vendor details
exist only in adapters. Public in-process APIs use versioned import paths; persisted
and cross-process contracts use language-neutral schemas with compatibility fixtures.
Breaking changes coexist under a new major version until consumers migrate.

## Alternatives

- Sharing concrete implementations is initially convenient but prevents replacement.
- Versioning only the application package obscures independent contract evolution.
- Requiring network schemas for private in-process details adds ceremony without a
  portability benefit.

## Consequences

Contract evolution requires more deliberate testing and migration design. Private
implementation remains free to change. Language-neutral schemas will be introduced
only with their owning domain rather than guessed in advance.

