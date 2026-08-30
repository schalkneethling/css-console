/**
 * The playground specification.
 *
 * The playground (`examples/playground/index.html`) is the one place where
 * css-console demonstrates itself against a real engine: nine annotated
 * cases, each answering a runtime question the CSS source alone cannot
 * answer. This lane drives that page in Chromium and reads the console
 * report the adapter renders, because a resolved container unit, a resolved
 * custom function return, or a resolved nested selector only exists once a
 * browser has computed it.
 *
 * ## The page contract this specification depends on
 *
 * The specification derives every expected value from the running page
 * rather than restating it, so it depends on the page's structure and not on
 * its numbers. The structure it depends on is small, and the playground has
 * to honor exactly this much:
 *
 * - The page is served at `/examples/playground/index.html`.
 * - It carries nine sections, `#case-1` through `#case-9`, each with a
 *   heading and at least one `<pre><code>` block holding the authored CSS.
 * - Every annotation carries the matching label, so a console group title
 *   reads `[case-1]` through `[case-9]` (the grammar is
 *   `css-console: <log-level> [property-list] [label="..."]`, defined in
 *   `src/core/annotations/index.ts`).
 * - The scan harness sets `document.documentElement.dataset.scanState` to
 *   `"complete"` once the scan summary resolves, which produces the
 *   `data-scan-state="complete"` attribute this lane synchronizes on, and to
 *   `"failed"` if the scan rejects.
 *
 * ## How the console report is read
 *
 * The adapter's rendering is defined in `src/browser/console/index.ts`, and
 * the shapes below were observed by driving a real scan through Playwright
 * rather than recalled:
 *
 * - `console.groupCollapsed()` surfaces with the message type
 *   `startGroupCollapsed`, and `console.groupEnd()` with `endGroup`, so the
 *   flat message stream can be folded back into a tree of group titles.
 * - `console.table()` surfaces with the type `table` and the text
 *   `[Object, Object]`, which carries no data at all. The rows are read from
 *   the message's first argument instead, through `jsonValue()`, where a
 *   live element serializes as the string `ref: <Node>` and every other
 *   column survives as itself.
 * - A value line that renders a color swatch is a `%c` format call, and
 *   Playwright's `text()` concatenates the format string with the style
 *   argument. The first argument alone is the readable line, so lines are
 *   read from `args()[0]` and the leading `%c  %c ` run is stripped.
 * - `console.time()` produces no message, and `console.timeEnd()` surfaces
 *   with the type `timeEnd` and the text `css-console scan 1: <n> ms`.
 */

import { expect, test } from "@playwright/test";
import type { ConsoleMessage, Page } from "@playwright/test";

/** Where the development server serves the playground. */
const PLAYGROUND_PATH = "/examples/playground/index.html";

/** How long the lane waits for the scan to publish its completion state. */
const SCAN_TIMEOUT = 15_000;

/** The nine case labels, in the order the page presents them. */
const CASE_LABELS = [
  "case-1",
  "case-2",
  "case-3",
  "case-4",
  "case-5",
  "case-6",
  "case-7",
  "case-8",
  "case-9",
] as const;

/** One row of a rendered `console.table()` call, with unknown columns. */
type TableRow = Record<string, unknown>;

/**
 * One console message, folded back into the group tree it was rendered
 * inside. `path` holds the titles of the groups that were open when the
 * message arrived, outermost first, which is what makes a message
 * attributable to the probe whose group encloses it.
 */
type Entry = {
  readonly type: string;
  readonly text: string;
  readonly first: string | null;
  readonly rows: readonly TableRow[] | null;
  readonly path: readonly string[];
};

/** One reported value, however the adapter chose to render it. */
type Reported = {
  readonly property: string | null;
  readonly authored: string | null;
  readonly resolved: string;
  readonly contested: boolean;
};

/** Everything one visit to the playground produced. */
type Visit = {
  readonly entries: readonly Entry[];
  readonly pageErrors: readonly Error[];
};

/**
 * Reads a console message's first argument as a string, returning `null`
 * when the argument is absent or is not a string. The first argument is what
 * the adapter composed; the arguments after it are styles and live elements,
 * which carry no text worth asserting on.
 */
