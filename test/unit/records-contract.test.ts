import { expect, test } from "vite-plus/test";

import type {
  CallSite,
  Diagnostic,
  FunctionRecord,
  GuardReason,
  LogLevel,
  ProbeRecord,
  ProbeValue,
  ScanEvent,
  ScanSummary,
  SourceLocation,
  SourcePosition,
  Unsubscribe,
  ValueGuard,
  ValueRecord,
} from "@schalkneethling/css-console";

import type { Equal, Expect } from "./type-level.ts";

/**
 * Public record contract tests.
 *
 * This suite proves that the published record shapes match the contract in
 * plans/implementation.md section 3.5 field by field: the names, the field
 * types, the readonly array fields, the optional fields, the literal unions,
 * and the generic target parameter flowing through to the target field. The
 * assertions are checked by the compiler through tsconfig.test.json rather
 * than at run time, so a drift in any field fails the typecheck lane. Every
 * type is imported from the package entry point, which also proves that the
 * entry re-exports the full public surface. A small run-time test exercises
 * the sample values so the file is not empty at run time.
 */

const sampleGuard: ValueGuard = {
  contested: false,
  reasons: [],
};

const samplePosition: SourcePosition = {
  line: 1,
  column: 1,
};

const sampleLocation: SourceLocation = {
  url: "styles.css",
  start: samplePosition,
  end: { line: 1, column: 12 },
};

const sampleProbeValue: ProbeValue = {
  name: "color",
  authored: "var(--brand)",
  resolved: "rgb(0, 0, 0)",
  guard: sampleGuard,
};

const sampleCallSite: CallSite = {
  property: "padding",
  arguments: ["4"],
  soleContribution: true,
  selector: ".card",
  source: sampleLocation,
};

const sampleValueRecord: ValueRecord<string> = {
  kind: "value",
  probeId: "probe-1",
  level: "log",
  label: "brand color",
  selector: ".card",
  target: "the-target",
  pseudo: null,
  source: sampleLocation,
  values: [sampleProbeValue],
  timestamp: 0,
};

const sampleFunctionRecord: FunctionRecord<string> = {
  kind: "function",
  probeId: "probe-2",
  level: "log",
  label: "space scale",
  functionName: "--space",
  definition: sampleLocation,
  callSite: sampleCallSite,
  target: "the-target",
  pseudo: null,
  resolved: "16px",
  guard: sampleGuard,
  timestamp: 0,
};

const sampleDiagnostic: Diagnostic = {
  code: "reserved-pending-support",
  severity: "warning",
  message: "The browser does not yet support this at-rule.",
  docsUrl: "https://example.com/docs",
};

const sampleSummary: ScanSummary<string> = {
  sources: { discovered: 1, compiled: 1, failed: 0, excluded: 0 },
  probes: { compiled: 2, evaluated: 2, skipped: 0 },
  matches: { total: 3, evaluated: 3, omitted: 0 },
  records: [sampleValueRecord, sampleFunctionRecord],
  diagnostics: [sampleDiagnostic],
  durationMs: 4,
};

/**
 * The field and union assertions gather into one exported tuple so that a
 * single name carries them all. Every element is an Expect check that resolves
 * to true only when the contract holds; a drifted field turns its element into
 * a false type, which fails the tuple constraint and the typecheck lane. The
 * tuple is exported so that the unused-local check does not flag it.
 */
