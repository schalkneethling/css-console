import { expect, test } from "vite-plus/test";

import { compileSource, guardCandidates } from "../../src/core/compiler/index.ts";
import type { CompiledSource, RuleContext } from "../../src/core/compiler/index.ts";
import { isContextActive } from "../../src/browser/conditions/index.ts";

/**
 * Condition evaluation, checked against the engine that decides it.
 *
 * A rule context is compiled without a browser: `@media` and `@supports`
 * conditions are recorded exactly as authored and never evaluated, because
 * whether one holds is a question only a live browser answers. This suite is
 * the other half of that split, so it belongs in the browser lane and nowhere
 * else. Neither `matchMedia()` nor `CSS.supports()` is ever stubbed here, in
 * keeping with the project rule that browser CSS behavior is asserted against
 * a real engine: a stub would assert only that the stub was written to agree
 * with the implementation.
 *
 * Two viewport-independent conditions carry the media cases. `(min-width:
 * 1px)` holds in any viewport a test runner can produce, and `(min-width:
 * 100000px)` holds in none, so neither case depends on the window size the
 * lane happens to open with. A media query that reads a live viewport
 * dimension would make this suite report the runner's window rather than the
 * predicate.
 *
 * The malformed cases are pinned rather than reasoned about. What an engine
 * does with an unparseable media query is defined by Media Queries Level 4
 * section 3.1, which says a malformed query serializes to `not all`, but the
 * value this project relies on is the one the engine in the lane actually
 * produces, so the test reads it back and records it.
 */

/** Compiles an inline source under a fixture URL that can never resolve. */
function compile(css: string): CompiledSource {
  return compileSource(css, { url: "https://fixtures.css-console.invalid/conditions.css" });
}

/** A context literal, for the cases that do not need a compiler to state them. */
function context(...entries: RuleContext["entries"]): RuleContext {
  return { entries };
}

/** A media condition that holds in every viewport a test runner can produce. */
const ACTIVE_MEDIA = "(min-width: 1px)";

/** A media condition that holds in no viewport a test runner can produce. */
const INACTIVE_MEDIA = "(min-width: 100000px)";

/** A supports condition every engine running this suite satisfies. */
const ACTIVE_SUPPORTS = "(display: block)";

/**
 * A supports condition of valid syntax naming a declaration no engine
 * supports. The property name is well-formed and the value is a plain
 * identifier, so this exercises "parsed, and false" rather than the
 * "unparseable" case the malformed test covers.
 */
const INACTIVE_SUPPORTS = "(not-a-real-property: nonsense)";

test("a media condition that holds makes the context active", () => {
  expect(matchMedia(ACTIVE_MEDIA).matches).toBe(true);
  expect(isContextActive(context({ kind: "media", condition: ACTIVE_MEDIA }))).toBe(true);
});

test("a media condition that does not hold makes the context inactive", () => {
  expect(matchMedia(INACTIVE_MEDIA).matches).toBe(false);
  expect(isContextActive(context({ kind: "media", condition: INACTIVE_MEDIA }))).toBe(false);
});

test("a supports condition that holds makes the context active", () => {
  expect(CSS.supports(ACTIVE_SUPPORTS)).toBe(true);
  expect(isContextActive(context({ kind: "supports", condition: ACTIVE_SUPPORTS }))).toBe(true);
});

test("a supports condition that does not hold makes the context inactive", () => {
  expect(CSS.supports(INACTIVE_SUPPORTS)).toBe(false);
  expect(isContextActive(context({ kind: "supports", condition: INACTIVE_SUPPORTS }))).toBe(false);
});

test("an empty context is active", () => {
  expect(isContextActive(context())).toBe(true);
});

test("a layer entry never gates the context", () => {
  expect(isContextActive(context({ kind: "layer", name: "components" }))).toBe(true);
  expect(isContextActive(context({ kind: "layer", name: null }))).toBe(true);

  // A layer beside an inactive condition changes nothing: the condition
  // still decides, and the layer still contributes no answer of its own.
  expect(
    isContextActive(
      context({ kind: "layer", name: "components" }, { kind: "media", condition: INACTIVE_MEDIA }),
    ),
  ).toBe(false);
  expect(
    isContextActive(
      context({ kind: "layer", name: "components" }, { kind: "media", condition: ACTIVE_MEDIA }),
    ),
  ).toBe(true);
});

const CONJUNCTION_GRID: ReadonlyArray<readonly [string, string, boolean]> = [
  [ACTIVE_MEDIA, ACTIVE_SUPPORTS, true],
  [ACTIVE_MEDIA, INACTIVE_SUPPORTS, false],
  [INACTIVE_MEDIA, ACTIVE_SUPPORTS, false],
  [INACTIVE_MEDIA, INACTIVE_SUPPORTS, false],
];

for (const [media, supports, expected] of CONJUNCTION_GRID) {
  test(`a context of @media ${media} and @supports ${supports} is ${expected ? "active" : "inactive"}`, () => {
    expect(
      isContextActive(
        context({ kind: "media", condition: media }, { kind: "supports", condition: supports }),
      ),
    ).toBe(expected);
  });
}

