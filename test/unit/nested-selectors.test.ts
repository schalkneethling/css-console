import postcss from "postcss";
import type { Rule } from "postcss";
import { expect, test } from "vite-plus/test";

import { associateAnnotations } from "../../src/core/annotations/associate.ts";
import { splitSelectorBranches } from "../../src/core/compiler/index.ts";
import { resolveNestedSelector } from "../../src/core/nesting/index.ts";
import type { NestingResolution } from "../../src/core/nesting/index.ts";

import { fixtureUrl, loadFixture } from "../support/fixtures.ts";

/**
 * Nested selector resolution tests.
 *
 * CSSC-010 turns a nested rule's selector into the flat selector list a
 * matcher can hand to `querySelectorAll()`. This is textual analysis only: no
 * selector is matched against a document, and no element is touched. The
 * tests assert the resolved selector and the diagnostic codes, never message
 * text, following the project's test strategy.
 *
 * The expectations are not recalled. The nested selectors mirror a
 * representative subset of the Web Platform Tests for CSS nesting,
 * css/css-nesting/parsing.html and css/css-nesting/implicit-nesting.html,
 * whose harness applies each inner selector under a parent of `.foo`, which
 * is what `resolve()` below reproduces. WPT asserts the browser's
 * serialization, which keeps the nesting selector rather than substituting
 * for it, so the flat form each case resolves to was checked separately by
 * applying the nested rule in Chromium, collecting the elements it styled,
 * and comparing that set against `document.querySelectorAll()` of the flat
 * selector. Every case here agreed.
 *
 * Specificity was checked the same way, because matching alone does not
 * settle it. With a parent list of `.foo, #a`, the nested rule
 * `.foo, #a { & .title { color: red } }` beats a following
 * `.card .title { color: blue }` in Chromium, and so does the flat
 * `:is(.foo, #a) .title`, while the naive `.foo .title` loses. That case is
 * why `:is()` wrapping is in the resolved output rather than a bare
 * substitution.
 */

const URL = fixtureUrl("inline");

/**
 * Resolves one nested selector written inside a parent rule, mirroring the
 * `testNestedSelector` harness in css/css-nesting/parsing.html, whose parent
 * defaults to `.foo`.
 */
function resolve(nested: string, parent = ".foo"): NestingResolution {
  const root = postcss.parse(`${parent} { ${nested} { color: rgb(0 0 0); } }`, { from: URL });
  const rules: Rule[] = [];

  root.walkRules((rule) => {
    rules.push(rule);
  });

  const inner = rules[1];

  if (inner === undefined) {
    throw new Error(`the fixture "${parent} { ${nested} { } }" produced no nested rule`);
  }

  return resolveNestedSelector(inner, URL);
}

/** Returns the resolved selector for one nested selector. */
function selectorOf(nested: string, parent?: string): string | null {
  return resolve(nested, parent).selector;
}

/** Returns the diagnostic codes a resolution carries, in order. */
function codes(result: NestingResolution): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

/** Parses a source and returns every rule in it, in document order. */
function rulesOf(css: string, url = URL): Rule[] {
  const rules: Rule[] = [];

  postcss.parse(css, { from: url }).walkRules((rule) => {
    rules.push(rule);
  });

  return rules;
}

/** Returns the rule at an index, failing loudly when the source has none. */
function ruleAt(rules: readonly Rule[], index: number): Rule {
  const rule = rules[index];

  if (rule === undefined) {
    throw new Error(`the source has no rule at index ${index}`);
  }

  return rule;
}

test("a leading nesting selector resolves to the parent list wrapped in :is()", () => {
  expect(selectorOf("& .bar")).toBe(":is(.foo) .bar");
});

test("a trailing nesting selector keeps its position", () => {
  expect(selectorOf(".parent &")).toBe(".parent :is(.foo)");
});

test("a compound nesting selector resolves without a combinator", () => {
  expect(selectorOf("&.bar")).toBe(":is(.foo).bar");
});

test("a bare nesting selector resolves to the parent list alone", () => {
  expect(selectorOf("&")).toBe(":is(.foo)");
});

test("a selector with no nesting selector gains an implicit descendant combinator", () => {
  expect(selectorOf(".title", ".card")).toBe(":is(.card) .title");
});

