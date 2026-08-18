import { expect, test } from "vite-plus/test";

import { compileSource } from "../../src/core/compiler/index.ts";
import type { CompiledProbe, CompiledValueProbe } from "../../src/core/compiler/index.ts";
import { matchBranches } from "../../src/browser/matcher/index.ts";
import { readResolvedValues } from "../../src/browser/evaluator/index.ts";
import { evaluateGuard } from "../../src/browser/guard/index.ts";
import type { ValueGuard } from "../../src/core/records/index.ts";

/**
 * Contested guard evaluation, checked against the live engine.
 *
 * The review question for CSSC-021 is the project's core honesty promise:
 * does the guard fire when and only when something competes? Every case
 * runs the real pipeline where the question allows it, `compileSource()`
 * through `matchBranches()` and `readResolvedValues()` into
 * `evaluateGuard()`, because the guard consumes exactly what that pipeline
 * hands it: the compiled property with its index entry, the guard index,
 * and the flow facts of the box the values came from.
 *
 * The engine facts pinned in the suite were read in the browser lane
 * against headless Chromium 151.0.7922.34, the version this project's
 * Vitest browser project runs (playwright-core 1.62.0, browsers.json). An
 * engine that answers differently fails the lane rather than quietly
 * changing what a guard reports.
 *
 * `withFixture()` appends markup and a style element, runs the body, and
 * removes both however the body ends. The style element and any class the
 * animation cases toggle are test setup: the read-only guarantee
 * (implementation plan section 5.9) binds the shipped module, which only
 * ever reads, and a transition cannot run without something changing a
 * style.
 */

/** A fixture URL that can never resolve, matching the other browser suites. */
const FIXTURE_URL = "https://fixtures.css-console.invalid/guard.css";

/**
 * Appends a fixture subtree and its stylesheet to the document, runs the
 * body against them, and removes both however the body ends. The wrapper
 * element carries no class of its own, so it can never satisfy a selector
 * under test.
 */
function withFixture<T>(markup: string, css: string, body: (host: HTMLElement) => T): T {
  const host = document.createElement("div");
  const style = document.createElement("style");

  style.textContent = css;
  host.innerHTML = markup;
  document.head.append(style);
  document.body.append(host);

  try {
    return body(host);
  } finally {
    host.remove();
    style.remove();
  }
}

/**
 * The asynchronous variant of `withFixture()`, for the animation cases,
 * which have to wait a frame between changing a style and reading the
 * engine's animations. `uncompiled` is a second stylesheet the compiled
 * source never sees, so a rule that only exists to start a transition or an
 * animation cannot reach the guard index and fire `competing-declaration`
 * beside the reason under test.
 */
async function withLiveFixture<T>(
  markup: string,
  css: string,
  uncompiled: string,
  body: (host: HTMLElement) => Promise<T>,
): Promise<T> {
  const host = document.createElement("div");
  const style = document.createElement("style");
  const extra = document.createElement("style");

  style.textContent = css;
  extra.textContent = uncompiled;
  host.innerHTML = markup;
  document.head.append(style, extra);
  document.body.append(host);

  try {
    return await body(host);
  } finally {
    host.remove();
    style.remove();
    extra.remove();
  }
}

/** Narrows to a value probe, failing the test when the probe is another kind. */
function valueProbe(probe: CompiledProbe | undefined): CompiledValueProbe {
  if (probe === undefined || probe.kind !== "value") {
    throw new Error("expected a value probe");
  }

  return probe;
}

/**
 * Compiles a source, matches its first value probe inside the fixture, and
 * evaluates the guard for one of its properties on the first matched
 * element. `propertyName` selects among the probe's properties and defaults
 * to the first, and the flow facts come from `readResolvedValues()` on the
 * matched element, exactly as the pipeline supplies them.
 */
