# Usage

css-console turns an inert CSS comment into a live, element-specific value probe. You annotate the rule, the declaration, or the custom function you have a question about, load the library during development, and read the browser's own answer in the console you already have open.

This page covers installation, the annotation grammar, the API, the report the console adapter renders, and the limits the tool works within. The full diagnostic registry lives in [diagnostics.md](diagnostics.md), and the argument about what a page-scoped script can and cannot observe lives in [capabilities.md](capabilities.md).

## What css-console is

CSS is becoming programmable, and programmable languages are debugged by printing intermediate values. Sass has `@debug` for observing values and Sass True for asserting them. css-console is the missing `@debug` for native CSS.

The scope principle decides what is worth probing: a value is worth probing when it cannot be known from the source text alone, only after the browser has parsed and applied the CSS. That criterion covers the resolved values of destination properties whose declarations contain custom function calls, `calc()` against relative units and percentages, which bound a `clamp()` landed on, `color-mix()` and relative color syntax, `light-dark()`, container units resolving against whichever container won, custom properties arriving through an inheritance chain, generated content sizing, `random()`, and `if()` branches once they ship. The criterion is a center of gravity rather than a restriction; a deterministic `calc(2px + 3px)` is not refused. Both the principle and the litmus test below are recorded in [0001-scope-principle-and-litmus-test.md](decisions/0001-scope-principle-and-litmus-test.md).

The litmus test decides what css-console builds: are we reimplementing something browser developer tools already do, or are we enhancing what they offer within the limits of page JavaScript? Reimplementation looks like cascade resolution, specificity ranking, layer ordering, and box-model geometry, and it is rejected. Enhancement looks like a probe that is source-anchored rather than element-anchored, that reports every matched element at once rather than one at a time, that shows a function call together with its arguments and its value across every call site, and that survives a page reload because it is committed to source.

