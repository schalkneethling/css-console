import postcss from "postcss";
import { expect, test } from "vite-plus/test";

import { splitSelectorBranches } from "../../src/core/compiler/index.ts";
import type { SelectorBranch, SelectorSplit } from "../../src/core/compiler/index.ts";

import { fixtureLocation, loadFixture } from "../support/fixtures.ts";

/**
 * Selector branch splitting tests.
 *
 * CSSC-009 turns one authored selector into the branches a later matching
 * phase runs independently. This is textual analysis only: no selector is
 * matched against a document, and no element is touched. These tests assert
 * the branch shape and the diagnostic codes the split produces, never message
 * text, following the project's test strategy.
 *
 * The pseudo-element expectations were verified in Chromium rather than
 * recalled. `p:before` is retained and serialised as `p::before`, and
 * `getComputedStyle(p, "::BEFORE")` returns the same content as `"::before"`,
 * which is what makes normalising the legacy forms and the letter case the
 * truthful reading rather than a convenience.
 */

const SOURCE = fixtureLocation("inline");

/** Splits a selector at the shared fixture location. */
function split(selector: string): SelectorSplit {
  return splitSelectorBranches(selector, SOURCE);
}

/** Returns the diagnostic codes a split carries, in order. */
function codes(result: SelectorSplit): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

/** Returns the matchable originating selector of every branch, in order. */
function selectors(result: SelectorSplit): string[] {
  return result.branches.map((branch) => branch.selector);
}

test("a single selector produces one branch carrying no pseudo-element", () => {
  const result = split(".card");

  expect(result.branches).toEqual([
    { authored: ".card", selector: ".card", pseudo: null } satisfies SelectorBranch,
  ]);
  expect(result.diagnostics).toEqual([]);
});

test("a comma-separated list produces one branch per selector in source order", () => {
  const result = split(".card, .panel > a, #main");

  expect(selectors(result)).toEqual([".card", ".panel > a", "#main"]);
  expect(result.diagnostics).toEqual([]);
});

test("a branch keeps its authored text and loses only the surrounding whitespace", () => {
  const result = split("  .card ,\n  .panel  ");

  expect(result.branches.map((branch) => branch.authored)).toEqual([".card", ".panel"]);
});

test("a comma inside :is() does not separate branches", () => {
  const result = split(".card:is(.featured, .promoted)");

  expect(selectors(result)).toEqual([".card:is(.featured, .promoted)"]);
});

test("a comma inside :where() does not separate branches", () => {
  const result = split(":where(.a, .b) .c");

  expect(selectors(result)).toEqual([":where(.a, .b) .c"]);
});

test("a comma inside :not() does not separate branches", () => {
  const result = split(".card:not(.muted, .hidden), .panel");

  expect(selectors(result)).toEqual([".card:not(.muted, .hidden)", ".panel"]);
});

test("a comma inside an of-clause does not separate branches", () => {
  const result = split("li:nth-child(2n of .x, .y), li:last-child");

  expect(selectors(result)).toEqual(["li:nth-child(2n of .x, .y)", "li:last-child"]);
});

test("nested functional pseudo-classes keep every inner comma out of the split", () => {
  const result = split(":is(.a, :not(.b, .c)) .d, .e");

  expect(selectors(result)).toEqual([":is(.a, :not(.b, .c)) .d", ".e"]);
});

test("a comma inside an attribute selector string does not separate branches", () => {
  const result = split('[title="a,b"], .panel');

  expect(selectors(result)).toEqual(['[title="a,b"]', ".panel"]);
});

test("a comma inside a single-quoted attribute string does not separate branches", () => {
  const result = split("[title='a,b']");

  expect(selectors(result)).toEqual(["[title='a,b']"]);
});

test("an escaped comma in a class name does not separate branches", () => {
  // .a\,b matches an element whose class is literally "a,b", verified in
  // Chromium, so the comma belongs to the identifier rather than the list.
  const result = split(".a\\,b, .panel");

  expect(selectors(result)).toEqual([".a\\,b", ".panel"]);
});