function guardOf(host: HTMLElement, css: string, propertyName?: string): ValueGuard {
  const compiled = compileSource(css, { url: FIXTURE_URL });
  const probe = valueProbe(compiled.probes[0]);
  const { matches } = matchBranches(probe.branches, host);
  const match = matches[0];

  if (match === undefined) {
    throw new Error("expected the probe to match a fixture element");
  }

  const property =
    propertyName === undefined
      ? probe.properties[0]
      : probe.properties.find((candidate) => candidate.name === propertyName);

  if (property === undefined) {
    throw new Error(`expected the probe to carry the property ${propertyName}`);
  }

  const reading = readResolvedValues(match.element, match.branch.pseudo, probe.properties);

  return evaluateGuard({
    element: match.element,
    pseudo: match.branch.pseudo,
    property,
    index: compiled.guardIndex,
    writingMode: reading.writingMode,
    direction: reading.direction,
  });
}

/** One frame, so a style change has been recalculated before the guard reads. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

test("nothing else declaring the property leaves the value uncontested", () => {
  const css = `/* css-console: log color */
.solo { color: red; }`;

  withFixture(`<p class="solo"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({ contested: false, reasons: [] });
  });
});

test("a competing rule fires competing-declaration", () => {
  const css = `/* css-console: log color */
.card { color: red; }
.other { color: blue; }`;

  withFixture(`<p class="card other"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({
      contested: true,
      reasons: ["competing-declaration"],
    });
  });
});

test("a shorthand competes with an annotated longhand", () => {
  const css = `/* css-console: log margin-left */
.card { margin-left: 1px; }
.reset { margin: 0; }`;

  withFixture(`<p class="card reset"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({
      contested: true,
      reasons: ["competing-declaration"],
    });
  });
});

test("width competes with an annotated inline-size in horizontal-tb", () => {
  const css = `/* css-console: log inline-size */
.card { inline-size: 5px; }
.wide { width: 7px; }`;

  withFixture(`<p class="card wide"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({
      contested: true,
      reasons: ["competing-declaration"],
    });
  });
});

test("width does not compete with an annotated inline-size in vertical-rl", () => {
  const css = `/* css-console: log inline-size */
.card { inline-size: 5px; }
.wide { width: 7px; }
.vertical { writing-mode: vertical-rl; }`;

  withFixture(`<p class="card wide vertical"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({ contested: false, reasons: [] });
  });
});

test("all competes with a probed color", () => {
  const css = `/* css-console: log color */
.card { color: red; }
.reset { all: initial; }`;

  withFixture(`<p class="card reset"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({
      contested: true,
      reasons: ["competing-declaration"],
    });
  });
});

test("a color declaration competes with a probed all", () => {
  const css = `/* css-console: log */
.reset { all: initial; }
.card { color: red; }`;

  withFixture(`<p class="card reset"></p>`, css, (host) => {
    expect(guardOf(host, css, "all")).toEqual({
      contested: true,
      reasons: ["competing-declaration"],
    });
  });
});

test("the same property authored twice in one rule leaves the twin competing", () => {
  const css = `/* css-console: log color */
.card { color: red; color: blue; }`;

  withFixture(`<p class="card"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({
      contested: true,
      reasons: ["competing-declaration"],
    });
  });
});

test("an inline style on the probed property fires inline-style", () => {
  const css = `/* css-console: log color */
.card { color: red; }`;

  withFixture(`<p class="card" style="color: blue"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({ contested: true, reasons: ["inline-style"] });
  });
});

test("an inline shorthand fires inline-style for a probed longhand", () => {
  const css = `/* css-console: log margin-left */
.card { margin-left: 1px; }`;

  withFixture(`<p class="card" style="margin: 0"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({ contested: true, reasons: ["inline-style"] });
  });
});

test("an inline custom property fires inline-style for the probed custom property", () => {
  const css = `/* css-console: log */
.card { --tone: red; }`;

  withFixture(`<p class="card" style="--tone: green"></p>`, css, (host) => {
    expect(guardOf(host, css, "--tone")).toEqual({
      contested: true,
      reasons: ["inline-style"],
    });
  });
});

