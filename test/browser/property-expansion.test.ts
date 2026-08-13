import { expect, test } from "vite-plus/test";

import {
  expandProperty,
  isResetByAll,
  resolveLogicalProperty,
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
 * A representative slice rather than all fourteen families. The point is to
 * notice drift, and drift arrives per release across the board rather than in
 * one family at a time.
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
      custom: computed.getPropertyValue("--brand").trim(),
      color: computed.color,
    };
  });

  expect(survived.direction).toBe("rtl");
  expect(survived.custom).toBe("rebeccapurple");
  expect(survived.color).not.toBe("rgb(1, 2, 3)");

  expect(isResetByAll("direction")).toBe(false);
  expect(isResetByAll("--brand")).toBe(false);
  expect(isResetByAll("color")).toBe(true);
});
