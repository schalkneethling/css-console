/**
 * Nested selector resolution.
 *
 * CSS nesting lets a rule's selector be written relative to its ancestors,
 * and `querySelectorAll()` takes flat selectors only. This module closes that
 * gap: given a parsed rule, it walks the ancestor chain and returns one flat
 * selector list that selects the same elements, with the same specificity,
 * the browser would select for that nested rule.
 *
 * Resolution is textual and happens on the parsed tree, never through a
 * nesting transform run as a pre-pass. That choice is recorded in
 * docs/decisions/0003-manual-nesting-resolution.md: every annotation is
 * associated with its target by adjacency in source, so a transform that
 * relocates or drops comment nodes destroys the association this whole tool
 * is built on. Nothing here mutates the tree, which is what keeps annotation
 * line and column numbers identical before and after resolution.
 *
 * Two rules do the work, and both come from the specification rather than
 * from a preprocessor's habits.
 *
 * First, a complex selector that does not start with a combinator and does
 * not contain the nesting selector is treated as though `&` were prepended
 * with a descendant combinator, so `.card { .title { } }` resolves as
 * `& .title`. A complex selector that starts with a combinator always gets
 * `&` prepended, whether or not it already contains one, so `> & .bar`
 * resolves as `& > & .bar`. The decision is made per complex selector rather
 * than per list, so `.foo, .foo &` becomes `& .foo, .foo &`.
 *
 * Second, the nesting selector is replaced by `:is()` wrapping the resolved
 * parent selector list, because that is what the nesting selector means:
 * "The nesting selector can be desugared by replacing it with the parent
 * style rule's selector, wrapped in an :is() selector", and "The specificity
 * of the nesting selector is equal to the largest specificity among the
 * complex selectors in the parent style rule's selector list (identical to
 * the behavior of :is())" (CSS Nesting section 4). The wrapping is not
 * decoration. With a parent list of `.foo, #a`, a nested `& .title` beats a
 * later `.card .title`; substituting the branches without `:is()` loses,
 * because `.foo .title` is less specific than `.card .title`. Distributing
 * the parent list over the branches instead is also wrong, and `:not(&)`
 * shows it: under a parent of `.a, .b`, `:not(:is(.a, .b))` is the browser's
 * answer while `:not(.a), :not(.b)` matches nearly everything.
 *
 * `@nest` was removed from the specification and is not supported.
 *
 * Reference: [CSS nesting](https://drafts.csswg.org/css-nesting/).
 */

import type { AtRule, Container, Document, Rule } from "postcss";

import { createDiagnostic } from "../diagnostics/index.ts";
import type { Diagnostic } from "../diagnostics/index.ts";
import type { SourceLocation } from "../records/index.ts";

/**
 * The outcome of resolving one rule's selector. `selector` is the flat
 * selector list a matcher passes on, or `null` when the rule has no selector
 * worth matching, which happens when the browser discards the rule outright
 * and when the rule's nesting context is one this release does not resolve.
 * `null` rather than an empty string, because an empty selector is itself a
 * malformed selector list and the two must stay distinguishable.
 *
 * Diagnostics travel alongside rather than being thrown, matching how branch
 * splitting reports: a rule that cannot be resolved says nothing about the
 * rules around it.
 */
export type NestingResolution = {
  selector: string | null;
  diagnostics: readonly Diagnostic[];
};

/**
 * The combinators a relative selector may begin with. A complex selector
 * starting with one of these is relative to the parent rule's elements, so
 * the nesting selector is prepended in front of the combinator.
 */
const LEADING_COMBINATORS = new Set([">", "+", "~"]);

/**
 * The characters that may follow the nesting selector inside a compound
 * selector, alongside whitespace and the end of the selector. The set is not
 * a guess: each candidate was applied in Chromium and the rule either
 * survived in the CSSOM or was discarded. `&.bar`, `&#bar`, `&[a]`,
 * `&:hover`, `&&`, `& .bar`, `&>.bar`, `&+.bar`, `&~.bar`, and `&,.bar` all
 * survive; `&bar`, `&*`, `&|bar`, `&-bar`, `&_bar`, `&2bar`, `&\.bar`,
 * `&ébar`, and every other punctuation mark are discarded, rule and all.
 *
 * The common way to land outside this set is the preprocessor habit the
 * specification calls out by name: `&Bar` reads as a concatenation in Sass
 * and is invalid in CSS, because `Bar` is a type selector and a type
 * selector must come first in its compound selector. `Bar&` is the valid
 * spelling and means something different, since nesting matches the elements
 * the parent selector matches rather than rewriting text.
 */
