import { expect, test } from "vite-plus/test";

import { createConsoleAdapter, createCSSConsole } from "@schalkneethling/css-console";
import type {
  BrowserFunctionRecord,
  BrowserScanEvent,
  BrowserScanSummary,
  CallSite,
  ConsoleOutput,
  FunctionProbeStart,
  ValueProbeStart,
} from "@schalkneethling/css-console";

/**
 * The console adapter, exercised as a consumer would use it.
 *
 * CSSC-030 renders value probes and CSSC-031 renders function probes: a
 * consumer subscribes `createConsoleAdapter()` to a css-console instance and
 * reads the scan in the browser console. Every import comes from the package
 * root, because the adapter joins the public surface the facade already
 * published, and every case drives the real pipeline, because what the adapter
 * renders is whatever the engine resolved rather than an event a test
 * composed.
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
  functionStarts: FunctionProbeStart[];
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

    return {
      calls: recording.calls,
      events,
      starts: valueProbeStarts(events),
      functionStarts: functionProbeStarts(events),
      summary,
    };
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

/** Every function probe-start of a scan, in the order the scan emitted them. */
function functionProbeStarts(events: readonly BrowserScanEvent[]): FunctionProbeStart[] {
  const starts: FunctionProbeStart[] = [];

  for (const event of events) {
    if (event.kind === "probe-start" && event.probe.probeKind === "function") {
      starts.push(event.probe);
    }
  }

  return starts;
}

