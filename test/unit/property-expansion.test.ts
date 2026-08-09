import { expect, test } from "vite-plus/test";

import {
  ALL_EXCLUDED_PROPERTIES,
  expandProperty,
  isResetByAll,
  LOGICAL_PROPERTIES,
  resolveLogicalProperty,
  SHORTHAND_LONGHANDS,
} from "../../src/core/expansion/index.ts";
import type { Direction, LogicalResolver, WritingMode } from "../../src/core/expansion/index.ts";

import type { Equal, Expect } from "./type-level.ts";

/**
 * Property expansion table tests (CSSC-012).
 *
 * The guard (section 3.4 of the implementation plan) answers one boolean
 * question: does anything else declare this property. Literal name matching
 * misses the two most ordinary conflicts in real stylesheets, a shorthand
 * competing with its longhands and a logical property competing with its
 * physical equivalent, so this suite proves the tables that close that gap.
 *
 * Every fact asserted about shorthand longhand sets and logical-to-physical
 * mapping was verified against Chromium through
 * `el.style.setProperty()` plus `getComputedStyle()`, following
 * AGENTS.md's instruction to check behavior against sources rather than
 * memory. The verification script is not part of this change; the values
 * below are its recorded output.
 */

/** Returns the compiled property names a table produces, sorted for a set comparison. */
function keysOf(table: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(table).sort();
}

test("every shorthand family the plan names is present in the table", () => {
  // A silently truncated table must fail here rather than pass with fewer
  // entries, per the CSSC-012 acceptance criterion.
  expect(keysOf(SHORTHAND_LONGHANDS)).toEqual(
    [
      "background",
      "border",
      "border-width",
      "flex",
      "font",
      "gap",
      "grid",
      "grid-template",
      "inset",
      "margin",
      "overflow",
      "padding",
      "place-items",
      "transition",
    ].sort(),
  );
});

test("margin expands to its four physical longhands", () => {
  expect(expandProperty("margin")).toEqual([
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
  ]);
});

test("padding expands to its four physical longhands", () => {
  expect(expandProperty("padding")).toEqual([
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
  ]);
});

test("border expands to width, style, color, and border-image longhands", () => {
  // Verified in Chromium: el.style.setProperty("border", "1px solid red")
  // populates border-image-* longhands too, because the border shorthand
  // resets border-image to its initial value alongside width, style, and
  // color.
  expect(expandProperty("border")).toEqual([
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "border-top-style",
    "border-right-style",
    "border-bottom-style",
    "border-left-style",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
    "border-image-source",
    "border-image-slice",
    "border-image-width",
    "border-image-outset",
    "border-image-repeat",
  ]);
});

test("border-width expands to its four physical width longhands", () => {
  expect(expandProperty("border-width")).toEqual([
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
  ]);
});

test("background expands to its component longhands, splitting position into x and y", () => {
  expect(expandProperty("background")).toEqual([
    "background-image",
    "background-position-x",
    "background-position-y",
    "background-size",
    "background-repeat",
    "background-attachment",
    "background-origin",
    "background-clip",
    "background-color",
  ]);
});

test("font expands to its full set of component and variant longhands", () => {
  expect(expandProperty("font")).toEqual([
    "font-style",
    "font-variant-caps",
    "font-variant-ligatures",
    "font-variant-numeric",
    "font-variant-east-asian",
    "font-variant-alternates",
    "font-size-adjust",
    "font-language-override",
    "font-kerning",
    "font-optical-sizing",
    "font-feature-settings",
    "font-variation-settings",
    "font-variant-position",
    "font-variant-emoji",
    "font-weight",
    "font-stretch",
    "font-size",
    "line-height",
    "font-family",
  ]);
});

test("flex expands to grow, shrink, and basis", () => {
  expect(expandProperty("flex")).toEqual(["flex-grow", "flex-shrink", "flex-basis"]);
});

test("grid expands to its template and auto-placement longhands", () => {
  expect(expandProperty("grid")).toEqual([
    "grid-template-columns",
    "grid-template-rows",
    "grid-template-areas",
    "grid-auto-flow",
    "grid-auto-columns",
    "grid-auto-rows",
  ]);
});