const COMPOUND_CONTINUATIONS = new Set([".", "#", "[", ":", "&", ">", "+", "~", ","]);

/** Whitespace as the CSS syntax specification defines it for selectors. */
const WHITESPACE = new Set([" ", "\t", "\n", "\r", "\f"]);

/**
 * One scanned position in a selector: its index and the parenthesis or
 * bracket nesting depth it sits at.
 */
type ScannedPosition = {
  index: number;
  depth: number;
};

/**
 * Walks a selector, yielding every position that is not inside a quoted
 * string and not consumed by an escape, paired with its nesting depth.
 *
 * This scan is deliberately not the one branch splitting uses. That one
 * yields depth-zero positions only, because a comma anywhere else belongs to
 * its branch. Resolution needs the opposite: the nesting selector counts at
 * every depth, since `:is(.bar, &.baz)` contains one and must not be given an
 * implicit descendant prefix, so the depth travels with the position instead
 * of filtering it out.
 *
 * Quoted strings and backslash escapes are skipped, and both exclusions were
 * checked in Chromium. `&[title="&"]` matches an element whose title is
 * literally an ampersand, and `.a\&b` matches an element whose class is
 * literally `a&b`, so neither ampersand is a nesting selector. Comments need
 * no handling, because PostCSS strips a comment out of `Rule.selector` and
 * keeps the authored text with it only in `raws.selector.raw`, verified by
 * parsing a selector carrying one at the pinned version.
 *
 * A stray closing delimiter cannot push the depth below zero, matching how
 * branch splitting treats unbalanced text: Chromium closes an unbalanced
 * block at the end of input rather than rejecting the selector.
 */
function* scanSelector(selector: string): Generator<ScannedPosition> {
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];

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

    yield { index, depth };
  }
}

/**
 * Splits a selector list into its complex selectors, keeping each one exactly
 * as authored apart from the surrounding whitespace. An empty entry is kept
 * as an empty string rather than dropped, so that a malformed list such as
 * `.a, , .b` stays malformed after resolution and the branch splitter reports
 * it once, downstream, instead of resolution quietly repairing a rule the
 * browser discarded.
 */
function splitComplexSelectors(selector: string): string[] {
  const parts: string[] = [];
  let start = 0;

  for (const { index, depth } of scanSelector(selector)) {
    if (depth === 0 && selector[index] === ",") {
      parts.push(selector.slice(start, index).trim());
      start = index + 1;
    }
  }

  parts.push(selector.slice(start).trim());

  return parts;
}

/** Reports the index of every nesting selector in a complex selector. */
function nestingSelectorIndices(complex: string): number[] {
  const indices: number[] = [];

  for (const { index } of scanSelector(complex)) {
    if (complex[index] === "&") {
      indices.push(index);
    }
  }

  return indices;
}

/**
 * Reports whether a complex selector places something after the nesting
 * selector that cannot continue a compound selector, which the browser
 * answers by discarding the whole rule.
 *
 * Only depth zero is checked, and the difference is observable. Chromium
 * discards the rule for `:not(&div)`, because `:not()` takes an ordinary
 * selector list, but keeps it for `:is(&div, .bar)` and still matches `.bar`,
 * because `:is()` takes a forgiving one that drops the invalid argument.
 * Substituting into the forgiving case reproduces that exactly:
 * `:is(:is(.foo)div, .bar)` matches the same elements. Reporting at every
 * depth would therefore reject rules the browser applies, which is the one
 * error a debugging tool cannot afford, so a nesting selector inside a
 * functional pseudo-class passes through under the same rule branch
 * splitting already sets for well-formed-looking nonsense.
 */
function hasInvalidCompound(complex: string): boolean {
  for (const { index, depth } of scanSelector(complex)) {
    if (depth !== 0 || complex[index] !== "&") {
      continue;
    }

    const next = complex[index + 1];

    if (next === undefined || WHITESPACE.has(next) || COMPOUND_CONTINUATIONS.has(next)) {
      continue;
    }

    return true;
  }

  return false;
}

/** Reports whether a complex selector begins with a combinator. */
function startsWithCombinator(complex: string): boolean {
  const first = complex[0];

  return first !== undefined && LEADING_COMBINATORS.has(first);
}

