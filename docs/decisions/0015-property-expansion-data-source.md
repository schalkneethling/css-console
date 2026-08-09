# 0015 — Property expansion data source: hand-authored, browser-verified

This record captures the CSSC-012 outcome that decision record 0013 left open: where the shorthand, `all`, and logical property expansion tables come from, and how to regenerate or check them.

## Status

Accepted, 2026-08-09.

## Context

The guard's `competing-declaration` reason, described in decision record 0004 and section 3.4 of the implementation plan, needs shorthand and logical expansion to be reliable: a guard that misses `margin` beating `margin-left`, or `inline-size` beating `width`, fails on ordinary CSS. Section 5.7 of the plan left the data source undecided, contingent on the CSSC-002 parser decision: if css-tree had been chosen, its mdn-data-backed syntax definitions might have supplied part of the table; PostCSS, the parser decision record 0013 settled on, carries no such syntax database, so the plan's default for PostCSS is hand-authored, versioned data in core.

## Decision

The tables in `src/core/expansion/index.ts` are hand-authored TypeScript data, and every entry was checked against the installed Chromium through Playwright rather than recalled from memory or transcribed from a specification's prose, following AGENTS.md's instruction to verify behavior against sources. Two verification methods were used, matched to what each table asks:

- **Shorthand-to-longhand.** Setting a shorthand through `HTMLElement.style.setProperty()` on a fresh element and reading `style.item(i)` for `0 <= i < style.length` enumerates exactly the longhands the browser's CSSOM expanded that shorthand into. This caught two facts a specification reading would have gotten wrong: `border` resets the `border-image-*` longhands alongside width, style, and color, and `background` splits into `background-position-x` and `background-position-y` rather than a single `background-position` longhand.
- **Logical-to-physical.** A logical property is not expanded in the inline `style` object the way a physical shorthand is, so this table was verified by setting `writing-mode` and `direction` on an element, setting the logical property, and reading the resolved physical longhand back through `getComputedStyle()`. This is the method that caught `sideways-lr`'s inline axis running in the opposite base direction from `vertical-rl`, `vertical-lr`, and `sideways-rl`, which a reading of the property names alone would not have surfaced.

To regenerate or check either table when a browser update might have changed an expansion, rerun the corresponding method above against the current installed browser and compare the result to the table.

`all`'s exclusions are a third, different case: a predicate rather than an enumerated table. `all` resets every standard CSS property that exists, not a fixed, named family the way `margin` resets four longhands, so hand-authoring a full property list would both turn this module into a general-purpose CSS metadata project, which the issue's judgment guidance rejects, and go stale the day a browser ships a new property. The CSS Cascade specification states a stable exclusion rule instead: every property is reset except `direction`, `unicode-bidi`, and custom properties. `isResetByAll()` implements that rule directly, and the `direction` and custom-property halves were checked in Chromium: `direction: rtl` survives `all: initial` unchanged, and a custom property's value survives the same way.

## Alternatives considered

Deriving the tables from mdn-data at build time was considered, since decision record 0013 left that path open and css-property-type-validator already depends on it. It was rejected for this issue because PostCSS is the selected parser and carries no such database, so pulling in mdn-data would add a dependency and a build step to answer a question a short verification script already answers directly against the actual rendering engine the tool targets. It remains open as a later option if the hand-authored tables become large enough to be a maintenance burden.

Enumerating `all`'s longhand set as a literal array, matching the shape of `SHORTHAND_LONGHANDS`, was considered for consistency and rejected because the set is not the fourteen-entry, human-scale family the shorthand tables are; it is effectively every standard CSS property, which is exactly the general-purpose CSS metadata list the issue's judgment guidance warns against building, and it is also the one table guaranteed to fall out of date as new properties ship.

## Consequences

- A browser update that changes a shorthand's longhand set or a writing mode's physical mapping requires rerunning the verification method above and updating the table by hand; there is no automated regeneration step.
- `isResetByAll()` needs no maintenance when new CSS properties ship, because it is a three-way exclusion rather than an inclusion list.
- The shorthand table covers the fourteen families the plan names and nothing else. A shorthand the guard has not needed yet, such as `border-radius` or `outline`, is added when a guard scenario needs it rather than spent on up front.
