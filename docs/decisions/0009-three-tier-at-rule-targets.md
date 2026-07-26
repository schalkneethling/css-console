# Three-tier at-rule targets

Status: accepted
Date: 2026-07-25
Issue: CSSC-001

## Context

Revision 4 of the plan read as a blanket rejection of at-rule annotations other than `@function`, which contradicted the reserved category in the same document. The tiers need different diagnostics, because telling an author "your browser does not support this yet" and "this construct is not an annotation target" are different conversations.

## Decision

At-rule annotation targets fall into three tiers. `@function` is supported and compiles to a function probe. `@mixin`, `@apply`, `@contents`, and `@env` are reserved pending support: they parse, then report that the browser does not yet support them. `@media`, `@supports`, and `@layer` are not targets by design, and the diagnostic carries remediation: annotate the rules inside the grouping construct.

## Alternatives considered

- Blanket rejection of every at-rule except `@function`. Rejected, because it conflates a browser gap with a design decision and gives the author no path forward.
- Allow annotations on grouping constructs. Rejected, because a probe on `@media` has no element or call site to report against, and the useful target is always the rule inside.

## Consequences

The three tiers produce three distinguishable diagnostics, enforced by CSSC-006 and by the diagnostic registry. Unsupported rule contexts such as `@container`, `@scope`, `@starting-style`, and `@keyframes` remain a separate category with their own diagnostic, because they describe where a rule lives rather than what it is.
