/**
 * Contested guard evaluation.
 *
 * The guard (implementation plan, section 3.4) exists so the tool never
 * presents a value as though the annotated source produced it when something
 * else may have. It answers one boolean per probed property and element, and
 * it hands the author a live element as the remediation. What it refuses to
 * do is as much a part of the contract as what it does: it does not rank
 * competitors, count them, or locate them, and it performs no specificity,
 * layer, or document-order comparison anywhere, because any of those would
 * be a claim about the cascade, and a partially correct claim is worse than
 * a handoff (docs/decisions/0004-guard-as-guard-not-cascade-feature.md).
 *
 * Five reasons exist, and each is a distinct observable fact rather than a
 * ranking of the others. Reasons accumulate: an important competing
 * declaration fires both `competing-declaration` and `important`, because a
 * competitor existing and a competitor carrying `!important` are two facts,
 * and suppressing either would hide one of them. The reasons array lists
 * whichever fired in the order the `GuardReason` union declares them, an
 * order that carries no meaning beyond determinism.
 *
 * Everything here is a read. `matches()`, `getComputedStyle()`,
 * `getPropertyValue()`, `getAnimations()`, and `getKeyframes()` observe the
 * document without touching it, which is the read-only guarantee
 * (implementation plan section 5.9), and the browser suite asserts markup
 * equality across an evaluation.
 *
 * ## Recorded false negatives
 *
 * Three misses are known, accepted for this release, and recorded here so
 * they are read as decisions rather than discovered as defects:
 *
 * - A competitor inside `@container`, `@scope`, or `@starting-style` is
 *   absent from the guard index by construction, because those at-rules
 *   cannot be honestly probed (see ../../core/compiler/guard-index.ts), so
 *   `guardCandidates()` answers "nothing competes" with no way for this
 *   module to detect the miss.
 * - A keyframes animation on a custom property is invisible, because
 *   `getKeyframes()` in Chromium 151.0.7922.34 omits custom properties from
 *   the keyframe objects it returns. Registration does not change this: a
 *   property registered through `@property` with a color syntax animates as
 *   a typed interpolation, and its keyframes still surface no trace of it,
 *   so the gap is in the `getKeyframes()` serialization rather than in how
 *   the property animates. The browser suite pins both halves.
 * - A candidate whose selector the engine refuses to parse is skipped,
 *   because `matches()` throws a `SyntaxError` `DOMException` on it
 *   (Chromium 151.0.7922.34, pinned in the browser suite), and a selector
 *   the engine cannot evaluate is a selector the engine cannot be applying;
 *   the skip mirrors how condition evaluation treats a query the engine
 *   cannot parse.
 *
 * One scope decision borders the false negatives without being one: a
 * `var()` reference whose variable is set clears `unresolved-variable` even
 * when the set value is invalid for the destination, because the reason is
 * about references that fail, and validating every resolved value would be a
 * different feature with a different name.
 */

import {
  competesInWritingMode,
  guardCandidates,
  propertiesCompete,
  splitSelectorBranches,
} from "../../core/compiler/index.ts";
import type {
  CustomPropertyReference,
  GuardIndex,
  IndexedDeclaration,
} from "../../core/compiler/index.ts";
import type { Direction, WritingMode } from "../../core/expansion/index.ts";
import type { GuardReason, ValueGuard } from "../../core/records/index.ts";

import { isContextActive } from "../conditions/index.ts";

/**
 * The probed declaration as the guard actually consumes it: the fields the
 * five reasons read, and nothing else.
 *
 * This type exists so that the guard's dependencies are explicit rather than
 * inherited. The guard historically took `CompiledProbeProperty`, which also
 * carries a source location the guard never reads, and which only a value
 * probe can produce; a function record needs the same guard for its call
 * site's destination property, and a call site is not a compiled property.
 * `CompiledProbeProperty` satisfies this shape structurally, so a value
 * probe's property passes through unchanged, while a call site constructs
 * the subject explicitly and documents the fields it cannot honestly fill.
 *
 * - `name` is the property the reasons compete against.
 * - `authored` is the declaration's value as written, which the
 *   unresolved-variable reason substitutes references into. A caller that
 *   did not retain the authored value passes the empty string, and the
 *   reason then never fires, because `customProperties` gates the check.
 * - `customProperties` lists the `var()` references the authored value
 *   contains, and an empty list disables the unresolved-variable reason.
 * - `indexed` is the declaration's own guard index entry, which excludes the
 *   declaration from its own competitors, or `null` when the index holds no
 *   entry for it.
 */
