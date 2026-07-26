# Function probes as a third probe kind

Status: accepted
Date: 2026-07-25
Issue: CSSC-001

## Context

Custom functions are the clearest expression of the scope principle: a function's return value cannot be known from source, and developer tools show the resolved property value on one element without the call, the arguments, or the other call sites. The Sass `@warn` lesson applies: context is the call chain, which here means which function, called from which declaration, in which rule, in which source.

## Decision

A comment immediately preceding an `@function` at-rule creates a function probe. The runtime locates every call site across the scanned sources and reports the arguments as authored together with the value each matched element resolved. Every call in a declaration value is its own call site. A call passed as an argument to another call records the outer call. A call inside another function body is a definition reference, reported separately, because it has no independently observable value. Each call site carries `isolated`, which is true only when the call is the entire declaration value.

## Alternatives considered

- Report only definition sites. Rejected, because values are observable only where the function is called.
- Collapse multiple calls in one declaration into one call site. Rejected; revision 4 of the plan stated this and was wrong for the common case.
- Isolate nested calls by synthesizing a probe element. Rejected, because it conflicts with the read-only guarantee; css-expect isolates properly, off-page.

## Consequences

Function probes are the differentiating capability, and call-site resolution has no browser dependency, so it lands in the compiler phase with its own checkpoint after CSSC-013. Browsers without `@function` support produce a reserved-pending-support diagnostic rather than an error.
