/**
 * Public record contracts.
 *
 * This module declares the record, event, and guard types the runtime
 * publishes. Core cannot reference the DOM, so every record here is generic
 * over its target, and the browser layer supplies the concrete target type.
 * Every public type is declared with `type` rather than `interface`, so that
 * declaration merging cannot reopen a published contract, following the
 * decision recorded in docs/decisions/0011-type-rather-than-interface.md.
 */

/**
 * The four log levels a probe can report at, mapping directly onto the
 * corresponding Console API methods. Log levels carry no assertion or
 * control-flow semantics.
 */
export type LogLevel = "log" | "info" | "warn" | "error";

/**
 * A one-based line and column position within a source, following the
 * convention PostCSS uses for source positions.
 */
export type SourcePosition = {
  line: number;
  column: number;
};

/**
 * The span a source location covers: the resolved URL of the source, plus
 * the one-based start and end positions within it. Deterministic fixture
 * URLs land with CSSC-004.
 */
export type SourceLocation = {
  url: string;
  start: SourcePosition;
  end: SourcePosition;
};

/**
 * A single property observed by a value or rule probe: the property name,
 * the value as authored, the value the browser resolved, and the guard that
 * reports whether another declaration may have produced it.
 */
export type ProbeValue = {
  name: string;
  authored: string;
  resolved: string;
  guard: ValueGuard;
};

/**
 * A record produced by a rule or declaration probe. `values` is an ordered
 * readonly array, because an explicit property list must preserve requested
 * order and a plain object does not express that in the type system.
 */
export type ValueRecord<TTarget> = {
  kind: "value";
  probeId: string;
  logLevel: LogLevel;
  label?: string;
  selector: string;
  target: TTarget;
  pseudo: string | null;
  source: SourceLocation;
  values: readonly ProbeValue[];
  timestamp: number;
};

/**
 * The location and shape of one call to a custom function. `property` is the
 * declaration's destination property, `arguments` are the call's arguments
 * as authored, and `selector` and `source` describe the containing rule
 * after nesting resolution.
 */
export type CallSite = {
  property: string;
  arguments: readonly string[];
  /**
   * True when the call is the entire declaration value, so no other
   * authored expression contributes to the resolved value. The resolved
   * value is the property's resolved value in both cases, never the
   * function's return value, because the destination property's own
   * value resolution applies before the tool can observe anything.
   */
  soleContribution: boolean;
  selector: string;
  source: SourceLocation;
};

/**
 * A record produced by a function probe, reporting one call site of the
 * annotated function against one matched target.
 */
export type FunctionRecord<TTarget> = {
  kind: "function";
  probeId: string;
  logLevel: LogLevel;
  label?: string;
  functionName: string;
  definition: SourceLocation;
  callSite: CallSite;
  target: TTarget;
  pseudo: string | null;
  resolved: string;
  guard: ValueGuard;
  timestamp: number;
};

/**
 * The union of every record kind the runtime emits, discriminated on `kind`.
 */
export type ProbeRecord<TTarget> = ValueRecord<TTarget> | FunctionRecord<TTarget>;

/**
 * The reason a guard reports a value as contested. Each member names a
 * distinct condition under which another declaration, an inline style, or a
 * running animation may have produced the observed value instead of the
 * annotated source.
 */
export type GuardReason =
  | "competing-declaration"
  | "inline-style"
  | "important"
  | "animation-or-transition"
  | "unresolved-variable";

/**
 * The outcome of the contested guard for one property on one target. The
 * guard never resolves the cascade, ranks declarations, or names a winner;
 * it answers only whether the annotated declaration may not be the sole
 * contributor, and why.
 */
export type ValueGuard = {
  contested: boolean;
  reasons: readonly GuardReason[];
};

/**
 * A structured report describing a condition the runtime detected, such as
 * an annotation the grammar rejects, an at-rule outside the supported target
 * set, or a value the guard cannot present with confidence.
 *
 * `code` is a stable identifier for the condition, and `docsUrl` points to
 * the documentation that explains it. `source` is present when the condition
 * traces to a location in a scanned source, and absent otherwise. `details`
 * carries condition-specific data, such as the name of an unsupported
 * at-rule.
 */
export type Diagnostic = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  docsUrl: string;
  source?: SourceLocation;
  details?: Record<string, unknown>;
};

