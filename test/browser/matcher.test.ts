import { expect, test } from "vite-plus/test";

import { compileSource } from "../../src/core/compiler/index.ts";
import type { CompiledProbeBranch } from "../../src/core/compiler/index.ts";
import { matchBranches } from "../../src/browser/matcher/index.ts";

/**
 * Selector branch matching, checked against the engine that performs it.
 *
 * The compiler splits an annotated rule's selector list into branches and
 * matches nothing, because matching needs a document. This suite is the
 * other half of that split, so it belongs in the browser lane: every
 * expectation is what Chromium answers for a real selector against real
 * elements, and `querySelectorAll()` is never stubbed.
 *
 * Every case composes the real compiler. A test authors CSS with an
 * annotation, compiles it with `compileSource()`, and hands the compiled
 * probe's branches to the matcher, so the branch shapes under test are the
 * ones the pipeline actually produces rather than literals written to agree
 * with the matcher.
 *
 * Each test that adds elements to the document removes them again, through
 * `withFixture()`, so that one test's `.card` can never be another test's
 * match.
 */

/** A fixture URL that can never resolve, matching the other browser suites. */
const FIXTURE_URL = "https://fixtures.css-console.invalid/matcher.css";

/**
 * Compiles a source and returns the branches of its single value probe. The
 * compilation is asserted to be diagnostic-free, so a test that fails because
 * its CSS did not compile says so rather than reporting an empty match set.
 */
function branchesOf(css: string): readonly CompiledProbeBranch[] {
  const compiled = compileSource(css, { url: FIXTURE_URL });

  expect(compiled.diagnostics).toEqual([]);

  const probe = compiled.probes[0];

  if (probe === undefined || probe.kind !== "value") {
    throw new Error("expected a compiled value probe");
  }

  return probe.branches;
}

/**
 * Appends a fixture subtree to the document, runs the body against it, and
 * removes the subtree however the body ends. The wrapper element carries no
 * class of its own, so it can never satisfy a selector under test.
 */
function withFixture<T>(markup: string, body: (host: HTMLElement) => T): T {
  const host = document.createElement("div");

  host.innerHTML = markup;
  document.body.append(host);

  try {
    return body(host);
  } finally {
    host.remove();
  }
}

