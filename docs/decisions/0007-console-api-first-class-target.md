# Console API as a first-class target

Status: accepted
Date: 2026-07-25
Issue: CSSC-001

## Context

The tool's promise is CSS values in the same console where authors read their JavaScript logs. Treating the console as a printing fallback would waste the target: the Console API renders inspectable elements, tables, and groups natively in developer tools.

## Decision

The adapter uses the Console API as a first-class rendering target. Levels map to `console.log()`, `console.info()`, `console.warn()`, and `console.error()`. Probes render inside `console.groupCollapsed()`. One property across many elements renders through `console.table()`. Every record passes its live `Element` as an argument. Color results render a `%c` swatch alongside the text, and no information exists only in styling. The adapter never wraps, replaces, intercepts, or proxies `console`. Rendering runs behind isolation, so a throwing console method degrades output and nothing else.

## Alternatives considered

- A custom in-page panel. Rejected, because it reimplements developer tools surface area and loses the native inspection behaviors.
- Unstyled plain log lines. Rejected, because fifty grouped log lines are not legible where one table is.

## Consequences

Console formatting is never asserted as one large snapshot string; tests assert console method, group label, live element argument, and table data separately. The four levels descend from the Console API rather than from Sass, carry no assertion semantics, and the documentation says so plainly.
