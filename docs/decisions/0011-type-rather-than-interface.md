# 0011 — `type` rather than `interface` for public contracts

This record explains why every public TypeScript contract is declared with `type`.

## Status

Accepted, 2026-07-26.

## Context

The public surface of the package is a set of record and configuration shapes: `ValueRecord`, `FunctionRecord`, `ProbeRecord`, `CallSite`, `ValueGuard`, `Diagnostic`, and `ScanSummary`, among others. TypeScript offers two ways to declare such shapes. An `interface` participates in declaration merging: any consumer can reopen it by declaring an interface of the same name, adding members the library never defined. A `type` alias cannot be reopened.

For this project the shapes are contracts. The `soleContribution` field on a call site, the `contested` boolean on a guard, and the ordering guarantee on `values` carry documented meaning, and a contract that consumers can silently extend is a contract the project no longer controls.

## Decision

Every public type is declared with `type` rather than `interface`, so that declaration merging cannot reopen a published contract. The rule is recorded as a process rule and applies to the entire public surface.

The rule is executable: a type test asserts that every public contract is declared with `type` so that declaration merging is rejected, and the assertion runs in the static lane with the rest of the API integrity checks.

## Alternatives considered

Declaring public shapes with `interface` was rejected. Declaration merging is the deciding defect here: a consumer-side merge changes the perceived contract without any change to the library, which undermines the guarantees the records exist to carry. The extendability that merging provides is not a goal for closed record shapes.

A mixed convention, using `interface` for object shapes and `type` for unions, was rejected because the union members, such as the `ProbeRecord` discriminated union over `ValueRecord` and `FunctionRecord`, are themselves public contracts, and a mixed rule invites drift during review.

## Consequences

- Consumers extend records by composition, for example wrapping or intersecting types on their side, rather than by merging into the published names.
- The convention is uniform, so review does not need a per-declaration judgment call.
- `type` aliases support the union, generic, and readonly shapes the contracts already use, such as `ProbeRecord<TTarget>` discriminating on `kind`, so nothing in the public surface is lost to the restriction.
- The risk table entry "public contracts reopened by consumers" is closed by construction rather than by documentation.
