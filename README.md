# css-console

CSS Console is a development-only tool that turns inert, source-local CSS comments into live, element-specific value probes. Annotate a rule, a declaration, or a custom function, load the library in development, and read the authored and browser-resolved values for every matching element in the console you already have open.

```css
/* css-console: log inline-size, padding label="cards" */
.card {
  inline-size: calc(50vw - var(--space));
  padding: var(--space);
}
```

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

## What is here

- A **compiler** that reads annotations from CSS source text and turns them into rule, declaration, and function probes, resolving nesting and call sites without evaluating any CSS.
- A **browser evaluator** that asks the live engine what each probe resolved to, one element and pseudo-element pair at a time, and never writes to the document.
- A **scan lifecycle** with serialized scans, a live event stream, an abort signal, and a summary that carries every record and diagnostic.
- A **console adapter** that renders that stream as a collapsed group per probe, with tables at multiplicity, live elements you can inspect, and a handoff to developer tools wherever a value is contested.
- A **playground** at `examples/playground/` demonstrating nine cases whose values the source text cannot state.

## Documentation

- [docs/usage.md](docs/usage.md) — the annotation grammar, installation, the API and its options, the report, and the limitations.
- [docs/capabilities.md](docs/capabilities.md) — what a page-scoped script can and cannot observe about computed CSS, and what only an engine could offer.
- [docs/diagnostics.md](docs/diagnostics.md) — every diagnostic code, what it means, and what to do about it.
- [docs/decisions/](docs/decisions/) — the decision records behind the design.
- [plans/implementation.md](plans/implementation.md) — the full design contract.

## Development

This project uses [Vite+](https://viteplus.dev) and pnpm.

- Install dependencies: `vp install`
- Run the unit tests: `vp test`
- Format, lint, and type check: `vp check`
- Fix formatting and lint: `vp check --fix`
- Inspect annotations in a stylesheet: `vp run inspect:annotations -- path/to/file.css`
- Build the library: `vp pack`

## License

[MIT](LICENSE)
