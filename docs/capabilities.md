# Capabilities

This page is the capability argument behind css-console: what a script running inside a page can observe about computed CSS, what it cannot, and why the boundary sits where it does.

It is written for two audiences at once. If you use css-console, this page explains why certain questions get a diagnostic instead of an answer, and it does so without asking you to read the implementation. If you work on a browser engine, this page is a list of things that only you can provide, each with the reason page JavaScript cannot reach it.

## The litmus test

Every feature in css-console answers one question before it enters the plan: are we reimplementing something browser developer tools already do, or are we enhancing what they offer within the limits of page JavaScript?

A feature that reimplements is rejected. A feature that enhances is considered on its merits. Reimplementation looks like cascade resolution, specificity ranking, layer ordering, and box-model geometry; developer tools already do those, and page JavaScript cannot do them fully in any case. Enhancement looks like a probe that sits in the source where the doubt already is, that reports every matched element at once, that shows a function call together with its arguments and its resolved value across every call site, and that survives a reload because it is committed to source.

The litmus test is recorded in [0001-scope-principle-and-litmus-test.md](decisions/0001-scope-principle-and-litmus-test.md). This page is the other half of that record: the litmus test says what css-console refuses to reimplement, and the list below says what css-console could not reimplement even if it wanted to.

## What a page-scoped script can observe

The ground css-console stands on is small and entirely standard. Everything the tool reports comes from these:

- **`getComputedStyle(element, pseudo)`** returns the resolved value of any property for one element and pseudo-element pair. This is the whole of the value story. The object it returns is live rather than a snapshot, which is why css-console acquires one declaration per element and pseudo-element pair, reads every requested property consecutively, and performs no DOM access between the reads.
- **`querySelectorAll()`** answers which elements a selector branch matches, in document order. The engine's own selector parser is the arbiter, including for selectors it rejects: a selector the engine cannot parse throws a `SyntaxError`, which is a fact about the engine rather than a judgment css-console makes.
- **`matchMedia(query).matches` and `CSS.supports()`** answer whether a condition holds at the moment of the read. Both read live state, so neither answer may be cached: a media query result changes when the viewport is resized, when orientation changes, when the color scheme is switched, and when a print preview opens.
- **`CSS.supports()` on a property and value pair, and the presence of a CSSOM interface such as `CSSFunctionRule`,** answer whether the engine implements a feature at all. That is how css-console distinguishes "your browser does not do this yet" from "this tool does not do this".
- **`document.styleSheets` and the CSSOM** enumerate the stylesheets the browser is currently reading, which is how a scan learns which sources are active rather than merely present.
- **The text of same-origin sources**, read from an inline `<style>` element's `textContent` or fetched from a linked stylesheet's URL, is what carries the annotation comments. The CSSOM does not preserve comments, so source text is not optional; the reasoning is recorded in [0002-raw-source-plus-live-dom.md](decisions/0002-raw-source-plus-live-dom.md).
- **`document.fonts.ready`** answers when font loading has settled, which matters because font metrics move layout and therefore move resolved values.
- **`performance.now()`** provides a monotonically non-decreasing clock for record timestamps.

That list is enough to build a probe that reports, for every element a selector matches, what the browser resolved a property to and what the author wrote. It is not enough to explain why.

## What is out of reach from page JavaScript

Each item below is unreachable from a script running in the page. These are not features css-console postponed; postponed features are a separate category, and keeping the two apart is the point of the three-way scope split recorded in [0008-three-way-scope-split.md](decisions/0008-three-way-scope-split.md). Reading a permanent limit as a missing feature, or the reverse, sends an author looking for a fix that does not exist.

### Which branch inside a custom function body produced `result`

This is the sharpest item on the list, and it is the one css-console most wants.

