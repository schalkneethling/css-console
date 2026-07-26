# 0008 — Three-way scope split

This record explains why everything outside v0 falls into one of three named categories rather than a single deferred list.

## Status

Accepted, 2026-07-26.

## Context

A flat "not in v0" list conflates three different messages. A feature the browser cannot run yet, a feature the project chose to postpone, and a capability no page script can ever deliver call for different diagnostics, different documentation, and different follow-up work. Reading a reserved feature as a missing feature is a named project risk.

## Decision

Out-of-scope work splits three ways.

Reserved pending browser support: specifications exist, so the API shape, record fields, and diagnostics are designed in v0, and the runtime feature-detects and reports that the browser does not yet support the feature. The entries and their follow-up issues are `@mixin` and `@apply` (CSSC-101), `@contents` and `@env` (CSSC-102), `if()` branch reporting (CSSC-103), and `@supports at-rule()` capability gating (CSSC-104). `@apply` carries a design note: it injects declarations absent from source text, so anything built on the premise that source text describes what is on an element has a shelf life, and the guard is deliberately small partly for this reason.

Deferred by choice: `watch` and value diffs (CSSC-110 through CSSC-114), shadow DOM including `::part()` and `::slotted()` (CSSC-115, CSSC-116), cross-origin sources without CORS access, recursive `@import` (CSSC-117), constructed stylesheets without registered source text, `@container` and `@scope` evaluation (CSSC-118), CSS Modules, preprocessor mapping, and source maps, geometry probes (CSSC-120), Typed Object Model as a required feature (CSSC-119), browser extensions and bundler integration (CSSC-122, CSSC-124, CSSC-125), and splitting the workspace into multiple published packages (CSSC-126).

Out of reach from page JavaScript: which branch inside a custom function body produced `result`, full cascade provenance covering specificity ranking, layer ordering, and order of appearance, user-agent and user-origin stylesheets, presentational hints from HTML attributes, and the contribution of a running transition or animation to a value. These cannot be delivered from a script running in the page. They are documented in the capability write-up, `docs/capabilities.md`, as the argument for what only the engine can provide, and CSSC-130 develops that write-up into a developer tools capability proposal.

In every category, unsupported constructs are diagnosed. They never silently produce misleading output.

## Alternatives considered

A single deferred list, as earlier revisions carried, was rejected because it produces one diagnostic message for three different situations and hides the capability argument, which is half of the v0 milestone.

Building speculative implementations of reserved features was rejected because their observable behavior cannot be tested against any shipping engine, so only their contracts are designed now.

## Consequences

- Diagnostic codes for reserved-pending-support features, deferred features, and by-design rejections are distinguishable, and fixtures assert that distinction.
- The three-tier at-rule target model, recorded separately, applies this split to annotation targets specifically.
- Every reserved and out-of-reach entry has either a decision record or a named follow-up issue in the CSSC-101 through CSSC-130 range, satisfying the acceptance criterion for this issue.
- The capability write-up is a deliverable, not an apology: it states the litmus test and what an engine-level implementation could offer instead.
