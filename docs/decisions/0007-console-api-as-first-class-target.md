# 0007 — Console API as a first-class rendering target

This record explains why probe output renders through the native Console API rather than through a custom panel or overlay.

## Status

Accepted, 2026-07-26.

## Context

The v0 user story ends with the author seeing what the browser produced "in the same console where I read my JavaScript logs". The console is where developers already debug, it renders live elements as inspectable nodes, and it needs no UI of its own. The risk in bridging into the console is being read as a console wrapper, and the risk in treating it as a dumb sink is illegible output at scale.

## Decision

The adapter uses the Console API as a first-class rendering target rather than as a printing fallback, under these rules:

- Never monkey-patch. The adapter calls the Console API. It does not wrap, replace, intercept, or proxy `console`, because breaking the host application's console semantics is a named risk.
- Levels map to `console.log()`, `console.info()`, `console.warn()`, and `console.error()`. Probes render inside `console.groupCollapsed()`. Scan duration uses `console.time()` and `console.timeEnd()`. Function probes may use `console.count()` to tally call sites.
- One property across many elements renders through `console.table()`, which is the common shape under the scope principle, because runtime-computed values differ per element. A table with one row per element is legible at fifty rows where fifty grouped log lines are not.
- Every record passes its `Element` as an argument so that developer tools render it inspectable. This is the handoff, and it is not optional.
- `%c` styling is used for color swatches only. A rendered swatch beside a `color-mix()` or relative color result conveys something no text can, but any information a swatch carries is also present as text.
- Adapter failure cannot break scanning. Rendering runs behind isolation, so a throwing console method degrades the output and nothing else.

The four levels descend from the Console API, not from Sass, and carry no assertion or control-flow semantics. Sass's `@error` is deliberately not copied, because it aborts compilation and CSS Console cannot abort anything: the CSS has already applied by the time the runtime executes.

## Alternatives considered

A custom in-page panel or overlay was rejected. It reimplements presentation the console already provides, loses the native inspectable-element handoff, mutates the page a read-only tool must not touch, and adds accessibility surface a v0 experiment does not need.

Plain unstructured `console.log()` lines were rejected because output must stay legible at 1, 10, and 50 matches, which is a phase 4 exit criterion.

Wrapping `console` to inject formatting globally was rejected outright by the never-monkey-patch rule.

## Consequences

- The adapter is testable by asserting method, group label, live element argument, and table data separately, never by snapshotting formatting as one string.
- Structured records remain the primary output. The summary carries records, so a consumer never needs the console rendering at all.
- Machine consumers, including coding agents driving a browser, read the scan summary rather than the console rendering. A driver such as Playwright can evaluate the public API in the page and return the summary directly, which is lossless where re-parsing rendered console output is not. Because browser records hold live `Element` references that structured cloning rejects, this path requires a serializable projection of the summary, replacing each record's live element with a re-locatable handle for follow-up actions rather than a node the record cannot carry. The projection and a development-only command-line wrapper are v0 work under CSSC-040, because they are what makes the tool usable by an agent; agent-protocol packaging, such as an MCP server, is deferred under CSSC-127.
- Rendering through the Console API also makes results observable through a driver's console message API, such as Playwright's ConsoleMessage. That lane is the test harness for the console adapter and a fallback where evaluating in the page is not possible, not the primary machine-consumption path.
- Chrome custom formatters remain a separate spike under CSSC-122 rather than a v0 dependency.
