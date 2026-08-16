/**
 * Rule-context compilation.
 *
 * A style rule can sit inside a stack of at-rules, and those at-rules are not
 * alike. This module walks a rule's ancestors and turns that stack into
 * structured metadata: which conditions wrap the rule, verbatim and
 * unevaluated, and which cascade or matching constructs surround it. A later
 * phase (CSSC-017) decides whether each condition holds; this module records
 * only what encloses the rule, never whether it applies.
 *
 * At-rules that can enclose a style rule fall into three kinds, and
 * conflating any two of them would misreport why a probe behaves the way it
 * does.
 *
 * `@media` and `@supports` are conditions: the enclosed rule applies only
 * when the condition holds at evaluation time, and this module records the
 * condition text exactly as authored, because deciding whether it holds
 * needs a browser and belongs to CSSC-017.
 *
 * `@layer` affects the cascade, not whether the rule applies at all: an
 * enclosed rule always matches the elements its selector matches, so `@layer`
 * is recorded as metadata a probe can report but never a reason to skip one.
 *
 * `@scope`, `@container`, `@starting-style`, and `@keyframes` are each a
 * reason a rule cannot be honestly probed at all in this release, and the
 * implementation plan (§5.10) names all four together as producing
 * `OUTSIDE_SUPPORTED_TARGET_SET`, so this module reports that one code for
 * all four rather than one shared "unsupported" message split across
 * different codes. Each still carries its own explanation through the
 * message, because the reason differs even where the code does not:
 *
 * - `@scope` also redefines what a nesting selector means, and its scoping
 *   root cannot be written into a flat selector. That is a genuinely
 *   different fact from "this rule sits somewhere css-console does not
 *   evaluate," and nesting resolution (CSSC-010) already reports it as
 *   `DEFERRED_SCOPE_NESTING` for a rule nested directly under `@scope`. This
 *   module does not reuse that code: doing so produced the exact same code
 *   twice for one rule when both phases ran, which tells a consumer
 *   collecting diagnostics from both phases nothing a single report would
 *   not, and hides that a rule nested two levels into `@scope` past an
 *   intervening style rule is a case nesting resolution does not reach at
 *   all (CSSC-010's traversal stops at the first style-rule ancestor) but
 *   rule-context compilation does. `OUTSIDE_SUPPORTED_TARGET_SET` here and
 *   `DEFERRED_SCOPE_NESTING` from nesting resolution are two distinct facts
 *   a consumer may see about the same rule, not one fact reported twice.
 * - `@container` query evaluation is deferred by choice (see
 *   docs/decisions and §4.3 of the implementation plan): resolving which
 *   container an element queries against, and whether its condition holds,
 *   is out of scope for this release. Reported as
 *   `OUTSIDE_SUPPORTED_TARGET_SET`, the same code the annotation-association
 *   pass already uses for a tool-scope limitation.
 * - `@starting-style` declarations apply only during a transition or
 *   animation's first rendered frame. Reading computed style at any other
 *   moment reports the element's ordinary values with no trace that
 *   `@starting-style` ran at all, so a probe evaluated the ordinary way would
 *   silently misreport an unrelated steady-state value as though it came
 *   from the annotated rule. That is a trap for whoever reads the probe's
 *   output, so it is said out loud in the diagnostic rather than left to be
 *   discovered. Reported as `OUTSIDE_SUPPORTED_TARGET_SET`, because "this
 *   tool cannot faithfully observe this" is the same tool-scope shape as the
 *   `@container` case, even though the underlying reason differs.
 * - `@keyframes` is not an annotation target per the target table (§3.3 of
 *   the implementation plan), and PostCSS parses its children, `from`, `to`,
 *   and percentage selectors such as `50%`, as ordinary `Rule` nodes.
 *   Annotating `@keyframes` itself is already rejected at association time
 *   (CSSC-006), but an annotation whose next sibling is a keyframe selector
 *   is caught only here, once the rule's ancestry is walked. Reported as
 *   `OUTSIDE_SUPPORTED_TARGET_SET`: a keyframe selector is not a style
 *   selector and matches no element on its own.
 *
 * A style rule authored inside an `@function` body is a fifth, distinct
 * case. It is not a tool-scope limitation css-console chose; it is CSS the
 * browser itself discards. Verified in Chromium: parsing
 * `@function --f() returns <color> { .inner { color: red; } result: blue; }`
 * and reading the parsed rule's `cssText` back from the CSSOM shows `.inner`
 * gone entirely, leaving only the empty body. `INVALID_FUNCTION_BODY_RULE`
 * names that outright rejection rather than borrowing a "deferred" code that
 * would wrongly imply css-console could probe it once it built more support.
 *
 * The walk itself reuses `ancestorsOf()` from ../nesting/index.ts (CSSC-010)
 * rather than a second, subtly different traversal. Nesting resolution stops
 * at the nearest style rule or `@scope`, because a nesting selector's meaning
 * is fixed there; rule-context compilation walks the full chain, because
 * conditions and `@layer` stack past intervening style rules that nesting
 * treats as a stopping boundary. `@layer a { .card { @media … { &.active {
 * } } } }` has `.active`'s context reach both `@layer` and `@media`, on
 * either side of the `.card` rule nesting stops at, which is exactly why the
 * two modules cannot share one stopping rule, only one way of walking.
 *
 * `compileDeclarationContext()` answers a narrower, related question: the
 * context of one declaration rather than of the rule that owns it. CSS
 * nesting lets a conditional at-rule sit between a declaration and its
 * owning rule, as in `.card { @media (width > 40em) { padding: 1rem; } }`,
 * and that nested `@media` is not in the rule's own ancestor chain at all;
 * `compileRuleContext(rule)` walks upward from the rule and never sees it.
 * A call site resolved from that declaration (CSSC-013) is not honestly
 * unconditional just because the rule it is nested in happens to be, and a
 * nested `@container` is not honestly probable just because the rule around
 * it is outside `@container` altogether. `compileDeclarationContext()`
 * closes that gap by walking from the declaration down to its owning rule
 * and then continuing through the rule's own ancestors, so the result is the
 * full stack a call site actually sits inside, nested segment and rule
 * context together, outermost first.
 */

