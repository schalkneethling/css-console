import { expect, test } from "vite-plus/test";

import { createCSSConsole } from "@schalkneethling/css-console";
import type { BrowserScanEvent, BrowserScanSummary } from "@schalkneethling/css-console";

/**
 * The public facade, exercised as a consumer would use it.
 *
 * CSSC-029 is the Phase 3 checkpoint: one public `createCSSConsole()`
 * discovers supported sources, compiles them, evaluates them, and returns a
 * summary carrying records. Every import in this file comes from the package
 * root, because the facade's contract is that a consumer needs nothing else,
 * and the suite scans the real page document, because that is what a
 * consumer's scan does; assertions therefore filter to this file's own
 * fixtures rather than assuming the page holds nothing besides them.
 */

/**
 * Appends a fixture subtree to the page, runs the body, and removes it
 * however the body ends. The style element travels inside the subtree, so
 * the facade discovers it exactly as it discovers page CSS.
 */
async function withFixture<T>(
  markup: string,
  css: string,
  body: (host: HTMLElement) => Promise<T> | T,
): Promise<T> {
  const host = document.createElement("div");
  const style = document.createElement("style");

  style.textContent = css;
  host.append(style);
  host.insertAdjacentHTML("beforeend", markup);
  document.body.append(host);

  try {
    return await body(host);
  } finally {
    host.remove();
  }
}

/** The records a summary carries for one selector, however the page looks. */
function recordsFor(summary: BrowserScanSummary, selector: string) {
  return summary.records.filter(
    (record) => record.kind === "value" && record.selector === selector,
  );
}

test("a consumer reads records from the returned summary without subscribing", async () => {
  const css = `/* css-console: log color */
.facade-solo { color: rgb(1, 2, 3); }`;

  await withFixture(`<p class="facade-solo"></p>`, css, async () => {
    const cssConsole = createCSSConsole();

    try {
      const summary = await cssConsole.scan();
      const records = recordsFor(summary, ".facade-solo");

      expect(records).toHaveLength(1);
      expect(records[0]?.kind === "value" ? records[0].values[0]?.resolved : undefined).toBe(
        "rgb(1, 2, 3)",
      );
    } finally {
      cssConsole.dispose();
    }
  });
});

test("a subscriber receives the event stream and the summary the scan resolves with", async () => {
  const css = `/* css-console: log color */
.facade-subscribed { color: rgb(2, 2, 2); }`;

  await withFixture(`<p class="facade-subscribed"></p>`, css, async () => {
    const cssConsole = createCSSConsole();
    const events: BrowserScanEvent[] = [];
    const unsubscribe = cssConsole.subscribe((event) => events.push(event));

    try {
      const summary = await cssConsole.scan();
      const last = events[events.length - 1];

      expect(last?.kind).toBe("summary");
      expect(last?.kind === "summary" ? last.summary : undefined).toBe(summary);

      unsubscribe();

      const delivered = events.length;

      await cssConsole.scan();
      expect(events).toHaveLength(delivered);
    } finally {
      cssConsole.dispose();
    }
  });
});

test("explicit raw sources scan beside the document, and 'none' scans them alone", async () => {
  const documentCss = `/* css-console: log color */
.facade-mixed { color: rgb(3, 3, 3); }`;
  const rawCss = `/* css-console: log margin-left */
.facade-mixed { margin-left: 7px; }`;

  await withFixture(`<p class="facade-mixed"></p>`, documentCss, async () => {
    const mixed = createCSSConsole({
      sources: "document",
      rawSources: [{ id: "facade-raw", css: rawCss }],
    });

    try {
      const summary = await mixed.scan();

      // Both the discovered inline source and the raw source produced a
      // record for the same element.
      expect(recordsFor(summary, ".facade-mixed")).toHaveLength(2);
    } finally {
      mixed.dispose();
    }

    const rawOnly = createCSSConsole({
      sources: "none",
      rawSources: [{ id: "facade-raw", css: rawCss }],
    });

    try {
      const summary = await rawOnly.scan();
      const records = recordsFor(summary, ".facade-mixed");

      // The document's annotated style was not compiled, so only the raw
      // source's margin probe reports.
      expect(records).toHaveLength(1);
      expect(records[0]?.kind === "value" ? records[0].values[0]?.name : undefined).toBe(
        "margin-left",
      );
    } finally {
      rawOnly.dispose();
    }
  });
});

test("an exclude pattern removes a source through the public options", async () => {
  const css = `/* css-console: log color */
.facade-excludable { color: rgb(4, 4, 4); }`;

  await withFixture(``, ``, async (host) => {
    const style = document.createElement("style");

    style.setAttribute("data-css-console-source", "facade-excluded");
    style.textContent = css;
    host.append(style);
    host.insertAdjacentHTML("beforeend", `<p class="facade-excludable"></p>`);

    const excluding = createCSSConsole({ exclude: ["inline:facade-excluded"] });

    try {
      const summary = await excluding.scan();

      expect(recordsFor(summary, ".facade-excludable")).toHaveLength(0);
      expect(summary.sources.excluded).toBeGreaterThanOrEqual(1);
    } finally {
      excluding.dispose();
    }
  });
});

test("maxElements travels through the facade and the summary keeps the totals", async () => {
  const css = `/* css-console: log color */
.facade-limited { color: rgb(5, 5, 5); }`;

  await withFixture(
    `<p class="facade-limited"></p><p class="facade-limited"></p><p class="facade-limited"></p>`,
    css,
    async () => {
      const cssConsole = createCSSConsole({ maxElements: 2 });

      try {
        const summary = await cssConsole.scan();

        expect(recordsFor(summary, ".facade-limited")).toHaveLength(2);
        expect(summary.matches.omitted).toBeGreaterThanOrEqual(1);
      } finally {
        cssConsole.dispose();
      }
    },
  );
});

test("construction is side-effect free: no scan runs and the page is untouched", async () => {
  const before = document.documentElement.outerHTML;
  const events: BrowserScanEvent[] = [];
  const cssConsole = createCSSConsole({ waitForFonts: true });

  cssConsole.subscribe((event) => events.push(event));

  // One macrotask: nothing may have run without scan() being called.
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(events).toEqual([]);
  expect(document.documentElement.outerHTML).toBe(before);

  cssConsole.dispose();
});

test("dispose ends the instance: a later scan rejects", async () => {
  const cssConsole = createCSSConsole();

  cssConsole.dispose();

  await expect(cssConsole.scan()).rejects.toThrow(/disposed/);
});

test("a configuration error fails construction rather than the first scan", () => {
  expect(() => createCSSConsole({ maxElements: -3 })).toThrow(RangeError);
});
