import postcss from "postcss";
import type { Root, Rule } from "postcss";
import { expect, test } from "vite-plus/test";

import { associateAnnotations } from "../../src/core/annotations/index.ts";
import type { StyleRuleTarget } from "../../src/core/compiler/index.ts";
import {
  compileRuleProbeProperties,
  computeCallSiteIds,
  computeFunctionProbeId,
  computeValueProbeId,
  hashProbeParts,
  portableSource,
  resolveProbePlacement,
} from "../../src/core/compiler/index.ts";
import type { ValueProbeIdentity } from "../../src/core/compiler/index.ts";
import { resolveCallSites } from "../../src/core/functions/index.ts";
import type { CallSiteResolution, FunctionTarget } from "../../src/core/functions/index.ts";

import { fixtureUrl } from "../support/fixtures.ts";

/**
 * Deterministic probe identifier tests.
 *
 * CSSC-015 turns a compiled probe's identity into a stable string, so that
 * console output and, later, anything correlating probes across scans can
 * key on `probeId` rather than an array index. These tests assert the
 * identity contract the module doc comment states: which inputs change an
 * identifier and which must not, proven against the real resolution
 * pipeline rather than against hand-built identity objects alone, so a test
 * cannot pass by encoding the same wrong assumption the implementation
 * makes.
 */

const URL = fixtureUrl("inline");

/**
 * Compiles the resolved selector and property list for the first style-rule
 * annotation in `css`, failing loudly when the css does not produce exactly
 * one, so a malformed fixture cannot pass a test by accident.
 */
function valueIdentity(css: string, url = URL): ValueProbeIdentity {
  const { annotations } = associateAnnotations(css, { url });

  expect(annotations).toHaveLength(1);

  const target = annotations[0]?.target;

  if (target === undefined || target.kind !== "style-rule") {
    throw new Error("expected a style-rule target");
  }

  const root: Root = postcss.parse(css, { from: url });

  let rule: Rule | undefined;

  root.walkRules((candidate) => {
    if (
      rule === undefined &&
      candidate.source?.start?.line === target.source.start.line &&
      candidate.source?.start?.column === target.source.start.column
    ) {
      rule = candidate;
    }
  });

  if (rule === undefined) {
    throw new Error("expected to find the annotated rule");
  }

  const placement = resolveProbePlacement(rule, url);

  if (!placement.probed) {
    throw new Error("expected the rule to be probed");
  }

  const compiled = compileRuleProbeProperties(
    root,
    target as StyleRuleTarget,
    annotations[0].annotation.properties,
  );

  return {
    url,
    selector: placement.selector,
    pseudo: null,
    properties: compiled.properties.map((property) => property.name),
  };
}

/**
 * Resolves the call sites of the first function annotation in `css`, failing
 * loudly when the css does not produce exactly one function annotation.
 */
function resolveFunction(
  css: string,
  url = URL,
): { target: FunctionTarget; result: CallSiteResolution } {
  const { annotations } = associateAnnotations(css, { url });

  expect(annotations).toHaveLength(1);

  const target = annotations[0]?.target;

  if (target === undefined || target.kind !== "function") {
    throw new Error("expected a function target");
  }

  return {
    target: target as FunctionTarget,
    result: resolveCallSites(postcss.parse(css, { from: url }), target as FunctionTarget),
  };
}

test("hashProbeParts is a pure function of its parts, pinned against the published FNV-1a test vectors", () => {
  // The Fowler/Noll/Vo reference (isthe.com/chongo/tech/comp/fnv) publishes
  // 0x811c9dc5 as the 32-bit offset basis, which is the hash of zero-length
  // input by definition, since no byte is processed to change it, and
  // 0xe40c292c as the FNV-1a hash of the single byte "a". Pinning both
  // proves this implementation against the specification rather than
  // against its own output.
  expect(hashProbeParts([""])).toBe("811c9dc5");
  expect(hashProbeParts(["a"])).toBe("e40c292c");
});

