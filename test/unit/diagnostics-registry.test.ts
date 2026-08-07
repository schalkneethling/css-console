import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "vite-plus/test";

import { createDiagnostic, DIAGNOSTIC_REGISTRY } from "../../src/core/diagnostics/index.ts";
import type {
  Diagnostic,
  DiagnosticCategory,
  DiagnosticCode,
  DiagnosticDefinition,
  DiagnosticSeverity,
} from "../../src/core/diagnostics/index.ts";

import type { Equal, Expect } from "./type-level.ts";

/**
 * Diagnostic registry contract tests.
 *
 * This suite proves that the diagnostic registry is the single source of
 * truth for every condition css-console reports. It checks three things the
 * three-way scope split and the three-tier at-rule target model depend on.
 * First, every registry entry carries a severity drawn from the published
 * Diagnostic contract, a non-empty meaning, and a documentation URL whose
 * anchor is derived from the code rather than authored per code, so a code
 * cannot ship without documentation. Second, the documentation file resolves
 * every anchor and names no code the registry does not define, in both
 * directions. Third, the reserved-pending-support, deferred, and not-a-target
 * categories stay distinguishable, which is the checkpoint criterion that a
 * browser gap, a postponed feature, and a by-design rejection never share one
 * diagnostic. The suite asserts exact codes and never snapshots a full
 * message, following the test strategy. Type-level assertions are checked by
 * the compiler through tsconfig.test.json.
 */

/**
 * The base of every diagnostic documentation URL. GitHub derives a heading
 * anchor by lowercasing the heading text and keeping underscores, so the
 * anchor for a code is the code lowercased. The tests derive the expected URL
 * from each code with this base rather than listing a URL per code.
 */
const DOCS_BASE = "https://github.com/schalkneethling/css-console/blob/main/docs/diagnostics.md#";

/**
 * The dictated severity and category for every registry code. The registry
 * must define exactly these codes, so the suite compares the two key sets in
 * both directions and checks each entry against this table.
 */
const EXPECTED_DEFINITIONS = {
  RESERVED_PENDING_SUPPORT: { severity: "warning", category: "reserved-pending-support" },
  NOT_A_TARGET: { severity: "warning", category: "not-a-target" },
  OUTSIDE_SUPPORTED_TARGET_SET: { severity: "warning", category: "deferred" },
  WATCH_RESERVED: { severity: "warning", category: "deferred" },
  SOURCE_LOAD_FAILED: { severity: "error", category: "source" },
  SOURCE_HTTP_ERROR: { severity: "error", category: "source" },
  NO_TARGET: { severity: "warning", category: "annotation" },
  UNKNOWN_LOG_LEVEL: { severity: "error", category: "annotation" },
  MISSING_LOG_LEVEL: { severity: "error", category: "annotation" },
  UNKNOWN_OPTION: { severity: "error", category: "annotation" },
  DUPLICATE_OPTION: { severity: "error", category: "annotation" },
  PROPERTY_LIST_ON_DECLARATION_PROBE: { severity: "error", category: "annotation" },
  PROPERTY_LIST_ON_FUNCTION_PROBE: { severity: "error", category: "annotation" },
  NO_CALL_SITES: { severity: "info", category: "informational" },
  MISSING_REQUESTED_PROPERTY: { severity: "warning", category: "annotation" },
  REPEATED_DECLARATION: { severity: "info", category: "informational" },
  DEFERRED_PSEUDO_ELEMENT: { severity: "warning", category: "deferred" },
  MALFORMED_SELECTOR_LIST: { severity: "error", category: "annotation" },
} as const;

const EXPECTED_CODES = Object.keys(EXPECTED_DEFINITIONS).sort();
const REGISTRY_CODES = Object.keys(DIAGNOSTIC_REGISTRY).sort();

const VALID_SEVERITIES = new Set<DiagnosticSeverity>(["info", "warning", "error"]);

test("the registry defines exactly the dictated set of codes", () => {
  expect(REGISTRY_CODES).toEqual(EXPECTED_CODES);
});

