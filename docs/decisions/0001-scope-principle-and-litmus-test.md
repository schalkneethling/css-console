# Scope principle and litmus test

Status: accepted
Date: 2026-07-25
Issue: CSSC-001

## Context

CSS is becoming programmable. Custom functions shipped in Chromium in 2025, and mixins, `@apply`, and `if()` are specified and in progress. Programmable languages are debugged by printing intermediate values, and CSS has never needed that facility because until now it had no intermediate values to print. A tool in this space can drift toward reimplementing browser developer tools, a contest page JavaScript cannot win.

## Decision

Features are admitted by one criterion: a value is worth probing when it cannot be known from the source text alone, only after the browser has parsed and applied the CSS. Every proposed feature also answers the litmus test: does it reimplement something developer tools already do, or does it enhance what they offer within the limits of page JavaScript? Reimplementations are rejected. Enhancements are considered on their merits.

## Alternatives considered

- Build a general CSS debugger. Rejected, because cascade resolution, specificity ranking, and box-model geometry are already served by developer tools and cannot be improved from a page script.
- Restrict probes to a closed list of value kinds. Rejected, because the criterion is a center of gravity rather than a restriction; a deterministic `calc(2px + 3px)` is not refused.

## Consequences

The scope principle decides what the demonstration leads with, what the documentation teaches first, and which capability gaps are worth closing. Cascade work enters the tool only as the guard, which hands off to developer tools rather than answering. The full reasoning lives in the "What this tool is for" section of the implementation plan.
