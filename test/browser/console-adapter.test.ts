import { expect, test } from "vite-plus/test";

import { createConsoleAdapter, createCSSConsole } from "@schalkneethling/css-console";
import type {
  BrowserScanEvent,
  BrowserScanSummary,
  ConsoleOutput,
  ValueProbeStart,
} from "@schalkneethling/css-console";

/**
 * The console adapter, exercised as a consumer would use it.
 *
 * CSSC-030 renders value probes: a consumer subscribes
 * `createConsoleAdapter()` to a css-console instance and reads the scan in the
 * browser console. Every import comes from the package root, because the
 * adapter joins the public surface the facade already published, and every
 * case drives the real pipeline, because what the adapter renders is whatever
 * the engine resolved rather than an event a test composed.
 *
 * Each case supplies its CSS twice: once as a style element inside the fixture
 * subtree, so the browser really applies it and `getComputedStyle()` has
 * something to resolve, and once as a raw source with `sources: "none"`, so
 * the scan compiles exactly that source and the recorded call list is the
 * probe's own. The recorded output is a plain object implementing
 * `ConsoleOutput`; nothing here patches, wraps, or replaces the global
 * console, which is the acceptance criterion the adapter is held to.
 *
 * Values pinned here were read from the engine, either through
 * `getComputedStyle()` inside the case or through an observed run against
 * headless Chromium 151.0.7922.34, the version this project's browser project
 * runs.
 */

/** One recorded call: the output method, and the arguments it received. */
type ConsoleCall = {
  method: keyof ConsoleOutput;
  args: readonly unknown[];
};

/** A recording output, paired with the list its methods append to. */
type Recording = {
  output: ConsoleOutput;
  calls: ConsoleCall[];
};

/**
 * An output object implementing `ConsoleOutput` whose methods record rather
 * than render. It is a fake output, not a mock of the adapter's internals:
 * the adapter under test calls it exactly as it would call a real console.
 */
function createRecordingOutput(): Recording {
  const calls: ConsoleCall[] = [];
  const record =
    (method: keyof ConsoleOutput) =>
    (...args: unknown[]): void => {
      calls.push({ method, args });
    };

  return {
    calls,
    output: {
      log: record("log"),
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
      groupCollapsed: record("groupCollapsed"),
      groupEnd: record("groupEnd"),
      table: record("table"),
      time: record("time"),
      timeEnd: record("timeEnd"),
    },
  };
}

/**
 * Appends a fixture subtree to the page, runs the body, and removes the
 * subtree however the body ends, following `test/browser/facade.test.ts`. The
 * style element travels inside the subtree, so the browser applies the CSS
 * the raw source describes and the resolved values are real.
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

/** What one scan produced: the recorded calls, the events, and the summary. */
type Run = {
  calls: ConsoleCall[];
  events: BrowserScanEvent[];
  starts: ValueProbeStart[];
  summary: BrowserScanSummary;
};

/**
 * Scans one raw source with the console adapter subscribed, and returns the
 * recorded calls beside the event stream a second subscriber saw. The event
 * stream is collected so that a case can derive the location the adapter was
 * given rather than restate it, which is what makes a title assertion catch
 * the adapter reading the wrong source location.
 */
async function runScan(
  id: string,
  css: string,
  options: { maxElements?: number } = {},
): Promise<Run> {
  const cssConsole = createCSSConsole({
    sources: "none",
    rawSources: [{ id, css }],
    ...(options.maxElements === undefined ? {} : { maxElements: options.maxElements }),
  });
  const recording = createRecordingOutput();
  const events: BrowserScanEvent[] = [];

  cssConsole.subscribe(createConsoleAdapter({ output: recording.output }));
  cssConsole.subscribe((event) => events.push(event));

  try {
    const summary = await cssConsole.scan();

    return { calls: recording.calls, events, starts: valueProbeStarts(events), summary };
  } finally {
    cssConsole.dispose();
  }
}

/** Every value probe-start of a scan, in the order the scan emitted them. */
function valueProbeStarts(events: readonly BrowserScanEvent[]): ValueProbeStart[] {
  const starts: ValueProbeStart[] = [];

  for (const event of events) {
    if (event.kind === "probe-start" && event.probe.probeKind === "value") {
      starts.push(event.probe);
    }
  }

  return starts;
}

/**
 * The group title one value probe-start dictates:
 * `css-console [label] selector — url:line:column`, with the bracketed label
 * present only when the annotation carried one.
 */