test("a nesting selector anywhere in the complex selector suppresses the implicit prefix", () => {
  // WPT parsing.html asserts `.test > & .bar` serializes unchanged, so the
  // implicit prefix is not added when a nesting selector is already present.
  expect(selectorOf(".test > & .bar")).toBe(".test > :is(.foo) .bar");
});

test("the implicit prefix is decided per complex selector rather than per list", () => {
  // WPT parsing.html: `.foo, .foo &` becomes `& .foo, .foo &`.
  expect(selectorOf(".quux, .quux &")).toBe(":is(.foo) .quux, .quux :is(.foo)");
});

test("a leading child combinator resolves against the parent list", () => {
  expect(selectorOf("> .title", ".card")).toBe(":is(.card) > .title");
});

test("a leading next-sibling combinator resolves against the parent list", () => {
  expect(selectorOf("+ .bar")).toBe(":is(.foo) + .bar");
});

test("a leading subsequent-sibling combinator resolves against the parent list", () => {
  expect(selectorOf("~ .bar")).toBe(":is(.foo) ~ .bar");
});

test("a leading combinator prepends the nesting selector even when one is present", () => {
  // WPT parsing.html asserts `> & .bar` serializes as `& > & .bar`, so the
  // relative rule and the contains-a-nesting-selector rule are separate.
  expect(selectorOf("> & .bar")).toBe(":is(.foo) > :is(.foo) .bar");
});

test("a relative selector whose nesting selector comes later still gains the prefix", () => {
  // WPT parsing.html: `+ .bar &` serializes as `& + .bar &`.
  expect(selectorOf("+ .bar &")).toBe(":is(.foo) + .bar :is(.foo)");
});

test("a mixed list resolves each complex selector by its own rule", () => {
  // WPT parsing.html: `+ .bar, .foo, > .baz` serializes as
  // `& + .bar, & .foo, & > .baz`.
  expect(selectorOf("+ .bar, .baz, > .qux")).toBe(
    ":is(.foo) + .bar, :is(.foo) .baz, :is(.foo) > .qux",
  );
});

test("a combinator written without a following space still resolves", () => {
  // WPT implicit-nesting.html writes `> .foo,.test-6-child,+ .bar` with no
  // space after the commas, which is the tokenizer case rather than a typo.
  expect(selectorOf("> .title,.body,+ .sibling", ".card")).toBe(
    ":is(.card) > .title, :is(.card) .body, :is(.card) + .sibling",
  );
});

test("a nesting selector inside :is() resolves in place", () => {
  expect(selectorOf(":is(& .bar)")).toBe(":is(:is(.foo) .bar)");
});

test("a nesting selector inside :not() resolves in place", () => {
  // Substituting the parent list rather than distributing it over the
  // branches is what makes this correct: under a parent of `.a, .b`,
  // `:not(:is(.a, .b))` is the browser's answer and `:not(.a), :not(.b)`
  // matches nearly every element instead.
  expect(selectorOf(":not(&)")).toBe(":not(:is(.foo))");
  expect(selectorOf(":not(&)", ".a, .b")).toBe(":not(:is(.a, .b))");
});

test("a nesting selector inside a functional pseudo-class suppresses the implicit prefix", () => {
  // WPT parsing.html asserts `:is(.bar, &.baz)` serializes unchanged, while
  // `:is(.bar, .baz)` gains the prefix, so the search for a nesting selector
  // reaches inside the argument list.
  expect(selectorOf(":is(.bar, &.baz)")).toBe(":is(.bar, :is(.foo).baz)");
  expect(selectorOf(":is(.bar, .baz)")).toBe(":is(.foo) :is(.bar, .baz)");
});

test("a nesting selector inside a relative selector argument resolves in place", () => {
  expect(selectorOf("&:has(.title)", ".card")).toBe(":is(.card):has(.title)");
  expect(selectorOf(":nth-child(1 of &)")).toBe(":nth-child(1 of :is(.foo))");
});

test("every nesting selector in one complex selector is resolved", () => {
  // WPT parsing.html: `& .bar & .baz & .qux`.
  expect(selectorOf("& .bar & .baz & .qux")).toBe(":is(.foo) .bar :is(.foo) .baz :is(.foo) .qux");
});

