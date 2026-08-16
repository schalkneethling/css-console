import postcss from "postcss";
import type { Declaration, Rule } from "postcss";
import { expect, test } from "vite-plus/test";

import { compileDeclarationContext, compileRuleContext } from "../../src/core/compiler/index.ts";
import type { RuleContextResolution } from "../../src/core/compiler/index.ts";
import { resolveNestedSelector } from "../../src/core/nesting/index.ts";

import { fixtureUrl } from "../support/fixtures.ts";

/**
 * Rule-context compilation tests (CSSC-011).
 *
 * This suite compiles the stack of at-rules enclosing a style rule: the
 * conditions that may or may not hold at evaluation time, the cascade
 * metadata that never blocks a probe, and the constructs this release cannot
 * honestly probe through at all. No condition is evaluated here; that is
 * CSSC-017. These tests assert the compiled context shape and diagnostic
 * codes, never message text, following the project's test strategy.
 *
 * The at-rule name and params behavior asserted here, case preservation and
 * case-insensitive matching in particular, was checked against
 * node_modules/postcss at the pinned version rather than recalled: parsing
 * `@MEDIA (MIN-WIDTH: 10PX) { .e {} }` reports `name: "MEDIA"` and
 * `params: "(MIN-WIDTH: 10PX)"`, both preserved verbatim. The browser
 * behavior for a style rule inside `@function` was checked in Chromium:
 * parsing `@function --f() returns <color> { .inner { color: red; } result:
 * blue; }` and reading the rule back from the CSSOM shows `.inner` dropped
 * entirely, which is why that case produces a diagnostic rather than a
 * silently compiled context.
 */

const URL = fixtureUrl("inline");

/** Finds the rule at the given index, in document order, failing loudly if absent. */
function ruleAt(css: string, index: number): Rule {
  const rules: Rule[] = [];

  postcss.parse(css, { from: URL }).walkRules((rule) => {
    rules.push(rule);
  });

  const rule = rules[index];

  if (rule === undefined) {
    throw new Error(`the source has no rule at index ${index}: ${css}`);
  }

  return rule;
}

/** Compiles the context of the rule at the given index in one source. */
function contextOf(css: string, index = 0): RuleContextResolution {
  return compileRuleContext(ruleAt(css, index), URL);
}

/** Finds the declaration at the given index, in document order, failing loudly if absent. */
function declarationAt(css: string, index: number): Declaration {
  const declarations: Declaration[] = [];

  postcss.parse(css, { from: URL }).walkDecls((declaration) => {
    declarations.push(declaration);
  });

  const declaration = declarations[index];

  if (declaration === undefined) {
    throw new Error(`the source has no declaration at index ${index}: ${css}`);
  }

  return declaration;
}

/** Compiles the context of the declaration at the given index in one source. */
function declarationContextOf(css: string, index = 0): RuleContextResolution {
  return compileDeclarationContext(declarationAt(css, index), URL);
}

/** Returns the diagnostic codes a resolution carries, in order. */
function codes(result: RuleContextResolution): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

test("a top-level rule compiles an empty context with no diagnostics", () => {
  const result = contextOf(".card { color: red; }");

  expect(result).toEqual({ context: { entries: [] }, diagnostics: [] });
});

test("a rule inside @media records the condition text verbatim", () => {
  const result = contextOf("@media (min-width: 30em) { .card { color: red; } }");

  expect(result.context).toEqual({
    entries: [{ kind: "media", condition: "(min-width: 30em)" }],
  });
  expect(result.diagnostics).toEqual([]);
});

test("a rule inside @supports records the condition text verbatim", () => {
  const result = contextOf("@supports (display: grid) { .card { color: red; } }");

  expect(result.context).toEqual({
    entries: [{ kind: "supports", condition: "(display: grid)" }],
  });
});

test("nested @supports inside @media records both conditions, outermost first", () => {
  const result = contextOf(
    "@media (min-width: 30em) { @supports (display: grid) { .card { color: red; } } }",
  );

  expect(result.context).toEqual({
    entries: [
      { kind: "media", condition: "(min-width: 30em)" },
      { kind: "supports", condition: "(display: grid)" },
    ],
  });
});

test("at-rule names are matched case-insensitively while params are preserved as authored", () => {
  const result = contextOf("@MEDIA (MIN-WIDTH: 10PX) { .card { color: red; } }");

  expect(result.context).toEqual({
    entries: [{ kind: "media", condition: "(MIN-WIDTH: 10PX)" }],
  });
});

