import { expect, test } from "vite-plus/test";

import { parseAnnotation } from "../../src/core/annotations/index.ts";
import type { AnnotationParseResult, ParsedAnnotation } from "../../src/core/annotations/index.ts";
import type { LogLevel } from "../../src/core/records/index.ts";

import type { Equal, Expect } from "./type-level.ts";

/**
 * Annotation grammar tests.
 *
 * The review question for CSSC-005 is whether the grammar accepts exactly the
 * intended annotations, so this suite is organised around that question in
 * both directions: what must parse, what must be rejected with a precise
 * diagnostic, and what must not be treated as an annotation at all.
 *
 * The last distinction is the one worth stating plainly. A comment that never
 * claimed to be an annotation is not an error in the author's CSS, so it
 * produces no diagnostic; a comment that names the directive and then gets the
 * grammar wrong is an error, and produces one. Collapsing those two would
 * either flood ordinary prose comments with diagnostics or silently swallow
 * genuine mistakes.
 *
 * Diagnostics are asserted by code, never by message text, following the test
 * strategy.
 */

/** The four valid log levels, used to prove each one parses. */
const LOG_LEVELS: readonly LogLevel[] = ["log", "info", "warn", "error"];

/**
 * Narrows a result to the accepted case and returns the annotation, failing
 * the test with the rejection reason when the parse did not succeed. Without
 * this the type narrowing has to be repeated in every accepting test.
 */
function expectAccepted(result: AnnotationParseResult): ParsedAnnotation {
  if (!result.ok) {
    throw new Error(`expected the annotation to parse, but it was ${result.reason}`);
  }

  return result.annotation;
}

/**
 * Returns the diagnostic codes a rejected parse produced, failing the test
 * when the parse was accepted or when the text was not an annotation at all.
 */
