/**
 * Selector branch splitting.
 *
 * A style rule carries one selector string, and matching it as one string
 * would be wrong: a selector list is a list of independent selectors, and a
 * later phase runs each of them separately so that one branch failing to
 * match, or being unsupported, says nothing about the others. This module
 * turns the authored string into those branches and validates each one.
 *
 * Validation here is textual. Core cannot reach the DOM, so there is no
 * selector API to hand a branch to; the checks are the two that can be made
 * from the text alone and that change what a later phase may do: a branch
 * that is empty, and a branch whose pseudo-element css-console does not
 * support in v0. A branch that is well formed but nonsense, such as
 * `.note:marker`, passes through here and matches nothing later, which is the
 * same answer the browser gives.
 *
 * Everything this module encodes about pseudo-elements was checked in
 * Chromium rather than recalled, and the individual decisions record what was
 * observed.
 *
 * Reference: [CSS pseudo-elements](https://drafts.csswg.org/css-pseudo-4/).
 */

import { createDiagnostic } from "../diagnostics/index.ts";
import type { Diagnostic } from "../diagnostics/index.ts";
import type { SourceLocation } from "../records/index.ts";

/**
 * One selector from a selector list, split into the parts a later phase
 * needs. `authored` is the branch as written, with only the whitespace
 * around it removed, so a diagnostic can quote what the author sees.
 * `selector` is the originating element selector, which is what a matcher
 * passes to `querySelectorAll()`, and `pseudo` is the pseudo-element that
 * goes to `getComputedStyle()` as its second argument, or `null` for an
 * ordinary branch. The two are separated here rather than at match time
 * because the split is a parsing question, and the matcher should not have
 * to reopen the string.
 */
export type SelectorBranch = {
  authored: string;
  selector: string;
  pseudo: string | null;
};

/**
 * The outcome of splitting one selector: the branches worth matching, in
 * source order, plus the diagnostics the split produced. Branches and
 * diagnostics are returned together rather than one being thrown, because an
 * unsupported branch is a fact about that branch alone and the rule still
 * applies to the rest of its list.
 */
export type SelectorSplit = {
  branches: readonly SelectorBranch[];
  diagnostics: readonly Diagnostic[];
};

/**
 * The pseudo-elements v0 probes, as named in the implementation plan. Each is
 * stored without its colons, because the colons are normalised rather than
 * matched.
 */
const SUPPORTED_PSEUDO_ELEMENTS = new Set([
  "before",
  "after",
  "marker",
  "first-line",
  "first-letter",
  "placeholder",
  "selection",
  "backdrop",
]);

/**
 * The four pseudo-elements that also have a single-colon spelling, retained
 * from CSS 2.1. Chromium parses `p:before` and serialises it back as
 * `p::before`, and the generated box carries the rule's declarations, so the
 * legacy spelling is CSS that works and rejecting it would report a defect
 * that is not there. The set is exactly four: Chromium drops a rule written
 * as `p:marker`, `p:placeholder`, `p:selection`, or `p:backdrop`, so a single
 * colon in front of those names is not a pseudo-element and must not be
 * normalised into one.
 */
const LEGACY_PSEUDO_ELEMENTS = new Set(["before", "after", "first-line", "first-letter"]);

/** The characters that continue an unescaped identifier. */
const IDENTIFIER = /[A-Za-z0-9_-]/;

/** A hexadecimal digit, which is what may follow a backslash in an escape. */
const HEX_DIGIT = /[0-9A-Fa-f]/;

/**
 * The characters CSS counts as whitespace: U+0020 SPACE, U+0009 TAB, and the
 * newline forms U+000A, U+000C, and U+000D. This module reads raw selector
 * text, before the tokenizer preprocessing that folds U+000C and U+000D into
 * U+000A, so all five appear here. Any other code point is not whitespace,
 * and that is why JavaScript's trim() and \s are never used in this module:
 * both count U+00A0 NO-BREAK SPACE, which in CSS is an identifier character.
 * Verified in the browser lane against headless Chromium 151.0.7922.34,
 * where a class selector ending in U+00A0 matches only an element whose
 * class token carries the no-break space, and a lone U+00A0 is a valid type
 * selector rather than an empty branch.
 */
