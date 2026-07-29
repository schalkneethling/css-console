/**
 * Browser record aliases.
 *
 * The core records are generic over their target because core cannot
 * reference the DOM. This module supplies the concrete target: the browser
 * layer resolves every record's target to `Element`.
 */

import type {
  FunctionRecord,
  ProbeRecord,
  ScanEvent,
  ScanSummary,
  ValueRecord,
} from "../../core/records/index.ts";

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
