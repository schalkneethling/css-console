# Three-way scope split

Status: accepted
Date: 2026-07-25
Issue: CSSC-001

## Context

Earlier plan revisions held a single deferred list. That conflated three different situations: features whose specifications exist but whose browser support has not shipped, features the project chooses not to build yet, and features page JavaScript cannot deliver at all. A browser gap and a design decision are not the same message, and readers deserve to tell them apart.

## Decision

Scope splits three ways. Reserved pending browser support covers `@mixin`, `@apply`, `@contents`, `@env`, `if()` branch reporting, and `@supports at-rule()`; their API shape, record fields, and diagnostics are designed in v0, and the runtime feature-detects and reports the browser gap. Deferred by choice covers watches, shadow DOM, cross-origin sources, recursive `@import`, constructed stylesheets, `@container` and `@scope` evaluation, preprocessor mapping, geometry probes, Typed Object Model enrichment, extensions, bundler integration, and the workspace split. Out of reach from page JavaScript covers function-body branch observation, full cascade provenance, user-agent and user-origin stylesheets, presentational hints, and the contribution of running transitions and animations.

## Alternatives considered

- One deferred list. Rejected, because reserved features read as missing features and the out-of-reach list reads as a promise.
- Attempt the out-of-reach items anyway. Rejected; they are documented in `docs/capabilities.md` as the argument for what only the engine can provide.

## Consequences

Every reserved feature has a follow-up issue (CSSC-101 through CSSC-104), every deferred feature has one (CSSC-110 through CSSC-126), and the out-of-reach list feeds the capability write-up and CSSC-130. Diagnostics for the three categories are distinguishable, which the diagnostic registry enforces from CSSC-004 onward.
