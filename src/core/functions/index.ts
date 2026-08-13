/**
 * Custom function call-site resolution.
 *
 * A function probe annotates a definition, but a custom function has no value
 * of its own: the only place a value is observable is where the function is
 * called. This module closes that gap. Given a parsed tree and the function
 * target annotation association produced, it finds every call of that
 * function across the source and reports each one with the context a later
 * phase needs, plus the calls that are references from inside another
 * function's body rather than call sites at all.
 *
 * Three rules govern what counts, and they are distinct (implementation plan
 * section 5.6).
 *
 * Every call in a declaration value is its own call site, so
 * `margin: --space(1) --space(2)` produces two call sites rather than one.
 *
 * A call passed as an argument to another call records the outer call, with
 * the inner captured verbatim as the authored argument. That is why the scan
 * stops descending once it matches: the inner call has no value the tool can
 * observe separately, since the outer call consumes it before the property
 * ever resolves.
 *
 * A call inside another function's body is a definition reference rather than
 * a call site. `@function --a() { result: --b(2); }` is valid CSS, verified in
 * Chromium 151.0.7922.34 where `@function --space(--n) { result:
 * --double(calc(var(--n) * 10px)); }` gives `width: --space(2)` a computed
 * width of 40px, but only the outer function's result reaches a declaration,
 * so the inner call is reported separately rather than presented as something
 * with a resolved value.
 *
 * Name matching is an exact string comparison, unlike the at-keyword and
 * standard property lookups elsewhere in the compiler, which normalise case.
 * A custom function name is a dashed-ident, and dashed-idents are
 * case-sensitive. Checked in Chromium 151.0.7922.34 rather than assumed: with
 * `@function --Space(--n)` defined, `width: --Space(2)` computed 20px while
 * `width: --space(2)` computed the block default of 1264px, so the lowercased
 * spelling called nothing.
 *
 * Values are tokenized with `postcss-value-parser` rather than scanned by
 * hand, which is the plan the parser selection record set out
 * (docs/decisions/0013-parser-selection-postcss.md). The name boundary is the
 * reason it matters here: a hand-rolled scan for the name followed by an open
 * parenthesis reads `--space-loose(4)` as a call of `--space`, which is the
 * same defect the `var()` scan in the rule compiler had to guard against with
 * an identifier lookbehind. The tokenizer yields `--space-loose` as one
 * function name, so exact equality is the whole test.
 *
 * Resolution runs after nesting resolution, so a recorded selector is always
 * flat, and after rule-context compilation, so a call sitting somewhere this
 * release cannot honestly probe is excluded and said out loud rather than
 * reported as though its value came from the annotated rule.
 *
 * Reference: [CSS custom functions and
 * mixins](https://drafts.csswg.org/css-mixins-1/).
 */

import type { AtRule, Container, Declaration, Document, Root, Rule } from "postcss";
import valueParser from "postcss-value-parser";
import type { FunctionNode, Node } from "postcss-value-parser";

import { functionNameOf } from "../annotations/associate.ts";
import type { AnnotationTarget } from "../annotations/associate.ts";

import { compileRuleContext } from "../compiler/index.ts";
import { createDiagnostic } from "../diagnostics/index.ts";
import type { Diagnostic } from "../diagnostics/index.ts";
import { resolveNestedSelector } from "../nesting/index.ts";
import type { CallSite, SourceLocation } from "../records/index.ts";

/** The function target shape a function probe resolves call sites from. */
export type FunctionTarget = Extract<AnnotationTarget, { kind: "function" }>;

/**
 * One call of the annotated function from inside another function's body.
 *
 * This is not a call site and is deliberately not shaped like one. It carries
 * no selector, because a function body matches no element, and no
 * `soleContribution`, because the property a function body declares is
 * `result` rather than a destination property whose resolved value anything
 * can read. `functionName` is the enclosing function, which is the fact that
 * makes the reference worth reporting: it tells an author where the annotated
 * function is used even though no value is observable there.
 */
export type DefinitionReference = {
  functionName: string;
  property: string;
  arguments: readonly string[];
  source: SourceLocation;
};

/**
 * The outcome of resolving one function probe's call sites: every call site
 * found, in source order, every definition reference found, and every
 * diagnostic the pass produced.
 *
 * A function with no call sites produces `NO_CALL_SITES` rather than an empty
 * result and silence, because an empty result is indistinguishable from a
 * probe that never ran, and "nothing calls this function" is itself the
 * answer an author is looking for.
 */
export type CallSiteResolution = {
  callSites: readonly CallSite[];
  definitionReferences: readonly DefinitionReference[];
  diagnostics: readonly Diagnostic[];
};