function expectedTitle(start: ValueProbeStart): string {
  const label = start.label === undefined ? "" : `[${start.label}] `;
  const location = `${start.source.url}:${start.source.start.line}:${start.source.start.column}`;

  return `css-console ${label}${start.selector} — ${location}`;
}

/** The title of the value probe whose selector is named, or a failure saying so. */
function titleFor(starts: readonly ValueProbeStart[], selector: string): string {
  const start = starts.find((candidate) => candidate.selector === selector);

  if (start === undefined) {
    throw new Error(`expected a value probe for ${selector}`);
  }

  return expectedTitle(start);
}

/**
 * The calls between the collapsed group carrying `title` and the group end
 * that closes it. CSSC-030 opens no nested groups, so the first group end
 * after the title is the matching one.
 */
function groupBody(calls: readonly ConsoleCall[], title: string): readonly ConsoleCall[] {
  const start = calls.findIndex(
    (call) => call.method === "groupCollapsed" && call.args[0] === title,
  );

  if (start === -1) {
    throw new Error(`expected a collapsed group titled ${title}`);
  }

  const end = calls.findIndex((call, position) => position > start && call.method === "groupEnd");

  if (end === -1) {
    throw new Error(`expected the group titled ${title} to be closed`);
  }

  return calls.slice(start + 1, end);
}

/**
 * The text of one rendered line: every string argument joined. A line carries
 * its information as text, so a case asserts against the text rather than
 * against one argument position, which the dictated formats leave open.
 */
function lineText(call: ConsoleCall): string {
  return call.args.filter((argument) => typeof argument === "string").join(" ");
}

/** The element named by a selector inside the fixture, or a failure saying so. */
function elementIn(host: HTMLElement, selector: string): Element {
  const element = host.querySelector(selector);

  if (element === null) {
    throw new Error(`expected the fixture element ${selector}`);
  }

  return element;
}

/** A value rounded to two decimals, as the matrix decomposition dictates. */
function roundToTwo(value: number): number {
  return Number(value.toFixed(2));
}

/**
 * The decomposition the adapter appends to a 2D matrix, computed from the
 * engine's own serialization rather than from a remembered value: the six
 * numbers are parsed out of `matrix(...)` and put through the dictated
 * formulas, so the expectation moves with whatever the engine resolved.
 */
function expectedDecomposition(resolved: string): string {
  const numbers = resolved
    .slice(resolved.indexOf("(") + 1, resolved.lastIndexOf(")"))
    .split(",")
    .map((part) => Number(part.trim()));
  const [a, b, c, d, tx, ty] = numbers as [number, number, number, number, number, number];
  const rotate = roundToTwo((Math.atan2(b, a) * 180) / Math.PI);
  const scaleX = Math.hypot(a, b);
  const scaleY = (a * d - b * c) / scaleX;

  return ` — translate(${roundToTwo(tx)}px, ${roundToTwo(ty)}px) scale(${roundToTwo(scaleX)}, ${roundToTwo(scaleY)}) rotate(${rotate}deg)`;
}

test("each log level renders its record line through the matching output method", async () => {
  const css = `/* css-console: log margin-left */
.console-level-log { margin-left: 1px; }

/* css-console: info margin-left */
.console-level-info { margin-left: 2px; }

/* css-console: warn margin-left */
.console-level-warn { margin-left: 3px; }

/* css-console: error margin-left */
.console-level-error { margin-left: 4px; }`;
  const markup = `<p class="console-level-log"></p><p class="console-level-info"></p>
<p class="console-level-warn"></p><p class="console-level-error"></p>`;

  await withFixture(markup, css, async () => {
    const run = await runScan("console-levels", css);

    for (const level of ["log", "info", "warn", "error"] as const) {
      const body = groupBody(run.calls, titleFor(run.starts, `.console-level-${level}`));

      // One property, one match, so the group holds exactly one line, and the
      // method it went through is the annotation's own log level.
      expect(body.map((call) => call.method)).toEqual([level]);
    }
  });
});

test("the group title carries the label, the selector, and the annotation's source location", async () => {
  const css = `/* css-console: log color label="branded" */
.console-titled { color: rgb(1, 2, 3); }`;

  await withFixture(`<p class="console-titled"></p>`, css, async () => {
    const run = await runScan("console-title", css);
    const [start] = run.starts;

    expect(start).toBeDefined();

    // The annotation comment opens the source, so the location the title
    // carries is line 1, column 1 of the raw source's own URL, and it is the
    // annotation's location rather than the annotated rule's.
    expect(expectedTitle(start as ValueProbeStart)).toBe(
      "css-console [branded] .console-titled — raw:console-title:1:1",
    );
    expect(
      run.calls.some(
        (call) =>
          call.method === "groupCollapsed" &&
          call.args[0] === "css-console [branded] .console-titled — raw:console-title:1:1",
      ),
    ).toBe(true);
  });
});