export type GuardSubject = {
  name: string;
  authored: string;
  customProperties: readonly CustomPropertyReference[];
  indexed: IndexedDeclaration | null;
};

/**
 * Everything one guard evaluation consumes: the element the value was read
 * from, the guard subject carrying the probed declaration's authored value,
 * importance, custom property references, and its own index entry, the guard
 * index over the property's source, and the flow facts of the box the value
 * came from.
 *
 * `writingMode` and `direction` come from `readResolvedValues()` on the same
 * element, so the logical resolution the competition test performs describes
 * the box the reported values describe (implementation plan section 5.7).
 */
export type GuardEvaluation = {
  element: Element;
  /**
   * The pseudo-element the probed values were read from, or `null` for the
   * element itself. The unresolved-variable reason resolves references
   * against `getComputedStyle(element, pseudo)`, because custom properties
   * cascade per element and pseudo-element pair: a `--tone` declared only in
   * a `::before` rule resolves for the pseudo-element and is absent from the
   * originating element, so reading the element would fail a reference the
   * engine resolved.
   */
  pseudo: string | null;
  property: GuardSubject;
  index: GuardIndex;
  writingMode: WritingMode;
  direction: Direction;
};

/**
 * Whether an element matches a candidate's selector. The selector is the
 * flat selector list nesting resolution produced, and `matches()` accepts a
 * selector list, answering true when any branch matches; Chromium
 * 151.0.7922.34 confirms both halves, pinned in the browser suite. A
 * selector the engine refuses to parse makes `matches()` throw a
 * `SyntaxError` `DOMException`, and the catch turns that into "cannot be
 * shown to compete"; see the module doc comment for why the skip is the
 * honest answer.
 */
function selectorMatches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

/**
 * The placeholder location branch splitting requires. The diagnostics the
 * split produces alongside its branches are discarded here, because the
 * candidate's rule already compiled and any selector defect was reported
 * then, so the location never reaches an author.
 */
const CANDIDATE_SOURCE = {
  url: "about:guard-candidate",
  start: { line: 1, column: 1 },
  end: { line: 1, column: 1 },
} as const;

/**
 * Whether a candidate's selector addresses the probed box: the element and
 * pseudo-element pair the reported values were read from.
 *
 * `Element.matches()` answers false for any selector carrying a
 * pseudo-element, however well the originating selector fits, because a
 * pseudo-element's box is a box no element is (pinned in the browser suite
 * against headless Chromium 151.0.7922.34). So the candidate's selector list
 * is split into branches exactly as a probe's own selector is, and a branch
 * competes when it names the probed pseudo-element, or none for an element
 * probe, and its originating selector matches the element.
 *
 * The box alignment cuts both ways. A rule on `.card` cannot be responsible
 * for a value a `.card::before` rule produced, because the element's
 * declaration reaches the pseudo-element's box only through inheritance,
 * which every directly declared value beats. And a rule on `.other::before`
 * competes with a probed `.card::before` on an element carrying both
 * classes, even though `matches()` alone would never see it.
 *
 * A selector list the split discards entirely, because one of its branches
 * is empty, is a rule the engine dropped as a whole, so it competes with
 * nothing; a deferred branch inside an otherwise valid list is dropped from
 * the comparison while its siblings still compete, matching how the compiler
 * treats the probe's own list.
 */
function candidateAddressesBox(element: Element, pseudo: string | null, selector: string): boolean {
  const { branches } = splitSelectorBranches(selector, CANDIDATE_SOURCE);

  return branches.some(
    (branch) => branch.pseudo === pseudo && selectorMatches(element, branch.selector),
  );
}

/**
 * The two facts one pass over the guard candidates establishes: whether any
 * candidate competes, and whether a competing candidate carries `!important`.
 *
 * A candidate competes when all three of its gates pass: its rule context is
 * active in this browser right now (a competitor inside an inactive `@media`
 * never applied), its selector addresses the probed box (a competitor
 * elsewhere in the document, or on another box of this element, competes
 * with nothing here; see `candidateAddressesBox()`), and its property
 * touches a longhand in common with the probed property under this
 * element's flow.
 * The gates are facts about the candidate, never comparisons between
 * candidates, and the pass stops as soon as both answers are known: one
 * competitor fires the reason, and nothing counts beyond that.
 *
 * The candidate set excludes the probed declaration itself through its index
 * entry, and nothing else. A second declaration of the same property in the
 * same rule is a distinct entry and still competes, because the twin is a
 * real competitor whichever of the two the probe reports.
 */
