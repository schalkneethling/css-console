# 0012 — Relationship to css-expect

This record fixes the division of labor between CSS Console and its sibling project css-expect.

## Status

Accepted, 2026-07-26.

## Context

Sass reached the printing-values moment long ago, and the shape of its answer is instructive: `@debug` and `@warn` for observing values, and Sass True for asserting them. The assertion half of that story already exists for native CSS as [css-expect](https://github.com/schalkneethling/css-expect), by the same author. Without a recorded boundary, the two projects would drift toward overlapping features, and CSS Console would be pulled toward assertions it cannot honor from inside a page.

## Decision

The two projects are the debug and assert halves of one story, following the Sass precedent of `@debug` alongside Sass True.

css-expect runs in Node, drives a browser through Playwright, evaluates CSS in isolation, and asserts expected values. It is a test tool. CSS Console runs in the page during development, observes values in their real context, and asserts nothing. It is a debugging tool. Both take the browser engine as the source of truth and neither emulates CSS. Where record shapes can agree without contortion they should, but shared code is not a v0 goal.

The Sass precedent is applied selectively:

- From `@debug`: print a value with its source location, and inspect rather than stringify, so structure survives.
- From `@warn`: emit the call chain, whose function-probe equivalent is the call-site chain, and support per-dependency silencing, which is why source-scoped `exclude` filtering is in the configuration from the first release.
- `@error` is deliberately not copied. It aborts compilation, and CSS Console cannot abort anything, because the CSS has already applied by the time the runtime executes. The four levels descend from the Console API, not from Sass, and the documentation says so plainly.

The boundary also settles a concrete design question: isolating a nested function call's return value would require synthesizing a probe element, which conflicts with the read-only guarantee. css-expect isolates properly, off-page, so non-isolated calls are marked with `isolated: false` and the documentation names css-expect as the tool for isolated assertions.

## Alternatives considered

Merging the projects, or adding assertion features to CSS Console, was rejected. Assertions in the page invite `@error`-style semantics the tool cannot honor, and the environments differ fundamentally: isolated evaluation under test versus real-context observation during development.

Sharing code in v0 was rejected as premature. The projects agree on vocabulary where it is free, notably if the CSSC-002 parser spike selects css-tree, which css-property-type-validator already uses, but shared packages are not a goal.

## Consequences

- Feature requests that are assertions are routed to css-expect rather than accreted here.
- The levels `log`, `info`, `warn`, and `error` carry no assertion or control-flow semantics, and the documentation states their Console API lineage.
- Record shapes stay close enough to css-expect for a future convergence without committing to one now.
- The release process follows the trusted-publishing setup used by css-expect.
