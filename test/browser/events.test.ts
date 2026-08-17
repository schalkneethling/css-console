import { expect, test } from "vite-plus/test";

import { compileSource } from "../../src/core/compiler/index.ts";
import { evaluateSource } from "../../src/browser/records/index.ts";
import type { BrowserScanEvent } from "../../src/browser/records/index.ts";

/**
 * Normalized browser events, checked against the live engine.
 *
 * CSSC-023 is the checkpoint where the record contract stabilizes, so this
 * suite pins the whole observable surface of `evaluateSource()`: the event
 * ordering around probe boundaries, live element identity, deterministic
 * identifiers, timestamps, requested property order, the published record
 * shapes, and the read-only guarantee. Every case runs the real pipeline,
 * `compileSource()` into `evaluateSource()` against a fixture subtree,
 * because the events are the composition of every Phase 2 module and only
 * the composed result can prove they compose coherently.
 *
 * The engine facts relied on were read in the browser lane against headless
 * Chromium 151.0.7922.34, the version this project's Vitest browser project
 * runs: `performance.now()` reports non-decreasing values across consecutive
 * calls, which the monotonic timestamp case pins empirically, and
 * `CSSFunctionRule` exists, so the function probe cases evaluate rather than
 * skip.
 */

/** A fixture URL that can never resolve, matching the other browser suites. */
const FIXTURE_URL = "https://fixtures.css-console.invalid/events.css";

/**
 * Appends a fixture subtree and its stylesheet to the document, runs the
 * body against them, and removes both however the body ends. The wrapper
 * element carries no class of its own, so it can never satisfy a selector
 * under test.
 */
function withFixture<T>(markup: string, css: string, body: (host: HTMLElement) => T): T {
  const host = document.createElement("div");
  const style = document.createElement("style");

  style.textContent = css;
  host.innerHTML = markup;
  document.head.append(style);
  document.body.append(host);

  try {
    return body(host);
  } finally {
    host.remove();
    style.remove();
  }
}

/** Compiles a source and evaluates it inside the fixture subtree. */
function eventsOf(
  host: HTMLElement,
  css: string,
  options: { clock?: () => number; maxElements?: number } = {},
): readonly BrowserScanEvent[] {
  const compiled = compileSource(css, { url: FIXTURE_URL });

  return evaluateSource(compiled, { root: host, ...options });
}

/** The kind of every event, in emitted order. */
function kinds(events: readonly BrowserScanEvent[]): string[] {
  return events.map((event) => event.kind);
}

/** Narrows the events to their records, in emitted order. */
function records(events: readonly BrowserScanEvent[]) {
  return events.flatMap((event) => (event.kind === "record" ? [event.record] : []));
}

/** Narrows the events to their probe summaries, in emitted order. */
function summaries(events: readonly BrowserScanEvent[]) {
  return events.flatMap((event) => (event.kind === "probe-summary" ? [event.summary] : []));
}

/** Narrows the events to their probe starts, in emitted order. */
function starts(events: readonly BrowserScanEvent[]) {
  return events.flatMap((event) => (event.kind === "probe-start" ? [event.probe] : []));
}

test("a value probe emits probe-start, its records, and probe-summary in order", () => {
  const css = `/* css-console: log color */
.solo { color: rgb(1, 2, 3); }`;

  withFixture(`<p class="solo"></p>`, css, (host) => {
    const events = eventsOf(host, css);

    expect(kinds(events)).toEqual(["probe-start", "record", "probe-summary"]);

    const [start] = starts(events);
    const [record] = records(events);
    const [summary] = summaries(events);

    expect(start?.probeKind).toBe("value");
    expect(start?.probeKind === "value" ? start.selector : undefined).toBe(".solo");
    expect(start?.logLevel).toBe("log");
    expect(start?.probeId).toBe(record?.probeId);
    expect(summary?.probeId).toBe(start?.probeId);
    expect(summary?.records).toBe(1);
    expect(summary?.diagnostics).toBe(0);
    expect(summary?.matches).toEqual({ total: 1, evaluated: 1, omitted: 0 });

    expect(record?.kind).toBe("value");

    if (record?.kind === "value") {
      expect(record.values.map((value) => value.name)).toEqual(["color"]);
      expect(record.values[0]?.resolved).toBe("rgb(1, 2, 3)");
      expect(record.values[0]?.guard).toEqual({ contested: false, reasons: [] });
    }
  });
});

