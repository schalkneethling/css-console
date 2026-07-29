# 0014 — Structural linting with ast-grep

This record explains why the project adds ast-grep as a second, deliberately small lint surface for structural rules the standard linter has no rule for.

## Status

Accepted, 2026-07-29.

## Context

Two classes of defect recurred in review. Contracts declared with `interface` under `src/` violate the convention the type-rather-than-interface record accepts, and the violation surfaces today only through the declaration-merging test suite, which spawns a compiler build and answers in the merge gate rather than at lint time. Synchronous child process calls without a finite `timeout` can hang a suite indefinitely, because a synchronous spawn blocks the event loop and the test runner's own timeout cannot fire while it waits; review caught this class twice. Oxlint carries the standard rules and the package-import boundary, but it has no rule for either structural pattern.

ast-grep lints by structural pattern over the syntax tree, which is exactly the shape of both checks. External review tooling already finds these defects the same way; running the rules locally moves the finding before the pull request instead of after it.

## Decision

The project adds `@ast-grep/cli` as a development dependency with a deliberately small, decision-anchored rule set under `rules/`:

- `no-interface-in-src` fires on any `interface` declaration under `src/`, enforcing the type-rather-than-interface record at lint time. The declaration-merging test suite remains the proof that the guarantee holds at the compiler level; the rule catches the drift earlier.
- `sync-spawn-requires-timeout` fires on `spawnSync`, `execSync`, or `execFileSync` calls whose options carry no `timeout` property.

The scan runs as `vp run lint:structural`, as a staged hook on TypeScript files, and in the merge gate alongside `vp check`. Following the condition the single-package boundary record sets for lint-based enforcement, a test suite runs ast-grep with the project configuration against violating and compliant fixtures and fails when a configured rule stops firing, and one test asserts the working tree itself scans clean.

Every rule added later must name the decision record or review finding it enforces. A rule without an anchor is deleted rather than kept.

## Alternatives considered

Custom Oxlint rules were considered and remain the preferred destination: if Oxlint's custom rule support grows to express these patterns, the ast-grep rules migrate there and the second tool is removed. The small rule count keeps that exit cheap.

Leaving enforcement to external review tooling was rejected because a finding that arrives on the pull request costs a round trip that a local lint catches in seconds.

Extending the spawn-tsc test suites to cover each new structural convention was rejected as the primary mechanism because each suite spawns a build per case, and lint-time feedback is two orders of magnitude faster than merge-gate feedback for the same defect.

## Consequences

- A second linter exists with its own configuration surface. The rule set stays small and decision-anchored to bound the cost.
- The declaration-merging and structural suites overlap on intent for `interface` under `src/`; they answer at different times, and both remain.
- The scan runs on the whole tree in the merge gate and on staged TypeScript files at commit time, so a violation surfaces before a pull request opens.