/**
 * Builds a source location for a node from its parser positions, matching the
 * fallback every other compiler module uses for a node with no end position.
 */
function locationOf(node: Declaration | Rule, url: string): SourceLocation {
  const start = node.source?.start ?? { line: 1, column: 1 };
  const end = node.source?.end ?? start;

  return {
    url,
    start: { line: start.line, column: start.column },
    end: { line: end.line, column: end.column },
  };
}

/**
 * Collects every call of `name` among a series of parsed value nodes, in
 * source order.
 *
 * The recursion descends into a function that is not the one sought, so a
 * call wrapped in `calc()` is still found, and stops at one that is, so
 * `--space(--space(2))` yields the outer call alone with the inner left
 * inside its arguments. Only function nodes can contain a call: a word, a
 * string, or a space never can, which is what keeps a function name written
 * inside a quoted string, as in `content: "--space(4)"`, from matching.
 */
function collectCalls(nodes: readonly Node[], name: string, found: FunctionNode[]): void {
  for (const node of nodes) {
    if (node.type !== "function") {
      continue;
    }

    if (node.value === name) {
      found.push(node);
      continue;
    }

    collectCalls(node.nodes, name, found);
  }
}

/**
 * Reads one call's arguments as authored, splitting on the commas that
 * separate them.
 *
 * Only a comma separates arguments, so a slash or a colon inside an argument
 * stays part of it. Each argument is stringified back from its own nodes
 * rather than sliced out of the value text, which keeps a nested call or a
 * `var()` reference exactly as written, including the spacing inside it, and
 * then trimmed of the whitespace that sat around the separator rather than
 * inside the argument. A call written with no arguments carries an empty
 * list.
 */
function argumentsOf(call: FunctionNode): string[] {
  const argumentNodes: Node[][] = [[]];

  for (const node of call.nodes) {
    if (node.type === "div" && node.value === ",") {
      argumentNodes.push([]);
      continue;
    }

    argumentNodes[argumentNodes.length - 1]?.push(node);
  }

  const [only] = argumentNodes;

  if (argumentNodes.length === 1 && (only === undefined || only.length === 0)) {
    return [];
  }

  return argumentNodes.map((nodes) => valueParser.stringify(nodes).trim());
}

/**
 * Reports whether a call is the entire declaration value, so that no other
 * authored expression contributes to what the property resolves to.
 *
 * The test is that the call is one of the value's own top-level nodes and the
 * only one that is not whitespace. Three things fall out of that rather than
 * needing their own handling, and each was a way to get this wrong. Leading
 * and trailing whitespace is a `space` node and is skipped. A trailing
 * `!important` never reaches here at all, because PostCSS keeps it in
 * `Declaration.important` rather than in the value. A trailing comment leaves
 * a trailing space behind in the value: parsing a declaration whose value is
 * followed by a comment at the pinned postcss version reports the value as
 * `"--space(1) "`, with the comment itself kept in `raws`, and that trailing
 * space is a `space` node too.
 *
 * A call inside `calc()` is not the sole contribution even when `calc()`
 * wraps nothing else, because the surrounding expression is still authored
 * around it and the resolved value is the property's, never the function's
 * return value.
 */
function isSoleContribution(topLevel: readonly Node[], call: FunctionNode): boolean {
  const significant = topLevel.filter((node) => node.type !== "space");

  return significant.length === 1 && significant[0] === call;
}

/** Yields every ancestor of a declaration, from its parent outward. */
function* ancestorsOfDeclaration(declaration: Declaration): Generator<Container | Document> {
  let ancestor: Container | Document | undefined = declaration.parent;

  while (ancestor !== undefined) {
    yield ancestor;
    ancestor = ancestor.parent;
  }
}

/**
 * Returns the `@function` at-rule a declaration is authored inside, or
 * undefined when it is not inside one.
 *
 * The whole ancestor chain is walked rather than the immediate parent alone,
 * because a function body may wrap its declarations in `@media` or
 * `@supports` conditionals. At-keywords are ASCII case-insensitive and
 * PostCSS preserves the case the author wrote, so the comparison normalises;
 * the name reported back to an author never does.
 */
function enclosingFunction(declaration: Declaration): AtRule | undefined {
  for (const ancestor of ancestorsOfDeclaration(declaration)) {
    if (ancestor.type === "atrule" && (ancestor as AtRule).name.toLowerCase() === "function") {
      return ancestor as AtRule;
    }
  }

  return undefined;
}

/**
 * Where a call-bearing declaration sits: in a rule whose selector and context
 * this release can honestly probe, or nowhere it can, with the diagnostics
 * that say why.
 */
