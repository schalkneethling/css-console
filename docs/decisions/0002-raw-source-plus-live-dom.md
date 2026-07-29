# 0002 — Raw source plus live DOM

This record explains why the runtime parses original CSS source text while evaluating values against the live document.

## Status

Accepted, 2026-07-26.

## Context

Probes are authored as CSS comments, for example `/* css-console: log */`. The natural place to read a page's CSS from JavaScript is the CSS Object Model, but the CSS Object Model does not expose comments. A tool whose entire input format is comments cannot be built on an API that discards them. At the same time, the values the tool reports must be the values the browser actually produced, in the real document, with the real cascade, containers, fonts, and inherited custom properties in effect.

## Decision

The runtime combines two inputs.

Annotations are read by parsing original source text: inline `<style>` element content, same-origin linked stylesheet text fetched over the network, and explicit raw sources supplied through the API. Parsing produces an AST in which comment nodes survive with source positions, which is the project's hard requirement for annotation association.

Values are read from the live document. Selector matching uses `querySelectorAll()`, and value resolution uses `getComputedStyle()` on real elements, so every reported value is one the engine computed in context. The scanner never writes to the document, and browser records carry live `Element` references so that developer tools render them as inspectable nodes.

Which parser performs the source-text half is deliberately not decided here. The choice between PostCSS and css-tree was prototyped under CSSC-002 against one fixture, and the parser selection record accepts PostCSS on that evidence. The deciding question was comment fidelity, specifically whether trailing comments survive with the precision that declaration association needs, including a final declaration with the semicolon omitted.

## Alternatives considered

Reading rules through the CSS Object Model alone was rejected because comments are unavailable through it, which removes the input format entirely.

Emulating CSS resolution from source text was rejected because it violates the litmus test: it reimplements the engine, and it cannot reproduce container queries, inheritance chains, or custom function evaluation. Both CSS Console and css-expect take the browser engine as the source of truth and neither emulates CSS.

Stamping identity attributes onto source elements was rejected because the scanner is read-only. Source identity instead uses a `WeakMap` for stability within an instance plus a content hash for stability across reloads, and a browser contract test asserts markup equality before and after a scan.

## Consequences

- The tool needs network access to same-origin stylesheets. Cross-origin sources without CORS access are deferred by choice, and when a fetch is blocked the tool emits a `SOURCE_LOAD_FAILED` diagnostic that lists the likely causes rather than asserting a single definite one.
- Constructed stylesheets without registered source text are deferred, because they have no source text to parse.
- Source text and the live document can disagree, for example when an inline style or another rule wins. The guard exists to keep that disagreement from producing misleading output.
- css-console is a development-time tool. It is not intended for production use, and its library and design choices assume it never ships to production. Annotations left in production CSS are in any case stripped by most minifiers, so the residual concern is minor; the documentation states this together with the exceptions.
- The parser decision is recorded on CSSC-002 evidence in the parser selection record, which accepts PostCSS.