/**
 * The aggregate outcome of one scan, carrying every record and diagnostic
 * alongside counts for sources, probes, and matches. The summary carries
 * records directly, so a simple consumer never needs to subscribe.
 */
export type ScanSummary<TTarget> = {
  sources: { discovered: number; compiled: number; failed: number; excluded: number };
  probes: { compiled: number; evaluated: number; skipped: number };
  matches: { total: number; evaluated: number; omitted: number };
  records: ReadonlyArray<ProbeRecord<TTarget>>;
  diagnostics: readonly Diagnostic[];
  durationMs: number;
};

/**
 * The event that opens a value probe: what a consumer needs to open a
 * console group for it before any of its records arrive. `selector` is the
 * resolved selector list the probe matches, which is how an author
 * recognizes the annotation they wrote, and `source` is the location of the
 * annotation comment itself, because the group points at what the author
 * wrote rather than at what it attached to.
 *
 * `probeId` identifies the probe as a whole, and for a value probe choosing
 * it takes a decision, because record identity is finer than probe identity:
 * a value probe's branches carry distinct identifiers when they name
 * distinct pseudo-elements (CSSC-015), so `.card::before, .card` is one
 * annotation publishing records under two identifiers. The decision is that
 * the probe-level events carry the identifier of the probe's own first
 * branch, in the order the compiler produced the branches. One start per branch was rejected because it would
 * split one annotation into two console groups, which is not how an author
 * reads their annotation; the branch identifiers remain observable on every
 * record between the start and the summary.
 */
export type ValueProbeStart = {
  probeId: string;
  probeKind: "value";
  logLevel: LogLevel;
  label?: string;
  selector: string;
  source: SourceLocation;
};

/**
 * The event that opens a function probe. `functionName` is the name a
 * consumer titles the group with, `source` is the location of the annotation
 * comment, and `probeId` is the function probe's own identifier; the records
 * between the start and the summary carry the composed per-call-site
 * identifiers that begin with it.
 */
export type FunctionProbeStart = {
  probeId: string;
  probeKind: "function";
  logLevel: LogLevel;
  label?: string;
  functionName: string;
  source: SourceLocation;
};

/**
 * The payload of a probe-start event, discriminated on `probeKind` rather
 * than merged into one shape with optional fields, because `selector` and
 * `functionName` are mutually exclusive by kind and an optional field cannot
 * say so.
 */
export type ProbeStart = ValueProbeStart | FunctionProbeStart;

/**
 * The payload of a probe-summary event: the counts one probe produced, so a
 * consumer can close the probe's group and a subscriber can detect an empty
 * or truncated probe without counting records itself. `records` and
 * `diagnostics` count the events emitted between this probe's start and this
 * summary, and `matches` carries the totals match limiting preserved, so a
 * truncated probe still reports how many matches existed.
 */
export type ProbeSummary = {
  probeId: string;
  records: number;
  diagnostics: number;
  matches: { total: number; evaluated: number; omitted: number };
};

/**
 * The subscriber event contract: a scan emits a record as it evaluates, a
 * diagnostic as it detects a condition, a probe-start and a probe-summary
 * around each probe's work, and a summary once the scan completes.
 *
 * ## Ordering
 *
 * The event order is specified rather than incidental, because the console
 * adapter renders probes inside `console.groupCollapsed()` and a group can
 * only be opened and closed around the events that belong to it:
 *
 * 1. Source-level diagnostics from compilation precede every probe event of
 *    that source.
 * 2. Each probe then emits, in compiled order: one probe-start, then its
 *    records and diagnostics interleaved as evaluation produced them, then
 *    one probe-summary.
 * 3. A probe whose conditions are inactive still emits its probe-start and
 *    probe-summary, with zero records, so a subscriber sees that the probe
 *    existed and was skipped rather than seeing nothing at all.
 * 4. The scan summary, when present, is the final event.
 */
export type ScanEvent<TTarget> =
  | { kind: "record"; record: ProbeRecord<TTarget> }
  | { kind: "diagnostic"; diagnostic: Diagnostic }
  | { kind: "probe-start"; probe: ProbeStart }
  | { kind: "probe-summary"; summary: ProbeSummary }
  | { kind: "summary"; summary: ScanSummary<TTarget> };

/**
 * A handle returned by `subscribe()` that stops delivery of further events
 * when called.
 */
export type Unsubscribe = () => void;
