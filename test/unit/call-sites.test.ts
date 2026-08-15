import postcss from "postcss";
import { expect, test } from "vite-plus/test";

import { associateAnnotations } from "../../src/core/annotations/index.ts";
import { resolveCallSites } from "../../src/core/functions/index.ts";
import type { CallSiteResolution, FunctionTarget } from "../../src/core/functions/index.ts";

import { fixtureUrl, loadFixture } from "../support/fixtures.ts";

/**
 * Custom function call-site resolution tests.
 *
 * CSSC-013 answers the review question "does call-site resolution find every
 * call and no others?". This is compilation only: no CSS is evaluated, no
 * selector is matched, and no value is resolved. The tests assert the
 * compiled call sites and the diagnostic codes, never message text,
 * following the project's test strategy.
 *
 * Three behaviors here were checked in Chromium 151.0.7922.34 through
 * Playwright rather than recalled, because each one decides a test
 * expectation.
 *
 * Dashed function names are case-sensitive. With `@function --Space(--n)`
 * defined and `#lower { width: --space(2); }` alongside
 * `#exact { width: --Space(2); }`, the exact-case element computed a width of
 * 20px while the lowercased one fell back to the block default of 1264px, so
 * `--space()` does not call `--Space()`. That is why name matching here is an
 * exact string comparison, unlike the at-keyword and standard property
 * lookups elsewhere in the compiler, which normalise case.
 *
 * A call inside another function's body really does resolve, so the
 * definition-reference case is CSS an author would write rather than a
 * curiosity: `@function --space(--n) { result: --double(calc(var(--n) *
 * 10px)); }` gives `width: --space(2)` a computed width of 40px.
 *
 * A call in a custom property declaration is observable at that declaration,
 * so it is an ordinary call site. `--pad: --space(2)` computes `--pad` to
 * `calc(2 * 10px)`, which is the function substituted rather than the
 * authored call left in place.
 */

const URL = fixtureUrl("inline");

/**
 * Resolves the call sites of the first function annotation in `css`, failing
 * loudly when the css does not produce exactly one function annotation, so a
 * malformed fixture cannot pass a test by accident.
 */
function resolve(css: string, url = URL): CallSiteResolution {
  const { annotations } = associateAnnotations(css, { url });

  expect(annotations).toHaveLength(1);

  const target = annotations[0]?.target;

  if (target === undefined || target.kind !== "function") {
    throw new Error("expected a function target");
  }

  return resolveCallSites(postcss.parse(css, { from: url }), target as FunctionTarget);
}

/** Returns the diagnostic codes a resolution carries, in order. */
function codes(result: CallSiteResolution): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

/** The annotated definition every inline case in this suite shares. */
const DEFINITION = `/* css-console: log */
@function --space(--multiplier) {
  result: calc(var(--multiplier) * 0.25rem);
}
`;

test("a single call site is found, carrying its property, arguments, and selector", () => {
  const result = resolve(`${DEFINITION}
.card {
  padding: --space(4);
}`);

  expect(result.callSites).toHaveLength(1);
  expect(result.callSites[0]?.property).toBe("padding");
  expect(result.callSites[0]?.arguments).toEqual(["4"]);
  expect(result.callSites[0]?.selector).toBe(".card");
  expect(result.callSites[0]?.source.url).toBe(URL);
  expect(codes(result)).toEqual([]);
});

test("call sites are found across every rule that calls the function", () => {
  const { css, url } = loadFixture("representative", "custom-functions");
  const result = resolve(css, url);

  expect(result.callSites.map((callSite) => callSite.property)).toEqual([
    "padding",
    "margin-block",
    "margin-block",
    "margin-block-end",
  ]);
  expect(result.callSites.map((callSite) => callSite.selector)).toEqual([
    ".card",
    ".card",
    ".card",
    ".card .card__title",
  ]);
  expect(codes(result)).toEqual([]);
});

test("two calls in one declaration value produce two call sites", () => {
  const result = resolve(`${DEFINITION}
.card {
  margin: --space(1) --space(2);
}`);

  expect(result.callSites).toHaveLength(2);
  expect(result.callSites.map((callSite) => callSite.arguments)).toEqual([["1"], ["2"]]);
  expect(result.callSites.map((callSite) => callSite.property)).toEqual(["margin", "margin"]);
});