test("a single matched element renders as a group of per-property lines, never a table", async () => {
  const css = `/* css-console: log margin-left, padding-top */
.console-single { margin-left: 5px; padding-top: 6px; }`;

  await withFixture(`<p class="console-single"></p>`, css, async (host) => {
    const run = await runScan("console-single", css);
    const body = groupBody(run.calls, titleFor(run.starts, ".console-single"));
    const target = elementIn(host, ".console-single");

    // Two probed properties, one match: one line each, in the order the
    // annotation requested them, and no table anywhere in the scan.
    expect(body).toHaveLength(2);
    expect(run.calls.some((call) => call.method === "table")).toBe(false);
    expect(lineText(body[0] as ConsoleCall)).toContain("margin-left");
    expect(lineText(body[1] as ConsoleCall)).toContain("padding-top");

    // The live element travels as an argument, so the console offers the
    // element itself rather than a description of it.
    for (const call of body) {
      expect(call.args).toContain(target);
    }
  });
});

test("a line carries the authored value, the resolved value, and the contested marker", async () => {
  const css = `/* css-console: log color */
.console-contested { color: rgb(6, 6, 6); }
.console-contested { color: rgb(7, 7, 7); }`;

  await withFixture(`<p class="console-contested"></p>`, css, async () => {
    const run = await runScan("console-contested", css);
    const body = groupBody(run.calls, titleFor(run.starts, ".console-contested"));
    const text = lineText(body[0] as ConsoleCall);

    // The later declaration wins the cascade, so the authored value and the
    // resolved value differ and each has to appear on its own account.
    expect(body).toHaveLength(1);
    expect(text).toContain("rgb(6, 6, 6)");
    expect(text).toContain("rgb(7, 7, 7)");

    // The guard reports the value as contested, which the line marks; the
    // reasons themselves are CSSC-032 and are not rendered here.
    expect(text).toContain("(contested)");
  });
});

test("fifty matched elements render through one table call carrying the dictated columns", async () => {
  const css = `/* css-console: log margin-left */
.console-table { margin-left: 8px; }`;
  const markup = Array.from({ length: 50 }, () => `<p class="console-table"></p>`).join("");

  await withFixture(markup, css, async (host) => {
    const run = await runScan("console-table", css);
    const body = groupBody(run.calls, titleFor(run.starts, ".console-table"));
    const tables = body.filter((call) => call.method === "table");

    // Fifty matches is the default match limit, so every match is evaluated
    // and the group holds one table rather than fifty lines.
    expect(body).toHaveLength(1);
    expect(tables).toHaveLength(1);

    const rows = (tables[0] as ConsoleCall).args[0] as ReadonlyArray<Record<string, unknown>>;

    expect(rows).toHaveLength(50);
    expect(Object.keys(rows[0] as Record<string, unknown>)).toEqual([
      "element",
      "property",
      "authored",
      "resolved",
      "contested",
    ]);
    expect(rows[0]?.element).toBe(elementIn(host, ".console-table"));
    expect(rows[0]?.property).toBe("margin-left");
    expect(rows[0]?.authored).toBe("8px");
    expect(rows[0]?.resolved).toBe("8px");
    expect(rows[0]?.contested).toBe(false);
  });
});

test("a color-valued property renders a swatch whose plain text still carries the value", async () => {
  const css = `/* css-console: log color */
.console-swatch { color: rgb(9, 10, 11); }`;

  await withFixture(`<p class="console-swatch"></p>`, css, async (host) => {
    const run = await runScan("console-swatch", css);
    const body = groupBody(run.calls, titleFor(run.starts, ".console-swatch"));
    const line = body[0] as ConsoleCall;
    const resolved = getComputedStyle(elementIn(host, ".console-swatch")).color;

    // The engine's own serialization is the value the line has to carry.
    expect(resolved).toBe("rgb(9, 10, 11)");
    expect(CSS.supports("color", resolved)).toBe(true);

    const format = String(line.args[0]);

    // The swatch is a discrete styled run beside the text rather than a
    // styling of the whole line: the format opens with a styled run, closes
    // it with a second directive whose style argument is empty, and only then
    // carries the text, so the text itself stays readable.
    expect(format).toMatch(/^%c +%c /);
    expect(String(line.args[1])).toContain(`background: ${resolved}`);
    expect(line.args[2]).toBe("");

    // No information exists only in styling: with the styling directives
    // removed, the text still names the resolved value.
    expect(format.replaceAll("%c", "")).toContain(resolved);
  });
});