function competingFacts(evaluation: GuardEvaluation): { competing: boolean; important: boolean } {
  const { element, pseudo, property, index, writingMode, direction } = evaluation;
  const candidates = guardCandidates(index, property.name, property.indexed ?? undefined);

  let competing = false;
  let important = false;

  for (const candidate of candidates) {
    if (!isContextActive(candidate.context)) {
      continue;
    }

    if (!candidateAddressesBox(element, pseudo, candidate.selector)) {
      continue;
    }

    if (!competesInWritingMode(candidate, property.name, writingMode, direction)) {
      continue;
    }

    competing = true;

    if (candidate.important) {
      important = true;
      break;
    }
  }

  return { competing, important };
}

/**
 * Whether the element's style attribute declares the probed property or a
 * property that resets it, and whether that inline declaration carries
 * `!important`.
 *
 * A pseudo-element probe never fires this reason, because a style attribute
 * declares on the element's own box and no inline syntax can address a
 * pseudo-element, so an inline declaration cannot be responsible for a value
 * a pseudo-element rule produced.
 *
 * The priority is read through `getPropertyPriority()`, which answers
 * `"important"` for an inline `!important` in Chromium 151.0.7922.34, pinned
 * in the browser suite. An inline shorthand set with `!important` reports
 * the priority on each enumerated longhand, so the fact survives the
 * shorthand expansion the enumeration performs.
 *
 * `element.style` is a read: the `CSSStyleDeclaration` reflects the style
 * attribute without parsing it here, and an element with no inline style
 * enumerates zero items. A shorthand set inline enumerates as its terminal
 * longhands in Chromium 151.0.7922.34, pinned in the browser suite, so
 * `margin: 0` arrives as the four margin longhands and the competition test
 * sees `margin-left` directly; the test would also accept the shorthand name
 * itself, so an engine that enumerates the other way still fires. A custom
 * property enumerates under its own name and compares literally, which is
 * what `propertiesCompete()` does for a pair of custom property names.
 *
 * An element with no `style` property at all, which `Element` permits even
 * though every HTML and SVG element carries one, declares nothing inline.
 */
function declaresInline(evaluation: GuardEvaluation): { declares: boolean; important: boolean } {
  const { element, pseudo, property, writingMode, direction } = evaluation;
  const style = (element as Element & { style?: unknown }).style;

  if (pseudo !== null || !(style instanceof CSSStyleDeclaration)) {
    return { declares: false, important: false };
  }

  let declares = false;
  let important = false;

  for (let index = 0; index < style.length; index += 1) {
    const name = style.item(index);

    if (!propertiesCompete(name, property.name, writingMode, direction)) {
      continue;
    }

    declares = true;

    if (style.getPropertyPriority(name) === "important") {
      important = true;
      break;
    }
  }

  return { declares, important };
}

/**
 * The keyframe keys that describe the keyframe rather than a property it
 * animates, per the Web Animations `ComputedKeyframe` shape.
 */
const KEYFRAME_METADATA_KEYS: ReadonlySet<string> = new Set([
  "offset",
  "computedOffset",
  "easing",
  "composite",
]);

/**
 * The CSS property name a keyframe key addresses. `getKeyframes()` reports
 * camel-case IDL attribute names in Chromium 151.0.7922.34, pinned in the
 * browser suite, so `margin-left` arrives as `marginLeft`. The two names
 * whose IDL form is not a straight camel-casing are mapped explicitly:
 * `cssFloat` is the `float` property and `cssOffset` is the `offset`
 * property, both renamed in IDL because their plain names were taken.
 */