test("hashProbeParts separates its parts, so concatenation cannot collide across a boundary", () => {
  expect(hashProbeParts(["ab", "c"])).not.toBe(hashProbeParts(["a", "bc"]));
});

test("identical source and annotation produce identical identifiers across separate parses", () => {
  const css = `/* css-console: log */
.card {
  padding: 1rem;
  color: red;
}`;

  const first = computeValueProbeId(valueIdentity(css));
  const second = computeValueProbeId(valueIdentity(css));

  expect(first).toBe(second);
});

test("moving the annotation to a different rule changes the identifier", () => {
  const onCard = `/* css-console: log */
.card {
  color: red;
}
.title {
  color: red;
}`;

  const onTitle = `.card {
  color: red;
}
/* css-console: log */
.title {
  color: red;
}`;

  const cardId = computeValueProbeId(valueIdentity(onCard));
  const titleId = computeValueProbeId(valueIdentity(onTitle));

  expect(cardId).not.toBe(titleId);
});

test("a different selector changes the identifier", () => {
  const a = computeValueProbeId(valueIdentity(`/* css-console: log */\n.a { color: red; }`));
  const b = computeValueProbeId(valueIdentity(`/* css-console: log */\n.b { color: red; }`));

  expect(a).not.toBe(b);
});

test("a different property selection changes the identifier", () => {
  const allProperties = computeValueProbeId(
    valueIdentity(`/* css-console: log */
.card {
  padding: 1rem;
  color: red;
}`),
  );

  const onlyColor = computeValueProbeId(
    valueIdentity(`/* css-console: log color */
.card {
  padding: 1rem;
  color: red;
}`),
  );

  expect(allProperties).not.toBe(onlyColor);
});

test("resolved rather than authored selectors feed the hash, so a nested rule and its flattened equivalent identify the same probe", () => {
  const nested = `.card {
  /* css-console: log */
  & .title {
    color: red;
  }
}`;

  const flattened = `/* css-console: log */
:is(.card) .title {
  color: red;
}`;

  const nestedIdentity = valueIdentity(nested);
  const flattenedIdentity = valueIdentity(flattened);

  // The authored selectors are nothing alike; only the resolved selector is.
  expect(nestedIdentity.selector).toBe(flattenedIdentity.selector);

  expect(computeValueProbeId(nestedIdentity)).toBe(computeValueProbeId(flattenedIdentity));
});

test("identifiers exclude machine-specific absolute path prefixes, for a bare path and for a file: URL alike", () => {
  const css = `/* css-console: log */\n.card { color: red; }`;

  const macId = computeValueProbeId(valueIdentity(css, "/Users/someone/project/app.css"));
  const linuxId = computeValueProbeId(valueIdentity(css, "/home/other/project/app.css"));

  expect(macId).toBe(linuxId);

  // scripts/inspect-probes.ts builds its url through pathToFileURL(), which
  // produces exactly this shape: the scheme, an empty authority, then the
  // same absolute path a bare path test above already covers.
  const macFileUrlId = computeValueProbeId(
    valueIdentity(css, "file:///Users/someone/project/app.css"),
  );
  const linuxFileUrlId = computeValueProbeId(
    valueIdentity(css, "file:///home/other/project/app.css"),
  );

  expect(macFileUrlId).toBe(linuxFileUrlId);
});

test("identifiers keep the directory for an http or https source, so two files sharing a name under one origin identify differently", () => {
  const css = `/* css-console: log */\n.card { color: red; }`;

  const stylesId = computeValueProbeId(valueIdentity(css, "https://example.test/styles/card.css"));
  const vendorId = computeValueProbeId(valueIdentity(css, "https://example.test/vendor/card.css"));

  expect(stylesId).not.toBe(vendorId);
});

test("identifiers keep the origin for an http or https source, so the same path on two sites identifies differently", () => {
  const css = `/* css-console: log */\n.card { color: red; }`;

  const oneId = computeValueProbeId(valueIdentity(css, "https://one.test/card.css"));
  const twoId = computeValueProbeId(valueIdentity(css, "https://two.test/card.css"));

  expect(oneId).not.toBe(twoId);
});

