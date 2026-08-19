import { expect, test } from "vite-plus/test";

import { gateSources, matchesUrlPattern } from "../../src/browser/sources/index.ts";
import type { DiscoveredSource } from "../../src/browser/sources/index.ts";

/**
 * The exclude matcher and the exclusion half of the gate, checked as pure
 * string logic with no DOM dependency.
 *
 * `matchesUrlPattern()` reads no document and calls no engine API, so it is
 * exercised here in the unit lane rather than the browser lane, matching how
 * test/unit/raw-sources.test.ts exercises `acceptRawSources()`. The media and
 * `disabled` half of the gate is the opposite kind of question, since it is
 * answered by a live engine, and it lives in test/browser/source-gating.test.ts.
 *
 * `gateSources()` appears here only for raw sources, which carry no element
 * and therefore reach neither `matchMedia()` nor a `disabled` property. Every
 * case that involves an element belongs in the browser lane.
 *
 * The grammar is pinned exhaustively rather than sampled, because a glob
 * subset is exactly the kind of code whose surprises live in the cases nobody
 * wrote down: what `*` does at a `/`, what a pattern with no wildcard means,
 * and what happens to the regex metacharacters a URL is full of.
 */

/** A raw source, the one kind of source that needs no document to build. */
function raw(id: string, url?: string): DiscoveredSource {
  return { kind: "raw", id, url: url ?? `raw:${id}`, css: ".a { color: red; }" };
}

test("a pattern with no wildcard is an exact URL match rather than a substring match", () => {
  // The reason exact beats substring, stated as a case rather than as an
  // opinion: `a.css` is a suffix of `extra.css`, so a substring rule would
  // silently remove a stylesheet the caller never named.
  expect(matchesUrlPattern("https://example.invalid/a.css", "https://example.invalid/a.css")).toBe(
    true,
  );
  expect(matchesUrlPattern("https://example.invalid/extra.css", "a.css")).toBe(false);
  expect(matchesUrlPattern("https://example.invalid/a.css", "a.css")).toBe(false);
});

test("a pattern matches the whole URL, so a prefix or a suffix alone is not enough", () => {
  expect(matchesUrlPattern("https://example.invalid/a.css", "https://example.invalid")).toBe(false);
  expect(matchesUrlPattern("https://example.invalid/a.css", "/a.css")).toBe(false);
  expect(matchesUrlPattern("https://example.invalid/a.css", "*/a.css")).toBe(false);
  expect(matchesUrlPattern("https://example.invalid/a.css", "**/a.css")).toBe(true);
});

test("a single star matches any run of characters except a slash", () => {
  expect(matchesUrlPattern("https://example.invalid/a.css", "https://example.invalid/*.css")).toBe(
    true,
  );
  expect(matchesUrlPattern("https://example.invalid/a.css", "https://example.invalid/*")).toBe(
    true,
  );
  // The slash is the boundary a single star cannot cross, which is what makes
  // it useful for naming one directory's files without naming the tree.
  expect(
    matchesUrlPattern("https://example.invalid/css/a.css", "https://example.invalid/*.css"),
  ).toBe(false);
  expect(matchesUrlPattern("https://example.invalid/css/a.css", "https://example.invalid/*")).toBe(
    false,
  );
});

test("a double star matches any run of characters including slashes", () => {
  expect(
    matchesUrlPattern("https://example.invalid/css/deep/a.css", "https://example.invalid/**"),
  ).toBe(true);
  expect(matchesUrlPattern("https://example.invalid/css/deep/a.css", "**.css")).toBe(true);
  // A double star matches the empty run too, so a pattern ending in `/**`
  // still names the directory's own direct children.
  expect(matchesUrlPattern("https://example.invalid/a.css", "https://example.invalid/**")).toBe(
    true,
  );
});

test("the plan's own example removes any URL carrying a design-system path segment", () => {
  const pattern = "**/design-system/**";

  expect(
    matchesUrlPattern("https://example.invalid/assets/design-system/tokens.css", pattern),
  ).toBe(true);
  expect(matchesUrlPattern("https://example.invalid/design-system/tokens.css", pattern)).toBe(true);
  expect(
    matchesUrlPattern("https://example.invalid/design-system/deep/nested/tokens.css", pattern),
  ).toBe(true);
  expect(matchesUrlPattern("https://example.invalid/app/tokens.css", pattern)).toBe(false);
  // A directory whose name merely contains the segment is a different
  // directory, and the surrounding slashes are what say so.
  expect(matchesUrlPattern("https://example.invalid/my-design-systems/tokens.css", pattern)).toBe(
    false,
  );
});

