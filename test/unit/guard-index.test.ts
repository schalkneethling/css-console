import postcss from "postcss";
import type { Declaration, Root } from "postcss";
import { expect, test } from "vite-plus/test";

import {
  buildGuardIndex,
  competesInWritingMode,
  guardCandidates,
  indexedDeclarationOf,
} from "../../src/core/compiler/index.ts";
import type { GuardIndex, IndexedDeclaration } from "../../src/core/compiler/index.ts";

import { fixtureUrl } from "../support/fixtures.ts";

/**
 * Guard index tests.
 *
 * CSSC-014 indexes every declaration in a source so the guard can answer one
 * boolean: does anything else declare this property. These tests assert what
 * the index finds and, just as importantly, what it refuses to store. No
 * competitor count, source location, or ordering is retained, because the
 * guard presents none of them, so the suite checks the entry shape directly
 * rather than trusting the doc comment.
 *
 * Logical declarations are the case worth reading twice. A logical
 * declaration cannot be keyed under a physical property name at compile
 * time, because which physical property it addresses depends on the
 * element's writing mode and direction. The index therefore keys it under
 * its own logical name, offers it as a candidate wherever it could compete,
 * and defers the decision to `competesInWritingMode()`, which the browser
 * layer calls once it holds an element.
 */

const FIXTURE_URL = fixtureUrl("inline");

/** Parses a source and builds its guard index, keeping both for a test. */
function parse(css: string): { root: Root; index: GuardIndex } {
  const root = postcss.parse(css, { from: FIXTURE_URL });

  return { root, index: buildGuardIndex(root, FIXTURE_URL) };
}

/** Builds the guard index for a source. */
function indexOf(css: string): GuardIndex {
  return parse(css).index;
}

/** The authored property name of every candidate, sorted for comparison. */
function candidateProperties(
  index: GuardIndex,
  property: string,
  self?: IndexedDeclaration,
): string[] {
  return [...guardCandidates(index, property, self)].map((entry) => entry.property).sort();
}

/** Every declaration of a property in a parsed tree, in source order. */
function declarationsOf(root: Root, property: string): Declaration[] {
  const found: Declaration[] = [];

  root.walkDecls((declaration) => {
    if (declaration.prop === property) {
      found.push(declaration);
    }
  });

  return found;
}

/**
 * The index entry for the nth declaration of a property, failing loudly when
 * the source does not have one, so a mistyped fixture cannot pass a test by
 * producing an undefined self.
 */
function entryFor(
  root: Root,
  index: GuardIndex,
  property: string,
  occurrence = 0,
): IndexedDeclaration {
  const declaration = declarationsOf(root, property)[occurrence];

  if (declaration === undefined) {
    throw new Error(`no declaration of ${property} at occurrence ${occurrence}`);
  }

  const entry = indexedDeclarationOf(index, declaration);

  if (entry === undefined) {
    throw new Error(`declaration of ${property} at occurrence ${occurrence} is not indexed`);
  }

  return entry;
}

test("a source with no annotations still contributes its declarations", () => {
  const index = indexOf(`.a { color: red; }
.b { color: blue; }`);

  expect(candidateProperties(index, "color")).toEqual(["color", "color"]);
});

test("candidates are an unordered set rather than a ranked list", () => {
  const index = indexOf(`.a { color: red; }`);

  expect(guardCandidates(index, "color")).toBeInstanceOf(Set);
});

test("an index entry stores only the property, the selector, the context, and the importance", () => {
  const index = indexOf(`.a { color: red; }`);
  const [entry] = [...guardCandidates(index, "color")];

  expect(entry).toBeDefined();
  expect(Object.keys(entry ?? {}).sort()).toEqual(["context", "important", "property", "selector"]);
});

test("a declaration carrying !important is indexed with its importance", () => {
  const index = indexOf(`.a { color: red !important; }`);
  const [entry] = [...guardCandidates(index, "color")];

  expect(entry?.important).toBe(true);
});

test("a declaration without !important is indexed as not important", () => {
  const index = indexOf(`.a { color: red; }`);
  const [entry] = [...guardCandidates(index, "color")];

  expect(entry?.important).toBe(false);
});

