# css-console

> **Status: early development.** The public API is currently a typed stub while the core is being built. See [plans/implementation.md](plans/implementation.md) for the full design contract.

CSS Console is a development-only tool that turns inert, source-local CSS comments into live, element-specific value probes. Annotate a rule or declaration, load the library in development, and see the authored and browser-resolved values for every matching element — without repeatedly selecting those elements in DevTools.

```css
/* @schalkneethling/css-console log inline-size,padding label="cards" */
.card {
  inline-size: calc(50vw - var(--space));
  padding: var(--space);
}
```

## Usage (planned API)

```ts
import { createCSSConsole } from "@schalkneethling/css-console";

const cssConsole = createCSSConsole({
  sources: "document",
  maxElements: 50,
  waitForFonts: false,
});

const unsubscribe = cssConsole.subscribe((event) => {
  // probe records, diagnostics, and the scan summary
});

const summary = await cssConsole.scan();
cssConsole.dispose();
```

## Development

This project uses [Vite+](https://viteplus.dev) and pnpm.

- Install dependencies: `vp install`
- Run the unit, static, and browser test lanes: `vp test`
- Typecheck the project reference graph: `pnpm typecheck`
- Lint and check formatting: `pnpm quality`
- Fix lint and formatting: `pnpm lint:fix && pnpm format`
- Build the library: `pnpm build` (or `vp run build`; the plain `vp build` command is the Vite+ builtin, not this script)
- Run the full merge gate: `pnpm gate`
- Re-run the parser spike evidence: `pnpm spike:parser`

The `lint` and `format` scripts also collide with Vite+ builtins; use the pnpm form, or `vp run lint` and `vp run format`.

## License

[MIT](LICENSE)
