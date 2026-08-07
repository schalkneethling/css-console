import { expect, test } from "vite-plus/test";

import { associateAnnotations } from "../../src/core/annotations/index.ts";
import type { AssociatedAnnotation, AssociationResult } from "../../src/core/annotations/index.ts";

import { fixtureUrl, loadFixture } from "../support/fixtures.ts";

/**
 * Annotation association tests.
 *
 * The review question for CSSC-006 is whether annotations attach to the
 * intended targets, and the acceptance criterion is that the three at-rule
 * tiers stay distinguishable: a browser gap, a tool-scope limitation, and a
 * by-design rejection never share one diagnostic. This suite therefore
 * asserts the exact code for every at-rule the target table names, and proves
 * the three tiers are disjoint rather than checking them one at a time.
 *
 * Association is the next-sibling half of the rule the parser selection
 * record describes. The previous-sibling half, which carries declaration
 * probes, is CSSC-007, so a trailing comment on a declaration is left alone
 * here rather than being reported as having no target.
 */

const FIXTURE_URL = fixtureUrl("inline");

/** Associates inline CSS against a stable URL, so tests read as CSS. */
function associate(css: string): AssociationResult {
  return associateAnnotations(css, { url: FIXTURE_URL });
}

/** Returns the diagnostic codes a result carries, in order. */
function codes(result: AssociationResult): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

/**
 * Returns the single annotation a result carries, failing the test when the
 * count is anything but one so a miscount cannot pass as a match.
 */
function onlyAnnotation(result: AssociationResult): AssociatedAnnotation {
  expect(result.annotations).toHaveLength(1);

  const annotation = result.annotations[0];

  if (annotation === undefined) {
    throw new Error("expected exactly one associated annotation");
  }

  return annotation;
}

test("a comment immediately preceding a style rule attaches to it", () => {
  const associated = onlyAnnotation(
    associate(`/* css-console: log padding */
.card {
  padding: 1rem;
}`),
  );

  expect(associated.target.kind).toBe("style-rule");
  expect(associated.target.kind === "style-rule" && associated.target.selector).toBe(".card");
  expect(associated.annotation.logLevel).toBe("log");
  expect(associated.annotation.properties).toEqual(["padding"]);
});

test("a comment immediately preceding @function attaches as a function probe", () => {
  const associated = onlyAnnotation(
    associate(`/* css-console: log */
@function --space(--multiplier) {
  result: calc(var(--multiplier) * 0.25rem);
}`),
  );

  expect(associated.target.kind).toBe("function");
  expect(associated.target.kind === "function" && associated.target.functionName).toBe("--space");
});

test("whitespace-only separation still attaches", () => {
  const associated = onlyAnnotation(
    associate(`/* css-console: log */


.card {
  padding: 1rem;
}`),
  );

  expect(associated.target.kind === "style-rule" && associated.target.selector).toBe(".card");
});

test("an unrelated comment between the annotation and the target prevents attachment", () => {
  const result = associate(`/* css-console: warn */
/* an unrelated comment */
.card {
  padding: 1rem;
}`);

  expect(result.annotations).toHaveLength(0);
  expect(codes(result)).toEqual(["NO_TARGET"]);
});

test("an annotation at the end of the file reports no target", () => {
  const result = associate(`.card {
  padding: 1rem;
}

/* css-console: log */`);

  expect(result.annotations).toHaveLength(0);
  expect(codes(result)).toEqual(["NO_TARGET"]);
});

test("an annotation preceding a declaration reports no target", () => {
  const result = associate(`.card {
  /* css-console: log */
  padding: 1rem;
}`);

  expect(result.annotations).toHaveLength(0);
  expect(codes(result)).toEqual(["NO_TARGET"]);
});

test("a nested style rule is a target like any other", () => {
  const associated = onlyAnnotation(
    associate(`.card {
  padding: 1rem;

  /* css-console: log */
  & .card__title {
    font-weight: 600;
  }
}`),
  );

  expect(associated.target.kind === "style-rule" && associated.target.selector).toBe(
    "& .card__title",
  );
});

test("a trailing declaration annotation is left for CSSC-007 rather than reported", () => {
  const result = associate(`.card {
  color: red; /* css-console: log */
}`);

  expect(result.annotations).toHaveLength(0);
  expect(result.diagnostics).toEqual([]);
});