test("neither of two calls in one declaration is the sole contribution", () => {
  const result = resolve(`${DEFINITION}
.card {
  margin: --space(1) --space(2);
}`);

  expect(result.callSites.map((callSite) => callSite.soleContribution)).toEqual([false, false]);
});

test("a call that is the entire declaration value is the sole contribution", () => {
  const result = resolve(`${DEFINITION}
.card {
  padding: --space(4);
}`);

  expect(result.callSites[0]?.soleContribution).toBe(true);
});

test("surrounding whitespace does not stop a call being the sole contribution", () => {
  const result = resolve(`${DEFINITION}
.card {
  padding:   --space(4)  ;
}`);

  expect(result.callSites[0]?.soleContribution).toBe(true);
});

test("a trailing !important does not stop a call being the sole contribution", () => {
  const result = resolve(`${DEFINITION}
.card {
  padding: --space(4) !important;
}`);

  expect(result.callSites[0]?.soleContribution).toBe(true);
});

test("a trailing comment does not stop a call being the sole contribution", () => {
  const result = resolve(`${DEFINITION}
.card {
  padding: --space(4) /* four steps */;
}`);

  expect(result.callSites[0]?.soleContribution).toBe(true);
});

test("a call nested in calc() is not the sole contribution", () => {
  const result = resolve(`${DEFINITION}
.card {
  padding: calc(--space(4) + 2px);
}`);

  expect(result.callSites).toHaveLength(1);
  expect(result.callSites[0]?.soleContribution).toBe(false);
  expect(result.callSites[0]?.arguments).toEqual(["4"]);
});

test("a calc() wrapping nothing but the call is still not the sole contribution", () => {
  const result = resolve(`${DEFINITION}
.card {
  padding: calc(--space(4));
}`);

  expect(result.callSites[0]?.soleContribution).toBe(false);
});

test("a call passed to another call records the outer call with the inner captured verbatim", () => {
  const result = resolve(`${DEFINITION}
.card {
  padding: --space(--double(2));
}`);

  expect(result.callSites).toHaveLength(1);
  expect(result.callSites[0]?.arguments).toEqual(["--double(2)"]);
  expect(result.callSites[0]?.soleContribution).toBe(true);
});

test("a call passed to another call of the same function records only the outer call", () => {
  const result = resolve(`${DEFINITION}
.card {
  padding: --space(--space(2));
}`);

  expect(result.callSites).toHaveLength(1);
  expect(result.callSites[0]?.arguments).toEqual(["--space(2)"]);
});

test("arguments are captured as authored, including var() references", () => {
  const result = resolve(`${DEFINITION}
.card {
  padding: --space(var(--density, 2));
}`);

  expect(result.callSites[0]?.arguments).toEqual(["var(--density, 2)"]);
});

test("each comma-separated argument is captured separately", () => {
  const result = resolve(`${DEFINITION}
.card {
  padding: --space(var(--density, 2), 4);
}`);

  expect(result.callSites[0]?.arguments).toEqual(["var(--density, 2)", "4"]);
});

test("a call with no arguments carries an empty argument list", () => {
  const result = resolve(`/* css-console: log */
@function --gutter() {
  result: 1rem;
}

.card {
  padding: --gutter();
}`);

  expect(result.callSites).toHaveLength(1);
  expect(result.callSites[0]?.arguments).toEqual([]);
});

test("a call inside another function's body is a definition reference, not a call site", () => {
  const result = resolve(`${DEFINITION}
@function --space-loose(--multiplier) {
  result: --space(calc(var(--multiplier) * 2));
}

.card {
  padding: --space-loose(1);
}`);

  expect(result.callSites).toEqual([]);
  expect(result.definitionReferences).toHaveLength(1);
  expect(result.definitionReferences[0]?.functionName).toBe("--space-loose");
  expect(result.definitionReferences[0]?.property).toBe("result");
  expect(result.definitionReferences[0]?.arguments).toEqual(["calc(var(--multiplier) * 2)"]);
});

test("a definition reference does not stop the no-call-sites diagnostic", () => {
  const result = resolve(`${DEFINITION}
@function --space-loose(--multiplier) {
  result: --space(calc(var(--multiplier) * 2));
}`);

  expect(result.callSites).toEqual([]);
  expect(codes(result)).toEqual(["NO_CALL_SITES"]);
});