test("a doubled nesting selector resolves to the parent list twice", () => {
  // WPT parsing.html asserts `&&` is valid. It is not a no-op: Chromium gives
  // `.foo { && { } }` the specificity of `.foo.foo`, which the doubled :is()
  // reproduces.
  expect(selectorOf("&&")).toBe(":is(.foo):is(.foo)");
});

test("a multi-branch parent wraps in :is() rather than distributing over branches", () => {
  expect(selectorOf(".c", ".a, .b")).toBe(":is(.a, .b) .c");
});

test("a multi-branch parent resolves each nested branch against the whole list", () => {
  // CSS Nesting section 3.2 gives this exact case: `.foo, .bar { + .baz,
  // &.qux { } }` is equivalent to `:is(.foo, .bar) + .baz, :is(.foo,
  // .bar).qux`.
  expect(selectorOf("& + .baz, &.qux", ".foo, .bar")).toBe(
    ":is(.foo, .bar) + .baz, :is(.foo, .bar).qux",
  );
});

test("a parent list containing a pseudo-element resolves through :is() unchanged", () => {
  // CSS Nesting section 4: the nesting selector cannot represent a
  // pseudo-element, so `.foo, .foo::before, .foo::after { &:hover { } }` is
  // equivalent to `.foo:hover`. Substituting the list verbatim reproduces
  // that, because :is() drops an argument carrying a pseudo-element from both
  // its matching and its specificity. Chromium agrees on both counts: the
  // nested rule and `:is(.foo, .foo::before, .foo::after)` match the same
  // elements, and both lose to an earlier `div.card` on specificity, which
  // only a (0,1,0) selector does.
  expect(selectorOf("&:hover", ".note, .note::before, .note::after")).toBe(
    ":is(.note, .note::before, .note::after):hover",
  );
});

test("a complex parent selector is wrapped as one unit", () => {
  // CSS Nesting section 3.2: `.ancestor .el { .other-ancestor & { } }` is
  // equivalent to `.other-ancestor :is(.ancestor .el)`. Without the wrapping
  // the descendant combinator would bind the wrong way round.
  expect(selectorOf(".other-ancestor &", ".ancestor .el")).toBe(
    ".other-ancestor :is(.ancestor .el)",
  );
});

test("three levels of nesting stack up", () => {
  const rules = rulesOf("figure { > figcaption { > p { font-size: 0.9rem; } } }");

  expect(resolveNestedSelector(ruleAt(rules, 0), URL).selector).toBe("figure");
  expect(resolveNestedSelector(ruleAt(rules, 1), URL).selector).toBe(":is(figure) > figcaption");
  expect(resolveNestedSelector(ruleAt(rules, 2), URL).selector).toBe(
    ":is(:is(figure) > figcaption) > p",
  );
});

test("selector lists at both levels produce the cross product in source order", () => {
  expect(selectorOf(".c, .title", ".a, .b")).toBe(":is(.a, .b) .c, :is(.a, .b) .title");
});

test("a top-level rule's selector passes through unchanged", () => {
  const rules = rulesOf(".card { color: rgb(0 0 0); }");
  const result = resolveNestedSelector(ruleAt(rules, 0), URL);

  expect(result.selector).toBe(".card");
  expect(result.diagnostics).toEqual([]);
});

test("a top-level nesting selector passes through rather than being substituted", () => {
  // At the top level the nesting selector represents the same elements as
  // :scope, and Chromium answers document.querySelectorAll("& .foo") with
  // exactly the elements the top-level rule `& .foo { }` styles, so passing
  // it through keeps the browser's reading.
  const rules = rulesOf("& .foo { color: rgb(0 0 0); }");
  const result = resolveNestedSelector(ruleAt(rules, 0), URL);

  expect(result.selector).toBe("& .foo");
  expect(result.diagnostics).toEqual([]);
});

test("a nested rule inside @media resolves against the rule outside it", () => {
  const rules = rulesOf(".card { @media (min-width: 40rem) { .title { color: rgb(0 0 0); } } }");

  expect(resolveNestedSelector(ruleAt(rules, 1), URL).selector).toBe(":is(.card) .title");
});