A custom function body may declare `result` conditionally, wrapping declarations in `@media` or `@supports` so that different conditions produce different results. From outside, all of that collapses. `getComputedStyle()` exposes the destination property's resolved value, and the destination property's own value resolution has already applied by then, so what the page can read is a single string with no provenance. There is no CSSOM interface that reports which declaration inside a function body was the one that supplied `result` for a given evaluation, and there is no way to instrument the evaluation from outside the engine.

The consequence for a user is concrete: a function probe can tell you that `--space(4)` produced `24px` for this element and `16px` for that one, and it cannot tell you which line of the function body each came from. That is the question an author debugging a conditional function most wants answered, and it is the question a page script cannot answer.

Reconstructing it from outside is not an option either. Re-evaluating the branches yourself means emulating the engine, and every design record in this project refuses to emulate CSS.

### The value of `result` itself, in isolation

Related but distinct. Even for an unconditional function body, the page never observes the function's return value; it observes the destination property's resolved value after that property's value resolution has transformed the result. A function returning a percentage or a relative length is a clear case: the percentage resolves against the destination property's reference, and what remains is a length that no longer reveals what the function returned.

This is why css-console's records name the field `resolved` and the console adapter names the table column `resolved property value`, and why `soleContribution` claims only that no other authored expression contributed to the declaration, never that the reported value is the function's own.

Isolating the call would mean synthesizing a probe element carrying the original element's custom property context and reading the result from it. That is possible off-page and impossible under a read-only guarantee, which is exactly the division of labor recorded in [0012-relationship-to-css-expect.md](decisions/0012-relationship-to-css-expect.md): [css-expect](https://github.com/schalkneethling/css-expect) isolates properly, in Node, through Playwright, and is the right tool for that question.

### Full cascade provenance

Specificity ranking, layer ordering, and order of appearance together decide which declaration produced a value. A page script can enumerate the rules in the stylesheets it can read, and it can read the value that came out, but it cannot ask the engine which declaration won. There is no CSSOM call that returns the winning declaration for a property on an element.

Developer tools can show this because developer tools talk to the engine through a protocol the page does not have. That is the whole reason css-console has a guard rather than a cascade explanation: the guard reports that the annotated declaration may not be the sole contributor and names why it might not be, and then hands off to developer tools, which can answer the question the page cannot. The reasoning is recorded in [0004-guard-as-guard-not-cascade-feature.md](decisions/0004-guard-as-guard-not-cascade-feature.md).

### User-agent and user-origin stylesheets

The browser's own default stylesheet and any user stylesheet participate in the cascade and are not exposed to page JavaScript in any form. Their declarations do not appear in `document.styleSheets`, and their contribution to a resolved value is indistinguishable from any other contribution once the value has resolved.

This is a deliberate boundary rather than an oversight in the platform, and it means a page script can never present a complete account of where a value came from.

### Presentational hints from HTML attributes

Attributes such as `width` on an image map into the cascade as presentational hints at a defined position, below author declarations. They are not declarations in any stylesheet the page can read, so a script cannot enumerate them as cascade participants; it can read the attribute, but it cannot observe the hint's participation.

### The contribution of a running transition or animation

A transition or an animation overrides the value the cascade computed, and `getComputedStyle()` reports the animated value while the animation runs. A page script can detect that an animation or transition is running on the element, which is exactly what css-console's `animation-or-transition` guard reason does, and it cannot decompose the observed value into the underlying declaration and the animation's contribution to it.

The honest thing to do with a value read mid-animation is to say that it is contested and why, which is what the guard does.

### Cross-origin stylesheets without CORS access

A stylesheet served from another origin without CORS headers can style the page and cannot be read by it. `cssRules` on such a sheet throws, and fetching its text fails. That failure is deliberately indistinguishable from a Content Security Policy restriction and from a network error, because distinguishing them would leak cross-origin state, so css-console reports one `SOURCE_LOAD_FAILED` diagnostic listing the likely causes rather than claiming one.

An annotation inside such a stylesheet therefore cannot be seen at all, and css-console cannot even report that it exists.

### Constructed stylesheets with no registered source text

