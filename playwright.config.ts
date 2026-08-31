import { defineConfig } from "@playwright/test";

/**
 * Configuration for the end-to-end lane. The lane drives the playground
 * (`examples/playground/index.html`) through a real browser, because the
 * questions it asks — what a browser resolved a container unit to, what a
 * custom function returned at one call site — can only be answered by an
 * engine. The unit and browser lanes run through Vitest and are configured
 * in vite.config.ts.
 *
 * The lane starts its own Vite development server, so a run needs no
 * preparation beyond `vp run e2e`. `vp dev` is the repository's development
 * server command, and it listens on port 5173 by default, which is what
 * `baseURL` names.
 *
 * The readiness URL is the package entry point rather than the playground
 * itself. The entry point is served by the development server whether or not
 * the playground exists, so a missing or broken playground page fails inside
 * a test, where the failure names the page, instead of failing during server
 * startup, where it would read as a configuration error.
 *
 * The viewport is fixed so that every resolved value the specification
 * derives from the page is derived at one known size. The demonstrations are
 * written to vary on per-element custom properties and on container sizes
 * rather than on the viewport, so the viewport is a constant here rather
 * than a variable under test.
 */
export default defineConfig({
  testDir: "./test/e2e",
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: {
    command: "vp dev",
    url: "http://localhost:5173/src/index.ts",
    // A developer running the lane repeatedly reuses the server they already
    // have; continuous integration always starts a fresh one, so a stale
    // server can never answer for the working tree.
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
  },
});