test("a hex escape spelling a comma does not separate branches", () => {
  // .a\2c b is the same class name as .a\,b, also verified in Chromium.
  const result = split(".a\\2c b, .panel");

  expect(selectors(result)).toEqual([".a\\2c b", ".panel"]);
});

test("a numeric-leading escaped class survives the split intact", () => {
  const result = split(".\\31 23, .panel");

  expect(selectors(result)).toEqual([".\\31 23", ".panel"]);
});

test("an escaped colon pair is an identifier rather than a pseudo-element", () => {
  // .icon\:\:before matches an element whose class is "icon::before",
  // verified in Chromium, so the escaped colons must not be read as a
  // pseudo-element.
  const result = split(".icon\\:\\:before");

  expect(result.branches).toEqual([
    {
      authored: ".icon\\:\\:before",
      selector: ".icon\\:\\:before",
      pseudo: null,
    } satisfies SelectorBranch,
  ]);
  expect(result.diagnostics).toEqual([]);
});

test("an empty branch discards the whole list and reports MALFORMED_SELECTOR_LIST", () => {
  // Chromium drops the entire rule for `.a, , .b` and querySelectorAll throws
  // a SyntaxError on it, so no branch of this list ever applies to anything.
  const result = split(".a, , .b");

  expect(result.branches).toEqual([]);
  expect(codes(result)).toEqual(["MALFORMED_SELECTOR_LIST"]);
  expect(result.diagnostics[0]?.severity).toBe("error");
});

test("a trailing comma is an empty branch", () => {
  const result = split(".a,");

  expect(result.branches).toEqual([]);
  expect(codes(result)).toEqual(["MALFORMED_SELECTOR_LIST"]);
});

test("a leading comma is an empty branch", () => {
  const result = split(", .a");

  expect(result.branches).toEqual([]);
  expect(codes(result)).toEqual(["MALFORMED_SELECTOR_LIST"]);
});

test("a selector of only whitespace is an empty branch", () => {
  const result = split("   ");

  expect(result.branches).toEqual([]);
  expect(codes(result)).toEqual(["MALFORMED_SELECTOR_LIST"]);
});

test("one malformed list reports exactly one diagnostic however many branches are empty", () => {
  const result = split(".a, , , .b");

  expect(codes(result)).toEqual(["MALFORMED_SELECTOR_LIST"]);
  expect(result.diagnostics[0]?.details).toEqual({ selector: ".a, , , .b", branch: 2 });
});

test("a supported pseudo-element splits into an originating selector and a pseudo string", () => {
  const result = split(".note::before");

  expect(result.branches).toEqual([
    { authored: ".note::before", selector: ".note", pseudo: "::before" } satisfies SelectorBranch,
  ]);
  expect(result.diagnostics).toEqual([]);
});

test("every pseudo-element supported in v0 splits into its originating selector", () => {
  const supported = [
    "::before",
    "::after",
    "::marker",
    "::first-line",
    "::first-letter",
    "::placeholder",
    "::selection",
    "::backdrop",
  ];

  for (const pseudo of supported) {
    const result = split(`.note${pseudo}`);

    expect(result.branches, pseudo).toEqual([
      { authored: `.note${pseudo}`, selector: ".note", pseudo } satisfies SelectorBranch,
    ]);
    expect(result.diagnostics, pseudo).toEqual([]);
  }
});

test("a pseudo-element name matches regardless of letter case and normalises to lowercase", () => {
  // ::FIRST-LINE is retained by Chromium and serialised as ::first-line, and
  // getComputedStyle accepts either spelling, so the case carries no meaning.
  const result = split(".note::FIRST-LINE");

  expect(result.branches).toEqual([
    {
      authored: ".note::FIRST-LINE",
      selector: ".note",
      pseudo: "::first-line",
    } satisfies SelectorBranch,
  ]);
  expect(result.diagnostics).toEqual([]);
});