test("a rule inside a named @layer records the layer name", () => {
  const result = contextOf("@layer base { .card { color: red; } }");

  expect(result.context).toEqual({ entries: [{ kind: "layer", name: "base" }] });
  expect(result.diagnostics).toEqual([]);
});

test("a rule inside an anonymous @layer records a null layer name", () => {
  const result = contextOf("@layer { .card { color: red; } }");

  expect(result.context).toEqual({ entries: [{ kind: "layer", name: null }] });
});

test("a rule inside a nested @layer name keeps the dotted name as authored", () => {
  const result = contextOf("@layer base.tokens { .card { color: red; } }");

  expect(result.context).toEqual({ entries: [{ kind: "layer", name: "base.tokens" }] });
});

test("a mixed stack of nested style rules and at-rules reaches past the intervening rule", () => {
  // .active's ancestry is @media -> .card (a style rule) -> @layer -> root.
  // The intervening .card rule contributes no entry of its own; nesting
  // resolution (CSSC-010) already accounts for it on the selector side.
  const css = "@layer base { .card { @media (min-width: 30em) { &.active { color: red; } } } }";
  const result = contextOf(css, 1);

  expect(result.context).toEqual({
    entries: [
      { kind: "layer", name: "base" },
      { kind: "media", condition: "(min-width: 30em)" },
    ],
  });
  expect(result.diagnostics).toEqual([]);
});

test("a rule inside @scope reports OUTSIDE_SUPPORTED_TARGET_SET and no context", () => {
  const result = contextOf("@scope (.card) { .title { color: red; } }");

  expect(result.context).toBeNull();
  expect(codes(result)).toEqual(["OUTSIDE_SUPPORTED_TARGET_SET"]);
});

test("a rule inside @scope reports a distinct code from each phase, never the same code twice", () => {
  // Rule-context compilation answers "does css-console evaluate this rule's
  // context at all," and nesting resolution (CSSC-010) separately answers
  // "can this rule's own selector be flattened." Both fire for a rule nested
  // directly under @scope, and a consumer collecting diagnostics from both
  // phases must see two distinct facts about the rule, never the same code
  // reported twice for one condition.
  const css = "@scope (.card) { .title { color: red; } }";
  const rule = ruleAt(css, 0);

  const ruleContextCodes = codes(compileRuleContext(rule, URL));
  const nestingCodes = resolveNestedSelector(rule, URL).diagnostics.map(
    (diagnostic) => diagnostic.code,
  );

  expect(ruleContextCodes).toEqual(["OUTSIDE_SUPPORTED_TARGET_SET"]);
  expect(nestingCodes).toEqual(["DEFERRED_SCOPE_NESTING"]);
});

test("a rule inside @container reports OUTSIDE_SUPPORTED_TARGET_SET and no context", () => {
  const result = contextOf("@container (min-width: 30em) { .card { color: red; } }");

  expect(result.context).toBeNull();
  expect(codes(result)).toEqual(["OUTSIDE_SUPPORTED_TARGET_SET"]);
});

test("a named @container reports OUTSIDE_SUPPORTED_TARGET_SET the same as an anonymous one", () => {
  const result = contextOf("@container sidebar (min-width: 30em) { .card { color: red; } }");

  expect(result.context).toBeNull();
  expect(codes(result)).toEqual(["OUTSIDE_SUPPORTED_TARGET_SET"]);
});

test("a rule inside @starting-style reports OUTSIDE_SUPPORTED_TARGET_SET and no context", () => {
  const result = contextOf("@starting-style { .card { opacity: 1; } }");

  expect(result.context).toBeNull();
  expect(codes(result)).toEqual(["OUTSIDE_SUPPORTED_TARGET_SET"]);
});

test("a keyframe selector inside @keyframes reports OUTSIDE_SUPPORTED_TARGET_SET and no context", () => {
  const css = "@keyframes spin { from { opacity: 0; } 50% { opacity: 0.5; } to { opacity: 1; } }";

  expect(contextOf(css, 0).context).toBeNull();
  expect(codes(contextOf(css, 0))).toEqual(["OUTSIDE_SUPPORTED_TARGET_SET"]);

  expect(contextOf(css, 1).context).toBeNull();
  expect(codes(contextOf(css, 1))).toEqual(["OUTSIDE_SUPPORTED_TARGET_SET"]);
});

test("a style rule inside a @function body reports INVALID_FUNCTION_BODY_RULE and no context", () => {
  const css = "@function --f() returns <color> { .inner { color: red; } result: blue; }";
  const result = contextOf(css);

  expect(result.context).toBeNull();
  expect(codes(result)).toEqual(["INVALID_FUNCTION_BODY_RULE"]);
});