import type { AtRule, Container, Declaration, Document, Rule } from "postcss";

import { createDiagnostic } from "../diagnostics/index.ts";
import type { Diagnostic, DiagnosticCode } from "../diagnostics/index.ts";
import type { SourceLocation } from "../records/index.ts";

import { ancestorsOf } from "../nesting/index.ts";

/**
 * One condition or cascade construct a rule's context carries. `condition`
 * is the at-rule's parameters exactly as authored, never evaluated and never
 * normalised, because deciding whether it holds needs a browser and belongs
 * to CSSC-017. `name` on a `layer` entry is `null` for an anonymous layer,
 * `@layer { }`, which PostCSS reports as an empty `params` string.
 */
export type RuleContextEntry =
  | { kind: "media"; condition: string }
  | { kind: "supports"; condition: string }
  | { kind: "layer"; name: string | null };

/**
 * The compiled context of one rule: every condition and cascade construct
 * enclosing it, outermost first, matching the order an author reads them in
 * source. An intervening style rule contributes no entry of its own; nesting
 * resolution (CSSC-010) already accounts for it on the selector side, and
 * rule context is concerned only with the at-rules that wrap the rule.
 */
export type RuleContext = {
  entries: readonly RuleContextEntry[];
};

/**
 * The outcome of compiling one rule's context. `context` is `null` when the
 * rule sits somewhere this release cannot honestly probe, matching how
 * nesting resolution reports `selector: null`: `diagnostics` then carries
 * exactly one diagnostic naming why, and a later phase must not evaluate the
 * rule. `context` is a value, possibly with no entries, otherwise.
 */
export type RuleContextResolution = {
  context: RuleContext | null;
  diagnostics: readonly Diagnostic[];
};

/**
 * Builds a source location for a rule or declaration from its parser
 * positions, matching the fallback every other compiler module uses for a
 * node with no end position.
 */
function locationOf(node: Rule | Declaration, url: string): SourceLocation {
  const start = node.source?.start ?? { line: 1, column: 1 };
  const end = node.source?.end ?? start;

  return {
    url,
    start: { line: start.line, column: start.column },
    end: { line: end.line, column: end.column },
  };
}

/**
 * Builds the blocked outcome for a rule whose ancestry includes an at-rule
 * this release cannot honestly compile a context through. The diagnostic's
 * source is the rule itself, matching the convention nesting resolution's
 * `DEFERRED_SCOPE_NESTING` sets, because that is the location an author
 * annotated and the location a diagnostic list groups by; `details` names
 * both the rule's own selector and the blocking at-rule's authored name, case
 * preserved, since at-keywords are ASCII case-insensitive but an author
 * searching their stylesheet for what a diagnostic named should find it
 * spelled the way they wrote it.
 */