test("an omitted match renders the truncation line with its evaluated, total, and omitted counts", async () => {
  const css = `/* css-console: log margin-left */
.console-truncated { margin-left: 12px; }`;
  const markup = Array.from({ length: 3 }, () => `<p class="console-truncated"></p>`).join("");

  await withFixture(markup, css, async () => {
    const run = await runScan("console-truncated", css, { maxElements: 2 });
    const body = groupBody(run.calls, titleFor(run.starts, ".console-truncated"));

    expect(run.summary.matches).toEqual({ total: 3, evaluated: 2, omitted: 1 });
    expect(
      body.some(
        (call) =>
          call.method === "log" &&
          call.args[0] === "evaluated 2 of 3 matches, 1 omitted (maxElements)",
      ),
    ).toBe(true);
  });
});

test("time and timeEnd bracket each scan, and the completion line carries the summary", async () => {
  const css = `/* css-console: log margin-left */
.console-timed { margin-left: 13px; }`;

  await withFixture(`<p class="console-timed"></p>`, css, async () => {
    const cssConsole = createCSSConsole({
      sources: "none",
      rawSources: [{ id: "console-timed", css }],
    });
    const recording = createRecordingOutput();

    cssConsole.subscribe(createConsoleAdapter({ output: recording.output }));

    try {
      const first = await cssConsole.scan();
      const second = await cssConsole.scan();
      const timers = recording.calls.filter(
        (call) => call.method === "time" || call.method === "timeEnd",
      );

      // Each scan opens its own timer and closes the same label, and the
      // second scan on one instance counts on from the first.
      expect(timers.map((call) => [call.method, call.args[0]])).toEqual([
        ["time", "css-console scan 1"],
        ["timeEnd", "css-console scan 1"],
        ["time", "css-console scan 2"],
        ["timeEnd", "css-console scan 2"],
      ]);

      const completions = recording.calls.filter(
        (call) => call.method === "log" && call.args[0] === "css-console: scan complete",
      );

      expect(completions).toHaveLength(2);

      for (const [position, summary] of [first, second].entries()) {
        expect((completions[position] as ConsoleCall).args[1]).toEqual({
          sources: summary.sources,
          probes: summary.probes,
          matches: summary.matches,
          durationMs: summary.durationMs,
        });
      }
    } finally {
      cssConsole.dispose();
    }
  });
});

test("a transform resolving to a 2D matrix renders its decomposition beside the raw value", async () => {
  const css = `/* css-console: log transform */
.console-matrix { transform: translateX(88px); }

/* css-console: log transform */
.console-degenerate { transform: scale(0); }`;

  await withFixture(
    `<p class="console-matrix"></p><p class="console-degenerate"></p>`,
    css,
    async (host) => {
      const run = await runScan("console-matrix", css);
      const body = groupBody(run.calls, titleFor(run.starts, ".console-matrix"));
      const resolved = getComputedStyle(elementIn(host, ".console-matrix")).transform;

      // The engine resolves a transform to a matrix rather than to the function
      // the author wrote, which is why the decomposition exists at all.
      expect(resolved).toBe("matrix(1, 0, 0, 1, 88, 0)");

      const text = lineText(body[0] as ConsoleCall);
      const decomposition = expectedDecomposition(resolved);

      expect(decomposition).toBe(" — translate(88px, 0px) scale(1, 1) rotate(0deg)");
      expect(text).toContain(resolved);
      expect(text).toContain(decomposition);

      // The raw value stays authoritative by rendering first; the decomposition
      // is appended to it rather than substituted for it.
      expect(text.indexOf(resolved)).toBeLessThan(text.indexOf(decomposition));

      // A degenerate matrix has no finite decomposition: scale(0) collapses
      // both axes, the determinant is zero, and the formulas divide by zero,
      // so the line carries the engine's raw value and nothing appended.
      const degenerateResolved = getComputedStyle(elementIn(host, ".console-degenerate")).transform;
      const degenerateBody = groupBody(run.calls, titleFor(run.starts, ".console-degenerate"));
      const degenerateText = lineText(degenerateBody[0] as ConsoleCall);

      expect(degenerateText).toContain(degenerateResolved);
      expect(degenerateText).not.toContain(" — translate(");
    },
  );
});

