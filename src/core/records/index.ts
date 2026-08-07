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
 * The subscriber event contract from the public API sketch: a scan emits a
 * record as it compiles or evaluates, a diagnostic as it detects a
 * condition, and a summary once the scan completes. Ordering semantics land
 * with CSSC-023, which specifies and tests them.
 */
export type ScanEvent<TTarget> =
  | { kind: "record"; record: ProbeRecord<TTarget> }
  | { kind: "diagnostic"; diagnostic: Diagnostic }
  | { kind: "summary"; summary: ScanSummary<TTarget> };

/**
 * A handle returned by `subscribe()` that stops delivery of further events
 * when called.
 */
export type Unsubscribe = () => void;