test("a declaration is findable under each of the probed property's longhand keys", () => {
  const index = indexOf(`.a { margin: 1rem; }`);

  expect(candidateProperties(index, "margin-top")).toEqual(["margin"]);
  expect(candidateProperties(index, "margin-right")).toEqual(["margin"]);
  expect(candidateProperties(index, "margin-bottom")).toEqual(["margin"]);
  expect(candidateProperties(index, "margin-left")).toEqual(["margin"]);
});

test("a shorthand is findable under all its longhand keys and under none other", () => {
  const index = indexOf(`.a { margin: 1rem; }`);

  expect([...index.byProperty.keys()].sort()).toEqual([
    "margin-bottom",
    "margin-left",
    "margin-right",
    "margin-top",
  ]);
});

test("a longhand competes with the shorthand that resets it", () => {
  const index = indexOf(`.a { margin-left: 1px; }`);

  expect(candidateProperties(index, "margin")).toEqual(["margin-left"]);
});

test("two opposite edges of one family do not compete", () => {
  const index = indexOf(`.a { margin-left: 1px; }`);

  expect(candidateProperties(index, "margin-right")).toEqual([]);
});

test("a sub-shorthand competes only where its longhands actually overlap", () => {
  const index = indexOf(`.a { border-top: 1px solid red; }`);

  expect(candidateProperties(index, "border-width")).toEqual(["border-top"]);
  expect(candidateProperties(index, "border-top-style")).toEqual(["border-top"]);
  expect(candidateProperties(index, "border-left-width")).toEqual([]);
});

test("all is findable under every property key it resets", () => {
  const index = indexOf(`.a { all: initial; }`);

  expect(candidateProperties(index, "color")).toEqual(["all"]);
  expect(candidateProperties(index, "margin-left")).toEqual(["all"]);
  expect(candidateProperties(index, "inline-size")).toEqual(["all"]);
  expect(candidateProperties(index, "all")).toEqual(["all"]);
});

test("a probed all reaches every declaration it resets, and none it does not", () => {
  const { root, index } = parse(`.a { all: initial; }
.b {
  color: red;
  margin-inline-start: 1px;
  --brand: blue;
  direction: rtl;
}`);

  // `color` and the logical margin are reset by `all`; the custom property
  // and `direction` survive it and stay out.
  expect(candidateProperties(index, "all")).toEqual(["all", "color", "margin-inline-start"]);

  const self = entryFor(root, index, "all");

  expect(candidateProperties(index, "all", self)).toEqual(["color", "margin-inline-start"]);
});

test("an all candidate competes per element through competesInWritingMode", () => {
  const { root, index } = parse(`.a { all: initial; }
.b { color: red; }`);

  const allEntry = entryFor(root, index, "all");

  expect(competesInWritingMode(allEntry, "color", "horizontal-tb", "ltr")).toBe(true);
  expect(competesInWritingMode(allEntry, "direction", "horizontal-tb", "ltr")).toBe(false);
});

test("all does not compete with the properties it never resets", () => {
  const index = indexOf(`.a { all: initial; }`);

  expect(candidateProperties(index, "direction")).toEqual([]);
  expect(candidateProperties(index, "unicode-bidi")).toEqual([]);
  expect(candidateProperties(index, "--brand")).toEqual([]);
});

test("a standard property name matches case-insensitively", () => {
  const index = indexOf(`.a { COLOR: red; }
.b { PADDING-TOP: 1px; }`);

  expect(candidateProperties(index, "color")).toEqual(["COLOR"]);
  expect(candidateProperties(index, "padding")).toEqual(["PADDING-TOP"]);
});

test("a custom property competes only under an exact, case-sensitive name", () => {
  const index = indexOf(`.a { --Brand: red; }`);

  expect(candidateProperties(index, "--Brand")).toEqual(["--Brand"]);
  expect(candidateProperties(index, "--brand")).toEqual([]);
});

test("an unrecognized or vendor-prefixed property matches literally", () => {
  const index = indexOf(`.a { -webkit-transform: none; }
.b { corner-shape: squircle; }`);

  expect(candidateProperties(index, "-webkit-transform")).toEqual(["-webkit-transform"]);
  expect(candidateProperties(index, "transform")).toEqual([]);
  expect(candidateProperties(index, "corner-shape")).toEqual(["corner-shape"]);
});

