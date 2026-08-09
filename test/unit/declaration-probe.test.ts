import postcss from "postcss";
import { expect, test } from "vite-plus/test";

import { associateAnnotations } from "../../src/core/annotations/index.ts";
import {
  compileDeclarationProbe,
  compileRuleProbeProperties,
} from "../../src/core/compiler/index.ts";
import type { CompiledRuleProbe, DeclarationTarget } from "../../src/core/compiler/index.ts";

import { fixtureUrl, loadFixture } from "../support/fixtures.ts";

/**
 * Declaration probe compilation tests.
 *
 * A declaration probe is a rule probe whose single property is fixed by its
 * position in the source rather than chosen by a property list, which is why
 * the grammar rejects a list on one. It therefore compiles to the same
 * property record a rule probe produces, and the acceptance criterion is
 * exactly that: nothing downstream should have to ask which probe kind a
 * property came from.
 *
 * Compilation is textual. No CSS is evaluated and no value is resolved.
 */

const URL = fixtureUrl("inline");

/**
 * Associates a stylesheet, takes its single declaration probe, and compiles
 * it. Failing loudly when the annotation did not attach keeps a broken
 * fixture from reading as a compilation result.
 */
function compile(css: string): CompiledRuleProbe {
  const root = postcss.parse(css, { from: URL });
  const { annotations } = associateAnnotations(css, { url: URL });
  const target = annotations[0]?.target;

  if (target === undefined || target.kind !== "declaration") {
    throw new Error("expected the fixture to produce one declaration probe");
  }

  return compileDeclarationProbe(root, target as DeclarationTarget);
}

/** Returns the diagnostic codes a compilation produced, in order. */
function codes(result: CompiledRuleProbe): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

test("a declaration probe compiles to exactly one property", () => {
  const result = compile(`.avatar {
  inline-size: calc(50cqi - 1rem); /* css-console: log */
}`);

  expect(result.properties).toHaveLength(1);
  expect(result.properties[0]?.name).toBe("inline-size");
  expect(result.properties[0]?.authored).toBe("calc(50cqi - 1rem)");
  expect(result.diagnostics).toEqual([]);
});

test("the compiled property matches what a rule probe produces for the same declaration", () => {
  // The acceptance criterion: a declaration probe and a single-property rule
  // probe on the same declaration must compile to the same record, so the
  // evaluator, the guard, and the identifier hash never have to ask which
  // probe kind produced a property.
  const declarationProbe = compile(`.card {
  padding: var(--space, 1rem); /* css-console: log */
}`);

  const ruleCss = `/* css-console: log padding */
.card {
  padding: var(--space, 1rem);
}`;
  const ruleRoot = postcss.parse(ruleCss, { from: URL });
  const ruleTarget = associateAnnotations(ruleCss, { url: URL }).annotations[0]?.target;

  if (ruleTarget === undefined || ruleTarget.kind !== "style-rule") {
    throw new Error("expected a style-rule target");
  }

  const ruleProbe = compileRuleProbeProperties(ruleRoot, ruleTarget, ["padding"]);

  // Everything but the location, which differs only because a rule probe's
  // annotation occupies a line of its own and shifts the declaration down.
  // Each record points at its own declaration, which is asserted separately.
  const { source: declarationSource, ...declarationRest } = declarationProbe.properties[0] ?? {};
  const { source: ruleSource, ...ruleRest } = ruleProbe.properties[0] ?? {};

  expect(declarationRest).toEqual(ruleRest);
  expect(declarationSource?.start.line).toBe(2);
  expect(ruleSource?.start.line).toBe(3);
});

test("!important is captured and split from the authored value", () => {
  const result = compile(`.card {
  color: red !important; /* css-console: log */
}`);

  expect(result.properties[0]?.authored).toBe("red");
  expect(result.properties[0]?.important).toBe(true);
});

test("var() references are extracted, including nested and fallback forms", () => {
  const result = compile(`.card {
  margin: var(--m, var(--fallback, 1rem)); /* css-console: log */
}`);

  expect(result.properties[0]?.customProperties).toEqual([
    { name: "--m", fallback: "var(--fallback, 1rem)" },
    { name: "--fallback", fallback: "1rem" },
  ]);
});

test("a custom property declaration compiles", () => {
  const result = compile(`:root {
  --brand: oklch(55% 0.18 250); /* css-console: log */
}`);

  expect(result.properties[0]?.name).toBe("--brand");
  expect(result.properties[0]?.authored).toBe("oklch(55% 0.18 250)");
});

test("the property name is captured exactly as authored", () => {
  const result = compile(`.card {
  -WebKit-Transform: none; /* css-console: log */
}`);

  expect(result.properties[0]?.name).toBe("-WebKit-Transform");
});

