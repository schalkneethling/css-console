# Pseudo-element probes in v0

Status: accepted
Date: 2026-07-25
Issue: CSSC-001

## Context

Revision 4 of the plan deferred pseudo-element probes, which meant `.element::before` could not be probed at all. Generated content sizing is a canonical example of a value that cannot be known from source, so the scope principle argues for inclusion.

## Decision

Pseudo-element probes ship in v0. A selector branch carrying a pseudo-element is split: the originating element selector is matched with `querySelectorAll()`, and the pseudo-element string is passed as the second argument to `getComputedStyle()`. The `pseudo` field on the record carries the pseudo-element and is `null` for ordinary probes. Supported in v0: `::before`, `::after`, `::marker`, `::first-line`, `::first-letter`, `::placeholder`, `::selection`, and `::backdrop`.

## Alternatives considered

- Defer all pseudo-elements. Rejected, because the work is small once selector branch validation detects pseudo-elements, and the deferred outcome contradicts the scope principle.
- Support `::part()` and `::slotted()`. Deferred, because they require shadow DOM. Pseudo-element chains are also deferred.

## Consequences

The `pseudo` field is typed `string | null` from the outset, so later widening is not a breaking change. A pseudo-element that generates no box still returns computed values, which is documented rather than treated as a defect.