const CSS_WHITESPACE = new Set([" ", "\t", "\n", "\f", "\r"]);

/** True when `character` exists and is CSS whitespace. */
function isCssWhitespace(character: string | undefined): boolean {
  return character !== undefined && CSS_WHITESPACE.has(character);
}

/** Removes leading and trailing CSS whitespace, and nothing else. */
function trimCssWhitespace(text: string): string {
  let start = 0;
  let end = text.length;

  while (start < end && isCssWhitespace(text[start])) {
    start += 1;
  }

  while (end > start && isCssWhitespace(text[end - 1])) {
    end -= 1;
  }

  return text.slice(start, end);
}

/** The largest code point a CSS escape may denote. */
const MAX_CODE_POINT = 0x10ffff;

/**
 * One identifier read from a selector: the decoded text, and the index just
 * past the characters consumed. The two differ whenever an escape is
 * involved, because `be\66 ore` is nine characters of source denoting the
 * six-character name `before`, so a caller checking what follows the
 * identifier must use `end` rather than the decoded length.
 */
type ReadIdentifier = { value: string; end: number };

/** One decoded escape sequence and the index just past it. */
type ReadEscape = { character: string; end: number };

/**
 * Decodes one CSS escape sequence beginning at a backslash, following the
 * consume-an-escaped-code-point algorithm in CSS Syntax.
 *
 * A backslash followed by hexadecimal digits denotes a code point, taking at
 * most six digits and swallowing one trailing CSS whitespace character that
 * exists only to terminate the digits. A backslash followed by anything else
 * denotes that character literally. Out-of-range and surrogate code points
 * become the replacement character, as the algorithm requires.
 *
 * This exists because an author may spell a supported pseudo-element with an
 * escape: `::be\66 ore` denotes `::before`, and Chromium serialises it back
 * as `::before` and generates the box. Reading the name without decoding
 * would stop at the backslash and defer a pseudo-element css-console
 * supports.
 */
function readEscape(text: string, start: number): ReadEscape | null {
  if (text[start] !== "\\" || start + 1 >= text.length) {
    return null;
  }

  let index = start + 1;
  let digits = "";

  while (index < text.length && digits.length < 6 && HEX_DIGIT.test(text[index] ?? "")) {
    digits += text[index];
    index += 1;
  }

  if (digits === "") {
    return { character: text[index] ?? "", end: index + 1 };
  }

  // One CSS whitespace character terminates the digits. U+00A0 is not CSS
  // whitespace, so it stays in the identifier; see CSS_WHITESPACE.
  if (isCssWhitespace(text[index])) {
    index += 1;
  }

  const codePoint = Number.parseInt(digits, 16);
  const valid =
    codePoint !== 0 && codePoint <= MAX_CODE_POINT && !(codePoint >= 0xd800 && codePoint <= 0xdfff);

  return { character: valid ? String.fromCodePoint(codePoint) : "�", end: index };
}

/**
 * Reports the indices of `text` that sit at the top level of a selector:
 * outside every quoted string, outside every parenthesised or bracketed
 * block, and not consumed by a backslash escape. Only these positions can
 * carry a comma that separates branches or a colon that introduces a
 * pseudo-element.
 *
 * All three exclusions are load-bearing, and each was checked in Chromium.
 * `:is(.a, .b)` and `[title="a,b"]` are one selector each, not two. `.a\,b`
 * and `.a\2c b` both match an element whose class is literally `a,b`, so an
 * escape swallows the character after it whatever that character is. And
 * `.icon\:\:before` matches an element whose class is `icon::before`, so an
 * escaped colon pair is an identifier rather than a pseudo-element.
 *
 * A stray closing delimiter cannot push the depth below zero. Chromium closes
 * an unbalanced block at the end of input rather than rejecting the selector,
 * verified with `.a[title`, so unbalanced text is scanned rather than
 * refused.
 */
