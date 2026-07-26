import { expect, test } from "vite-plus/test";
import { createCSSConsole } from "../../src/index";

test("public entry point exposes createCSSConsole", () => {
  expect(typeof createCSSConsole).toBe("function");
});
