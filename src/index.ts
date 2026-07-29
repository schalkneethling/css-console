/**
 * Public entry point for CSS Console.
 *
 * This module exposes the public type contracts defined for CSSC-003: the
 * core record and event shapes, the diagnostic shape, and the browser
 * aliases that resolve those shapes to a live `Element` target. The runtime
 * that constructs these values, including `createCSSConsole()`, lands in
 * later issues. The package exposes one public entry point; internal
 * directories are reached through relative imports, never through published
 * subpath exports.
 */

export const PACKAGE_NAME = "@schalkneethling/css-console";

export type {
  CallSite,
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
} from "./core/records/index.ts";

export type { Diagnostic } from "./core/diagnostics/index.ts";

export type {
  BrowserFunctionRecord,
  BrowserProbeRecord,
  BrowserScanEvent,
  BrowserScanSummary,
  BrowserValueRecord,
} from "./browser/records/index.ts";
