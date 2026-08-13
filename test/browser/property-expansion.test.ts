import { expect, test } from "vite-plus/test";

import {
  expandProperty,
  isResetByAll,
  resolveLogicalProperty,
  resolveLogicalPropertyPair,
  SHORTHAND_LONGHANDS,
} from "../../src/core/expansion/index.ts";
import type { Direction, WritingMode } from "../../src/core/expansion/index.ts";

/**
 * Property expansion tables, checked against the engine that produced them.
 *
 * The unit suite proves the tables are internally consistent: complete key
 * sets, bidirectional lookup, the pass-through and custom-property cases. It
 * cannot prove they are still *true*, because the data is hand-authored from
 * what Chromium reported at the time it was written, and a browser release
 * can change a shorthand's longhand set. `border` gaining the
 * `border-image-*` longhands is exactly that kind of change, and it already
 * happened once before this table existed.
 *
 * These tests run the regeneration recipe from
 * docs/decisions/0015-property-expansion-data-source.md against the live
 * engine and compare it to the table, which turns a documented procedure into
 * a maintained check: when the browser moves, this lane fails and says so,
 * rather than the tables quietly describing a browser nobody runs any more.
 *
 * A representative slice rather than all fourteen families, chosen so that
 * the entries most likely to move are the ones covered: `font` because it is
 * the largest and has gained members most recently, `border` and `background`
 * because their sets are the two a reader would most likely write down wrong.
 * The families left out are small and stable, and drift tends to arrive per
 * release across the board rather than in one family at a time.
 */

/** A fresh element, removed after the assertion so cases stay independent. */
function withElement<T>(read: (element: HTMLElement) => T): T {
  const element = document.createElement("div");

  document.body.append(element);

  try {
    return read(element);
  } finally {
    element.remove();
  }
}

/**
 * The longhands the engine reports for a shorthand, read the way the decision
 * record's recipe describes: set the shorthand, then enumerate the inline
 * style declaration.
 */
function browserLonghands(shorthand: string, value: string): string[] {
  return withElement((element) => {
    element.style.setProperty(shorthand, value);

    return [...Array(element.style.length).keys()].map((index) => element.style.item(index));
  });
}

const FAMILIES: ReadonlyArray<readonly [string, string]> = [
  ["margin", "3px"],
  ["padding", "3px"],
  ["border", "1px solid red"],
  ["border-width", "3px"],
  ["background", "red"],
  // The largest family at nineteen longhands, and the one whose membership
  // has moved most recently, gaining font-variant-emoji and
  // font-variation-settings. A slice that left out the entry most likely to
  // drift would not be doing the job this file exists for.
  ["font", "16px Arial"],
  ["flex", "1"],
  ["gap", "3px"],
  ["overflow", "scroll"],
  ["transition", "opacity 1s"],
];

for (const [shorthand, value] of FAMILIES) {
  test(`the ${shorthand} longhand set still matches what the engine reports`, () => {
    const reported = browserLonghands(shorthand, value);

    expect([...reported].sort()).toEqual([...SHORTHAND_LONGHANDS[shorthand]!].sort());
  });
}

test("border still resets the border-image longhands", () => {
  // Singled out because it is the entry a reader is most likely to assume is
  // wrong, and the one a naive table would omit.
  expect(browserLonghands("border", "1px solid red")).toContain("border-image-source");
});

test("background still splits its position into two axis longhands", () => {
  const reported = browserLonghands("background", "red");

  expect(reported).toContain("background-position-x");
  expect(reported).toContain("background-position-y");
  expect(reported).not.toContain("background-position");
});

test("expandProperty agrees with the engine for every checked family", () => {
  for (const [shorthand, value] of FAMILIES) {
    expect([...expandProperty(shorthand)].sort(), shorthand).toEqual(
      [...browserLonghands(shorthand, value)].sort(),
    );
  }
});

const WRITING_MODES: readonly WritingMode[] = [
  "horizontal-tb",
  "vertical-rl",
  "vertical-lr",
  "sideways-rl",
  "sideways-lr",
];

const DIRECTIONS: readonly Direction[] = ["ltr", "rtl"];