test("every registry entry carries a valid severity, a non-empty meaning, and the anchor URL", () => {
  for (const code of REGISTRY_CODES) {
    const definition = DIAGNOSTIC_REGISTRY[code as DiagnosticCode];

    expect(VALID_SEVERITIES.has(definition.severity), code).toBe(true);
    expect(typeof definition.meaning, code).toBe("string");
    expect(definition.meaning.trim().length, code).toBeGreaterThan(0);
    expect(definition.docsUrl, code).toBe(DOCS_BASE + code.toLowerCase());
  }
});

test("every registry entry carries the dictated severity and category", () => {
  for (const [code, expected] of Object.entries(EXPECTED_DEFINITIONS)) {
    const definition = DIAGNOSTIC_REGISTRY[code as DiagnosticCode];

    expect(definition.severity, code).toBe(expected.severity);
    expect(definition.category, code).toBe(expected.category);
  }
});

/**
 * Reads the diagnostic documentation and returns every code-shaped level-three
 * heading. A code is uppercase letters and underscores, so a heading that does
 * not match that shape is not treated as a code and cannot make the set
 * comparison pass by accident.
 */
function readDocumentedCodes(): string[] {
  const path = resolve(import.meta.dirname, "../../docs/diagnostics.md");
  const contents = readFileSync(path, "utf8");
  const documented: string[] = [];

  for (const line of contents.split("\n")) {
    const match = /^## ([A-Z_]+)$/.exec(line.trim());

    if (match) {
      documented.push(match[1]);
    }
  }

  return documented.sort();
}

test("the documentation names exactly the registry codes, in both directions", () => {
  expect(readDocumentedCodes()).toEqual(REGISTRY_CODES);
});

test("the reserved, deferred, and not-a-target categories are non-empty and disjoint", () => {
  const byCategory = new Map<DiagnosticCategory, Set<string>>();

  for (const code of REGISTRY_CODES) {
    const { category } = DIAGNOSTIC_REGISTRY[code as DiagnosticCode];
    const group = byCategory.get(category) ?? new Set<string>();

    group.add(code);
    byCategory.set(category, group);
  }

  const reserved = byCategory.get("reserved-pending-support") ?? new Set<string>();
  const deferred = byCategory.get("deferred") ?? new Set<string>();
  const notATarget = byCategory.get("not-a-target") ?? new Set<string>();

  expect(reserved.size).toBeGreaterThan(0);
  expect(deferred.size).toBeGreaterThan(0);
  expect(notATarget.size).toBeGreaterThan(0);

  const groups = [reserved, deferred, notATarget];

  for (const [first, group] of groups.entries()) {
    for (const [second, other] of groups.entries()) {
      if (first === second) {
        continue;
      }

      for (const code of group) {
        expect(other.has(code), code).toBe(false);
      }
    }
  }
});

test("the plan-named codes sit in their dictated distinguishing categories", () => {
  expect(DIAGNOSTIC_REGISTRY.RESERVED_PENDING_SUPPORT.category).toBe("reserved-pending-support");
  expect(DIAGNOSTIC_REGISTRY.NOT_A_TARGET.category).toBe("not-a-target");
  expect(DIAGNOSTIC_REGISTRY.OUTSIDE_SUPPORTED_TARGET_SET.category).toBe("deferred");
  expect(DIAGNOSTIC_REGISTRY.WATCH_RESERVED.category).toBe("deferred");
});

test("createDiagnostic sources code, severity, docsUrl, and default message from the registry", () => {
  for (const code of REGISTRY_CODES) {
    const definition = DIAGNOSTIC_REGISTRY[code as DiagnosticCode];
    const diagnostic = createDiagnostic(code as DiagnosticCode);

    expect(diagnostic.code, code).toBe(code);
    expect(diagnostic.severity, code).toBe(definition.severity);
    expect(diagnostic.docsUrl, code).toBe(definition.docsUrl);
    expect(diagnostic.message, code).toBe(definition.meaning);
    expect(diagnostic.source, code).toBeUndefined();
    expect(diagnostic.details, code).toBeUndefined();
  }
});

