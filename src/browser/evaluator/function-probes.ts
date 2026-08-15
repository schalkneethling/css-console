/**
 * Function probe evaluation.
 *
 * A function probe annotates an `@function` definition, and a definition has
 * no value: the only place a custom function is observable is where it is
 * called (implementation plan sections 2.1 to 2.3, and 5.6). Call-site
 * resolution found those calls in the source without matching or resolving
 * anything (see ../../core/functions/index.ts). This module is the other half
 * of that split. It takes a compiled function probe, matches each call site
 * against the live document, and reads the resolved value of the property the
 * call was written into.
 *
 * What comes back is evaluation data rather than records. A `FunctionRecord`
 * carries a guard, a timestamp, and a published identity, and CSSC-023 builds
 * it; the parts of it that need a document and nothing else are what this
 * module produces.
 *
 * ## The reported value is the property's, never the function's return value
 *
 * Nothing here reads a return value, because nothing can. A function's result
 * is substituted into a declaration and the destination property's own value
 * resolution runs over the whole declaration before `getComputedStyle()`
 * exposes anything. A function returning `50%` called as the entire value of
 * `width` on an element inside a 300px containing block reports `150px`, which
 * Chromium 151.0.7922.34 confirms and test/browser/function-probes.test.ts
 * pins. `soleContribution` claims only that no other authored expression
 * contributed to that value, and it is computed once, at compile time, and
 * passed through here untouched.
 *
 * ## Matching reuses the branch matcher
 *
 * Each call site is matched by synthesizing one `CompiledProbeBranch` for it
 * and handing that to `matchBranches()` (see ../matcher/index.ts), rather than
 * calling `querySelectorAll()` again. Three properties come with the reuse and
 * would otherwise have to be reimplemented and kept in agreement: document
 * order across the matches, the `UNPARSEABLE_SELECTOR_BRANCH` diagnostic for a
 * selector the engine refuses, and the read-only discipline the matcher
 * documents.
 *
 * The synthesized branch carries `pseudo: null`, which is a claim about the
 * pseudo-element rather than about the selector, and the two come apart. A
 * value probe's selector is split by `splitSelectorBranches()`, which lifts a
 * pseudo-element out into its own field; a call site's selector is the flat
 * selector `resolveProbePlacement()` produced for the rule, and nothing splits
 * it, so a call written inside `.card::before { width: --half(); }` yields a
 * call site whose selector is `.card::before` in full. Passing that to
 * `querySelectorAll()` matches no element in Chromium 151.0.7922.34, and does
 * not throw, so the call site is evaluated against nothing and reports
 * nothing. That is honest rather than ideal, and it is pinned as a test rather
 * than hidden: reporting the originating element's `width` for a call the
 * author wrote on the pseudo-element would report a value the call never
 * produced. Probing a call site on a pseudo-element is the work CSSC-023 and
 * the pseudo-element record contract can take up with the pseudo-element in
 * hand.
 *
 * ## An inactive condition is a skip rather than a fault
 *
 * A call site whose rule context fails `isContextActive()` is skipped
 * entirely: no evaluation, and no diagnostic. A stylesheet written for several
 * viewports has most of its `@media` blocks inactive at any moment, and that
 * is the normal state of responsive CSS rather than something to report. The
 * scan lifecycle counts skipped probes in its summary (CSSC-028), which is
 * where a count belongs; a diagnostic per inactive call site would bury the
 * faults that matter under the ordinary. A skipped call site is absent from
 * the result, which distinguishes it from an active call site that matched no
 * element: that one is present, with an empty evaluation list.
 *
 * ## Reading the value
 *
 * The destination property is read from one `getComputedStyle()` acquisition
 * per element, following the discipline ./index.ts documents: the object is
 * live, so it is neither cached nor held, and one call site reads one property
 * so there are no consecutive reads to protect. The property name goes through
 * `propertyMatchKey()`, the key the compiler, the guard, and
 * `readResolvedValues()` all use, so a standard property name is lowercased
 * while a custom property name is passed through untouched. That distinction
 * is load-bearing here: `--pad: --space(2)` is an ordinary call site, and
 * reading `--pad` under a folded case would read a property the author never
 * declared.
 *
 * `readResolvedValues()` is not reused for the read, because it takes
 * `CompiledProbeProperty` values, which carry an authored value, an
 * importance flag, a source location, and a guard index entry. A call site has
 * none of those: it names a property, not a declaration the compiler
 * indexed. Synthesizing them would put fabricated fields into a shape whose
 * other consumers read them as facts.
 *
 * Nothing here writes to the document, which is the read-only guarantee
 * (implementation plan section 5.9).
 */

import { propertyMatchKey } from "../../core/expansion/index.ts";
import { createDiagnostic } from "../../core/diagnostics/index.ts";
import type { Diagnostic } from "../../core/diagnostics/index.ts";
import type { CompiledCallSite, CompiledFunctionProbe } from "../../core/compiler/index.ts";

import { isContextActive } from "../conditions/index.ts";
import { matchBranches } from "../matcher/index.ts";

/**
 * One element a call site matched, paired with the resolved value of the
 * property the call was written into. The element is the live element rather
 * than a copy of it, matching `BranchMatch`, so a consumer can hand it to a
 * console and have the developer tools highlight it.
 */
export type CallSiteEvaluation = {
  element: Element;
  resolved: string;
};

