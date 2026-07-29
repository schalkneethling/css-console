# 0003 — Manual nesting resolution rather than a transform pre-pass

This record explains why nested selectors are resolved by walking the parsed tree rather than by running a nesting transform first.

## Status

Accepted, 2026-07-26.

## Context

Probes must match elements with `querySelectorAll()`, which requires flat selectors, but authors write nested CSS. Something must resolve `.card { .title { } }` into a selector the DOM API accepts. Parser ecosystems offer transform plugins that flatten nesting, so a pre-pass is the obvious shortcut. However, the entire annotation system depends on comment nodes keeping their exact positions, because a probe is associated with its target by adjacency in source.

## Decision

Nesting resolution happens in core, on the parsed tree, before probe compilation. Resolution is performed manually against the parent chain, and no transform plugin is used as a pre-pass.

The resolution rules are:

- A branch containing no nesting selector is treated as though the nesting selector were prepended with a descendant combinator, so `.card { .title { } }` resolves as `& .title`.
- The nesting selector represents the parent selector list and behaves as `:is(parentList)` for both matching and specificity. Substituting `:is(...)` produces a flat selector that `querySelectorAll()` handles correctly and whose specificity matches the specification.
- `@nest` was removed from the specification and is not supported.
- Conditional ancestors interleave with nesting, so the ancestor chain walks a mixed stack of rules and at-rules rather than a flat prelude.

## Alternatives considered

Running an existing nesting transform as a pre-pass was rejected. Any transform that relocates or drops comment nodes destroys annotation association, which is the regression that would bite hardest. Even a transform that preserves comments today could change that behavior in a patch release, and the project would have no compiler-level guarantee against it.

Passing nested selectors to `querySelectorAll()` unresolved was rejected because nested rule objects are not selectors, and reconstructing context at match time would repeat the same walk in a worse place.

## Consequences

- Core owns a nesting resolver and its fixtures, including implicit descendant prepending, leading combinators, `:is()` wrapping for multi-branch parents, three levels of nesting, and mixed rule and at-rule ancestor stacks.
- A fixture asserts that annotation line and column are unchanged after resolution, which pins the property the transform pre-pass would have endangered.
- Call-site resolution runs after nesting resolution, so recorded selectors are always flat.
- The behavior of declarations appearing after nested rules is verified against current specification text before its fixture is written, and a representative subset of Web Platform Tests is mirrored.