test("a trailing annotation on a declaration with the semicolon omitted is left alone too", () => {
  const result = associate(`.a {
  color: red /* css-console: log */
}`);

  expect(result.annotations).toHaveLength(0);
  expect(result.diagnostics).toEqual([]);
});

test("an ordinary prose comment is neither attached nor reported", () => {
  const result = associate(`/* an ordinary comment about the card */
.card {
  padding: 1rem;
}`);

  expect(result.annotations).toHaveLength(0);
  expect(result.diagnostics).toEqual([]);
});

test("a malformed annotation reports its grammar diagnostic with a source location", () => {
  const result = associate(`/* css-console: shout */
.card {
  padding: 1rem;
}`);

  expect(codes(result)).toEqual(["UNKNOWN_LOG_LEVEL"]);
  expect(result.diagnostics[0]?.source?.url).toBe(FIXTURE_URL);
  expect(result.diagnostics[0]?.source?.start.line).toBe(1);
});

/**
 * The at-rule target table from the plan, with the tier each at-rule falls
 * into. Driving the tier tests from one table is what makes the disjointness
 * check meaningful: a tier that quietly absorbed another's at-rules would
 * have to be changed here to pass.
 */
const AT_RULE_TIERS = [
  { atRule: "@mixin --card-surface", code: "RESERVED_PENDING_SUPPORT" },
  { atRule: "@apply --card-surface", code: "RESERVED_PENDING_SUPPORT" },
  { atRule: "@contents", code: "RESERVED_PENDING_SUPPORT" },
  { atRule: "@env --safe-area", code: "RESERVED_PENDING_SUPPORT" },
  { atRule: "@media (min-width: 40rem)", code: "NOT_A_TARGET" },
  { atRule: "@supports (display: grid)", code: "NOT_A_TARGET" },
  { atRule: "@layer components", code: "NOT_A_TARGET" },
  { atRule: "@keyframes --fade", code: "OUTSIDE_SUPPORTED_TARGET_SET" },
  { atRule: "@container (min-inline-size: 20rem)", code: "OUTSIDE_SUPPORTED_TARGET_SET" },
] as const;

test("every at-rule in the target table reports its tier's diagnostic", () => {
  for (const { atRule, code } of AT_RULE_TIERS) {
    const result = associate(`/* css-console: log */
${atRule} {
  .inside {
    color: red;
  }
}`);

    expect(codes(result), atRule).toEqual([code]);
    expect(result.annotations, atRule).toHaveLength(0);
  }
});

test("the three tiers stay distinguishable, with no at-rule shared between them", () => {
  // Group the at-rules by the code the implementation actually produced,
  // rather than by the code the table expects, so this proves the partition
  // instead of restating it. A tier that absorbed another's at-rules would
  // show up here as a group of the wrong size.
  const byCode = new Map<string, string[]>();

  for (const { atRule } of AT_RULE_TIERS) {
    const [code] = codes(associate(`/* css-console: log */\n${atRule} { .inside { color: red } }`));

    expect(code, atRule).toBeDefined();
    byCode.set(code ?? "", [...(byCode.get(code ?? "") ?? []), atRule]);
  }

  expect([...byCode.keys()].sort()).toEqual([
    "NOT_A_TARGET",
    "OUTSIDE_SUPPORTED_TARGET_SET",
    "RESERVED_PENDING_SUPPORT",
  ]);

  expect(byCode.get("RESERVED_PENDING_SUPPORT")).toHaveLength(4);
  expect(byCode.get("NOT_A_TARGET")).toHaveLength(3);
  expect(byCode.get("OUTSIDE_SUPPORTED_TARGET_SET")).toHaveLength(2);
});

test("at-rule names are matched case-insensitively, as CSS defines them", () => {
  // At-keywords are ASCII case-insensitive in CSS, and PostCSS preserves the
  // case the author wrote, so the tier lookup has to normalise or @MEDIA
  // silently lands in the wrong tier.
  expect(
    codes(associate("/* css-console: log */\n@MEDIA (min-width: 40rem) { .a { color: red } }")),
  ).toEqual(["NOT_A_TARGET"]);
  expect(
    codes(associate("/* css-console: log */\n@KeyFrames --fade { from { opacity: 0 } }")),
  ).toEqual(["OUTSIDE_SUPPORTED_TARGET_SET"]);
  expect(codes(associate("/* css-console: log */\n@Mixin --card { color: red }"))).toEqual([
    "RESERVED_PENDING_SUPPORT",
  ]);
});

