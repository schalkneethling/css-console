# 0005 — Function probes as a third probe kind

This record explains why annotating an `@function` definition is its own probe kind rather than a variant of a rule probe.

## Status

Accepted, 2026-07-26.

## Context

Custom functions are the clearest instance of the scope principle: a function's return value cannot be known from source text, and it can differ per call site and per element. An author who is unsure about a function wants to annotate the definition, but a definition resolves no values by itself. Values are observable only where the function is called, and those call sites are scattered across rules the author may not have in front of them.

## Decision

A comment immediately preceding an `@function` at-rule compiles to a function probe, a third probe kind beside rule probes and declaration probes. The runtime locates every call site of the function across the scanned sources, matches the rules those calls appear in, and reports the arguments as authored together with the value each matched element resolved. Function records carry the function name, the definition location, the call site, the matched target, and the resolved value.

Call-site resolution follows three distinct rules:

- Every call in a declaration value is its own call site. A declaration reading `margin: --space(1) --space(2)` produces two call sites, not one.
- A call passed as an argument to another call records the outer call. In `--space(--double(2))`, the call site for a probe on `--space` is the outer call, with `--double(2)` captured verbatim as the authored argument.
- A call inside another function body is a definition reference, not a call site, because the inner call has no independently observable value. Definition references are recorded and reported separately.

Each call site records the containing rule's resolved selector, the declaration property, the arguments as authored, and `isolated`: whether the call constitutes the entire declaration value. When `isolated` is false, the resolved value is the property's value rather than the function's isolated return value, and the record says so rather than implying a return value the tool cannot isolate.

A property list on a function probe is rejected, because the call sites determine the properties. A function with zero call sites is reported rather than silent, because that is itself a useful debugging answer.

## Alternatives considered

Requiring authors to annotate every calling declaration instead was rejected. It inverts the anchoring the litmus test values: the doubt sits at the definition, and the author should not have to find every call site by hand, which is exactly the work the tool automates.

Isolating a nested call's return value was rejected. It would require synthesizing a probe element carrying the original element's custom property context, which conflicts with the read-only guarantee. css-expect isolates properly, off-page, and is the right tool for that question.

## Consequences

- Call-site resolution is the differentiating capability. CSSC-013 implements it, its checkpoint halts for review, and its review question is whether resolution finds every call and no others.
- The record contract gains `FunctionRecord`, `CallSite`, and the `isolated` honesty field.
- Function evaluation requires a browser with native `@function` support. The runtime feature-detects and reports a reserved-pending-support diagnostic elsewhere, and Chromium-only availability is not a blocker for a development-only tool.
- The console adapter renders one group per function and one table per call site, with non-isolated calls visibly marked as property values.