async function firstArgument(message: ConsoleMessage): Promise<string | null> {
  const [handle] = message.args();

  if (handle === undefined) {
    return null;
  }

  try {
    const value: unknown = await handle.jsonValue();

    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Reads a `console.table()` message's rows from its first argument. A live
 * element in a row serializes as a string rather than failing the call, so
 * the columns that matter — the property, the authored value, the resolved
 * value, and the guard state — arrive intact.
 */
async function tableRows(message: ConsoleMessage): Promise<readonly TableRow[] | null> {
  const [handle] = message.args();

  if (handle === undefined) {
    return null;
  }

  try {
    const value: unknown = await handle.jsonValue();

    return Array.isArray(value) ? (value as TableRow[]) : null;
  } catch {
    return null;
  }
}

/**
 * Opens the playground, waits for the scan to publish its completion state,
 * and returns every console message it rendered together with any uncaught
 * page error. Listeners are attached before navigation so that nothing
 * rendered during module evaluation is missed.
 */
async function openPlayground(page: Page): Promise<Visit> {
  const entries: Entry[] = [];
  const pending: Promise<void>[] = [];
  const pageErrors: Error[] = [];
  const stack: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error);
  });

  page.on("console", (message) => {
    const type = message.type();
    const path = [...stack];

    if (type === "startGroup" || type === "startGroupCollapsed") {
      stack.push(message.text());
    } else if (type === "endGroup") {
      stack.pop();
    }

    pending.push(
      (async () => {
        const first = await firstArgument(message);
        const rows = type === "table" ? await tableRows(message) : null;

        entries.push({ type, text: message.text(), first, rows, path });
      })(),
    );
  });

  await page.goto(PLAYGROUND_PATH);
  await page.waitForFunction(
    () => document.documentElement.dataset["scanState"] !== undefined,
    undefined,
    { timeout: SCAN_TIMEOUT },
  );
  await expect(page.locator("html")).toHaveAttribute("data-scan-state", "complete");
  await Promise.all(pending);

  return { entries, pageErrors };
}

/**
 * The location suffix every group title ends with, as
 * ` — <url>:<line>:<column>`. Splitting a title on the em dash separator and
 * discarding the last segment therefore removes the location and leaves the
 * title's own text.
 */
const SEPARATOR = " — ";

/** A title with its trailing source location removed. */
function withoutLocation(title: string): string {
  const parts = title.split(SEPARATOR);

  parts.pop();

  return parts.join(SEPARATOR);
}

/**
 * The selector a probe group title names. A probe title reads
 * `css-console [label] <selector> — <location>`, so removing the location,
 * the leading directive, and the bracketed label leaves the resolved
 * selector the engine matched.
 */
function probeSelector(title: string): string {
  const withoutDirective = withoutLocation(title).replace(/^css-console\s+/, "");
  const labelEnd = withoutDirective.indexOf("] ");

  return withoutDirective.startsWith("[") ? withoutDirective.slice(labelEnd + 2) : withoutDirective;
}

/**
 * The destination property and the matched selector a call-site group title
 * names. A call-site title reads
 * `<property> with (<arguments>) — <selector> — <location>`, with a marker
 * appended when the call is not the whole declaration value.
 */
function callSiteParts(title: string): { property: string; selector: string } {
  const parts = title.split(SEPARATOR);
  const head = parts[0] ?? "";
  const selector = parts[1] ?? "";
  const property = head.slice(0, head.indexOf(" with ("));

  return { property, selector };
}

/** The entries rendered inside the group whose title carries a given label. */
function inCaseGroup(entries: readonly Entry[], label: string): Entry[] {
  return entries.filter((entry) => (entry.path[0] ?? "").includes(`[${label}]`));
}

/** The title of the group whose title carries a given label. */
function caseGroupTitles(entries: readonly Entry[], label: string): string[] {
  const titles = entries
    .filter(
      (entry) =>
        (entry.type === "startGroup" || entry.type === "startGroupCollapsed") &&
        entry.path.length === 0 &&
        entry.text.includes(`[${label}]`),
    )
    .map((entry) => entry.text);

  return [...new Set(titles)];
}

/** The readable text of a rendered line, with any `%c` format run removed. */
function lineText(entry: Entry): string {
  return (entry.first ?? entry.text).replace(/^%c\s+%c\s/, "");
}

/**
 * The value a single-record line reports. A line reads
 * `<property>: <authored> → <resolved>`, with ` (contested)` appended when
 * the guard reported a competing contribution.
 */
function parseLine(text: string): Reported | null {
  const match = /^([-a-zA-Z]+): (.+?) → (.+?)( \(contested\))?$/.exec(text);

  if (match === null) {
    return null;
  }

  return {
    property: match[1] ?? null,
    authored: match[2] ?? null,
    resolved: match[3] ?? "",
    contested: match[4] !== undefined,
  };
}

/**
 * Every value reported inside a set of entries, however the adapter rendered
 * it: as a per-property line for a probe that matched one element, as table
 * rows for a probe that matched several, or as the single
 * `resolved property value` column a function probe's call site renders.
 */
