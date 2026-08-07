/**
 * Annotation grammar.
 *
 * This module parses one css-console annotation comment into the log level,
 * property list, and label the compiler works from. It parses the text of a
 * comment and nothing more: it does not decide whether the annotation has a
 * target, whether the target accepts a property list, or whether the target
 * is supported. Those are placement questions, and they land with CSSC-006
 * and CSSC-007.
 *
 * The grammar is deliberately small:
 *
 * ```text
 * css-console: <log-level> [property-list] [label="..."]
 * ```
 *
 * Requiring the colon is what keeps ordinary prose comments from matching, so
 * a comment that does not carry the directive and the colon is reported as no
 * annotation at all rather than as a malformed one. That distinction matters:
 * a comment that never claimed to be an annotation is not a mistake in the
 * author's CSS, and reporting it as one would bury real diagnostics under
 * every prose comment in the stylesheet.
 */

export { associateAnnotations } from "./associate.ts";
export type {
  AnnotationTarget,
  AssociateAnnotationsOptions,
  AssociatedAnnotation,
  AssociationResult,
} from "./associate.ts";

import { createDiagnostic } from "../diagnostics/index.ts";
import type { Diagnostic } from "../diagnostics/index.ts";
import type { LogLevel, SourceLocation } from "../records/index.ts";

/** The literal directive every annotation opens with. */
const DIRECTIVE = "css-console";

/** The four valid log levels, mapping onto the Console API methods. */
const LOG_LEVELS = new Set<string>(["log", "info", "warn", "error"]);

/**
 * The log level reserved for the future live mode. It is spelled out here
 * rather than folded into the unknown-level check so that it can carry its
 * own diagnostic, which tells the author the name is recognised and postponed
 * rather than wrong.
 */
const RESERVED_LOG_LEVEL = "watch";

/** The only named option the grammar defines. */
const LABEL_OPTION = "label";

/**
 * One parsed annotation. `properties` is an ordered readonly array because an
 * explicit property list must preserve the order the author requested, and
 * `label` is absent rather than undefined when the annotation carries none.
 */
export type ParsedAnnotation = {
  logLevel: LogLevel;
  properties: readonly string[];
  label?: string;
};

/**
 * The outcome of parsing one comment. The three cases are kept distinct on
 * purpose: an accepted annotation, a comment that carried the directive and
 * got the grammar wrong, and a comment that is not an annotation at all and
 * therefore produces no diagnostics.
 */
export type AnnotationParseResult =
  | { ok: true; annotation: ParsedAnnotation }
  | { ok: false; reason: "not-an-annotation" }
  | { ok: false; reason: "rejected"; diagnostics: readonly Diagnostic[] };

/**
 * The options `parseAnnotation()` accepts. `source` is the location of the
 * comment being parsed, carried onto every diagnostic the parse produces so
 * that a rejection can point at the annotation it came from.
 */
export type ParseAnnotationOptions = {
  source?: SourceLocation;
};

/**
 * One token from the annotation body: either a `name=value` option or a bare
 * token, which the grammar reads as a property list.
 */
type Token = { name: string; value: string } | { name: null; value: string };

/**
 * Reports whether a raw token carries an `=` outside quotes, which is what
 * makes it a named option rather than part of a property list. A quoted label
 * value may itself contain an `=`, so the scan has to respect quoting.
 */
