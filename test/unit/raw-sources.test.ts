import { expect, test } from "vite-plus/test";

import { acceptRawSources, diagnoseDuplicateIdentities } from "../../src/browser/sources/index.ts";
import type { RawSource } from "../../src/browser/sources/index.ts";

/**
 * Explicit raw source acceptance and cross-source duplicate identity
 * diagnosis, checked as pure data logic with no DOM dependency.
 *
 * `acceptRawSources()` and `diagnoseDuplicateIdentities()` touch no DOM API,
 * so both are exercised here in the unit lane rather than the browser lane;
 * the composition with a real document and the real evaluator lives in
 * test/browser/raw-sources.test.ts, matching how test/unit/match-limits.test.ts
 * separates pure matcher logic from the browser-lane matching it composes
 * into.
 */

test("acceptRawSources turns an input into a raw source, preserving order", () => {
  const result = acceptRawSources([
    { id: "tokens", css: ".a { color: red; }" },
    { id: "layout", css: ".b { color: blue; }" },
  ]);

  expect(result.diagnostics).toHaveLength(0);
  expect(result.sources).toEqual([
    { kind: "raw", id: "tokens", url: "raw:tokens", css: ".a { color: red; }" },
    { kind: "raw", id: "layout", url: "raw:layout", css: ".b { color: blue; }" },
  ]);
});

test("a caller-supplied url is kept verbatim instead of being synthesized", () => {
  const result = acceptRawSources([
    { id: "tokens", css: ".a {}", url: "https://example.invalid/generated/tokens.css" },
  ]);

  expect(result.sources[0]?.url).toBe("https://example.invalid/generated/tokens.css");
});

test("a synthesized url uses the raw: scheme rather than the inline: scheme", () => {
  const result = acceptRawSources([{ id: "tokens", css: ".a {}" }]);

  expect(result.sources[0]?.url).toBe("raw:tokens");
  expect(result.sources[0]?.url.startsWith("inline:")).toBe(false);
});

test("an empty id is rejected: no source is produced and a diagnostic explains why", () => {
  const result = acceptRawSources([{ id: "", css: ".a {}" }]);

  expect(result.sources).toHaveLength(0);
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]?.code).toBe("EMPTY_SOURCE_IDENTITY");
  expect(result.diagnostics[0]?.severity).toBe("error");
  // The identity is empty and cannot itself name which input failed, so the
  // diagnostic carries the input's position in the supplied list instead.
  expect(result.diagnostics[0]?.details).toEqual({ index: 0 });
});

test("a mix of valid and empty-id inputs keeps the valid ones and reports only the empty one, naming its index", () => {
  const result = acceptRawSources([
    { id: "tokens", css: ".a {}" },
    { id: "", css: ".b {}" },
    { id: "layout", css: ".c {}" },
  ]);

  expect(result.sources.map((source) => source.id)).toEqual(["tokens", "layout"]);
  expect(result.diagnostics[0]?.details).toEqual({ index: 1 });
  expect(result.diagnostics).toHaveLength(1);
});

test("acceptRawSources does not itself diagnose two inputs sharing one id", () => {
  // Cross-input duplication is diagnoseDuplicateIdentities's job, run over
  // the combined set of every source kind a scan collected; see the module
  // doc comment. acceptRawSources only decides whether one input, on its
  // own, carries a usable identity.
  const result = acceptRawSources([
    { id: "tokens", css: ".a {}" },
    { id: "tokens", css: ".b {}" },
  ]);

  expect(result.sources).toHaveLength(2);
  expect(result.diagnostics).toHaveLength(0);
});

/** Builds a minimal raw source for diagnoseDuplicateIdentities fixtures. */
function raw(id: string, css = ""): RawSource {
  return { kind: "raw", id, url: `raw:${id}`, css };
}

test("diagnoseDuplicateIdentities reports nothing when every identity is unique", () => {
  expect(diagnoseDuplicateIdentities([raw("a"), raw("b"), raw("c")])).toHaveLength(0);
});

test("diagnoseDuplicateIdentities reports one diagnostic per duplicated identity, with the holder count", () => {
  const diagnostics = diagnoseDuplicateIdentities([raw("shared"), raw("solo"), raw("shared")]);

  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]?.code).toBe("DUPLICATE_SOURCE_IDENTITY");
  expect(diagnostics[0]?.severity).toBe("warning");
  expect(diagnostics[0]?.details).toEqual({ identity: "shared", holders: 2 });
});

test("diagnoseDuplicateIdentities reports each duplicated identity once, even with three or more holders", () => {
  const diagnostics = diagnoseDuplicateIdentities([raw("shared"), raw("shared"), raw("shared")]);

  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]?.details).toEqual({ identity: "shared", holders: 3 });
});

test("diagnoseDuplicateIdentities composes across raw sources with no document at all", () => {
  // The function reads only `id` off whatever DiscoveredSource it is given,
  // so a caller can compose it over raw sources alone, without an
  // inline-discovered or linked-discovered source in the mix. The
  // inline/linked composition, which needs a real document, is proved in
  // test/browser/raw-sources.test.ts.
  const { sources } = acceptRawSources([
    { id: "duplicate", css: ".a {}" },
    { id: "duplicate", css: ".b {}", url: "https://example.invalid/other.css" },
  ]);

  const diagnostics = diagnoseDuplicateIdentities(sources);

  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]?.details).toEqual({ identity: "duplicate", holders: 2 });
});
