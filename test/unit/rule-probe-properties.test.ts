import postcss from "postcss";
import { expect, test } from "vite-plus/test";

import { associateAnnotations } from "../../src/core/annotations/index.ts";
import type { StyleRuleTarget } from "../../src/core/compiler/index.ts";
import { compileRuleProbeProperties } from "../../src/core/compiler/index.ts";
import type { CompiledRuleProbe } from "../../src/core/compiler/index.ts";

import { fixtureUrl, loadFixture } from "../support/fixtures.ts";

/**
 * Rule probe compilation tests.
 *
 * CSSC-008 turns a style-rule target and its requested property list into
 * the declarations a later evaluation phase reads. This is compilation only:
 * no CSS is evaluated, no selector is matched, and no value is resolved.
 * These tests assert the compiled shape and the diagnostic codes compilation
 * produces, never message text, following the project's test strategy.
 */

const FIXTURE_URL = fixtureUrl("inline");

/**
 * Associates the first annotation in `css` and compiles its rule probe,
 * failing loudly when the css does not produce exactly one style-rule
 * annotation, so a malformed fixture cannot pass a test by accident.
 */
function compile(css: string): CompiledRuleProbe {
  const { annotations } = associateAnnotations(css, { url: FIXTURE_URL });

  expect(annotations).toHaveLength(1);

  const target = annotations[0]?.target;

  if (target === undefined || target.kind !== "style-rule") {
    throw new Error("expected a style-rule target");
  }

  const root = postcss.parse(css, { from: FIXTURE_URL });

  return compileRuleProbeProperties(
    root,
    target as StyleRuleTarget,
    annotations[0].annotation.properties,
  );
}

/** Returns the diagnostic codes a result carries, in order. */
function codes(result: CompiledRuleProbe): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

/** Returns the compiled property names, in compiled order. */
function names(result: CompiledRuleProbe): string[] {
  return result.properties.map((property) => property.name);
}

test("no property list selects the declarations authored directly in the rule", () => {
  const result = compile(`/* css-console: log */
.card {
  padding: 1rem;
  color: red;
}`);

  expect(names(result)).toEqual(["padding", "color"]);
  expect(result.diagnostics).toEqual([]);
});

test("no property list excludes declarations from a nested rule", () => {
  const result = compile(`/* css-console: log */
.card {
  padding: 1rem;

  & .title {
    color: red;
  }
}`);

  expect(names(result)).toEqual(["padding"]);
});

test("an explicit list preserves the requested order, not source order", () => {
  const result = compile(`/* css-console: log color,padding */
.card {
  padding: 1rem;
  color: red;
}`);

  expect(names(result)).toEqual(["color", "padding"]);
});

test("a requested property the rule does not declare reports MISSING_REQUESTED_PROPERTY", () => {
  const result = compile(`/* css-console: log padding,color */
.card {
  padding: 1rem;
}`);

  expect(names(result)).toEqual(["padding"]);
  expect(codes(result)).toEqual(["MISSING_REQUESTED_PROPERTY"]);
  expect(result.diagnostics[0]?.details).toEqual({ property: "color" });
});

test("a missing requested property does not discard the other requested properties", () => {
  const result = compile(`/* css-console: log padding,color,margin */
.card {
  padding: 1rem;
  margin: 2rem;
}`);

  expect(names(result)).toEqual(["padding", "margin"]);
  expect(codes(result)).toEqual(["MISSING_REQUESTED_PROPERTY"]);
});

test("a repeated declaration uses the last authored value and reports REPEATED_DECLARATION", () => {
  const result = compile(`/* css-console: log color */
.card {
  color: red;
  color: blue;
}`);

  expect(result.properties).toHaveLength(1);
  expect(result.properties[0]?.authored).toBe("blue");
  expect(codes(result)).toEqual(["REPEATED_DECLARATION"]);
  expect(result.diagnostics[0]?.details).toEqual({ property: "color", count: 2 });
});

test("a property declared once produces no REPEATED_DECLARATION diagnostic", () => {
  const result = compile(`/* css-console: log color */
.card {
  color: red;
}`);

  expect(result.diagnostics).toEqual([]);
});

test("a vendor-prefixed property retains its exact name", () => {
  const result = compile(`/* css-console: log */
.card {
  -webkit-transform: scale(1);
}`);

  expect(names(result)).toEqual(["-webkit-transform"]);
});

test("a custom property retains its exact name", () => {
  const result = compile(`/* css-console: log */
.card {
  --Brand-Color: oklch(55% 0.18 250);
}`);

  expect(names(result)).toEqual(["--Brand-Color"]);
});

test("an authored property name is not case-normalised", () => {
  const result = compile(`/* css-console: log */
.card {
  COLOR: red;
}`);

  expect(names(result)).toEqual(["COLOR"]);
});

test("a requested standard property matches its declaration regardless of case", () => {
  // Standard CSS property names are ASCII case-insensitive: COLOR: red applies
  // and computes in a real browser exactly as color: red would. The compiled
  // name still carries the declaration's own spelling, never the request's.
  const result = compile(`/* css-console: log color */
.card {
  COLOR: red;
}`);

  expect(names(result)).toEqual(["COLOR"]);
  expect(result.diagnostics).toEqual([]);
});

