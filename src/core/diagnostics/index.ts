/**
 * Diagnostic registry.
 *
 * This module houses the diagnostic code registry: the single source of
 * truth for every condition css-console reports. The registry pairs each
 * code with the severity, category, meaning, and documentation anchor that
 * `createDiagnostic()` reads from, so a code cannot ship without
 * documentation and without a distinguishable category. The three-way scope
 * split, recorded in docs/decisions/0008-three-way-scope-split.md, and the
 * three-tier at-rule target model, recorded in
 * docs/decisions/0009-three-tier-at-rule-target-model.md, both depend on the
 * categories staying distinguishable: a browser gap, a postponed feature,
 * and a by-design rejection never share one diagnostic.
 */

import type { Diagnostic, SourceLocation } from "../records/index.ts";

export type { Diagnostic } from "../records/index.ts";

/**
 * The base of every diagnostic documentation URL. Each registry entry's
 * `docsUrl` is this base plus the code lowercased, following the GitHub
 * heading-anchor convention, so the anchor is derived from the code rather
 * than authored per code.
 */
const DOCS_BASE = "https://github.com/schalkneethling/css-console/blob/main/docs/diagnostics.md#";

/**
 * The severity a diagnostic carries. This is exactly the severity union the
 * published `Diagnostic` contract declares, so a registry entry can never
 * drift from the shape consumers already receive.
 */
export type DiagnosticSeverity = "info" | "warning" | "error";

/**
 * The category a diagnostic belongs to. `reserved-pending-support` names a
 * browser gap: the specification exists but the current user agent does not
 * yet implement it. `deferred` names a feature the project postponed by
 * choice. `not-a-target` names a construct css-console rejects by design,
 * such as a grouping at-rule. `annotation` names a grammar or placement
 * rejection in the annotation comment itself. `source` names a failure while
 * discovering or loading a source. `informational` names a condition that is
 * neither an error nor a warning, reported because it answers a debugging
 * question.
 */
export type DiagnosticCategory =
  | "reserved-pending-support"
  | "deferred"
  | "not-a-target"
  | "annotation"
  | "source"
  | "informational";

/**
 * The registry entry for one diagnostic code: the severity and category the
 * condition carries, the meaning that becomes the default message, and the
 * documentation URL that explains the condition in full.
 */
export type DiagnosticDefinition = {
  severity: DiagnosticSeverity;
  category: DiagnosticCategory;
  meaning: string;
  docsUrl: string;
};

/**
 * Builds a registry entry, deriving `docsUrl` from the code so that the two
 * cannot drift apart.
 */
function defineDiagnostic(
  code: string,
  severity: DiagnosticSeverity,
  category: DiagnosticCategory,
  meaning: string,
): DiagnosticDefinition {
  return { severity, category, meaning, docsUrl: DOCS_BASE + code.toLowerCase() };
}

/**
 * The diagnostic registry: the single source of truth for every condition
 * css-console reports. `createDiagnostic()` reads a code's severity,
 * category, and default message from this table, and docs/diagnostics.md
 * documents exactly these codes, in both directions, so a code cannot ship
 * without documentation.
 */
