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

export default defineConfig({
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
        resolve: {
          alias: packageRootAlias,
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
