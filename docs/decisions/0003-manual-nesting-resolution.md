# Manual nesting resolution

Status: accepted
Date: 2026-07-25
Issue: CSSC-001

## Context

CSS nesting is widely deployed and heavily used, so nested rules must resolve into flat selectors that `querySelectorAll()` accepts. The obvious implementation is a PostCSS transform plugin run as a pre-pass.

## Decision

Nesting is resolved manually against the parent chain on the parsed tree, substituting `:is(parentList)` for the nesting selector and prepending an implicit descendant combinator where the nesting selector is absent. No transform pre-pass is used.

## Alternatives considered

- Run a nesting transform plugin before annotation processing. Rejected, because any transform that relocates or drops comment nodes destroys the annotation association that rule probes and declaration probes depend on.
- Refuse nested rules in v0. Rejected, because a version zero that fails on ordinary modern CSS fails in front of exactly the developers the usability checkpoint depends on.

## Consequences

Resolution must preserve annotation source locations, and a fixture asserts that line and column survive unchanged, because that is the regression most likely to bite. `@nest` was removed from the specification and produces a diagnostic when encountered. Conditional ancestors interleave with nesting, so the ancestor chain walks a mixed stack of rules and at-rules.
