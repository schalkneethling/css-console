import { expect, test } from "vite-plus/test";

import type {
  FunctionRecord,
  ProbeRecord,
  ScanEvent,
  ScanSummary,
  ValueRecord,
} from "../../src/core/records/index.ts";
import type {
  BrowserFunctionRecord,
  BrowserProbeRecord,
  BrowserScanEvent,
  BrowserScanSummary,
  BrowserValueRecord,
} from "@schalkneethling/css-console";

import type { Equal, Expect, Extends } from "./type-level.ts";

/**
 * Browser record alias tests.
 *
 * This suite proves that the browser layer resolves the generic target to the
 * DOM Element type. Each browser alias is the matching core record with
 * Element supplied as the target, so the target field is Element and a core
 * record over Element is assignable to the browser alias. The assertions are
 * checked by the compiler through tsconfig.test.json, which supplies the DOM
 * library. A small run-time test keeps the file from being empty at run time.
 */

/**
 * The alias assertions gather into one exported tuple, which the unused-local
 * check does not flag. Every element resolves to true only when the browser
 * alias resolves its target to Element.
 */
export type BrowserAliasAssertions = [
  // The browser value record resolves the target to Element.
  Expect<Equal<BrowserValueRecord["target"], Element>>,

  // The browser value record is exactly the core record over Element.
  Expect<Equal<BrowserValueRecord, ValueRecord<Element>>>,

  // A core value record over Element is assignable to the browser alias.
  Expect<Extends<ValueRecord<Element>, BrowserValueRecord>>,

  // The remaining browser aliases resolve their target to Element as well.
  Expect<Equal<BrowserFunctionRecord["target"], Element>>,
  Expect<Equal<BrowserFunctionRecord, FunctionRecord<Element>>>,
  Expect<Equal<BrowserProbeRecord, ProbeRecord<Element>>>,
  Expect<Equal<BrowserScanSummary, ScanSummary<Element>>>,
  Expect<Equal<BrowserScanEvent, ScanEvent<Element>>>,
];

test("the browser aliases name the same shapes as the core records over Element", () => {
  const isAliasContract = true;
  expect(isAliasContract).toBe(true);
});