function keyframePropertyName(key: string): string {
  if (key.startsWith("--")) {
    return key;
  }

  if (key === "cssFloat") {
    return "float";
  }

  if (key === "cssOffset") {
    return "offset";
  }

  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * Whether a transition or an animation is currently animating the probed
 * property on this element.
 *
 * `getAnimations()` returns the element's relevant animations, transitions
 * included: Chromium 151.0.7922.34 returns a `CSSTransition` for a running
 * transition and a `CSSAnimation` for a running keyframes animation, both
 * pinned in the browser suite. No `playState` filter narrows the answer,
 * because an animation the method returns is current or in effect, and a
 * paused animation still applies its effect to the reported value.
 *
 * A transition identifies its property directly: `transitionProperty` names
 * the transitioned longhand, and `transition: all` reports the longhand
 * actually transitioning rather than `all` (pinned). An animation names no
 * properties on itself, so its keyframes are inspected through
 * `animation.effect.getKeyframes()`, whose keyframe objects carry one key
 * per animated property beside the four keyframe-descriptive keys. Either
 * way the identified name meets the probed property in the same competition
 * test the guard index uses, so a transition on `margin` competes with a
 * probed `margin-left` exactly as a declaration would.
 */
function animatesProperty(evaluation: GuardEvaluation): boolean {
  const { element, pseudo, property, writingMode, direction } = evaluation;

  for (const animation of element.getAnimations({ subtree: true })) {
    const effect = animation.effect;

    if (!(effect instanceof KeyframeEffect)) {
      continue;
    }

    // The subtree call is the only form that reports pseudo-element
    // animations (pinned in the browser suite), and it also reports the
    // descendants' animations, so the effect is filtered to the probed box:
    // this element, under the probed pseudo-element or none.
    if (effect.target !== element || (effect.pseudoElement ?? null) !== pseudo) {
      continue;
    }

    if (animation instanceof CSSTransition) {
      if (propertiesCompete(animation.transitionProperty, property.name, writingMode, direction)) {
        return true;
      }

      continue;
    }

    for (const keyframe of effect.getKeyframes()) {
      for (const key of Object.keys(keyframe)) {
        if (KEYFRAME_METADATA_KEYS.has(key)) {
          continue;
        }

        if (propertiesCompete(keyframePropertyName(key), property.name, writingMode, direction)) {
          return true;
        }
      }
    }
  }

  return false;
}

/** The outcome of substituting every `var()` reference in a value. */
type Substitution = { ok: true; value: string; usedFallback: boolean } | { ok: false };

/** The index after a quoted string starting at `start`, escapes respected. */
function skipQuoted(text: string, start: number): number {
  const quote = text[start];

  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
      continue;
    }

    if (text[index] === quote) {
      return index + 1;
    }
  }

  return text.length;
}

/**
 * The index of the parenthesis closing the group that opens just before
 * `start`, or -1 when the group never closes. Quoted strings are skipped, so
 * a parenthesis inside a string does not count.
 */
function matchingParen(text: string, start: number): number {
  let depth = 1;
  let index = start;

  while (index < text.length) {
    const character = text[index];

    if (character === '"' || character === "'") {
      index = skipQuoted(text, index);
      continue;
    }

    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }

    index += 1;
  }

  return -1;
}

/**
 * The index of the first comma at the top nesting level of a reference's
 * arguments, or -1 when none exists: the boundary between the custom
 * property name and its fallback.
 */
function topLevelComma(text: string): number {
  let depth = 0;
  let index = 0;

  while (index < text.length) {
    const character = text[index];

    if (character === '"' || character === "'") {
      index = skipQuoted(text, index);
      continue;
    }

    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      return index;
    }

    index += 1;
  }

  return -1;
}

/** True when a `var(` at `index` opens a reference rather than ending a longer name. */
function isReferenceBoundary(text: string, index: number): boolean {
  if (index === 0) {
    return true;
  }

  return !/[\w-]/.test(text[index - 1] ?? "");
}

/**
 * Substitutes every `var()` reference in a value against one element's
 * computed custom properties, the algorithm the specification's
 * computed-value-time behavior implies:
 *
 * 1. For each reference, read the custom property from the element. A
 *    non-empty value substitutes and the fallback is never consulted, so a
 *    failing reference inside an unconsulted fallback cannot fail the
 *    declaration.
 * 2. An empty value with no fallback fails the substitution, and the whole
 *    declaration with it.
 * 3. An empty value with a fallback substitutes the fallback, itself
 *    resolved recursively by the same three steps, so a nested chain fails
 *    only when every branch actually taken fails.
 *
 * `usedFallback` reports whether any fallback was consulted, because
 * validity checking applies exactly then: a value that substituted only set
 * variables carries whatever the variables held, while a consulted fallback
 * is authored text whose validity for the destination is the plan's
 * fallback-validity question (implementation plan section 3.4).
 *
 * Quoted strings are skipped wherever text is scanned, so `var(` inside a
 * string is authored text, matching the compiler's own reference extraction.
 * The `var(` comparison folds ASCII case, because CSS function names are
 * case-insensitive and the compiler's scanner carries the `i` flag, so
 * `VAR(--x)` is the same reference under both scanners and in the engine.
 * The boundary check likewise matches the compiler's: a dashed function
 * name ending in `var` is a call, never a reference.
 */