test("three entries stay conjunctive, so one inactive condition among active ones decides", () => {
  expect(
    isContextActive(
      context(
        { kind: "media", condition: ACTIVE_MEDIA },
        { kind: "supports", condition: ACTIVE_SUPPORTS },
        { kind: "media", condition: INACTIVE_MEDIA },
      ),
    ),
  ).toBe(false);
});

/**
 * The nesting the compiler is given for the composed cases: a probe wrapped
 * in a `@supports` and a `@media`, with a `@layer` outside both, so that the
 * evaluated context is the one the compiler produced rather than one written
 * by hand to match.
 */
function nestedSource(media: string, supports: string): string {
  return `@layer components {
  @supports ${supports} {
    @media ${media} {
      /* css-console: log color label="nested probe" */
      .probe {
        color: rgb(1 2 3);
      }
    }
  }
}`;
}

for (const [media, supports, expected] of CONJUNCTION_GRID) {
  test(`a compiled context of @media ${media} inside @supports ${supports} is ${expected ? "active" : "inactive"}`, () => {
    const compiled = compile(nestedSource(media, supports));
    const probe = compiled.probes[0];

    if (probe === undefined || probe.kind !== "value") {
      throw new Error("expected a compiled value probe");
    }

    expect(probe.context.entries).toEqual([
      { kind: "layer", name: "components" },
      { kind: "supports", condition: supports },
      { kind: "media", condition: media },
    ]);
    expect(isContextActive(probe.context)).toBe(expected);
  });
}

test("an unparseable media condition is inactive, and the engine says why", () => {
  // Pinned against the engine rather than recalled. Media Queries Level 4
  // section 3.1 says a malformed query is replaced by `not all`, and `not
  // all` matches nothing, so an unparseable condition can never make a
  // context active.
  const query = matchMedia("not a real query");

  expect(query.media).toBe("not all");
  expect(query.matches).toBe(false);
  expect(isContextActive(context({ kind: "media", condition: "not a real query" }))).toBe(false);
});

test("an unparseable supports condition is inactive", () => {
  expect(CSS.supports("garbage")).toBe(false);
  expect(isContextActive(context({ kind: "supports", condition: "garbage" }))).toBe(false);
});

test("an empty media condition is active, because an empty query is the universal query", () => {
  // The compiler cannot currently produce this, since PostCSS records an
  // at-rule's parameters and `@media { }` is not valid CSS, but the value is
  // pinned so that the predicate's behavior on it is a recorded fact rather
  // than an accident: an empty query serializes to the empty string and
  // matches everything, which is the opposite of the malformed case above.
  expect(matchMedia("").matches).toBe(true);
  expect(isContextActive(context({ kind: "media", condition: "" }))).toBe(true);
});

test("an indexed declaration inside an inactive condition is excluded from the guard", () => {
  // The primitive CSSC-021 is built on: guard candidates come from the
  // compiler with their contexts attached, and this predicate is what turns
  // that set into the competitors that are live right now. No guard code is
  // involved beyond `guardCandidates()` itself.
  const compiled = compile(`.always-competes {
  color: rgb(1 2 3);
}

@media ${INACTIVE_MEDIA} {
  .inactive-competitor {
    color: rgb(4 5 6);
  }
}

@media ${ACTIVE_MEDIA} {
  .active-competitor {
    color: rgb(7 8 9);
  }
}

@supports ${INACTIVE_SUPPORTS} {
  .unsupported-competitor {
    color: rgb(10 11 12);
  }
}`);

  expect(compiled.diagnostics).toEqual([]);

  const candidates = [...guardCandidates(compiled.guardIndex, "color")];

  expect(candidates.map((candidate) => candidate.selector).sort()).toEqual([
    ".active-competitor",
    ".always-competes",
    ".inactive-competitor",
    ".unsupported-competitor",
  ]);

  const live = candidates
    .filter((candidate) => isContextActive(candidate.context))
    .map((candidate) => candidate.selector)
    .sort();

  expect(live).toEqual([".active-competitor", ".always-competes"]);
});

test("the predicate reads live state rather than a cached answer", () => {
  // Nothing is memoized, so the same context evaluated twice around a
  // viewport-dependent condition reports the world as it is each time. The
  // condition here is written against the current window width, and the
  // assertion is that both reads agree with `matchMedia()` taken at the same
  // moment rather than with a value captured earlier.
  const wide = `(min-width: ${window.innerWidth + 1000}px)`;
  const narrow = `(min-width: ${Math.max(window.innerWidth - 1, 0)}px)`;

  expect(isContextActive(context({ kind: "media", condition: wide }))).toBe(
    matchMedia(wide).matches,
  );
  expect(isContextActive(context({ kind: "media", condition: narrow }))).toBe(
    matchMedia(narrow).matches,
  );
  expect(isContextActive(context({ kind: "media", condition: wide }))).toBe(false);
});