/**
 * Replaces every nesting selector in a complex selector with the given
 * substitution, at every depth, so that `:is(.bar, &.baz)` resolves its inner
 * nesting selector too. The rebuild walks the collected indices from the end
 * so that earlier indices stay valid as the string grows.
 */
function substituteNestingSelector(complex: string, substitution: string): string {
  let result = complex;

  for (const index of nestingSelectorIndices(complex).reverse()) {
    result = result.slice(0, index) + substitution + result.slice(index + 1);
  }

  return result;
}

/**
 * Resolves one complex selector against the substitution its parent list
 * produced.
 *
 * The implicit nesting selector is prepended when the complex selector starts
 * with a combinator, and when it contains no nesting selector at all. Those
 * two conditions are separate rather than one: `> & .bar` starts with a
 * combinator and already contains a nesting selector, and the browser still
 * prepends, resolving it as `& > & .bar`.
 */
function resolveComplexSelector(complex: string, substitution: string): string {
  if (complex === "") {
    return "";
  }

  const relative = startsWithCombinator(complex) || nestingSelectorIndices(complex).length === 0;

  return substituteNestingSelector(relative ? `& ${complex}` : complex, substitution);
}

/**
 * What a rule's selector is written relative to.
 *
 * `nested` names the nearest ancestor style rule, whose resolved selector the
 * nesting selector stands for. `scoped` means an `@scope` at-rule was reached
 * first, which this release does not resolve. `top-level` means neither was
 * found, and the selector is already flat.
 */
type NestingContext =
  | { kind: "nested"; parent: Rule }
  | { kind: "scoped"; atRule: AtRule }
  | { kind: "non-style"; atRule: AtRule }
  | { kind: "top-level" };

/**
 * The group at-rules nesting sees through. Each groups style rules without
 * changing what their selectors mean, so a rule inside one is still nested in
 * whatever style rule encloses that. Chromium confirms each keeps
 * `.card { @media … { .title { } } }` matching what `:is(.card) .title`
 * matches.
 *
 * Every other at-rule is opaque, and the distinction matters because some of
 * them contain `Rule` nodes that are not style rules at all. PostCSS parses
 * the `from`, `to`, and `50%` inside `@keyframes` as ordinary `Rule` nodes,
 * so walking through it would resolve `from` into `:is(.card) from`: a
 * matchable-looking selector for something that is not a selector. Chromium
 * discards a `@keyframes` nested in a style rule outright, serialising
 * `.card { @keyframes spin { … } }` back as `.card { }`, so there is nothing
 * there to match at all.
 */
const TRANSPARENT_GROUP_AT_RULES = new Set([
  "media",
  "supports",
  "container",
  "layer",
  "starting-style",
]);

/**
 * Finds what a rule's selector is relative to by walking its ancestors.
 *
 * Group at-rules are transparent, because nesting interleaves with them: a
 * style rule inside `@media` inside a style rule is still nested in that
 * outer style rule, and its nesting selector still means the outer rule's
 * elements. Chromium confirms that for `@media`, `@supports`, `@container`,
 * `@layer`, and `@starting-style`, each of which keeps `.card { @media … {
 * & .title { } } }` matching exactly the elements `:is(.card) .title` does.
 *
 * `@scope` is the exception, and it is a real one rather than caution. Inside
 * a nested `@scope`, the specification redefines the nesting selector: "The &
 * selector behaves like :where(:scope) in @scope rules" (CSS Nesting section
 * 3.3.1), and a rule with no nesting selector is prefixed with `:scope`
 * rather than `&`. Chromium agrees: `.card { @scope (& > .inner) { .title { }
 * } }` matches nothing that `:is(.card) .title` matches. Neither meaning can
 * be written as a flat selector at all, because the scoping root is not
 * expressible outside the rule, so the honest answer is to report rather than
 * to resolve as though `@scope` were not there. The rule contexts issue owns
 * `@scope` support.
 */
/**
 * Yields every ancestor of a node, from its immediate parent outward to the
 * root, following the parent chain until it ends. `nestingContextOf()` below
 * stops at the first ancestor it cares about, because a nesting selector's
 * meaning is fixed by the nearest style rule or `@scope`. Rule-context
 * compilation (CSSC-011) walks this identical chain to completion instead,
 * because conditional and grouping at-rules stack past intervening style
 * rules that nesting resolution treats as a stopping boundary: `@layer a {
 * .card { @media … { &.active { } } } }` has `.active`'s context reach both
 * `@layer` and `@media`, on either side of the `.card` rule nesting stops at.
 * Sharing one generator is what keeps both modules walking the same chain
 * rather than each maintaining its own, possibly diverging, notion of "the
 * next ancestor."
 */
