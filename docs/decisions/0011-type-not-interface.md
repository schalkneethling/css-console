# Type aliases rather than interfaces for public contracts

Status: accepted
Date: 2026-07-25
Issue: CSSC-001

## Context

TypeScript interfaces support declaration merging, so any consumer can reopen an interface and add fields. For a library whose record shapes are its contract, reopening a published contract silently is a hazard.

## Decision

Every public type is declared with `type` rather than `interface`, so declaration merging cannot reopen a published contract.

## Alternatives considered

- Use `interface` by convention and document that consumers must not merge. Rejected, because the compiler can enforce what documentation can only request.
- Freeze shapes with `Readonly` wrappers alone. Rejected as insufficient, because `Readonly` does not prevent merging.

## Consequences

CSSC-003 adds a type test asserting every public contract is declared with `type`. Read-only fields carry the `readonly` modifier directly, and arrays carry `readonly` or `ReadonlyArray` as the use requires.