test("a question mark is a literal character rather than a single-character wildcard", () => {
  // Documented rather than implied: the grammar is `*` and `**` and nothing
  // else, because a URL query string starts with a literal `?` and a smaller
  // grammar has fewer surprises than one that claims that character.
  expect(matchesUrlPattern("https://example.invalid/a.css?direct", "**/a.css?direct")).toBe(true);
  expect(matchesUrlPattern("https://example.invalid/a.cssX", "**/a.css?")).toBe(false);
  expect(matchesUrlPattern("https://example.invalid/a.css", "**/a.css?")).toBe(false);
});

test("regex metacharacters in a pattern are literal, so a dot matches only a dot", () => {
  expect(matchesUrlPattern("https://example.invalid/aXcss", "**/a.css")).toBe(false);
  expect(matchesUrlPattern("https://example.invalid/a.css", "**/a.css")).toBe(true);
  // Nothing is escaped by the caller, so every other metacharacter is a
  // literal too, and a pattern carrying one matches only that character.
  expect(matchesUrlPattern("https://example.invalid/a+b.css", "**/a+b.css")).toBe(true);
  expect(matchesUrlPattern("https://example.invalid/ab.css", "**/a+b.css")).toBe(false);
  expect(matchesUrlPattern("https://example.invalid/(a).css", "**/(a).css")).toBe(true);
  expect(matchesUrlPattern("https://example.invalid/a.css", "**/[abc].css")).toBe(false);
  expect(matchesUrlPattern("https://example.invalid/[abc].css", "**/[abc].css")).toBe(true);
  expect(matchesUrlPattern("https://example.invalid/a.css", "**/a.css$")).toBe(false);
});

test("an empty pattern matches only an empty URL, which no source has", () => {
  expect(matchesUrlPattern("", "")).toBe(true);
  expect(matchesUrlPattern("https://example.invalid/a.css", "")).toBe(false);
});

test("gateSources with no options makes every source active", () => {
  const sources = [raw("tokens"), raw("layout")];
  const gate = gateSources(sources);

  expect(gate.active).toEqual(sources);
  expect(gate.inactive).toEqual([]);
  expect(gate.excluded).toEqual([]);
});

test("a raw source is excluded by the URL synthesized for it", () => {
  // A caller who supplies a source and then excludes it gets what they asked
  // for. The synthesized `raw:` URL is the source's URL, so it is what a
  // pattern is matched against, and there is no second rule for sources the
  // caller handed over directly.
  const tokens = raw("tokens");
  const layout = raw("layout");
  const gate = gateSources([tokens, layout], { exclude: ["raw:tokens"] });

  expect(gate.excluded).toEqual([tokens]);
  expect(gate.active).toEqual([layout]);
  expect(gate.inactive).toEqual([]);
});

test("a raw source carrying a caller-supplied URL is excluded by that URL", () => {
  const generated = raw("tokens", "https://example.invalid/design-system/tokens.css");
  const gate = gateSources([generated], { exclude: ["**/design-system/**"] });

  expect(gate.excluded).toEqual([generated]);
  expect(gate.active).toEqual([]);
});

test("a source is excluded when any one of several patterns matches it", () => {
  const first = raw("first", "https://example.invalid/a.css");
  const second = raw("second", "https://example.invalid/b.css");
  const third = raw("third", "https://example.invalid/c.css");
  const gate = gateSources([first, second, third], {
    exclude: ["**/a.css", "**/c.css"],
  });

  expect(gate.excluded).toEqual([first, third]);
  expect(gate.active).toEqual([second]);
});

test("an empty exclude list excludes nothing", () => {
  const tokens = raw("tokens");
  const gate = gateSources([tokens], { exclude: [] });

  expect(gate.active).toEqual([tokens]);
  expect(gate.excluded).toEqual([]);
});

test("each bucket keeps the order the sources were supplied in", () => {
  const sources = [raw("a"), raw("b"), raw("c"), raw("d")];
  const gate = gateSources(sources, { exclude: ["raw:b", "raw:c"] });

  expect(gate.active.map((source) => source.id)).toEqual(["a", "d"]);
  expect(gate.excluded.map((source) => source.id)).toEqual(["b", "c"]);
});

test("a raw source is never inactive, because it has no element to gate", () => {
  // Media and `disabled` are facts about an element the browser is reading.
  // A raw source came from the caller rather than from the document, so
  // neither question has an answer for it and the gate does not invent one.
  const gate = gateSources([raw("tokens")]);

  expect(gate.inactive).toEqual([]);
  expect(gate.active).toHaveLength(1);
});

test("the three buckets partition the input, so a source appears in exactly one", () => {
  const sources = [raw("a"), raw("b")];
  const gate = gateSources(sources, { exclude: ["raw:a"] });
  const all = [...gate.active, ...gate.inactive, ...gate.excluded];

  expect(all).toHaveLength(sources.length);
  expect(new Set(all).size).toBe(sources.length);
});
