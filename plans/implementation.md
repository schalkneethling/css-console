# CSS Console implementation plan

Status: proposed
Planning date: 2026-07-24
Revision date: 2026-07-25 (revision 5)
Package name: `@schalkneethling/css-console`

## Revision history

**Revision 4** changed the thesis. The tool exists because CSS is becoming computational and has no way to print a value, not because resolved values in general need explaining. Cascade work collapsed from a feature to a guard, function probes became a third probe kind, and the deferred list split three ways.

**Revision 5 keeps that thesis and corrects the plan around it.** The changes are process rules, two corrected specifications, and two decisions raised rather than assumed.

### Decisions raised for Phase 0

Two choices are foundational enough that guessing wrong costs a phase. Both are now spikes in Phase 0 rather than assumptions buried in Phase 1.

**Parser: PostCSS or css-tree.** Revisions 1 through 4 assumed PostCSS, chosen for comment retention. The sibling project [css-property-type-validator](https://github.com/schalkneethling/css-property-type-validator) parses with [css-tree](https://github.com/csstree/csstree), which offers a real value AST, a lexer, and [mdn-data](https://github.com/mdn/data)-backed syntax definitions. A value AST is precisely what locating `<dashed-function>` call sites needs, and the syntax definitions may supply much of the property expansion work. Against that, comment fidelity is this project's hard requirement, and it is not established that css-tree preserves trailing comments with the precision declaration association needs. CSSC-002 prototypes both against one fixture and records the decision.

**Pseudo-element probes.** Revision 4 deferred them, which meant `.element::before` could not be probed at all. The work is small, because selector branch validation already detects pseudo-elements: split the suffix from the branch, match the originating element, and pass the pseudo-element string to `getComputedStyle()`. Generated content sizing and counter values are unknowable from source, so the scope principle argues for inclusion. Revision 5 includes them, and the decision is confirmed.

### Corrected specifications

**Call-site semantics.** Revision 4 stated that nested calls resolve to the outermost occurrence per declaration, which was wrong for the common case. Three distinct rules now apply, set out in the call-site resolution section.

**At-rule annotation targets.** Revision 4 read as a blanket rejection of at-rules other than `@function`, contradicting the reserved category in the same document. Targets now fall into three tiers.

### New process rules

Pull request scope follows [PR.md](https://github.com/schalkneethling/schalkneethling.com/blob/main/PR.md): one pull request answers one primary review question. Implementation halts at defined checkpoints for review and merge before continuing.

All prose, comments, and documentation follow the [MDN writing style guide](https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Writing_style_guide), particularly the [three Cs](https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Writing_style_guide#consider_the_three_cs_of_writing).

Public types use `type` rather than `interface`, so that declaration merging cannot reopen a published contract.

Nothing under `src/` imports a Node package or `node:` builtin.

## 1. Outcome

Build a development-only JavaScript tool that turns inert, source-local CSS comments into live value probes, so that CSS authors can print the values their stylesheets compute.

```css
/* css-console: log */
@function --space(--multiplier) {
  result: calc(var(--multiplier) * 0.25rem);
}

.card {
  padding: --space(4);
  background: color-mix(in oklch, var(--brand) 60%, white); /* css-console: log */
}
```

For each probe the runtime preserves the source annotation, resolves nested selectors, locates the elements or call sites concerned, reads the browser-resolved values, guards against presenting a value the annotated source may not have produced, emits structured records, and renders them through the native Console API.

The v0 milestone is a credible browser experiment and a documented capability argument. It is not a standards proposal, a CSS debugger, or a replacement for browser developer tools.

## 2. What this tool is for

### 2.1 The gap

CSS is becoming programmable. Custom functions shipped in Chromium in 2025; mixins, `@apply`, and `if()` are specified and in progress. Programmable languages are debugged by printing intermediate values, and CSS has never needed that facility because until now it had no intermediate values to print.

Sass reached this point long ago, and the shape of its answer is instructive. Sass has `@debug` and `@warn` for observing values, and Sass True for asserting them. The assertion half already exists as css-expect. CSS Console is the missing `@debug`.

### 2.2 The scope principle

A value is worth probing when it cannot be known from the source text alone, only after the browser has parsed and applied the CSS. That criterion covers custom function return values, `calc()` against relative units and percentages, which bound a `clamp()` landed on, `color-mix()` and relative color syntax, `light-dark()`, container units resolving against whichever container won, custom properties arriving through an inheritance chain, generated content sizing, `random()`, and `if()` branches once they ship.

The criterion is a center of gravity rather than a restriction. A deterministic `calc(2px + 3px)` is not refused. The criterion decides what the demonstration leads with, what the documentation teaches first, and which capability gaps are worth closing.

### 2.3 The litmus test

Before any feature enters the plan, it answers one question: are we reimplementing something browser developer tools already do, or are we enhancing what they offer within the limits of page JavaScript?

A feature that reimplements is rejected. A feature that enhances is considered on its merits.

Enhancement looks like this:

- Developer tools are element-anchored, requiring you to know which element to inspect. An annotation is source-anchored, so it sits where the doubt already is.
- Developer tools show one element at a time. A probe reports every matched element at once, which matters because runtime-computed values differ per element.
- Developer tools show the value. A function probe shows the call, the arguments, and the value, across every call site.
- Developer tools lose their state on reload. An annotation is committed to source, survives refactors, and travels to teammates.

Reimplementation looks like cascade resolution, specificity ranking, layer ordering, and box-model geometry. Those are rejected, and where the tool touches them it hands off rather than answers.

### 2.4 Relationship to css-expect

The two projects are the debug and assert halves of one story, following the Sass precedent of `@debug` alongside Sass True.

[css-expect](https://github.com/schalkneethling/css-expect) runs in Node, drives a browser through Playwright, evaluates CSS in isolation, and asserts expected values. It is a test tool.

CSS Console runs in the page during development, observes values in their real context, and asserts nothing. It is a debugging tool.

Both take the browser engine as the source of truth and neither emulates CSS. Where record shapes can agree without contortion they should, but shared code is not a v0 goal.

### 2.5 What to take from Sass, and what not to

`@debug` prints a value with its source location and inspects rather than stringifies, so structure survives. Both already match this design.

`@warn` carries two lessons. It emits the call chain, and for function probes the direct equivalent is the call-site chain: which function, called from which declaration, in which rule, in which source. That is the context a bare resolved value lacks. It is also silenceable per dependency, which is a lesson learned the hard way, so source-scoped filtering belongs in the configuration from the beginning.

`@error` is deliberately not copied. It aborts compilation, and CSS Console cannot abort anything, because the CSS has already applied by the time the runtime executes. The four levels descend from the Console API, not from Sass, and the documentation says so plainly rather than letting the resemblance imply semantics the tool cannot honor.

## 3. Product contract

### 3.1 v0 user story

As a CSS author, I can annotate the function, declaration, or rule whose computed result I am unsure about, load CSS Console in development, and see what the browser produced for every element or call site concerned, in the same console where I read my JavaScript logs.

### 3.2 v0 syntax

```text
css-console: <level> [property-list] [label="..."]
```

The directive is the literal `css-console`. The colon is required. There is no alias and no configuration in v0.

Levels are `log`, `info`, `warn`, and `error`, mapping to the corresponding Console API methods. They carry no assertion or control-flow semantics.

#### Function probe

A comment immediately preceding an `@function` at-rule.

```css
/* css-console: log label="spacing scale" */
@function --space(--multiplier) {
  result: calc(var(--multiplier) * 0.25rem);
}
```

The runtime locates every call site of `--space` across the scanned sources, matches the rules those calls appear in, and reports the arguments as authored together with the value each matched element resolved.

#### Rule probe

A comment immediately preceding a style rule.

```css
/* css-console: log padding,background-color label="cards" */
.card {
  padding: --space(4);
  background-color: color-mix(in oklch, var(--brand) 60%, white);
}
```

#### Declaration probe

A trailing comment following a declaration, on the same line as that declaration's end position.

```css
.avatar {
  inline-size: calc(50cqi - 1rem); /* css-console: log */
}
```

The end position is the terminating semicolon where one exists, and the final token of the value where it does not, because CSS permits omitting the semicolon on the final declaration in a block. In that case the next token is the closing brace, and the annotation sits between the value and that brace.

```css
.a {
  color: red; /* css-console: log */
}
```

#### Placement rules

- A rule probe without a property list selects declarations authored directly in that rule.
- A property list on a declaration probe is rejected as ambiguous.
- A property list on a function probe is rejected, because the call sites determine the properties.
- A selector carrying a pseudo-element produces a pseudo-element probe, described in the evaluation section.
- `label` is optional everywhere.
- Unknown levels or options produce diagnostics.
- Executable JavaScript is never accepted.
- `watch` is reserved until live mode and produces a clear diagnostic in v0.

Requiring the colon makes accidental matching against ordinary prose comments effectively impossible without adding grammar complexity.

### 3.3 Annotation targets

At-rule targets fall into three tiers, and each tier produces a different diagnostic, because a browser gap and a design decision are not the same message.

| Tier                     | At-rules                                | Behavior                                                      |
| ------------------------ | --------------------------------------- | ------------------------------------------------------------- |
| Supported                | `@function`                             | Compiles to a function probe                                  |
| Reserved pending support | `@mixin`, `@apply`, `@contents`, `@env` | Parses, then reports that the browser does not yet support it |
| Not a target by design   | `@media`, `@supports`, `@layer`         | Reports that grouping constructs are not annotation targets   |

Targets rejected by design carry remediation rather than a bare refusal: annotate the rules inside the grouping construct.

### 3.4 The guard

The guard exists so the tool never presents a value as though the annotated source produced it when something else may have. It does not resolve the cascade, rank declarations, or name a winner. When it fires, the remediation is the live element in the console, one click from developer tools.

```ts
type GuardReason =
  | "competing-declaration"
  | "inline-style"
  | "important"
  | "animation-or-transition"
  | "unresolved-variable";

type ValueGuard = {
  contested: boolean;
  reasons: readonly GuardReason[];
};
```

`competing-declaration` requires shorthand and logical expansion to be reliable, because a guard that misses `margin` beating `margin-left`, or `width` beating `inline-size`, fails on ordinary CSS. It requires nothing beyond a boolean answer, so no counts, locations, or ranking are produced.

`unresolved-variable` is checked directly. For an authored value referencing `var(--x)`, an empty result from `getPropertyValue("--x")` on that element means the reference fails and the declaration is invalid at computed-value time, so the value arrived by inheritance or from the initial value rather than from this declaration.

### 3.5 Record contracts

Core types cannot reference the DOM, so records are generic over their target and the browser layer supplies the concrete type. Every public type is declared with `type` rather than `interface`, so that declaration merging cannot reopen a published contract.

```ts
type LogLevel = "log" | "info" | "warn" | "error";

type ProbeValue = {
  name: string;
  authored: string;
  resolved: string;
  guard: ValueGuard;
};

type ValueRecord<TTarget> = {
  kind: "value";
  probeId: string;
  level: LogLevel;
  label?: string;
  selector: string;
  target: TTarget;
  pseudo: string | null;
  source: SourceLocation;
  values: readonly ProbeValue[];
  timestamp: number;
};

type CallSite = {
  property: string;
  arguments: readonly string[];
  /**
   * True when the call is the entire declaration value. When false the
   * resolved value includes the surrounding expression, so it is the
   * property's value rather than the function's isolated return value.
   */
  isolated: boolean;
  selector: string;
  source: SourceLocation;
};

type FunctionRecord<TTarget> = {
  kind: "function";
  probeId: string;
  level: LogLevel;
  label?: string;
  functionName: string;
  definition: SourceLocation;
  callSite: CallSite;
  target: TTarget;
  pseudo: string | null;
  resolved: string;
  guard: ValueGuard;
  timestamp: number;
};

type ProbeRecord<TTarget> = ValueRecord<TTarget> | FunctionRecord<TTarget>;
```

`isolated` is the honesty field. A declaration reading `padding: --space(4)` yields the function's return value. A declaration reading `padding: calc(--space(4) + 2px)` does not, and the record says so rather than implying a return value the tool cannot isolate.

Isolating a nested call would require synthesizing a probe element carrying the original element's custom property context, which conflicts with the read-only guarantee. css-expect isolates properly, off-page, and is the right tool for that question.

`values` is an ordered array, because an explicit property list must preserve requested order and a plain object does not express that in the type system.

Diagnostics carry a stable documentation anchor:

```ts
type Diagnostic = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  docsUrl: string;
  source?: SourceLocation;
  details?: Record<string, unknown>;
};
```

### 3.6 Scan summary

```ts
type ScanSummary<TTarget> = {
  sources: { discovered: number; compiled: number; failed: number; excluded: number };
  probes: { compiled: number; evaluated: number; skipped: number };
  matches: { total: number; evaluated: number; omitted: number };
  records: ReadonlyArray<ProbeRecord<TTarget>>;
  diagnostics: readonly Diagnostic[];
  durationMs: number;
};
```

The summary carries records, so a simple consumer never needs to subscribe.

### 3.7 Public API

```ts
import { createCSSConsole } from "@schalkneethling/css-console";

const cssConsole = createCSSConsole({
  sources: "document",
  exclude: ["**/design-system/**"],
  maxElements: 50,
  waitForFonts: false,
});

const unsubscribe = cssConsole.subscribe((event) => {
  // event is a record, diagnostic, or scan summary
});

const result = await cssConsole.scan();
cssConsole.dispose();
```

`exclude` exists from the first release rather than being added under pressure. Annotations shipped inside a dependency's CSS are the browser equivalent of the dependency warnings Sass learned to silence.

The package exposes one public entry point. Internal directories are reached through relative imports, never through published subpath exports.

### 3.8 Element retention

Browser records hold live `Element` references so that developer tools render them as inspectable nodes. A subscriber that accumulates records into a long-lived array keeps those elements alive, including elements since removed from the document. This is documented as a consumer responsibility rather than solved in v0, because a weak reference would defeat the inspection behavior that motivates the tool.

## 4. Explicit scope

### 4.1 Included in v0

- TypeScript and native ESM
- Function, rule, and declaration probes
- Pseudo-element probes
- Custom function call-site resolution and per-call-site reporting
- Inline `<style>` elements, same-origin linked stylesheets, and explicit raw sources
- Source-level media and disabled gating, and source exclusion by pattern
- Ordinary style rules, selector lists, and CSS nesting resolution
- Authored and resolved string values
- The contested guard, with shorthand, logical, and `all` expansion
- Custom properties
- Multiple matched elements
- Live `Element` references handed to the Console API
- Source locations
- Output limiting and one-shot scans
- `@media` and `@supports` gates, transparent `@layer` traversal
- A demonstration page and a written capability argument

### 4.2 Reserved pending browser support

Specifications exist for these features. Their API shape, record fields, and diagnostics are designed in v0. The runtime feature-detects and reports that the browser does not yet support them, which is a different message from a feature the project chose not to build.

- `@mixin` and `@apply`
- `@contents`
- `@env`
- `if()` branch reporting
- `@supports at-rule()` for capability gating

`@apply` deserves a design note. It injects declarations that are not present at the call site in source text, so anything built on the premise that source text describes what is on an element has a shelf life. The guard is deliberately small partly for this reason.

### 4.3 Deferred by choice

- `watch` and value diffs
- Shadow DOM and closed roots
- Cross-origin sources without CORS access
- Recursive `@import`
- Constructed stylesheets without registered source text
- `@container` and `@scope` evaluation
- CSS Modules, preprocessor mapping, and source maps
- Geometry probes
- Typed Object Model as a required feature
- Browser extensions and bundler integration
- Splitting the workspace into multiple published packages

### 4.4 Out of reach from page JavaScript

These cannot be delivered from a script running in the page. They are documented in the capability write-up as the argument for what only the engine can provide.

- Which branch inside a custom function body produced `result`
- Full cascade provenance: specificity ranking, layer ordering, order of appearance
- User-agent and user-origin stylesheets
- Presentational hints from HTML attributes
- The contribution of a running transition or animation to a value

Unsupported constructs are diagnosed. They never silently produce misleading output.

## 5. Architecture

### 5.1 Workspace

One package, one root manifest, one public entry point, internal boundaries expressed through TypeScript project references.

```text
css-console/
  package.json
  tsconfig.base.json
  tsconfig.json                 solution file: files: [], references only
  tsconfig.test.json
  vitest.config.ts
  playwright.config.ts
  PR.md                         pull request guidance
  CONTRIBUTING.md
  src/
    core/
      tsconfig.json             composite, no DOM, no ambient types, no references
      annotations/
      compiler/
      nesting/
      functions/
      expansion/
      records/
      diagnostics/
    browser/
      tsconfig.json             composite, DOM, references core
      sources/
      conditions/
      matcher/
      evaluator/
      guard/
      scanner/
    adapter/
      tsconfig.json             composite, DOM, references core
    index.ts
  test/
    unit/
    browser/
    e2e/
  examples/
    playground/
  fixtures/
    css/
    pages/
  docs/
    decisions/
    capabilities.md
```

### 5.2 Boundary enforcement

The boundary has three dimensions. The compiler enforces all three, so no linter participates in the guarantee.

**Which globals exist** is controlled by `lib` and `types`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "lib": ["ES2025"],
    "types": []
  },
  "include": ["."],
  "references": []
}
```

Removing the DOM library alone is insufficient, because ambient type packages reintroduce globals such as `console` and `process` through default `@types` resolution. Pinning `types` to an empty array closes that path.

The `lib` value is `ES2025`, chosen for a stated reason rather than by habit. `Set` methods such as `union()`, `intersection()`, and `difference()` map directly onto guard candidate work, and iterator helpers simplify index traversal, so the higher level pays for itself rather than being aspirational.

`lib` is a type-level assertion and nothing more. It tells the compiler which built-ins exist; it does not polyfill them, so code that compiles will still fail at runtime if the runtime lacks the method. Selecting `ES2025` therefore commits the project to a floor, and that floor is Node 24 and 2025-era browser baselines. That gives comfortable headroom rather than a tight fit: `Set` methods and iterator helpers landed well inside it across engines, including Safari, which was the last to ship iterator helpers. Record the floor alongside the setting, and revisit both together rather than separately, because a `lib` value that outruns its floor fails in production while passing every type check.

A development-only tool can hold a higher floor than a shipping library, because the constraint is the browser and runtime a developer debugs in rather than whatever the application supports.

**Which files can import which** is controlled by project references. A `composite` project reaches only its own `include` plus the projects it references, so core referencing nothing cannot import from `browser`, and `adapter` referencing only core cannot grow scanner logic.

**Which packages may be imported at all.** Nothing under `src/` imports a Node package or a `node:` builtin. Core is additionally protected by `types: []`, which removes Node's ambient declarations, but `browser` and `adapter` carry DOM types and would otherwise accept a `node:fs` import without complaint. Build scripts and tests are exempt.

This rule has one consequence worth stating in advance: probe identifier hashing cannot use `node:crypto`, and `crypto.subtle` is both asynchronous and unavailable in core under `types: []`. Core therefore uses a small pure JavaScript hash with a documented algorithm.

`typecheck` is `tsc --build` at the root, walking the graph in dependency order and failing on any violation in any dimension.

Lint-based import restrictions are useful reinforcement but are not a mechanism here. Two rules hold regardless of linter: scope restrictions by path glob rather than by package, so the configuration survives a later split unchanged; and never configure a rule the linter silently ignores, since a dead rule reads as enforcement during review and provides none.

### 5.3 Parser selection

This decision is unresolved and belongs to CSSC-002.

[PostCSS](https://postcss.org/api/) retains comment nodes with source positions, which is this project's hard requirement, and its rule and declaration walking is straightforward.

[css-tree](https://github.com/csstree/csstree) offers a full value AST, a lexer, and syntax definitions backed by [mdn-data](https://github.com/mdn/data). A value AST is what locating `<dashed-function>` call sites actually wants, rather than tokenizing declaration values by hand, and the syntax definitions may supply part of the property expansion work. It is also what css-property-type-validator uses, so choosing it would share vocabulary across the two projects.

The deciding question is comment fidelity, specifically whether trailing comments survive with the precision that declaration association needs, including the case of a final declaration with no semicolon. CSSC-002 prototypes both against one fixture covering rule-level comments, trailing comments, trailing comments after multi-line values, and trailing comments with the semicolon omitted, and records the outcome as a decision record.

### 5.4 Data flow

```text
CSS source text
  → parser AST
  → annotation parser
  → nesting resolver
  → probe compiler (rule, declaration, function)
  → call-site resolver
  → condition gate
  → selector matcher
  → resolved-value evaluator
  → contested guard
  → structured event stream
  → Console API adapter
```

### 5.5 Nesting resolution

Nesting resolution happens in core, on the parsed tree, before probe compilation.

A transform plugin is deliberately not used as a pre-pass. Any transform that relocates or drops comment nodes destroys annotation association, which is the regression that would bite hardest. Resolution is performed manually against the parent chain.

The resolution rules are:

- A branch containing no nesting selector is treated as though the nesting selector were prepended with a descendant combinator, so `.card { .title { } }` resolves as `& .title`.
- The nesting selector represents the parent selector list and behaves as `:is(parentList)` for both matching and specificity. Substituting `:is(...)` produces a flat selector that `querySelectorAll()` handles correctly and whose specificity matches the specification.
- `@nest` was removed from the specification and is not supported.
- Conditional ancestors interleave with nesting, so the ancestor chain walks a mixed stack of rules and at-rules rather than a flat prelude.

Reference: [CSS nesting](https://drafts.csswg.org/css-nesting/).

### 5.6 Call-site resolution

A function probe annotates a definition, but values are observable only where the function is called. Three rules apply, and they are distinct.

**Every call in a declaration value is its own call site.** A declaration reading `margin: --space(1) --space(2)` produces two call sites, not one. Revision 4 stated the opposite and was wrong.

**A call passed as an argument to another call records the outer call.** In `--space(--double(2))`, the call site for a probe on `--space` is the outer call, with `--double(2)` captured verbatim as the authored argument.

**A call inside another function body is a definition reference, not a call site.** Custom functions may call other custom functions, so `@function --a() { result: --b(2); }` is valid, but the inner call has no independently observable value; only the outer function's result appears at a call site. These are recorded as definition references and reported separately.

For each call site the compiler records the containing rule's resolved selector, the declaration property, the arguments as authored, and whether the call constitutes the entire declaration value.

Reference: [CSS custom functions and mixins](https://drafts.csswg.org/css-mixins-1/).

### 5.7 Property expansion

Competition detection matched on literal property names would miss the two most ordinary conflicts in real stylesheets, so expansion closes that gap.

**Shorthand to longhand.** An annotated `margin-left` must see a competing `margin` declaration.

**`all` to every longhand**, with documented exclusions.

**Logical to physical**, which depends on the element's writing mode and direction and therefore resolves at evaluation time rather than compile time. Core supplies the mapping; the browser layer applies it per element using the computed style declaration it already holds.

Matching is bidirectional. An annotated longhand must see competing shorthands, and an annotated shorthand must see competing longhands.

The data source for these tables is undecided and depends on the parser decision. If css-tree is selected, its mdn-data-backed definitions may supply part of the table. If PostCSS is selected, the tables are hand-authored and versioned. Either way the tables are data in core with fixtures asserting their complete key sets.

Reference: [CSS logical properties](https://drafts.csswg.org/css-logical-1/).

### 5.8 Pseudo-element probes

Pseudo-element probes are in v0.

A selector branch carrying a pseudo-element is split: the originating element selector is matched with `querySelectorAll()`, and the pseudo-element string is passed as the second argument to `getComputedStyle()`. The `pseudo` field on the record carries the pseudo-element, and is `null` for ordinary probes.

Supported in v0: `::before`, `::after`, `::marker`, `::first-line`, `::first-letter`, `::placeholder`, `::selection`, `::backdrop`. Deferred: `::part()` and `::slotted()`, which require shadow DOM, and any pseudo-element chain.

A pseudo-element that generates no box still returns computed values, which is documented rather than treated as a defect.

Reference: [CSS pseudo-elements](https://drafts.csswg.org/css-pseudo-4/).

### 5.9 Read-only guarantee

The scanner never writes to the document. Source identity uses a `WeakMap` for stability within an instance plus a content hash for stability across reloads, rather than stamping attributes. A browser contract test asserts markup equality before and after a scan.

### 5.10 Condition and rule-context behavior

`@media` is active when `matchMedia(query).matches`. `@supports` is active when `CSS.supports(condition)` returns true. `@layer` does not affect matching and is retained as optional metadata. Unsupported rule contexts produce `UNSUPPORTED_RULE_CONTEXT` naming the at-rule in details, and skip: these are `@container`, `@scope`, `@starting-style`, and `@keyframes`.

`@scope` deserves particular attention. Its matching semantics cannot be reproduced by a plain `querySelectorAll()` call, so a scoped probe would silently over-match rather than fail loudly. Skipping with a diagnostic is the only truthful behavior available in v0.

### 5.11 Failure model

Fault isolation is by source and by probe. A malformed annotation does not prevent others from compiling. An inaccessible stylesheet does not prevent inline CSS from being scanned. An invalid selector branch does not discard valid branches. A property evaluation failure affects only that property and element. Configuration errors fail construction.

## 6. Console adapter

The adapter uses the Console API as a first-class rendering target rather than as a printing fallback. That is what puts CSS values in the same place as JavaScript logs.

**Never monkey-patch.** The adapter calls the Console API. It does not wrap, replace, intercept, or proxy `console`. This is stated as a rule because bridging into the Console API invites the opposite reading.

**Method mapping.** Levels map to `console.log()`, `console.info()`, `console.warn()`, and `console.error()`. Probes render inside `console.groupCollapsed()`. Scan duration uses `console.time()` and `console.timeEnd()`. Function probes may use `console.count()` to tally call sites.

**Tables for multiplicity.** One property across many elements renders through `console.table()`, which is the common shape under the scope principle, because runtime-computed values differ per element. A table with one row per element is legible at fifty rows where fifty grouped log lines are not.

**Live elements always.** Every record passes its `Element` as an argument so that developer tools render it inspectable. This is the handoff, and it is not optional.

**`%c` for color swatches only.** Styling never carries meaning on its own, but a rendered swatch beside a `color-mix()` or relative color result conveys something no text can, and directly serves the scope principle. Any information a swatch carries is also present as text.

**Adapter failure cannot break scanning.** Rendering runs behind isolation, so a throwing console method degrades the output and nothing else.

Reference: [Console API](https://developer.mozilla.org/en-US/docs/Web/API/console).

## 7. Working agreements

### 7.1 Pull request scope

Pull request scope follows the project's [PR guidance](https://github.com/schalkneethling/schalkneethling.com/blob/main/PR.md), copied into this repository as `PR.md` and read when scoping an issue, planning a task, or starting an implementation.

The governing heuristic is that one pull request answers one primary review question. For this project those questions look like: does the grammar accept exactly the intended annotations; does association attach annotations to the intended targets; does call-site resolution find every call and no others; does the guard fire when and only when something competes; does the adapter render legibly at scale.

Work splits along independently mergeable behavior boundaries rather than file counts. Each merge leaves the default branch working, testable, and not misleading. Tests and the documentation needed to use a change belong with that change, and they count toward the amount a reviewer must hold in mind.

Reassess and re-scope when the implementation grows beyond the stated acceptance criteria, when the change starts answering several independent review questions, when the description needs unrelated sections, or when a safe independently testable seam becomes apparent. If splitting would leave a pull request broken or impossible to validate, keep the pieces together and explain the constraint.

### 7.2 Review checkpoints

Implementation halts at each checkpoint and does not continue until the work is reviewed, approved, and merged.

Checkpoints are the phase boundaries, plus these within-phase points where a wrong decision would propagate:

- after CSSC-002, because the parser decision and the boundary configuration shape everything downstream;
- after CSSC-004, because the diagnostic registry and fixture conventions are inherited by every later issue;
- after CSSC-013, because call-site resolution defines the differentiating capability;
- after CSSC-023, because the record contract stabilizes there.

At each checkpoint the summary states what changed, how it was tested, and what was deliberately deferred, and follow-up issues exist for the deferred work.

### 7.3 Writing standards

All prose, code comments, commit messages, and documentation follow the [MDN writing style guide](https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Writing_style_guide), and this plan is held to the same standard.

The [three Cs](https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Writing_style_guide#consider_the_three_cs_of_writing) govern: write clearly, using active voice, unambiguous pronouns, short sentences, and one idea per sentence; write concisely, because excessive detail makes a page tedious and rarely used; write consistently, using the same terms throughout.

Specific rules that apply frequently in this project:

- Use American spelling.
- Avoid directional language such as "above", "below", or "here". Refer to sections by title, and to examples by what they demonstrate.
- Refer to things by name rather than by position. Ordinal back-references such as "the first answer", "the third tier", or "the latter" make a reader re-count an enumeration, and they break silently when that enumeration is reordered. Name the branch, the tier, or the item instead.
- Use descriptive link text rather than "click here" or "this article".
- Use the serial comma.
- Use straight quotes and apostrophes, never curly ones, because curly characters copied from documentation into code do not work.
- Use commas in numbers only from five digits upward, so 1000 rather than 1,000.
- In running prose, prefer "for example" and "and so on" to their Latin abbreviations.
- Use sentence-style capitalization in headings, and do not begin a heading with an article.
- Do not place a heading immediately after another heading with no text between them.
- Expand an unfamiliar acronym on first use.

Two project-specific deviations are recorded deliberately. MDN permits contractions; this project does not use them. MDN prefers the word "parameters" over "arguments"; this project uses "parameters" for the values a function definition declares and "arguments" for the values a call site passes, because the distinction is load-bearing in the call-site record.

### 7.4 Fixture philosophy

Fixtures replicate real-world CSS by default. A fixture that no author would write teaches nothing about whether the tool works, and it produces tests that pass while the tool fails in practice.

Edge-case fixtures exist and are valuable, but they are labeled as hardening fixtures and kept separate from the representative set, so that a reader can tell which body of tests describes intended behavior and which probes the boundaries.

Exhaustiveness is not in tension with realism, because the two apply to different axes. Realism governs what a fixture looks like. Exhaustiveness governs how many of them there are:

- Every diagnostic code has at least one fixture that triggers it.
- Every public field has at least one positive and one negative case.
- Every expansion table has a fixture asserting its complete key set, so that additions are caught.
- Every supported pseudo-element, level, probe kind, and rule context has its own fixture.
- Every defect gains a regression fixture before the fix.

Where a specification provides examples, those examples are used directly, and where Web Platform Tests cover a behavior, a representative subset is mirrored.

## 8. Test strategy

### 8.1 Lanes

| Lane             | Environment                         | Covers                                                                                          | Does not cover                 |
| ---------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------ |
| Unit             | Vitest in Node                      | Grammar, association, nesting, call-site resolution, expansion, compilation, types, diagnostics | Browser CSS behavior           |
| Browser contract | Vitest Browser Mode with Playwright | Matching, `getComputedStyle()`, custom functions, pseudo-elements, guard, read-only guarantee   | Full consumer setup            |
| End-to-end       | Playwright against playground       | Real stylesheet loading, public API, console output, error cases                                | Exhaustive parser combinations |
| Static           | `tsc --build`, package checks       | API integrity, global isolation, import direction, forbidden package imports                    | Runtime behavior               |

Browser behavior runs in real browsers through [Vitest Browser Mode](https://main.vitest.dev/guide/browser/).

Custom function tests require a browser with native `@function` support. Because this is a development-only tool, Chromium-only availability is not a blocker, since the browser a developer debugs in is the browser that matters. Function contract tests feature-detect and skip elsewhere, and skipped coverage is reported rather than silent.

### 8.2 Red, green, refactor protocol

Red: add the smallest fixture expressing one observable behavior, write a failing test against a public boundary, run the narrow command, capture the failure reason, and confirm it fails for the intended missing behavior rather than for setup.

Green: implement the smallest change that passes, run the narrow test, then the affected suite, and add no behavior the test does not require.

Refactor: remove duplication and improve names without changing behavior, run affected suites, add characterization tests before altering unclear behavior, and update documentation when the contract changed.

Each issue normally produces at least two commits:

```text
test(scope): specify expected behavior
feat(scope): implement expected behavior
```

### 8.3 Quality rules

- Assert public results and emitted diagnostics, not private helper calls.
- Use exact diagnostic codes, and avoid full-message snapshots.
- Do not snapshot console formatting as one string. Assert method, group label, live element argument, and table data separately.
- Never mock `getComputedStyle()` in browser contract tests.
- Freeze time only for deterministic timestamps.
- Test match order as document order.
- Test limits at 0, 1, exactly the match count, and below the match count.
- Flaky browser tests block merging. Retries may collect evidence, but they do not convert failures into success.

### 8.4 Commands

The command runner is `vp`, matching the project's move to Vite+.

Some scripts need `vp run <name>` rather than `vp <name>`, because a script target in `package.json` can collide with a Vite+ default command name. Prefer script names that avoid the collision entirely, so that the direct form works and contributors do not have to remember which scripts are special. Where a collision is unavoidable, note it in the README beside the command.

The shape is:

```text
vp test
vp run typecheck   # tsc --build, walking the reference graph
vp run lint
vp run build
vp check           # the merge gate, running everything above
```

Typecheck must build the reference graph rather than a flat project, because a flat project silently drops the import-direction guarantee.

## 9. Definition of done

An issue is done when its acceptance tests first failed for the expected reason, the implementation makes them pass, affected regression suites pass, public types and documentation agree, introduced diagnostics are documented with anchors, the change answers one review question, accessibility and reduced-motion concerns are handled where UI is involved, prose meets the writing standards, and the issue carries a short red, green, refactor evidence note.

A phase is done when its exit demonstration and the full merge gate pass from a clean checkout, and the phase checkpoint has been reviewed and merged.

## 10. Phased roadmap

## Phase 0 — foundation, decisions, and executable contracts

Exit criteria: the parser decision is made and recorded; the package installs, builds, and runs Node and browser smoke tests; all three boundary dimensions are compiler-enforced and proven by failing-compilation tests; public types and fixture conventions exist; CI runs the merge gate.

### CSSC-001 — Record architecture decisions

Labels: `phase-0`, `docs`, `architecture`

Write decision records for: the scope principle and the litmus test; raw source plus live DOM; manual nesting resolution rather than a transform pre-pass; the guard as a guard rather than a cascade feature; function probes as a third probe kind; pseudo-element probes in v0; the Console API as a first-class target; the three-way scope split; the three-tier at-rule target model; single package with compiler-enforced boundaries; `type` rather than `interface` for public contracts; and the relationship to css-expect.

Acceptance: each record captures context, decision, alternatives, and consequences. Every entry in the reserved and out-of-reach scope lists has a corresponding record or follow-up issue.

### CSSC-002 — Decide the parser, then scaffold

Labels: `phase-0`, `build`, `spike`

**Review question**: is the foundation correct?

Spike first. Prototype annotation extraction with both PostCSS and css-tree against one fixture covering a rule-level comment, a trailing comment, a trailing comment after a multi-line value, and a trailing comment on a final declaration with the semicolon omitted. The last case is decisive, because a parser that absorbs that comment into declaration raws rather than emitting a comment node cannot support declaration probes without workarounds. Record the outcome as a decision record before writing production code.

Red: import smoke test for the public entry point; browser smoke test proving `window`, `document`, and real `getComputedStyle()`; static tests asserting that a DOM global in core fails typecheck, that an ambient global such as `process` in core fails typecheck, that core importing from browser fails, that adapter importing from browser fails, that any `src/` file importing a `node:` builtin fails, and that browser importing from core succeeds.

Green: manifest, base and solution configurations, three composite project configurations, test configuration, Vitest projects, Playwright configuration, build scripts, and `PR.md`.

Decisions recorded here rather than deferred: the parser; confirmation that the Node and browser floors actually support `lib: ["ES2025"]`, since that setting asserts availability without providing it; tests living under `test/` rather than colocated, because core pins `types: []` and a colocated test compiled as part of core loses the runner's globals; whether the installed Vitest expects a `projects` array or a workspace file; and script names chosen to avoid collisions with Vite+ default command names, so that `vp <name>` works without the `vp run` form.

**Checkpoint. Stop for review and merge.**

### CSSC-003 — Define public types and event contracts

Labels: `phase-0`, `core`, `api`

Red: type tests for `ValueRecord`, `FunctionRecord`, the `ProbeRecord` union, `CallSite`, `ValueGuard`, `Diagnostic`, and `ScanSummary`; assert records are constructible in core without the DOM library; assert the browser aliases resolve the target to `Element`; assert `values` is an ordered readonly array; assert `pseudo` accepts `string | null`; assert the record union discriminates exhaustively on `kind`; assert every public contract is declared with `type` so that declaration merging is rejected.

### CSSC-004 — Fixture builders and the diagnostic registry

Labels: `phase-0`, `testing`, `core`

Red: deterministic source URLs, locations, and codes in fixture tests; assert every code has a severity, a documented meaning, and an anchor; assert codes for reserved-pending-support features are distinguishable from codes for deferred features and from codes for targets rejected by design.

Establish the fixture conventions described in the fixture philosophy: a representative set that reads like real CSS, and a separately labeled hardening set.

**Checkpoint. Stop for review and merge.**

## Phase 1 — parser and compiler

Exit criteria: representative fixtures compile to stable probes of all kinds; call sites resolve correctly; invalid or unsupported annotations produce precise diagnostics; no CSS is evaluated.

### CSSC-005 — Parse the annotation grammar

Labels: `phase-1`, `core`, `parser`

**Review question**: does the grammar accept exactly the intended annotations?

Red cases: all four levels; comma-separated properties; quoted labels containing spaces; whitespace variations; a missing colon must not parse; ordinary prose comments must not parse; missing level; unknown level; unknown option; duplicate option; reserved `watch`.

### CSSC-006 — Associate rule and at-rule annotations

Labels: `phase-1`, `core`, `parser`

**Review question**: do annotations attach to the intended targets?

Red cases: a comment immediately preceding a style rule attaches; a comment immediately preceding `@function` attaches as a function probe; an unrelated comment between annotation and target prevents attachment; whitespace-only separation attaches; an end-of-file annotation reports no target; annotations preceding `@mixin`, `@apply`, `@contents`, and `@env` each report the reserved-pending-support code; annotations preceding `@media`, `@supports`, and `@layer` report the not-a-target code with remediation naming the rules inside; annotations preceding `@keyframes` and `@container` report unsupported rule context.

Acceptance: the three tiers produce three distinguishable diagnostics, and no tier is silently conflated with another.

### CSSC-007 — Associate declaration annotations

Labels: `phase-1`, `core`, `parser`

Adjacency is the next non-whitespace token following the declaration's end position, on the same line as that end position, where the end position is the terminating semicolon if present and otherwise the final token of the value.

The omitted-semicolon case needs verification before implementation, and CSSC-002 provides it: confirm that the selected parser emits a separate comment node for `.a { color: red /* css-console: log */ }` rather than absorbing the comment into the declaration. If it absorbs, this issue implements extraction from the raw value and gains its own fixtures for that path.

Red cases: single-line declaration; multi-line value; final declaration with no semicolon; a comment on the following line does not masquerade as trailing; a custom property attaches; no target reports a diagnostic; a property list is rejected as ambiguous.

### CSSC-008 — Compile rule probe properties

Labels: `phase-1`, `core`, `compiler`

Red cases: no property list selects declarations authored directly in the rule; an explicit list preserves requested order; a missing requested property produces a diagnostic; repeated declarations use the last authored value with an informational diagnostic; vendor-prefixed and custom properties retain exact names; `!important` is captured; `var()` references are extracted, including nested and fallback forms.

### CSSC-009 — Split and validate selector branches

Labels: `phase-1`, `core`, `compiler`

Red cases: a single selector; a comma-separated list; commas inside functional pseudo-classes; escaped identifiers; an empty branch; a branch carrying a supported pseudo-element; a branch carrying `::part()` or `::slotted()`; a branch carrying a pseudo-element chain.

Acceptance: valid branches retain source order; supported pseudo-elements are split into an originating selector plus a pseudo-element string; deferred pseudo-elements produce a deferred-feature diagnostic; one unsupported branch does not erase valid branches.

### CSSC-010 — Resolve nested selectors

Labels: `phase-1`, `core`, `compiler`, `nesting`

Red cases: leading, trailing, and compound nesting selectors; implicit descendant prepending; leading `>`, `+`, and `~` combinators; a nesting selector inside a functional pseudo-class; a multi-branch parent producing `:is()` wrapping; a parent list containing a pseudo-element; three levels of nesting; selector lists at both levels; declarations appearing after nested rules; nested group rules; `&&`; the invalid `&Bar` against the valid `Bar&`; a nested rule inside `@media` inside a rule; and a fixture asserting that annotation line and column are unchanged after resolution.

Verify the declarations-after-nested-rules behavior against current specification text before writing that fixture. Mirror a representative subset of Web Platform Tests.

### CSSC-011 — Compile rule-context metadata

Labels: `phase-1`, `core`, `compiler`

Red cases: a rule inside `@media`, `@supports`, nested combinations, `@layer`, `@container`, `@scope`, `@starting-style`, and `@keyframes`; a mixed stack of nested rules and at-rules; a style rule inside a `@function` body.

### CSSC-012 — Build the property expansion tables

Labels: `phase-1`, `core`, `expansion`

Pure data plus lookup logic, sized for the guard rather than for presentation. The data source depends on the CSSC-002 parser decision, and this issue records which source was used and how the tables are regenerated.

Red cases: each shorthand family expands to its longhands, with fixtures for `margin`, `padding`, `border`, `border-width`, `background`, `font`, `flex`, `grid`, `grid-template`, `inset`, `gap`, `overflow`, `place-items`, and `transition`; `all` expands to the full longhand set with documented exclusions; custom properties never expand; unknown properties pass through; expansion is bidirectional; the logical table returns the correct physical group for each writing mode and direction combination.

Acceptance: the logical table returns a mapping function rather than a resolved name, because resolution requires the element's writing mode; every table has a fixture asserting its complete key set.

### CSSC-013 — Resolve custom function call sites

Labels: `phase-1`, `core`, `functions`

**Review question**: does call-site resolution find every call and no others?

This is the differentiating capability, and it has no browser dependency.

Red cases: a single call site; multiple call sites across rules; two calls to the same function in one declaration value producing two call sites; a call whose value is the entire declaration sets `isolated: true`; a call nested in `calc()` sets `isolated: false`; a call passed as an argument to another call records the outer call with the inner captured verbatim; a call inside another function body is recorded as a definition reference rather than a call site; arguments captured as authored, including `var()` references; a function with no call sites produces an informational diagnostic rather than silence; a call site inside an unsupported rule context is excluded; name matching is case-sensitive, matching dashed-ident rules.

Acceptance: call-site resolution runs after nesting resolution, so recorded selectors are flat; a function probe with zero call sites is reported, because that is itself a useful debugging answer.

**Checkpoint. Stop for review and merge.**

### CSSC-014 — Index declarations for the guard

Labels: `phase-1`, `core`, `compiler`

The index answers one question: does anything else declare this property. It stores what a boolean needs and nothing more.

Red cases: a source with no annotations still contributes; a declaration is findable under each expanded longhand key; a shorthand is findable under all its longhand keys; `all` is findable under every key; logical declarations defer to per-element resolution; declarations inside inactive conditions retain their conditions; declarations inside unsupported rule contexts and `@keyframes` are excluded; nested rules contribute resolved selectors; the annotated declaration is identifiable so that it is excluded from its own guard.

Acceptance: no competitor counts, source locations, or ordering are retained, because the guard does not present them.

### CSSC-015 — Generate deterministic probe identifiers

Labels: `phase-1`, `core`, `compiler`

Hashing uses a small pure JavaScript algorithm, documented in the issue, because core may not import `node:crypto` and `crypto.subtle` is both asynchronous and unavailable under `types: []`.

Red: identical source and annotation produce identical identifiers; moving the annotation changes the identifier; a different selector or property selection changes it; a function probe identifier is stable across call-site additions while each call site has its own stable sub-identifier; resolved rather than authored selectors feed the hash; identifiers exclude machine-specific absolute paths.

### CSSC-016 — Expose `compileSource`

Labels: `phase-1`, `core`, `api`

Red: contract tests compiling complete fixtures, including nested fixtures and fixtures containing `@function`, asserting probes of every kind, call sites, definition references, guard index, and diagnostics together.

**Checkpoint. Stop for review and merge.**

## Phase 2 — real-browser evaluator

Exit criteria: browser tests prove value, function, and pseudo-element records against live documents; the guard fires correctly and never claims a winner.

### CSSC-017 — Evaluate media and supports conditions

Labels: `phase-2`, `browser`, `conditions`

Red cases: active and inactive media queries; active and inactive supports conditions; combined conditions use conjunction; an indexed declaration inside an inactive condition is excluded from the guard.

### CSSC-018 — Match selector branches

Labels: `phase-2`, `browser`, `matcher`

Red cases: zero, one, and multiple matches; branch deduplication; document-order output; one invalid branch beside a valid one; a resolved nested selector matching correctly; a pseudo-element branch matching its originating elements; disconnected elements absent.

### CSSC-019 — Read authored and resolved values

Labels: `phase-2`, `browser`, `evaluator`

The object returned by `getComputedStyle()` is live, so caching it caches nothing. Acquire the declaration once per element and pseudo-element pair, read all requested properties consecutively, and perform no DOM access between reads. Writing mode and direction come from the same declaration.

Red cases: an ordinary property; `calc()` resolving to pixels; `clamp()` at and between its bounds; `color-mix()` resolving to a concrete color; a container unit resolving against its query container; an inherited property; a custom property; an empty custom property; a `::before` pseudo-element with generated content; a `::before` pseudo-element with no `content`, which returns computed values while generating no box; an element with `display: none`, where resolved values fall back to computed values and a length reports `auto`; property name normalization.

### CSSC-020 — Evaluate function probes

Labels: `phase-2`, `browser`, `functions`

Red cases: a call site with one matched element; a call site with many matched elements producing one record each; multiple call sites for one function; an isolated call reporting the function's return value; a nested call reporting the property value with `isolated: false`; arguments preserved as authored; a function whose result varies per element through a custom property argument; a browser without `@function` support producing a reserved-pending-support diagnostic rather than an error.

### CSSC-021 — Evaluate the contested guard

Labels: `phase-2`, `browser`, `guard`

**Review question**: does the guard fire when and only when something competes?

Red cases: nothing else declares the property, giving `contested: false` with no reasons; a competing rule gives `competing-declaration`; a shorthand competing with an annotated longhand, specifically `margin` against `margin-left`; a physical property competing with an annotated logical one, `width` against `inline-size`, in both horizontal and vertical writing modes; `all` competing with everything; an inline style value; an `!important` flag; a running transition or animation on the property; an authored value referencing an unset custom property; a `var()` reference with a valid fallback and an unset variable, tested for whichever behavior the specification requires; competitors in inactive conditions and excluded sources do not count.

Acceptance: no specificity, layer, or order comparison is performed anywhere.

### CSSC-022 — Enforce match limits without losing totals

Labels: `phase-2`, `browser`, `performance`

Red cases: default limit; explicit limit; no truncation; truncation; `maxElements: 0`; invalid negative or non-integer limits.

### CSSC-023 — Emit normalized browser events

Labels: `phase-2`, `browser`, `records`

Red: event ordering of probe start, records and diagnostics, probe summary; live element identity; deterministic identifiers; monotonic timestamps; `values` preserves requested order; value, function, and pseudo-element records interleave correctly in one scan.

**Checkpoint. Stop for review and merge. The record contract is stable from here.**

## Phase 3 — source discovery and orchestration

Exit criteria: one public `scan()` discovers supported sources, compiles them, evaluates them, and returns a summary carrying records.

### CSSC-024 — Discover inline style sources

Labels: `phase-3`, `browser`, `sources`

Identity uses a `WeakMap<HTMLStyleElement, string>` plus a content hash. The scanner does not write to the document.

Red cases: one and multiple style elements; an empty style element; a dynamically inserted style present before the scan; inserting a style element before existing ones does not change existing identifiers; two byte-identical anonymous styles share a content hash, which is documented; an author-supplied identity attribute is read but never written; markup is unchanged after a scan, asserted by serialization equality.

### CSSC-025 — Load same-origin linked stylesheets

Labels: `phase-3`, `browser`, `sources`, `network`

A blocked fetch cannot be attributed, because cross-origin and Content Security Policy failures both surface as a rejected `TypeError` by design, so that cross-origin state does not leak. One `SOURCE_LOAD_FAILED` code lists likely causes rather than claiming one. HTTP status failures are distinguishable and keep their own code.

Red cases: same-origin success; relative URL resolution; HTTP status failure; a rejected fetch; duplicate URLs; a non-CSS link; an abort signal.

### CSSC-026 — Accept explicit raw sources

Labels: `phase-3`, `browser`, `api`

Red: compile and scan a supplied source object; mix explicit and document sources; diagnose duplicate identities.

### CSSC-027 — Gate and filter sources

Labels: `phase-3`, `browser`, `sources`, `conditions`

Two mechanisms share one path. A `media` attribute gates a source exactly as an `@media` ancestor would, and a disabled source is excluded entirely. Separately, `exclude` patterns remove sources by URL.

Red cases: a print-media style element in a screen context contributes nothing; a screen-media style element contributes; a print-media link; disabled style and link elements; a media attribute becoming active is re-evaluated on the next scan; an `exclude` pattern removes a linked source; an excluded source contributes neither probes nor guard candidates; exclusion is counted separately from failure.

### CSSC-028 — Implement the scan lifecycle

Labels: `phase-3`, `browser`, `scanner`

Red cases: scan after DOM readiness; optional `document.fonts.ready`; one animation-frame stabilization; abort before and during a scan; overlapping scans; dispose; summary counts.

Decision: scans are serialized per instance. A second call waits for the first, and does not merge with or cancel it.

### CSSC-029 — Compose the public facade

Labels: `phase-3`, `api`, `integration`

Red: consumer-level tests importing only from the package root; a consumer reads records from the returned summary without subscribing; the package is side-effect free until constructed and scanned.

**Checkpoint. Stop for review and merge.**

## Phase 4 — console experience and demonstration

Exit criteria: output is legible at 1, 10, and 50 matches; the demonstration exercises runtime-computed values across every probe kind; a developer can try it with one install and one import.

### CSSC-030 — Render value probes

Labels: `phase-4`, `console`, `ux`

**Review question**: does the adapter render legibly at scale?

Red: level-to-method mapping; a `groupCollapsed()` title carrying label, selector, and source location; a live element passed as an argument in every record; authored and resolved fields; a single element renders as a group; many elements render through `console.table()`; a color value renders a `%c` swatch alongside its text; a truncation summary; scan duration through `console.time()`.

Acceptance: the table is legible at fifty rows; no information exists only in styling; adapter failure cannot break scanning; `console` is never wrapped, replaced, or intercepted.

### CSSC-031 — Render function probes

Labels: `phase-4`, `console`, `ux`, `functions`

Red: a group per function naming the definition location; one table per call site showing arguments, property, and per-element resolved value; a non-isolated call visibly marked as a property value rather than a return value; multiple call sites rendering as sibling groups; a function with no call sites rendering an informational line; definition references listed separately from call sites.

### CSSC-032 — Render diagnostics and the handoff

Labels: `phase-4`, `console`, `ux`

Red: warnings and errors use corresponding methods; repeated source failures deduplicate per scan; diagnostics render their documentation anchor; a contested guard renders its reasons plus the live element and a short instruction to inspect it; a reserved-pending-support diagnostic reads as a browser gap; a not-a-target diagnostic carries remediation.

### CSSC-033 — Build the playground

Labels: `phase-4`, `example`, `e2e`

Cases, ordered so that the strongest leads:

1. A custom function whose return values differ per call site and per element.
2. `color-mix(in oklch, var(--brand) 60%, white)` resolving to a concrete color, with per-section theming so that the result varies.
3. A container unit resolving against different query containers.
4. `clamp()` at both bounds and fluid between them, across one selector matching many elements.
5. A custom property arriving through an inheritance chain.
6. A `::before` pseudo-element whose generated content sizing is unknowable from source.
7. `random()`, feature-detected, demonstrating per-element variation.
8. A nested rule whose resolved selector is not obvious from source.
9. A guard case where a shorthand competes with an annotated longhand, ending in the handoff to developer tools.

Acceptance: the page distinguishes source, selector, live value, and guard state; content remains usable without JavaScript; any motion respects reduced-motion preferences.

### CSSC-034 — Publish documentation and the capability write-up

Labels: `phase-4`, `docs`

Two deliverables, both held to the writing standards.

**Usage documentation**: installation, the probe kinds, API, examples, diagnostics, and limitations. It explains the scope principle; what the guard does and does not claim; why the levels come from the Console API and carry no assertion semantics; the `display: none` fallback; the element retention hazard; the difference between reserved-pending-support, deferred, and not-a-target; that a non-isolated call reports a property value rather than a function return value, naming css-expect as the tool for isolated assertions; and that annotations in production CSS are stripped by most minifiers, with the exceptions named.

**Capability write-up** in `docs/capabilities.md`: what a page-scoped script can and cannot observe about computed CSS. It states the litmus test, enumerates the out-of-reach list with the reason each item is unreachable, and describes what an engine-level implementation could offer instead, most pointedly which branch inside a function body produced `result`. This is written to be useful to contributors and users regardless of whether any browser engineer reads it.

### CSSC-035 — Run the usability checkpoint

Labels: `phase-4`, `research`, `release-blocker`

The measure is comprehension and desire, not speed. Racing developer tools on a cascade question guarantees a loss and would test the wrong thing.

Protocol: at least five CSS developers, of whom at least two had no involvement in designing the syntax, and at least two of whom write custom functions today. Each is given the playground and asked to answer questions about runtime-computed values.

Record: whether participants correctly predicted what each probe would report before running it; whether anyone read a contested guard as a claim about the cascade; whether the function call-site output was understood without explanation; whether the annotation syntax felt natural to write unprompted; and whether participants would leave annotations in a working branch.

Exit decision: continue if participants can write a correct annotation unprompted, nobody misreads the guard, and at least three say they would use it on current work.

**Checkpoint. Stop for review and merge.**

## Phase 5 — hardening and experimental release

### CSSC-036 — Cross-browser contract coverage

Labels: `phase-5`, `testing`, `browser`

Run the browser suite in Chromium, Firefox, and WebKit. Cover nesting resolution, `color-mix()`, logical mapping under vertical writing modes, pseudo-element computed values, and `getAnimations()`. Custom function tests feature-detect and skip where `@function` is unsupported.

### CSSC-037 — Performance budgets

Labels: `phase-5`, `performance`

Budgets on documented fixture hardware:

- 100 probes and 1000 total matches complete without long tasks over 50 ms where feasible, measured as a delta over a baseline scan rather than as an absolute figure.
- Each element and pseudo-element pair has its computed style declaration acquired once per scan, with consecutive reads and no interleaved DOM access.
- Selector match results are cached per branch and element within a scan.
- Guard cost scales with declarations touching the selected properties, not with total declarations.
- Call-site resolution is linear in declaration count.

### CSSC-038 — Package and CI release gates

Labels: `phase-5`, `release`, `ci`

Acceptance: clean install, typecheck, lint, unit, browser, end-to-end, build, and package-content checks run in CI; boundary compilation tests run in CI; exports contain only the single entry point; source maps and declarations are present; provenance and publishing are documented, following the trusted-publishing setup used by css-expect.

### CSSC-039 — Cut `0.1.0-experimental`

Labels: `phase-5`, `release`

Acceptance: the changelog describes experimental status, the reserved-pending-support list, and unsupported contexts; the playground consumes the packed artifact; a fresh consumer fixture installs and runs the documented example.

## 11. Post-v0 issue horizon

### Reserved pending browser support

- **CSSC-101 — `@mixin` and `@apply` probes.** Report the declarations a mixin contributed at a call site. `@apply` injects declarations absent from source, so the guard index premise needs revisiting when this lands.
- **CSSC-102 — `@contents` and `@env`.**
- **CSSC-103 — `if()` branch reporting**, where the engine makes the branch observable.
- **CSSC-104 — `@supports at-rule()` capability gating**, replacing ad-hoc feature detection.

### Deferred by choice

- **CSSC-110 — Live scan scheduler.**
- **CSSC-111 — Mutation-driven watches.**
- **CSSC-112 — Resize-driven watches.**
- **CSSC-113 — Media-query watches.**
- **CSSC-114 — Value diffs.**
- **CSSC-115 — `::part()` and `::slotted()` probes**, which require shadow DOM.
- **CSSC-116 — Open shadow DOM discovery.**
- **CSSC-117 — Recursive `@import`.**
- **CSSC-118 — `@container` and `@scope` evaluation.**
- **CSSC-119 — Typed Object Model enrichment.**
- **CSSC-120 — Geometry probes.**
- **CSSC-121 — Imperative probe API**, for probing a selector and property from the developer tools console without editing source.
- **CSSC-122 — Chrome custom formatters spike.**
- **CSSC-123 — Probe manifest schema.**
- **CSSC-124 — PostCSS or css-tree extraction plugin**, depending on the parser decision.
- **CSSC-125 — Vite integration.**
- **CSSC-126 — Workspace split**, mechanical because dependency direction already lives in the reference graph.

### Engine-level, documented rather than built

- **CSSC-130 — Developer tools capability proposal.** Develop `docs/capabilities.md` into a concrete proposal for the out-of-reach items, in particular function-body branch observation.

## 12. Recommended issue order

```text
001 → 002 → 003 → 004
                   ↓
005 → 006/007 → 008/009 → 010 → 011 → 013 ─┐
                                            ├→ 015 → 016
                   004 → 012 → 014 ─────────┘
                                                     ↓
017 → 018 → 019 → 020/021 → 022 → 023
                                     ↓
024 → 025/026 → 027 → 028 → 029
                               ↓
030 → 031/032 → 033 → 034 → 035
                              ↓
036/037 → 038 → 039
```

Parallel work: CSSC-012 depends only on the fixture foundation, so the expansion tables can be built alongside the parser track. CSSC-006 and CSSC-007 follow the grammar. CSSC-020 and CSSC-021 are independent. CSSC-025 and CSSC-026 follow inline discovery. CSSC-031 and CSSC-032 follow the base adapter.

## 13. Milestone mapping

| Milestone                    | Issues       | Deliverable                                           |
| ---------------------------- | ------------ | ----------------------------------------------------- |
| M0 Foundation and decisions  | CSSC-001–004 | Parser decided, boundaries enforced, green CI         |
| M1 Compiler                  | CSSC-005–016 | Probes compile; call sites resolve                    |
| M2 Evaluator                 | CSSC-017–023 | Real-browser records with guard                       |
| M3 One-shot library          | CSSC-024–029 | Public `scan()` with source gating and filtering      |
| M4 Console and demonstration | CSSC-030–035 | Console experience, playground, write-up, user signal |
| M5 Experimental release      | CSSC-036–039 | `0.1.0-experimental`                                  |

## 14. Release acceptance scenario

```html
<style>
  :root {
    --brand: oklch(0.65 0.2 250);
  }

  /* css-console: log label="spacing scale" */
  @function --space(--multiplier) {
    result: calc(var(--multiplier) * 0.25rem);
  }

  .card {
    padding: --space(4);
    background-color: color-mix(in oklch, var(--brand) 60%, white);
  }

  .card--tight {
    padding: --space(2);
  }

  .promo {
    --brand: oklch(0.72 0.18 30);
  }
</style>

<article class="card">One</article>
<article class="card card--tight">Two</article>
<section class="promo"><article class="card">Three</article></section>

<script type="module">
  import { createCSSConsole } from "@schalkneethling/css-console";

  const cssConsole = createCSSConsole({ sources: "document" });

  await cssConsole.scan();
</script>
```

Expected:

- one collapsed group labeled `spacing scale`, naming the definition location;
- two call-site tables, one for `--space(4)` and one for `--space(2)`;
- three inspectable article elements across those tables, each with its resolved padding;
- every call marked `isolated: true`, because each call is the whole declaration value;
- `contested: false` throughout, because nothing competes;
- a scan summary carrying the records;
- an unmodified document and no background observers after completion.

Annotating `background-color` demonstrates the scope principle directly: the same authored value resolves to different colors inside and outside `.promo`, which no amount of reading the source reveals.

## 15. Key risks and controls

| Risk                                                   | Control                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| Building a worse inspector                             | The litmus test gates every feature; cascade work is a guard             |
| Comments unavailable through the CSS Object Model      | Parse original source text                                               |
| Parser drops or absorbs trailing comments              | CSSC-002 spike decides on evidence, including the omitted-semicolon case |
| A value presented as though the annotation produced it | The guard, with the live element as remediation                          |
| Guard missing shorthand or logical conflicts           | Bidirectional expansion, logical resolved per element                    |
| Non-isolated function call read as a return value      | `isolated` on every call site; css-expect named for isolated assertion   |
| Two calls in one declaration collapsed into one        | Each call is its own call site, with a dedicated fixture                 |
| Nesting transform destroying annotation association    | Manual resolution; source locations asserted unchanged                   |
| Console flooded by a dependency's annotations          | `exclude` patterns in the API from the first release                     |
| `console` semantics broken for the host application    | Never wrap, replace, or intercept; call the API only                     |
| A read-only tool mutating the page                     | `WeakMap` plus content hashing; markup equality asserted after a scan    |
| Node packages reaching browser code                    | No `node:` imports under `src/`; pure JavaScript hashing in core         |
| Ambient type packages reintroducing globals into core  | `types: []` alongside a derived `lib`, asserted executably               |
| Public contracts reopened by consumers                 | `type` rather than `interface` throughout the public surface             |
| Reserved features read as missing features             | Three-tier target model with three distinguishable diagnostics           |
| Fixtures that pass while the tool fails in practice    | Fixtures replicate real-world CSS; hardening fixtures labeled separately |
| Pull requests growing past what a reviewer can hold    | One review question per pull request; checkpoints halt for review        |
| Levels implying assertion semantics                    | Documented as Console API lineage; `@error` deliberately not copied      |
| Chromium-only `@function` treated as a blocker         | Development-only tool; feature-detect, skip, and report skipped coverage |

## 16. First implementation slice

Begin with CSSC-001 and CSSC-002, and do not proceed past the CSSC-002 checkpoint until the parser decision is reviewed and merged.

The first externally meaningful demonstration:

```ts
it("parses a log annotation", () => {
  const result = parseAnnotation("css-console: log");

  expect(result).toEqual({
    ok: true,
    annotation: { level: "log", properties: [], label: undefined },
  });
});
```

Then extend to a real fixture, and then to the differentiating case:

```css
/* css-console: log */
@function --space(--multiplier) {
  result: calc(var(--multiplier) * 0.25rem);
}

.card {
  padding: --space(4);
}
```

Phase 1 ends with a compiled function probe carrying one resolved call site, and no console output.

## 17. Open questions

1. **`var()` fallback semantics.** CSSC-021 must document and test behavior when a reference has a fallback and the variable is unset, since that decides whether `unresolved-variable` fires.
2. **Declarations after nested rules.** CSSC-010 must verify current specification text.
3. **Keyframe-affected properties.** Transitions expose their affected property directly; extracting affected properties from keyframe effects is less clear across engines. If unreliable, `animation-or-transition` degrades to a per-element rather than per-property signal.
4. **Nested custom function calls.** Confirm against the specification that a call inside another function body has no independently observable value before finalizing the definition-reference rule.

## 18. References

### Specifications

- [CSS custom functions and mixins](https://drafts.csswg.org/css-mixins-1/)
- [CSS nesting](https://drafts.csswg.org/css-nesting/)
- [CSS logical properties and values](https://drafts.csswg.org/css-logical-1/)
- [CSS pseudo-elements](https://drafts.csswg.org/css-pseudo-4/)
- [CSS cascading and inheritance](https://drafts.csswg.org/css-cascade-5/)
- [CSS values and units level 5](https://drafts.csswg.org/css-values-5/): `random()`, `if()`
- [CSS object model](https://drafts.csswg.org/cssom/): resolved values
- [CSS conditional rules](https://drafts.csswg.org/css-conditional-5/): `@supports at-rule()`

### Reference documentation

- [`@function`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@function)
- [CSS custom functions and mixins guide](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Custom_functions_and_mixins)
- [`getComputedStyle()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/getComputedStyle)
- [Console API](https://developer.mozilla.org/en-US/docs/Web/API/console)
- [MDN writing style guide](https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Writing_style_guide)

### Related projects

- [css-expect](https://github.com/schalkneethling/css-expect): browser-native expectations for CSS custom functions and mixins, and the assertion counterpart to this project
- [css-property-type-validator](https://github.com/schalkneethling/css-property-type-validator): validation for `@property` registrations, and the source of the css-tree option
- [PR guidance](https://github.com/schalkneethling/schalkneethling.com/blob/main/PR.md): pull request scope rules adopted by this project

### Tooling

- [PostCSS API](https://postcss.org/api/)
- [css-tree](https://github.com/csstree/csstree)
- [mdn-data](https://github.com/mdn/data)
- [Vitest browser mode](https://main.vitest.dev/guide/browser/)
