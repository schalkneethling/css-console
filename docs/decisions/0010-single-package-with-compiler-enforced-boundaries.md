# 0010 — Single package with compiler-enforced boundaries

This record explains why the project is one package whose internal boundaries are enforced by the TypeScript compiler rather than by a linter or a workspace split.

## Status

Accepted, 2026-07-26.

## Context

The codebase has layers with different environmental needs. Core logic, covering annotations, compilation, nesting, functions, expansion, records, and diagnostics, must run without the DOM and must stay free of Node dependencies. The browser layer needs the DOM. The adapter needs the DOM and core, but must not grow scanner logic. These constraints are easy to state and easy to erode, so they need a mechanism that fails the build rather than a convention that fails silently.

## Decision

The project is one package with one root manifest and one public entry point. Internal directories are reached through relative imports, never through published subpath exports. Boundaries are expressed through TypeScript project references, with composite projects for `src/core`, `src/browser`, and `src/adapter`.

The boundary has three dimensions. The compiler enforces the first two entirely and the builtin half of the third; the package half of the third is enforced by a lint rule that a test proves alive, because the compiler has no mechanism for it:

- Which globals exist is controlled by `lib` and `types`. Core sets `lib: ["ES2025"]` and `types: []`, because removing the DOM library alone is insufficient: ambient type packages reintroduce globals such as `console` and `process` through default `@types` resolution.
- Which files can import which is controlled by project references. A `composite` project reaches only its own `include` plus the projects it references, so core referencing nothing cannot import from `browser`, and `adapter` referencing only core cannot grow scanner logic.
- Which packages may be imported at all: nothing under `src/` imports a Node package or a `node:` builtin, and build scripts and tests are exempt. Explicit builtin imports fail compilation, because `types: []` keeps the ambient module declarations from `@types/node` out of the program, so `import "node:fs"` cannot resolve. Explicit imports of installed third-party packages compile regardless of project references, because a module specifier that resolves is a module specifier the compiler accepts. That half is enforced by an Oxlint `no-restricted-imports` pattern scoped to `src/` by path glob, rejecting every non-relative specifier outside a named allowlist, and a unit test asserts that the configured rule fires so it can never degrade into a silently ignored configuration.

`ES2025` is chosen for a stated reason: `Set` methods such as `union()`, `intersection()`, and `difference()` map directly onto guard candidate work, and iterator helpers simplify index traversal. Because `lib` asserts availability without providing it, the setting commits the project to a floor of Node 24 and 2025-era browser baselines, recorded alongside the setting and revisited together with it. A development-only tool can hold a higher floor than a shipping library, because the constraint is the environment a developer debugs in.

Typecheck is `tsc --build` at the root, walking the reference graph in dependency order and failing on any violation the compiler can see: a foreign global, a wrong-direction import, or a builtin import. A third-party package import under `src/` typechecks, and only the lint rule fails it, so the merge gate is `vp check` rather than typecheck alone. A flat project would silently drop the import-direction guarantee.

## Alternatives considered

A multi-package workspace was rejected for v0 as ceremony without benefit: versioning, publishing, and cross-package configuration for a tool with one consumer-facing entry point. The reference graph already encodes dependency direction, so a later split under CSSC-126 is mechanical, and lint scope restrictions use path globs rather than package names so the configuration survives that split unchanged.

Lint-based import restrictions as the sole mechanism were rejected: a rule the linter silently ignores reads as enforcement during review and provides none. For the package half of the third dimension the linter is nevertheless the only available mechanism, so the project accepts it there under one condition, which is that a test exercises the configured rule against a violation and fails if the rule stops firing. Attributing that half to the compiler was rejected as inaccurate, because the compiler accepts any import whose module specifier resolves.

## Consequences

- Boundary violations are proven by failing-compilation tests: a DOM global in core, an ambient `process` in core, core importing from browser, adapter importing from browser, and any `src/` file importing a `node:` builtin all fail typecheck. A separate lint-backed test proves that a third-party package import under `src/` fails the merge gate.
- Probe identifier hashing cannot use `node:crypto`, and `crypto.subtle` is both asynchronous and unavailable in core under `types: []`, so core uses a small pure JavaScript hash with a documented algorithm.
- Tests live under `test/` rather than colocated, because a colocated test compiled as part of core loses the runner's globals under `types: []`.
- The package exposes one public entry point, asserted by package-content checks in CI.
