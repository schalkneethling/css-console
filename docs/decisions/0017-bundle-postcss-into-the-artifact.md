# 0017 — Bundle PostCSS into the artifact

This record decides how the packed artifact treats its parser: `postcss` and `postcss-value-parser` are bundled into `dist/index.mjs`, both move to `devDependencies`, and the published package declares no runtime dependencies at all.

## Status

Accepted, 2026-08-31. Decided in issue [#71](https://github.com/schalkneethling/css-console/issues/71), raised during the [#66](https://github.com/schalkneethling/css-console/issues/66) investigation.

## Context

Issue #71 opened on an inference that turned out to be wrong, and the correction is worth recording because it changes what the decision is about. The issue read a 280 kB `dist/index.mjs` as evidence that PostCSS was already bundled. It was not. The artifact at that point opened with `import postcss from "postcss"` and `import valueParser from "postcss-value-parser"`, both left external, and the 280 kB was this project's own unminified source with its doc comments intact. So the artifact was externalized by default, and the question was whether to leave it that way.

What made externalization the wrong default here is behavior pinning. Record 0013 selected PostCSS on comment fidelity: the omitted-semicolon case, `.a { color: red /* css-console: log */ }`, is decisive, and the association rules depend on comments arriving as first-class nodes with precise start and end positions. Trailing-comment placement and source positions are not incidental details of the parser this project happens to use; they are the substrate the annotation carrier stands on. An externalized `^8.5.23` hands the consumer's package manager the choice of which parser resolves, so a consumer can run css-console against a PostCSS release that the test suite never saw, on exactly the behavior the suite exists to protect.

Three further facts favored bundling, and one favored externalizing.

The browser field is solved once when it is solved in the artifact. PostCSS declares `"path": false`, `"fs": false`, `"url": false`, `"source-map-js": false`, and `"./lib/terminal-highlight": false` in the `browser` field of its package.json, and issue [#65](https://github.com/schalkneethling/css-console/issues/65) established what those resolve to for the development server: an empty module, never a Node builtin and never Vite's warning proxy. An externalized artifact exports that unsolved problem to every consumer's bundler, each of which resolves the field in its own way. A bundled artifact answers it once, at build time, in this repository.

CommonJS interoperability is likewise solved once. PostCSS ships CommonJS, and the interoperability wrapper the bundler generates is a build-time concern here rather than a per-consumer one.

Size tolerance is unusually high for this package. css-console is development-only by design, so the artifact is never in a production bundle and the kilobytes are paid on a developer machine.

Against bundling stands deduplication and, more seriously, patch latency. A consumer who already depends on PostCSS now ships two copies. And a PostCSS security fix reaches css-console users through a css-console release rather than through their own lockfile: with an externalized dependency, `pnpm update` is enough; with a bundled one, this project must rebuild and republish first. That cost is real, and it is accepted rather than dismissed.

## Decision

`postcss` and `postcss-value-parser` are bundled into the packed artifact.

- Both packages move from `dependencies` to `devDependencies`, and `dependencies` is left empty. "Bundled plus development dependency" is the coherent shape: the packages are needed to build css-console and are not needed to install it, which is exactly what `devDependencies` states.
- The move is also what makes the bundling happen. Externalization in this toolchain is driven by the production dependency set, not by a bundler default: tsdown, as vendored in `@voidzero-dev/vite-plus-core` 0.2.6, externalizes an identifier only when the union of `dependencies`, `peerDependencies`, `peerDependenciesMeta`, and `optionalDependencies` contains it (the `getProductionDeps` and `externalStrategy` functions, read from the installed package at the time of this record). A `devDependency` is bundled by that rule alone. `pack.deps.onlyBundle` then states the intent explicitly and turns anything else reaching the bundle into a build error rather than an informational hint.
- The pack build declares `platform: "browser"`, because the artifact is a browser artifact. On the tsdown default of `node`, the first bundled build emitted `import { createRequire } from "node:module"` along with `__require("fs")`, `__require("path")`, and `__require("url")`, from the `__dirname` shim banner and from the builtin branch of the externalization strategy. The browser platform removes both, and it is what makes Rolldown read the `browser` field that excludes `./lib/terminal-highlight`.
- The pack build restates the browser-excluded alias from #65. The pack pipeline is tsdown, not Vite, and it never reads the top-level `resolve.alias`: it passes only its own `alias` option through as Rolldown's `resolve.alias`. So `path`, `fs`, `url`, and `source-map-js` are aliased to `config/browser-excluded-module.js`, the same empty module the development server and the browser test lane use. The artifact resolves them to nothing, never to a Node builtin and never to a warning stub.
- `fixedExtension: true` pins the output name. tsdown derives that flag from the platform, so the browser platform would otherwise rename `index.mjs` to `index.js` and rewrite the generated `exports` field with it. The extension is part of the published surface and does not follow the platform.

The resulting `dist/index.mjs` is 404 kB unminified and contains no `import` or `require` statement of any kind.

## Alternatives considered

**Leave the artifact externalized**, the toolchain default and the convention for a library that declares a dependency. Rejected on behavior pinning: the parser behaviors record 0013 selected PostCSS for are load-bearing, and a caret range hands the consumer's lockfile a parser this project never tested. The convention it follows also assumes the consumer benefits from deduplication, which a development-only tool with no production footprint benefits from least.

**Externalize but pin the version exactly**, replacing `^8.5.23` with `8.5.23`. Rejected because an exact range in a library is a deduplication hazard rather than a guarantee: it does not stop a consumer's override or resolution from installing something else, it does not answer the browser-field question, and it converts every PostCSS patch into a css-console release anyway, which is the cost of bundling without the benefit.

**Declare PostCSS a peer dependency.** Rejected because it puts the parser choice, the browser-field resolution, and an install step on the consumer, for a tool whose value is that it works when it is dropped into a page.

**Bundle while keeping both in `dependencies`.** Rejected as incoherent, and in this toolchain it does not even build: production dependencies are precisely the set that gets externalized, so the artifact would keep the bare imports while the package.json told consumers to install packages the artifact would then not use.

## Consequences

- The published package declares no runtime dependencies. `npm install @schalkneethling/css-console` installs one file's worth of code and nothing transitive.
- A consumer gets exactly the PostCSS the test suite ran against, so comment fidelity, trailing-comment placement, and source positions behave in the consumer's page the way they behave in this repository's tests.
- A PostCSS security fix now requires a css-console release. Updating the `devDependency` and republishing is the only path a consumer has, and this project accepts that maintenance obligation as the price of the pinning.
- A consumer who also depends on PostCSS ships two copies. For a development-only tool this is accepted.
- The artifact grew from 280 kB to 404 kB unminified, 111 kB gzipped. Minification is not enabled and remains available as a separate change.
- CSSC-038, the package and continuous integration release gates, must pin this decision with package-content checks. The artifact must contain no bare `postcss` or `postcss-value-parser` import, no import of a Node builtin under either the bare or the `node:` spelling, and no warning stub; `package.json` must declare an empty `dependencies` object. These checks are what stop a future toolchain default, or a stray move back to `dependencies`, from silently re-externalizing the parser.
- `package.json` gains an `inlinedDependencies` block, written by the pack build's `exports` step from the versions it actually inlined. It records `postcss@8.5.23`, `postcss-value-parser@4.2.0`, `nanoid@3.3.16`, and `picocolors@1.1.1`, so the published manifest states which parser the artifact carries even though it declares no dependency on one.
- `pack.deps.onlyBundle` names the packages allowed into the bundle, currently `postcss`, `postcss-value-parser`, and PostCSS's own `nanoid` and `picocolors`. Any new bundled dependency fails the build until it is named there deliberately.