test("createDiagnostic overrides the message and passes source and details through", () => {
  const source = {
    url: "https://fixtures.css-console.invalid/example.css",
    start: { line: 2, column: 4 },
    end: { line: 2, column: 20 },
  };
  const details = { atRule: "@media" };

  const diagnostic = createDiagnostic("OUTSIDE_SUPPORTED_TARGET_SET", {
    message: "A tailored message for this occurrence.",
    source,
    details,
  });

  expect(diagnostic.code).toBe("OUTSIDE_SUPPORTED_TARGET_SET");
  expect(diagnostic.severity).toBe(DIAGNOSTIC_REGISTRY.OUTSIDE_SUPPORTED_TARGET_SET.severity);
  expect(diagnostic.docsUrl).toBe(DIAGNOSTIC_REGISTRY.OUTSIDE_SUPPORTED_TARGET_SET.docsUrl);
  expect(diagnostic.message).toBe("A tailored message for this occurrence.");
  expect(diagnostic.source).toEqual(source);
  expect(diagnostic.details).toEqual(details);
});

test("createDiagnostic is deterministic for the same input", () => {
  const first = createDiagnostic("NO_CALL_SITES");
  const second = createDiagnostic("NO_CALL_SITES");

  expect(first).toEqual(second);

  const source = {
    url: "https://fixtures.css-console.invalid/example.css",
    start: { line: 1, column: 1 },
    end: { line: 1, column: 1 },
  };

  expect(createDiagnostic("SOURCE_LOAD_FAILED", { source })).toEqual(
    createDiagnostic("SOURCE_LOAD_FAILED", { source }),
  );
});

/**
 * The type-level assertions gather into one exported tuple so a single name
 * carries them all and the unused-local check does not flag them. Every element
 * resolves to true only when the contract holds.
 */
export type RegistryTypeAssertions = [
  // The severity alias is exactly the published Diagnostic severity union.
  Expect<Equal<DiagnosticSeverity, "info" | "warning" | "error">>,

  // The category alias is the dictated closed union.
  Expect<
    Equal<
      DiagnosticCategory,
      | "reserved-pending-support"
      | "deferred"
      | "not-a-target"
      | "annotation"
      | "source"
      | "informational"
    >
  >,

  // The definition shape carries a severity, category, meaning, and docsUrl.
  Expect<
    Equal<
      DiagnosticDefinition,
      {
        severity: DiagnosticSeverity;
        category: DiagnosticCategory;
        meaning: string;
        docsUrl: string;
      }
    >
  >,

  // The code type is exactly the union of the dictated code names.
  Expect<
    Equal<
      DiagnosticCode,
      | "RESERVED_PENDING_SUPPORT"
      | "NOT_A_TARGET"
      | "OUTSIDE_SUPPORTED_TARGET_SET"
      | "WATCH_RESERVED"
      | "SOURCE_LOAD_FAILED"
      | "SOURCE_HTTP_ERROR"
      | "NO_TARGET"
      | "UNKNOWN_LOG_LEVEL"
      | "MISSING_LOG_LEVEL"
      | "UNKNOWN_OPTION"
      | "DUPLICATE_OPTION"
      | "PROPERTY_LIST_ON_DECLARATION_PROBE"
      | "PROPERTY_LIST_ON_FUNCTION_PROBE"
      | "NO_CALL_SITES"
      | "MISSING_REQUESTED_PROPERTY"
      | "REPEATED_DECLARATION"
      | "DEFERRED_PSEUDO_ELEMENT"
      | "MALFORMED_SELECTOR_LIST"
    >
  >,

  // createDiagnostic returns a value that is exactly the published Diagnostic.
  Expect<Equal<ReturnType<typeof createDiagnostic>, Diagnostic>>,
];

// An unknown code is not a member of the registry, so createDiagnostic rejects
// it at the type level. The function wrapper is never invoked, so the rejected
// call is checked by the compiler without executing at module load, and the
// export keeps the unused-local check from flagging the binding.
export const rejectedUnknownCode = (): Diagnostic =>
  // @ts-expect-error an unknown code is not assignable to the code parameter
  createDiagnostic("NOT_A_REAL_CODE");