css-console asserts nothing. Its sibling project, [css-expect](https://github.com/schalkneethling/css-expect), runs in Node, drives a browser through Playwright, evaluates CSS in isolation, and asserts expected values. css-console runs in the page during development and observes values in their real context. The boundary between the two is recorded in [0012-relationship-to-css-expect.md](decisions/0012-relationship-to-css-expect.md).

## Installation and a first scan

Install the package from npm:

```sh
npm install --save-dev @schalkneethling/css-console
```

The package exposes a single public entry point. Internal directories are reached through relative imports and never through published subpath exports.

```ts
import { createCSSConsole, createConsoleAdapter } from "@schalkneethling/css-console";

const cssConsole = createCSSConsole({
  sources: "document",
  maxElements: 50,
  waitForFonts: false,
});

const unsubscribe = cssConsole.subscribe(createConsoleAdapter());
const summary = await cssConsole.scan();

unsubscribe();
cssConsole.dispose();
```

`createCSSConsole()` constructs one instance; `subscribe()` registers a consumer of the live event stream and returns a function that stops delivery; `scan()` runs the pipeline once and resolves with a summary; and `dispose()` ends the instance. `createConsoleAdapter()` is the built-in subscriber that renders the stream to the browser console.

Construction is side-effect free beyond validation. No scan runs, nothing reads the document, and nothing is scheduled, so an instance may be constructed in the module scope of code that also runs on a server: the first DOM access happens inside `scan()`. Configuration errors fail construction, so an invalid `maxElements` throws before any scan exists to fail.

A consumer that never subscribes still sees everything. The scan summary carries every record and every diagnostic alongside counts for sources, probes, and matches, so `await cssConsole.scan()` alone is a complete report.

## The annotation grammar

The grammar is one line, and it is deliberately small:

```text
css-console: <log-level> [property-list] [label="..."]
```

- `css-console:` is the directive, and the colon is required. A comment that does not carry the directive and the colon is not an annotation at all, so ordinary prose comments in your stylesheets never produce diagnostics.
- `<log-level>` is required, and is one of `log`, `info`, `warn`, or `error`.
- `[property-list]` is an optional comma-separated list of property names. It is ordered, and the report preserves the order you requested.
- `[label="..."]` is the only named option the grammar defines. The value is quoted, and the label appears in brackets at the head of the probe's console group.

### Rule probes

An annotation immediately before a style rule probes that rule. With no property list, the probe covers every property the rule declares directly.

```css
/* css-console: log */
.card {
  inline-size: calc(50vw - 2rem);
  padding: 1rem;
}
```

A property list narrows the probe, and a label names it:

```css
/* css-console: info inline-size, padding label="cards" */
.card {
  inline-size: calc(50vw - 2rem);
  padding: 1rem;
  color: red;
}
```

Both compile to one value probe over `.card`, the second covering `inline-size` and `padding` in that order and carrying the label `cards`. Whitespace after the comma is optional.

Only declarations authored directly in the rule are considered. CSS nesting lets a rule contain further rules, and a probe on the outer rule is not a probe on the inner ones; those are their own targets.

### Declaration probes

An annotation that trails a declaration, on the same line, probes that one declaration.

```css
.badge {
  padding: clamp(0.25rem, 1vw, 1rem); /* css-console: log */
}
```

A declaration probe names exactly one property by its position, so a property list on one is rejected with `PROPERTY_LIST_ON_DECLARATION_PROBE`. A comment that trails a declaration is read as a declaration probe and is never also read as preceding whatever follows it.

### Function probes

An annotation immediately before an `@function` rule probes every call site of that function in the scanned sources.

```css
/* css-console: log label="space scale" */
@function --space(--step) {
  result: calc(0.25rem * pow(1.5, var(--step)));
}

.card {
  padding: --space(4);
}

.panel {
  margin-block: calc(--space(2) + 2px);
}
```

This compiles to one function probe named `--space` with two call sites: `padding` on `.card` with the argument `4`, and `margin-block` on `.panel` with the argument `2`. The call sites determine which properties are reported, so a property list on a function probe is rejected with `PROPERTY_LIST_ON_FUNCTION_PROBE`.

### Where an annotation may sit

An annotation attaches to the next sibling for rule probes and function probes, and to the previous sibling on its own line for declaration probes. An annotation with nothing to attach to reports `NO_TARGET`.

At-rules fall into three tiers, and the tiers exist so that three different messages never collapse into one:

- `@function` is the one at-rule css-console compiles to a probe.
- `@media`, `@supports`, and `@layer` group other rules rather than declaring one, so they are not annotation targets by design and report `NOT_A_TARGET`. Annotate the rules inside them.
- `@mixin`, `@apply`, `@contents`, and `@env` have specifications and designed contracts, but no current browser implements them, so an annotation on one reports `RESERVED_PENDING_SUPPORT`.
- Every other at-rule, such as `@keyframes` or `@container`, is outside the supported target set and reports `OUTSIDE_SUPPORTED_TARGET_SET`, which is a tool-scope limitation rather than a browser gap.

## Log levels

The four log levels are `log`, `info`, `warn`, and `error`, and they map directly onto the Console API methods of the same names. They carry no assertion and no control-flow semantics: `error` does not mean a test failed, and `warn` does not mean css-console found a problem. A level is a rendering choice, so that you can raise the probes you are currently chasing above the ones you are not, and filter them in the console's own severity filter. The reasoning for rendering through the native Console API rather than a panel of our own is recorded in [0007-console-api-as-first-class-target.md](decisions/0007-console-api-as-first-class-target.md).

A fifth name, `watch`, is recognized and reserved for a future live mode. An annotation naming it reports `WATCH_RESERVED` and produces no record in this release.

## Reading the report

The console adapter renders one collapsed group per probe, brackets the whole scan with a named timer, and closes with a completion line.

Each scan opens `console.time()` with a label of the form `css-console scan 1`, counting up per adapter instance, and closes the matching `console.timeEnd()` when the summary arrives.

A value probe's group title is the word `css-console`, the label in brackets when the annotation carried one, the resolved selector, an em dash, and the location of the annotation comment itself:

```text
css-console [cards] .card — https://example.com/site.css:12:1
```

A function probe's title follows exactly the same pattern, with the function name standing where the selector stands.

What the group holds depends on how many elements matched:

- **Zero records**: nothing. The group's existence is the answer.
- **Exactly one record**: one line per property, rendered through the record's own log level, reading `property: authored → resolved`. The live element travels as a trailing argument, so developer tools renders it as an inspectable node. When the resolved value is a color the engine accepts, the line is preceded by a styled swatch, with the resolved value still present in plain text afterwards, so no information exists only in styling. When the resolved value is exactly one two-dimensional `matrix(...)`, a decomposition into `translate`, `scale`, and `rotate` is appended after the raw value, which remains authoritative.
- **More than one record**: one `console.table()` call, with a row per record and property pair carrying the element, the property, the authored value, the resolved value, and whether the guard reported the value as contested.

A function probe's group always states where the function is defined, on a `defined at <location>` line. When nothing in the scanned sources calls it, an informational `no call sites in the scanned sources` line follows. Every call of the annotated function found inside another function's body is then reported on its own `referenced inside <function> — <property> with (<arguments>) — <location>` line; such a call has no matched element and therefore no observable value, so the reference is reported instead of a record.

Below those lines, the function group nests one collapsed sibling group per call site, titled with the destination property, the arguments as authored, the selector, and the call site's own location. A call that is not the whole declaration value carries the suffix `(includes surrounding expression contributions)`. Each call-site group holds one table whose middle column is named `resolved property value`, because a function record's value is always the destination property's resolved value and never the function's own return value.

When `maxElements` omitted matches, a truncation line closes the group:

```text
evaluated 50 of 214 matches, 164 omitted (maxElements)
```

The final event of a scan renders one completion line, `css-console: scan complete`, with the summary's `sources`, `probes`, and `matches` counts and its `durationMs` as a live object beside it.

## The guard

A probe reads a resolved value from `getComputedStyle()` and presents it beside an annotated declaration. Nothing in that read proves the annotated declaration produced the value. The guard exists so that css-console never presents a value as though the annotated source produced it when something else may have.

The guard's contract is a boolean and a list of reasons:

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

`contested: true` claims exactly one thing: the annotated declaration may not be the sole contributor to the observed value, and here is why it might not be. It does not claim that the annotated declaration lost. The guard never resolves the cascade, ranks declarations, or names a winner, because the litmus test rejects reimplementing what developer tools already do and page JavaScript cannot fully observe anyway. The reasoning is recorded in [0004-guard-as-guard-not-cascade-feature.md](decisions/0004-guard-as-guard-not-cascade-feature.md).

Where a value is contested, its line carries a `(contested)` marker, and the adapter follows the body with one handoff line through the record's own log level:

```text
contested (competing-declaration, important) — inspect this element in developer tools; the annotated declaration may not be the sole contributor
```

The live element travels beside that line, so the remediation is one click away. Handing off is the design: the guard's claim is a hint to look, not a verdict.

## Every value is a resolved property value

No value css-console reports is a function's return value. A function returning a percentage or a relative length has that result transformed by the destination property's own value resolution before `getComputedStyle()` exposes anything, so what you read is always the property's resolved value.

`soleContribution` on a call site is the honesty field, and its claim is about contribution rather than about return values. A declaration reading `padding: --space(4)` resolves a value the call alone produced, and `soleContribution` is `true`. A declaration reading `margin-block: calc(--space(2) + 2px)` does not, and `soleContribution` is `false`, so the record says so rather than implying a contribution the tool cannot observe.

Isolating a nested call is deliberately out of scope. Doing it would require synthesizing a probe element carrying the original element's custom property context, which conflicts with the read-only guarantee: css-console only ever reads the document. css-expect isolates properly, off-page, and is the right tool for that question.

## Options and lifecycle

`createCSSConsole()` accepts five options, all optional.

### `sources`

`"document"`, the default, discovers inline `<style>` elements and linked stylesheets from the page. `"none"` collects nothing from the page, which is the mode for a consumer scanning only the raw sources they supply.

### `rawSources`

An array of explicit sources, scanned in either `sources` mode. Each entry carries a required non-empty `id`, the `css` text, and an optional `url`; when `url` is omitted, a `raw:` URL is synthesized from the `id`. An entry with an empty `id` is dropped with `EMPTY_SOURCE_IDENTITY`.

A raw source's probes still match the live document, because what is scanned and what is matched are different questions: a raw source describes CSS, and the elements that CSS applies to are wherever the document put them.

### `exclude`

An array of patterns matched against a source's full `url` string, including the `inline:` and `raw:` schemes synthesized for sources that were never fetched. A source whose URL matches any one pattern is excluded, and an excluded linked stylesheet is never requested, so exclusion costs no network traffic.

The pattern grammar is a hand-written subset of glob with two wildcards and nothing else:

- `*` matches any run of characters except `/`, so it names files within one directory.
- `**` matches any run of characters including `/`, so it crosses directories. Three or more consecutive stars read as `**`.
- `?` is **not** a wildcard. A literal `?` is a character URLs are full of, since a query string starts with one, so `**/a.css?direct` means what it looks like it means.
- Every other character is literal, including every regular expression metacharacter, so a pattern can never smuggle in a regular expression.
- The match is anchored at both ends, so a pattern with no wildcard is an exact URL match rather than a substring match. `exclude: ["a.css"]` therefore does not remove `extra.css`; write `exclude: ["**/a.css"]` when you want a suffix match.

Those rules give the common case without a special case: `**/design-system/**` matches any URL with a `/design-system/` path segment at any depth, and does not match `/my-design-systems/`, because the slashes around the segment are literal.

### `maxElements`

The maximum number of matches one probe evaluates, defaulting to 50. It is validated at construction, so an invalid value throws before any scan exists to fail.

Limiting never loses the total. The probe summary carries `total`, `evaluated`, and `omitted`, so a truncated probe still reports how many matches existed, and the console adapter renders the truncation line from those counts. For a function probe the limit is a budget spent across its call sites in resolution order, so the probe as a whole evaluates at most `maxElements` matches however many declarations call the function, while each call site still counts its own matches in full.

### `waitForFonts`

When `true`, a scan waits for `document.fonts.ready` before reading anything. Font metrics move layout, so a caller who wants values after fonts settle opts in. The default is `false`.

### What one scan does, in order

1. Waits for the document to be ready, because a document whose `readyState` is `"loading"` has not finished parsing.
2. Waits for `document.fonts.ready` when `waitForFonts` is set.
3. Waits one animation frame, so that the scan reads the document after the rendering you can see rather than between a mutation and its recalculation.
4. Discovers and loads sources: inline style elements, linked stylesheets, and the instance's raw sources. Excluded links are never fetched.
5. Gates what arrived. Inactive sources, the ones the browser is not reading right now, contribute nothing, and duplicate identities among the sources that will compile are diagnosed.
6. Compiles and evaluates each active source in discovery order, delivering every event to subscribers as it is produced.
7. Emits the summary as the final event and resolves with it.

### Serialization, abort, and dispose

Scans are serialized per instance. A second `scan()` call waits for the first to settle, and neither merges with nor cancels the other. Serialization is what keeps the event stream legible: interleaving two scans would put one scan's records between another scan's probe boundaries, and no subscriber could reassemble which scan a record belonged to.

`scan()` accepts an `AbortSignal`:

```ts
const controller = new AbortController();
const scanned = cssConsole.scan({ signal: controller.signal });
```

The signal is checked at every stage boundary and travels into the network requests, so an abort during a pending load cancels the requests themselves. An aborted scan rejects with the engine's own `AbortError` and emits no summary; events already delivered stay delivered, because they described work that really happened. An abort is your decision rather than a finding about the document, so it produces no diagnostic.

`dispose()` clears the subscriber list and marks the instance ended. Later `scan()` and `subscribe()` calls throw, and a second `dispose()` is a no-op. A scan in flight when `dispose()` is called runs to completion and its promise still settles, because the caller holding that promise asked for that scan before disposing; it simply has no subscribers left to tell.

A subscriber that throws cannot break a scan or starve the subscribers after it. Delivery wraps each subscriber call, because a subscriber is consumer code and the failure model isolates faults to where they happen.

## Diagnostics

Every condition css-console detects is reported as a diagnostic carrying a stable `code`, a `severity`, a `message`, a `docsUrl`, an optional `source` location, and optional `details`.

The console adapter renders a diagnostic as it arrives, through the method its severity dictates: `info` through `console.info()`, `warning` through `console.warn()`, and `error` through `console.error()`. The text is the code, an em dash, the message, the source location when the diagnostic carries one, a newline, and the documentation anchor. Any `details` travel live as a second argument rather than stringified, so developer tools offers the engine's own facts beside the registry's meaning. An identical diagnostic renders only once per scan, which matters when several links to one failing URL produce the same source failure repeatedly.

Diagnostics are categorized, and three of the categories carry the three-way scope split recorded in [0008-three-way-scope-split.md](decisions/0008-three-way-scope-split.md). A flat "not supported" message would conflate three different situations that call for three different responses:

- **`reserved-pending-support`** names a browser gap: the specification exists and css-console has designed its contract, but the current browser does not implement it yet. `RESERVED_PENDING_SUPPORT` is the code. There is nothing to fix in your CSS; watch the browser's release notes.
- **`deferred`** names a feature the project postponed by choice. `WATCH_RESERVED` is the code for the reserved `watch` log level, and `DEFERRED_PSEUDO_ELEMENT` and `DEFERRED_SCOPE_NESTING` name postponed constructs. The construct may work perfectly in the browser; css-console has simply not built support for it.
- **`not-a-target`** names a construct css-console rejects by design. `NOT_A_TARGET` is the code, and it fires when an annotation precedes a grouping at-rule such as `@media`, `@supports`, or `@layer`. The remediation is to annotate the rules inside.

Three further categories cover the rest: `annotation` for a defect in what you wrote, `source` for a failure while discovering or loading a source, and `informational` for a condition that is neither an error nor a warning but answers a debugging question anyway.

[diagnostics.md](diagnostics.md) documents every code the registry defines, in both directions: a code without a section on that page, or a section without a matching code, is a defect.

## Limitations and hazards

### `display: none` falls back to computed values

The resolved value of a property depends on whether the element generates a box. An element with `display: none` generates none, so its resolved values fall back to computed values rather than used values.

The consequence is worth stating precisely, because it surprises people in both directions. Given `width: auto` on a hidden element, the probe reports `auto` rather than a pixel length. Given a percentage width on a hidden element, the probe reports the percentage rather than `auto`, because a percentage is a perfectly good computed value and there is simply nothing to resolve it against. The fallback follows the box rather than the declaration, so an element inside a `display: none` subtree behaves the same way even though its own `display` is not `none`.

This behavior is pinned against the engine in `test/browser/evaluator.test.ts`, so a browser that answers differently fails the suite rather than quietly changing what a probe reports.

### Records hold live elements

Browser records carry live `Element` references, which is what lets developer tools render them as inspectable nodes and is the whole point of the console adapter's output. The cost is that a subscriber which accumulates records into a long-lived array keeps those elements alive, including elements since removed from the document.

This is a consumer responsibility rather than something solved in the library, because a weak reference would defeat the inspection behavior that motivates the tool. In practice: let the console adapter render and discard, or bound whatever you retain, and do not push every record of every scan onto a module-level array that outlives the page state it describes.

### Development only

css-console is a development-time tool. It reads the document and never writes to it, but it fetches every same-origin stylesheet, compiles them, and calls `getComputedStyle()` once per matched element and pseudo-element pair. None of that belongs in a production bundle. Load it behind whatever development-only guard your build already has.

### Browsers without `@function` support

Function probes need CSS custom functions, and css-console detects support by reading one global, `CSSFunctionRule`. In an engine without it, a function probe produces one `RESERVED_PENDING_SUPPORT` diagnostic carrying the function name and the call-site count, and no records. It does not throw, and it does not stop the value probes beside it.

## Production CSS and minifiers

Annotations are CSS comments, and an ordinary CSS comment does not survive minification. **css-console annotations do not survive a production build, and that is by design.**

The tools that keep any comment at all keep only comments that opt in through the `/*!` marker, variously called a legal, important, or special comment. A css-console annotation opens with a plain `/*` and deliberately does not carry the `!`, so it falls in the category every one of these tools removes.

The behavior below was checked against each tool's own documentation, with the source named so that you can check it yourself. Every one of them removes a plain `/* ... */` comment when minifying.

| Tool                                                                             | Plain `/* ... */` | `/*! ... */`         | Control                                |
| -------------------------------------------------------------------------------- | ----------------- | -------------------- | -------------------------------------- |
| [cssnano](https://cssnano.github.io/cssnano/docs/optimisations/discardcomments/) | removed           | preserved by default | `discardComments: { removeAll: true }` |
| [esbuild](https://esbuild.github.io/api/#legal-comments)                         | removed           | preserved by default | `--legal-comments=none`                |
| [clean-css](https://github.com/clean-css/clean-css/blob/master/README.md)        | removed           | preserved by default | `specialComments: 0`                   |
| [Sass](https://sass-lang.com/documentation/syntax/comments/), compressed output  | removed           | preserved, always    | none documented                        |
| [Lightning CSS](https://lightningcss.dev/minification.html)                      | removed           | removed              | none exists                            |

Three notes on that table:

- cssnano's `discardComments` plugin runs in the default preset, so the behavior above is what you get without configuring anything. Its `removeAll` option is the boolean that also drops `/*!` comments; the separate `remove` option takes a function rather than a boolean.
- esbuild defines a legal comment as a rule-level comment that contains `@license` or `@preserve` or that starts with `/*!`, and its default is `inline` when bundling is off and `eof` when bundling is on. Its own documentation notes that this setting applies to both JavaScript and CSS.
- Lightning CSS is the exception in both directions. Its documentation does not discuss comments at all, and no comment-related option appears in its documented `transform` options. Behavior observed by running version 1.33.0 directly: it discards every comment, `/*!` included, and it does so even with `minify` set to `false`. This claim is therefore verified by execution rather than by documentation, because no official documentation of it exists; the open upstream issue is [parcel-bundler/lightningcss#43](https://github.com/parcel-bundler/lightningcss/issues/43).

Terser is not in the table because it is a JavaScript minifier and does not process CSS; if a pipeline runs Terser, some other tool is minifying the CSS.

None of this changes what you should do, because a probe annotation is a development-time artifact. It exists so that you can ask the browser a question while working on a stylesheet, and it has no job to do in a production build: css-console itself is development-only, so an annotation that survived into production would be a comment nothing reads.

The practical guidance follows:

- Assume annotations do not reach production, and never build behavior on the assumption that they do.
- Do not add `!` to an annotation to force preservation. Even preserved, an annotation does nothing without the library, and the library is not loaded in production.
- Keep annotations in source. They are committed to source on purpose, so that they survive refactors and travel to teammates, which is one of the things a developer-tools breakpoint cannot do.
- Check your own pipeline if the answer matters to you. Comment handling is a per-tool, per-version, per-option question, and the only fully reliable answer is the output of the build you actually run.

## The playground

`examples/playground/` is a demonstration page built around nine cases, each one a value the source text cannot state:

1. A custom function, resolved at every call site.
2. A color mix, resolved once per theme.
3. A container unit, resolved against its container.
4. A `clamp()`, at both bounds and between them.
5. A custom property, at the end of its inheritance chain.
6. A pseudo-element sized by its generated content.
7. A random value, behind a feature query.
8. A nested rule, and the selector it resolves to.
9. A shorthand competing with an annotated longhand, which ends in the guard's handoff to developer tools.

Every case shows its own CSS on the page beside the rendered result, so the annotation you are reading about is the annotation that produced the console output. The page runs one scan and needs no interaction; open it with the development server and read the console beside it.

## Further reading

- [diagnostics.md](diagnostics.md) — every diagnostic code, what it means, and what to do about it.
- [capabilities.md](capabilities.md) — what a page-scoped script can and cannot observe about computed CSS, and what only an engine could offer.
- [decisions/](decisions/) — the decision records behind the design.