function reportedValues(entries: readonly Entry[]): Reported[] {
  const values: Reported[] = [];

  for (const entry of entries) {
    if (entry.rows !== null) {
      for (const row of entry.rows) {
        const resolved = row["resolved"] ?? row["resolved property value"];

        if (typeof resolved === "string") {
          values.push({
            property: typeof row["property"] === "string" ? row["property"] : null,
            authored: typeof row["authored"] === "string" ? row["authored"] : null,
            resolved,
            contested: row["contested"] === true,
          });
        }
      }

      continue;
    }

    const parsed = parseLine(lineText(entry));

    if (parsed !== null) {
      values.push(parsed);
    }
  }

  return values;
}

/** The resolved values of one property across every element a selector matches. */
async function computedValues(page: Page, selector: string, property: string): Promise<string[]> {
  return page.evaluate(
    ({ selector: target, property: name }) =>
      [...document.querySelectorAll(target)].map((element) =>
        globalThis.getComputedStyle(element).getPropertyValue(name),
      ),
    { selector, property },
  );
}

/**
 * Splits a comma-separated function argument list at its top level, so that
 * a nested function such as `calc(var(--k) * 1px)` survives as one argument.
 */
function splitArguments(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const character of text) {
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    }

    if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  parts.push(current.trim());

  return parts;
}

/**
 * The value a browser computes for one property set to one authored value,
 * measured on a throwaway element in the running page. This is how a bound
 * written as `4rem` inside a `clamp()` becomes the pixel value the report is
 * compared against, without the specification restating either number.
 */
async function computeAuthored(page: Page, property: string, value: string): Promise<string> {
  return page.evaluate(
    ({ property: name, value: authored }) => {
      const probe = document.createElement("div");

      probe.style.setProperty(name, authored);
      document.body.append(probe);

      const resolved = globalThis.getComputedStyle(probe).getPropertyValue(name);

      probe.remove();

      return resolved;
    },
    { property, value },
  );
}

/** A resolved length in pixels, as a number. */
function pixels(value: string): number {
  return Number.parseFloat(value);
}

