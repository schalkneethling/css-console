import { expect, test } from "vite-plus/test";

import { compileSource } from "../../src/core/compiler/index.ts";
import type { CompiledFunctionProbe } from "../../src/core/compiler/index.ts";
import {
  evaluateFunctionProbe,
  supportsCustomFunctions,
} from "../../src/browser/evaluator/index.ts";

/**
 * Function probe evaluation, checked against the engine that resolves.
 *
 * A custom function has no value of its own, so every expectation here is a
 * value Chromium produced for a real call in a real declaration on a real
 * element. `getComputedStyle()` is never stubbed, which the test strategy
 * requires (implementation plan section 8.3). The one thing injected is the
 * answer to "does this engine support `@function`", and only where the test
 * is about what happens when the answer is no: see the no-support case for
 * why injecting a boolean is not mocking the engine.
 *
 * The engine values pinned here were read in the browser lane against
 * headless Chromium 151.0.7922.34, the version this project's Vitest browser
 * project runs, and the version whose native `@function` support makes this
 * suite meaningful. An engine that answers differently fails the lane rather
 * than quietly changing what a probe reports.
 *
 * Every case composes the real pipeline: the CSS is authored once, compiled
 * with `compileSource()`, and applied to the document through the same text,
 * so the call sites being evaluated are the call sites the browser resolved.
 */

/** A fixture URL that can never resolve, matching the other browser suites. */
const FIXTURE_URL = "https://fixtures.css-console.invalid/function-probes.css";

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
 * Compiles a source and returns the function probe for the named function,
 * failing with the function name rather than an index error when the
 * compilation produced something else.
 */
function functionProbe(css: string, functionName: string): CompiledFunctionProbe {
  const compiled = compileSource(css, { url: FIXTURE_URL });
  const probe = compiled.probes.find(
    (candidate) => candidate.kind === "function" && candidate.functionName === functionName,
  );

  if (probe === undefined || probe.kind !== "function") {
    throw new Error(`expected a compiled function probe for ${functionName}`);
  }

  return probe;
}

/** The call site of a probe at one position, named rather than indexed inline. */
function callSiteAt(probe: CompiledFunctionProbe, position: number) {
  const callSite = probe.callSites[position];

  if (callSite === undefined) {
    throw new Error(`expected a call site at position ${position}`);
  }

  return callSite;
}

const SPACE = `/* css-console: log */
@function --space(--n) {
  result: calc(var(--n) * 10px);
}`;

test("a call site with one matched element reports the resolved value of its property", () => {
  const css = `${SPACE}

.callout {
  padding: --space(4);
}`;

  const probe = functionProbe(css, "--space");

  withFixture(`<aside class="callout" id="target"></aside>`, css, (host) => {
    const evaluation = evaluateFunctionProbe(probe);

    expect(evaluation.diagnostics).toEqual([]);
    expect(evaluation.callSites).toHaveLength(1);

    const evaluated = evaluation.callSites[0];

    expect(evaluated?.callSite.property).toBe("padding");
    expect(evaluated?.callSite.selector).toBe(".callout");
    expect(evaluated?.evaluations).toEqual([
      { element: elementById(host, "target"), resolved: "40px" },
    ]);
  });
});

test("a call site with many matched elements reports one evaluation each, in document order", () => {
  const css = `${SPACE}

.row {
  margin-top: --space(3);
}`;

  const probe = functionProbe(css, "--space");

  withFixture(
    `<ul>
       <li class="row" id="first"></li>
       <li class="row" id="second"></li>
       <li class="row" id="third"></li>
     </ul>`,
    css,
    (host) => {
      const evaluation = evaluateFunctionProbe(probe);
      const evaluated = evaluation.callSites[0];

      expect(evaluation.diagnostics).toEqual([]);
      expect(evaluated?.evaluations.map((entry) => entry.element)).toEqual([
        elementById(host, "first"),
        elementById(host, "second"),
        elementById(host, "third"),
      ]);
      expect(evaluated?.evaluations.map((entry) => entry.resolved)).toEqual([
        "30px",
        "30px",
        "30px",
      ]);
    },
  );
});

