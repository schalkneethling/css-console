import { expect, test } from "vite-plus/test";

import { associateAnnotations } from "../../src/core/annotations/index.ts";
import type { AssociatedAnnotation, AssociationResult } from "../../src/core/annotations/index.ts";

import { fixtureUrl, loadFixture } from "../support/fixtures.ts";

/**
 * Declaration annotation tests.
 *
 * CSSC-007 is the previous-sibling half of the association rule the parser
 * selection record describes: a trailing comment attaches to the declaration
 * it follows, when it follows it on that declaration's own end line. The end
 * position is the terminating semicolon where one exists and the final token
 * of the value where it does not, because CSS permits omitting the semicolon
 * on the final declaration in a block.
 *
 * The same-line requirement is the whole of the rule, and the cases that
 * matter are the ones where the line is not obvious: a value spanning five
 * lines still ends on one line, and a comment on the next line down is a
 * comment about the next declaration rather than a probe on the previous one.
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

/** Returns the property a declaration target names, or null for other kinds. */
function propertyOf(associated: AssociatedAnnotation): string | null {
  return associated.target.kind === "declaration" ? associated.target.property : null;
}

test("a trailing comment on a single-line declaration attaches to it", () => {
  const associated = onlyAnnotation(
    associate(`.avatar {
  inline-size: calc(50cqi - 1rem); /* css-console: log */
}`),
  );

  expect(associated.target.kind).toBe("declaration");
  expect(propertyOf(associated)).toBe("inline-size");
  expect(associated.annotation.logLevel).toBe("log");
});

test("a trailing comment after a multi-line value attaches to the declaration", () => {
  // The value spans five lines but ends on one, and the comment follows the
  // semicolon on that line. This is the shape a real transform chain takes.
  const associated = onlyAnnotation(
    associate(`.thumb {
  transform: translateX(
    calc(
      var(--index, 0) *
        (var(--size) + var(--gap))
    )
  ); /* css-console: log */
}`),
  );

  expect(propertyOf(associated)).toBe("transform");
});

test("a trailing comment on a final declaration with no semicolon attaches", () => {
  // The decisive case from the parser selection record: the end position is
  // the final token of the value, and the comment sits between it and the
  // closing brace.
  const associated = onlyAnnotation(
    associate(`.a {
  color: red /* css-console: log */
}`),
  );

  expect(propertyOf(associated)).toBe("color");
});

test("a comment on the following line does not masquerade as trailing", () => {
  const result = associate(`.card {
  color: red;
  /* css-console: log */
  padding: 1rem;
}`);

  // The annotation precedes a declaration rather than trailing one, and a
  // declaration is not a target for a preceding annotation.
  expect(result.annotations).toHaveLength(0);
  expect(codes(result)).toEqual(["NO_TARGET"]);
});

test("a comment on the line after the final declaration does not attach either", () => {
  const result = associate(`.card {
  color: red;
  /* css-console: log */
}`);

  expect(result.annotations).toHaveLength(0);
  expect(codes(result)).toEqual(["NO_TARGET"]);
});

test("a custom property declaration attaches", () => {
  const associated = onlyAnnotation(
    associate(`:root {
  --brand: oklch(55% 0.18 250); /* css-console: log */
}`),
  );

  expect(propertyOf(associated)).toBe("--brand");
});

test("a property list on a declaration probe is rejected as ambiguous", () => {
  const result = associate(`.card {
  padding: 1rem; /* css-console: log inline-size */
}`);

  expect(result.annotations).toHaveLength(0);
  expect(codes(result)).toEqual(["PROPERTY_LIST_ON_DECLARATION_PROBE"]);
});

test("a label on a declaration probe is accepted", () => {
  const associated = onlyAnnotation(
    associate(`.card {
  padding: 1rem; /* css-console: log label="card padding" */
}`),
  );

  expect(propertyOf(associated)).toBe("padding");
  expect(associated.annotation.label).toBe("card padding");
});

test("an unrelated comment between the declaration and the annotation prevents attachment", () => {
  // The rule is the next non-whitespace token after the declaration's end,
  // and that token here is the unrelated comment rather than the annotation.
  const result = associate(`.card {
  padding: 1rem; /* an unrelated note */ /* css-console: log */
}`);

  expect(result.annotations).toHaveLength(0);
  expect(codes(result)).toEqual(["NO_TARGET"]);
});

test("each declaration in a rule can carry its own probe", () => {
  const result = associate(`.card {
  padding: 1rem; /* css-console: log */
  margin: 2rem; /* css-console: warn label="outer" */
}`);

  expect(result.annotations.map(propertyOf)).toEqual(["padding", "margin"]);
  expect(result.annotations.map((associated) => associated.annotation.logLevel)).toEqual([
    "log",
    "warn",
  ]);
  expect(result.diagnostics).toEqual([]);
});

test("a declaration target carries its own location, not the annotation's", () => {
  const associated = onlyAnnotation(
    associate(`.card {
  padding: 1rem; /* css-console: log */
}`),
  );

  expect(associated.source.start.line).toBe(2);
  expect(associated.target.source.start.line).toBe(2);
  // The declaration starts before the comment on the same line.
  expect(associated.target.source.start.column).toBeLessThan(associated.source.start.column);
});

test("a malformed trailing annotation reports its grammar diagnostic", () => {
  const result = associate(`.card {
  padding: 1rem; /* css-console: shout */
}`);

  expect(result.annotations).toHaveLength(0);
  expect(codes(result)).toEqual(["UNKNOWN_LOG_LEVEL"]);
});

test("a trailing prose comment is neither attached nor reported", () => {
  const result = associate(`.card {
  padding: 1rem; /* a note about the padding */
}`);

  expect(result.annotations).toHaveLength(0);
  expect(result.diagnostics).toEqual([]);
});

test("a declaration inside @function can carry a trailing probe", () => {
  const associated = onlyAnnotation(
    associate(`@function --space(--multiplier) {
  result: calc(var(--multiplier) * 0.25rem); /* css-console: log */
}`),
  );

  expect(propertyOf(associated)).toBe("result");
});

test("the omitted-semicolon hardening fixture attaches its declaration probe", () => {
  const { css, url } = loadFixture("hardening", "omitted-semicolon");
  const result = associateAnnotations(css, { url });

  // The .a rule's trailing annotation now attaches. The .separated rule's
  // annotation is still held off its target by an unrelated comment.
  expect(result.annotations.map(propertyOf)).toEqual(["color"]);
  expect(codes(result)).toEqual(["NO_TARGET"]);
});

test("the representative fixture associates all three probe kinds", () => {
  const { css, url } = loadFixture("representative", "card-components");
  const result = associateAnnotations(css, { url });

  const kinds = result.annotations.map((associated) => associated.target.kind);

  expect(kinds).toEqual(["function", "style-rule", "declaration"]);
  expect(result.diagnostics).toEqual([]);
});