test("grid-template expands to its three template longhands only", () => {
  expect(expandProperty("grid-template")).toEqual([
    "grid-template-rows",
    "grid-template-columns",
    "grid-template-areas",
  ]);
});

test("inset expands to the four physical inset longhands", () => {
  expect(expandProperty("inset")).toEqual(["top", "right", "bottom", "left"]);
});

test("gap expands to row-gap and column-gap", () => {
  expect(expandProperty("gap")).toEqual(["row-gap", "column-gap"]);
});

test("overflow expands to overflow-x and overflow-y", () => {
  expect(expandProperty("overflow")).toEqual(["overflow-x", "overflow-y"]);
});

test("place-items expands to align-items and justify-items", () => {
  expect(expandProperty("place-items")).toEqual(["align-items", "justify-items"]);
});

test("transition expands to its five component longhands", () => {
  expect(expandProperty("transition")).toEqual([
    "transition-behavior",
    "transition-duration",
    "transition-timing-function",
    "transition-delay",
    "transition-property",
  ]);
});

test("a shorthand lookup is case-insensitive, matching ordinary CSS property casing", () => {
  expect(expandProperty("MARGIN")).toEqual(expandProperty("margin"));
});

test("expansion is bidirectional: a longhand reports the shorthand it belongs to", () => {
  expect(expandProperty("margin-left")).toEqual(["margin"]);
  expect(expandProperty("padding-top")).toEqual(["padding"]);
  expect(expandProperty("flex-grow")).toEqual(["flex"]);
});

test("a longhand shared by two shorthands reports both, in table order", () => {
  // border-top-width is reset by both the border shorthand and the narrower
  // border-width shorthand, verified in Chromium against each declaration
  // independently.
  expect(expandProperty("border-top-width")).toEqual(["border", "border-width"]);
});

test("custom properties never expand", () => {
  expect(expandProperty("--brand-color")).toEqual([]);
  expect(expandProperty("--Brand-Color")).toEqual([]);
});

test("an unknown standard property passes through unchanged", () => {
  // Distinct from a custom property: an unrecognized standard property name
  // is not a competitor of anything else the table knows about, so it maps
  // to itself rather than to an empty set.
  expect(expandProperty("mask-composite")).toEqual(["mask-composite"]);
});

test("a vendor-prefixed property passes through unchanged rather than expanding", () => {
  // Decision: vendor-prefixed properties are not expanded. They are
  // non-standard, and the guard's own literal-name index already matches a
  // repeated vendor-prefixed declaration without help from this table.
  expect(expandProperty("-webkit-transform")).toEqual(["-webkit-transform"]);
  expect(expandProperty("-webkit-box-orient")).toEqual(["-webkit-box-orient"]);
});

test("all resets every standard property except direction and unicode-bidi", () => {
  // Verified in Chromium: setting `direction: rtl` then `all: initial`
  // leaves direction unchanged at rtl, and the same holds for unicode-bidi.
  // The CSS Cascade specification names exactly these two properties, plus
  // custom properties, as excluded from `all`.
  expect(keysOf(ALL_EXCLUDED_PROPERTIES)).toEqual(["direction", "unicode-bidi"]);
  expect(isResetByAll("color")).toBe(true);
  expect(isResetByAll("margin")).toBe(true);
  expect(isResetByAll("margin-left")).toBe(true);
  expect(isResetByAll("mask-composite")).toBe(true);
});

test("all does not reset direction or unicode-bidi", () => {
  expect(isResetByAll("direction")).toBe(false);
  expect(isResetByAll("unicode-bidi")).toBe(false);
});

test("all does not reset custom properties", () => {
  // Verified in Chromium: setting `--brand: red`, then `all: initial` on the
  // same element, leaves getComputedStyle().getPropertyValue("--brand")
  // reporting "red".
  expect(isResetByAll("--brand")).toBe(false);
});

const LOGICAL_TABLE_KEYS = [
  "margin-inline-start",
  "margin-inline-end",
  "margin-block-start",
  "margin-block-end",
  "padding-inline-start",
  "padding-inline-end",
  "padding-block-start",
  "padding-block-end",
  "border-inline-start-width",
  "border-inline-end-width",
  "border-block-start-width",
  "border-block-end-width",
  "border-inline-start-style",
  "border-inline-end-style",
  "border-block-start-style",
  "border-block-end-style",
  "border-inline-start-color",
  "border-inline-end-color",
  "border-block-start-color",
  "border-block-end-color",
  "inset-inline-start",
  "inset-inline-end",
  "inset-block-start",
  "inset-block-end",
  "inline-size",
  "block-size",
  "min-inline-size",
  "max-inline-size",
  "min-block-size",
  "max-block-size",
].sort();