type DeclarationPlacement =
  | { probed: true; selector: string; rule: Rule }
  | { probed: false; diagnostics: readonly Diagnostic[] };

/**
 * Decides whether the rule a call sits in can be probed, and with what flat
 * selector.
 *
 * Rule-context compilation runs first, because a rule inside `@container`,
 * `@keyframes`, `@scope`, or `@starting-style` is excluded for a reason that
 * has nothing to do with its selector, and reporting that reason is more
 * useful than reporting that the selector could not be flattened. Nesting
 * resolution runs second and supplies the flat selector the call site
 * records, which is why call-site resolution is ordered after it.
 */
function placementOf(rule: Rule, url: string): DeclarationPlacement {
  const context = compileRuleContext(rule, url);

  if (context.context === null) {
    return { probed: false, diagnostics: context.diagnostics };
  }

  const nesting = resolveNestedSelector(rule, url);

  if (nesting.selector === null) {
    return { probed: false, diagnostics: nesting.diagnostics };
  }

  return { probed: true, selector: nesting.selector, rule };
}

/**
 * The message an at-rule that declares rather than styles carries when a call
 * is found inside it. A descriptor such as `@property`'s `initial-value` has
 * no element to resolve against, so there is no call site to report even
 * though the text reads like one.
 */
function descriptorMessage(atRule: string): string {
  return (
    `This call sits inside @${atRule}, which describes a font or a property registration ` +
    "rather than styling an element. There is no element to resolve the call against, so it " +
    "is not a call site. Call the function from a declaration on an element instead."
  );
}

/**
 * Resolves every call site of one annotated function across a parsed source.
 *
 * A call is found only in a declaration value, which is the only place a
 * custom function can be called. Where that declaration sits then decides
 * what the call is:
 *
 * - inside another function's body, it is a definition reference;
 * - inside a style rule this release can probe, it is a call site carrying
 *   that rule's flat selector;
 * - anywhere else, it is excluded, and the exclusion is reported.
 *
 * A diagnostic is raised only for a declaration that actually contains a
 * call, so a stylesheet full of `@keyframes` produces no noise for a function
 * none of them call, and an excluded rule reports once however many calls it
 * contains, because the rule is what is excluded rather than each call.
 *
 * A call in a custom property declaration is an ordinary call site. Verified
 * in Chromium 151.0.7922.34: `--pad: --space(2)` computes `--pad` to
 * `calc(2 * 10px)`, so the function is substituted at computed-value time and
 * the value is observable at the declaration that calls it.
 */
export function resolveCallSites(root: Root, target: FunctionTarget): CallSiteResolution {
  const { url } = target.source;
  const name = target.functionName;

  const callSites: CallSite[] = [];
  const definitionReferences: DefinitionReference[] = [];
  const diagnostics: Diagnostic[] = [];
  const reported = new Set<Rule>();

  root.walkDecls((declaration) => {
    const parsed = valueParser(declaration.value);
    const calls: FunctionNode[] = [];

    collectCalls(parsed.nodes, name, calls);

    if (calls.length === 0) {
      return;
    }

    const definition = enclosingFunction(declaration);

    if (definition !== undefined) {
      for (const call of calls) {
        definitionReferences.push({
          functionName: functionNameOf(definition.params),
          property: declaration.prop,
          arguments: argumentsOf(call),
          source: locationOf(declaration, url),
        });
      }

      return;
    }

    const parent = declaration.parent;

    if (parent === undefined) {
      return;
    }

    if (parent.type === "atrule") {
      diagnostics.push(
        createDiagnostic("OUTSIDE_SUPPORTED_TARGET_SET", {
          message: descriptorMessage((parent as AtRule).name),
          source: locationOf(declaration, url),
          details: { property: declaration.prop, atRule: (parent as AtRule).name },
        }),
      );

      return;
    }

    if (parent.type !== "rule") {
      return;
    }

    const rule = parent as Rule;
    const placement = placementOf(rule, url);

    if (!placement.probed) {
      if (!reported.has(rule)) {
        reported.add(rule);
        diagnostics.push(...placement.diagnostics);
      }

      return;
    }

    for (const call of calls) {
      callSites.push({
        property: declaration.prop,
        arguments: argumentsOf(call),
        soleContribution: isSoleContribution(parsed.nodes, call),
        selector: placement.selector,
        source: locationOf(rule, url),
      });
    }
  });

  if (callSites.length === 0) {
    diagnostics.push(
      createDiagnostic("NO_CALL_SITES", {
        source: target.source,
        details: { functionName: name, definitionReferences: definitionReferences.length },
      }),
    );
  }

  return { callSites, definitionReferences, diagnostics };
}
