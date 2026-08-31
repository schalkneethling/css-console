/**
 * The console adapter.
 *
 * `createConsoleAdapter()` renders value probes: it subscribes to a
 * css-console instance and turns the event stream into a legible browser
 * console report, one collapsed group per value probe, with the scan itself
 * bracketed by a named timer and closed with a completion line. Function
 * probes and function records are CSSC-031, and diagnostics and guard
 * reasons are CSSC-032; this adapter ignores every event those releases own,
 * without error, so that subscribing it beside a future adapter costs
 * nothing.
 *
 * Rendering happens at the probe boundary, on `probe-summary`, rather than
 * as each record arrives, because whether a probe's body reads as one
 * element or fifty is undecidable earlier: a single matched element renders
 * as per-property lines, and more than one renders through one
 * `console.table()` call, and the adapter cannot know which shape applies
 * until every record for the probe has arrived. The adapter therefore
 * buffers a probe's records between its `probe-start` and its
 * `probe-summary` and renders once, at the close.
 *
 * A value probe's branches publish distinct identifiers when they name
 * distinct pseudo-elements, while the probe-level `probe-start` and
 * `probe-summary` carry the identifier of the probe's first branch (see
 * `ValueProbeStart` in `src/core/records/index.ts`). A record therefore
 * cannot be attributed to an open probe by identifier equality; the ordering
 * contract on `ScanEvent` guarantees instead that the events between one
 * probe-start and its probe-summary belong to that probe alone, so the
 * adapter attributes every value record it sees to the most recently opened,
 * not yet summarized, value probe.
 *
 * An aborted scan is not observable from the event stream, and the adapter
 * therefore does not recover from one. An aborted scan rejects with
 * `AbortError` and emits no summary, while the events it already delivered
 * stay delivered (see the abort section of `src/browser/scanner/index.ts`),
 * and `ScanEvent` in `src/core/records/index.ts` carries no scan-start
 * marker, no scan identifier, and no abort event. A plain subscriber
 * consequently cannot tell an aborted scan's last event from a continuing
 * one, so the next scan on the same adapter renders under the interrupted
 * scan's timer, reports its completion line against that older label, and,
 * when the abort landed between a probe-start and its probe-summary, renders
 * inside a group that was never closed. Guessing at a scan boundary from
 * event patterns is deliberately not attempted, because a wrong guess would
 * corrupt correct streams. A consumer that aborts scans should subscribe a
 * fresh adapter for the scans that follow; the alternative is an event
 * contract that carries a scan boundary, which this release does not define.
 *
 * The adapter adds no try/catch of its own. Subscriber isolation is the
 * scanner's own guarantee (see `src/browser/scanner/index.ts`), and the
 * adapter stays thin rather than duplicating it. `output` defaults to
 * `globalThis.console`; the adapter only ever calls methods on the output
 * object and never assigns to, patches, or otherwise reads state from the
 * global console.
 */

import type { ProbeSummary, ProbeValue, ValueProbeStart } from "../../core/records/index.ts";
import type { BrowserScanEvent, BrowserValueRecord } from "../records/index.ts";

/**
 * The console methods the adapter calls, as a subset of the global
 * `Console` interface. A consumer supplies an object shaped like this
 * instead of the adapter reaching for `globalThis.console` itself, which is
 * what keeps the global console untouched.
 */
export type ConsoleOutput = Pick<
  Console,
  "log" | "info" | "warn" | "error" | "groupCollapsed" | "groupEnd" | "table" | "time" | "timeEnd"
>;

/** The configuration `createConsoleAdapter()` accepts. */
export type ConsoleAdapterOptions = {
  /** Where rendered output goes, defaulting to `globalThis.console`. */
  readonly output?: ConsoleOutput;
};

/** One value probe's buffered state between its start and its summary. */
type OpenValueProbe = {
  readonly start: ValueProbeStart;
  readonly records: BrowserValueRecord[];
};

/**
 * The group title one value probe-start dictates: the label in brackets when
 * the annotation carried one, the resolved selector, and the annotation's
 * own source location.
 */
function probeTitle(start: ValueProbeStart): string {
  const label = start.label === undefined ? "" : `[${start.label}] `;
  const location = `${start.source.url}:${start.source.start.line}:${start.source.start.column}`;

  return `css-console ${label}${start.selector} — ${location}`;
}

/**
 * The decomposition appended to a resolved value that is exactly one 2D
 * `matrix(a, b, c, d, tx, ty)` function, or `null` when the value is not
 * such a matrix. `matrix3d(...)` never matches, so it renders raw only, as
 * the design brief defers its decomposition. A degenerate matrix, such as
 * the one `transform: scale(0)` resolves to, collapses both axes and drives
 * the scale formulas to divide by zero; `scaleX` or `scaleY` then fails to
 * be finite, and the function returns `null` so the line carries the
 * engine's raw value with nothing appended, rather than a decomposition
 * containing `NaN`.
 */