test("a nested rule inside a doubly nested group rule resolves against the same rule", () => {
  const rules = rulesOf(
    ".card { @media (min-width: 40rem) { @supports (color: rgb(0 0 0)) { & > .title { color: rgb(0 0 0); } } } }",
  );

  expect(resolveNestedSelector(ruleAt(rules, 1), URL).selector).toBe(":is(.card) > .title");
});

test("every nested group rule kind is transparent to resolution", () => {
  const groups = [
    "@media (min-width: 40rem)",
    "@supports (color: rgb(0 0 0))",
    "@container (min-width: 40rem)",
    "@layer base",
    "@starting-style",
  ];

  for (const group of groups) {
    const rules = rulesOf(`.card { ${group} { .title { color: rgb(0 0 0); } } }`);

    expect(resolveNestedSelector(ruleAt(rules, 1), URL).selector, group).toBe(":is(.card) .title");
  }
});

test("a rule inside a group rule at the top level is still top level", () => {
  const rules = rulesOf("@media print { .card { color: rgb(0 0 0); } }");

  expect(resolveNestedSelector(ruleAt(rules, 0), URL).selector).toBe(".card");
});

test("a nested rule inside @scope reports DEFERRED_SCOPE_NESTING and resolves to nothing", () => {
  // Inside @scope the nesting selector behaves as :where(:scope) and a rule
  // with no nesting selector is prefixed with :scope, neither of which can be
  // written into a flat selector. Chromium confirms the difference:
  // `.card { @scope (& > .inner) { .title { } } }` styles nothing that
  // `:is(.card) .title` styles.
  const rules = rulesOf(".card { @scope (& > .inner) { .title { color: rgb(0 0 0); } } }");
  const result = resolveNestedSelector(ruleAt(rules, 1), URL);

  expect(result.selector).toBeNull();
  expect(codes(result)).toEqual(["DEFERRED_SCOPE_NESTING"]);
  expect(result.diagnostics[0]?.severity).toBe("warning");
});

test("a rule inside a top-level @scope also reports DEFERRED_SCOPE_NESTING", () => {
  const rules = rulesOf("@scope (.card) { .title { color: rgb(0 0 0); } }");

  expect(codes(resolveNestedSelector(ruleAt(rules, 0), URL))).toEqual(["DEFERRED_SCOPE_NESTING"]);
});

test("a type selector after the nesting selector reports INVALID_NESTING_SELECTOR", () => {
  // WPT parsing.html asserts `&div` is invalid and drops the inner rule,
  // while `div&` is valid and serializes unchanged. They are not two
  // spellings of one thing: `Bar&` matches Bar elements the parent selector
  // also matches, and `&Bar` is the preprocessor's string concatenation,
  // which CSS does not perform.
  const result = resolve("&Bar");

  expect(result.selector).toBeNull();
  expect(codes(result)).toEqual(["INVALID_NESTING_SELECTOR"]);
  expect(result.diagnostics[0]?.severity).toBe("error");
});

test("a type selector before the nesting selector is valid and resolves", () => {
  expect(selectorOf("Bar&")).toBe("Bar:is(.foo)");
  expect(selectorOf("div&")).toBe("div:is(.foo)");
});

test("every simple selector that may precede the nesting selector resolves", () => {
  // WPT parsing.html asserts each of these is valid.
  expect(selectorOf(".cls&")).toBe(".cls:is(.foo)");
  expect(selectorOf("[data-live]&")).toBe("[data-live]:is(.foo)");
  expect(selectorOf("#main&")).toBe("#main:is(.foo)");
  expect(selectorOf(":hover&")).toBe(":hover:is(.foo)");
  expect(selectorOf(":is(div)&")).toBe(":is(div):is(.foo)");
  expect(selectorOf("&:is(div)")).toBe(":is(.foo):is(div)");
});

test("a universal selector after the nesting selector is invalid too", () => {
  // Chromium drops the rule for `&*` for the same reason it drops `&div`.
  expect(codes(resolve("&*"))).toEqual(["INVALID_NESTING_SELECTOR"]);
});