test("an output whose every method throws does not prevent the scan from completing", async () => {
  const css = `/* css-console: log margin-left */
.console-throwing { margin-left: 14px; }`;
  const throwing = (): never => {
    throw new Error("the output refuses");
  };
  const output: ConsoleOutput = {
    log: throwing,
    info: throwing,
    warn: throwing,
    error: throwing,
    groupCollapsed: throwing,
    groupEnd: throwing,
    table: throwing,
    time: throwing,
    timeEnd: throwing,
  };

  await withFixture(`<p class="console-throwing"></p>`, css, async () => {
    const cssConsole = createCSSConsole({
      sources: "none",
      rawSources: [{ id: "console-throwing", css }],
    });

    cssConsole.subscribe(createConsoleAdapter({ output }));

    try {
      const summary = await cssConsole.scan();

      // Subscriber isolation is the scanner's guarantee, and the composed
      // behavior is what a consumer depends on: the summary is complete.
      expect(summary.records).toHaveLength(1);
      expect(summary.matches).toEqual({ total: 1, evaluated: 1, omitted: 0 });
    } finally {
      cssConsole.dispose();
    }
  });
});

test("the global console is never replaced, and none of its methods are patched", async () => {
  const css = `/* css-console: log margin-left */
.console-untouched { margin-left: 15px; }`;
  const before = globalThis.console;
  const methods = {
    log: before.log,
    info: before.info,
    warn: before.warn,
    error: before.error,
    groupCollapsed: before.groupCollapsed,
    groupEnd: before.groupEnd,
    table: before.table,
    time: before.time,
    timeEnd: before.timeEnd,
  };

  await withFixture(`<p class="console-untouched"></p>`, css, async () => {
    const cssConsole = createCSSConsole({
      sources: "none",
      rawSources: [{ id: "console-untouched", css }],
    });

    // No output is supplied, so the adapter renders through the real console:
    // the case is about what that does to the console object.
    cssConsole.subscribe(createConsoleAdapter());

    try {
      await cssConsole.scan();
    } finally {
      cssConsole.dispose();
    }
  });

  expect(globalThis.console).toBe(before);

  for (const [name, method] of Object.entries(methods)) {
    expect(globalThis.console[name as keyof typeof methods]).toBe(method);
  }
});

test("function probe events and diagnostics are ignored while the value probes still render", async () => {
  const css = `/* css-console: log margin-left */
.console-mixed { margin-left: 16px; }

/* css-console: log color */
@media (min-width: 1px) {
  .console-mixed { color: rgb(3, 4, 5); }
}

/* css-console: log */
@function --console-space(--n) {
  result: calc(var(--n) * 10px);
}

.console-mixed { padding: --console-space(4); }`;

  await withFixture(`<p class="console-mixed"></p>`, css, async () => {
    const run = await runScan("console-mixed", css);

    // The annotation before @media is not a target, so the scan reports a
    // diagnostic the adapter renders nothing for; CSSC-032 owns diagnostics.
    expect(run.summary.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["NOT_A_TARGET"]);

    // The function probe opens and closes on the stream, and its record is a
    // function record, so no group and no line belongs to it: CSSC-031 owns
    // function rendering.
    expect(
      run.events.some(
        (event) => event.kind === "probe-start" && event.probe.probeKind === "function",
      ),
    ).toBe(true);
    expect(run.calls.filter((call) => call.method === "groupCollapsed")).toHaveLength(1);

    const body = groupBody(run.calls, titleFor(run.starts, ".console-mixed"));

    expect(body).toHaveLength(1);
    expect(lineText(body[0] as ConsoleCall)).toContain("margin-left");
  });
});

test("a value probe whose condition is inactive renders an empty collapsed group", async () => {
  const css = `@media (min-width: 100000px) {
  /* css-console: log color */
  .console-inactive { color: rgb(9, 9, 9); }
}`;

  await withFixture(`<p class="console-inactive"></p>`, css, async () => {
    const run = await runScan("console-inactive", css);

    // A skipped probe keeps its boundaries, and the boundaries alone are the
    // signal: the group opens and closes with nothing between it.
    expect(run.summary.probes.skipped).toBe(1);
    expect(groupBody(run.calls, titleFor(run.starts, ".console-inactive"))).toEqual([]);
  });
});