export const DIAGNOSTIC_REGISTRY = {
  RESERVED_PENDING_SUPPORT: defineDiagnostic(
    "RESERVED_PENDING_SUPPORT",
    "warning",
    "reserved-pending-support",
    "The specification for this construct exists and css-console designed its contract, but the current browser does not yet support it. No record is produced for this annotation until the browser ships support.",
  ),
  NOT_A_TARGET: defineDiagnostic(
    "NOT_A_TARGET",
    "warning",
    "not-a-target",
    "This annotation precedes a grouping construct such as @media, @supports, or @layer, which is not an annotation target. Annotate the rules inside the grouping construct instead.",
  ),
  OUTSIDE_SUPPORTED_TARGET_SET: defineDiagnostic(
    "OUTSIDE_SUPPORTED_TARGET_SET",
    "warning",
    "deferred",
    "This annotation precedes an at-rule outside the set css-console supports as an annotation target. This is a tool-scope limitation rather than a browser gap.",
  ),
  WATCH_RESERVED: defineDiagnostic(
    "WATCH_RESERVED",
    "warning",
    "deferred",
    "The watch log level is reserved until live mode ships and is not evaluated in this release. Use log, info, warn, or error instead.",
  ),
  SOURCE_LOAD_FAILED: defineDiagnostic(
    "SOURCE_LOAD_FAILED",
    "error",
    "source",
    "A linked source failed to load. Likely causes include a cross-origin request without CORS access, a Content Security Policy restriction, or a network failure; a blocked fetch cannot be attributed to one of these causes with certainty.",
  ),
  SOURCE_HTTP_ERROR: defineDiagnostic(
    "SOURCE_HTTP_ERROR",
    "error",
    "source",
    "A linked source responded with an HTTP error status. Check that the URL is correct and that the resource is reachable with that status in mind.",
  ),
  NO_TARGET: defineDiagnostic(
    "NO_TARGET",
    "warning",
    "annotation",
    "This annotation has nothing to attach to. Place it immediately before a style rule or an @function at-rule, or as a trailing comment after a declaration.",
  ),
  UNKNOWN_LOG_LEVEL: defineDiagnostic(
    "UNKNOWN_LOG_LEVEL",
    "error",
    "annotation",
    "This annotation names a log level outside the valid set log, info, warn, and error. Use one of those four log levels.",
  ),
  MISSING_LOG_LEVEL: defineDiagnostic(
    "MISSING_LOG_LEVEL",
    "error",
    "annotation",
    "This annotation names no log level. The log level is required and must be one of log, info, warn, and error.",
  ),
  UNKNOWN_OPTION: defineDiagnostic(
    "UNKNOWN_OPTION",
    "error",
    "annotation",
    "This annotation names an option the grammar does not define. The valid options are a property list and label.",
  ),
  DUPLICATE_OPTION: defineDiagnostic(
    "DUPLICATE_OPTION",
    "error",
    "annotation",
    "This annotation names the same option twice. Each option may appear at most once, so the intended value cannot be determined.",
  ),
  PROPERTY_LIST_ON_DECLARATION_PROBE: defineDiagnostic(
    "PROPERTY_LIST_ON_DECLARATION_PROBE",
    "error",
    "annotation",
    "A property list on a declaration probe is ambiguous, because a declaration probe already names its one property through its position. Remove the property list.",
  ),
  PROPERTY_LIST_ON_FUNCTION_PROBE: defineDiagnostic(
    "PROPERTY_LIST_ON_FUNCTION_PROBE",
    "error",
    "annotation",
    "A property list on a function probe is rejected, because the call sites determine the properties rather than the annotation. Remove the property list.",
  ),
  NO_CALL_SITES: defineDiagnostic(
    "NO_CALL_SITES",
    "info",
    "informational",
    "The annotated function has no call sites in the scanned sources. This is reported because it is itself a useful debugging answer, not because it is an error.",
  ),
  MISSING_REQUESTED_PROPERTY: defineDiagnostic(
    "MISSING_REQUESTED_PROPERTY",
    "warning",
    "annotation",
    "A rule probe's property list names a property the rule does not declare. The remaining requested properties still compile, so this is a warning rather than an error.",
  ),
  REPEATED_DECLARATION: defineDiagnostic(
    "REPEATED_DECLARATION",
    "info",
    "informational",
    "A property covered by a rule probe is declared more than once in the rule. The last authored value is reported, matching how the cascade resolves repeats within one rule.",
  ),
} as const;

/**
 * The union of every code the diagnostic registry defines. Passing a string
 * outside this union to `createDiagnostic()` is a compile-time error.
 */
export type DiagnosticCode = keyof typeof DIAGNOSTIC_REGISTRY;

/**
 * The optional overrides `createDiagnostic()` accepts. `message` replaces the
 * registry's default meaning. `source` and `details` are carried through only
 * when provided, matching the optional fields on the published `Diagnostic`
 * contract.
 */
export type CreateDiagnosticOptions = {
  message?: string;
  source?: SourceLocation;
  details?: Record<string, unknown>;
};

/**
 * Builds a `Diagnostic` from a registry code. The code, severity, and
 * `docsUrl` always come from the registry entry. `message` defaults to the
 * registry entry's meaning and can be overridden for a tailored occurrence.
 * `source` and `details` are included only when the caller supplies them, so
 * a diagnostic with no source location carries no `source` field at all.
 */
export function createDiagnostic(
  code: DiagnosticCode,
  options: CreateDiagnosticOptions = {},
): Diagnostic {
  const definition = DIAGNOSTIC_REGISTRY[code];
  const diagnostic: Diagnostic = {
    code,
    severity: definition.severity,
    message: options.message ?? definition.meaning,
    docsUrl: definition.docsUrl,
  };

  if (options.source !== undefined) {
    diagnostic.source = options.source;
  }

  if (options.details !== undefined) {
    diagnostic.details = options.details;
  }

  return diagnostic;
}