test("compilation diagnostics precede every probe event", () => {
  const css = `/* css-console: log color,ghost */
.card { color: rgb(4, 5, 6); }`;

  withFixture(`<p class="card"></p>`, css, (host) => {
    const events = eventsOf(host, css);

    expect(kinds(events)).toEqual(["diagnostic", "probe-start", "record", "probe-summary"]);

    const [first] = events;

    expect(first?.kind === "diagnostic" ? first.diagnostic.code : undefined).toBe(
      "MISSING_REQUESTED_PROPERTY",
    );
  });
});

test("a branch the engine rejects is published with the probe's rule-level source", () => {
  // The compiler accepts the branch and the live selector engine refuses it,
  // so the diagnostic is born in the browser. It still names the rule it came
  // from, so two rules carrying the same rejected branch text stay apart when
  // diagnostics are deduplicated by location.
  const css = `/* css-console: log color */
.solo, .broken:not-a-real-pseudo-class { color: rgb(1, 2, 3); }`;

  withFixture(`<p class="solo"></p>`, css, (host) => {
    const compiled = compileSource(css, { url: FIXTURE_URL });
    const events = evaluateSource(compiled, { root: host });
    const diagnostic = events.find((event) => event.kind === "diagnostic");
    const probe = compiled.probes[0];

    expect(diagnostic?.kind === "diagnostic" ? diagnostic.diagnostic.code : undefined).toBe(
      "UNPARSEABLE_SELECTOR_BRANCH",
    );
    expect(diagnostic?.kind === "diagnostic" ? diagnostic.diagnostic.source : undefined).toEqual(
      probe?.kind === "value" ? probe.source : undefined,
    );
  });
});

test("a record's target is the matched element itself", () => {
  const css = `/* css-console: log color */
.solo { color: rgb(1, 2, 3); }`;

  withFixture(`<p class="solo"></p>`, css, (host) => {
    const [record] = records(eventsOf(host, css));
    const element = host.querySelector(".solo");

    expect(element).not.toBeNull();
    expect(record?.target).toBe(element);
  });
});

test("identifiers and event order are deterministic across compilations", () => {
  const css = `/* css-console: log color */
.solo { color: rgb(1, 2, 3); }

/* css-console: log */
@function --pad(--n) { result: calc(var(--n) * 1px); }

.spaced { padding: --pad(2); }`;

  withFixture(`<p class="solo"></p><p class="spaced"></p>`, css, (host) => {
    const first = eventsOf(host, css);
    const second = eventsOf(host, css);

    expect(kinds(second)).toEqual(kinds(first));
    expect(records(second).map((record) => record.probeId)).toEqual(
      records(first).map((record) => record.probeId),
    );
    expect(starts(second).map((start) => start.probeId)).toEqual(
      starts(first).map((start) => start.probeId),
    );
  });
});

test("timestamps do not decrease across a scan", () => {
  const css = `/* css-console: log color */
.many { color: rgb(7, 8, 9); }`;

  withFixture(`<p class="many"></p><p class="many"></p><p class="many"></p>`, css, (host) => {
    const stamped = records(eventsOf(host, css)).map((record) => record.timestamp);

    expect(stamped).toHaveLength(3);

    for (const [position, timestamp] of stamped.entries()) {
      expect(typeof timestamp).toBe("number");

      if (position > 0) {
        expect(timestamp).toBeGreaterThanOrEqual(stamped[position - 1] ?? Number.NaN);
      }
    }
  });
});

test("an injected clock makes timestamps deterministic", () => {
  const css = `/* css-console: log color */
.many { color: rgb(7, 8, 9); }`;

  withFixture(`<p class="many"></p><p class="many"></p>`, css, (host) => {
    let tick = 0;
    const events = eventsOf(host, css, { clock: () => (tick += 1) });

    expect(records(events).map((record) => record.timestamp)).toEqual([1, 2]);
  });
});

test("values preserve requested order rather than source order", () => {
  const css = `/* css-console: log width,color */
.ordered { color: rgb(9, 9, 9); width: 40px; }`;

  withFixture(`<p class="ordered"></p>`, css, (host) => {
    const [record] = records(eventsOf(host, css));

    expect(record?.kind).toBe("value");

    if (record?.kind === "value") {
      expect(record.values.map((value) => value.name)).toEqual(["width", "color"]);
    }
  });
});