test("a legacy single-colon pseudo-element normalises to the double-colon form", () => {
  // p:before is retained by Chromium, serialised as p::before, and generates
  // the same box, so rejecting the legacy spelling would report a defect in
  // CSS that works.
  const result = split(".legacy:before");

  expect(result.branches).toEqual([
    {
      authored: ".legacy:before",
      selector: ".legacy",
      pseudo: "::before",
    } satisfies SelectorBranch,
  ]);
  expect(result.diagnostics).toEqual([]);
});

test("each legacy single-colon spelling normalises to its double-colon form", () => {
  const legacy = [":before", ":after", ":first-line", ":first-letter"];
  const pseudos = legacy.map((spelling) => split(`.legacy${spelling}`).branches[0]?.pseudo);

  expect(pseudos).toEqual(["::before", "::after", "::first-line", "::first-letter"]);
});

test("a single-colon name with no legacy form stays part of the originating selector", () => {
  // Chromium drops a rule written as p:marker, so :marker is not a legacy
  // pseudo-element spelling and must not be normalised into one.
  const result = split(".note:marker");

  expect(result.branches[0]?.pseudo).toBeNull();
  expect(result.branches[0]?.selector).toBe(".note:marker");
});

test("a pseudo-class is never mistaken for a pseudo-element", () => {
  const result = split("a:hover, li:first-child, input:focus-visible");

  expect(result.branches.map((branch) => branch.pseudo)).toEqual([null, null, null]);
});

test("a pseudo-class preceding a pseudo-element stays in the originating selector", () => {
  const result = split("a:hover::before");

  expect(result.branches).toEqual([
    {
      authored: "a:hover::before",
      selector: "a:hover",
      pseudo: "::before",
    } satisfies SelectorBranch,
  ]);
});

test("a legacy spelling inside a functional pseudo-class is not read as a pseudo-element", () => {
  const result = split(":is(.a, .b)::before");

  expect(result.branches).toEqual([
    {
      authored: ":is(.a, .b)::before",
      selector: ":is(.a, .b)",
      pseudo: "::before",
    } satisfies SelectorBranch,
  ]);
});

test("a bare pseudo-element gets the universal selector as its originating selector", () => {
  // A rule written as ::before applies to every element in Chromium, exactly
  // as *::before does, so the omitted originating selector is the universal
  // selector rather than nothing.
  const result = split("::before");

  expect(result.branches).toEqual([
    { authored: "::before", selector: "*", pseudo: "::before" } satisfies SelectorBranch,
  ]);
});

test("::part() is deferred and reports DEFERRED_PSEUDO_ELEMENT", () => {
  const result = split(".badge::part(label)");

  expect(result.branches).toEqual([]);
  expect(codes(result)).toEqual(["DEFERRED_PSEUDO_ELEMENT"]);
  expect(result.diagnostics[0]?.details).toEqual({
    branch: ".badge::part(label)",
    pseudoElement: "::part(label)",
  });
});

test("::slotted() is deferred and reports DEFERRED_PSEUDO_ELEMENT", () => {
  const result = split("::slotted(span)");

  expect(result.branches).toEqual([]);
  expect(codes(result)).toEqual(["DEFERRED_PSEUDO_ELEMENT"]);
  expect(result.diagnostics[0]?.details).toEqual({
    branch: "::slotted(span)",
    pseudoElement: "::slotted(span)",
  });
});

test("a pseudo-element chain is deferred and reports DEFERRED_PSEUDO_ELEMENT", () => {
  // Chromium retains li::before::marker rather than dropping the rule, so the
  // chain is valid CSS that css-console postponed rather than invalid CSS.
  const result = split("li::before::marker");

  expect(result.branches).toEqual([]);
  expect(codes(result)).toEqual(["DEFERRED_PSEUDO_ELEMENT"]);
  expect(result.diagnostics[0]?.details).toEqual({
    branch: "li::before::marker",
    pseudoElement: "::before::marker",
  });
});