function* topLevelIndices(text: string): Generator<number> {
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === "\\") {
      index += 1;
      continue;
    }

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

    if (character === "(" || character === "[") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0) {
      yield index;
    }
  }
}

/**
 * Splits a selector on the commas that separate its branches, returning the
 * text between them exactly as authored, whitespace included.
 */
function splitOnCommas(selector: string): string[] {
  const branches: string[] = [];
  let start = 0;

  for (const index of topLevelIndices(selector)) {
    if (selector[index] === ",") {
      branches.push(selector.slice(start, index));
      start = index + 1;
    }
  }

  branches.push(selector.slice(start));

  return branches;
}

/**
 * Reads the unescaped identifier beginning at `start`. A name spelled with an
 * escape, such as `\62 efore` for `before`, stops the read and therefore is
 * not recognised as a pseudo-element; it stays in the originating selector,
 * where it matches nothing, rather than being decoded here.
 */
function readIdentifier(text: string, start: number): ReadIdentifier {
  let index = start;
  let value = "";

  while (index < text.length) {
    const character = text[index] ?? "";

    if (character === "\\") {
      const escape = readEscape(text, index);

      if (escape === null) {
        break;
      }

      value += escape.character;
      index = escape.end;
      continue;
    }

    if (!IDENTIFIER.test(character)) {
      break;
    }

    value += character;
    index += 1;
  }

  return { value, end: index };
}

/**
 * Returns the index at which a branch's pseudo-element begins, or -1 when the
 * branch carries none. A double colon always introduces one. A single colon
 * introduces one only for the four legacy spellings; every other single colon
 * is a pseudo-class, which the scan steps over so that `a:hover::before`
 * still finds its pseudo-element.
 */
function findPseudoElement(branch: string): number {
  for (const index of topLevelIndices(branch)) {
    if (branch[index] !== ":") {
      continue;
    }

    if (branch[index + 1] === ":") {
      return index;
    }

    if (LEGACY_PSEUDO_ELEMENTS.has(readIdentifier(branch, index + 1).value.toLowerCase())) {
      return index;
    }
  }

  return -1;
}

/**
 * Reads a branch's pseudo-element tail, returning the normalised
 * pseudo-element string or `null` when v0 does not support it.
 *
 * Normalisation lowercases the name and spells it with two colons, because
 * neither the case nor the legacy colon carries meaning: Chromium serialises
 * `::FIRST-LINE` as `::first-line` and `:before` as `::before`, and
 * `getComputedStyle(element, "::BEFORE")` returns the same declaration as
 * `"::before"`.
 *
 * Anything left over after the name is unsupported, which covers all three
 * deferred shapes at once: an argument list, as in `::part(label)` and
 * `::slotted(span)`, a chain, as in `::before::marker`, and a trailing
 * pseudo-class, as in `::before:hover`. None of them can be expressed as one
 * originating selector plus one pseudo-element string, which is the only
 * shape the evaluator can act on.
 */
function readPseudoElement(tail: string): string | null {
  const colons = tail.startsWith("::") ? 2 : 1;
  const name = readIdentifier(tail, colons);

  // The consumed length, not the decoded length: an escape spends more
  // source characters than the name it denotes.
  if (trimCssWhitespace(tail.slice(name.end)) !== "") {
    return null;
  }

  const normalised = name.value.toLowerCase();

  return SUPPORTED_PSEUDO_ELEMENTS.has(normalised) ? `::${normalised}` : null;
}

