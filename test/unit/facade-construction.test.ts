import { expect, test } from "vite-plus/test";

import { createCSSConsole, PACKAGE_NAME } from "@schalkneethling/css-console";

/**
 * The facade under Node, where no document exists.
 *
 * The package must be importable and constructible in an environment with no
 * DOM, because a consumer bundles it into code that also runs on a server,
 * and an import-time or construction-time DOM access would crash that code
 * before any scan was asked for. Scanning needs a document and is a browser
 * act; construction is not.
 */

test("the package root imports and constructs without a document", () => {
  expect(PACKAGE_NAME).toBe("@schalkneethling/css-console");

  const cssConsole = createCSSConsole({ maxElements: 10, waitForFonts: true });

  expect(typeof cssConsole.scan).toBe("function");
  expect(typeof cssConsole.subscribe).toBe("function");

  cssConsole.dispose();
});

test("configuration validation works without a document", () => {
  expect(() => createCSSConsole({ maxElements: Number.NaN })).toThrow(TypeError);
  expect(() => createCSSConsole({ maxElements: -1 })).toThrow(RangeError);
});
