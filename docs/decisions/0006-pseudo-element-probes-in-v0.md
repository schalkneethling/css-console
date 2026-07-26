# 0006 — Pseudo-element probes in v0

This record explains why selectors carrying pseudo-elements are probed in v0 rather than deferred.

## Status

Accepted, 2026-07-26.

## Context

Revision 4 of the implementation plan deferred pseudo-element probes, which meant `.element::before` could not be probed at all. That sat badly with the scope principle: generated content sizing and counter values are unknowable from source, so pseudo-elements are among the values most worth probing. The implementation cost also turned out to be small, because selector branch validation already detects pseudo-elements.

## Decision

Pseudo-element probes are in v0, confirmed in revision 5.

A selector branch carrying a pseudo-element is split: the originating element selector is matched with `querySelectorAll()`, and the pseudo-element string is passed as the second argument to `getComputedStyle()`. The `pseudo` field on the record carries the pseudo-element, and is `null` for ordinary probes.

Supported in v0: `::before`, `::after`, `::marker`, `::first-line`, `::first-letter`, `::placeholder`, `::selection`, and `::backdrop`. Deferred: `::part()` and `::slotted()`, which require shadow DOM, and any pseudo-element chain. Deferred pseudo-elements produce a deferred-feature diagnostic, and one unsupported branch does not erase valid branches.

A pseudo-element that generates no box still returns computed values, which is documented rather than treated as a defect.

## Alternatives considered

Deferring all pseudo-element probes, as revision 4 did, was rejected. The scope principle argues for inclusion, the mechanism is a small extension of work v0 already performs, and the demonstration page needs a `::before` case whose generated content sizing is unknowable from source.

Supporting `::part()`, `::slotted()`, and pseudo-element chains in v0 was rejected. The shadow DOM pseudo-elements depend on shadow DOM discovery, which is deferred by choice, and chains add matching complexity without a v0 use case. They remain available as follow-up work under CSSC-115.

## Consequences

- The `pseudo` field exists on both value and function records from the first release, typed `string | null`.
- Evaluation acquires one computed style declaration per element and pseudo-element pair, which the performance budgets assert.
- Every supported pseudo-element has its own fixture, and the no-box case, a `::before` with no `content`, has an explicit test documenting that computed values are still returned.
- Cross-browser contract coverage includes pseudo-element computed values.