function blocked(
  code: DiagnosticCode,
  rule: Rule,
  atRule: AtRule,
  url: string,
  message?: string,
): RuleContextResolution {
  return {
    context: null,
    diagnostics: [
      createDiagnostic(code, {
        message,
        source: locationOf(rule, url),
        details: { selector: rule.selector, atRule: atRule.name },
      }),
    ],
  };
}

/**
 * Builds the blocked outcome for a declaration whose nested ancestry, between
 * it and its owning rule, includes an at-rule this release cannot honestly
 * compile a context through. The source is the declaration rather than the
 * rule, and `details` names the declaration's own property rather than a
 * selector, matching the convention the descriptor-at-rule diagnostic in
 * ../functions/index.ts already uses for a declaration-level exclusion.
 */
function blockedAtDeclaration(
  code: DiagnosticCode,
  declaration: Declaration,
  atRule: AtRule,
  url: string,
  message?: string,
): RuleContextResolution {
  return {
    context: null,
    diagnostics: [
      createDiagnostic(code, {
        message,
        source: locationOf(declaration, url),
        details: { property: declaration.prop, atRule: atRule.name },
      }),
    ],
  };
}

/**
 * What one at-rule ancestor contributes to a context walk: the entry it adds
 * (possibly none, for an at-rule this project recognises but does not
 * annotate as a condition, which does not currently arise but keeps the
 * classification total), or the fact that it blocks compilation entirely.
 * Shared by `compileRuleContext()` and `compileDeclarationContext()` so one
 * case list decides what every at-rule means for a probe, rather than two
 * classifications answering the question differently.
 */
type AtRuleClassification =
  | { blocked: false; entry: RuleContextEntry | null }
  | { blocked: true; code: DiagnosticCode; message?: string };

const SCOPE_MESSAGE =
  "This rule sits inside @scope. css-console does not evaluate rule contexts inside @scope in this release. This is a distinct fact from DEFERRED_SCOPE_NESTING, which nesting resolution reports separately when a nested rule's own selector cannot be flattened because @scope redefines what the nesting selector means; a rule may report one, the other, both, or neither, depending on where in its ancestry each condition is found. The rule is not probed.";

const CONTAINER_MESSAGE =
  "This rule sits inside @container. Resolving which container an element queries against, and whether its condition holds, is deferred by choice in this release. The rule is not probed.";

const STARTING_STYLE_MESSAGE =
  "This rule sits inside @starting-style. Its declarations apply only during a transition or animation's first rendered frame; reading computed style at any other moment reports the element's ordinary values with no trace that @starting-style ran, so probing here would misattribute an unrelated steady-state value to this rule. The rule is not probed.";

const KEYFRAMES_MESSAGE =
  "This rule is a keyframe selector inside @keyframes, such as 50% or from, not a style rule with an element selector. @keyframes is not an annotation target and its children match no element on their own. The rule is not probed.";

/** Builds the fallback message for an at-rule outside every named case. */
function unrecognizedMessage(atRule: AtRule): string {
  return (
    `This rule sits inside @${atRule.name}, an at-rule outside css-console's supported rule-context ` +
    "set. The rule is not probed."
  );
}

/**
 * Classifies one at-rule ancestor encountered during a context walk. See the
 * module doc comment for what each named at-rule means for a probe and why;
 * this is the one place that list of cases is written down, shared by
 * `compileRuleContext()` and `compileDeclarationContext()` so a nested walk
 * and a rule walk can never disagree about what the same at-rule means.
 */
function classifyAtRule(atRule: AtRule): AtRuleClassification {
  const name = atRule.name.toLowerCase();

  if (name === "media") {
    return { blocked: false, entry: { kind: "media", condition: atRule.params } };
  }

  if (name === "supports") {
    return { blocked: false, entry: { kind: "supports", condition: atRule.params } };
  }

  if (name === "layer") {
    const layerName = atRule.params.trim();

    return { blocked: false, entry: { kind: "layer", name: layerName === "" ? null : layerName } };
  }

  if (name === "scope") {
    return { blocked: true, code: "OUTSIDE_SUPPORTED_TARGET_SET", message: SCOPE_MESSAGE };
  }

  if (name === "container") {
    return { blocked: true, code: "OUTSIDE_SUPPORTED_TARGET_SET", message: CONTAINER_MESSAGE };
  }

  if (name === "starting-style") {
    return { blocked: true, code: "OUTSIDE_SUPPORTED_TARGET_SET", message: STARTING_STYLE_MESSAGE };
  }

  if (name === "keyframes") {
    return { blocked: true, code: "OUTSIDE_SUPPORTED_TARGET_SET", message: KEYFRAMES_MESSAGE };
  }

  if (name === "function") {
    return { blocked: true, code: "INVALID_FUNCTION_BODY_RULE" };
  }

  return {
    blocked: true,
    code: "OUTSIDE_SUPPORTED_TARGET_SET",
    message: unrecognizedMessage(atRule),
  };
}