test("the logical table covers exactly the flow-relative box-edge and sizing properties", () => {
  // A silently truncated logical table fails here rather than passing with
  // fewer entries. Logical border-radius corners and the two-value
  // shorthands such as margin-inline are documented as out of scope, below.
  expect(keysOf(LOGICAL_PROPERTIES)).toEqual(LOGICAL_TABLE_KEYS);
});

test("the logical table returns a mapping function, not a resolved physical name", () => {
  // Acceptance: resolution requires the element's writing mode and
  // direction, which do not exist at compile time, so the table entry must
  // be a function the browser layer calls once it has an element.
  for (const key of LOGICAL_TABLE_KEYS) {
    expect(typeof LOGICAL_PROPERTIES[key], key).toBe("function");
  }
});

test("resolveLogicalProperty returns undefined for a physical property", () => {
  expect(resolveLogicalProperty("margin-left")).toBeUndefined();
});

test("resolveLogicalProperty returns undefined for an unknown property", () => {
  expect(resolveLogicalProperty("mask-composite")).toBeUndefined();
});

/**
 * The full grid of writing-mode and direction combinations, and the
 * physical longhand margin-inline-start resolves to under each. Captured
 * from Chromium: el.style.writingMode, el.style.direction, and
 * el.style.setProperty("margin-inline-start", "10px") on a fresh element,
 * read back through getComputedStyle().getPropertyValue() against all four
 * physical margin longhands.
 */
const MARGIN_INLINE_START_GRID: ReadonlyArray<[WritingMode, Direction, string]> = [
  ["horizontal-tb", "ltr", "margin-left"],
  ["horizontal-tb", "rtl", "margin-right"],
  ["vertical-rl", "ltr", "margin-top"],
  ["vertical-rl", "rtl", "margin-bottom"],
  ["vertical-lr", "ltr", "margin-top"],
  ["vertical-lr", "rtl", "margin-bottom"],
  ["sideways-rl", "ltr", "margin-top"],
  ["sideways-rl", "rtl", "margin-bottom"],
  ["sideways-lr", "ltr", "margin-bottom"],
  ["sideways-lr", "rtl", "margin-top"],
];

test("margin-inline-start resolves correctly for every writing-mode and direction combination", () => {
  const resolve = resolveLogicalProperty("margin-inline-start") as LogicalResolver;

  for (const [writingMode, direction, expected] of MARGIN_INLINE_START_GRID) {
    expect(resolve(writingMode, direction), `${writingMode} ${direction}`).toBe(expected);
  }
});

test("margin-inline-end is always the physical opposite of margin-inline-start", () => {
  const start = resolveLogicalProperty("margin-inline-start") as LogicalResolver;
  const end = resolveLogicalProperty("margin-inline-end") as LogicalResolver;
  const opposite: Record<string, string> = {
    "margin-top": "margin-bottom",
    "margin-bottom": "margin-top",
    "margin-left": "margin-right",
    "margin-right": "margin-left",
  };

  for (const [writingMode, direction] of MARGIN_INLINE_START_GRID) {
    expect(end(writingMode, direction)).toBe(opposite[start(writingMode, direction)]);
  }
});

test("margin-block-start does not depend on direction, only on writing mode", () => {
  // Verified in Chromium: the block axis is unaffected by the direction
  // property in every writing mode; direction only reassigns the inline
  // axis.
  const resolve = resolveLogicalProperty("margin-block-start") as LogicalResolver;
  const expected: Record<WritingMode, string> = {
    "horizontal-tb": "margin-top",
    "vertical-rl": "margin-right",
    "vertical-lr": "margin-left",
    "sideways-rl": "margin-right",
    "sideways-lr": "margin-left",
  };

  for (const writingMode of Object.keys(expected) as WritingMode[]) {
    expect(resolve(writingMode, "ltr")).toBe(expected[writingMode]);
    expect(resolve(writingMode, "rtl")).toBe(expected[writingMode]);
  }
});

