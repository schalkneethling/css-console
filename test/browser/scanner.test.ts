import { expect, test } from "vite-plus/test";

import { createScanner } from "../../src/browser/scanner/index.ts";
import type { BrowserScanEvent } from "../../src/browser/records/index.ts";

/**
 * The scan lifecycle, checked against the live engine.
 *
 * CSSC-028 composes everything Phase 2 and the source track built into one
 * scan: readiness, optional font settling, one animation-frame
 * stabilization, discovery, gating, compilation, evaluation, and a summary.
 * Every case runs the real pipeline against real fixtures, and the lifecycle
 * facts relied on, document readiness transitions and animation-frame
 * ordering, are read from headless Chromium 151.0.7922.34 rather than
 * recalled.
 *
 * Scans are confined to a fixture subtree through the scanner's `root`
 * option, so one test's `.card` can never be another test's match, and
 * fixtures are removed however a test ends.
 */

/**
 * Appends a fixture subtree, runs the body against it, and removes it
 * however the body ends. CSS travels inside the subtree as a style element,
 * so the scanner discovers it exactly as it would discover page CSS.
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

/** The kind of every event, in delivered order. */
function kinds(events: readonly BrowserScanEvent[]): string[] {
  return events.map((event) => event.kind);
}

test("a scan discovers, compiles, evaluates, and resolves with a summary carrying records", async () => {
  const css = `/* css-console: log color */
.solo-scan { color: rgb(1, 2, 3); }`;

  await withFixture(`<p class="solo-scan"></p>`, css, async (host) => {
    const scanner = createScanner({ root: host });
    const summary = await scanner.scan();

    expect(summary.records).toHaveLength(1);
    expect(summary.records[0]?.kind).toBe("value");
    expect(summary.sources).toEqual({ discovered: 1, compiled: 1, failed: 0, excluded: 0 });
    expect(summary.probes).toEqual({ compiled: 1, evaluated: 1, skipped: 0 });
    expect(summary.matches).toEqual({ total: 1, evaluated: 1, omitted: 0 });
    expect(summary.diagnostics).toEqual([]);
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);

    scanner.dispose();
  });
});

test("subscribers receive every event in order, ending with the summary", async () => {
  const css = `/* css-console: log color */
.subscribed { color: rgb(2, 2, 2); }`;

  await withFixture(`<p class="subscribed"></p>`, css, async (host) => {
    const scanner = createScanner({ root: host });
    const events: BrowserScanEvent[] = [];
    const unsubscribe = scanner.subscribe((event) => events.push(event));
    const summary = await scanner.scan();

    expect(kinds(events)).toEqual(["probe-start", "record", "probe-summary", "summary"]);

    const last = events[events.length - 1];

    expect(last?.kind === "summary" ? last.summary : undefined).toBe(summary);

    unsubscribe();
    scanner.dispose();
  });
});

test("a scan waits for one animation frame, so a change scheduled before it is visible", async () => {
  // The stabilization frame exists so a scan reads the document after the
  // rendering the caller can see, rather than between a mutation and its
  // recalculation. Animation-frame callbacks run in registration order in
  // headless Chromium 151.0.7922.34, so a class added in a callback
  // registered before the scan's own stabilization callback is visible to
  // the scan.
  const css = `/* css-console: log color */
.stabilized.moved { color: rgb(9, 9, 9); }`;

  await withFixture(`<p class="stabilized"></p>`, css, async (host) => {
    const element = host.querySelector(".stabilized");

    requestAnimationFrame(() => {
      element?.classList.add("moved");
    });

    const scanner = createScanner({ root: host });
    const summary = await scanner.scan();

    expect(summary.matches.total).toBe(1);

    scanner.dispose();
  });
});

test("waiting for fonts is an option, and a scan with it enabled still completes", async () => {
  // document.fonts.ready is a promise the engine resolves once loading
  // settles; in a lane with no pending font loads it resolves promptly,
  // which is pinned here so the option cannot deadlock a scan.
  const css = `/* css-console: log color */
.fonted { color: rgb(3, 3, 3); }`;

  await withFixture(`<p class="fonted"></p>`, css, async (host) => {
    await document.fonts.ready;

    const scanner = createScanner({ root: host, waitForFonts: true });
    const summary = await scanner.scan();

    expect(summary.records).toHaveLength(1);

    scanner.dispose();
  });
});