/**
 * Compiles the context of one rule: the stack of conditional and grouping
 * at-rules enclosing it. See the module doc comment for what each at-rule
 * means for a probe and why.
 *
 * The walk visits every ancestor via `ancestorsOf()`, in nearest-first order,
 * and stops at the first blocking at-rule it finds; the nearest boundary
 * wins, matching how nesting resolution treats the nearest `@scope`. Any
 * at-rule outside the five named cases, such as `@page` or `@font-face`,
 * blocks compilation too, defaulting to caution rather than assuming an
 * unrecognised construct behaves like an ordinary condition.
 */
export function compileRuleContext(rule: Rule, url: string): RuleContextResolution {
  const entries: RuleContextEntry[] = [];

  for (const ancestor of ancestorsOf(rule)) {
    if (ancestor.type !== "atrule") {
      continue;
    }

    const atRule = ancestor as AtRule;
    const classification = classifyAtRule(atRule);

    if (classification.blocked) {
      return blocked(classification.code, rule, atRule, url, classification.message);
    }

    if (classification.entry !== null) {
      entries.push(classification.entry);
    }
  }

  return { context: { entries: entries.reverse() }, diagnostics: [] };
}

/**
 * Yields every ancestor of a declaration, from its parent outward. Matches
 * `ancestorsOf()` from ../nesting/index.ts, which cannot be reused directly
 * because it is typed over `Rule | AtRule` and a declaration is neither; the
 * walk itself is the same one line, just starting one node lower.
 */
function* ancestorsOfDeclaration(declaration: Declaration): Generator<Container | Document> {
  let ancestor: Container | Document | undefined = declaration.parent;

  while (ancestor !== undefined) {
    yield ancestor;
    ancestor = ancestor.parent;
  }
}

/**
 * Compiles the context of one declaration: the full stack of conditional and
 * grouping at-rules enclosing it, nested segment and owning rule's own
 * context together, outermost first. See the module doc comment for why this
 * is a different question from `compileRuleContext(rule)` alone.
 *
 * The walk goes nearest-first from the declaration, exactly like
 * `compileRuleContext()`'s walk from a rule, so the nearest boundary wins the
 * same way: a blocking at-rule between the declaration and its owning rule is
 * found, and reported, before the rule's own ancestry is ever consulted. A
 * style-rule ancestor contributes no entry, matching how `compileRuleContext`
 * treats an intervening style rule, and marks where the nested segment ends;
 * the owning rule's own context is then computed the ordinary way and
 * appended after the nested segment, which is already outermost first once
 * reversed, so concatenating the two, rule context then nested segment,
 * yields one outermost-first stack. A declaration with no owning rule
 * reachable in its ancestry, which does not arise for a call site since
 * placement has already confirmed one exists, produces an empty context
 * rather than failing, so this function stays total.
 */
export function compileDeclarationContext(
  declaration: Declaration,
  url: string,
): RuleContextResolution {
  const nestedEntries: RuleContextEntry[] = [];
  let owner: Rule | undefined;

  for (const ancestor of ancestorsOfDeclaration(declaration)) {
    if (ancestor.type === "rule") {
      owner = ancestor as Rule;
      break;
    }

    if (ancestor.type !== "atrule") {
      break;
    }

    const atRule = ancestor as AtRule;
    const classification = classifyAtRule(atRule);

    if (classification.blocked) {
      return blockedAtDeclaration(
        classification.code,
        declaration,
        atRule,
        url,
        classification.message,
      );
    }

    if (classification.entry !== null) {
      nestedEntries.push(classification.entry);
    }
  }

  if (owner === undefined) {
    return { context: { entries: nestedEntries.reverse() }, diagnostics: [] };
  }

  const ruleContext = compileRuleContext(owner, url);

  if (ruleContext.context === null) {
    return ruleContext;
  }

  return {
    context: { entries: [...ruleContext.context.entries, ...nestedEntries.reverse()] },
    diagnostics: [],
  };
}