test("one invalid complex selector discards the whole list", () => {
  // Chromium keeps only `.foo { }` for `.foo { &div, .bar { } }`, so the
  // well-formed branch beside the invalid one never applies to anything.
  const result = resolve("&Bar, .baz");

  expect(result.selector).toBeNull();
  expect(codes(result)).toEqual(["INVALID_NESTING_SELECTOR"]);
});

test("an invalid nesting compound inside a forgiving selector list is not reported", () => {
  // Chromium keeps `.foo { :is(&div, .bar) { } }` and still matches `.bar`,
  // because :is() takes a forgiving selector list that drops the invalid
  // argument, and the resolved `:is(:is(.foo)div, .bar)` matches the same
  // elements. Reporting here would reject a rule the browser applies.
  const result = resolve(":is(&div, .bar)");

  expect(result.selector).toBe(":is(:is(.foo)div, .bar)");
  expect(result.diagnostics).toEqual([]);
});

test("an ampersand inside an attribute string is not a nesting selector", () => {
  expect(selectorOf('&[title="&"]')).toBe(':is(.foo)[title="&"]');
});

test("an escaped ampersand is part of an identifier rather than a nesting selector", () => {
  // .a\&b matches an element whose class is literally a&b, verified in
  // Chromium, so the escaped ampersand must not be substituted and must not
  // suppress the implicit descendant prefix.
  expect(selectorOf(".a\\&b")).toBe(":is(.foo) .a\\&b");
  expect(selectorOf("&.a\\&b")).toBe(":is(.foo).a\\&b");
});

test("a comment inside a nested selector never reaches resolution", () => {
  // PostCSS strips a comment out of Rule.selector and keeps the authored text
  // only in raws.selector.raw, so an ampersand written inside one cannot be
  // mistaken for a nesting selector.
  const rules = rulesOf(".foo { .title /* & */ { color: rgb(0 0 0); } }");

  expect(ruleAt(rules, 1).selector).toBe(".title");
  expect(resolveNestedSelector(ruleAt(rules, 1), URL).selector).toBe(":is(.foo) .title");
});

test("an empty complex selector survives resolution so branch splitting reports it", () => {
  const result = resolve(".a, , .b");

  expect(result.selector).toBe(":is(.foo) .a, , :is(.foo) .b");
  expect(result.diagnostics).toEqual([]);

  const split = splitSelectorBranches(result.selector ?? "", {
    url: URL,
    start: { line: 1, column: 1 },
    end: { line: 1, column: 1 },
  });

  expect(split.branches).toEqual([]);
  expect(split.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
    "MALFORMED_SELECTOR_LIST",
  ]);
});

test("a rule under an unresolved ancestor resolves to nothing and carries its reason", () => {
  const rules = rulesOf(".foo { &Bar { .title { color: rgb(0 0 0); } } }");
  const result = resolveNestedSelector(ruleAt(rules, 2), URL);

  expect(result.selector).toBeNull();
  expect(codes(result)).toEqual(["INVALID_NESTING_SELECTOR"]);
});

test("every diagnostic carries the location of the rule it is about", () => {
  const rules = rulesOf(".foo {\n  &Bar { color: rgb(0 0 0); }\n}");
  const result = resolveNestedSelector(ruleAt(rules, 1), URL);

  expect(result.diagnostics[0]?.source).toEqual({
    url: URL,
    start: { line: 2, column: 3 },
    end: { line: 2, column: 29 },
  });
});

test("resolving the same rule twice returns equal results", () => {
  expect(resolve("& .bar, > .baz")).toEqual(resolve("& .bar, > .baz"));
});

test("resolution does not mutate the parsed tree", () => {
  const rules = rulesOf(".card { > .title { color: rgb(0 0 0); } }");
  const before = rules.map((rule) => rule.selector);

  for (const rule of rules) {
    resolveNestedSelector(rule, URL);
  }

  expect(rules.map((rule) => rule.selector)).toEqual(before);
});

