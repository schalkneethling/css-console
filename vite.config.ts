import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vite-plus";

/**
 * The unit and browser suites both import the package by its published name,
 * so the entry point resolves from the package root rather than a deep path.
 * This alias points that name at the source entry point until a build exists.
 */
const packageRootAlias = {
  "@schalkneethling/css-console": new URL("./src/index.ts", import.meta.url).pathname,
};

/**
 * The specifiers postcss excludes from browser builds, pointed at an empty
 * module so that the browser resolves them to nothing.
 *
 * The compiler runs postcss in the page by design, and postcss declares
 * `"path": false`, `"fs": false`, `"url": false`, and `"source-map-js": false`
 * in the `browser` field of its package.json. Vite honors that field, but the
 * form the resolution takes depends on the shape of the specifier. A relative
 * key, `"./lib/terminal-highlight": false`, never reaches the dependency
 * pre-bundle's resolver, whose identifier filter is `/^[\w@][^:]/`, so
 * Rolldown emits it as an ignored, empty module. A bare key does reach that
 * resolver, which maps it to the sentinel `__vite-browser-external` and, in
 * development only, loads it as a Proxy that logs a console warning on every
 * property read. postcss destructures those four modules at module scope, so
 * loading the playground logged twenty-two warnings before this alias
 * existed.
 *
 * Aliasing runs ahead of both resolvers, so the sentinel is never produced
 * and the warning Proxy is never served.
 *
 * The alias belongs at the top level rather than under
 * `environments.client.resolve`, because the dependency pre-bundle is what
 * bakes the Proxy into the served module, and the resolver it uses for the
 * client environment reads the top-level `resolve.alias` only. The Node
 * lanes are unaffected: the specifiers are bare rather than `node:` prefixed,
 * no source file in this repository imports them under either spelling, and a
 * Node run loads postcss as an external CommonJS dependency, so postcss's own
 * requires never pass through this resolver.
 */
const browserExcludedAlias = Object.fromEntries(
  ["path", "fs", "url", "source-map-js"].map((specifier) => [
    specifier,
    new URL("./config/browser-excluded-module.js", import.meta.url).pathname,
  ]),
);

export default defineConfig({
  resolve: {
    alias: browserExcludedAlias,
  },
  staged: {
    "*": "vp check --fix",
    "*.ts": "ast-grep scan",
  },
  pack: {
    // The root tsconfig.json is a solution file with an empty file list, so
    // declaration generation reads the entry project configuration instead.
    tsconfig: "./src/tsconfig.json",
    dts: {
      tsgo: true,
    },
    exports: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
  test: {
    projects: [
      {
        resolve: {
          alias: packageRootAlias,
        },
        test: {
          name: "unit",
          environment: "node",
          include: ["test/unit/**/*.test.ts"],
        },
      },
      {
        // A project's `resolve.alias` replaces the top-level one rather than
        // extending it, so the browser lane restates the excluded specifiers
        // to keep the warning Proxy out of the modules it serves. The unit
        // lane above does not, and must not: it runs in Node, where these
        // modules are the real ones.
        resolve: {
          alias: { ...packageRootAlias, ...browserExcludedAlias },
        },
        test: {
          name: "browser",
          include: ["test/browser/**/*.test.ts"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