test("an important inline style fires important beside inline-style", () => {
  // A competitor existing and a competitor carrying !important are two
  // facts, and the module doc promises both are reported wherever the
  // competitor lives. The style attribute reports priority through
  // getPropertyPriority(), which answers "important" here in headless
  // Chromium 151.0.7922.34.
  const css = `/* css-console: log color */
.card { color: red; }`;

  withFixture(`<p class="card" style="color: blue !important"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({
      contested: true,
      reasons: ["inline-style", "important"],
    });
  });
});

test("an inline style does not compete with a pseudo-element probe", () => {
  // A style attribute declares on the element's own box, and no inline
  // syntax can address a pseudo-element, so an inline color cannot be
  // responsible for the value a ::before rule produced.
  const css = `/* css-console: log color */
.decorated::before { content: ""; color: red; }`;

  withFixture(`<p class="decorated" style="color: blue"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({ contested: false, reasons: [] });
  });
});

test("an element rule does not compete with a pseudo-element probe", () => {
  // The element's own color declaration styles the element's box. The
  // ::before box takes it only through inheritance, which every directly
  // declared value beats, so the element rule cannot be responsible for the
  // reported value and must not fire competing-declaration.
  const css = `/* css-console: log color */
.decorated::before { content: ""; color: red; }
.decorated { color: blue; }`;

  withFixture(`<p class="decorated"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({ contested: false, reasons: [] });
  });
});

test("a rule on the same pseudo-element fires competing-declaration", () => {
  // Element.matches() answers false for any selector carrying a
  // pseudo-element (pinned below), so the candidate's branches are compared
  // by originating selector and pseudo-element instead: a second rule
  // declaring color on the same ::before box is a real competitor.
  const css = `/* css-console: log color */
.decorated::before { content: ""; color: red; }
.other::before { color: blue; }`;

  withFixture(`<p class="decorated other"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({
      contested: true,
      reasons: ["competing-declaration"],
    });
  });
});

test("a rule on a different pseudo-element of the same element does not compete", () => {
  const css = `/* css-console: log color */
.decorated::before { content: ""; color: red; }
.decorated::after { content: ""; color: blue; }`;

  withFixture(`<p class="decorated"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({ contested: false, reasons: [] });
  });
});

test("matches() never matches a selector carrying a pseudo-element", () => {
  // The engine fact the branch comparison rests on, pinned against headless
  // Chromium 151.0.7922.34 rather than recalled: a pseudo-element selector
  // selects a box no element is, so Element.matches() answers false however
  // well the originating selector fits.
  const element = document.createElement("p");

  element.className = "pinned";

  expect(element.matches(".pinned")).toBe(true);
  expect(element.matches(".pinned::before")).toBe(false);
});

test("an inline style on an unrelated property does not fire inline-style", () => {
  const css = `/* css-console: log color */
.card { color: red; }`;

  withFixture(`<p class="card" style="margin: 0"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({ contested: false, reasons: [] });
  });
});

test("an important competitor fires competing-declaration and important, distinctly", () => {
  const css = `/* css-console: log color */
.card { color: red; }
.loud { color: blue !important; }`;

  withFixture(`<p class="card loud"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({
      contested: true,
      reasons: ["competing-declaration", "important"],
    });
  });
});

test("the probed declaration's own important flag is not a reason against itself", () => {
  const css = `/* css-console: log color */
.card { color: red !important; }`;

  withFixture(`<p class="card"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({ contested: false, reasons: [] });
  });
});

test("a running transition on the property fires animation-or-transition", async () => {
  const css = `/* css-console: log margin-left */
.card { margin-left: 0px; transition: margin-left 100s linear; }`;

  await withLiveFixture(
    `<p class="card"></p>`,
    css,
    `.card.moved { margin-left: 200px; }`,
    async (host) => {
      const element = host.querySelector(".card");

      if (element === null) {
        throw new Error("expected the fixture element");
      }

      // Reading a computed value realizes the pre-change style, so the
      // class change below is a transition rather than the initial style.
      getComputedStyle(element).getPropertyValue("margin-left");
      element.classList.add("moved");
      await nextFrame();

      expect(guardOf(host, css)).toEqual({
        contested: true,
        reasons: ["animation-or-transition"],
      });
    },
  );
});