function matrixDecomposition(resolved: string): string | null {
  const trimmed = resolved.trim();
  const match = /^matrix\(([^()]+)\)$/.exec(trimmed);

  if (match === null) {
    return null;
  }

  const numbers = (match[1] ?? "").split(",").map((part) => Number(part.trim()));

  if (numbers.length !== 6 || numbers.some((value) => Number.isNaN(value))) {
    return null;
  }

  const [a, b, c, d, tx, ty] = numbers as [number, number, number, number, number, number];
  const round = (value: number): number => Number(value.toFixed(2));
  const rotate = round((Math.atan2(b, a) * 180) / Math.PI);
  const scaleX = Math.hypot(a, b);
  const scaleY = (a * d - b * c) / scaleX;

  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) {
    return null;
  }

  return ` — translate(${round(tx)}px, ${round(ty)}px) scale(${round(scaleX)}, ${round(scaleY)}) rotate(${rotate}deg)`;
}

/**
 * The resolved value as rendered: the raw value, with a matrix decomposition
 * appended when it applies. The raw value always renders first and remains
 * authoritative.
 */
function decorateResolved(resolved: string): string {
  const decomposition = matrixDecomposition(resolved);

  return decomposition === null ? resolved : resolved + decomposition;
}

/**
 * The arguments one `ProbeValue` renders as, for the single-record line
 * path. The property name, the authored value, the resolved value, and a
 * `(contested)` marker when the guard reports one form the text; the live
 * target travels as a trailing argument. When the resolved value is a color
 * `CSS.supports()` accepts, the line also renders a swatch: a `%c`-styled run
 * of spaces whose background is the resolved value, followed by a second
 * `%c` directive that resets styling to the empty string before the text
 * begins. The reset exists because styling the whole line, rather than a
 * discrete run beside it, can make the text itself unreadable, for example
 * near-black text over a dark swatch; the resolved value still appears in
 * plain text after the reset, so no information exists only in styling.
 */
function valueLineArguments(value: ProbeValue, target: Element): readonly unknown[] {
  const contested = value.guard.contested ? " (contested)" : "";
  const text = `${value.name}: ${value.authored} → ${decorateResolved(value.resolved)}${contested}`;

  if (CSS.supports("color", value.resolved)) {
    return [`%c  %c ${text}`, `background: ${value.resolved}`, "", target];
  }

  return [text, target];
}

/** One row of the table rendered for a probe with more than one record. */
type ValueTableRow = {
  element: Element;
  property: string;
  authored: string;
  resolved: string;
  contested: boolean;
};

/** The table rows a probe's buffered records dictate, one per record-value pair. */
function valueTableRows(records: readonly BrowserValueRecord[]): ValueTableRow[] {
  return records.flatMap((record) =>
    record.values.map((value) => ({
      element: record.target,
      property: value.name,
      authored: value.authored,
      resolved: decorateResolved(value.resolved),
      contested: value.guard.contested,
    })),
  );
}

/**
 * Renders one value probe's group body from its buffered records and the
 * counts its probe-summary carried, following the dictated rendering rules:
 * nothing for zero records, per-property lines through the record's log
 * level for exactly one record, one `console.table()` call for more than
 * one, and a truncation line whenever matches were omitted.
 */
function renderValueProbeBody(
  start: ValueProbeStart,
  records: readonly BrowserValueRecord[],
  matches: ProbeSummary["matches"],
  output: ConsoleOutput,
): void {
  if (records.length === 1) {
    const [record] = records as [BrowserValueRecord];

    for (const value of record.values) {
      output[record.logLevel](...valueLineArguments(value, record.target));
    }
  } else if (records.length > 1) {
    output.table(valueTableRows(records));
  }

  if (matches.omitted > 0) {
    output[start.logLevel](
      `evaluated ${matches.evaluated} of ${matches.total} matches, ${matches.omitted} omitted (maxElements)`,
    );
  }
}

/**
 * Creates a subscriber that renders value probes to a console-shaped
 * output. Wire it as `instance.subscribe(createConsoleAdapter())`; `output`
 * defaults to `globalThis.console` when omitted.
 */
export function createConsoleAdapter(
  options: ConsoleAdapterOptions = {},
): (event: BrowserScanEvent) => void {
  const output = options.output ?? globalThis.console;

  let scanCounter = 0;
  let scanLabel: string | null = null;
  let openProbe: OpenValueProbe | null = null;

  return (event: BrowserScanEvent): void => {
    if (scanLabel === null) {
      scanCounter += 1;
      scanLabel = `css-console scan ${scanCounter}`;
      output.time(scanLabel);
    }

    switch (event.kind) {
      case "probe-start": {
        if (event.probe.probeKind === "value") {
          openProbe = { start: event.probe, records: [] };
          output.groupCollapsed(probeTitle(event.probe));
        }

        break;
      }

      case "record": {
        if (event.record.kind === "value" && openProbe !== null) {
          openProbe.records.push(event.record);
        }

        break;
      }

      case "probe-summary": {
        if (openProbe !== null && event.summary.probeId === openProbe.start.probeId) {
          renderValueProbeBody(openProbe.start, openProbe.records, event.summary.matches, output);
          output.groupEnd();
          openProbe = null;
        }

        break;
      }

      case "summary": {
        const label = scanLabel;

        scanLabel = null;

        if (label !== null) {
          output.timeEnd(label);
        }

        output.log("css-console: scan complete", {
          sources: event.summary.sources,
          probes: event.summary.probes,
          matches: event.summary.matches,
          durationMs: event.summary.durationMs,
        });

        openProbe = null;

        break;
      }

      default: {
        break;
      }
    }
  };
}