test("label appears on records and starts only when the annotation carries one", () => {
  const labeled = `/* css-console: log color label="branded" */
.tagged { color: rgb(1, 1, 1); }`;
  const unlabeled = `/* css-console: log color */
.plain { color: rgb(2, 2, 2); }`;

  withFixture(`<p class="tagged"></p><p class="plain"></p>`, `${labeled}\n${unlabeled}`, (host) => {
    const events = eventsOf(host, `${labeled}\n${unlabeled}`);
    const [taggedStart, plainStart] = starts(events);
    const [taggedRecord, plainRecord] = records(events);

    expect(taggedStart?.label).toBe("branded");
    expect(taggedRecord?.label).toBe("branded");

    // The absent label is an absent key rather than a key holding undefined,
    // so serialization and key enumeration never surface a field the
    // annotation did not carry.
    expect(Object.keys(plainStart ?? {})).not.toContain("label");
    expect(Object.keys(plainRecord ?? {})).not.toContain("label");
  });
});

test("maxElements bounds a function probe's records across its call sites", () => {
  // The limit is a probe-level budget rather than a per-call-site allowance:
  // a function called from many declarations would otherwise emit up to
  // call sites times maxElements records, unbounded work under an option
  // whose name promises a probe-wide ceiling. Each call site still reports
  // its own totals, so the truncation stays visible per call site and the
  // summary sums them.
  const css = `/* css-console: log */
@function --pad(--n) { result: calc(var(--n) * 1px); }

.first { padding-top: --pad(1); }

.second { margin-top: --pad(2); }`;

  withFixture(
    `<p class="first"></p><p class="first"></p><p class="first"></p>
     <p class="second"></p><p class="second"></p><p class="second"></p>`,
    css,
    (host) => {
      const events = eventsOf(host, css, { maxElements: 4 });
      const emitted = records(events);
      const bySite = emitted.map((record) =>
        record.kind === "function" ? record.callSite.property : record.kind,
      );

      expect(bySite).toEqual(["padding-top", "padding-top", "padding-top", "margin-top"]);

      const [summary] = summaries(events);

      expect(summary?.records).toBe(4);
      expect(summary?.matches).toEqual({ total: 6, evaluated: 4, omitted: 2 });
    },
  );
});

test("each inactive probe's summary carries its own match counts", () => {
  // The published summary shape is mutable, so two summaries sharing one
  // counts object would let a consumer's write to one silently change the
  // other, in this scan and every later one.
  const css = `@media (min-width: 100000px) {
  /* css-console: log color */
  .first-inactive { color: rgb(1, 1, 1); }

  /* css-console: log color */
  .second-inactive { color: rgb(2, 2, 2); }
}`;

  withFixture(`<p class="first-inactive"></p><p class="second-inactive"></p>`, css, (host) => {
    const [first, second] = summaries(eventsOf(host, css));

    expect(first?.matches).toEqual({ total: 0, evaluated: 0, omitted: 0 });
    expect(second?.matches).toEqual({ total: 0, evaluated: 0, omitted: 0 });
    expect(first?.matches).not.toBe(second?.matches);
  });
});

test("one annotation with a pseudo-element branch opens one probe group", () => {
  const css = `/* css-console: log color */
.duo::before, .duo { color: rgb(3, 3, 3); content: "x"; }`;

  withFixture(`<p class="duo"></p>`, css, (host) => {
    const events = eventsOf(host, css);

    expect(kinds(events)).toEqual(["probe-start", "record", "record", "probe-summary"]);

    const probeRecords = records(events);
    const [start] = starts(events);

    // Two branches publish two record identities under one probe-level
    // identity: the identifier of the probe's first branch.
    expect(probeRecords.map((record) => record.pseudo)).toEqual(["::before", null]);
    expect(new Set(probeRecords.map((record) => record.probeId)).size).toBe(2);
    expect(start?.probeId).toBe(probeRecords[0]?.probeId);
  });
});