test("a scan on a document that is still loading waits for readiness", async () => {
  // A real loading document rather than a stub: an iframe whose document is
  // opened and written but not closed reports readyState "loading" in
  // headless Chromium 151.0.7922.34, and closing it fires DOMContentLoaded.
  const frame = document.createElement("iframe");

  document.body.append(frame);

  try {
    const frameDocument = frame.contentDocument;

    if (frameDocument === null) {
      throw new Error("expected the iframe to carry a document");
    }

    frameDocument.open();
    frameDocument.write(
      `<style>/* css-console: log color */\n.framed { color: rgb(4, 4, 4); }</style><p class="framed"></p>`,
    );

    expect(frameDocument.readyState).toBe("loading");

    const scanner = createScanner({ root: frameDocument });
    const pending = scanner.scan();
    let settled = false;

    void pending.then(() => {
      settled = true;
    });

    // One macrotask: the scan must still be waiting on readiness.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    frameDocument.close();

    const summary = await pending;

    expect(summary.records).toHaveLength(1);
    expect(frameDocument.readyState).toBe("complete");

    scanner.dispose();
  } finally {
    frame.remove();
  }
});

test("an already-aborted signal rejects before any event is delivered", async () => {
  const css = `/* css-console: log color */
.aborted-early { color: rgb(5, 5, 5); }`;

  await withFixture(`<p class="aborted-early"></p>`, css, async (host) => {
    const scanner = createScanner({ root: host });
    const events: BrowserScanEvent[] = [];

    scanner.subscribe((event) => events.push(event));

    const controller = new AbortController();

    controller.abort();

    await expect(scanner.scan({ signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(events).toEqual([]);

    scanner.dispose();
  });
});

test("aborting during a pending load rejects the scan and delivers no summary", async () => {
  const css = `/* css-console: log color */
.aborted-late { color: rgb(6, 6, 6); }`;

  await withFixture(
    `<link rel="stylesheet" href="/never-settles.css"><p class="aborted-late"></p>`,
    css,
    async (host) => {
      const controller = new AbortController();
      let sawRequest = () => {};
      const requested = new Promise<void>((resolve) => {
        sawRequest = resolve;
      });

      // A fetch that respects the abort signal and otherwise never settles,
      // so the scan is reliably in flight when the abort fires.
      const hanging: typeof globalThis.fetch = (_input, init) =>
        new Promise((_resolve, reject) => {
          sawRequest();
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });

      const scanner = createScanner({ root: host, fetch: hanging });
      const events: BrowserScanEvent[] = [];

      scanner.subscribe((event) => events.push(event));

      const pending = scanner.scan({ signal: controller.signal });

      await requested;
      controller.abort();

      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(kinds(events)).not.toContain("summary");

      scanner.dispose();
    },
  );
});

test("overlapping scans are serialized: the second starts after the first summary", async () => {
  const css = `/* css-console: log color */
.serialized { color: rgb(7, 7, 7); }`;

  await withFixture(`<p class="serialized"></p>`, css, async (host) => {
    const scanner = createScanner({ root: host });
    const events: BrowserScanEvent[] = [];

    scanner.subscribe((event) => events.push(event));

    const [first, second] = await Promise.all([scanner.scan(), scanner.scan()]);

    expect(first).not.toBe(second);

    const sequence = kinds(events);
    const firstSummary = sequence.indexOf("summary");
    const secondStart = sequence.indexOf("probe-start", 1);

    // Two complete event sequences, one after the other: the second scan's
    // first probe event comes after the first scan's summary, and there are
    // exactly two summaries.
    expect(sequence.filter((kind) => kind === "summary")).toHaveLength(2);
    expect(secondStart).toBeGreaterThan(firstSummary);

    scanner.dispose();
  });
});

test("dispose rejects later scans, stops event delivery, and is idempotent", async () => {
  const css = `/* css-console: log color */
.disposed { color: rgb(8, 8, 8); }`;

  await withFixture(`<p class="disposed"></p>`, css, async (host) => {
    const scanner = createScanner({ root: host });
    const events: BrowserScanEvent[] = [];

    scanner.subscribe((event) => events.push(event));
    await scanner.scan();

    const delivered = events.length;

    scanner.dispose();
    scanner.dispose();

    await expect(scanner.scan()).rejects.toThrow(/disposed/);
    expect(events).toHaveLength(delivered);
    expect(() => scanner.subscribe(() => {})).toThrow(/disposed/);
  });
});

test("a throwing subscriber breaks neither the scan nor the other subscribers", async () => {
  const css = `/* css-console: log color */
.isolated { color: rgb(1, 1, 1); }`;

  await withFixture(`<p class="isolated"></p>`, css, async (host) => {
    const scanner = createScanner({ root: host });
    const events: BrowserScanEvent[] = [];

    scanner.subscribe(() => {
      throw new Error("a subscriber defect");
    });
    scanner.subscribe((event) => events.push(event));

    const summary = await scanner.scan();

    expect(summary.records).toHaveLength(1);
    expect(kinds(events)).toContain("summary");

    scanner.dispose();
  });
});

test("the summary counts sources across every bucket and probes across every state", async () => {
  // One fixture exercises every source counter at once: a compiling inline
  // style, a print-media inline style the browser is not reading, a link the
  // caller excluded, a link that fails with a real 404, a raw source that
  // compiles, and an inline source whose CSS does not parse.
  const css = `/* css-console: log color */
.counted { color: rgb(1, 2, 3); }`;

  await withFixture(
    `<style media="print">/* css-console: log color */ .counted { color: rgb(9, 9, 9); }</style>
     <link rel="stylesheet" href="/excluded-by-pattern.css">
     <link rel="stylesheet" href="/scanner-missing-fixture.css">
     <style>.broken {</style>
     <p class="counted"></p>`,
    css,
    async (host) => {
      const scanner = createScanner({
        root: host,
        exclude: ["**/excluded-by-pattern.css"],
        rawSources: [
          {
            id: "raw-counted",
            css: `/* css-console: log margin-left */\n.counted { margin-left: 4px; }`,
          },
        ],
      });
      const summary = await scanner.scan();

      // Six candidates: three inline styles, two links, one raw input. The
      // print-media style is discovered and inactive, so it is in no other
      // bucket; the 404 link failed; the excluded link is excluded and never
      // fetched, which the exact diagnostic list below also proves; and the
      // broken style reported a parse failure, which counts as failed rather
      // than compiled because it produced no tree.
      expect(summary.sources).toEqual({ discovered: 6, compiled: 2, failed: 2, excluded: 1 });
      expect(summary.probes).toEqual({ compiled: 2, evaluated: 2, skipped: 0 });
      expect(summary.matches).toEqual({ total: 2, evaluated: 2, omitted: 0 });
      expect(summary.records).toHaveLength(2);

      const codes = summary.diagnostics.map((diagnostic) => diagnostic.code).sort();

      expect(codes).toEqual(["SOURCE_HTTP_ERROR", "SOURCE_PARSE_FAILED"]);

      scanner.dispose();
    },
  );
});

test("a value probe inside an inactive context is counted as skipped", async () => {
  const css = `@media (min-width: 100000px) {
  /* css-console: log color */
  .unreachable-probe { color: rgb(1, 1, 1); }
}

/* css-console: log color */
.reachable-probe { color: rgb(2, 2, 2); }`;

  await withFixture(
    `<p class="unreachable-probe"></p><p class="reachable-probe"></p>`,
    css,
    async (host) => {
      const scanner = createScanner({ root: host });
      const summary = await scanner.scan();

      expect(summary.probes).toEqual({ compiled: 2, evaluated: 1, skipped: 1 });
      expect(summary.records).toHaveLength(1);

      scanner.dispose();
    },
  );
});

test("construction validates maxElements, so a configuration error fails before any scan", () => {
  expect(() => createScanner({ maxElements: -1 })).toThrow(RangeError);
  expect(() => createScanner({ maxElements: 2.5 })).toThrow(TypeError);
});

test("duplicate identities among scanned sources are diagnosed in the summary", async () => {
  const css = `/* css-console: log color */
.duplicated { color: rgb(3, 3, 3); }`;

  await withFixture(`<p class="duplicated"></p>`, css, async (host) => {
    const scanner = createScanner({
      root: host,
      rawSources: [
        { id: "twin", css: ".a { color: red; }" },
        { id: "twin", css: ".b { color: blue; }" },
      ],
    });
    const summary = await scanner.scan();
    const duplicate = summary.diagnostics.find(
      (diagnostic) => diagnostic.code === "DUPLICATE_SOURCE_IDENTITY",
    );

    expect(duplicate?.details).toMatchObject({ identity: "twin", holders: 2 });

    scanner.dispose();
  });
});
