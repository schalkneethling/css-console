# Single package with compiler-enforced boundaries

Status: accepted
Date: 2026-07-25
Issue: CSSC-001

## Context

The architectural boundary that matters is keeping browser and console globals out of the parser. Earlier revisions enforced it with a four-package workspace, which buys four release surfaces, four changelogs, and four version ranges before the usability checkpoint has confirmed the annotation syntax is worth keeping.

## Decision

Version zero ships as one package with one public entry point. Internal boundaries live in TypeScript project references, and the compiler enforces all three boundary dimensions. Which globals exist is controlled by `lib` and `types`, with core pinned to `lib: ["ES2025"]` and `types: []` so that `document`, `window`, `console`, and `process` are compile errors. Which files can import which is controlled by the reference graph, so core references nothing and adapter cannot reach browser. Which packages may be imported at all is controlled by the rule that nothing under `src/` imports a Node package or a `node:` builtin. Lint-based import restrictions may reinforce the boundary but are not a mechanism. `typecheck` is `tsc --build` at the root, walking the graph in dependency order.

## Alternatives considered

- Four published packages. Deferred to CSSC-126, mechanical when needed because dependency direction already lives in the reference graph.
- Lint rules as the primary enforcement. Rejected, because a disabled or silently ignored lint rule reads as enforcement during review and provides none.

## Consequences

The `lib: ["ES2025"]` choice commits the project to a floor of Node 24 and 2025-era browser baselines, recorded in the scaffold decision record and revisited together with the setting. Probe identifier hashing uses a small pure JavaScript algorithm, because core may not import `node:crypto` and `crypto.subtle` is unavailable under `types: []`. A static test lane proves each boundary dimension by asserting that a violating file fails compilation.