test("the published call-site record carries exactly the contract fields", () => {
  const css = `/* css-console: log */
@function --pad(--n) { result: calc(var(--n) * 1px); }

.spaced { padding: --pad(2); }`;

  withFixture(`<p class="spaced"></p>`, css, (host) => {
    const [record] = records(eventsOf(host, css));

    expect(record?.kind).toBe("function");

    if (record?.kind === "function") {
      expect(Object.keys(record.callSite).sort()).toEqual([
        "arguments",
        "property",
        "selector",
        "soleContribution",
        "source",
      ]);
      expect(record.callSite.property).toBe("padding");
      expect(record.callSite.arguments).toEqual(["2"]);
      expect(record.callSite.soleContribution).toBe(true);
      expect(record.pseudo).toBeNull();
      expect(record.resolved).toBe("2px");

      // Nothing else declares padding, and the call site's own declaration
      // must not compete with itself through the guard index.
      expect(record.guard).toEqual({ contested: false, reasons: [] });
    }
  });
});

test("an inactive probe still emits its boundaries with zero records", () => {
  const css = `@media (min-width: 100000px) {
  /* css-console: log color */
  .hidden { color: rgb(5, 5, 5); }
}`;

  withFixture(`<p class="hidden"></p>`, css, (host) => {
    const events = eventsOf(host, css);

    expect(kinds(events)).toEqual(["probe-start", "probe-summary"]);

    const [summary] = summaries(events);

    expect(summary?.records).toBe(0);
    expect(summary?.diagnostics).toBe(0);
    expect(summary?.matches).toEqual({ total: 0, evaluated: 0, omitted: 0 });
  });
});

test("match limits keep totals in the probe summary", () => {
  const css = `/* css-console: log color */
.many { color: rgb(7, 8, 9); }`;

  withFixture(`<p class="many"></p><p class="many"></p><p class="many"></p>`, css, (host) => {
    const events = eventsOf(host, css, { maxElements: 1 });

    expect(records(events)).toHaveLength(1);
    expect(summaries(events)[0]?.matches).toEqual({ total: 3, evaluated: 1, omitted: 2 });
  });
});

test("value, pseudo-element, and function records interleave under their own probes", () => {
  const css = `/* css-console: warn color,ghost */
.multi { color: rgb(1, 2, 3); }

/* css-console: log content */
.deco::before { content: "x"; }

/* css-console: info */
@function --pad(--n) { result: calc(var(--n) * 1px); }

.a { padding: --pad(1); }

.b { margin-left: --pad(2); }`;

  const markup = `<p class="multi"></p><p class="multi"></p><span class="deco"></span><i class="a"></i><i class="b"></i>`;

  withFixture(markup, css, (host) => {
    const events = eventsOf(host, css);

    expect(kinds(events)).toEqual([
      "diagnostic",
      "probe-start",
      "record",
      "record",
      "probe-summary",
      "probe-start",
      "record",
      "probe-summary",
      "probe-start",
      "record",
      "record",
      "probe-summary",
    ]);

    const [multiStart, decoStart, padStart] = starts(events);
    const [multiSummary, decoSummary, padSummary] = summaries(events);
    const probeRecords = records(events);

    expect(multiStart?.probeKind).toBe("value");
    expect(multiStart?.logLevel).toBe("warn");
    expect(multiSummary?.records).toBe(2);
    expect(multiSummary?.matches).toEqual({ total: 2, evaluated: 2, omitted: 0 });

    expect(decoStart?.probeKind).toBe("value");
    expect(probeRecords[2]?.pseudo).toBe("::before");
    expect(decoSummary?.records).toBe(1);

    expect(padStart?.probeKind).toBe("function");
    expect(padStart?.probeKind === "function" ? padStart.functionName : undefined).toBe("--pad");
    expect(padSummary?.records).toBe(2);
    expect(padSummary?.matches).toEqual({ total: 2, evaluated: 2, omitted: 0 });

    const functionRecords = probeRecords.slice(3);

    expect(functionRecords.map((record) => record.kind)).toEqual(["function", "function"]);
    expect(new Set(functionRecords.map((record) => record.probeId)).size).toBe(2);

    for (const record of functionRecords) {
      expect(record.probeId.startsWith(`${padStart?.probeId ?? ""}::call-`)).toBe(true);
    }
  });
});

test("evaluating a source writes nothing to the document", () => {
  const css = `/* css-console: log color */
.solo { color: rgb(1, 2, 3); }

/* css-console: log */
@function --pad(--n) { result: calc(var(--n) * 1px); }

.spaced { padding: --pad(2); }`;

  withFixture(`<p class="solo"></p><p class="spaced"></p>`, css, (host) => {
    const before = document.documentElement.outerHTML;

    eventsOf(host, css);

    expect(document.documentElement.outerHTML).toBe(before);
  });
});
