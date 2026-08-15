import { expect, test } from "vite-plus/test";

import { compileSource } from "../../src/core/compiler/index.ts";
import type { CompiledProbeProperty } from "../../src/core/compiler/index.ts";
import { matchBranches } from "../../src/browser/matcher/index.ts";
import { readResolvedValues } from "../../src/browser/evaluator/index.ts";

/**
 * Resolved value reading, checked against the engine that resolves.
 *
 * Every expectation is a value Chromium produced for real CSS applied to real
 * elements. `getComputedStyle()` is never stubbed, which the test strategy
 * requires (implementation plan section 8.3), and which is the point of the
 * suite: a resolved value is whatever the engine says it is, so a test that
 * agreed with a stub would prove nothing about the browser a developer
 * debugs in.
 *
 * The engine values pinned here were read in the browser lane against
 * headless Chromium 151.0.7922.34, the version this project's Vitest browser
 * project runs. An engine that answers differently fails the lane rather than
 * quietly changing what a probe reports.
 *
 * `withFixture()` appends markup and a style element, runs the body, and
 * removes both however the body ends. The style element is test setup: the
 * read-only guarantee (implementation plan section 5.9) binds the shipped
 * module, which only ever reads, and a browser test needs authored CSS in the
 * document to have anything to read.
 */

/** A fixture URL that can never resolve, matching the other browser suites. */
const FIXTURE_URL = "https://fixtures.css-console.invalid/evaluator.css";

/**
 * Appends a fixture subtree and its stylesheet to the document, runs the body
 * against them, and removes both however the body ends. The wrapper element
 * carries no class of its own, so it can never satisfy a selector under test.
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
 * The element the identifier names, or a failure that says which identifier
 * was missing rather than a null dereference deeper in the test.
 */
function elementById(host: HTMLElement, id: string): Element {
  const element = host.querySelector(`#${id}`);

  if (element === null) {
    throw new Error(`expected the fixture element #${id}`);
  }

  return element;
}

/**
 * A compiled property standing in for one the compiler produced. The grid
 * cases care about the property name and the value the engine resolves for
 * it, so the fields the guard consumes carry their empty forms. Cases that
 * depend on a real compilation compose `compileSource()` instead.
 */
