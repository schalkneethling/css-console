# 0001 — Scope principle and litmus test

This record establishes the two questions that decide what CSS Console builds and what it refuses.

## Status

Accepted, 2026-07-26.

## Context

CSS is becoming programmable. Custom functions shipped in Chromium in 2025, and mixins, `@apply`, and `if()` are specified and in progress. Programmable languages are debugged by printing intermediate values, and CSS has never needed that facility because until now it had no intermediate values to print. A tool that fills this gap risks growing into a worse browser inspector unless something decides which features belong.

## Decision

Two related tests govern scope.

The scope principle: a value is worth probing when it cannot be known from the source text alone, only after the browser has parsed and applied the CSS. That criterion covers custom function return values, `calc()` against relative units and percentages, which bound a `clamp()` landed on, `color-mix()` and relative color syntax, `light-dark()`, container units resolving against whichever container won, custom properties arriving through an inheritance chain, generated content sizing, `random()`, and `if()` branches once they ship. The criterion is a center of gravity rather than a restriction. A deterministic `calc(2px + 3px)` is not refused. The criterion decides what the demonstration leads with, what the documentation teaches first, and which capability gaps are worth closing.

The litmus test: before any feature enters the plan, it answers one question. Are we reimplementing something browser developer tools already do, or are we enhancing what they offer within the limits of page JavaScript? A feature that reimplements is rejected. A feature that enhances is considered on its merits.

Enhancement looks like this:

- Developer tools are element-anchored, requiring you to know which element to inspect. An annotation is source-anchored, so it sits where the doubt already is.
- Developer tools show one element at a time. A probe reports every matched element at once, which matters because runtime-computed values differ per element.
- Developer tools show the value. A function probe shows the call, the arguments, and the value, across every call site.
- Developer tools lose their state on reload. An annotation is committed to source, survives refactors, and travels to teammates.

Reimplementation looks like cascade resolution, specificity ranking, layer ordering, and box-model geometry. Those are rejected, and where the tool touches them it hands off rather than answers.

## Alternatives considered

A general-purpose resolved-value explainer was considered and rejected. Explaining resolved values in general leads directly into cascade provenance, which developer tools already own and which page JavaScript cannot fully observe. The revision history records this shift explicitly: the tool exists because CSS is becoming computational and has no way to print a value, not because resolved values in general need explaining.

A hard restriction that refuses deterministic values was also considered. It was rejected because refusing `calc(2px + 3px)` adds grammar complexity and user friction without protecting anything.

## Consequences

- Cascade work collapses from a feature to a guard, recorded in the decision on the guard as a guard rather than a cascade feature.
- Every proposed feature is measured against the litmus test before it enters the plan, which is listed as the control against building a worse inspector.
- The demonstration page and documentation lead with runtime-computed values: custom functions, `color-mix()`, container units, `clamp()`, and inheritance chains.
- Where the tool touches cascade questions, the remediation is a handoff: the live element in the console, one click from developer tools.