test("a running animation on the property fires animation-or-transition", async () => {
  const css = `/* css-console: log margin-left */
.card { margin-left: 0px; }`;

  await withLiveFixture(
    `<p class="card"></p>`,
    css,
    `@keyframes guard-slide { from { margin-left: 0px; } to { margin-left: 300px; } }
.card { animation: guard-slide 100s linear; }`,
    async (host) => {
      await nextFrame();

      expect(guardOf(host, css)).toEqual({
        contested: true,
        reasons: ["animation-or-transition"],
      });
    },
  );
});

test("a running animation on an unrelated property does not fire", async () => {
  const css = `/* css-console: log margin-left */
.card { margin-left: 0px; }`;

  await withLiveFixture(
    `<p class="card"></p>`,
    css,
    `@keyframes guard-fade { from { opacity: 0; } to { opacity: 1; } }
.card { animation: guard-fade 100s linear; }`,
    async (host) => {
      await nextFrame();

      expect(guardOf(host, css)).toEqual({ contested: false, reasons: [] });
    },
  );
});

test("an animation running on the probed pseudo-element fires animation-or-transition", async () => {
  // element.getAnimations() omits pseudo-element animations, while the
  // subtree form returns them with the effect naming its pseudo-element
  // (pinned in the case below), so the guard has to ask with subtree and
  // filter to the probed box.
  const css = `/* css-console: log margin-left */
.decorated::before { content: ""; margin-left: 0px; }`;

  await withLiveFixture(
    `<p class="decorated"></p>`,
    css,
    `@keyframes guard-pseudo-slide { from { margin-left: 0px; } to { margin-left: 300px; } }
.decorated::before { animation: guard-pseudo-slide 100s linear; }`,
    async (host) => {
      await nextFrame();

      expect(guardOf(host, css)).toEqual({
        contested: true,
        reasons: ["animation-or-transition"],
      });
    },
  );
});

test("an animation on a pseudo-element does not fire for the element's own probe", async () => {
  const css = `/* css-console: log margin-left */
.card { margin-left: 0px; }`;

  await withLiveFixture(
    `<p class="card"></p>`,
    css,
    `@keyframes guard-aside { from { margin-left: 0px; } to { margin-left: 300px; } }
.card::before { content: ""; animation: guard-aside 100s linear; }`,
    async (host) => {
      await nextFrame();

      expect(guardOf(host, css)).toEqual({ contested: false, reasons: [] });
    },
  );
});

test("an animation on a boxless pseudo-element never runs, so the guard stays silent", async () => {
  // A pseudo-element whose content computes to none generates no box, and an
  // animation declared on a boxless pseudo-element never starts: verified
  // against headless Chromium 151.0.7922.34, where getAnimations({ subtree:
  // true }) returns nothing for it and the probed value stays at its static
  // declaration. The guard's silence is therefore the honest answer rather
  // than a missed detection, and this case exists so an engine that starts
  // running such animations fails the lane instead of quietly turning the
  // silence into a false negative. The content declaration is the only
  // difference from the firing case above.
  const css = `/* css-console: log margin-left */
.decorated::before { margin-left: 0px; }`;

  await withLiveFixture(
    `<p class="decorated"></p>`,
    css,
    `@keyframes guard-boxless { from { margin-left: 0px; } to { margin-left: 300px; } }
.decorated::before { animation: guard-boxless 100s linear; }`,
    async (host) => {
      await nextFrame();

      const element = host.querySelector(".decorated");

      if (element === null) {
        throw new Error("expected the fixture element");
      }

      expect(element.getAnimations({ subtree: true })).toHaveLength(0);
      expect(getComputedStyle(element, "::before").getPropertyValue("margin-left")).toBe("0px");
      expect(guardOf(host, css)).toEqual({ contested: false, reasons: [] });
    },
  );
});