export function* ancestorsOf(node: Rule | AtRule): Generator<Container | Document> {
  let ancestor: Container | Document | undefined = node.parent;

  while (ancestor !== undefined) {
    yield ancestor;
    ancestor = ancestor.parent;
  }
}

function nestingContextOf(rule: Rule): NestingContext {
  for (const ancestor of ancestorsOf(rule)) {
    if (ancestor.type === "rule") {
      return { kind: "nested", parent: ancestor as Rule };
    }

    if (ancestor.type !== "atrule") {
      return { kind: "top-level" };
    }

    const atRule = ancestor as AtRule;

    const name = atRule.name.toLowerCase();

    if (name === "scope") {
      return { kind: "scoped", atRule };
    }

    if (!TRANSPARENT_GROUP_AT_RULES.has(name)) {
      return { kind: "non-style", atRule };
    }
  }

  return { kind: "top-level" };
}

/**
 * Builds a source location for a rule from its parser positions, matching the
 * fallback annotation association uses for a node with no end position.
 */
function locationOf(rule: Rule, url: string): SourceLocation {
  const start = rule.source?.start ?? { line: 1, column: 1 };
  const end = rule.source?.end ?? start;

  return {
    url,
    start: { line: start.line, column: start.column },
    end: { line: end.line, column: end.column },
  };
}

/**
 * Resolves a rule's selector against its ancestor chain into one flat
 * selector list.
 *
 * A rule with no ancestor style rule is already flat and its selector passes
 * through unchanged, including when it contains a nesting selector. That is
 * not an omission: at the top level the nesting selector "represents the same
 * elements as :scope in that context" (CSS Nesting section 4), and Chromium
 * answers `document.querySelectorAll("& .foo")` with exactly the elements the
 * top-level rule `& .foo { }` styles, so passing the selector through keeps
 * the browser's own reading rather than inventing one.
 *
 * A rule whose selector places a type or universal selector immediately after
 * the nesting selector produces `INVALID_NESTING_SELECTOR` and no selector at
 * all. Chromium discards the entire rule for `&div`, and discards it for
 * `&div, .bar` too, so the well-formed branch beside it never applies to
 * anything either; substituting textually would instead hand the matcher
 * `:is(.foo)div`, which `querySelectorAll()` rejects outright.
 *
 * A rule inside `@scope` produces `DEFERRED_SCOPE_NESTING` and no selector,
 * because `@scope` redefines what the nesting selector means and the scoping
 * root cannot be written into a flat selector.
 *
 * An ancestor that resolves to nothing carries its diagnostics down and
 * resolves this rule to nothing as well, because a rule the browser discarded
 * takes its nested rules with it.
 */
export function resolveNestedSelector(rule: Rule, url: string): NestingResolution {
  const complexSelectors = splitComplexSelectors(rule.selector);
  const invalid = complexSelectors.find((complex) => hasInvalidCompound(complex));

  if (invalid !== undefined) {
    return {
      selector: null,
      diagnostics: [
        createDiagnostic("INVALID_NESTING_SELECTOR", {
          source: locationOf(rule, url),
          details: { selector: rule.selector, complexSelector: invalid },
        }),
      ],
    };
  }

  const context = nestingContextOf(rule);

  if (context.kind === "scoped") {
    return {
      selector: null,
      diagnostics: [
        createDiagnostic("DEFERRED_SCOPE_NESTING", {
          source: locationOf(rule, url),
          details: { selector: rule.selector, atRule: context.atRule.name },
        }),
      ],
    };
  }

  if (context.kind === "non-style") {
    // Not a style rule, so there is no selector to resolve. No diagnostic is
    // raised here: rule-context compilation already reports why a rule in
    // this position is not probed, and reporting it twice would tell an
    // author about one problem in two voices.
    return { selector: null, diagnostics: [] };
  }

  if (context.kind === "top-level") {
    return { selector: rule.selector, diagnostics: [] };
  }

  const parent = resolveNestedSelector(context.parent, url);

  if (parent.selector === null) {
    return { selector: null, diagnostics: parent.diagnostics };
  }

  const substitution = `:is(${parent.selector})`;

  return {
    selector: complexSelectors
      .map((complex) => resolveComplexSelector(complex, substitution))
      .join(", "),
    diagnostics: parent.diagnostics,
  };
}
