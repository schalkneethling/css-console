import { expect, test } from "vite-plus/test";
import { createCSSConsole } from "../src/index.ts";

test("createCSSConsole returns an instance with the planned API surface", () => {
  const cssConsole = createCSSConsole({ sources: "document" });

  expect(typeof cssConsole.subscribe).toBe("function");
  expect(typeof cssConsole.scan).toBe("function");
  expect(typeof cssConsole.dispose).toBe("function");
});

test("scan rejects until the core is implemented", async () => {
  const cssConsole = createCSSConsole({ sources: "document" });

  await expect(cssConsole.scan()).rejects.toThrow("not implemented");
});
