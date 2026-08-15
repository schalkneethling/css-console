/**
 * Normalized browser events.
 *
 * Every earlier browser module answers one question against the live engine:
 * whether a condition holds, which elements a branch matches, what a
 * property resolved to, what a call site produced, and whether anything
 * competes. This module is where those answers become the published record
 * contract. `evaluateSource()` takes one compiled source and produces the
 * ordered event list a subscriber consumes, and it is the last stop before
 * the scan lifecycle (CSSC-028) and the console adapter (Phase 4), so the
 * shapes it emits are the shapes the project has promised.
 *
 * ## Ordering
 *
 * The event order restates the contract `ScanEvent` documents, because the
 * console adapter renders each probe inside `console.groupCollapsed()` and a
 * group can only be opened and closed around the events that belong to it:
 * the source's compilation diagnostics come first, and then each probe, in
 * compiled order, emits one probe-start, its diagnostics and records as
 * evaluation produced them, and one probe-summary. Within a probe, the
 * diagnostics evaluation produced precede the records, because matching
 * happens before reading and a branch the engine refused is known before any
 * record exists.
 *
 * ## Probe-level identity
 *
 * A value probe's records publish branch identifiers, which differ across
 * branches naming different pseudo-elements (CSSC-015). The probe-level
 * events carry the identifier of the probe's first branch, in compiled
 * branch order, so one annotation opens one group; see `ValueProbeStart`
 * for why one start per branch was rejected.
 *
 * ## A skipped probe still has boundaries
 *
 * A value probe whose rule context is inactive emits its probe-start and
 * probe-summary with zero counts rather than emitting nothing, so a
 * subscriber sees that the probe existed and was inactive. The scan
 * lifecycle counts skips in its summary (CSSC-028); the boundary events are
 * what make the count reconstructible from the stream alone.
 *
 * ## Limits
 *
 * `maxElements` bounds how many matches one probe evaluates, defaulting to
 * `DEFAULT_MAX_ELEMENTS`, and the probe-summary keeps the totals limiting
 * preserved. For a function probe the limit applies per call site, to that
 * call site's matched elements, because a call site is the unit a function
 * record reports; the summary sums totals across call sites, so a truncated
 * call site is still visible in the difference between total and evaluated.
 *
 * ## The function record guard has one recorded gap
 *
 * A function record's guard evaluates for the call site's destination
 * property with the call site's own guard index entry excluded, exactly as a
 * value probe's property excludes its own declaration. The
 * `unresolved-variable` reason cannot fire for a function record in this
 * release: the reason substitutes references into the declaration's authored
 * value, and a compiled call site retains its arguments rather than the full
 * declaration value, so the subject carries an empty reference list and the
 * check never runs. Retaining the authored value on the call site is the
 * follow-up that would close the gap.
 *
 * ## Timestamps
 *
 * Records carry `performance.now()` by default. The High Resolution Time
 * specification requires the clock to be monotonically non-decreasing, and
 * the browser suite pins the non-decreasing property empirically against
 * headless Chromium 151.0.7922.34 rather than trusting the recollection. A
 * caller injects a clock through `options.clock` for deterministic
 * timestamps, which is the one place the test strategy permits freezing
 * time.
 *
 * Nothing here writes to the document, which is the read-only guarantee
 * (implementation plan section 5.9): every engine call this module composes
 * is a read, and the browser suite asserts markup equality across an
 * evaluation.
 */

import type {
  CompiledCallSite,
  CompiledFunctionProbe,
  CompiledSource,
  CompiledValueProbe,
  GuardIndex,
} from "../../core/compiler/index.ts";
import type {
  CallSite,
  FunctionProbeStart,
  FunctionRecord,
  ProbeRecord,
  ProbeSummary,
  ProbeValue,
  ScanEvent,
  ScanSummary,
  ValueProbeStart,
  ValueRecord,
} from "../../core/records/index.ts";

import { isContextActive } from "../conditions/index.ts";
import { evaluateFunctionProbe, readResolvedValues } from "../evaluator/index.ts";
import { evaluateGuard } from "../guard/index.ts";
import type { GuardSubject } from "../guard/index.ts";
import { DEFAULT_MAX_ELEMENTS, limitMatches, matchBranches } from "../matcher/index.ts";

/** A value or rule probe record whose target is a live `Element`. */
export type BrowserValueRecord = ValueRecord<Element>;

/** A function probe record whose target is a live `Element`. */
export type BrowserFunctionRecord = FunctionRecord<Element>;

/** The union of browser record kinds, discriminated on `kind`. */
export type BrowserProbeRecord = ProbeRecord<Element>;