A stylesheet built through the CSSOM, whether by `CSSStyleSheet.replaceSync()` or by rule insertion, and adopted into a document has no source text to read. The CSSOM does not preserve comments, so annotations that existed in the string a sheet was constructed from are gone by the time the sheet exists. A page script observing such a sheet sees rules and no comments, which means it sees no annotations.

This is why css-console offers `rawSources`: a consumer who constructs stylesheets can hand the tool the source text alongside them, which restores exactly what the CSSOM discarded.

### Shadow DOM behind a closed root

A closed shadow root is not reachable from the page, by design. Elements inside it cannot be matched, and their computed styles cannot be read. An open root is reachable but is deferred by choice rather than out of reach.

### Box-model geometry as a probe subject

Used values that only exist as layout output, such as the actual line box a piece of text occupied, are partly readable through geometry APIs such as `getBoundingClientRect()` and `getClientRects()`. That reading is possible, and css-console still refuses it, on the litmus test rather than on a capability limit: developer tools already draw the box model, and reimplementing it would make this tool a worse inspector. It appears here so that the reason is on the record as a scope decision rather than a capability claim.

### Paged media

A page box is not an element, so there is no `getComputedStyle()` call to make for an `@page` rule, and no probe of the kind every other css-console probe is. `CSSPageRule.style` does expose the declared style, and that is not nothing: `@page { margin: calc(1cm + 2mm) }` serializes there with the absolute arithmetic already resolved. What it cannot answer is which page a given rule applied to, and margin at-rules such as `@top-center` carry `content` with counters that only exist during pagination. A useful paged-media probe therefore needs an evaluation strategy that no browser exposes today.

### A recorded implementation gap, distinct from the above

One limitation in the current release is a gap in css-console rather than a limit of the platform, and it is named here so that it is not mistaken for one.

A function record's guard cannot report the `unresolved-variable` reason in this release. That reason works by substituting custom property references into the declaration's authored value, and a compiled call site retains its arguments rather than the full declaration value, so the subject carries an empty reference list and the check never runs. The gap is recorded in the module documentation of `src/browser/records/index.ts`, and retaining the authored value on the call site is the follow-up that would close it. Nothing about the platform prevents this; it is work not yet done.

## What an engine-level implementation could offer

Everything above except the last item is a limit of the interface between a page and the engine, not a limit of the engine. An implementation inside the engine, or a developer-tools protocol domain, would face none of it.

**Which branch produced `result` is the ask.** A custom function body is the first place in CSS where an author writes something that resembles a program with branches, and it is the first place where the source text genuinely does not tell you what happened. Everything else on the out-of-reach list is a provenance question that developer tools already answer through the protocol. Function-body branch attribution is a provenance question nobody answers, because the feature is new and no tooling has caught up with it yet.

The shape of the answer does not need to be elaborate. For one evaluation of one function on one element, the useful facts are: which declaration of `result` supplied the value, the source location of that declaration, and the values the arguments were bound to. With those three, an author debugging a conditional function is finished. Without them, the author is guessing, and the only recourse is to comment out branches until the value changes.

Two further items would follow naturally from the same surface, and both are smaller:

- **The winning declaration for a property on an element**, which developer tools already computes internally and does not expose to page script. Making it available would let a guard become an explanation, at which point the handoff described above would no longer be necessary.
- **The contribution of a running animation or transition**, separated from the underlying cascaded value. Developer tools can already show the animation; separating its contribution from the value beneath it would let a probe report both.

This project is not a standards proposal, and this page does not pretend to be one. It is a record of where the ceiling is, written down while the reasons are fresh, so that anyone who later wants to raise it does not have to rediscover which questions were unanswerable and why.

## Further reading

- [usage.md](usage.md) — the annotation grammar, the API, and the report.
- [diagnostics.md](diagnostics.md) — every diagnostic code, including the ones that report the limits described here.
- [decisions/](decisions/) — the decision records these pages cite.
