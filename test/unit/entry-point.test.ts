import { expect, test } from "vite-plus/test";

import { PACKAGE_NAME } from "@schalkneethling/css-console";

test("the public entry point resolves from the package root", () => {
  expect(PACKAGE_NAME).toBe("@schalkneethling/css-console");
});