/**
 * One call site and everything evaluating it produced: the matched elements in
 * document order, each with the value the engine resolved for the call site's
 * property.
 *
 * The call site travels with its evaluations rather than being looked up
 * again, because attribution is per call site: each carries its own composed
 * `probeId`, its own arguments, and its own `soleContribution`, and a function
 * called from three declarations is three separate answers.
 *
 * An empty `evaluations` list means the call site was evaluated and matched no
 * element. A call site skipped for an inactive condition is absent from the
 * result instead; see the module doc comment.
 */
export type EvaluatedCallSite = {
  callSite: CompiledCallSite;
  evaluations: readonly CallSiteEvaluation[];
};

/**
 * The outcome of evaluating one function probe: every call site evaluated, in
 * the order the compiler resolved them, plus the diagnostics evaluation
 * produced.
 *
 * Diagnostics are aggregated across call sites rather than thrown, because a
 * selector the engine refuses is a fact about that one call site and the
 * others are still worth reporting (implementation plan section 5.11).
 */
export type FunctionProbeEvaluation = {
  callSites: readonly EvaluatedCallSite[];
  diagnostics: readonly Diagnostic[];
};

/** The options `evaluateFunctionProbe()` accepts. */
export type FunctionProbeEvaluationOptions = {
  /**
   * The subtree call sites are matched within, defaulting to the document, as
   * `matchBranches()` does.
   */
  root?: ParentNode;

  /**
   * Whether this engine supports custom functions, defaulting to what
   * `supportsCustomFunctions()` answers.
   *
   * Injecting the answer is the only way to run the unsupported path in an
   * engine that has support, and it is not mocking the engine: the value is a
   * boolean this module would otherwise compute for itself, and every value
   * the unsupported path reports still comes from the real document. Test
   * strategy forbids stubbing `getComputedStyle()` (implementation plan
   * section 8.3), and nothing here does.
   */
  supportsFunctions?: boolean;
};

/**
 * True when this browser implements CSS custom functions.
 *
 * The detector reads one global, `CSSFunctionRule`, which is the CSSOM
 * interface for an `@function` rule. An engine that parses `@function` exposes
 * it, and an engine that does not cannot, so its presence answers the question
 * without writing anything to the document. Verified in headless Chromium
 * 151.0.7922.34: the global exists, and a live sheet holding
 * `@function --detected() { result: 1px; }` reports its first rule's
 * constructor as `CSSFunctionRule` rather than `CSSRule`, so the interface
 * belongs to real parsed function rules rather than being a declared but
 * unused name.
 *
 * `CSS.supports()` cannot express at-rule support directly. The proposed
 * `at-rule()` extension can, and Chromium 151.0.7922.34 implements it:
 * `CSS.supports("at-rule(@function)")` and `CSS.supports("at-rule(@media)")`
 * both answer `true`, while `CSS.supports("at-rule(@not-a-real-at-rule)")`
 * answers `false`. It is still the wrong detector, because an engine that has
 * not implemented `at-rule()` answers `false` for every at-rule, including the
 * ones it supports, so a `false` cannot be told apart from a missing
 * `@function`. All three answers are pinned in
 * test/browser/function-probes.test.ts.
 *
 * The global is read through the `in` operator rather than `typeof`, because
 * the browser project compiles with a fixed DOM library and a name the library
 * does not declare is not a compile-time identifier.
 */
export function supportsCustomFunctions(): boolean {
  return "CSSFunctionRule" in globalThis;
}

/**
 * Evaluates one call site against the live document: the matched elements, in
 * document order, each with the resolved value of the call site's destination
 * property.
 */
function evaluateCallSite(
  callSite: CompiledCallSite,
  root: ParentNode | undefined,
): { evaluated: EvaluatedCallSite; diagnostics: readonly Diagnostic[] } {
  const matched = matchBranches(
    [
      {
        authored: callSite.selector,
        selector: callSite.selector,
        pseudo: null,
        probeId: callSite.probeId,
      },
    ],
    root,
  );

  const name = propertyMatchKey(callSite.property);
  const evaluations = matched.matches.map((match) => ({
    element: match.element,
    resolved: getComputedStyle(match.element).getPropertyValue(name),
  }));

  return { evaluated: { callSite, evaluations }, diagnostics: matched.diagnostics };
}

/**
 * Evaluates every active call site of a function probe against the live
 * document.
 *
 * A browser without custom function support evaluates nothing and reports
 * `RESERVED_PENDING_SUPPORT` once, naming the function, at the definition the
 * annotation attached to. That is the code's own case: the specification
 * exists, css-console has designed the contract, and the browser has not
 * shipped support, so there is nothing for the author to fix. Every call site
 * of the probe is in the same position, which is why one diagnostic covers the
 * probe rather than one covering each call.
 *
 * A call site in an inactive condition is skipped silently, a call site the
 * engine cannot match produces the matcher's diagnostic and no evaluations,
 * and neither stops the call sites beside it. See the module doc comment for
 * both.
 */
export function evaluateFunctionProbe(
  probe: CompiledFunctionProbe,
  options: FunctionProbeEvaluationOptions = {},
): FunctionProbeEvaluation {
  const supported = options.supportsFunctions ?? supportsCustomFunctions();

  if (!supported) {
    return {
      callSites: [],
      diagnostics: [
        createDiagnostic("RESERVED_PENDING_SUPPORT", {
          source: probe.definition,
          details: { functionName: probe.functionName, callSites: probe.callSites.length },
        }),
      ],
    };
  }

  const callSites: EvaluatedCallSite[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const callSite of probe.callSites) {
    if (!isContextActive(callSite.context)) {
      continue;
    }

    const outcome = evaluateCallSite(callSite, options.root);

    callSites.push(outcome.evaluated);
    diagnostics.push(...outcome.diagnostics);
  }

  return { callSites, diagnostics };
}
