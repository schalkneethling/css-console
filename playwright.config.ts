import { defineConfig } from "@playwright/test";

/**
 * End-to-end lane. Tests arrive with the playground in Phase 4; this
 * configuration exists now so the lane is wired and reviewable.
 */
export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4173",
  },
  projects: [{ name: "chromium", use: { channel: "chromium" } }],
});