test("a call inside a conditional in another function's body is still a definition reference", () => {
  const result = resolve(`${DEFINITION}
@function --space-loose(--multiplier) {
  @media (width > 40em) {
    result: --space(calc(var(--multiplier) * 2));
  }

  result: --space(var(--multiplier));
}`);

  expect(result.callSites).toEqual([]);
  expect(result.definitionReferences).toHaveLength(2);
});

test("the fixture's definition reference is reported separately from its call sites", () => {
  const { css, url } = loadFixture("representative", "custom-functions");
  const result = resolve(css, url);

  expect(result.definitionReferences).toHaveLength(1);
  expect(result.definitionReferences[0]?.functionName).toBe("--space-loose");
});

test("a function with no call sites reports NO_CALL_SITES rather than staying silent", () => {
  const result = resolve(DEFINITION);

  expect(result.callSites).toEqual([]);
  expect(result.definitionReferences).toEqual([]);
  expect(codes(result)).toEqual(["NO_CALL_SITES"]);
  expect(result.diagnostics[0]?.severity).toBe("info");
  expect(result.diagnostics[0]?.source?.url).toBe(URL);
});

test("a call site inside a rule context outside the supported target set is excluded", () => {
  const result = resolve(`${DEFINITION}
@container (width > 40em) {
  .card {
    padding: --space(4);
  }
}`);

  expect(result.callSites).toEqual([]);
  expect(codes(result)).toEqual(["OUTSIDE_SUPPORTED_TARGET_SET", "NO_CALL_SITES"]);
});

test("a call inside @keyframes is excluded", () => {
  const result = resolve(`${DEFINITION}
@keyframes grow {
  to {
    padding: --space(4);
  }
}`);

  expect(result.callSites).toEqual([]);
  expect(codes(result)).toContain("OUTSIDE_SUPPORTED_TARGET_SET");
});

test("an excluded rule reports once however many calls it contains", () => {
  const result = resolve(`${DEFINITION}
@container (width > 40em) {
  .card {
    padding: --space(4);
    margin: --space(1) --space(2);
  }
}`);

  expect(codes(result)).toEqual(["OUTSIDE_SUPPORTED_TARGET_SET", "NO_CALL_SITES"]);
});

test("an excluded rule does not exclude the call sites beside it", () => {
  const result = resolve(`${DEFINITION}
@container (width > 40em) {
  .card {
    padding: --space(4);
  }
}

.panel {
  padding: --space(2);
}`);

  expect(result.callSites).toHaveLength(1);
  expect(result.callSites[0]?.selector).toBe(".panel");
  expect(codes(result)).toEqual(["OUTSIDE_SUPPORTED_TARGET_SET"]);
});

test("a call inside @media is a call site, because a condition is not an exclusion", () => {
  const result = resolve(`${DEFINITION}
@media (width > 40em) {
  .card {
    padding: --space(4);
  }
}`);

  expect(result.callSites).toHaveLength(1);
  expect(result.callSites[0]?.selector).toBe(".card");
});

test("a nested conditional holding declarations directly still yields a call site", () => {
  const result = resolve(`${DEFINITION}
.card {
  @media (width > 40em) {
    padding: --space(4);
  }
}`);

  expect(result.callSites).toHaveLength(1);
  expect(result.callSites[0]?.selector).toBe(".card");
  expect(codes(result)).toEqual([]);
});

test("a call site's source is the declaration, so calls in different declarations are distinguishable", () => {
  const result = resolve(`${DEFINITION}
.card {
  padding: --space(4);
  margin: --space(2);
}`);

  expect(result.callSites).toHaveLength(2);

  const [first, second] = result.callSites;

  expect(first?.source.start.line).not.toBe(second?.source.start.line);
});

test("a call in a style rule nested in a function body reports the discarded rule, not a reference", () => {
  const result = resolve(`${DEFINITION}
@function --other() {
  .inner {
    color: --space(2);
  }

  result: 1px;
}`);

  expect(result.definitionReferences).toEqual([]);
  expect(result.callSites).toEqual([]);
  expect(codes(result)).toContain("INVALID_FUNCTION_BODY_RULE");
});

