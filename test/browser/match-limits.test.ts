import { expect, test } from "vite-plus/test";

import { compileSource } from "../../src/core/compiler/index.ts";
import type { CompiledProbeBranch } from "../../src/core/compiler/index.ts";
import { matchBranches } from "../../src/browser/matcher/index.ts";
import { limitMatches } from "../../src/browser/matcher/limits.ts";

/**
 * Match limiting composed with real document-order matching.
 *
 * limits.ts is pure data logic and is specified exhaustively in
 * test/unit/match-limits.test.ts. This suite adds the one fact that logic
 * cannot prove on its own: that truncating to a prefix of a matcher's output
 * keeps the earliest elements a real document produces, in the order
 * `matchBranches()` actually reports them, rather than in an order a unit
 * test's literal array merely assumes.
 */

/** A fixture URL that can never resolve, matching the other browser suites. */
const FIXTURE_URL = "https://fixtures.css-console.invalid/match-limits.css";

function branchesOf(css: string): readonly CompiledProbeBranch[] {
  const compiled = compileSource(css, { url: FIXTURE_URL });

  expect(compiled.diagnostics).toEqual([]);

  const probe = compiled.probes[0];

  if (probe === undefined || probe.kind !== "value") {
    throw new Error("expected a compiled value probe");
  }

  return probe.branches;
}

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

test("limiting matched elements keeps the first matches in document order and reports the true total", () => {
  const branches = branchesOf(`/* css-console: log color */
.item {
  color: rgb(1 2 3);
}`);

  withFixture(
    `<ul>
      <li class="item" id="first"></li>
      <li class="item" id="second"></li>
      <li class="item" id="third"></li>
      <li class="item" id="fourth"></li>
      <li class="item" id="fifth"></li>
    </ul>`,
    () => {
      const matched = matchBranches(branches);

      expect(matched.diagnostics).toEqual([]);
      expect(matched.matches).toHaveLength(5);

      const limited = limitMatches(matched.matches, 3);

      expect(limited.evaluated.map((match) => match.element.id)).toEqual([
        "first",
        "second",
        "third",
      ]);
      expect(limited.total).toBe(5);
      expect(limited.omitted).toBe(2);
    },
  );
});