test("every call site of one function is evaluated and attributed to itself", () => {
  const css = `${SPACE}

.callout {
  padding: --space(4);
}

.row {
  margin-top: --space(3);
}`;

  const probe = functionProbe(css, "--space");
  const first = callSiteAt(probe, 0);
  const second = callSiteAt(probe, 1);

  // The composed identifiers differ per call site, which is what makes the
  // attribution below an attribution rather than a coincidence of order.
  expect(first.probeId).not.toBe(second.probeId);
  expect(first.probeId.startsWith(`${probe.probeId}::`)).toBe(true);
  expect(second.probeId.startsWith(`${probe.probeId}::`)).toBe(true);

  withFixture(
    `<aside class="callout" id="callout"></aside>
     <p class="row" id="row"></p>`,
    css,
    (host) => {
      const evaluation = evaluateFunctionProbe(probe);

      expect(evaluation.diagnostics).toEqual([]);
      expect(
        evaluation.callSites.map((entry) => [entry.callSite.probeId, entry.evaluations]),
      ).toEqual([
        [first.probeId, [{ element: elementById(host, "callout"), resolved: "40px" }]],
        [second.probeId, [{ element: elementById(host, "row"), resolved: "30px" }]],
      ]);
    },
  );
});

test("a sole-contribution call reports the property's value, which the property may transform", () => {
  const css = `/* css-console: log */
@function --half() {
  result: 50%;
}

.frame {
  width: 300px;
}

.column {
  width: --half();
}`;

  const probe = functionProbe(css, "--half");
  const callSite = callSiteAt(probe, 0);

  expect(callSite.soleContribution).toBe(true);

  withFixture(`<div class="frame"><div class="column" id="target"></div></div>`, css, (host) => {
    const evaluation = evaluateFunctionProbe(probe);

    // The function returns a percentage, and the reported value is pixels,
    // because `width` resolves the percentage against the containing block
    // before anything can observe it. The value a record carries is the
    // property's resolved value, never the function's return value, and
    // `soleContribution` claims only that no other authored expression
    // contributed to it.
    expect(evaluation.callSites[0]?.evaluations).toEqual([
      { element: elementById(host, "target"), resolved: "150px" },
    ]);
    expect(evaluation.callSites[0]?.callSite.soleContribution).toBe(true);
  });
});

test("a nested call reports the property's value and stays a non-sole contribution", () => {
  const css = `${SPACE}

.gutter {
  margin-left: calc(--space(2) + 5px);
}`;

  const probe = functionProbe(css, "--space");

  expect(callSiteAt(probe, 0).soleContribution).toBe(false);

  withFixture(`<p class="gutter" id="target"></p>`, css, (host) => {
    const evaluation = evaluateFunctionProbe(probe);

    // 20px from the call plus the 5px authored around it. Nothing here
    // isolates the call's own result, which is the honesty
    // `soleContribution: false` carries.
    expect(evaluation.callSites[0]?.evaluations).toEqual([
      { element: elementById(host, "target"), resolved: "25px" },
    ]);
    expect(evaluation.callSites[0]?.callSite.soleContribution).toBe(false);
  });
});

test("arguments ride through evaluation exactly as authored", () => {
  const css = `${SPACE}

.dense {
  padding-top: --space(var(--density));
}`;

  const probe = functionProbe(css, "--space");

  withFixture(`<p class="dense" id="target" style="--density: 2"></p>`, css, (host) => {
    const evaluation = evaluateFunctionProbe(probe);

    expect(evaluation.callSites[0]?.callSite.arguments).toEqual(["var(--density)"]);
    expect(evaluation.callSites[0]?.evaluations).toEqual([
      { element: elementById(host, "target"), resolved: "20px" },
    ]);
  });
});