test("name matching is case-sensitive, because a function name is a dashed-ident", () => {
  const result = resolve(`${DEFINITION}
.card {
  padding: --Space(4);
}`);

  expect(result.callSites).toEqual([]);
  expect(codes(result)).toEqual(["NO_CALL_SITES"]);
});

test("a longer function name that starts with the annotated name is not a call site", () => {
  const result = resolve(`${DEFINITION}
.card {
  padding: --space-loose(4);
}`);

  expect(result.callSites).toEqual([]);
  expect(codes(result)).toEqual(["NO_CALL_SITES"]);
});

test("a custom property whose name starts with the function name is not a call site", () => {
  const result = resolve(`${DEFINITION}
.card {
  padding: var(--space-inline);
}`);

  expect(result.callSites).toEqual([]);
});

test("the function name written without a call is not a call site", () => {
  const result = resolve(`${DEFINITION}
.card {
  font-family: --space, sans-serif;
}`);

  expect(result.callSites).toEqual([]);
});

test("a call inside a quoted string is not a call site", () => {
  const result = resolve(`${DEFINITION}
.card::before {
  content: "--space(4)";
}`);

  expect(result.callSites).toEqual([]);
});

test("a call in a custom property declaration is a call site", () => {
  const result = resolve(`${DEFINITION}
.card {
  --pad: --space(2);
  padding: var(--pad);
}`);

  expect(result.callSites).toHaveLength(1);
  expect(result.callSites[0]?.property).toBe("--pad");
  expect(result.callSites[0]?.soleContribution).toBe(true);
});

test("a nested rule's call site records the flat selector nesting resolution produced", () => {
  const result = resolve(`${DEFINITION}
.card {
  & .card__title {
    margin-block-end: --space(1);
  }
}`);

  expect(result.callSites).toHaveLength(1);
  expect(result.callSites[0]?.selector).toBe(":is(.card) .card__title");
});

test("an implicitly nested rule's call site records the flat selector too", () => {
  const result = resolve(`${DEFINITION}
.card {
  .card__title {
    margin-block-end: --space(1);
  }
}`);

  expect(result.callSites[0]?.selector).toBe(":is(.card) .card__title");
});

test("a call in a rule whose selector cannot be flattened is excluded", () => {
  const result = resolve(`${DEFINITION}
@scope (.card) {
  .card__title {
    margin-block-end: --space(1);
  }
}`);

  expect(result.callSites).toEqual([]);
  expect(codes(result)).toContain("OUTSIDE_SUPPORTED_TARGET_SET");
});

test("a call in a declaration outside a style rule is excluded", () => {
  const result = resolve(`${DEFINITION}
@property --pad {
  syntax: "<length>";
  inherits: false;
  initial-value: --space(4);
}`);

  expect(result.callSites).toEqual([]);
  expect(codes(result)).toEqual(["OUTSIDE_SUPPORTED_TARGET_SET", "NO_CALL_SITES"]);
});

test("a call site in a bare rule carries a context with no entries", () => {
  const result = resolve(`${DEFINITION}
.card {
  padding: --space(4);
}`);

  expect(result.callSites[0]?.context.entries).toEqual([]);
});

test("a call site inside @media carries that condition as its context", () => {
  const result = resolve(`${DEFINITION}
@media (width > 40em) {
  .card {
    padding: --space(4);
  }
}`);

  expect(result.callSites[0]?.context.entries).toEqual([
    { kind: "media", condition: "(width > 40em)" },
  ]);
});

test("a call site inside nested @supports inside @media carries both entries outermost-first", () => {
  const result = resolve(`${DEFINITION}
@media (width > 40em) {
  @supports (gap: 1rem) {
    .card {
      padding: --space(4);
    }
  }
}`);

  expect(result.callSites[0]?.context.entries).toEqual([
    { kind: "media", condition: "(width > 40em)" },
    { kind: "supports", condition: "(gap: 1rem)" },
  ]);
});

test("call sites are reported in source order", () => {
  const result = resolve(`${DEFINITION}
.panel {
  padding: --space(3);
}

.card {
  padding: --space(1);
  margin: --space(2);
}`);

  expect(result.callSites.map((callSite) => callSite.arguments[0])).toEqual(["3", "1", "2"]);
});