function isOption(raw: string): boolean {
  let quote: string | null = null;

  for (const character of raw) {
    if (quote !== null) {
      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (character === "=") {
      return true;
    }
  }

  return false;
}

/**
 * Splits the annotation body on whitespace, treating a quoted string as one
 * atom so that a label value containing spaces survives as a single token.
 */
function split(body: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;

  for (const character of body) {
    if (quote !== null) {
      current += character;

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current !== "") {
        tokens.push(current);
        current = "";
      }

      continue;
    }

    current += character;
  }

  if (current !== "") {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Splits the annotation body into tokens, rejoining segments a comma holds
 * together so that `padding,margin`, `padding , margin`, and `padding,
 * margin` all read as one property list rather than as several tokens.
 *
 * A comma never pulls in a named option, so a list left with a trailing
 * comma, as in `padding,margin, label="cards"`, keeps the label separate
 * rather than swallowing it into the property list.
 */
function tokenize(body: string): string[] {
  const tokens: string[] = [];

  for (const raw of split(body)) {
    const previous = tokens.at(-1);
    const joins = previous !== undefined && (previous.endsWith(",") || raw.startsWith(","));

    if (joins && !isOption(raw) && !isOption(previous)) {
      tokens[tokens.length - 1] = previous + raw;
      continue;
    }

    tokens.push(raw);
  }

  return tokens;
}

/**
 * Reads one raw token as either a named option or a bare token. Only the
 * first `=` splits the token, so a label value may contain one.
 */
function readToken(raw: string): Token {
  const separator = raw.indexOf("=");

  if (separator === -1) {
    return { name: null, value: raw };
  }

  return { name: raw.slice(0, separator), value: raw.slice(separator + 1) };
}

/**
 * Strips one layer of matching quotes from a label value. An unquoted value
 * is accepted as authored, which keeps a label with no spaces working without
 * adding a diagnostic for a case that is unambiguous.
 */
function unquote(value: string): string {
  const first = value.at(0);

  if ((first === '"' || first === "'") && value.length >= 2 && value.endsWith(first)) {
    return value.slice(1, -1);
  }

  return value;
}

/**
 * Splits a property list token on commas, dropping empty segments so that a
 * trailing comma is tolerated rather than producing an empty property name.
 */
function readPropertyList(value: string): string[] {
  return value
    .split(",")
    .map((property) => property.trim())
    .filter((property) => property !== "");
}

/**
 * Parses one annotation comment's text: the content between the comment
 * delimiters, with the delimiters already removed.
 *
 * Returns the parsed annotation when the grammar accepts it, a rejection
 * carrying one diagnostic per problem when the comment names the directive
 * but gets the grammar wrong, and `not-an-annotation` when the comment does
 * not open with the directive and a colon.
 *
 * An invalid log level short-circuits the parse, because the level decides
 * whether a probe is produced at all and reporting option problems alongside
 * it would bury the one diagnostic the author has to act on first.
 */
export function parseAnnotation(
  text: string,
  options: ParseAnnotationOptions = {},
): AnnotationParseResult {
  const trimmed = text.trim();

  if (!trimmed.startsWith(DIRECTIVE)) {
    return { ok: false, reason: "not-an-annotation" };
  }

  const afterDirective = trimmed.slice(DIRECTIVE.length);
  const colon = afterDirective.match(/^\s*:/);

  if (colon === null) {
    return { ok: false, reason: "not-an-annotation" };
  }

  const reject = (code: Parameters<typeof createDiagnostic>[0]): Diagnostic =>
    createDiagnostic(code, options.source === undefined ? {} : { source: options.source });

  const tokens = tokenize(afterDirective.slice(colon[0].length)).map(readToken);
  const [levelToken, ...optionTokens] = tokens;

  if (levelToken === undefined || levelToken.name !== null) {
    // Either nothing followed the colon, or the first token is a named
    // option, which means the required log level was never given.
    return { ok: false, reason: "rejected", diagnostics: [reject("MISSING_LOG_LEVEL")] };
  }

  if (levelToken.value === RESERVED_LOG_LEVEL) {
    return { ok: false, reason: "rejected", diagnostics: [reject("WATCH_RESERVED")] };
  }

  if (!LOG_LEVELS.has(levelToken.value)) {
    return { ok: false, reason: "rejected", diagnostics: [reject("UNKNOWN_LOG_LEVEL")] };
  }

  const diagnostics: Diagnostic[] = [];
  let properties: readonly string[] | undefined;
  let label: string | undefined;

  for (const token of optionTokens) {
    if (token.name === null) {
      if (properties !== undefined) {
        diagnostics.push(reject("DUPLICATE_OPTION"));
        continue;
      }

      properties = readPropertyList(token.value);
      continue;
    }

    if (token.name !== LABEL_OPTION) {
      diagnostics.push(reject("UNKNOWN_OPTION"));
      continue;
    }

    if (label !== undefined) {
      diagnostics.push(reject("DUPLICATE_OPTION"));
      continue;
    }

    label = unquote(token.value);
  }

  if (diagnostics.length > 0) {
    return { ok: false, reason: "rejected", diagnostics };
  }

  const annotation: ParsedAnnotation = {
    logLevel: levelToken.value as LogLevel,
    properties: properties ?? [],
  };

  if (label !== undefined) {
    annotation.label = label;
  }

  return { ok: true, annotation };
}