test("getAnimations() reports pseudo-element animations only through subtree", async () => {
  // The engine fact the pseudo-element filter rests on, pinned against
  // headless Chromium 151.0.7922.34: the plain call answers nothing for an
  // animation running on ::before, and the subtree call returns it with the
  // effect naming the pseudo-element and targeting the originating element.
  await withLiveFixture(
    `<p class="pinned-animation"></p>`,
    `/* no compiled probe is needed for this engine pin */`,
    `@keyframes guard-pin { from { opacity: 0; } to { opacity: 1; } }
.pinned-animation::before { content: ""; animation: guard-pin 100s linear; }`,
    async (host) => {
      await nextFrame();

      const element = host.querySelector(".pinned-animation");

      if (element === null) {
        throw new Error("expected the fixture element");
      }

      expect(element.getAnimations()).toHaveLength(0);

      const subtree = element.getAnimations({ subtree: true });

      expect(subtree).toHaveLength(1);

      const effect = subtree[0]?.effect;

      if (!(effect instanceof KeyframeEffect)) {
        throw new Error("expected a keyframe effect");
      }

      expect(effect.pseudoElement).toBe("::before");
      expect(effect.target).toBe(element);
    },
  );
});

test("an unset custom property without a fallback fires unresolved-variable", () => {
  const css = `/* css-console: log color */
.card { color: var(--missing); }`;

  withFixture(`<p class="card"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({
      contested: true,
      reasons: ["unresolved-variable"],
    });
  });
});

test("an uppercase VAR() spelling fires unresolved-variable exactly as the lowercase one", () => {
  const css = `/* css-console: log color */
.card { color: VAR(--missing); }`;

  withFixture(`<p class="card"></p>`, css, (host) => {
    // The engine half first: CSS function names are ASCII case-insensitive,
    // so the uppercase spelling is a real declaration Chromium really
    // invalidated, computing to the initial color rather than being dropped
    // at parse time. Read against headless Chromium 151.0.7922.34.
    const element = host.querySelector(".card") as Element;

    expect(getComputedStyle(element).getPropertyValue("color")).toBe("rgb(0, 0, 0)");

    expect(guardOf(host, css)).toEqual({
      contested: true,
      reasons: ["unresolved-variable"],
    });
  });
});

test("a custom property declared on the pseudo-element itself does not fire", () => {
  // The values a pseudo-element probe reports come from
  // getComputedStyle(element, pseudo), and custom properties cascade per
  // element and pseudo-element pair, so the reference check must read the
  // same declaration. Reading the originating element would miss --tone,
  // which only the ::before rule declares, and report unresolved-variable
  // for a reference the engine resolved. The computed assertion pins the
  // engine half against headless Chromium 151.0.7922.34.
  const css = `/* css-console: log color */
.decorated::before { content: ""; --tone: rgb(0, 128, 0); color: var(--tone); }`;

  withFixture(`<p class="decorated"></p>`, css, (host) => {
    const element = host.querySelector(".decorated") as Element;

    expect(getComputedStyle(element, "::before").getPropertyValue("color")).toBe("rgb(0, 128, 0)");
    expect(getComputedStyle(element).getPropertyValue("--tone")).toBe("");

    expect(guardOf(host, css)).toEqual({ contested: false, reasons: [] });
  });
});

test("a valid fallback with an unset variable does not fire unresolved-variable", () => {
  const css = `/* css-console: log color */
.card { color: var(--missing, red); }`;

  withFixture(`<p class="card"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({ contested: false, reasons: [] });
  });
});

test("a fallback invalid for the destination property fires unresolved-variable", () => {
  const css = `/* css-console: log color */
.card { color: var(--missing, 10px); }`;

  withFixture(`<p class="card"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({
      contested: true,
      reasons: ["unresolved-variable"],
    });
  });
});

test("a nested fallback chain ending in a valid value does not fire", () => {
  const css = `/* css-console: log color */
.card { color: var(--first, var(--second, green)); }`;

  withFixture(`<p class="card"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({ contested: false, reasons: [] });
  });
});

