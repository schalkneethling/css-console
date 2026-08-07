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
function readIdentifier(text: string, start: number): string {
  let index = start;

  while (index < text.length && IDENTIFIER.test(text[index] ?? "")) {
    index += 1;
  }

  return text.slice(start, index);
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

    if (LEGACY_PSEUDO_ELEMENTS.has(readIdentifier(branch, index + 1).toLowerCase())) {
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

  if (tail.slice(colons + name.length).trim() !== "") {
    return null;
  }

  const normalised = name.toLowerCase();

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
export function splitSelectorBranches(selector: string, source: SourceLocation): SelectorSplit {
  const authoredBranches = splitOnCommas(selector);
  const empty = authoredBranches.findIndex((branch) => branch.trim() === "");

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
    const authored = rawBranch.trim();
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

    const originating = authored.slice(0, start).trim();

    branches.push({ authored, selector: originating === "" ? "*" : originating, pseudo });
  }

  return { branches, diagnostics };
}