test("a branch that matches nothing produces no matches and no diagnostics", () => {
  const branches = branchesOf(`/* css-console: log color */
.absent-from-this-document {
  color: rgb(1 2 3);
}`);

  withFixture(`<p class="present"></p>`, () => {
    const result = matchBranches(branches);

    expect(result.matches).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

test("a branch that matches one element produces one match carrying that branch", () => {
  const branches = branchesOf(`/* css-console: log color */
.card {
  color: rgb(1 2 3);
}`);

  withFixture(`<article class="card" id="only"></article>`, () => {
    const result = matchBranches(branches);

    expect(result.diagnostics).toEqual([]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.element.id).toBe("only");
    expect(result.matches[0]?.branch).toBe(branches[0]);
  });
});

test("several matched elements are reported in document order", () => {
  const branches = branchesOf(`/* css-console: log color */
.item {
  color: rgb(1 2 3);
}`);

  withFixture(
    `<ul>
      <li class="item" id="first"></li>
      <li class="item" id="second"><span class="item" id="nested"></span></li>
      <li class="item" id="third"></li>
    </ul>`,
    () => {
      const result = matchBranches(branches);

      expect(result.diagnostics).toEqual([]);
      expect(result.matches.map((match) => match.element.id)).toEqual([
        "first",
        "second",
        "nested",
        "third",
      ]);
    },
  );
});

test("two branches reaching one element with the same pseudo report it once, attributed to the earlier branch", () => {
  const branches = branchesOf(`/* css-console: log color */
.card, div.card {
  color: rgb(1 2 3);
}`);

  expect(branches.map((branch) => branch.authored)).toEqual([".card", "div.card"]);

  withFixture(`<div class="card" id="both"></div>`, () => {
    const result = matchBranches(branches);

    expect(result.diagnostics).toEqual([]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.element.id).toBe("both");
    expect(result.matches[0]?.branch.authored).toBe(".card");
  });
});

test("matches from different branches interleave in document order rather than branch order", () => {
  const branches = branchesOf(`/* css-console: log color */
.alpha, .beta {
  color: rgb(1 2 3);
}`);

  withFixture(
    `<p class="alpha" id="one"></p>
     <p class="beta" id="two"></p>
     <p class="alpha" id="three"></p>`,
    () => {
      const result = matchBranches(branches);

      expect(result.diagnostics).toEqual([]);
      expect(result.matches.map((match) => match.element.id)).toEqual(["one", "two", "three"]);
      expect(result.matches.map((match) => match.branch.authored)).toEqual([
        ".alpha",
        ".beta",
        ".alpha",
      ]);
    },
  );
});

test("a branch the engine cannot parse produces a diagnostic and leaves the other branches matching", () => {
  const branches = branchesOf(`/* css-console: log color */
.valid-branch, .card:not-a-real-pseudo-class {
  color: rgb(1 2 3);
}`);

  expect(branches.map((branch) => branch.selector)).toEqual([
    ".valid-branch",
    ".card:not-a-real-pseudo-class",
  ]);

  withFixture(`<p class="valid-branch" id="valid"></p><p class="card"></p>`, () => {
    const result = matchBranches(branches);

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.element.id).toBe("valid");

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("UNPARSEABLE_SELECTOR_BRANCH");
    expect(result.diagnostics[0]?.severity).toBe("warning");
    expect(result.diagnostics[0]?.details).toMatchObject({
      branch: ".card:not-a-real-pseudo-class",
      selector: ".card:not-a-real-pseudo-class",
    });
  });
});

test("a caller that provides a source location sees it on the branch diagnostic", () => {
  // A compiled branch records selector text rather than a position, but the
  // probe that carries the branch does have a rule-level source, exactly as
  // MALFORMED_SELECTOR_LIST attaches one for a selector-list-level problem.
  // Threading it through keeps two rules carrying the same bad branch text
  // apart when diagnostics are deduplicated by location.
  const compiled = compileSource(
    `/* css-console: log color */
.card:not-a-real-pseudo-class {
  color: rgb(1 2 3);
}`,
    { url: FIXTURE_URL },
  );
  const probe = compiled.probes[0];

  if (probe === undefined || probe.kind !== "value") {
    throw new Error("expected a compiled value probe");
  }

  const result = matchBranches(probe.branches, document, probe.source);

  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]?.code).toBe("UNPARSEABLE_SELECTOR_BRANCH");
  expect(result.diagnostics[0]?.source).toEqual(probe.source);
});

test("querySelectorAll throws a SyntaxError DOMException for a selector the engine cannot parse", () => {
  // The behavior the invalid-branch case rests on, pinned against the engine
  // rather than recalled. Read in the browser lane against headless Chromium
  // 151.0.7922.34, the version this project's Vitest browser project runs.
  for (const selector of [":foo(", ".card:not-a-real-pseudo-class"]) {
    let thrown: unknown;

    try {
      document.querySelectorAll(selector);
    } catch (error) {
      thrown = error;
    }

    expect(thrown, selector).toBeInstanceOf(DOMException);
    expect((thrown as DOMException).name, selector).toBe("SyntaxError");
  }
});

test("a resolved nested selector matches only the nested elements", () => {
  const branches = branchesOf(`.card {
  /* css-console: log color */
  & .title {
    color: rgb(1 2 3);
  }
}`);

  // Nesting resolution flattens the rule before the branch reaches the
  // matcher, so the selector the engine is given carries the parent.
  expect(branches.map((branch) => branch.selector)).toEqual([":is(.card) .title"]);

  withFixture(
    `<article class="card"><h2 class="title" id="inside"></h2></article>
     <h2 class="title" id="outside"></h2>`,
    () => {
      const result = matchBranches(branches);

      expect(result.diagnostics).toEqual([]);
      expect(result.matches.map((match) => match.element.id)).toEqual(["inside"]);
    },
  );
});

test("a pseudo-element branch matches its originating elements and carries the pseudo-element", () => {
  const branches = branchesOf(`/* css-console: log color */
.card::before {
  color: rgb(1 2 3);
}`);

  expect(branches[0]?.selector).toBe(".card");
  expect(branches[0]?.pseudo).toBe("::before");

  withFixture(`<article class="card" id="origin"></article>`, () => {
    const result = matchBranches(branches);

    expect(result.diagnostics).toEqual([]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.element.id).toBe("origin");
    expect(result.matches[0]?.branch.pseudo).toBe("::before");
  });
});

test("a pseudo-element after a descendant space matches the descendants rather than the ancestor", () => {
  // .card ::before styles the ::before box of every descendant of .card, so
  // the matcher must report the descendants. Reporting the .card element
  // itself would attribute a computed value to an element the rule never
  // styles.
  const branches = branchesOf(`/* css-console: log color */
.card ::before {
  color: rgb(1 2 3);
}`);

  expect(branches.map((branch) => branch.selector)).toEqual([".card *"]);

  withFixture(
    `<article class="card" id="ancestor"><span id="child"><b id="grandchild"></b></span></article>`,
    () => {
      const result = matchBranches(branches);

      expect(result.diagnostics).toEqual([]);
      expect(result.matches.map((match) => match.element.id)).toEqual(["child", "grandchild"]);
    },
  );
});

test("a pseudo-element after a child combinator matches the children without a diagnostic", () => {
  // The compiler used to hand the engine the originating text ".card >",
  // which no engine parses, so the author was blamed with
  // UNPARSEABLE_SELECTOR_BRANCH for syntax the compiler produced. The
  // explicit universal compound keeps the branch parseable and the match set
  // correct.
  const branches = branchesOf(`/* css-console: log color */
.card > ::before {
  color: rgb(1 2 3);
}`);

  expect(branches.map((branch) => branch.selector)).toEqual([".card > *"]);

  withFixture(
    `<article class="card"><span id="child"><b id="grandchild"></b></span></article>`,
    () => {
      const result = matchBranches(branches);

      expect(result.diagnostics).toEqual([]);
      expect(result.matches.map((match) => match.element.id)).toEqual(["child"]);
    },
  );
});

test("one element reached under two pseudo-elements is two matches, and under one pseudo-element twice is one", () => {
  const branches = branchesOf(`/* css-console: log color */
.card::before, .card, div.card {
  color: rgb(1 2 3);
}`);

  expect(branches.map((branch) => branch.pseudo)).toEqual(["::before", null, null]);

  withFixture(`<div class="card" id="one-element"></div>`, () => {
    const result = matchBranches(branches);

    expect(result.diagnostics).toEqual([]);
    expect(result.matches).toHaveLength(2);
    expect(result.matches.every((match) => match.element.id === "one-element")).toBe(true);

    // Two matches on one element order by branch order between themselves,
    // and the `.card` and `div.card` branches collapse into the first of them.
    expect(result.matches.map((match) => match.branch.authored)).toEqual([
      ".card::before",
      ".card",
    ]);
  });
});

test("an element that is not connected to the document is not matched", () => {
  const branches = branchesOf(`/* css-console: log color */
.detached-card {
  color: rgb(1 2 3);
}`);

  const detached = document.createElement("article");

  detached.className = "detached-card";

  expect(detached.isConnected).toBe(false);
  expect(document.querySelectorAll(".detached-card")).toHaveLength(0);
  expect(matchBranches(branches).matches).toEqual([]);
});

test("matching from a root element sees only that root's subtree", () => {
  const branches = branchesOf(`/* css-console: log color */
.scoped {
  color: rgb(1 2 3);
}`);

  withFixture(`<section id="root"><p class="scoped" id="inside"></p></section>`, (host) => {
    const root = host.querySelector("#root");

    if (root === null) {
      throw new Error("expected the fixture root");
    }

    return withFixture(`<p class="scoped" id="elsewhere"></p>`, () => {
      expect(matchBranches(branches).matches.map((match) => match.element.id)).toEqual([
        "inside",
        "elsewhere",
      ]);
      expect(matchBranches(branches, root).matches.map((match) => match.element.id)).toEqual([
        "inside",
      ]);
    });
  });
});

test("matching writes nothing to the document", () => {
  const branches = branchesOf(`/* css-console: log color */
.card, .card::before, .missing {
  color: rgb(1 2 3);
}`);

  withFixture(`<article class="card"><span class="inner"></span></article>`, () => {
    const before = document.body.innerHTML;

    matchBranches(branches);

    expect(document.body.innerHTML).toBe(before);
  });
});