function expectRejectedCodes(result: AnnotationParseResult): string[] {
  if (result.ok) {
    throw new Error("expected the annotation to be rejected, but it parsed");
  }

  if (result.reason !== "rejected") {
    throw new Error(`expected a rejection, but the text was ${result.reason}`);
  }

  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

test("parses a log annotation", () => {
  const result = parseAnnotation("css-console: log");

  expect(result).toEqual({
    ok: true,
    annotation: { logLevel: "log", properties: [] },
  });
});

test("parses every valid log level", () => {
  for (const logLevel of LOG_LEVELS) {
    const annotation = expectAccepted(parseAnnotation(`css-console: ${logLevel}`));

    expect(annotation.logLevel, logLevel).toBe(logLevel);
  }
});

test("parses a comma-separated property list", () => {
  const annotation = expectAccepted(parseAnnotation("css-console: log padding,background-color"));

  expect(annotation.properties).toEqual(["padding", "background-color"]);
});

test("parses a property list with whitespace around the commas", () => {
  const annotation = expectAccepted(
    parseAnnotation("css-console: log padding , background-color ,margin-block"),
  );

  expect(annotation.properties).toEqual(["padding", "background-color", "margin-block"]);
});

test("tolerates a trailing comma rather than yielding an empty property name", () => {
  const annotation = expectAccepted(parseAnnotation("css-console: log padding,margin,"));

  expect(annotation.properties).toEqual(["padding", "margin"]);
});

test("a trailing comma does not swallow the option that follows it", () => {
  const annotation = expectAccepted(
    parseAnnotation('css-console: log padding,margin, label="cards"'),
  );

  expect(annotation.properties).toEqual(["padding", "margin"]);
  expect(annotation.label).toBe("cards");
});

test("parses custom properties in a property list", () => {
  const annotation = expectAccepted(parseAnnotation("css-console: log --brand,--space"));

  expect(annotation.properties).toEqual(["--brand", "--space"]);
});

test("parses a quoted label containing spaces", () => {
  const annotation = expectAccepted(parseAnnotation('css-console: log label="spacing scale"'));

  expect(annotation.label).toBe("spacing scale");
});

test("parses a label alongside a property list, in either order", () => {
  const listFirst = expectAccepted(
    parseAnnotation('css-console: log padding,margin label="cards"'),
  );
  const labelFirst = expectAccepted(
    parseAnnotation('css-console: log label="cards" padding,margin'),
  );

  expect(listFirst.properties).toEqual(["padding", "margin"]);
  expect(listFirst.label).toBe("cards");
  expect(labelFirst).toEqual(listFirst);
});

test("omits the label rather than carrying an undefined one when it is absent", () => {
  const annotation = expectAccepted(parseAnnotation("css-console: log"));

  expect("label" in annotation).toBe(false);
});

test("accepts whitespace variations around the directive, colon, and options", () => {
  const variations = [
    "css-console:log",
    "css-console : log",
    "   css-console:   log   ",
    "css-console:\tlog",
    'css-console:  log   padding,margin    label="cards"  ',
  ];

  for (const text of variations) {
    const annotation = expectAccepted(parseAnnotation(text));

    expect(annotation.logLevel, text).toBe("log");
  }
});

test("an empty label is preserved rather than dropped", () => {
  const annotation = expectAccepted(parseAnnotation('css-console: log label=""'));

  expect(annotation.label).toBe("");
});

test("a comment without the colon is not an annotation", () => {
  const result = parseAnnotation("css-console log");

  expect(result.ok).toBe(false);
  expect(result.ok === false && result.reason).toBe("not-an-annotation");
});

test("an ordinary prose comment is not an annotation", () => {
  const prose = [
    "a normal comment",
    "css-console is the tool that reports this",
    "TODO: css-console: log",
    "",
    "   ",
  ];

  for (const text of prose) {
    const result = parseAnnotation(text);

    expect(result.ok, text).toBe(false);
    expect(result.ok === false && result.reason, text).toBe("not-an-annotation");
  }
});

test("a comment that is not an annotation carries no diagnostics", () => {
  const result = parseAnnotation("a normal comment");

  expect(result).toEqual({ ok: false, reason: "not-an-annotation" });
});

test("a missing log level is rejected", () => {
  for (const text of ["css-console:", "css-console:   ", 'css-console: label="cards"']) {
    expect(expectRejectedCodes(parseAnnotation(text)), text).toEqual(["MISSING_LOG_LEVEL"]);
  }
});

test("an unknown log level is rejected", () => {
  for (const text of ["css-console: shout", "css-console: debug", "css-console: LOG"]) {
    expect(expectRejectedCodes(parseAnnotation(text)), text).toEqual(["UNKNOWN_LOG_LEVEL"]);
  }
});

test("a bare property list with no log level is an unknown log level", () => {
  expect(expectRejectedCodes(parseAnnotation("css-console: padding"))).toEqual([
    "UNKNOWN_LOG_LEVEL",
  ]);
});

test("the reserved watch level is rejected with its own diagnostic", () => {
  expect(expectRejectedCodes(parseAnnotation("css-console: watch"))).toEqual(["WATCH_RESERVED"]);
});

test("an unknown option is rejected", () => {
  for (const text of ['css-console: log title="cards"', "css-console: log depth=2"]) {
    expect(expectRejectedCodes(parseAnnotation(text)), text).toEqual(["UNKNOWN_OPTION"]);
  }
});

test("a duplicate label is rejected", () => {
  expect(expectRejectedCodes(parseAnnotation('css-console: log label="a" label="b"'))).toEqual([
    "DUPLICATE_OPTION",
  ]);
});

test("a second property list is rejected as a duplicate option", () => {
  expect(expectRejectedCodes(parseAnnotation("css-console: log padding margin"))).toEqual([
    "DUPLICATE_OPTION",
  ]);
});

test("an unquoted label is accepted when it carries no spaces", () => {
  const annotation = expectAccepted(parseAnnotation("css-console: log label=cards"));

  expect(annotation.label).toBe("cards");
});

test("every option problem is reported rather than only the first", () => {
  const codes = expectRejectedCodes(
    parseAnnotation('css-console: log title="a" label="b" label="c"'),
  );

  expect(codes).toEqual(["UNKNOWN_OPTION", "DUPLICATE_OPTION"]);
});

test("a rejected log level suppresses option diagnostics", () => {
  const codes = expectRejectedCodes(parseAnnotation('css-console: shout title="a"'));

  expect(codes).toEqual(["UNKNOWN_LOG_LEVEL"]);
});

test("diagnostics carry the source location when one is supplied", () => {
  const source = {
    url: "https://example.test/styles.css",
    start: { line: 3, column: 1 },
    end: { line: 3, column: 24 },
  };

  const result = parseAnnotation("css-console: shout", { source });

  if (result.ok || result.reason !== "rejected") {
    throw new Error("expected the annotation to be rejected");
  }

  expect(result.diagnostics[0]?.source).toEqual(source);
});

test("diagnostics omit the source location when none is supplied", () => {
  const result = parseAnnotation("css-console: shout");

  if (result.ok || result.reason !== "rejected") {
    throw new Error("expected the annotation to be rejected");
  }

  expect("source" in (result.diagnostics[0] ?? {})).toBe(false);
});

/**
 * The type-level assertions gather into one exported tuple so a single name
 * proves the contract, matching the convention the record contract tests use.
 */
export type AnnotationGrammarAssertions = [
  // The parsed annotation exposes the log level, an ordered readonly property
  // list, and an optional label.
  Expect<Equal<ParsedAnnotation["logLevel"], LogLevel>>,
  Expect<Equal<ParsedAnnotation["properties"], readonly string[]>>,
  Expect<Equal<ParsedAnnotation["label"], string | undefined>>,

  // The result discriminates on `ok`, and the two rejection reasons stay
  // distinguishable so a prose comment is never mistaken for a grammar error.
  Expect<Equal<Extract<AnnotationParseResult, { ok: true }>["annotation"], ParsedAnnotation>>,
  Expect<
    Equal<Extract<AnnotationParseResult, { ok: false }>["reason"], "not-an-annotation" | "rejected">
  >,
];