test("a logical declaration is never keyed under a physical property name", () => {
  const index = indexOf(`.a { margin-inline-start: 1px; }`);

  expect([...index.byProperty.keys()]).toEqual(["margin-inline-start"]);
});

test("a logical declaration is a candidate for the physical property it may address", () => {
  const index = indexOf(`.a { margin-inline-start: 1px; }`);

  // Candidacy is deliberately an over-approximation: the inline start edge is
  // the left or right margin in a horizontal writing mode and the top or
  // bottom margin in a vertical one, so all four are candidates and the
  // element decides. A property the declaration can never address under any
  // writing mode is not a candidate at all.
  expect(candidateProperties(index, "margin-left")).toEqual(["margin-inline-start"]);
  expect(candidateProperties(index, "margin-right")).toEqual(["margin-inline-start"]);
  expect(candidateProperties(index, "margin-top")).toEqual(["margin-inline-start"]);
  expect(candidateProperties(index, "padding-left")).toEqual([]);
  expect(candidateProperties(index, "color")).toEqual([]);
});

test("a logical candidate defers the decision to per-element resolution", () => {
  const { root, index } = parse(`.a { margin-inline-start: 1px; }`);
  const entry = entryFor(root, index, "margin-inline-start");

  expect(competesInWritingMode(entry, "margin-left", "horizontal-tb", "ltr")).toBe(true);
  expect(competesInWritingMode(entry, "margin-left", "horizontal-tb", "rtl")).toBe(false);
  expect(competesInWritingMode(entry, "margin-right", "horizontal-tb", "rtl")).toBe(true);
  expect(competesInWritingMode(entry, "margin-top", "vertical-rl", "ltr")).toBe(true);
});

test("a logical candidate competes with the shorthand that resets its physical side", () => {
  const { root, index } = parse(`.a { margin-inline-start: 1px; }`);
  const entry = entryFor(root, index, "margin-inline-start");

  expect(candidateProperties(index, "margin")).toEqual(["margin-inline-start"]);
  expect(competesInWritingMode(entry, "margin", "horizontal-tb", "ltr")).toBe(true);
  expect(competesInWritingMode(entry, "padding", "horizontal-tb", "ltr")).toBe(false);
});

test("a physical declaration is a candidate for a probed logical property", () => {
  const { root, index } = parse(`.a { width: 70px; }`);
  const entry = entryFor(root, index, "width");

  expect(candidateProperties(index, "inline-size")).toEqual(["width"]);
  expect(competesInWritingMode(entry, "inline-size", "horizontal-tb", "ltr")).toBe(true);
  expect(competesInWritingMode(entry, "inline-size", "vertical-rl", "ltr")).toBe(false);
  expect(competesInWritingMode(entry, "block-size", "vertical-rl", "ltr")).toBe(true);
});

test("a two-value logical shorthand competes on both of its edges", () => {
  const { root, index } = parse(`.a { margin-inline: 1px 2px; }`);
  const entry = entryFor(root, index, "margin-inline");

  expect(candidateProperties(index, "margin-left")).toEqual(["margin-inline"]);
  expect(competesInWritingMode(entry, "margin-left", "horizontal-tb", "ltr")).toBe(true);
  expect(competesInWritingMode(entry, "margin-right", "horizontal-tb", "ltr")).toBe(true);
  expect(competesInWritingMode(entry, "margin-top", "horizontal-tb", "ltr")).toBe(false);
  expect(competesInWritingMode(entry, "margin-top", "vertical-rl", "ltr")).toBe(true);
});

test("two logical declarations compete with each other under their own names", () => {
  const index = indexOf(`.a { inline-size: 10px; }
.b { inline-size: 20px; }`);

  expect(candidateProperties(index, "inline-size")).toEqual(["inline-size", "inline-size"]);
});