test("an at-rule outside the named set blocks compilation by default", () => {
  const result = contextOf("@page { .card { color: red; } }");

  expect(result.context).toBeNull();
  expect(codes(result)).toEqual(["OUTSIDE_SUPPORTED_TARGET_SET"]);
});

test("the nearest blocking at-rule wins over an outer condition", () => {
  const css = "@media (min-width: 30em) { @scope (.card) { .title { color: red; } } }";
  const result = contextOf(css);

  expect(result.context).toBeNull();
  expect(codes(result)).toEqual(["OUTSIDE_SUPPORTED_TARGET_SET"]);
});

test("a blocked resolution's diagnostic names the rule's selector and the blocking at-rule", () => {
  const result = contextOf("@scope (.card) { .title { color: red; } }");
  const [diagnostic] = result.diagnostics;

  expect(diagnostic?.details).toEqual({ selector: ".title", atRule: "scope" });
});

test("a blocking at-rule's authored case is preserved in the diagnostic details", () => {
  const result = contextOf("@CONTAINER (min-width: 30em) { .card { color: red; } }");
  const [diagnostic] = result.diagnostics;

  expect(diagnostic?.details).toEqual({ selector: ".card", atRule: "CONTAINER" });
});

/**
 * @scope is the one construct nesting resolution (CSSC-010) and rule-context
 * compilation both have an opinion about, which is why it needed the check
 * above. For every other blocking construct, nesting resolution is
 * transparent per its own module doc comment, so it produces no diagnostic
 * of its own for the same rule and there is nothing for rule-context
 * compilation's single diagnostic to duplicate. This is checked rather than
 * assumed, since an unchecked assumption of this exact shape, that a
 * downstream module normalizes something the way an upstream module already
 * does, is what reached review earlier in this stack.
 */
test("@container, @starting-style, @keyframes, and @function produce no diagnostic from nesting resolution", () => {
  const cases: Array<{ css: string; index?: number }> = [
    { css: "@container (min-width: 30em) { .card { color: red; } }" },
    { css: "@starting-style { .card { opacity: 1; } }" },
    { css: "@keyframes spin { 50% { opacity: 0.5; } }" },
    {
      css: "@function --f() returns <color> { .inner { color: red; } result: blue; }",
    },
  ];

  for (const { css, index = 0 } of cases) {
    const rule = ruleAt(css, index);

    expect(resolveNestedSelector(rule, URL).diagnostics, css).toEqual([]);
    expect(codes(compileRuleContext(rule, URL)).length, css).toBe(1);
  }
});

/**
 * `compileDeclarationContext()` tests.
 *
 * These pin the gap PR 37's follow-up review found: a conditional at-rule
 * nested inside the owning rule, between it and the declaration, is not in
 * the rule's own ancestor chain, so `compileRuleContext(rule)` alone cannot
 * see it, and a call site resolved from that declaration would otherwise
 * report a narrower context than the one it actually sits inside.
 */

test("a declaration with no nested at-rule compiles the same context as its rule", () => {
  const css = "@layer base { .card { padding: 1rem; } }";

  expect(declarationContextOf(css)).toEqual(contextOf(css));
});

test("a declaration nested in a conditional inside its rule carries that condition", () => {
  const result = declarationContextOf(".card { @media (width > 40em) { padding: 1rem; } }");

  expect(result.context).toEqual({
    entries: [{ kind: "media", condition: "(width > 40em)" }],
  });
  expect(result.diagnostics).toEqual([]);
});

test("a declaration's nested segment stacks after its rule's own context, outermost-first", () => {
  const result = declarationContextOf(
    "@media (width > 40em) { .card { @supports (gap: 1rem) { padding: 1rem; } } }",
  );

  expect(result.context).toEqual({
    entries: [
      { kind: "media", condition: "(width > 40em)" },
      { kind: "supports", condition: "(gap: 1rem)" },
    ],
  });
});

test("a declaration nested under @container inside its rule is blocked", () => {
  const result = declarationContextOf(".card { @container (width > 10em) { padding: 1rem; } }");

  expect(result.context).toBeNull();
  expect(codes(result)).toEqual(["OUTSIDE_SUPPORTED_TARGET_SET"]);
});

test("a declaration's own rule-level blocking at-rule still blocks it", () => {
  const result = declarationContextOf("@scope (.card) { .card { padding: 1rem; } }");

  expect(result.context).toBeNull();
  expect(codes(result)).toEqual(["OUTSIDE_SUPPORTED_TARGET_SET"]);
});