test("an uppercase @FUNCTION still attaches as a function probe", () => {
  const associated = onlyAnnotation(
    associate(`/* css-console: log */
@FUNCTION --space(--multiplier) {
  result: calc(var(--multiplier) * 0.25rem);
}`),
  );

  expect(associated.target.kind).toBe("function");
  // The at-keyword is case-insensitive, but the function name is a custom
  // identifier and stays exactly as authored.
  expect(associated.target.kind === "function" && associated.target.functionName).toBe("--space");
});

test("a tier diagnostic reports the at-rule name as authored, not normalised", () => {
  const result = associate(
    "/* css-console: log */\n@MEDIA (min-width: 40rem) { .a { color: red } }",
  );

  expect(result.diagnostics[0]?.details).toEqual({ atRule: "MEDIA" });
});

test("an at-rule outside the target table is reported as outside the supported set", () => {
  const result = associate(`/* css-console: log */
@font-face {
  font-family: Example;
}`);

  expect(codes(result)).toEqual(["OUTSIDE_SUPPORTED_TARGET_SET"]);
});

test("a tier diagnostic names the at-rule it rejected", () => {
  const result = associate(`/* css-console: log */
@media (min-width: 40rem) {
  .grouped {
    padding: 1rem;
  }
}`);

  expect(result.diagnostics[0]?.details).toEqual({ atRule: "media" });
});

test("the representative fixture associates its rule and function probes", () => {
  const { css, url } = loadFixture("representative", "card-components");
  const result = associateAnnotations(css, { url });

  const targets = result.annotations.map((associated) =>
    associated.target.kind === "function"
      ? `function ${associated.target.functionName}`
      : `rule ${associated.target.selector}`,
  );

  // The third annotation in the fixture is a trailing declaration probe,
  // which CSSC-007 owns, so it is absent here rather than reported.
  expect(targets).toEqual(["function --space", "rule .card"]);
  expect(result.diagnostics).toEqual([]);
});

test("the hardening fixture reports one diagnostic per at-rule tier case", () => {
  const { css, url } = loadFixture("hardening", "at-rule-targets");
  const result = associateAnnotations(css, { url });

  expect(result.annotations).toHaveLength(0);
  expect(codes(result)).toEqual([
    "RESERVED_PENDING_SUPPORT",
    "RESERVED_PENDING_SUPPORT",
    "RESERVED_PENDING_SUPPORT",
    "RESERVED_PENDING_SUPPORT",
    "NOT_A_TARGET",
    "NOT_A_TARGET",
    "NOT_A_TARGET",
    "OUTSIDE_SUPPORTED_TARGET_SET",
    "OUTSIDE_SUPPORTED_TARGET_SET",
  ]);
});

test("the omitted-semicolon hardening fixture reports only its separated annotation", () => {
  const { css, url } = loadFixture("hardening", "omitted-semicolon");
  const result = associateAnnotations(css, { url });

  // The .a rule's trailing annotation belongs to CSSC-007. The .separated
  // rule's annotation is held off its target by an unrelated comment.
  expect(result.annotations).toHaveLength(0);
  expect(codes(result)).toEqual(["NO_TARGET"]);
});

test("annotations are returned in source order with their own locations", () => {
  const result = associate(`/* css-console: log */
.first {
  padding: 1rem;
}

/* css-console: warn */
.second {
  padding: 2rem;
}`);

  const selectors = result.annotations.map((associated) =>
    associated.target.kind === "style-rule" ? associated.target.selector : null,
  );

  expect(selectors).toEqual([".first", ".second"]);
  expect(result.annotations[0]?.source.start.line).toBe(1);
  expect(result.annotations[1]?.source.start.line).toBe(6);
  expect(result.annotations[0]?.source.url).toBe(FIXTURE_URL);
});

test("a target carries the location of the target rather than of the annotation", () => {
  const associated = onlyAnnotation(
    associate(`/* css-console: log */
.card {
  padding: 1rem;
}`),
  );

  expect(associated.source.start.line).toBe(1);
  expect(associated.target.source.start.line).toBe(2);
});