/** A scan summary carrying browser records. */
export type BrowserScanSummary = ScanSummary<Element>;

/** A subscriber event carrying browser records and summaries. */
export type BrowserScanEvent = ScanEvent<Element>;

/** The options `evaluateSource()` accepts. */
export type EvaluateSourceOptions = {
  /**
   * The subtree probes are matched within, defaulting to the document, as
   * `matchBranches()` does.
   */
  root?: ParentNode;

  /**
   * The clock records read their timestamps from, defaulting to
   * `performance.now()`. Injected for deterministic timestamps in tests; the
   * default clock is what ships.
   */
  clock?: () => number;

  /**
   * The maximum matches one probe evaluates, defaulting to
   * `DEFAULT_MAX_ELEMENTS`. Validation belongs to construction
   * (`validateMaxElements()`, CSSC-028); this module applies the value as
   * given.
   */
  maxElements?: number;
};

/** The zero match counts an inactive probe reports. */
const NO_MATCHES: ProbeSummary["matches"] = { total: 0, evaluated: 0, omitted: 0 };

/**
 * The probe-start payload of a value probe. The probe-level identifier is
 * the first branch's; see the module doc comment.
 */
function valueProbeStart(probe: CompiledValueProbe): ValueProbeStart {
  const start: ValueProbeStart = {
    probeId: probe.branches[0].probeId,
    probeKind: "value",
    logLevel: probe.logLevel,
    selector: probe.selector,
    source: probe.annotation,
  };

  if (probe.label !== undefined) {
    start.label = probe.label;
  }

  return start;
}

/** The probe-start payload of a function probe. */
function functionProbeStart(probe: CompiledFunctionProbe): FunctionProbeStart {
  const start: FunctionProbeStart = {
    probeId: probe.probeId,
    probeKind: "function",
    logLevel: probe.logLevel,
    functionName: probe.functionName,
    source: probe.annotation,
  };

  if (probe.label !== undefined) {
    start.label = probe.label;
  }

  return start;
}

/**
 * The published record shape of a compiled call site. Constructed field by
 * field rather than spread, because the compiled call site carries fields
 * the record contract does not publish: the rule context, the composed
 * identifier, and the guard index entry all serve evaluation, and spreading
 * would leak whichever field the compiler adds next. The browser suite pins
 * the published keys.
 */
function publishedCallSite(callSite: CompiledCallSite): CallSite {
  return {
    property: callSite.property,
    arguments: callSite.arguments,
    soleContribution: callSite.soleContribution,
    selector: callSite.selector,
    source: callSite.source,
  };
}

/**
 * Evaluates one value probe, appending its boundary events, diagnostics,
 * and records to `events`.
 *
 * An inactive rule context emits the boundaries and nothing else. An active
 * one matches the branches, applies the match limit, and reads every
 * property of each evaluated match through one acquisition, with the guard
 * evaluated against the flow facts of the same reading, so the guard's
 * logical resolution describes the box the values came from.
 */
function evaluateValueProbe(
  probe: CompiledValueProbe,
  index: GuardIndex,
  events: BrowserScanEvent[],
  options: { root?: ParentNode; clock: () => number; maxElements: number },
): void {
  events.push({ kind: "probe-start", probe: valueProbeStart(probe) });

  const probeId = probe.branches[0].probeId;

  if (!isContextActive(probe.context)) {
    events.push({
      kind: "probe-summary",
      summary: { probeId, records: 0, diagnostics: 0, matches: NO_MATCHES },
    });

    return;
  }

  const matched = matchBranches(probe.branches, options.root);

  for (const diagnostic of matched.diagnostics) {
    events.push({ kind: "diagnostic", diagnostic });
  }

  const limited = limitMatches(matched.matches, options.maxElements);

  for (const match of limited.evaluated) {
    const reading = readResolvedValues(match.element, match.branch.pseudo, probe.properties);

    // The reading's values are parallel to the probe's properties by
    // construction, because `readResolvedValues()` maps over the property
    // list; the fallback to the first property is unreachable and exists
    // only because an index signature cannot say so.
    const values: ProbeValue[] = reading.values.map((value, position) => ({
      ...value,
      guard: evaluateGuard({
        element: match.element,
        property: probe.properties[position] ?? probe.properties[0],
        index,
        writingMode: reading.writingMode,
        direction: reading.direction,
      }),
    }));

    const record: BrowserValueRecord = {
      kind: "value",
      probeId: match.branch.probeId,
      logLevel: probe.logLevel,
      selector: probe.selector,
      target: match.element,
      pseudo: match.branch.pseudo,
      source: probe.source,
      values,
      timestamp: options.clock(),
    };

    if (probe.label !== undefined) {
      record.label = probe.label;
    }

    events.push({ kind: "record", record });
  }

  events.push({
    kind: "probe-summary",
    summary: {
      probeId,
      records: limited.evaluated.length,
      diagnostics: matched.diagnostics.length,
      matches: {
        total: limited.total,
        evaluated: limited.evaluated.length,
        omitted: limited.omitted,
      },
    },
  });
}