test("a nested fallback chain with no terminal value fires unresolved-variable", () => {
  const css = `/* css-console: log color */
.card { color: var(--first, var(--second)); }`;

  withFixture(`<p class="card"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({
      contested: true,
      reasons: ["unresolved-variable"],
    });
  });
});

test("a set variable clears the reason and its unconsulted nested fallback stays silent", () => {
  const css = `/* css-console: log color */
.card { --first: blue; color: var(--first, var(--second)); }`;

  withFixture(`<p class="card"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({ contested: false, reasons: [] });
  });
});

test("a set variable referenced without a fallback does not fire", () => {
  const css = `/* css-console: log color */
.card { --tone: blue; color: var(--tone); }`;

  withFixture(`<p class="card"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({ contested: false, reasons: [] });
  });
});

test("a competitor inside an inactive condition does not count", () => {
  const css = `/* css-console: log color */
.card { color: red; }
@media (min-width: 100000px) {
  .card { color: blue; }
}`;

  withFixture(`<p class="card"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({ contested: false, reasons: [] });
  });
});

test("a competitor inside an active condition counts", () => {
  const css = `/* css-console: log color */
.card { color: red; }
@media (min-width: 1px) {
  .card { color: blue; }
}`;

  withFixture(`<p class="card"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({
      contested: true,
      reasons: ["competing-declaration"],
    });
  });
});

test("a candidate whose selector does not match the element does not count", () => {
  const css = `/* css-console: log color */
.card { color: red; }
.elsewhere { color: blue; }`;

  withFixture(`<p class="card"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({ contested: false, reasons: [] });
  });
});