/**
 * Splits an authored selector into the branches a later matching phase runs
 * independently, validating each one.
 *
 * A branch carrying a supported pseudo-element is split into the originating
 * selector and the pseudo-element string, so that a matcher can pass the
 * first to `querySelectorAll()` and the second to `getComputedStyle()`. A
 * branch that is only a pseudo-element takes the universal selector as its
 * originating selector, because a rule written as `::before` applies to every
 * element in Chromium exactly as `*::before` does.
 *
 * A branch whose pseudo-element v0 does not support produces
 * `DEFERRED_PSEUDO_ELEMENT` and is dropped, while every other branch of the
 * list is kept. That is not leniency: `::part()`, `::slotted()`, and a
 * `::before::marker` chain are all valid CSS that Chromium retains, so the
 * rule really does apply to its other branches and reporting them is the
 * truthful answer.
 *
 * An empty branch is different in kind, and produces
 * `MALFORMED_SELECTOR_LIST` with no branches at all. A selector list is not
 * forgiving: Chromium drops the whole rule for `.a, , .b`, and
 * `querySelectorAll()` throws a `SyntaxError` on it, so none of its branches
 * ever applies to anything. Returning the well-formed-looking branches would
 * attribute computed values to a rule the browser discarded, which is the one
 * failure this tool cannot afford. One diagnostic is produced however many
 * branches are empty, because the list is discarded once.
 */
/**
 * True when the character at `index` is escaped, which is the case exactly
 * when an odd run of backslashes precedes it.
 */
function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;

  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) {
    backslashes += 1;
  }

  return backslashes % 2 === 1;
}

/**
 * Resolves the text before a pseudo-element into the originating selector a
 * matcher can pass to `querySelectorAll()`.
 *
 * The compound selector carrying the pseudo-element may omit its type
 * selector, and the omitted selector is the universal selector: `::before`
 * means `*::before`, `.card ::before` means `.card *::before`, and
 * `.card > ::before` means `.card > *::before`. Dropping the surrounding
 * whitespace without restoring the universal compound would either swallow a
 * descendant combinator, handing a matcher `.card` for a rule that styles
 * descendants of `.card`, or leave an explicit combinator dangling, which no
 * selector engine parses. Both misattribute the rule, so the universal
 * compound is written out whenever the text ends in a combinator.
 *
 * An escaped final character is never a combinator: `.card\~` names the
 * class `card~`, so the compound is already complete and nothing is
 * appended. The same holds for an escaped final space, which is part of an
 * identifier rather than a descendant combinator.
 */
function resolveOriginatingSelector(prefix: string): string {
  let first = 0;

  while (first < prefix.length && isCssWhitespace(prefix[first])) {
    first += 1;
  }

  const text = prefix.slice(first);

  if (text === "") {
    return "*";
  }

  let end = text.length;

  while (end > 0 && isCssWhitespace(text[end - 1]) && !isEscaped(text, end - 1)) {
    end -= 1;
  }

  const descendant = end < text.length;
  const trimmed = text.slice(0, end);
  const last = trimmed[trimmed.length - 1];
  const combinator =
    (last === ">" || last === "+" || last === "~") && !isEscaped(trimmed, trimmed.length - 1);

  if (combinator || descendant) {
    return `${trimmed} *`;
  }

  return trimmed;
}

export function splitSelectorBranches(selector: string, source: SourceLocation): SelectorSplit {
  const authoredBranches = splitOnCommas(selector);
  const empty = authoredBranches.findIndex((branch) => trimCssWhitespace(branch) === "");

  if (empty !== -1) {
    return {
      branches: [],
      diagnostics: [
        createDiagnostic("MALFORMED_SELECTOR_LIST", {
          source,
          details: { selector, branch: empty + 1 },
        }),
      ],
    };
  }

  const branches: SelectorBranch[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const rawBranch of authoredBranches) {
    const authored = trimCssWhitespace(rawBranch);
    const start = findPseudoElement(authored);

    if (start === -1) {
      branches.push({ authored, selector: authored, pseudo: null });
      continue;
    }

    const tail = authored.slice(start);
    const pseudo = readPseudoElement(tail);

    if (pseudo === null) {
      diagnostics.push(
        createDiagnostic("DEFERRED_PSEUDO_ELEMENT", {
          source,
          details: { branch: authored, pseudoElement: tail },
        }),
      );
      continue;
    }

    branches.push({
      authored,
      selector: resolveOriginatingSelector(authored.slice(0, start)),
      pseudo,
    });
  }

  return { branches, diagnostics };
}