/**
 * The guard subject of one call site. The authored value and the custom
 * property references are the recorded gap the module doc comment carries:
 * a call site retains neither, so `unresolved-variable` cannot fire, and
 * the empty reference list is what keeps the check from running against a
 * fabricated value. The importance flag rides on the call site's own index
 * entry when the index holds one.
 */
function callSiteSubject(callSite: CompiledCallSite): GuardSubject {
  return {
    name: callSite.property,
    authored: "",
    important: callSite.indexed?.important ?? false,
    customProperties: [],
    indexed: callSite.indexed,
  };
}

/**
 * Evaluates one function probe, appending its boundary events, diagnostics,
 * and records to `events`.
 *
 * Each call site's matched elements are limited independently, and the
 * summary sums the totals, so a truncated call site stays visible; see the
 * module doc comment. The flow facts for each element come from
 * `readResolvedValues()` with no properties, which is one acquisition
 * reading only `writing-mode` and `direction`, rather than a second code
 * path duplicating the evaluator's discipline.
 */
function evaluateFunctionProbeEvents(
  probe: CompiledFunctionProbe,
  index: GuardIndex,
  events: BrowserScanEvent[],
  options: { root?: ParentNode; clock: () => number; maxElements: number },
): void {
  events.push({ kind: "probe-start", probe: functionProbeStart(probe) });

  const evaluation = evaluateFunctionProbe(probe, { root: options.root });

  for (const diagnostic of evaluation.diagnostics) {
    events.push({ kind: "diagnostic", diagnostic });
  }

  const matches = { total: 0, evaluated: 0, omitted: 0 };
  let recordCount = 0;

  for (const evaluated of evaluation.callSites) {
    const limited = limitMatches(evaluated.evaluations, options.maxElements);

    matches.total += limited.total;
    matches.evaluated += limited.evaluated.length;
    matches.omitted += limited.omitted;

    for (const { element, resolved } of limited.evaluated) {
      const flow = readResolvedValues(element, null, []);
      const guard = evaluateGuard({
        element,
        property: callSiteSubject(evaluated.callSite),
        index,
        writingMode: flow.writingMode,
        direction: flow.direction,
      });

      const record: BrowserFunctionRecord = {
        kind: "function",
        probeId: evaluated.callSite.probeId,
        logLevel: probe.logLevel,
        functionName: probe.functionName,
        definition: probe.definition,
        callSite: publishedCallSite(evaluated.callSite),
        target: element,
        pseudo: null,
        resolved,
        guard,
        timestamp: options.clock(),
      };

      if (probe.label !== undefined) {
        record.label = probe.label;
      }

      events.push({ kind: "record", record });
      recordCount += 1;
    }
  }

  events.push({
    kind: "probe-summary",
    summary: {
      probeId: probe.probeId,
      records: recordCount,
      diagnostics: evaluation.diagnostics.length,
      matches,
    },
  });
}

/**
 * Evaluates one compiled source against the live document, producing the
 * ordered event list the record contract promises: the source's compilation
 * diagnostics, then each probe's probe-start, diagnostics and records, and
 * probe-summary, in compiled order. See the module doc comment for the
 * ordering contract, the probe-level identity choice, the limit semantics,
 * and the recorded function record guard gap.
 */
export function evaluateSource(
  compiled: CompiledSource,
  options: EvaluateSourceOptions = {},
): readonly BrowserScanEvent[] {
  const clock = options.clock ?? (() => performance.now());
  const maxElements = options.maxElements ?? DEFAULT_MAX_ELEMENTS;
  const events: BrowserScanEvent[] = [];
  const probeOptions =
    options.root === undefined
      ? { clock, maxElements }
      : { root: options.root, clock, maxElements };

  for (const diagnostic of compiled.diagnostics) {
    events.push({ kind: "diagnostic", diagnostic });
  }

  for (const probe of compiled.probes) {
    if (probe.kind === "value") {
      evaluateValueProbe(probe, compiled.guardIndex, events, probeOptions);
    } else {
      evaluateFunctionProbeEvents(probe, compiled.guardIndex, events, probeOptions);
    }
  }

  return events;
}