test("one call site reports a different value per element when an argument varies", () => {
  const css = `${SPACE}

.dense {
  padding-top: --space(var(--density));
}`;

  const probe = functionProbe(css, "--space");

  withFixture(
    `<p class="dense" id="loose" style="--density: 2"></p>
     <p class="dense" id="tight" style="--density: 5"></p>`,
    css,
    (host) => {
      const evaluation = evaluateFunctionProbe(probe);

      expect(evaluation.callSites).toHaveLength(1);
      expect(evaluation.callSites[0]?.evaluations).toEqual([
        { element: elementById(host, "loose"), resolved: "20px" },
        { element: elementById(host, "tight"), resolved: "50px" },
      ]);
    },
  );
});

test("an engine without custom function support produces one reserved diagnostic and no evaluations", () => {
  const css = `${SPACE}

.callout {
  padding: --space(4);
}`;

  const probe = functionProbe(css, "--space");

  withFixture(`<aside class="callout" id="target"></aside>`, css, () => {
    const evaluation = evaluateFunctionProbe(probe, { supportsFunctions: false });

    expect(evaluation.callSites).toEqual([]);
    expect(evaluation.diagnostics).toHaveLength(1);
    expect(evaluation.diagnostics[0]?.code).toBe("RESERVED_PENDING_SUPPORT");
    expect(evaluation.diagnostics[0]?.severity).toBe("warning");
    expect(evaluation.diagnostics[0]?.details).toMatchObject({ functionName: "--space" });
  });
});

test("this engine supports custom functions, and the facts the detection rests on hold", () => {
  expect(supportsCustomFunctions()).toBe(true);

  // The detector reads one global. `CSSFunctionRule` is the interface CSSOM
  // exposes for an `@function` rule, so an engine that parses `@function`
  // has it and an engine that does not cannot.
  expect("CSSFunctionRule" in globalThis).toBe(true);

  // The `at-rule()` extension to `CSS.supports()` answers for `@function`
  // in this engine, and answers `false` for an at-rule nobody defines. It is
  // not the detector, because an engine that does not implement `at-rule()`
  // answers `false` for every at-rule, including ones it supports, so a
  // `false` from it cannot be told apart from a missing `@function`.
  expect(CSS.supports("at-rule(@function)")).toBe(true);
  expect(CSS.supports("at-rule(@media)")).toBe(true);
  expect(CSS.supports("at-rule(@not-a-real-at-rule)")).toBe(false);

  // The rule really is an `@function` rule rather than an unknown one, read
  // from a live sheet rather than from the interface name alone.
  withFixture(``, `@function --detected() { result: 1px; }`, () => {
    const sheet = document.styleSheets[document.styleSheets.length - 1];
    const rule = sheet?.cssRules[0];

    expect(rule?.constructor.name).toBe("CSSFunctionRule");
  });
});

test("a call site in an inactive condition is skipped, and its active sibling is evaluated", () => {
  const css = `${SPACE}

@media (width < 1px) {
  .narrow {
    padding-top: --space(6);
  }
}

@media (min-width: 1px) {
  .wide {
    padding-top: --space(1);
  }
}`;

  const probe = functionProbe(css, "--space");

  expect(probe.callSites).toHaveLength(2);

  withFixture(
    `<p class="narrow" id="narrow"></p>
     <p class="wide" id="wide"></p>`,
    css,
    (host) => {
      const evaluation = evaluateFunctionProbe(probe);

      // An inactive `@media` is the normal state of a responsive stylesheet
      // rather than a fault, so the skipped call site produces no evaluation
      // and no diagnostic at all.
      expect(evaluation.diagnostics).toEqual([]);
      expect(evaluation.callSites).toHaveLength(1);
      expect(evaluation.callSites[0]?.callSite.selector).toBe(".wide");
      expect(evaluation.callSites[0]?.evaluations).toEqual([
        { element: elementById(host, "wide"), resolved: "10px" },
      ]);
    },
  );
});