test.describe("the playground", () => {
  test("loads without a page error and completes a scan", async ({ page }) => {
    const { entries, pageErrors } = await openPlayground(page);

    expect(pageErrors).toHaveLength(0);
    await expect(page.locator("html")).toHaveAttribute("data-scan-state", "complete");

    const timer = entries.find((entry) => entry.type === "timeEnd");

    expect(timer).toBeDefined();
    expect(timer?.text).toContain("css-console scan 1");

    const completion = entries.find((entry) =>
      lineText(entry).startsWith("css-console: scan complete"),
    );

    expect(completion).toBeDefined();
  });

  test("attributes every case to a console group through its label", async ({ page }) => {
    const { entries } = await openPlayground(page);

    for (const label of CASE_LABELS) {
      expect(caseGroupTitles(entries, label), `a group title carries [${label}]`).not.toHaveLength(
        0,
      );
    }

    // Case 7 guards its declaration behind `@supports`, so what the group
    // contains depends on the engine. The probe compiles and the group opens
    // from the source either way; only the body varies, so the feature
    // detection decides what is asserted about the body and never whether
    // the group exists.
    const randomSupported = await page.evaluate(() =>
      globalThis.CSS.supports("width", "random(1px, 2px)"),
    );
    const reported = reportedValues(inCaseGroup(entries, "case-7"));

    if (randomSupported) {
      expect(reported.length).toBeGreaterThan(0);

      for (const value of reported) {
        expect(value.resolved).toMatch(/^\d/);
      }
    } else {
      // The rule never applies, so the probe matches no evaluated element and
      // the group renders empty. This is the observed behavior in headless
      // Chromium 151, which supports no spelling of `random()`.
      expect(reported).toHaveLength(0);
    }
  });

  test("reports case 1 per call site and per element", async ({ page }) => {
    const { entries } = await openPlayground(page);
    const scoped = inCaseGroup(entries, "case-1");
    const callSites = scoped.filter(
      (entry) =>
        (entry.type === "startGroup" || entry.type === "startGroupCollapsed") &&
        entry.path.length === 1,
    );

    expect(callSites).toHaveLength(2);

    const perCallSite: string[][] = [];

    for (const callSite of callSites) {
      const { property, selector } = callSiteParts(callSite.text);
      const body = scoped.filter((entry) => entry.path[1] === callSite.text);
      const reported = reportedValues(body).map((value) => value.resolved);
      const expected = await computedValues(page, selector, property);

      expect(expected.length).toBeGreaterThan(0);
      expect(reported).toEqual(expected);

      perCallSite.push(reported);
    }

    // The same function, called from two properties, resolves differently at
    // each call site, and differently again for elements whose driving custom
    // property differs.
    const [firstSite = [], secondSite = []] = perCallSite;

    expect(new Set([...firstSite, ...secondSite]).size).toBeGreaterThan(1);
    expect(firstSite.some((value) => !secondSite.includes(value))).toBe(true);

    const varied = perCallSite.find((values) => new Set(values).size > 1);

    expect(varied, "one call site reports different values per element").toBeDefined();
  });

  test("reports case 2 as two concrete, differing colors", async ({ page }) => {
    const { entries } = await openPlayground(page);
    const titles = caseGroupTitles(entries, "case-2");

    expect(titles).toHaveLength(2);

    const resolvedColors: string[] = [];

    for (const title of titles) {
      const reported = reportedValues(entries.filter((entry) => entry.path[0] === title));

      expect(reported).toHaveLength(1);

      const [value] = reported as [Reported];

      expect(value.resolved).not.toContain("var(");
      expect(value.resolved).not.toContain("color-mix(");

      const property = value.property ?? "color";
      const expected = await computedValues(page, probeSelector(title), property);

      expect(expected).toContain(value.resolved);
      resolvedColors.push(value.resolved);
    }

    expect(new Set(resolvedColors).size).toBe(2);
  });

  test("reports case 4 at both clamp bounds and between them", async ({ page }) => {
    const { entries } = await openPlayground(page);
    const titles = caseGroupTitles(entries, "case-4");

    expect(titles).toHaveLength(1);

    const [title] = titles as [string];
    const reported = reportedValues(entries.filter((entry) => entry.path[0] === title));

    expect(reported).toHaveLength(3);

    const property = reported[0]?.property ?? "width";
    const expected = await computedValues(page, probeSelector(title), property);

    expect(reported.map((value) => value.resolved)).toEqual(expected);

    const authored = reported[0]?.authored ?? "";
    const clamp = /^clamp\((.*)\)$/.exec(authored);

    expect(clamp, "the annotated declaration is a clamp()").not.toBeNull();

    const [lower = "", , upper = ""] = splitArguments(clamp?.[1] ?? "");
    const lowerBound = pixels(await computeAuthored(page, property, lower));
    const upperBound = pixels(await computeAuthored(page, property, upper));
    const values = reported.map((value) => pixels(value.resolved)).sort((a, b) => a - b);
    const [pinnedLow = 0, fluid = 0, pinnedHigh = 0] = values;

    expect(pinnedLow).toBeCloseTo(lowerBound, 3);
    expect(pinnedHigh).toBeCloseTo(upperBound, 3);
    expect(fluid).toBeGreaterThan(lowerBound);
    expect(fluid).toBeLessThan(upperBound);
  });

  test("titles case 8 with the resolved selector rather than the nested source", async ({
    page,
  }) => {
    const { entries } = await openPlayground(page);
    const titles = caseGroupTitles(entries, "case-8");

    expect(titles).toHaveLength(1);

    const [title] = titles as [string];
    const selector = probeSelector(title);

    // A nested selector resolves through `:is()`, so the reported selector is
    // not the spelling the stylesheet carries.
    expect(selector).toContain(":is(");
    expect(await page.locator(selector).count()).toBeGreaterThan(0);

    const source = await page.locator("#case-8 pre code").first().textContent();

    expect(source ?? "").not.toContain(selector);
  });

  test("renders the case 9 handoff line for a contested guard", async ({ page }) => {
    const { entries } = await openPlayground(page);
    const scoped = inCaseGroup(entries, "case-9");
    const reported = reportedValues(scoped);

    expect(reported.some((value) => value.contested)).toBe(true);

    const handoff = scoped.find((entry) =>
      lineText(entry).startsWith("contested (competing-declaration)"),
    );

    expect(handoff).toBeDefined();
    expect(handoff === undefined ? "" : lineText(handoff)).toContain(
      "inspect this element in developer tools; the annotated declaration may not be the sole contributor",
    );
  });

  test("presents every section and source block without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    await page.goto(`http://localhost:5173${PLAYGROUND_PATH}`);

    for (const label of CASE_LABELS) {
      const section = page.locator(`#${label}`);

      await expect(section).toHaveCount(1);

      const heading = section.locator("h2").first();

      await expect(heading).not.toBeEmpty();

      const source = section.locator("pre code").first();

      await expect(source).not.toBeEmpty();
    }

    await context.close();
  });

  test("runs no animation under a reduced motion preference", async ({ browser }) => {
    const context = await browser.newContext({
      reducedMotion: "reduce",
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    await page.goto(`http://localhost:5173${PLAYGROUND_PATH}`);
    await page.waitForFunction(
      () => document.documentElement.dataset["scanState"] !== undefined,
      undefined,
      { timeout: SCAN_TIMEOUT },
    );

    const running = await page.evaluate(() => document.getAnimations().length);

    expect(running).toBe(0);

    await context.close();
  });
});