test("portableSource keeps the full URL for http and https, apart from a query string or fragment", () => {
  expect(portableSource("https://example.test/styles/card.css")).toBe(
    "https://example.test/styles/card.css",
  );
  expect(portableSource("https://example.test/styles/card.css?v=2")).toBe(
    "https://example.test/styles/card.css",
  );
  expect(portableSource("https://example.test/styles/card.css#frag")).toBe(
    "https://example.test/styles/card.css",
  );
});

test("portableSource reduces a file: URL, a bare filesystem path, and a Windows path to their final segment", () => {
  expect(portableSource("file:///Users/someone/project/app.css")).toBe("app.css");
  expect(portableSource("file:///home/other/project/app.css")).toBe("app.css");
  expect(portableSource("/Users/someone/project/app.css")).toBe("app.css");
  expect(portableSource("/home/other/project/app.css")).toBe("app.css");
  expect(portableSource("C:\\Users\\someone\\project\\app.css")).toBe("app.css");
});

test("a function probe identifier is stable across call-site additions elsewhere in the source", () => {
  const before = `/* css-console: log */
@function --space(--n) {
  result: calc(var(--n) * 1px);
}
.a {
  margin: --space(1);
}`;

  const after = `/* css-console: log */
@function --space(--n) {
  result: calc(var(--n) * 1px);
}
.a {
  margin: --space(1);
}
.b {
  padding: --space(2);
}`;

  const { target: beforeTarget } = resolveFunction(before);
  const { target: afterTarget } = resolveFunction(after);

  const beforeId = computeFunctionProbeId({
    url: beforeTarget.source.url,
    functionName: beforeTarget.functionName,
  });
  const afterId = computeFunctionProbeId({
    url: afterTarget.source.url,
    functionName: afterTarget.functionName,
  });

  expect(beforeId).toBe(afterId);
});

test("each call site has its own stable sub-identifier, and adding a call site elsewhere does not renumber the existing ones", () => {
  const before = `/* css-console: log */
@function --space(--n) {
  result: calc(var(--n) * 1px);
}
.a {
  margin: --space(1);
}
.b {
  padding: --space(2);
}`;

  const after = `/* css-console: log */
@function --space(--n) {
  result: calc(var(--n) * 1px);
}
.a {
  margin: --space(1);
}
.b {
  padding: --space(2);
}
.c {
  inset: --space(3);
}`;

  const beforeIds = computeCallSiteIds(resolveFunction(before).result.callSites);
  const afterIds = computeCallSiteIds(resolveFunction(after).result.callSites);

  expect(afterIds.slice(0, 2)).toEqual(beforeIds);
  expect(afterIds[2]).not.toBe(beforeIds[0]);
  expect(afterIds[2]).not.toBe(beforeIds[1]);
});

test("two structurally distinct call sites get distinct sub-identifiers", () => {
  const { result } = resolveFunction(`/* css-console: log */
@function --space(--n) {
  result: calc(var(--n) * 1px);
}
.a {
  margin: --space(1);
  padding: --space(2);
}`);

  const ids = computeCallSiteIds(result.callSites);

  expect(ids[0]).not.toBe(ids[1]);
});

test("two structurally identical call sites get distinct, ordinal sub-identifiers", () => {
  const { result } = resolveFunction(`/* css-console: log */
@function --space(--n) {
  result: calc(var(--n) * 1px);
}
.a {
  margin: --space(1) --space(1);
}`);

  const ids = computeCallSiteIds(result.callSites);

  expect(ids).toHaveLength(2);
  expect(ids[0]).not.toBe(ids[1]);
});

test("computeCallSiteIds is deterministic across separate calls with the same input shape", () => {
  const css = `/* css-console: log */
@function --space(--n) {
  result: calc(var(--n) * 1px);
}
.a {
  margin: --space(1);
  padding: --space(2);
}`;

  const first = computeCallSiteIds(resolveFunction(css).result.callSites);
  const second = computeCallSiteIds(resolveFunction(css).result.callSites);

  expect(first).toEqual(second);
});
