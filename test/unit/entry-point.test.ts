import { expect, test } from "vite-plus/test";

import { compileSource, PACKAGE_NAME } from "@schalkneethling/css-console";
import type { CompiledSource } from "@schalkneethling/css-console";

/**
 * Public entry point tests.
 *
 * The package exposes one entry point, so what it exports is a contract in
 * its own right and is pinned here deliberately rather than incidentally.
 * `compileSource()` joins it with CSSC-016: it is the whole compiler behind
 * one function, and Phase 1 ends with a consumer able to compile a stylesheet
 * without reaching into a directory under src/.
 */

test("the public entry point resolves from the package root", () => {
  expect(PACKAGE_NAME).toBe("@schalkneethling/css-console");
});

test("a consumer compiles a source through the package root alone", () => {
  const compiled: CompiledSource = compileSource(
    `/* css-console: log color label="title" */
.card__title {
  color: rgb(20 20 20);
}`,
    { url: "https://example.test/card.css" },
  );

  expect(compiled.url).toBe("https://example.test/card.css");
  expect(compiled.probes).toHaveLength(1);
  expect(compiled.probes[0]?.kind).toBe("value");
  expect(compiled.diagnostics).toEqual([]);
  expect(compiled.guardIndex.byProperty.size).toBeGreaterThan(0);
});
