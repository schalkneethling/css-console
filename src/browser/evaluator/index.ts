/**
 * Resolved value reading.
 *
 * The compiler records what a stylesheet says and resolves nothing, because a
 * resolved value is not a property of the source: it is what the engine
 * produces for one element, in one document, at one moment. This module is
 * where the two meet. It pairs each property a probe compiled with the value
 * the live engine reports for it, and it is the only place in the pipeline
 * that calls `getComputedStyle()` for a value probe.
 *
 * One acquisition serves one element and pseudo-element pair. The object
 * `getComputedStyle()` returns is live, so caching it caches nothing: it is a
 * view onto the element rather than a snapshot of it, and a later read through
 * a held object reports the state at the time of that read. Verified in the
 * browser lane against headless Chromium 151.0.7922.34, the version this
 * project's Vitest browser project runs: a declaration read before setting
 * `element.style.color` reports the old color, and the same object read after
 * reports the new one. Two consequences follow, and both are requirements
 * rather than preferences:
 *
 * - Nothing may be cached across calls, because a cached declaration is not a
 *   record of an earlier scan; it is an unlabeled window onto the present.
 * - Every property of one pair is read consecutively, with no DOM access
 *   between the reads, so that the reported values describe one moment. A read
 *   that forces layout, or any code that could mutate the document, placed
 *   between two reads would let the first value and the second value describe
 *   different documents.
 *
 * Writing mode and direction are read from the same declaration and returned
 * beside the values, because the guard resolves a logical property to the
 * physical one it addresses (see ../../core/expansion/index.ts), and that
 * resolution needs the flow of the box the values came from. Reading them
 * separately would mean a second acquisition, and the flow facts would then
 * describe a moment the values do not.
 *
 * Nothing here writes to the document, which is the read-only guarantee
 * (implementation plan section 5.9). `getComputedStyle()` and
 * `getPropertyValue()` are both reads.
 *
 * Failure has no code path, and that is deliberate. The engine answers every
 * question asked of it: a property it does not recognize, a custom property
 * nobody declared, and a pseudo-element that generates no box all produce a
 * string rather than an exception. Verified against Chromium 151.0.7922.34
 * and pinned in test/browser/evaluator.test.ts:
 *
 * - `getPropertyValue("not-a-property")` returns the empty string.
 * - `getPropertyValue("--never-declared")` returns the empty string, and so
 *   does a custom property declared with an empty value. The record carries
 *   the empty string as it stands, because that is what the engine computed;
 *   substituting a placeholder would report a value no stylesheet contains.
 *   The distinction between the two is observable through enumeration rather
 *   than through a value: a custom property declared empty appears among the
 *   declaration's property names, and one never declared does not.
 * - A pseudo-element whose `content` computes to `none` generates no box, and
 *   its declaration still reports computed values (implementation plan section
 *   5.8). A length that needs a box to resolve, such as a percentage width,
 *   stays at its computed percentage. `::placeholder` is the one exception
 *   among the eight supported pseudo-elements: when the element has no
 *   placeholder, the reading silently degrades to the originating element's
 *   own declaration, so the reported values are the element's rather than
 *   anything a `::placeholder` rule wrote. The other seven report their own
 *   cascaded style whether or not a box is generated.
 *
 * Function probe evaluation is the other half of this module and lives in
 * ./function-probes.ts, re-exported here so that the evaluator presents one
 * entry point, matching how the compiler presents its own multi-file module. A
 * call site reads one property from one element, and it needs no authored
 * value, no guard entry, and no flow facts, so it reads its own value rather
 * than routing through `readResolvedValues()`; that module records why.
 *
 * The `display: none` fallback is the same behavior seen from another angle,
 * and it needs no code here either. Resolved values fall back to computed
 * values for an element with no box, which Chromium 151.0.7922.34 confirms:
 * `width: auto` on a rendered element inside a 300px parent reports `300px`,
 * while the same declaration under `display: none` reports `auto`, and a
 * percentage width reports the percentage rather than resolving against
 * anything. The fallback belongs to the engine, so this module reports it
 * rather than implementing it.
 */

export { evaluateFunctionProbe, supportsCustomFunctions } from "./function-probes.ts";
export type {
  CallSiteEvaluation,
  EvaluatedCallSite,
  FunctionProbeEvaluation,
  FunctionProbeEvaluationOptions,
} from "./function-probes.ts";