test("a candidate whose selector the engine refuses cannot be shown to compete", () => {
  const css = `/* css-console: log color */
.card { color: red; }
.card:not-a-real-pseudo { color: blue; }`;

  withFixture(`<p class="card"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({ contested: false, reasons: [] });
  });
});

test("guard evaluation is read-only", () => {
  const css = `/* css-console: log color */
.card { color: var(--missing); }
.loud { color: blue !important; }`;

  withFixture(`<p class="card loud" style="color: green"></p>`, css, (host) => {
    const before = document.documentElement.outerHTML;
    const guard = guardOf(host, css);
    const after = document.documentElement.outerHTML;

    expect(after).toBe(before);
    expect(guard.contested).toBe(true);
  });
});

test("every reason accumulates distinctly, in the contract's declared order", () => {
  const css = `/* css-console: log color */
.card { color: var(--missing); }
.loud { color: blue !important; }`;

  withFixture(`<p class="card loud" style="color: green"></p>`, css, (host) => {
    expect(guardOf(host, css)).toEqual({
      contested: true,
      reasons: ["competing-declaration", "inline-style", "important", "unresolved-variable"],
    });
  });
});

/*
 * Engine facts the guard relies on, each pinned so a future engine that
 * answers differently fails the lane rather than quietly changing what a
 * guard reports. All were read against headless Chromium 151.0.7922.34.
 */

test("engine fact: matches() accepts a selector list and answers for any branch", () => {
  withFixture(`<p class="card"></p>`, ``, (host) => {
    const element = host.querySelector(".card");

    expect(element?.matches(".elsewhere, .card")).toBe(true);
    expect(element?.matches(".elsewhere, .nowhere")).toBe(false);
  });
});

test("engine fact: matches() throws a SyntaxError DOMException on an unparseable selector", () => {
  withFixture(`<p class="card"></p>`, ``, (host) => {
    const element = host.querySelector(".card");

    if (element === null) {
      throw new Error("expected the fixture element");
    }

    let thrown: unknown;

    try {
      element.matches(".card:not-a-real-pseudo");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DOMException);
    expect((thrown as DOMException).name).toBe("SyntaxError");
  });
});

test("engine fact: an inline shorthand enumerates as its longhands", () => {
  withFixture(`<p style="margin: 0; --tone: red"></p>`, ``, (host) => {
    const element = host.querySelector("p") as HTMLElement;
    const items: string[] = [];

    for (let index = 0; index < element.style.length; index += 1) {
      items.push(element.style.item(index));
    }

    expect(items).toEqual(["margin-top", "margin-right", "margin-bottom", "margin-left", "--tone"]);
  });
});

test("engine fact: a transition on all reports the transitioned longhand", async () => {
  await withLiveFixture(
    `<p class="card"></p>`,
    ``,
    `.card { margin-left: 0px; transition: all 100s linear; }
.card.moved { margin-left: 200px; }`,
    async (host) => {
      const element = host.querySelector(".card");

      if (element === null) {
        throw new Error("expected the fixture element");
      }

      getComputedStyle(element).getPropertyValue("margin-left");
      element.classList.add("moved");
      await nextFrame();

      const animations = element.getAnimations();

      expect(animations).toHaveLength(1);
      expect(animations[0]).toBeInstanceOf(CSSTransition);
      expect((animations[0] as CSSTransition).transitionProperty).toBe("margin-left");
      expect(animations[0]?.playState).toBe("running");
    },
  );
});

test("engine fact: getKeyframes() reports camel-case property keys and omits custom properties", async () => {
  await withLiveFixture(
    `<p class="card"></p>`,
    ``,
    `@property --tone {
  syntax: "<color>";
  inherits: false;
  initial-value: blue;
}

@keyframes guard-facts { from { margin-left: 0px; --tone: red; } to { margin-left: 100px; --tone: green; } }
.card { animation: guard-facts 100s step-end; }`,
    async (host) => {
      const element = host.querySelector(".card");

      if (element === null) {
        throw new Error("expected the fixture element");
      }

      await nextFrame();

      const [animation] = element.getAnimations();

      expect(animation).toBeInstanceOf(CSSAnimation);

      const effect = animation?.effect;

      if (!(effect instanceof KeyframeEffect)) {
        throw new Error("expected a keyframe effect");
      }

      const keys = effect.getKeyframes().flatMap((keyframe) => Object.keys(keyframe));

      expect(keys).toContain("marginLeft");
      // A custom property authored in a keyframe does not surface, which is
      // the recorded false negative for custom-property animations. The
      // omission is not about registration: `--tone` is registered through
      // `@property` with a color syntax in this fixture, the animation is
      // genuinely running as a typed interpolation, and the keyframe objects
      // still carry no trace of it, so the gap is in the `getKeyframes()`
      // serialization rather than in how the property animates.
      expect(keys).not.toContain("--tone");

      // The registered property really is animating: while the animation
      // runs it computes to the `from` keyframe's red rather than the
      // registered initial value of blue. The `step-end` timing function
      // holds the `from` value exactly until the animation ends, so the
      // assertion does not depend on how much time elapsed before the read.
      expect(getComputedStyle(element).getPropertyValue("--tone")).toBe("rgb(255, 0, 0)");
    },
  );
});

test("engine fact: CSS.supports() cannot discriminate on a custom-property destination", () => {
  // A custom property accepts nearly any token stream, so the call answers
  // true for values no standard property would take; only a stream that is
  // not a valid <declaration-value> at all, such as an unbalanced brace, is
  // refused. The guard therefore skips the validity check for a
  // custom-property destination rather than relying on a vacuous answer.
  expect(CSS.supports("--anything", "10px")).toBe(true);
  expect(CSS.supports("--anything", "arbitrary words")).toBe(true);
  expect(CSS.supports("--anything", "}")).toBe(false);
});

test("engine fact: CSS.supports() accepts any declaration containing var()", () => {
  // This is why the guard substitutes references before asking, rather
  // than testing the authored text: the authored text always passes.
  expect(CSS.supports("color", "var(--undeclared)")).toBe(true);
  expect(CSS.supports("color", "10px")).toBe(false);
});