test("declarations after nested rules keep their source order through resolution", () => {
  // CSS Nesting section 3.4: declarations coming after or between rules are
  // implicitly wrapped in nested declarations rules to preserve their order
  // relative to the other rules, and the order decides the cascade. The
  // specification's own example is `article { color: green; & { color: blue;
  // } color: red; }`, which resolves to green, then blue, then red, so the
  // trailing declaration wins; Chromium computes red for it. Resolution must
  // therefore leave the declarations where they are rather than hoisting them
  // above the nested rules, which is what a nesting transform pre-pass would
  // have risked.
  const { css, url } = loadFixture("representative", "nested-card");
  const root = postcss.parse(css, { from: url });
  const card = root.nodes.find((node) => node.type === "rule" && node.selector === ".card");

  if (card === undefined || card.type !== "rule") {
    throw new Error("the nested-card fixture must carry a top-level .card rule");
  }

  const kinds = card.nodes.map((node) =>
    node.type === "decl"
      ? `decl:${node.prop}`
      : node.type === "rule"
        ? `rule:${node.selector}`
        : node.type,
  );

  expect(kinds).toEqual([
    "decl:background-color",
    "decl:padding",
    "comment",
    "rule:.card__title",
    "rule:> .card__media",
    "rule:&:hover",
    "atrule",
    "comment",
    "decl:border-radius",
    "comment",
  ]);

  const rules: Rule[] = [];

  root.walkRules((rule) => {
    rules.push(rule);
  });

  for (const rule of rules) {
    resolveNestedSelector(rule, url);
  }

  expect(
    card.nodes.map((node) =>
      node.type === "decl"
        ? `decl:${node.prop}`
        : node.type === "rule"
          ? `rule:${node.selector}`
          : node.type,
    ),
  ).toEqual(kinds);
});

test("annotation line and column are unchanged by resolution", () => {
  // The pre-pass a nesting transform would have needed is the one thing that
  // could break annotation association, because every probe is attached to
  // its target by adjacency in source. This pins the property.
  const { css, url } = loadFixture("representative", "nested-card");
  const before = associateAnnotations(css, { url });
  const root = postcss.parse(css, { from: url });
  const rules: Rule[] = [];

  root.walkRules((rule) => {
    rules.push(rule);
  });

  const positions = rules.map((rule) => rule.source?.start);

  for (const rule of rules) {
    resolveNestedSelector(rule, url);
  }

  expect(rules.map((rule) => rule.source?.start)).toEqual(positions);

  const after = associateAnnotations(css, { url });

  expect(after.annotations.map((annotation) => annotation.source)).toEqual(
    before.annotations.map((annotation) => annotation.source),
  );
  expect(after.annotations.map((annotation) => annotation.target.source)).toEqual(
    before.annotations.map((annotation) => annotation.target.source),
  );
  expect(before.annotations).toHaveLength(4);
});

test("the representative fixture resolves every nested rule the way a browser reads it", () => {
  const { css, url } = loadFixture("representative", "nested-card");
  const resolved = rulesOf(css, url).map((rule) => resolveNestedSelector(rule, url).selector);

  expect(resolved).toEqual([
    ".card",
    ":is(.card) .card__title",
    ":is(.card) > .card__media",
    ":is(.card):hover",
    ":is(.card) .card__body",
    ".card__title,\n.card__subtitle",
    ":is(.card__title,\n.card__subtitle) .badge",
  ]);
});