test("anything trailing a pseudo-element is deferred rather than silently dropped", () => {
  const result = split("p::before:hover");

  expect(result.branches).toEqual([]);
  expect(codes(result)).toEqual(["DEFERRED_PSEUDO_ELEMENT"]);
  expect(result.diagnostics[0]?.details).toEqual({
    branch: "p::before:hover",
    pseudoElement: "::before:hover",
  });
});

test("a deferred pseudo-element carries warning severity in the deferred category", () => {
  const result = split(".badge::part(label)");

  expect(result.diagnostics[0]?.severity).toBe("warning");
});

test("one deferred branch does not erase the valid branches", () => {
  // ::part() is valid CSS that Chromium retains, so the rule still applies to
  // its other branches and reporting them is truthful.
  const result = split(".badge, .badge::part(label), .badge::before");

  expect(result.branches).toEqual([
    { authored: ".badge", selector: ".badge", pseudo: null },
    { authored: ".badge::before", selector: ".badge", pseudo: "::before" },
  ] satisfies SelectorBranch[]);
  expect(codes(result)).toEqual(["DEFERRED_PSEUDO_ELEMENT"]);
});

test("each deferred branch reports its own diagnostic", () => {
  const result = split(".a::part(x), .b, .c::slotted(span)");

  expect(selectors(result)).toEqual([".b"]);
  expect(codes(result)).toEqual(["DEFERRED_PSEUDO_ELEMENT", "DEFERRED_PSEUDO_ELEMENT"]);
});

test("every diagnostic carries the source location it was given", () => {
  const result = split(".a::part(x), , .b");

  for (const diagnostic of result.diagnostics) {
    expect(diagnostic.source).toEqual(SOURCE);
  }
});

test("splitting the same selector twice returns equal results", () => {
  expect(split(".a, .b::before, .c::part(x)")).toEqual(split(".a, .b::before, .c::part(x)"));
});

test("the hardening fixture splits every rule the way a browser reads it", () => {
  const { css, url } = loadFixture("hardening", "selector-branches");
  const root = postcss.parse(css, { from: url });
  const results: SelectorSplit[] = [];

  root.walkRules((rule) => {
    results.push(splitSelectorBranches(rule.selector, SOURCE));
  });

  expect(results).toHaveLength(7);

  /** Returns the split for one fixture rule, failing loudly when it is absent. */
  const rule = (index: number): SelectorSplit => {
    const result = results[index];

    if (result === undefined) {
      throw new Error(`the fixture has no rule at index ${index}`);
    }

    return result;
  };

  /** Returns the pseudo-element of every branch in one fixture rule. */
  const pseudos = (index: number): (string | null)[] =>
    rule(index).branches.map((branch) => branch.pseudo);

  expect(selectors(rule(0))).toEqual([
    ".card",
    ".card:is(.featured, .promoted)",
    ".card:not(.muted, .hidden)",
  ]);
  expect(selectors(rule(1))).toEqual([".list > li:nth-child(2n of .visible, .pinned)"]);
  expect(selectors(rule(2))).toEqual([
    '.field[title="small, medium"]',
    '.field[data-variant="a,b"]',
  ]);
  expect(selectors(rule(3))).toEqual([".a\\,b", ".\\31 23", ".icon\\:\\:before"]);
  expect(pseudos(3)).toEqual([null, null, null]);

  expect(pseudos(4)).toEqual([
    "::before",
    "::after",
    "::marker",
    "::first-line",
    "::first-letter",
    "::placeholder",
    "::selection",
    "::backdrop",
  ]);
  expect(pseudos(5)).toEqual(["::before", "::after", "::first-line", "::first-letter"]);

  expect(selectors(rule(6))).toEqual([".badge"]);
  expect(codes(rule(6))).toEqual([
    "DEFERRED_PSEUDO_ELEMENT",
    "DEFERRED_PSEUDO_ELEMENT",
    "DEFERRED_PSEUDO_ELEMENT",
  ]);

  const allCodes = results.flatMap((result) => codes(result));

  expect(allCodes.filter((code) => code === "MALFORMED_SELECTOR_LIST")).toEqual([]);
});