function substituteReferences(text: string, lookup: (name: string) => string): Substitution {
  let result = "";
  let usedFallback = false;
  let index = 0;

  while (index < text.length) {
    const character = text[index];

    if (character === '"' || character === "'") {
      const end = skipQuoted(text, index);

      result += text.slice(index, end);
      index = end;
      continue;
    }

    if (text.slice(index, index + 4).toLowerCase() === "var(" && isReferenceBoundary(text, index)) {
      const argsStart = index + 4;
      const argsEnd = matchingParen(text, argsStart);

      if (argsEnd === -1) {
        // An unbalanced reference never compiled as one; keep the text.
        result += text.slice(index);
        break;
      }

      const args = text.slice(argsStart, argsEnd);
      const comma = topLevelComma(args);
      const name = (comma === -1 ? args : args.slice(0, comma)).trim();
      const value = lookup(name);

      if (value !== "") {
        result += value;
      } else if (comma === -1) {
        return { ok: false };
      } else {
        const fallback = substituteReferences(args.slice(comma + 1).trim(), lookup);

        if (!fallback.ok) {
          return { ok: false };
        }

        usedFallback = true;
        result += fallback.value;
      }

      index = argsEnd + 1;
      continue;
    }

    result += character;
    index += 1;
  }

  return { ok: true, value: result, usedFallback };
}

/**
 * Whether the probed declaration's `var()` references leave it invalid at
 * computed-value time, the exact semantics of implementation plan section
 * 3.4: a reference fails when its variable is empty and no consulted
 * fallback saves it, and a fallback saves the declaration only when the
 * value after substitution is valid for the destination property.
 *
 * Validity is asked of the whole substituted value with `CSS.supports()`,
 * and only when a fallback was consulted, for two verified reasons. Asking
 * about the authored text would answer nothing, because Chromium
 * 151.0.7922.34 reports any declaration containing `var()` as supported
 * (pinned in the browser suite), so substitution has to come first. And a
 * set variable clears the reason without a validity check, because the
 * reason is about references that fail, not about values that disappoint;
 * the module doc comment records that scope decision.
 *
 * A custom property destination skips the validity check, because
 * `CSS.supports()` answers true for any value on a custom-property
 * destination in Chromium 151.0.7922.34 (pinned), which restates the
 * specification: a custom property accepts nearly any token stream, so a
 * consulted fallback cannot be invalid for it.
 *
 * The compiled reference list gates the whole check: a value without
 * references needs no acquisition and cannot fire. The substitution then
 * walks the authored value rather than the flat reference list, because the
 * list includes references inside fallbacks that resolution may never
 * consult, and a never-consulted reference must not fail a declaration the
 * engine resolved.
 */
function hasUnresolvedVariable(evaluation: GuardEvaluation): boolean {
  const { element, pseudo, property } = evaluation;

  if (property.customProperties.length === 0) {
    return false;
  }

  const declaration = getComputedStyle(element, pseudo);
  const substitution = substituteReferences(property.authored, (name) =>
    declaration.getPropertyValue(name),
  );

  if (!substitution.ok) {
    return true;
  }

  if (!substitution.usedFallback) {
    return false;
  }

  if (property.name.startsWith("--")) {
    return false;
  }

  return !CSS.supports(property.name, substitution.value);
}

/**
 * Evaluates the contested guard for one probed property on one element,
 * producing the `ValueGuard` the property's record publishes.
 *
 * `contested` is true exactly when at least one reason fired, and the
 * reasons are facts, never rankings; the module doc comment carries the
 * contract, the accumulation rule, and the recorded false negatives.
 */
export function evaluateGuard(evaluation: GuardEvaluation): ValueGuard {
  const reasons: GuardReason[] = [];
  const { competing, important } = competingFacts(evaluation);
  const inline = declaresInline(evaluation);

  if (competing) {
    reasons.push("competing-declaration");
  }

  if (inline.declares) {
    reasons.push("inline-style");
  }

  if (important || inline.important) {
    reasons.push("important");
  }

  if (animatesProperty(evaluation)) {
    reasons.push("animation-or-transition");
  }

  if (hasUnresolvedVariable(evaluation)) {
    reasons.push("unresolved-variable");
  }

  return { contested: reasons.length > 0, reasons };
}