test("the logical table still resolves to the physical property the engine uses", () => {
  for (const writingMode of WRITING_MODES) {
    for (const direction of DIRECTIONS) {
      const physical = withElement((element) => {
        element.style.setProperty("writing-mode", writingMode);
        element.style.setProperty("direction", direction);
        element.style.setProperty("margin-inline-start", "13px");

        const computed = getComputedStyle(element);

        return (["top", "right", "bottom", "left"] as const).find(
          (side) => computed.getPropertyValue(`margin-${side}`) === "13px",
        );
      });

      expect(
        resolveLogicalProperty("margin-inline-start")?.(writingMode, direction),
        `${writingMode}/${direction}`,
      ).toBe(`margin-${physical}`);
    }
  }
});

/**
 * CSSC-041 sub-shorthands: each entry is itself a member of a family
 * already checked above, so its longhand set must both match the engine and
 * carry the enclosing shorthand's name. `expandProperty()` appends the
 * parent shorthand to the engine-reported longhands, so the comparison
 * strips it before comparing sets and checks it separately.
 */
const SUB_SHORTHAND_FAMILIES: ReadonlyArray<readonly [string, string, string]> = [
  ["background-position", "center top", "background"],
  ["border-top", "1px solid red", "border"],
  ["border-right", "1px solid red", "border"],
  ["border-bottom", "1px solid red", "border"],
  ["border-left", "1px solid red", "border"],
  ["border-color", "red", "border"],
  ["border-style", "solid", "border"],
  ["border-image", "url(x.png) 30 30 round", "border"],
  ["font-variant", "small-caps", "font"],
];

for (const [shorthand, value, parent] of SUB_SHORTHAND_FAMILIES) {
  test(`the ${shorthand} longhand set still matches the engine and still belongs to ${parent}`, () => {
    const reported = expandProperty(shorthand);
    const ownLonghands = reported.filter((name) => name !== parent);

    expect([...ownLonghands].sort()).toEqual([...browserLonghands(shorthand, value)].sort());
    expect(reported).toContain(parent);
  });
}

test("the two-value logical shorthand pair still resolves to the physical properties the engine uses", () => {
  for (const shorthand of ["margin-inline", "margin-block"] as const) {
    for (const writingMode of WRITING_MODES) {
      for (const direction of DIRECTIONS) {
        const physicalSides = withElement((element) => {
          element.style.setProperty("writing-mode", writingMode);
          element.style.setProperty("direction", direction);
          element.style.setProperty(shorthand, "5px 9px");

          const computed = getComputedStyle(element);
          const sides = ["top", "right", "bottom", "left"] as const;
          const first = sides.find((side) => computed.getPropertyValue(`margin-${side}`) === "5px");
          const second = sides.find(
            (side) => computed.getPropertyValue(`margin-${side}`) === "9px",
          );

          return [first, second];
        });

        expect(
          resolveLogicalPropertyPair(shorthand)?.(writingMode, direction),
          `${shorthand} ${writingMode}/${direction}`,
        ).toEqual([`margin-${physicalSides[0]}`, `margin-${physicalSides[1]}`]);
      }
    }
  }
});

test("all: initial still leaves direction, unicode-bidi, and custom properties alone", () => {
  const survived = withElement((element) => {
    element.style.setProperty("direction", "rtl");
    element.style.setProperty("unicode-bidi", "bidi-override");
    element.style.setProperty("--brand", "rebeccapurple");
    element.style.setProperty("color", "rgb(1, 2, 3)");
    element.style.setProperty("all", "initial");

    const computed = getComputedStyle(element);

    return {
      direction: computed.direction,
      unicodeBidi: computed.unicodeBidi,
      custom: computed.getPropertyValue("--brand").trim(),
      color: computed.color,
    };
  });

  expect(survived.direction).toBe("rtl");
  expect(survived.unicodeBidi).toBe("bidi-override");
  expect(survived.custom).toBe("rebeccapurple");
  expect(survived.color).not.toBe("rgb(1, 2, 3)");

  expect(isResetByAll("direction")).toBe(false);
  expect(isResetByAll("unicode-bidi")).toBe(false);
  expect(isResetByAll("--brand")).toBe(false);
  expect(isResetByAll("color")).toBe(true);
});