test("two custom properties differing only in case stay distinct", () => {
  // Unlike standard properties, custom property names are case-sensitive:
  // --Custom and --custom name two different properties in a real browser,
  // each holding its own value, so neither may fold into the other here.
  const result = compile(`/* css-console: log --Custom,--custom */
.card {
  --Custom: authored;
  --custom: other;
}`);

  expect(names(result)).toEqual(["--Custom", "--custom"]);
  expect(result.properties.map((property) => property.authored)).toEqual(["authored", "other"]);
  expect(result.diagnostics).toEqual([]);
});

test("!important is captured on the compiled property", () => {
  const result = compile(`/* css-console: log */
.card {
  padding: 1rem !important;
  color: red;
}`);

  expect(result.properties.map((property) => property.important)).toEqual([true, false]);
  expect(result.properties[0]?.authored).toBe("1rem");
});

test("a var() reference is extracted with no fallback", () => {
  const result = compile(`/* css-console: log */
.card {
  color: var(--brand);
}`);

  expect(result.properties[0]?.customProperties).toEqual([{ name: "--brand", fallback: null }]);
});

test("a var() reference is extracted with its fallback", () => {
  const result = compile(`/* css-console: log */
.card {
  color: var(--brand, red);
}`);

  expect(result.properties[0]?.customProperties).toEqual([{ name: "--brand", fallback: "red" }]);
});

test("nested var() references are each extracted, including their own fallbacks", () => {
  const result = compile(`/* css-console: log */
.card {
  color: var(--brand, var(--fallback, red));
}`);

  expect(result.properties[0]?.customProperties).toEqual([
    { name: "--brand", fallback: "var(--fallback, red)" },
    { name: "--fallback", fallback: "red" },
  ]);
});

test("a fallback with a nested function call keeps its inner comma out of the split", () => {
  const result = compile(`/* css-console: log */
.card {
  background-color: var(--surface, color-mix(in oklch, white 60%, black));
}`);

  expect(result.properties[0]?.customProperties).toEqual([
    { name: "--surface", fallback: "color-mix(in oklch, white 60%, black)" },
  ]);
});

test("a declaration with no var() reference reports an empty list", () => {
  const result = compile(`/* css-console: log */
.card {
  padding: 1rem;
}`);

  expect(result.properties[0]?.customProperties).toEqual([]);
});

test("multiple var() references in one value are each extracted", () => {
  const result = compile(`/* css-console: log */
.card {
  margin: var(--top) var(--right, 1px);
}`);

  expect(result.properties[0]?.customProperties).toEqual([
    { name: "--top", fallback: null },
    { name: "--right", fallback: "1px" },
  ]);
});

test("a dashed function whose name ends in var is not read as a var() reference", () => {
  // --space-var(2) is a custom function call, the construct this project
  // exists to probe, not a var() reference. The substring "var(" appears
  // inside it, which is exactly the false positive to guard against.
  const result = compile(`/* css-console: log */
.card {
  padding: --space-var(2);
}`);

  expect(result.properties[0]?.customProperties).toEqual([]);
});

test("a var( written inside a quoted string is not read as a reference", () => {
  const result = compile(`/* css-console: log */
.card {
  content: "var(--not-real)";
}`);

  expect(result.properties[0]?.customProperties).toEqual([]);
});

test("compileRuleProbeProperties throws when the target does not match the parsed tree", () => {
  // No CSS an author writes can produce this: it means the target and the
  // tree came from different parses, a programming error the function must
  // surface loudly rather than answer with an empty, legitimate-looking probe.
  const { annotations } = associateAnnotations(
    `/* css-console: log */
.card {
  padding: 1rem;
}`,
    { url: FIXTURE_URL },
  );

  const target = annotations[0]?.target;

  if (target === undefined || target.kind !== "style-rule") {
    throw new Error("expected a style-rule target");
  }

  const unrelatedRoot = postcss.parse(".other { color: red; }", { from: FIXTURE_URL });

  expect(() => compileRuleProbeProperties(unrelatedRoot, target as StyleRuleTarget, [])).toThrow();
});

test("the hardening fixture exercises the full property-list red-case set in one rule", () => {
  const { css, url } = loadFixture("hardening", "rule-probe-properties");
  const { annotations } = associateAnnotations(css, { url });

  expect(annotations).toHaveLength(1);

  const target = annotations[0]?.target;

  if (target === undefined || target.kind !== "style-rule") {
    throw new Error("expected a style-rule target");
  }

  const root = postcss.parse(css, { from: url });
  const result = compileRuleProbeProperties(
    root,
    target as StyleRuleTarget,
    annotations[0].annotation.properties,
  );

  expect(names(result)).toEqual(["color", "padding", "--brand", "-webkit-transform"]);
  expect(codes(result)).toEqual(["REPEATED_DECLARATION", "MISSING_REQUESTED_PROPERTY"]);

  const colorProperty = result.properties.find((property) => property.name === "color");

  expect(colorProperty?.authored).toBe("var(--brand, var(--fallback, 2px solid black))");
  expect(colorProperty?.customProperties).toEqual([
    { name: "--brand", fallback: "var(--fallback, 2px solid black)" },
    { name: "--fallback", fallback: "2px solid black" },
  ]);

  const paddingProperty = result.properties.find((property) => property.name === "padding");

  expect(paddingProperty?.important).toBe(true);
});
