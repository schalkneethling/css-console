# Relationship to css-expect

Status: accepted
Date: 2026-07-25
Issue: CSSC-001

## Context

CSS Console and [css-expect](https://github.com/schalkneethling/css-expect) occupy adjacent territory, and the Sass precedent names the boundary: Sass has `@debug` for observing values and Sass True for asserting them. The two projects are the debug and assert halves of one story.

## Decision

CSS Console runs in the page during development, observes values in their real context, and asserts nothing. css-expect runs in Node, drives a browser through Playwright, evaluates CSS in isolation, and asserts expected values. Both take the browser engine as the source of truth, and neither emulates CSS. Where record shapes can agree without contortion they should, but shared code is not a v0 goal.

## Alternatives considered

- One project covering both. Rejected, because a page-scoped debugging runtime and an off-page assertion runner have different lifecycles, different audiences at different moments, and different isolation guarantees.
- Shared packages from the start. Rejected, because extracting a shared core before either contract stabilizes freezes the wrong shape; css-expect is also the named answer for isolated return-value assertions, which keeps this project's read-only guarantee intact.

## Consequences

When a non-isolated call site reports a property value rather than a function return value, the documentation names css-expect as the tool for isolated assertion. Record-shape agreements are adopted opportunistically and recorded in the relevant decision records as they happen.