export type ContractAssertions = [
  // The log level is a closed union.
  Expect<Equal<LogLevel, "log" | "info" | "warn" | "error">>,

  // The guard reason is a closed union.
  Expect<
    Equal<
      GuardReason,
      | "competing-declaration"
      | "inline-style"
      | "important"
      | "animation-or-transition"
      | "unresolved-variable"
    >
  >,

  // The diagnostic severity is a closed union.
  Expect<Equal<Diagnostic["severity"], "info" | "warning" | "error">>,

  // The source position matches the PostCSS one-based convention shape.
  Expect<Equal<SourcePosition, { line: number; column: number }>>,

  // The source location carries a url and a start and end position.
  Expect<Equal<SourceLocation, { url: string; start: SourcePosition; end: SourcePosition }>>,

  // The unsubscribe handle is a function that returns nothing.
  Expect<Equal<Unsubscribe, () => void>>,

  // The guard exposes a contested boolean and a readonly array of reasons.
  Expect<Equal<ValueGuard, { contested: boolean; reasons: readonly GuardReason[] }>>,

  // The probe value carries the authored and resolved strings and a guard.
  Expect<Equal<ProbeValue["name"], string>>,
  Expect<Equal<ProbeValue["authored"], string>>,
  Expect<Equal<ProbeValue["resolved"], string>>,
  Expect<Equal<ProbeValue["guard"], ValueGuard>>,

  // The value record discriminant, fields, and field types match the contract.
  Expect<Equal<ValueRecord<string>["kind"], "value">>,
  Expect<Equal<ValueRecord<string>["probeId"], string>>,
  Expect<Equal<ValueRecord<string>["level"], LogLevel>>,
  Expect<Equal<ValueRecord<string>["selector"], string>>,
  Expect<Equal<ValueRecord<string>["pseudo"], string | null>>,
  Expect<Equal<ValueRecord<string>["source"], SourceLocation>>,
  Expect<Equal<ValueRecord<string>["values"], readonly ProbeValue[]>>,
  Expect<Equal<ValueRecord<string>["timestamp"], number>>,

  // The function record discriminant, fields, and field types match the contract.
  Expect<Equal<FunctionRecord<string>["kind"], "function">>,
  Expect<Equal<FunctionRecord<string>["functionName"], string>>,
  Expect<Equal<FunctionRecord<string>["definition"], SourceLocation>>,
  Expect<Equal<FunctionRecord<string>["callSite"], CallSite>>,
  Expect<Equal<FunctionRecord<string>["resolved"], string>>,
  Expect<Equal<FunctionRecord<string>["guard"], ValueGuard>>,

  // The call site fields and field types match the contract.
  Expect<Equal<CallSite["property"], string>>,
  Expect<Equal<CallSite["arguments"], readonly string[]>>,
  Expect<Equal<CallSite["soleContribution"], boolean>>,
  Expect<Equal<CallSite["selector"], string>>,
  Expect<Equal<CallSite["source"], SourceLocation>>,

  // The generic target parameter flows through to the target field unchanged.
  Expect<Equal<ValueRecord<string>["target"], string>>,
  Expect<Equal<ValueRecord<number>["target"], number>>,
  Expect<Equal<FunctionRecord<string>["target"], string>>,
  Expect<Equal<FunctionRecord<number>["target"], number>>,

  // The probe record union is exactly the value and function records.
  Expect<Equal<ProbeRecord<string>, ValueRecord<string> | FunctionRecord<string>>>,

  // The scan summary fields and field types match the contract.
  Expect<Equal<ScanSummary<string>["records"], ReadonlyArray<ProbeRecord<string>>>>,
  Expect<Equal<ScanSummary<string>["diagnostics"], readonly Diagnostic[]>>,
  Expect<Equal<ScanSummary<string>["durationMs"], number>>,
  Expect<
    Equal<
      ScanSummary<string>["sources"],
      { discovered: number; compiled: number; failed: number; excluded: number }
    >
  >,

  // The scan event is the closed union of the three event shapes.
  Expect<
    Equal<
      ScanEvent<string>,
      | { kind: "record"; record: ProbeRecord<string> }
      | { kind: "diagnostic"; diagnostic: Diagnostic }
      | { kind: "summary"; summary: ScanSummary<string> }
    >
  >,

  // The details field is a record of unknown values, not a specific shape.
  Expect<Equal<NonNullable<Diagnostic["details"]>, Record<string, unknown>>>,
];

// The label field is optional, so a record without it still typechecks.
const valueRecordWithoutLabel: ValueRecord<string> = {
  kind: "value",
  probeId: "probe-1",
  level: "log",
  selector: ".card",
  target: "the-target",
  pseudo: null,
  source: sampleLocation,
  values: [sampleProbeValue],
  timestamp: 0,
};

// The source and details fields are optional on a diagnostic.
const diagnosticWithoutOptionalFields: Diagnostic = {
  code: "grouping-construct",
  severity: "info",
  message: "Grouping constructs are not annotation targets.",
  docsUrl: "https://example.com/docs",
};

const diagnosticWithOptionalFields: Diagnostic = {
  code: "grouping-construct",
  severity: "info",
  message: "Grouping constructs are not annotation targets.",
  docsUrl: "https://example.com/docs",
  source: sampleLocation,
  details: { atRule: "@media" },
};

// A required field cannot be omitted.
// @ts-expect-error the probeId field is required
const valueRecordMissingProbeId: ValueRecord<string> = {
  kind: "value",
  level: "log",
  selector: ".card",
  target: "the-target",
  pseudo: null,
  source: sampleLocation,
  values: [sampleProbeValue],
  timestamp: 0,
};

test("the record samples carry the contracted field values at run time", () => {
  expect(sampleValueRecord.kind).toBe("value");
  expect(sampleValueRecord.values[0]?.name).toBe("color");
  expect(sampleFunctionRecord.kind).toBe("function");
  expect(sampleFunctionRecord.callSite.property).toBe("padding");
  expect(sampleDiagnostic.severity).toBe("warning");
  expect(sampleSummary.records).toHaveLength(2);
  expect(valueRecordWithoutLabel.label).toBeUndefined();
  expect(diagnosticWithoutOptionalFields.source).toBeUndefined();
  expect(diagnosticWithOptionalFields.details?.atRule).toBe("@media");
  expect(valueRecordMissingProbeId.kind).toBe("value");
});