test("inset-inline-start resolves against the bare physical inset longhands", () => {
  // Captured from Chromium the same way as the margin grid.
  const resolve = resolveLogicalProperty("inset-inline-start") as LogicalResolver;

  expect(resolve("horizontal-tb", "ltr")).toBe("left");
  expect(resolve("horizontal-tb", "rtl")).toBe("right");
  expect(resolve("vertical-rl", "ltr")).toBe("top");
  expect(resolve("vertical-rl", "rtl")).toBe("bottom");
});

test("border-inline-start-color resolves against the physical border color longhands", () => {
  // Verified in Chromium: writing-mode vertical-lr, direction rtl, with
  // border-inline-start-color set, resolves border-bottom-color and leaves
  // the other three border color longhands at their initial black.
  const resolve = resolveLogicalProperty("border-inline-start-color") as LogicalResolver;

  expect(resolve("vertical-lr", "rtl")).toBe("border-bottom-color");
  expect(resolve("horizontal-tb", "ltr")).toBe("border-left-color");
});

test("padding-inline-start follows the same axis mapping as margin-inline-start", () => {
  // Verified in Chromium against the same grid used for margin, since the
  // physical mapping algorithm is shared across every box-edge property
  // family rather than being margin-specific.
  const marginStart = resolveLogicalProperty("margin-inline-start") as LogicalResolver;
  const paddingStart = resolveLogicalProperty("padding-inline-start") as LogicalResolver;

  for (const [writingMode, direction] of MARGIN_INLINE_START_GRID) {
    const marginSide = marginStart(writingMode, direction).replace("margin-", "");
    const paddingSide = paddingStart(writingMode, direction).replace("padding-", "");

    expect(paddingSide).toBe(marginSide);
  }
});

test("inline-size resolves to width in a horizontal writing mode and height in a vertical one", () => {
  // Verified in Chromium: el.style.setProperty("inline-size", "50px")
  // resolves getComputedStyle().width in horizontal-tb and
  // getComputedStyle().height in every tested vertical mode, independent of
  // direction.
  const resolve = resolveLogicalProperty("inline-size") as LogicalResolver;

  expect(resolve("horizontal-tb", "ltr")).toBe("width");
  expect(resolve("horizontal-tb", "rtl")).toBe("width");
  expect(resolve("vertical-rl", "ltr")).toBe("height");
  expect(resolve("vertical-lr", "rtl")).toBe("height");
});

test("block-size resolves to height in a horizontal writing mode and width in a vertical one", () => {
  const resolve = resolveLogicalProperty("block-size") as LogicalResolver;

  expect(resolve("horizontal-tb", "ltr")).toBe("height");
  expect(resolve("vertical-rl", "ltr")).toBe("width");
});

test("min and max inline/block sizes resolve against their physical min/max counterparts", () => {
  // Verified in Chromium the same way as inline-size and block-size.
  const minInline = resolveLogicalProperty("min-inline-size") as LogicalResolver;
  const maxInline = resolveLogicalProperty("max-inline-size") as LogicalResolver;
  const minBlock = resolveLogicalProperty("min-block-size") as LogicalResolver;
  const maxBlock = resolveLogicalProperty("max-block-size") as LogicalResolver;

  expect(minInline("horizontal-tb", "ltr")).toBe("min-width");
  expect(maxInline("horizontal-tb", "ltr")).toBe("max-width");
  expect(minBlock("horizontal-tb", "ltr")).toBe("min-height");
  expect(maxBlock("horizontal-tb", "ltr")).toBe("max-height");

  expect(minInline("vertical-rl", "ltr")).toBe("min-height");
  expect(maxBlock("vertical-rl", "ltr")).toBe("max-width");
});

/**
 * The type-level assertions gather into one exported tuple so a single name
 * carries them all and the unused-local check does not flag them.
 */
export type ExpansionTypeAssertions = [
  Expect<Equal<WritingMode, "horizontal-tb" | "vertical-rl" | "vertical-lr" | "sideways-rl" | "sideways-lr">>,
  Expect<Equal<Direction, "ltr" | "rtl">>,
  Expect<Equal<LogicalResolver, (writingMode: WritingMode, direction: Direction) => string>>,
];
