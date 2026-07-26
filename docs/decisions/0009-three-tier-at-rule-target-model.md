# 0009 — Three-tier at-rule target model

This record explains how annotations placed before at-rules are classified and diagnosed.

## Status

Accepted, 2026-07-26.

## Context

An annotation can precede any at-rule, so the compiler must decide what each combination means. Revision 4 of the implementation plan read as a blanket rejection of at-rules other than `@function`, which contradicted the reserved-pending-support category in the same document. A browser gap and a design decision are not the same message, and conflating them misleads the author about what to do next.

## Decision

At-rule targets fall into three tiers, and each tier produces a different diagnostic.

| Tier                     | At-rules                                | Behavior                                                      |
| ------------------------ | --------------------------------------- | ------------------------------------------------------------- |
| Supported                | `@function`                             | Compiles to a function probe                                  |
| Reserved pending support | `@mixin`, `@apply`, `@contents`, `@env` | Parses, then reports that the browser does not yet support it |
| Not a target by design   | `@media`, `@supports`, `@layer`         | Reports that grouping constructs are not annotation targets   |

Targets rejected by design carry remediation rather than a bare refusal: annotate the rules inside the grouping construct. Annotations preceding at-rules outside these tiers, such as `@keyframes` and `@container`, report an unsupported rule context.

Acceptance for the association work states that the three tiers produce three distinguishable diagnostics, and no tier is silently conflated with another.

## Alternatives considered

A blanket rejection of every at-rule except `@function` was rejected because it reports a future capability, such as a `@mixin` probe, with the same voice as a permanent design decision, and it leaves nothing for the reserved contracts designed in v0 to attach to.

Accepting grouping constructs as targets, meaning a probe on `@media` would probe every rule inside it, was rejected as ambiguous surface area. The same intent is expressed precisely by annotating the rules inside, which is exactly what the remediation says.

Silently ignoring annotations on unsupported targets was rejected because unsupported constructs never silently produce misleading output.

## Consequences

- The diagnostic registry carries distinguishable codes for reserved-pending-support targets, by-design rejections, and unsupported rule contexts, each with a fixture that triggers it.
- When the browser ships `@mixin` support, the reserved tier moves to supported under CSSC-101 without changing the model.
- The console adapter renders a reserved-pending-support diagnostic so that it reads as a browser gap, and a not-a-target diagnostic so that it carries remediation.
- This model is the annotation-target application of the three-way scope split recorded separately.