test("a declaration inside a condition retains the condition", () => {
  const index = indexOf(`@media (min-width: 40em) {
  .a { color: red; }
}`);
  const [entry] = [...guardCandidates(index, "color")];

  expect(entry?.context.entries).toEqual([{ kind: "media", condition: "(min-width: 40em)" }]);
});

test("nested conditions are retained outermost first", () => {
  const index = indexOf(`@media (min-width: 40em) {
  @supports (display: grid) {
    .a { color: red; }
  }
}`);
  const [entry] = [...guardCandidates(index, "color")];

  expect(entry?.context.entries).toEqual([
    { kind: "media", condition: "(min-width: 40em)" },
    { kind: "supports", condition: "(display: grid)" },
  ]);
});

test("a layer does not exclude a declaration and rides along in its context", () => {
  const index = indexOf(`@layer base {
  .a { color: red; }
}`);
  const [entry] = [...guardCandidates(index, "color")];

  expect(entry?.context.entries).toEqual([{ kind: "layer", name: "base" }]);
});

test("declarations inside rule contexts outside the supported target set are excluded", () => {
  const sources = [
    `@keyframes spin { from { color: red; } }`,
    `@scope (.card) { .a { color: red; } }`,
    `@container (min-width: 40em) { .a { color: red; } }`,
    `@starting-style { .a { color: red; } }`,
    `@function --f() returns <color> { .a { color: red; } }`,
  ];

  for (const source of sources) {
    expect(candidateProperties(indexOf(source), "color"), source).toEqual([]);
  }
});

test("declarations inside a descriptor at-rule are excluded", () => {
  const sources = [
    `@font-face { font-family: Test; src: url(t.woff2); }`,
    `@property --brand { syntax: "<color>"; inherits: false; initial-value: red; }`,
    `@function --f() returns <color> { result: red; }`,
  ];

  for (const source of sources) {
    const index = indexOf(source);

    expect(index.byProperty.size, source).toBe(0);
  }
});

test("a declaration in a rule the browser discards is excluded", () => {
  const index = indexOf(`.card {
  &div { color: red; }
}`);

  expect(candidateProperties(index, "color")).toEqual([]);
});

test("a nested rule contributes its resolved selector", () => {
  const index = indexOf(`.card {
  & .title { color: red; }
}`);
  const [entry] = [...guardCandidates(index, "color")];

  expect(entry?.selector).toBe(":is(.card) .title");
});

test("a nested rule with no nesting selector contributes the same resolved selector", () => {
  const index = indexOf(`.card {
  .title { color: red; }
}`);
  const [entry] = [...guardCandidates(index, "color")];

  expect(entry?.selector).toBe(":is(.card) .title");
});

test("a declaration in a rule inside a condition keeps both selector and conditions", () => {
  const index = indexOf(`@media print {
  .card {
    & .title { color: red; }
  }
}`);
  const [entry] = [...guardCandidates(index, "color")];

  expect(entry?.selector).toBe(":is(.card) .title");
  expect(entry?.context.entries).toEqual([{ kind: "media", condition: "print" }]);
});

test("the annotated declaration is identifiable and excluded from its own guard", () => {
  const { root, index } = parse(`.a { color: red; }`);
  const self = entryFor(root, index, "color");

  expect(candidateProperties(index, "color")).toEqual(["color"]);
  expect(candidateProperties(index, "color", self)).toEqual([]);
});

test("excluding the annotated declaration leaves every other competitor", () => {
  const { root, index } = parse(`.a { color: red; }
.b { color: blue; }
.c { all: initial; }`);
  const self = entryFor(root, index, "color");

  expect(candidateProperties(index, "color", self)).toEqual(["all", "color"]);
});

test("a repeat of the annotated property in the same rule still competes", () => {
  const { root, index } = parse(`.a { color: red; color: blue; }`);
  const self = entryFor(root, index, "color");

  expect(candidateProperties(index, "color", self)).toEqual(["color"]);
});

test("a declaration in an excluded rule is not indexed at all", () => {
  const { root, index } = parse(`@keyframes spin { from { color: red; } }`);
  const [declaration] = declarationsOf(root, "color");

  expect(declaration).toBeDefined();
  expect(declaration && indexedDeclarationOf(index, declaration)).toBeUndefined();
});
