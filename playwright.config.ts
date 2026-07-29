import { defineConfig } from "@playwright/test";

/**
 * Configuration for the end-to-end lane. The lane has no tests yet; it
 * exists so that the playground tests added in phase 4 have a home. The
 * unit and browser lanes run through Vitest and are configured in
 * vite.config.ts.
 */
export default defineConfig({
  testDir: "./test/e2e",
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