test("a declaration inside a nested rule compiles against that rule", () => {
  const result = compile(`.card {
  & .title {
    color: red; /* css-console: log */
  }
}`);

  expect(result.properties[0]?.name).toBe("color");
  expect(result.diagnostics).toEqual([]);
});

test("the annotated declaration is compiled even when a later one wins", () => {
  // The author pointed at this declaration, so this declaration is what the
  // probe reports. That it does not win is a separate fact, and one worth
  // telling them, because the value the browser resolves will not come from
  // the line they annotated.
  const result = compile(`.card {
  color: red; /* css-console: log */
  color: blue;
}`);

  expect(result.properties[0]?.authored).toBe("red");
  expect(codes(result)).toEqual(["REPEATED_DECLARATION"]);
});

test("no diagnostic is reported when the annotated declaration is the winner", () => {
  const result = compile(`.card {
  color: red;
  color: blue; /* css-console: log */
}`);

  expect(result.properties[0]?.authored).toBe("blue");
  expect(result.diagnostics).toEqual([]);
});

test("an important declaration annotated later in the rule still wins", () => {
  const result = compile(`.card {
  color: red !important;
  color: blue; /* css-console: log */
}`);

  // The annotated declaration is reported, and the diagnostic says the
  // resolved value will come from elsewhere.
  expect(result.properties[0]?.authored).toBe("blue");
  expect(codes(result)).toEqual(["REPEATED_DECLARATION"]);
});

test("a declaration whose rule context is outside the supported set is excluded", () => {
  const result = compile(`@keyframes --fade {
  from {
    opacity: 0; /* css-console: log */
  }
}`);

  expect(result.properties).toEqual([]);
  expect(codes(result)).toEqual(["OUTSIDE_SUPPORTED_TARGET_SET"]);
});

test("a declaration inside @scope is excluded", () => {
  const result = compile(`@scope (.card) {
  .title {
    color: red; /* css-console: log */
  }
}`);

  expect(result.properties).toEqual([]);
  expect(codes(result)).toEqual(["OUTSIDE_SUPPORTED_TARGET_SET"]);
});

test("a declaration inside @media compiles, since the condition may hold", () => {
  const result = compile(`@media (min-width: 40rem) {
  .card {
    padding: 2rem; /* css-console: log */
  }
}`);

  expect(result.properties[0]?.name).toBe("padding");
  expect(result.diagnostics).toEqual([]);
});

test("a declaration whose container is an at-rule is reported, not silently dropped", () => {
  // @font-face describes a font rather than styling an element, so there is
  // nothing for a probe to read. An annotation that produced neither a probe
  // nor a diagnostic would tell the author nothing at all.
  const result = compile(`@font-face {
  font-family: Example; /* css-console: log */
}`);

  expect(result.properties).toEqual([]);
  expect(codes(result)).toEqual(["OUTSIDE_SUPPORTED_TARGET_SET"]);
  expect(result.diagnostics[0]?.details).toEqual({ property: "font-family", atRule: "font-face" });
});

test("a custom property registration descriptor is reported the same way", () => {
  const result = compile(`@property --brand {
  syntax: "<color>"; /* css-console: log */
}`);

  expect(result.properties).toEqual([]);
  expect(codes(result)).toEqual(["OUTSIDE_SUPPORTED_TARGET_SET"]);
  expect(result.diagnostics[0]?.details).toEqual({ property: "syntax", atRule: "property" });
});

test("the at-rule declaration fixture reports one diagnostic per annotation", () => {
  const { css, url } = loadFixture("hardening", "at-rule-declarations");
  const root = postcss.parse(css, { from: url });
  const { annotations } = associateAnnotations(css, { url });

  expect(annotations).toHaveLength(3);

  const results = annotations.map((associated) =>
    compileDeclarationProbe(root, associated.target as DeclarationTarget),
  );

  expect(results.flatMap((result) => result.properties)).toEqual([]);
  expect(results.flatMap((result) => result.diagnostics.map((d) => d.code))).toEqual([
    "OUTSIDE_SUPPORTED_TARGET_SET",
    "OUTSIDE_SUPPORTED_TARGET_SET",
    "OUTSIDE_SUPPORTED_TARGET_SET",
  ]);
  expect(results.flatMap((result) => result.diagnostics.map((d) => d.details?.["atRule"]))).toEqual(
    ["font-face", "property", "page"],
  );
});

test("a target from a different tree fails loudly rather than compiling nothing", () => {
  const css = `.card {
  color: red; /* css-console: log */
}`;
  const target = associateAnnotations(css, { url: URL }).annotations[0]?.target;

  if (target === undefined || target.kind !== "declaration") {
    throw new Error("expected a declaration target");
  }

  const otherTree = postcss.parse(`.unrelated { color: blue }`, { from: URL });

  expect(() => compileDeclarationProbe(otherTree, target)).toThrow(/color/);
});
