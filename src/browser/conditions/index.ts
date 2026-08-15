/**
 * Condition evaluation.
 *
 * Rule-context compilation (CSSC-011, see
 * ../../core/compiler/rule-context.ts) records the at-rules enclosing a rule
 * verbatim and evaluates none of them, because whether a condition holds is
 * not a property of the stylesheet: it is a property of the browser reading
 * it at the moment it is read. This module is the other half of that split,
 * and it is the first module in the browser layer, so everything below is
 * about what the live engine answers rather than about what the source says.
 *
 * A context is active when every condition it carries holds. Conjunction is
 * the only correct combination, because the entries describe nesting: a rule
 * inside `@media` inside `@supports` applies only where both hold, and CSS
 * offers no way for a nested at-rule to widen the condition around it. An
 * empty context is therefore active, which is the same answer conjunction
 * over no entries gives and the same answer an unconditional rule deserves.
 *
 * `@layer` is skipped rather than evaluated. A layer decides which of two
 * competing declarations wins the cascade; it never decides whether a rule
 * applies at all, so a rule in any layer, named or anonymous, still matches
 * exactly the elements its selector matches (implementation plan §5.10).
 * Treating a layer as a condition would make a probe inside `@layer base`
 * report as though its rule were absent, which is false about every element
 * the selector matches. The entry stays in the context as metadata a record
 * can report, and this module passes over it.
 *
 * Nothing here is cached or memoized, and that is a requirement rather than
 * an omission. `matchMedia(query).matches` reads live state: it changes when
 * the viewport is resized, when the device orientation changes, when the
 * user switches color scheme, and when a print preview opens. A scan reports
 * the world as it is at the moment of the scan, so a cached answer would be
 * a report about a viewport that no longer exists. `CSS.supports()` is
 * stable within a browsing session, but caching only one of the two would
 * make the module's behavior depend on which entry kind a context happens to
 * carry, and the cost being avoided is one engine call per entry per scan.
 *
 * Malformed conditions need no special handling here, which was verified
 * rather than assumed. Read in the browser lane against headless Chromium
 * 151.0.7922.34, the version this project's Vitest browser project runs:
 *
 * - `matchMedia("not a real query").media` returns `"not all"` and
 *   `.matches` returns `false`. Media Queries Level 4 §3.1 requires a
 *   malformed query to be replaced by `not all`, which matches nothing, so
 *   an unparseable condition makes its context inactive rather than
 *   throwing.
 * - `CSS.supports("garbage")` returns `false`. An unparseable supports
 *   condition is simply unsupported.
 *
 * Both answers are the conservative ones a probe wants: a condition this
 * engine cannot parse is a condition this engine cannot be applying. Those
 * values are pinned in test/browser/conditions.test.ts, so a future engine
 * that answers differently fails the lane rather than quietly changing what
 * a probe reports.
 */

import type { RuleContext, RuleContextEntry } from "../../core/compiler/rule-context.ts";

/**
 * True when one context entry holds in this browser right now. A `layer`
 * entry holds vacuously, because it expresses no condition at all; see the
 * module doc comment for why it is not a reason to skip a rule.
 */
function isEntryActive(entry: RuleContextEntry): boolean {
  if (entry.kind === "media") {
    return matchMedia(entry.condition).matches;
  }

  if (entry.kind === "supports") {
    return CSS.supports(entry.condition);
  }

  return true;
}

/**
 * True when every condition enclosing a rule holds in this browser at the
 * moment of the call.
 *
 * The answer is read live on every call and never cached, and a context with
 * no entries is active. See the module doc comment for both, and for why a
 * `@layer` entry can never make the answer `false`.
 */
export function isContextActive(context: RuleContext): boolean {
  return context.entries.every((entry) => isEntryActive(entry));
}