/** Every function record of a scan, in the order the scan emitted them. */
function functionRecords(events: readonly BrowserScanEvent[]): BrowserFunctionRecord[] {
  const collected: BrowserFunctionRecord[] = [];

  for (const event of events) {
    if (event.kind === "record" && event.record.kind === "function") {
      collected.push(event.record);
    }
  }

  return collected;
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
 * The group title one function probe-start dictates:
 * `css-console [label] functionName — url:line:column`, which is the value
 * probe pattern with the function name standing where the selector stands.
 */
function expectedFunctionTitle(start: FunctionProbeStart): string {
  const label = start.label === undefined ? "" : `[${start.label}] `;
  const location = `${start.source.url}:${start.source.start.line}:${start.source.start.column}`;

  return `css-console ${label}${start.functionName} — ${location}`;
}

/** The title of the function probe named, or a failure saying so. */
function functionTitleFor(starts: readonly FunctionProbeStart[], functionName: string): string {
  const start = starts.find((candidate) => candidate.functionName === functionName);

  if (start === undefined) {
    throw new Error(`expected a function probe for ${functionName}`);
  }

  return expectedFunctionTitle(start);
}

/**
 * The title one call-site group dictates: the destination property, the
 * arguments as authored, the selector, and the call site's own location, with
 * the surrounding-contributions marker appended for a call that is not the
 * whole declaration value.
 */
function expectedCallSiteTitle(callSite: CallSite): string {
  const location = `${callSite.source.url}:${callSite.source.start.line}:${callSite.source.start.column}`;
  const marker = callSite.soleContribution
    ? ""
    : " (includes surrounding expression contributions)";

  return `${callSite.property} with (${callSite.arguments.join(", ")}) — ${callSite.selector} — ${location}${marker}`;
}

/**
 * The line one definition reference dictates. The parameter is typed through
 * the probe-start rather than through an imported type name, so that the line
 * format stays tied to whatever shape the contract publishes.
 */
function expectedReferenceLine(
  reference: FunctionProbeStart["definitionReferences"][number],
): string {
  const location = `${reference.source.url}:${reference.source.start.line}:${reference.source.start.column}`;

  return `referenced inside ${reference.functionName} — ${reference.property} with (${reference.arguments.join(", ")}) — ${location}`;
}

/**
 * The defined-at line one function probe-start dictates, derived from the
 * definition location the event carried rather than restated, so that an
 * adapter reading the annotation's location instead of the `@function` rule's
 * fails the assertion.
 */
function expectedDefinedAt(start: FunctionProbeStart): string {
  return `defined at ${start.definition.url}:${start.definition.start.line}:${start.definition.start.column}`;
}

/**
 * The calls between the collapsed group carrying `title` and the group end
 * that closes it. A function probe nests a group per call site inside its own
 * group, so the matching end is found by counting: every nested
 * `groupCollapsed` deepens the search, and every `groupEnd` closes the
 * innermost open group, which makes the body of an outer group include the
 * whole of every group nested in it.
 */
function groupBody(calls: readonly ConsoleCall[], title: string): readonly ConsoleCall[] {
  const start = calls.findIndex(
    (call) => call.method === "groupCollapsed" && call.args[0] === title,
  );

  if (start === -1) {
    throw new Error(`expected a collapsed group titled ${title}`);
  }

  let depth = 1;

  for (const [position, call] of calls.entries()) {
    if (position <= start) {
      continue;
    }

    if (call.method === "groupCollapsed") {
      depth += 1;
    } else if (call.method === "groupEnd") {
      depth -= 1;

      if (depth === 0) {
        return calls.slice(start + 1, position);
      }
    }
  }

  throw new Error(`expected the group titled ${title} to be closed`);
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

test("diagnostics render nothing while value and function probes render side by side", async () => {
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
    // diagnostic the adapter renders nothing for; CSSC-032 owns diagnostics,
    // and nothing in the recorded output names the code.
    expect(run.summary.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["NOT_A_TARGET"]);
    expect(run.calls.some((call) => lineText(call).includes("NOT_A_TARGET"))).toBe(false);
    expect(run.calls.some((call) => call.method === "warn" || call.method === "error")).toBe(false);

    // Both probe kinds render their own group, and the function probe nests a
    // group for its one call site, so the scan opens three groups in total.
    const valueBody = groupBody(run.calls, titleFor(run.starts, ".console-mixed"));
    const functionBody = groupBody(
      run.calls,
      functionTitleFor(run.functionStarts, "--console-space"),
    );

    expect(run.calls.filter((call) => call.method === "groupCollapsed")).toHaveLength(3);
    expect(valueBody).toHaveLength(1);
    expect(lineText(valueBody[0] as ConsoleCall)).toContain("margin-left");

    const [start] = run.functionStarts;

    expect(start).toBeDefined();
    expect(lineText(functionBody[0] as ConsoleCall)).toBe(
      expectedDefinedAt(start as FunctionProbeStart),
    );
    expect(functionBody.filter((call) => call.method === "groupCollapsed")).toHaveLength(1);
    expect(functionBody.filter((call) => call.method === "table")).toHaveLength(1);
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

test("a function group is titled with the function name and opens with the defined-at line", async () => {
  const css = `/* css-console: log */
@function --console-titled-fn(--n) {
  result: calc(var(--n) * 10px);
}

.console-fn-title { padding: --console-titled-fn(4); }`;

  await withFixture(`<p class="console-fn-title"></p>`, css, async () => {
    const run = await runScan("console-fn-title", css);
    const [start] = run.functionStarts;

    expect(start).toBeDefined();

    const probeStart = start as FunctionProbeStart;

    // The title is the value probe pattern with the function name standing
    // where the selector stands, and the name carries its dashes exactly as
    // the engine reports it.
    expect(probeStart.functionName).toBe("--console-titled-fn");
    expect(expectedFunctionTitle(probeStart)).toBe(
      "css-console --console-titled-fn — raw:console-fn-title:1:1",
    );
    expect(
      run.calls.some(
        (call) =>
          call.method === "groupCollapsed" &&
          call.args[0] === "css-console --console-titled-fn — raw:console-fn-title:1:1",
      ),
    ).toBe(true);

    // The annotation opens the source and the `@function` rule begins on the
    // line after it, so the defined-at line names a location the title does
    // not, which is what makes the two distinguishable at all.
    expect(probeStart.definition.start).toEqual({ line: 2, column: 1 });

    const body = groupBody(run.calls, expectedFunctionTitle(probeStart));

    expect(body[0]?.method).toBe("log");
    expect(lineText(body[0] as ConsoleCall)).toBe(expectedDefinedAt(probeStart));
    expect(lineText(body[0] as ConsoleCall)).toBe("defined at raw:console-fn-title:2:1");
  });
});

test("one call site matched by two elements renders one table of resolved property values", async () => {
  const css = `/* css-console: log */
@function --console-density(--n) {
  result: calc(var(--n) * 10px);
}

.console-fn-density { padding-top: --console-density(var(--density)); }`;
  const markup = `<p class="console-fn-density" id="console-fn-loose" style="--density: 2"></p>
<p class="console-fn-density" id="console-fn-tight" style="--density: 5"></p>`;

  await withFixture(markup, css, async (host) => {
    const run = await runScan("console-fn-density", css);
    const body = groupBody(run.calls, functionTitleFor(run.functionStarts, "--console-density"));
    const tables = body.filter((call) => call.method === "table");

    // One call site, so one sibling group holding exactly one table, however
    // many elements the call site matched.
    expect(body.filter((call) => call.method === "groupCollapsed")).toHaveLength(1);
    expect(tables).toHaveLength(1);

    const rows = (tables[0] as ConsoleCall).args[0] as ReadonlyArray<Record<string, unknown>>;
    const loose = elementIn(host, "#console-fn-loose");
    const tight = elementIn(host, "#console-fn-tight");

    // The middle column is literally named `resolved property value`, because
    // the value a function record carries is the destination property's
    // resolved value rather than the function's return value.
    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0] as Record<string, unknown>)).toEqual([
      "element",
      "resolved property value",
      "contested",
    ]);
    expect(rows.map((row) => row.element)).toEqual([loose, tight]);
    expect(rows.map((row) => row.contested)).toEqual([false, false]);

    // The two elements differ only in the custom property the argument reads,
    // so the engine resolved two different values and the table has to show
    // both rather than one value standing for the call site.
    const looseResolved = getComputedStyle(loose).paddingTop;
    const tightResolved = getComputedStyle(tight).paddingTop;

    expect(looseResolved).toBe("20px");
    expect(tightResolved).toBe("50px");
    expect(rows[0]?.["resolved property value"]).toBe(looseResolved);
    expect(rows[1]?.["resolved property value"]).toBe(tightResolved);
    expect(rows[0]?.["resolved property value"]).not.toBe(rows[1]?.["resolved property value"]);
  });
});

test("a call-site title names the call, and marks a call the surrounding expression contributes to", async () => {
  const css = `/* css-console: log */
@function --console-marked(--n) {
  result: calc(var(--n) * 10px);
}

.console-fn-sole { padding-top: --console-marked(4); }

.console-fn-wrapped { margin-left: calc(--console-marked(2) + 5px); }`;
  const markup = `<p class="console-fn-sole"></p><p class="console-fn-wrapped"></p>`;

  await withFixture(markup, css, async () => {
    const run = await runScan("console-fn-marked", css);
    const [soleRecord, wrappedRecord] = functionRecords(run.events);

    expect(soleRecord?.callSite.soleContribution).toBe(true);
    expect(wrappedRecord?.callSite.soleContribution).toBe(false);

    const body = groupBody(run.calls, functionTitleFor(run.functionStarts, "--console-marked"));
    const titles = body
      .filter((call) => call.method === "groupCollapsed")
      .map((call) => String(call.args[0]));

    expect(titles).toEqual([
      expectedCallSiteTitle((soleRecord as BrowserFunctionRecord).callSite),
      expectedCallSiteTitle((wrappedRecord as BrowserFunctionRecord).callSite),
    ]);

    const [soleTitle, wrappedTitle] = titles as [string, string];

    // The title carries the destination property, the arguments as authored,
    // the selector of the rule the call sits in, and the call site's own
    // location.
    expect(soleTitle).toContain("padding-top with (4)");
    expect(soleTitle).toContain(".console-fn-sole");
    expect(soleTitle).toContain("raw:console-fn-marked:6:");

    // A call that is the whole declaration value carries no marker, and a
    // call inside `calc()` carries one, because the resolved value the row
    // reports includes whatever the surrounding expression contributed.
    expect(soleTitle).not.toContain("includes surrounding expression contributions");
    expect(wrappedTitle).toContain("margin-left with (2)");
    expect(wrappedTitle).toContain(" (includes surrounding expression contributions)");
  });
});

test("two call sites render as sibling collapsed groups inside one function group", async () => {
  const css = `/* css-console: log */
@function --console-siblings(--n) {
  result: calc(var(--n) * 10px);
}

.console-fn-first { padding-top: --console-siblings(1); }

.console-fn-second { margin-top: --console-siblings(2); }`;
  const markup = `<p class="console-fn-first"></p><p class="console-fn-second"></p>`;

  await withFixture(markup, css, async () => {
    const run = await runScan("console-fn-siblings", css);
    const body = groupBody(run.calls, functionTitleFor(run.functionStarts, "--console-siblings"));
    const [first, second] = functionRecords(run.events);

    // The call-site groups are siblings rather than nested: each opens, holds
    // its one table, and closes before the next opens.
    expect(body.map((call) => call.method)).toEqual([
      "log",
      "groupCollapsed",
      "table",
      "groupEnd",
      "groupCollapsed",
      "table",
      "groupEnd",
    ]);

    // They appear in the order the records first named them, which is the
    // order the call sites resolved in.
    expect([body[1]?.args[0], body[4]?.args[0]]).toEqual([
      expectedCallSiteTitle((first as BrowserFunctionRecord).callSite),
      expectedCallSiteTitle((second as BrowserFunctionRecord).callSite),
    ]);
    expect(first?.callSite.property).toBe("padding-top");
    expect(second?.callSite.property).toBe("margin-top");
  });
});

test("a function with no call sites renders the informational line and lists its references", async () => {
  const css = `/* css-console: log */
@function --console-orphan(--n) {
  result: calc(var(--n) * 3px);
}

@function --console-orphan-wrapper(--n) {
  result: --console-orphan(calc(var(--n) * 2));
}`;

  await withFixture(`<p class="console-fn-unrelated"></p>`, css, async () => {
    const run = await runScan("console-fn-orphan", css);
    const [start] = run.functionStarts;

    expect(start).toBeDefined();

    const probeStart = start as FunctionProbeStart;

    expect(probeStart.callSiteCount).toBe(0);

    const body = groupBody(run.calls, expectedFunctionTitle(probeStart));

    // The defined-at line always renders first, the informational line goes
    // through `info` whatever the annotation's own log level is, and the
    // references follow it through the probe's log level.
    expect(body.map((call) => call.method)).toEqual(["log", "info", "log"]);
    expect(lineText(body[0] as ConsoleCall)).toBe(expectedDefinedAt(probeStart));
    expect((body[1] as ConsoleCall).args[0]).toBe("no call sites in the scanned sources");

    const [reference] = probeStart.definitionReferences;

    expect(reference?.functionName).toBe("--console-orphan-wrapper");
    expect(reference?.property).toBe("result");
    expect(reference?.arguments).toEqual(["calc(var(--n) * 2)"]);
    expect(lineText(body[2] as ConsoleCall)).toBe(
      expectedReferenceLine(reference as FunctionProbeStart["definitionReferences"][number]),
    );
    expect(lineText(body[2] as ConsoleCall)).toBe(
      "referenced inside --console-orphan-wrapper — result with (calc(var(--n) * 2)) — raw:console-fn-orphan:7:3",
    );

    // A reference is not a call site: nothing matched, so no call-site group
    // and no table exist to hold a resolved value that does not exist either.
    expect(body.some((call) => call.method === "groupCollapsed")).toBe(false);
    expect(run.calls.some((call) => call.method === "table")).toBe(false);
  });
});

test("a function whose every call site is inactive renders the defined-at line and nothing else", async () => {
  const css = `/* css-console: log */
@function --console-hidden(--n) {
  result: calc(var(--n) * 10px);
}

@media (width < 1px) {
  .console-fn-hidden { padding-top: --console-hidden(6); }
}`;

  await withFixture(`<p class="console-fn-hidden"></p>`, css, async () => {
    const run = await runScan("console-fn-hidden", css);
    const [start] = run.functionStarts;

    expect(start).toBeDefined();

    const probeStart = start as FunctionProbeStart;

    // A call site compiled, so this is not the no-call-sites case: the count
    // is what separates a function nothing calls from a function whose calls
    // all sit in an inactive condition.
    expect(probeStart.callSiteCount).toBe(1);
    expect(functionRecords(run.events)).toHaveLength(0);

    const body = groupBody(run.calls, expectedFunctionTitle(probeStart));

    expect(body.map((call) => call.method)).toEqual(["log"]);
    expect(lineText(body[0] as ConsoleCall)).toBe(expectedDefinedAt(probeStart));
    expect(run.calls.some((call) => call.method === "table")).toBe(false);
  });
});

test("a function probe over its match budget renders the truncation line with the summary counts", async () => {
  const css = `/* css-console: log */
@function --console-budget(--n) {
  result: calc(var(--n) * 1px);
}

.console-fn-budget-first { padding-top: --console-budget(1); }

.console-fn-budget-second { margin-top: --console-budget(2); }`;
  const markup = `${Array.from({ length: 3 }, () => `<p class="console-fn-budget-first"></p>`).join("")}${Array.from(
    { length: 3 },
    () => `<p class="console-fn-budget-second"></p>`,
  ).join("")}`;

  await withFixture(markup, css, async () => {
    const run = await runScan("console-fn-budget", css, { maxElements: 4 });
    const body = groupBody(run.calls, functionTitleFor(run.functionStarts, "--console-budget"));

    // The budget is spent across the call sites in resolution order, so the
    // first call site takes three of the four and the second takes one, and
    // the counts the truncation line reports are the probe's own totals.
    expect(run.summary.matches).toEqual({ total: 6, evaluated: 4, omitted: 2 });

    const tables = body.filter((call) => call.method === "table");

    expect(tables).toHaveLength(2);
    expect(
      tables.map((call) => (call.args[0] as ReadonlyArray<Record<string, unknown>>).length),
    ).toEqual([3, 1]);

    // The truncation line closes the body, after every call-site group.
    expect(body.at(-1)?.method).toBe("log");
    expect(body.at(-1)?.args[0]).toBe("evaluated 4 of 6 matches, 2 omitted (maxElements)");
  });
});