test("the hardening fixture resolves every nested rule the way a browser reads it", () => {
  const { css, url } = loadFixture("hardening", "nested-selectors");
  const pairs = rulesOf(css, url).map(
    (rule) => [rule.selector, resolveNestedSelector(rule, url).selector] as const,
  );

  expect(pairs).toEqual([
    [".foo", ".foo"],
    ["&", ":is(.foo)"],
    ["&.bar", ":is(.foo).bar"],
    ["& .bar", ":is(.foo) .bar"],
    ["& > .bar", ":is(.foo) > .bar"],
    ["> .bar", ":is(.foo) > .bar"],
    ["> & .bar", ":is(.foo) > :is(.foo) .bar"],
    ["+ .bar &", ":is(.foo) + .bar :is(.foo)"],
    ["+ .bar, .baz, > .qux", ":is(.foo) + .bar, :is(.foo) .baz, :is(.foo) > .qux"],
    [".baz", ":is(.foo) .baz"],
    [".test > & .bar", ".test > :is(.foo) .bar"],
    [".quux, .quux &", ":is(.foo) .quux, .quux :is(.foo)"],
    [":is(.bar, .baz)", ":is(.foo) :is(.bar, .baz)"],
    ["&:is(.bar, .baz)", ":is(.foo):is(.bar, .baz)"],
    [":is(.bar, &.baz)", ":is(.bar, :is(.foo).baz)"],
    ["& .bar & .baz & .qux", ":is(.foo) .bar :is(.foo) .baz :is(.foo) .qux"],
    ["&&", ":is(.foo):is(.foo)"],
    ["div&", "div:is(.foo)"],
    [".cls&", ".cls:is(.foo)"],
    ["[data-live]&", "[data-live]:is(.foo)"],
    ["#main&", "#main:is(.foo)"],
    [":hover&", ":hover:is(.foo)"],
    [":is(div)&", ":is(div):is(.foo)"],
    ["&:is(div)", ":is(.foo):is(div)"],
    ["& > section, & > article", ":is(.foo) > section, :is(.foo) > article"],
    [":not(&)", ":not(:is(.foo))"],
    [".foo, .bar", ".foo, .bar"],
    ["& + .baz, &.qux", ":is(.foo, .bar) + .baz, :is(.foo, .bar).qux"],
    [".card", ".card"],
    ["> .title,.body,+ .sibling", ":is(.card) > .title, :is(.card) .body, :is(.card) + .sibling"],
    ["figure", "figure"],
    ["> figcaption", ":is(figure) > figcaption"],
    ["> p", ":is(:is(figure) > figcaption) > p"],
    [".ancestor .el", ".ancestor .el"],
    [".other-ancestor &", ".other-ancestor :is(.ancestor .el)"],
    [".note, .note::before, .note::after", ".note, .note::before, .note::after"],
    ["&:hover", ":is(.note, .note::before, .note::after):hover"],
    [".panel", ".panel"],
    [".title", ":is(.panel) .title"],
    ["& > .body", ":is(.panel) > .body"],
  ]);
});

test("a keyframe selector is not resolved as a style selector", () => {
  // PostCSS parses `from` inside @keyframes as an ordinary Rule node, so a
  // transparent walk would resolve it to `:is(.card) from`: a matchable
  // looking selector for something that is not a selector. Chromium discards
  // a @keyframes nested in a style rule entirely, serialising the outer rule
  // back as `.card { }`, so there is nothing there to match.
  const rules = rulesOf(`.card { @keyframes spin { from { opacity: 0 } } }`);
  const keyframe = rules.find((rule) => rule.selector === "from");

  expect(keyframe).toBeDefined();
  expect(resolveNestedSelector(keyframe!, URL).selector).toBeNull();
});

test("a keyframe selector reports nothing, leaving rule context to explain", () => {
  const rules = rulesOf(`@keyframes spin { from { opacity: 0 } }`);
  const keyframe = rules.find((rule) => rule.selector === "from");

  // Rule-context compilation already reports why this is not probed, so
  // resolution stays silent rather than saying the same thing twice.
  expect(resolveNestedSelector(keyframe!, URL).diagnostics).toEqual([]);
});

test("a style rule inside a @function body resolves to no selector", () => {
  const rules = rulesOf(`@function --f() { .inner { color: red } }`);

  expect(resolveNestedSelector(rules[0]!, URL).selector).toBeNull();
});

test("the five transparent group at-rules stay transparent", () => {
  for (const atRule of [
    "@media (min-width: 40rem)",
    "@supports (display: grid)",
    "@container (min-inline-size: 20rem)",
    "@layer components",
    "@starting-style",
  ]) {
    const rules = rulesOf(`.card { ${atRule} { .title { color: red } } }`);
    const inner = rules.find((rule) => rule.selector === ".title");

    expect(resolveNestedSelector(inner!, URL).selector, atRule).toBe(":is(.card) .title");
  }
});

test("the hardening fixture produces no diagnostics", () => {
  const { css, url } = loadFixture("hardening", "nested-selectors");

  for (const rule of rulesOf(css, url)) {
    expect(resolveNestedSelector(rule, url).diagnostics, rule.selector).toEqual([]);
  }
});
