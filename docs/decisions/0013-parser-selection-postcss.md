# 0013 — Parser selection: PostCSS

## Status

Accepted, 2026-07-26.

## Context

The compiler needs a CSS parser, and the plan raised the choice between PostCSS and css-tree as a Phase 0 decision because guessing wrong costs a phase. The plan defines the deciding order: comment fidelity first, because source-local comments are the annotation carrier and therefore this project's hard requirement, and the quality of the value abstract syntax tree second, because locating `<dashed-function>` call sites benefits from one.

The CSSC-002 spike prototyped annotation extraction with postcss@8.5.23 and css-tree@3.2.1 against one fixture covering a rule-level comment, a trailing comment on a single-line declaration, a trailing comment after a multi-line value, a comment preceding an `@function` at-rule, and the decisive case: a trailing comment on a final declaration with the semicolon omitted, `.a { color: red /* css-console: log */ }`. A parser that absorbs that comment into declaration raws rather than emitting a comment node cannot support declaration probes without workarounds.

## Decision

The parser is PostCSS. The spike evidence on the deciding question was one-sided:

- PostCSS emits every comment in the fixture as a first-class comment node with precise start and end positions. In the decisive omitted-semicolon case the rule's children are `["decl", "comment"]`, the declaration ends at 22:15, the comment spans 22:17 to 22:38, and nothing is absorbed into raws or into the value. One uniform association function, next sibling for rule and function probes plus previous sibling on the same end line for declaration probes, associated all five fixture comments correctly with zero special cases.
- css-tree emits no comment nodes anywhere in its abstract syntax tree. Comments are observable only through the out-of-band `onComment` parse callback. In the decisive case both `Declaration.loc.end` and `Value.loc.end` inflate to include the comment, reporting 22:40 where the actual value leaf ends at 22:16, so position-based declaration probes fail without a special-cased descent to the last leaf value child layered on the `onComment` stream. This is exactly the disqualifier the plan names.

On the secondary question the advantage runs the other way, and it is bounded. css-tree's value abstract syntax tree natively located every dashed-function call site in the fixture, including two calls in one declaration value and a call nested inside `calc()`, each with true source positions. PostCSS required a hand-written paren-matching tokenizer of about thirty lines, which located every call site but yields offsets relative to the value string. The production path is `postcss-value-parser`, a small dependency by the PostCSS author that performs this tokenization with `sourceIndex` offsets; mapping to source positions combines `decl.source.start`, the property length, and `decl.raws.between`. This is a chore with a known solution, not a correctness failure, whereas the css-tree comment gap is a correctness problem in the hard requirement.

Both parsers parse `@function` bodies into real declarations, so that case did not differentiate.

## Alternatives considered

css-tree was the serious alternative. It offers a full value abstract syntax tree, a lexer, and syntax definitions backed by mdn-data, and it is the parser used by the sibling project css-property-type-validator, so selecting it would have shared vocabulary across the two projects. It was rejected because it fails the decisive comment-fidelity case, as the evidence in the Decision section records. Selecting PostCSS as the parser does not preclude using css-tree's lexer or the mdn-data definitions later as a data source for the property expansion tables, without making css-tree the primary parser; the plan's default for PostCSS is hand-authored, versioned tables, and CSSC-012 records the final choice of data source.

Hand-rolling a parser was not considered; comment-preserving CSS parsing is a solved problem and reimplementing it answers no review question.

## Consequences

- `postcss` is a dependency of the compiler in core, and `postcss-value-parser` is the planned dependency for call-site tokenization in CSSC-013.
- CSSC-007's contingency, extraction of trailing comments from raw declaration values with its own fixture set, is unnecessary. The adjacency rule works directly on comment nodes.
- The property expansion tables in CSSC-012 default to hand-authored, versioned data in core, with the mdn-data option open as a regeneration source.
- Call-site resolution in CSSC-013 budgets for value tokenization through `postcss-value-parser` rather than receiving a value abstract syntax tree for free.

## Decisions recorded with the scaffold

The plan assigns four further decisions to CSSC-002, and this record captures them so that the scaffold configuration has a stated reason next to each setting.

### Language level and runtime floor

`lib: ["ES2025"]` is a type-level assertion, so the floor it commits to was verified at runtime rather than assumed. On the installed Node v24.18.0, a direct `node -e` check confirmed that `Set.prototype.union`, `intersection`, `difference`, `symmetricDifference`, and `isSubsetOf` all exist and return correct results, and that the iterator helpers `map`, `filter`, `take`, `toArray`, and `Iterator.prototype.drop` are present and working. The Node floor is Node 24, and the browser floor is the 2025-era baseline, which shipped both feature groups across engines, including Safari as the last to ship iterator helpers. The floor and the `lib` value are revisited together, never separately.

### Test location

Tests live under `test/` rather than colocated with source. Core pins `types: []` to keep ambient type packages from reintroducing globals, so a colocated test compiled as part of the core project would lose the test runner's globals and fail to compile. A separate `tsconfig.test.json` gives the suites their own globals without weakening the core boundary.

### Vitest project mechanism

Vite+ 0.2.6 bundles Vitest 4.1.10. Vitest 4 removed the separate workspace file, so multiple suites are declared as a `projects` array inside the `test` configuration block. The Vite+ documentation additionally recommends placing that block in `vite.config.ts` rather than in a standalone `vitest.config.ts`, so the unit and browser projects are configured there. The browser project uses Vitest Browser Mode with the `playwright()` provider from `@vitest/browser-playwright`, which Vite+ declares as a peer dependency and which is therefore installed directly.

### Script naming

The installed Vite+ 0.2.x runs package scripts only through `vp run <name>`; there is no fallback from `vp <name>` to a script. Script names were still chosen so that no script shadows a built-in command with different behavior: `typecheck` runs `tsc --build` across the reference graph, and `stylelint`, `stylelint:fix`, and `e2e` are collision-free. The `test` script delegates to the built-in `vp test`, so both forms behave identically. The `build` script is the one unavoidable collision: the package build is `vp pack`, while the built-in `vp build` is the Vite application build, so the build script must be invoked as `vp run build`. The merge gate is `vp check` for formatting, linting, and type-aware checks, together with `vp run typecheck` for the reference graph and `vp test` for the suites.
