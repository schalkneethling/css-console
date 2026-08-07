# Fixture convention

Fixtures replicate real-world CSS by default, following the fixture philosophy in the implementation plan. A fixture that no author would write teaches nothing about whether the tool works, and it produces tests that pass while the tool fails in practice.

## Fixture sets

Two directories hold the fixture stylesheets used across the unit suites.

- `representative/` carries stylesheets that read like real CSS an author would write: design tokens, component rules, and ordinary css-console annotations placed the way a developer would place them.
- `hardening/` carries edge-case stylesheets that probe boundaries, such as an omitted trailing semicolon or an unusual comment placement. Hardening fixtures are labeled and kept separate from the representative set, so a reader can tell which body of fixtures describes intended behavior and which probes the boundaries.

## Exhaustiveness

Realism governs what a fixture looks like. Exhaustiveness governs how many of them there are, and the two are not in tension:

- Every diagnostic code gains at least one fixture that triggers it, as the issues that exercise each code land.
- Every public field gains at least one positive and one negative case.
- Every expansion table gains a fixture asserting its complete key set, so that additions are caught.
- Every supported pseudo-element, log level, probe kind, and rule context gains its own fixture.
- Every defect gains a regression fixture before the fix.

Where a specification provides examples, those examples are used directly, and where Web Platform Tests cover a behavior, a representative subset is mirrored.