function property(name: string, authored = ""): CompiledProbeProperty {
  return {
    name,
    authored,
    important: false,
    source: { url: FIXTURE_URL, start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
    customProperties: [],
    indexed: null,
  };
}

/** The resolved values of the named properties, read from one element. */
function resolvedOf(element: Element, names: readonly string[]): readonly string[] {
  return readResolvedValues(
    element,
    null,
    names.map((name) => property(name)),
  ).values.map((value) => value.resolved);
}

test("an ordinary property reports the value the engine resolved", () => {
  withFixture(
    `<p class="ordinary" id="target"></p>`,
    `.ordinary { color: rgb(1 2 3); }`,
    (host) => {
      const reading = readResolvedValues(elementById(host, "target"), null, [
        property("color", "rgb(1 2 3)"),
      ]);

      expect(reading.values).toEqual([
        { name: "color", authored: "rgb(1 2 3)", resolved: "rgb(1, 2, 3)" },
      ]);
    },
  );
});

test("calc resolves to pixels", () => {
  withFixture(
    `<p class="calculated" id="target"></p>`,
    `.calculated { width: calc(100px + 50px); }`,
    (host) => {
      expect(resolvedOf(elementById(host, "target"), ["width"])).toEqual(["150px"]);
    },
  );
});

test("clamp reports its low bound, its high bound, and the value between them", () => {
  withFixture(
    `<p class="clamped" id="target"></p>`,
    `.clamped {
      width: clamp(10px, 5px, 100px);
      height: clamp(10px, 500px, 100px);
      margin-top: clamp(10px, 50px, 100px);
    }`,
    (host) => {
      expect(resolvedOf(elementById(host, "target"), ["width", "height", "margin-top"])).toEqual([
        "10px",
        "100px",
        "50px",
      ]);
    },
  );
});

test("color-mix resolves to a concrete color", () => {
  withFixture(
    `<p class="mixed" id="target"></p>`,
    `.mixed { color: color-mix(in srgb, red 50%, blue); }`,
    (host) => {
      expect(resolvedOf(elementById(host, "target"), ["color"])).toEqual(["color(srgb 0.5 0 0.5)"]);
    },
  );
});

test("a container unit resolves against its query container", () => {
  withFixture(
    `<div class="panel"><p class="contained" id="target"></p></div>`,
    `.panel { container-type: inline-size; width: 400px; }
     .contained { width: 50cqw; margin-left: 25cqi; }`,
    (host) => {
      // Both units measure the 400px inline size of the query container, so
      // 50cqw is 200px and 25cqi is 100px.
      expect(resolvedOf(elementById(host, "target"), ["width", "margin-left"])).toEqual([
        "200px",
        "100px",
      ]);
    },
  );
});

test("an inherited property reports the value the child inherited", () => {
  withFixture(
    `<div class="ancestor"><span class="descendant" id="target"></span></div>`,
    `.ancestor { color: rgb(9 8 7); }`,
    (host) => {
      expect(resolvedOf(elementById(host, "target"), ["color"])).toEqual(["rgb(9, 8, 7)"]);
    },
  );
});

test("a custom property reports its declared value", () => {
  withFixture(
    `<p class="branded" id="target"></p>`,
    `.branded { --brand: oklch(55% 0.18 250); }`,
    (host) => {
      expect(resolvedOf(elementById(host, "target"), ["--brand"])).toEqual(["oklch(55% 0.18 250)"]);
    },
  );
});

test("an empty custom property reports the empty string, as does one never declared", () => {
  withFixture(
    `<p class="emptied" id="target"></p>`,
    `.emptied { --declared-empty: ; --spaced:    ; }`,
    (host) => {
      const element = elementById(host, "target");

      expect(resolvedOf(element, ["--declared-empty", "--spaced", "--never-declared"])).toEqual([
        "",
        "",
        "",
      ]);

      // `getPropertyValue()` draws no distinction between a custom property
      // declared empty and one never declared: both answer the empty string,
      // and a declared-empty value carrying only whitespace answers the empty
      // string too. The computed style does draw the distinction, through
      // enumeration rather than through a value, which is pinned so that the
      // empty string a record carries is understood as honest rather than as
      // a missing property.
      const names = Array.from(getComputedStyle(element));

      expect(names).toContain("--declared-empty");
      expect(names).toContain("--spaced");
      expect(names).not.toContain("--never-declared");
    },
  );
});

test("a pseudo-element with generated content reports the values of its box", () => {
  withFixture(
    `<p class="decorated" id="target"></p>`,
    `.decorated::before { content: "hi"; color: rgb(4 5 6); width: 30px; }`,
    (host) => {
      const reading = readResolvedValues(elementById(host, "target"), "::before", [
        property("content", `"hi"`),
        property("color", "rgb(4 5 6)"),
        property("width", "30px"),
      ]);

      expect(reading.values.map((value) => value.resolved)).toEqual([
        `"hi"`,
        "rgb(4, 5, 6)",
        "30px",
      ]);
    },
  );
});

test("a pseudo-element with no content still reports computed values while generating no box", () => {
  withFixture(
    `<p class="undecorated" id="target"></p>`,
    `.undecorated { width: 200px; }
     .undecorated::before { color: rgb(7 7 7); width: 50%; }`,
    (host) => {
      const reading = readResolvedValues(elementById(host, "target"), "::before", [
        property("content"),
        property("color"),
        property("width"),
        property("display"),
      ]);

      // `content` computes to `none`, which is why no box is generated, and
      // the other properties still compute. `width` stays at its computed
      // percentage rather than resolving against the 200px originating
      // element, because resolution to a used value needs a box.
      expect(reading.values.map((value) => value.resolved)).toEqual([
        "none",
        "rgb(7, 7, 7)",
        "50%",
        "inline",
      ]);
    },
  );
});

test("display none falls back to computed values, and an auto length reports auto", () => {
  withFixture(
    `<div class="frame">
       <p class="invisible" id="hidden"></p>
       <p class="visible" id="shown"></p>
     </div>`,
    `.frame { width: 300px; }
     .invisible { display: none; width: auto; margin-left: 10%; color: rgb(1 1 1); }
     .visible { width: auto; }`,
    (host) => {
      // An element with a box resolves `width: auto` to the used length.
      expect(resolvedOf(elementById(host, "shown"), ["width"])).toEqual(["300px"]);

      // An element with `display: none` has no box, so the same declaration
      // reports the computed value `auto`, and a percentage stays a
      // percentage rather than resolving against anything.
      expect(
        resolvedOf(elementById(host, "hidden"), ["width", "margin-left", "color", "display"]),
      ).toEqual(["auto", "10%", "rgb(1, 1, 1)", "none"]);
    },
  );

  withFixture(
    `<div class="frame"><p class="percentage" id="target"></p></div>`,
    `.frame { display: none; width: 300px; }
     .percentage { width: 50%; }`,
    (host) => {
      // The fallback follows the box rather than the declaration: an element
      // inside a `display: none` subtree generates no box either.
      expect(resolvedOf(elementById(host, "target"), ["width"])).toEqual(["50%"]);
    },
  );
});

test("a standard property name is normalized while a custom property name is read as written", () => {
  withFixture(
    `<p class="named" id="target"></p>`,
    `.named { width: 50px; --Brand: upper; --brand: lower; }`,
    (host) => {
      const element = elementById(host, "target");

      expect(resolvedOf(element, ["WIDTH", "Width", "width"])).toEqual(["50px", "50px", "50px"]);

      // Custom property names are case-sensitive, so folding their case would
      // merge two properties an author kept apart, and asking for a spelling
      // nobody declared answers the empty string.
      expect(resolvedOf(element, ["--Brand", "--brand", "--BRAND"])).toEqual([
        "upper",
        "lower",
        "",
      ]);

      // The same answers, straight from the engine, so the normalization the
      // module performs is pinned beside the behavior it agrees with.
      const declaration = getComputedStyle(element);

      expect(declaration.getPropertyValue("WIDTH")).toBe("50px");
      expect(declaration.getPropertyValue("--BRAND")).toBe("");
    },
  );
});

test("a computed style declaration is live, which is why one acquisition serves every read", () => {
  withFixture(`<p id="target" style="color: rgb(1 2 3)"></p>`, ``, (host) => {
    const element = elementById(host, "target");
    const declaration = getComputedStyle(element);

    expect(declaration.getPropertyValue("color")).toBe("rgb(1, 2, 3)");

    if (!(element instanceof HTMLElement)) {
      throw new Error("expected an HTML element");
    }

    element.style.color = "rgb(9 9 9)";

    // The same object reports the new value, so holding it across a change
    // holds nothing: the reads have to happen consecutively for a reported
    // set of values to describe one moment.
    expect(declaration.getPropertyValue("color")).toBe("rgb(9, 9, 9)");
  });
});

test("values come back in requested order rather than declaration order", () => {
  withFixture(
    `<p class="ordered" id="target"></p>`,
    `.ordered { color: rgb(1 2 3); width: 50px; }`,
    (host) => {
      const element = elementById(host, "target");

      expect(
        readResolvedValues(element, null, [property("width"), property("color")]).values,
      ).toEqual([
        { name: "width", authored: "", resolved: "50px" },
        { name: "color", authored: "", resolved: "rgb(1, 2, 3)" },
      ]);

      expect(
        readResolvedValues(element, null, [property("color"), property("width")]).values.map(
          (value) => value.name,
        ),
      ).toEqual(["color", "width"]);
    },
  );
});

test("the flow facts come from the same declaration as the values", () => {
  withFixture(
    `<p class="flowing" id="target"></p>`,
    `.flowing { writing-mode: vertical-rl; direction: rtl; color: rgb(1 2 3); }`,
    (host) => {
      const reading = readResolvedValues(elementById(host, "target"), null, [property("color")]);

      expect(reading.writingMode).toBe("vertical-rl");
      expect(reading.direction).toBe("rtl");
      expect(reading.values[0]?.resolved).toBe("rgb(1, 2, 3)");
    },
  );
});

test("an element with no writing-mode declaration reports the initial flow facts", () => {
  withFixture(`<p class="default-flow" id="target"></p>`, ``, (host) => {
    const reading = readResolvedValues(elementById(host, "target"), null, []);

    expect(reading.values).toEqual([]);
    expect(reading.writingMode).toBe("horizontal-tb");
    expect(reading.direction).toBe("ltr");
  });
});

test("every writing mode the logical tables know reports itself, and the legacy keyword computes into the set", () => {
  for (const mode of [
    "horizontal-tb",
    "vertical-rl",
    "vertical-lr",
    "sideways-rl",
    "sideways-lr",
  ]) {
    withFixture(`<p class="mode" id="target"></p>`, `.mode { writing-mode: ${mode}; }`, (host) => {
      expect(readResolvedValues(elementById(host, "target"), null, []).writingMode, mode).toBe(
        mode,
      );
    });
  }

  // `tb-rl` is the deprecated pre-standard spelling, and the engine computes
  // it to `vertical-rl` rather than reporting it. This is the evidence that a
  // computed writing mode outside the five the logical tables know cannot be
  // reached in this engine.
  withFixture(`<p class="legacy" id="target"></p>`, `.legacy { writing-mode: tb-rl; }`, (host) => {
    const element = elementById(host, "target");

    expect(getComputedStyle(element).getPropertyValue("writing-mode")).toBe("vertical-rl");
    expect(readResolvedValues(element, null, []).writingMode).toBe("vertical-rl");
  });
});

test("reading values writes nothing to the document", () => {
  withFixture(
    `<p class="untouched" id="target"></p>`,
    `.untouched { color: rgb(1 2 3); --brand: blue; }`,
    (host) => {
      const element = elementById(host, "target");
      const before = document.body.innerHTML;

      readResolvedValues(element, null, [property("color"), property("--brand")]);
      readResolvedValues(element, "::before", [property("content")]);

      expect(document.body.innerHTML).toBe(before);
    },
  );
});

test("a compiled probe carries authored values through to the resolved values of its matches", () => {
  const css = `/* css-console: log color,width */
.report-card {
  color: color-mix(in srgb, red 50%, blue);
  width: calc(100px + 50px);
}`;

  const compiled = compileSource(css, { url: FIXTURE_URL });

  expect(compiled.diagnostics).toEqual([]);

  const probe = compiled.probes[0];

  if (probe === undefined || probe.kind !== "value") {
    throw new Error("expected a compiled value probe");
  }

  withFixture(`<article class="report-card" id="target"></article>`, css, (host) => {
    const matched = matchBranches(probe.branches);

    expect(matched.diagnostics).toEqual([]);
    expect(matched.matches).toHaveLength(1);

    const match = matched.matches[0];

    if (match === undefined) {
      throw new Error("expected one match");
    }

    expect(match.element).toBe(elementById(host, "target"));

    const reading = readResolvedValues(match.element, match.branch.pseudo, probe.properties);

    expect(reading.values).toEqual([
      {
        name: "color",
        authored: "color-mix(in srgb, red 50%, blue)",
        resolved: "color(srgb 0.5 0 0.5)",
      },
      { name: "width", authored: "calc(100px + 50px)", resolved: "150px" },
    ]);
    expect(reading.writingMode).toBe("horizontal-tb");
    expect(reading.direction).toBe("ltr");
  });
});