import { DIRECTIONS, WRITING_MODES, propertyMatchKey } from "../../core/expansion/index.ts";
import type { Direction, WritingMode } from "../../core/expansion/index.ts";
import type { CompiledProbeProperty } from "../../core/compiler/index.ts";

/**
 * One property a probe covers, as authored and as resolved. This is
 * `ProbeValue` (implementation plan section 3.5) without its guard, which
 * CSSC-021 supplies: the guard needs competitors from the whole document,
 * while these three fields need only the declaration this module already
 * holds, so reading and guarding are separate passes over the same property.
 */
export type EvaluatedValue = {
  name: string;
  authored: string;
  resolved: string;
};

/**
 * Everything one acquisition produced: the requested values, in requested
 * order, plus the flow of the box they were read from.
 *
 * Requested order is part of the contract rather than an accident of the
 * implementation, because an author listing properties in an annotation
 * expects to read them back in that order (implementation plan section 3.5).
 *
 * `writingMode` and `direction` describe the element and pseudo-element pair
 * the values came from, so a pseudo-element that establishes its own flow
 * reports its own, matching the values beside it.
 */
export type ValueReading = {
  values: readonly EvaluatedValue[];
  writingMode: WritingMode;
  direction: Direction;
};

/**
 * The computed writing mode as one of the five the logical tables resolve
 * against, falling back to the initial value.
 *
 * The fallback is unreachable in Chromium 151.0.7922.34, and the test suite
 * carries the evidence: each of the five reports itself, and `tb-rl`, the
 * deprecated pre-standard spelling, computes to `vertical-rl` rather than
 * reporting a sixth value. The narrowing exists because the return type is
 * the table's own type, and `horizontal-tb` is the initial value of
 * `writing-mode`, so an engine reporting something unheard of is treated as
 * an engine reporting no writing mode at all rather than crashing a scan.
 */
function asWritingMode(computed: string): WritingMode {
  return WRITING_MODES.find((mode) => mode === computed) ?? "horizontal-tb";
}

/**
 * The computed direction as one of the two the logical tables resolve
 * against, falling back to `ltr`, the initial value of `direction`. The
 * fallback is unreachable for the same reason `asWritingMode()` describes.
 */
function asDirection(computed: string): Direction {
  return DIRECTIONS.find((candidate) => candidate === computed) ?? "ltr";
}

/**
 * Reads the resolved value of every requested property from one element and
 * pseudo-element pair, together with the flow of that pair.
 *
 * `pseudo` is the pseudo-element the matched branch carried, or `null` for an
 * ordinary probe, and it reaches `getComputedStyle()` as its second argument
 * (implementation plan section 5.8). The matcher never passes a pseudo-element
 * to `querySelectorAll()`, so the pair arrives here split exactly this way.
 *
 * A standard property name is lowercased before the read and a custom property
 * name is passed through untouched, both through `propertyMatchKey()`, the key
 * the compiler and the guard already use. Sharing the key is the point:
 * standard property names are ASCII case-insensitive while custom property
 * names are not, so folding `--Brand` into `--brand` would read a property the
 * author never declared. Chromium 151.0.7922.34 agrees on both halves, which
 * the tests pin: `getPropertyValue("WIDTH")` answers the same as
 * `getPropertyValue("width")`, and `getPropertyValue("--BRAND")` answers the
 * empty string where `--Brand` is declared.
 *
 * The reported `name` is the authored spelling rather than the key, so a
 * record shows the property as the stylesheet wrote it.
 *
 * See the module doc comment for why the declaration is acquired once, read
 * consecutively, and never held.
 */
export function readResolvedValues(
  element: Element,
  pseudo: string | null,
  properties: readonly CompiledProbeProperty[],
): ValueReading {
  const declaration = getComputedStyle(element, pseudo);

  // Every read below happens against this one declaration, consecutively.
  // Nothing between them touches the DOM.
  const values = properties.map((property) => ({
    name: property.name,
    authored: property.authored,
    resolved: declaration.getPropertyValue(propertyMatchKey(property.name)),
  }));
  const writingMode = declaration.getPropertyValue("writing-mode");
  const direction = declaration.getPropertyValue("direction");

  return {
    values,
    writingMode: asWritingMode(writingMode),
    direction: asDirection(direction),
  };
}