test("a call site in a custom property declaration reads that custom property verbatim", () => {
  const css = `${SPACE}

.tokened {
  --pad: --space(2);
}`;

  const probe = functionProbe(css, "--space");

  expect(callSiteAt(probe, 0).property).toBe("--pad");

  withFixture(`<p class="tokened" id="target"></p>`, css, (host) => {
    const evaluation = evaluateFunctionProbe(probe);

    // An unregistered custom property computes to a token sequence, so the
    // function is substituted while the surrounding `calc()` is not reduced.
    // The reported value is what the engine computed for `--pad` itself.
    expect(evaluation.callSites[0]?.evaluations).toEqual([
      { element: elementById(host, "target"), resolved: "calc(2 * 10px)" },
    ]);
  });
});

test("a call site the engine cannot match does not stop the call sites beside it", () => {
  const css = `${SPACE}

.broken:not-a-real-pseudo-class {
  padding-top: --space(9);
}

.intact {
  padding-top: --space(7);
}`;

  const probe = functionProbe(css, "--space");

  withFixture(`<p class="intact" id="target"></p>`, css, (host) => {
    const evaluation = evaluateFunctionProbe(probe);

    expect(evaluation.diagnostics).toHaveLength(1);
    expect(evaluation.diagnostics[0]?.code).toBe("UNPARSEABLE_SELECTOR_BRANCH");
    expect(evaluation.diagnostics[0]?.details).toMatchObject({
      selector: ".broken:not-a-real-pseudo-class",
      reason: "SyntaxError",
    });

    expect(evaluation.callSites).toHaveLength(2);
    expect(evaluation.callSites[0]?.evaluations).toEqual([]);
    expect(evaluation.callSites[1]?.evaluations).toEqual([
      { element: elementById(host, "target"), resolved: "70px" },
    ]);
  });
});

test("a call site whose selector carries a pseudo-element matches nothing rather than throwing", () => {
  const css = `/* css-console: log */
@function --half() {
  result: 50%;
}

.decorated::before {
  content: "x";
  width: --half();
}`;

  const probe = functionProbe(css, "--half");

  // A call site's selector is the rule's flat selector, and nothing strips a
  // pseudo-element from it, so an author who calls a function from a
  // pseudo-element rule gets a call site whose selector still carries one.
  expect(callSiteAt(probe, 0).selector).toBe(".decorated::before");

  withFixture(`<p class="decorated" id="target"></p>`, css, () => {
    // `querySelectorAll()` matches no element for a selector containing a
    // pseudo-element, and does not throw, so the call site is evaluated
    // against nothing and reports nothing.
    expect(document.querySelectorAll(".decorated::before")).toHaveLength(0);

    const evaluation = evaluateFunctionProbe(probe);

    expect(evaluation.diagnostics).toEqual([]);
    expect(evaluation.callSites).toHaveLength(1);
    expect(evaluation.callSites[0]?.evaluations).toEqual([]);
  });
});

test("a call of a function the document never defines resolves to the property's fallback", () => {
  const css = `${SPACE}

.orphaned {
  height: --space(4);
  color: --space(4);
}`;

  const probe = functionProbe(css, "--space");

  // The stylesheet applied to the document deliberately omits the definition,
  // so the calls are invalid at computed-value time.
  const applied = `.orphaned {
  height: --space(4);
  color: --space(4);
}`;

  withFixture(`<p class="orphaned" id="target"></p>`, applied, (host) => {
    const evaluation = evaluateFunctionProbe(probe);
    const element = elementById(host, "target");

    // The engine drops a declaration that is invalid at computed-value time
    // and the property takes its inherited or initial value instead, which is
    // then resolved: an empty paragraph has no content to make it tall, and
    // the inherited color is the document default.
    expect(evaluation.callSites[0]?.evaluations).toEqual([{ element, resolved: "0px" }]);
    expect(getComputedStyle(element).getPropertyValue("color")).toBe("rgb(0, 0, 0)");
  });
});

test("evaluating a function probe writes nothing to the document", () => {
  const css = `${SPACE}

.callout {
  padding: --space(4);
}`;

  const probe = functionProbe(css, "--space");

  withFixture(`<aside class="callout" id="target"></aside>`, css, () => {
    const before = document.body.innerHTML;

    evaluateFunctionProbe(probe);

    expect(document.body.innerHTML).toBe(before);
  });
});
