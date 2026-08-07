import { expect, test } from "vite-plus/test";

import type {
  Diagnostic,
  FunctionRecord,
  ProbeRecord,
  ProbeValue,
  ScanEvent,
  ScanSummary,
  SourceLocation,
  ValueGuard,
  ValueRecord,
} from "@schalkneethling/css-console";

import type { Equal, Expect } from "./type-level.ts";

/**
 * Record discrimination and immutability tests.
 *
 * This suite proves three behaviors of the public records. The values array
 * is an ordered readonly array, so mutation methods are absent and the array
 * is not assignable to a mutable array while ordered index access stays
 * typed. The pseudo field accepts a string or null but not undefined. The
 * probe record union and the scan event union both discriminate exhaustively
 * on their kind field, so an exhaustive switch with a never default compiles
 * and each branch narrows to the matching member. The negative cases are
 * expressed with expect-error so the compiler enforces them in the typecheck
 * lane. A small run-time test exercises the sample values so the file is not
 * empty at run time.
 */

const sampleGuard: ValueGuard = {
  contested: false,
  reasons: [],
};

const sampleLocation: SourceLocation = {
  url: "styles.css",
  start: { line: 1, column: 1 },
  end: { line: 1, column: 12 },
};

const sampleProbeValue: ProbeValue = {
  name: "color",
  authored: "var(--brand)",
  resolved: "rgb(0, 0, 0)",
  guard: sampleGuard,
};

const baseValueRecord: ValueRecord<string> = {
  kind: "value",
  probeId: "probe-1",
  logLevel: "log",
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
  logLevel: "log",
  functionName: "--space",
  definition: sampleLocation,
  callSite: {
    property: "padding",
    arguments: ["4"],
    soleContribution: true,
    selector: ".card",
    source: sampleLocation,
  },
  target: "the-target",
  pseudo: null,
  resolved: "16px",
  guard: sampleGuard,
  timestamp: 0,
};

// The values field is an ordered readonly array of probe values. The check is
// exported as a tuple so that the unused-local check does not flag it.
export type ImmutabilityAssertions = [
  Expect<Equal<ValueRecord<string>["values"], readonly ProbeValue[]>>,
];

// The readonly values field is copied into a fresh array so that the
// mutation-rejection checks do not mutate the shared sample record.
const readonlyValues: readonly ProbeValue[] = [...baseValueRecord.values];

// A readonly array is not assignable to a mutable array.
// @ts-expect-error a readonly array cannot flow into a mutable array position
const _mutableValues: ProbeValue[] = readonlyValues;

// The mutation methods of a mutable array are absent on the readonly array.
// @ts-expect-error push is not present on a readonly array
readonlyValues.push(sampleProbeValue);

// @ts-expect-error reverse is not present on a readonly array
readonlyValues.reverse();

// Ordered index access stays typed as a probe value.
const firstValue: ProbeValue = readonlyValues[0] as ProbeValue;

// The pseudo field accepts a string.
const recordWithStringPseudo: ValueRecord<string> = {
  ...baseValueRecord,
  pseudo: "::before",
};

// The pseudo field accepts null.
const recordWithNullPseudo: ValueRecord<string> = {
  ...baseValueRecord,
  pseudo: null,
};

// The pseudo field does not accept undefined.
const recordWithUndefinedPseudo: ValueRecord<string> = {
  ...baseValueRecord,
  // @ts-expect-error pseudo is a string or null and does not accept undefined
  pseudo: undefined,
};

/**
 * Narrows a probe record on its kind. Each branch reaches a field that exists
 * only on the matching member, and the default branch assigns to never, so
 * this function compiles only when the union discriminates exhaustively.
 */
function describeProbeRecord(record: ProbeRecord<string>): string {
  switch (record.kind) {
    case "value": {
      const valueOnly: ValueRecord<string> = record;
      return valueOnly.values.length.toString();
    }
    case "function": {
      const functionOnly: FunctionRecord<string> = record;
      return functionOnly.callSite.property;
    }
    default: {
      const unreachable: never = record;
      return unreachable;
    }
  }
}

/**
 * Narrows a scan event on its kind across the three event shapes, with a
 * never default that compiles only when the union is exhaustive.
 */
function describeScanEvent(event: ScanEvent<string>): string {
  switch (event.kind) {
    case "record": {
      const record: ProbeRecord<string> = event.record;
      return record.probeId;
    }
    case "diagnostic": {
      const diagnostic: Diagnostic = event.diagnostic;
      return diagnostic.code;
    }
    case "summary": {
      const summary: ScanSummary<string> = event.summary;
      return summary.durationMs.toString();
    }
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

test("the values array preserves order and index access", () => {
  const second: ProbeValue = {
    name: "background",
    authored: "white",
    resolved: "rgb(255, 255, 255)",
    guard: sampleGuard,
  };
  const record: ValueRecord<string> = {
    ...baseValueRecord,
    values: [sampleProbeValue, second],
  };

  expect(record.values[0]?.name).toBe("color");
  expect(record.values[1]?.name).toBe("background");
  expect(firstValue.name).toBe("color");
});

test("the pseudo field carries a string or null at run time", () => {
  expect(recordWithStringPseudo.pseudo).toBe("::before");
  expect(recordWithNullPseudo.pseudo).toBeNull();
  expect(recordWithUndefinedPseudo.kind).toBe("value");
});

test("the record union discriminates exhaustively on kind", () => {
  expect(describeProbeRecord(baseValueRecord)).toBe("1");
  expect(describeProbeRecord(sampleFunctionRecord)).toBe("padding");
});

test("the scan event union discriminates exhaustively on kind", () => {
  expect(describeScanEvent({ kind: "record", record: baseValueRecord })).toBe("probe-1");
  expect(
    describeScanEvent({
      kind: "diagnostic",
      diagnostic: {
        code: "grouping-construct",
        severity: "info",
        message: "Grouping constructs are not annotation targets.",
        docsUrl: "https://example.com/docs",
      },
    }),
  ).toBe("grouping-construct");
});
