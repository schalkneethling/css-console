/**
 * Probe placement.
 *
 * Two different passes ask the same question about a style rule before they
 * touch anything inside it: can this release honestly probe it, and with what
 * flat selector. Call-site resolution asks it of the rule a custom function is
 * called from, and the guard index asks it of every rule in the source. The
 * answer is the composition of two modules that already exist, and the order
 * they run in is a decision rather than a detail, so it is made once here
 * rather than twice in two places that agree today.
 *
 * Rule-context compilation runs first, because a rule inside `@container`,
 * `@keyframes`, `@scope`, or `@starting-style` is excluded for a reason that
 * has nothing to do with its selector, and reporting that reason is more
 * useful than reporting that the selector could not be flattened. Nesting
 * resolution runs second and supplies the flat selector, which is why both
 * callers are ordered after it.
 */

import type { Rule } from "postcss";

import type { Diagnostic } from "../diagnostics/index.ts";
import { resolveNestedSelector } from "../nesting/index.ts";

import { compileRuleContext } from "./rule-context.ts";
import type { RuleContext } from "./rule-context.ts";

/**
 * Where a rule sits: somewhere this release can honestly probe, with the flat
 * selector and the conditions that came out of resolving it, or nowhere it
 * can, with the diagnostics that say why.
 *
 * The diagnostics travel with the negative case rather than being thrown, so
 * that a caller which reports exclusions and a caller which silently skips
 * them can both use one function.
 */
export type ProbePlacement =
  | { probed: true; selector: string; context: RuleContext; rule: Rule }
  | { probed: false; diagnostics: readonly Diagnostic[] };

/**
 * Decides whether a rule can be probed, and with what flat selector and
 * context. See the module doc comment for why the two resolution passes run
 * in this order.
 */
export function resolveProbePlacement(rule: Rule, url: string): ProbePlacement {
  const context = compileRuleContext(rule, url);

  if (context.context === null) {
    return { probed: false, diagnostics: context.diagnostics };
  }

  const nesting = resolveNestedSelector(rule, url);

  if (nesting.selector === null) {
    return { probed: false, diagnostics: nesting.diagnostics };
  }

  return { probed: true, selector: nesting.selector, context: context.context, rule };
}
