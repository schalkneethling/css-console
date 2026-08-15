/**
 * The guard index.
 *
 * The guard (implementation plan, section 3.4) exists so the tool never
 * presents a value as though the annotated source produced it when something
 * else may have. It answers one boolean and hands the author a live element;
 * it does not resolve the cascade, rank declarations, or name a winner. This
 * module is the index behind the `competing-declaration` half of that
 * boolean: given a probed property, does anything *else* in the source
 * declare it.
 *
 * What the index stores is bounded by that one question, and the bound is
 * enforced rather than described. An `IndexedDeclaration` carries three
 * fields:
 *
 * - `property`, the authored spelling, because deciding whether two
 *   declarations touch the same longhand needs the name and nothing else;
 * - `selector`, the flat selector nesting resolution produced, because a
 *   declaration competes only on the elements its rule matches, and that
 *   check happens per element in the browser layer;
 * - `context`, the rule context verbatim, because a declaration inside an
 *   inactive `@media` or `@supports` never applied and must not count
 *   (CSSC-017 evaluates the conditions; this module only carries them).
 *
 * Nothing else is stored, and each omission is a decision. No source
 * location: the guard reports that something competes, never where it is, so
 * a location here would be data with no consumer and an invitation to start
 * presenting competitors. No count: `contested` is a boolean, and the number
 * of competitors is exactly the fact section 3.4 refuses to imply meaning
 * from. No rank: candidates come back as a `Set` with no rank attached,
 * because the guard performs no specificity, layer, or document-order
 * comparison anywhere. (A `Set` still iterates in insertion order; the claim
 * is that no meaning is attached to it.) No importance and no authored value: `important` is
 * its own guard reason, evaluated against the element rather than the index,
 * and the authored value belongs to the compiled probe that carries it.
 *
 * A `@layer` entry does ride along inside `context`, because that is what
 * `compileRuleContext()` returns as one unit. It is never read here and never
 * compared: the alternative was for this module to decide for itself which
 * context entries count as conditions, which is CSSC-017's decision to make,
 * and a second, subtly different notion of a rule context is exactly the kind
 * of quiet divergence this project keeps paying for.
 *
 * ## Keying, and why the keys are terminal longhands
 *
 * Every declaration is keyed under the terminal longhands it touches, so a
 * lookup is exact rather than approximate. `margin: 1rem` is keyed under the
 * four physical margin longhands and not under `margin` itself; `margin-left:
 * 1px` is keyed under `margin-left` alone. A probe computes the same key set
 * for its own property and takes the union of those buckets, which is why
 * `margin` finds `margin-left`, `margin-left` finds `margin`, and
 * `margin-left` does *not* find `margin-right` even though both belong to the
 * same shorthand. Keying under the shorthand name as well would collapse that
 * last distinction and report a competitor that cannot exist.
 *
 * The key set comes from `expandProperty()` with the names that are
 * themselves shorthands filtered out, since the expansion tables list
 * terminal physical longhands, and `propertyMatchKey()` supplies the key,
 * because the compiler and the guard must key property names identically.
 * Neither is reimplemented here. A custom property, an unrecognized standard
 * property, and a vendor-prefixed property each key under themselves, which
 * preserves the literal match the expansion module deliberately falls back
 * to.
 *
 * `all` cannot be keyed this way at all: it resets every standard property
 * that exists rather than a fixed, enumerable family. It therefore lives in
 * its own bucket, and a probe pulls that bucket in when `isResetByAll()` says
 * the probed property is one `all` resets. That predicate already encodes the
 * three exclusions the specification names, `direction`, `unicode-bidi`, and
 * custom properties, and it was verified in a browser rather than recalled.
 *
 * ## Logical declarations defer to per-element resolution
 *
 * A `margin-inline-start` declaration competes with `margin-left` in some
 * writing modes and with `margin-right` in others, and the writing mode is a
 * property of the element, not of the source. Verified in Chromium rather
 * than reasoned about: for `#a { margin-left: 10px; margin-inline-start:
 * 20px }`, an element in `horizontal-tb` `ltr` computes `margin-left: 20px`,
 * so the logical declaration overrode the physical one, while the same rule
 * on an element in `rtl` computes `margin-left: 10px` and `margin-right:
 * 20px`, so it competed with neither the same property nor the same
 * declaration. The same check on `#f { inline-size: 50px; width: 70px }`
 * gives `width: 70px` in `horizontal-tb`, where the two declarations
 * competed, and `width: 70px; height: 50px` in `vertical-rl`, where they did
 * not.
 *
 * So a logical declaration cannot be keyed under a physical name here, and
 * eagerly resolving one would encode a writing mode the source never chose.
 * The expansion module faced this and answered it by publishing a resolver
 * function instead of a resolved name; the index answers it one level up.
 * A logical declaration is keyed under its own logical name, so a literal
 * match still finds it, and is additionally held in a bucket of declarations
 * whose physical target is not yet known. `guardCandidates()` offers such a
 * declaration as a candidate wherever it *could* compete, and the decision is
 * left to `competesInWritingMode()`, which the browser layer calls once it
 * holds an element and has read its writing mode and direction from the same
 * computed style it reads everything else from.
 *
 * Two things follow from that split, and both are deliberate. Candidacy is
 * decided by asking whether a pair competes under *any* writing mode, which
 * is a compile-time question with a compile-time answer, so the candidate set
 * is an over-approximation and never a claim. And the same deferral runs in
 * the other direction: a probed logical property pulls in the physical
 * declarations it could resolve onto, which is why a `width` declaration is a
 * candidate for a probed `inline-size` and is confirmed or dismissed per
 * element.
 *
 * ## What is excluded, and why silently
 *
 * A declaration is indexed only when its rule can be honestly probed, decided
 * by `resolveProbePlacement()`, the same composition of rule-context
 * compilation and nesting resolution call-site resolution uses. That excludes
 * `@keyframes`, `@scope`, `@container`, `@starting-style`, style rules inside
 * an `@function` body, and rules the browser discards outright, along with
 * declarations authored directly inside a descriptor at-rule such as
 * `@font-face` or `@property`, which have no element to apply to.
 *
 * The exclusions produce no diagnostics. The index is built over every
 * scanned source whether or not it carries a single annotation, so reporting
 * each excluded rule would emit a diagnostic per `@keyframes` block in a
 * stylesheet nobody annotated and bury the ones an author asked for. The
 * paths that compile a probe from an annotation already report the same
 * exclusions against the rule the author actually pointed at.
 *
 * The trade-off has a known hole, accepted for this release: those probe
 * paths fire only when the annotated rule itself is unprobeable. When the
 * annotated rule is ordinary but a competitor sits inside `@container`,
 * `@scope`, or `@starting-style` — at-rules that do apply to elements and
 * can win the cascade — the competitor is absent from the index, and
 * `guardCandidates()` answers "nothing competes" with no way for the browser
 * layer to detect the miss. Surfacing "a competitor exists here but cannot
 * be evaluated" is a candidate for a later issue; doing it only when a probe
 * yields zero candidates would keep unannotated stylesheets quiet.
 */

import type { Declaration, Root, Rule } from "postcss";

import {
  DIRECTIONS,
  expandProperty,
  isResetByAll,
  propertyMatchKey,
  resolveLogicalProperty,
  resolveLogicalPropertyPair,
  SHORTHAND_LONGHANDS,
  WRITING_MODES,
} from "../expansion/index.ts";
import type { Direction, WritingMode } from "../expansion/index.ts";

import { resolveProbePlacement } from "./placement.ts";
import type { ProbePlacement } from "./placement.ts";
import type { RuleContext } from "./rule-context.ts";

/**
 * One declaration the guard may have to consider. See the module doc comment
 * for what each field is for and, more to the point, for the fields this type
 * deliberately does not have.
 */
export type IndexedDeclaration = {
  property: string;
  selector: string;
  context: RuleContext;
};

/**
 * The index over one source's declarations.
 *
 * `byProperty` maps a terminal longhand key to the declarations that touch
 * it. `logical` holds the declarations whose physical target depends on an
 * element's writing mode, and `all` holds the `all` declarations, because
 * neither can be keyed by a physical longhand at compile time. `entries` maps
 * a parsed declaration back to its entry, so that the declaration an
 * annotation points at can be excluded from its own guard; it is a `WeakMap`
 * rather than a stored identifier because identity here is the node itself,
 * and a stored identifier would be a source location under another name.
 *
 * Read the index through `guardCandidates()` rather than through
 * `byProperty`, which knows nothing about `all` or about logical deferral.
 */
export type GuardIndex = {
  byProperty: ReadonlyMap<string, ReadonlySet<IndexedDeclaration>>;
  logical: ReadonlySet<IndexedDeclaration>;
  all: ReadonlySet<IndexedDeclaration>;
  entries: WeakMap<Declaration, IndexedDeclaration>;
};

/** True for a property name the shorthand table expands. */
function isShorthand(key: string): boolean {
  return Object.hasOwn(SHORTHAND_LONGHANDS, key);
}

/**
 * True for a property whose physical target depends on an element's writing
 * mode and direction, covering both the single-value logical properties and
 * the two-value logical shorthands.
 */
function isLogical(property: string): boolean {
  return (
    resolveLogicalProperty(property) !== undefined ||
    resolveLogicalPropertyPair(property) !== undefined
  );
}

/**
 * The terminal longhand keys a property touches: the keys it is indexed
 * under, and the keys a probe of it looks up. A shorthand contributes its
 * longhands and not its own name; anything else contributes its own key, plus
 * any longhands the expansion tables give it. Names that are themselves
 * shorthands are filtered out of the expansion, because a shorthand is
 * reachable through the longhands it resets and keying it twice would make
 * two sibling longhands look like competitors.
 */
function longhandKeys(property: string): Set<string> {
  const key = propertyMatchKey(property);
  const keys = new Set<string>();

  if (!isShorthand(key)) {
    keys.add(key);
  }

  for (const expanded of expandProperty(property)) {
    const expandedKey = propertyMatchKey(expanded);

    if (!isShorthand(expandedKey)) {
      keys.add(expandedKey);
    }
  }

  return keys;
}

/**
 * The physical property names a property addresses under one writing mode and
 * direction. A logical property resolves through the expansion module's
 * resolver, a two-value logical shorthand through its pair resolver, and a
 * physical property is already the answer.
 */
function physicalNames(
  property: string,
  writingMode: WritingMode,
  direction: Direction,
): readonly string[] {
  const single = resolveLogicalProperty(property);

  if (single !== undefined) {
    return [single(writingMode, direction)];
  }

  const pair = resolveLogicalPropertyPair(property);

  if (pair !== undefined) {
    return pair(writingMode, direction);
  }

  return [property];
}

/** The terminal longhand keys a property touches under one flow. */
function physicalKeys(
  property: string,
  writingMode: WritingMode,
  direction: Direction,
): Set<string> {
  const keys = new Set<string>();

  for (const name of physicalNames(property, writingMode, direction)) {
    for (const key of longhandKeys(name)) {
      keys.add(key);
    }
  }

  return keys;
}

/**
 * Whether two property names touch a longhand in common under one writing
 * mode and direction.
 *
 * `all` is handled before anything else, because it resets every standard
 * property rather than an enumerable set of longhands, so `isResetByAll()`
 * answers for it. Everything else reduces to whether the two names' terminal
 * longhand sets are disjoint once each has been resolved against the flow.
 */
function propertiesCompete(
  first: string,
  second: string,
  writingMode: WritingMode,
  direction: Direction,
): boolean {
  const firstIsAll = propertyMatchKey(first) === "all";
  const secondIsAll = propertyMatchKey(second) === "all";

  if (firstIsAll || secondIsAll) {
    if (firstIsAll && secondIsAll) {
      return true;
    }

    return isResetByAll(firstIsAll ? second : first);
  }

  return !physicalKeys(first, writingMode, direction).isDisjointFrom(
    physicalKeys(second, writingMode, direction),
  );
}

/**
 * Whether two property names compete under at least one writing mode and
 * direction. This is the candidacy test, which is answerable at compile time
 * precisely because it asks about every flow at once rather than about the
 * one an element happens to be in.
 */
function competeInSomeFlow(first: string, second: string): boolean {
  for (const writingMode of WRITING_MODES) {
    for (const direction of DIRECTIONS) {
      if (propertiesCompete(first, second, writingMode, direction)) {
        return true;
      }
    }
  }

  return false;
}

/** Adds an entry to a keyed bucket, creating the bucket on first use. */
function addTo(
  buckets: Map<string, Set<IndexedDeclaration>>,
  key: string,
  entry: IndexedDeclaration,
): void {
  const existing = buckets.get(key);

  if (existing === undefined) {
    buckets.set(key, new Set([entry]));
  } else {
    existing.add(entry);
  }
}

/**
 * Builds the guard index for one parsed source.
 *
 * Every declaration in the source contributes, whether or not the source
 * carries an annotation, because a competitor need not be annotated. A
 * declaration whose rule cannot be honestly probed contributes nothing and
 * says nothing; see the module doc comment for why the exclusions are silent.
 *
 * `url` is used only to satisfy the resolution passes, which build their
 * diagnostics against it. Those diagnostics are discarded here, and no
 * location reaches the index.
 */
export function buildGuardIndex(root: Root, url: string): GuardIndex {
  const byProperty = new Map<string, Set<IndexedDeclaration>>();
  const logical = new Set<IndexedDeclaration>();
  const all = new Set<IndexedDeclaration>();
  const entries = new WeakMap<Declaration, IndexedDeclaration>();

  // One rule holds many declarations, and resolving its placement walks its
  // whole ancestor chain, so the answer is computed once per rule.
  const placements = new Map<Rule, ProbePlacement>();

  root.walkDecls((declaration) => {
    const parent = declaration.parent;

    if (parent === undefined || parent.type !== "rule") {
      return;
    }

    const rule = parent as Rule;
    let placement = placements.get(rule);

    if (placement === undefined) {
      placement = resolveProbePlacement(rule, url);
      placements.set(rule, placement);
    }

    if (!placement.probed) {
      return;
    }

    const entry: IndexedDeclaration = {
      property: declaration.prop,
      selector: placement.selector,
      context: placement.context,
    };

    for (const key of longhandKeys(declaration.prop)) {
      addTo(byProperty, key, entry);
    }

    if (isLogical(declaration.prop)) {
      logical.add(entry);
    }

    if (propertyMatchKey(declaration.prop) === "all") {
      all.add(entry);
    }

    entries.set(declaration, entry);
  });

  return { byProperty, logical, all, entries };
}

/**
 * The index entry for a parsed declaration, or `undefined` when the
 * declaration was excluded from the index. This is how the declaration an
 * annotation points at is identified, so that a probe is never reported as
 * its own competitor.
 */
export function indexedDeclarationOf(
  index: GuardIndex,
  declaration: Declaration,
): IndexedDeclaration | undefined {
  return index.entries.get(declaration);
}

/**
 * Every declaration that could compete with a probed property, excluding the
 * probe's own declaration when `self` names it.
 *
 * The result is a set, not a list: it has no order, and its size is the
 * number of declarations that still have to be checked against an element,
 * never a competitor count the guard would present. Membership is an
 * over-approximation for logical properties by design, since a logical
 * declaration's physical target is not known until an element is in hand;
 * `competesInWritingMode()` settles each candidate then.
 */
export function guardCandidates(
  index: GuardIndex,
  property: string,
  self?: IndexedDeclaration,
): ReadonlySet<IndexedDeclaration> {
  const candidates = new Set<IndexedDeclaration>();

  const collect = (name: string): void => {
    for (const key of longhandKeys(name)) {
      const bucket = index.byProperty.get(key);

      if (bucket !== undefined) {
        for (const entry of bucket) {
          candidates.add(entry);
        }
      }
    }
  };

  collect(property);

  // A probed logical property reaches the physical declarations it could
  // resolve onto. Every writing mode is walked rather than one chosen,
  // because choosing one here would be the eager resolution this module
  // exists to avoid.
  if (isLogical(property)) {
    for (const writingMode of WRITING_MODES) {
      for (const direction of DIRECTIONS) {
        for (const name of physicalNames(property, writingMode, direction)) {
          collect(name);
        }
      }
    }
  }

  if (isResetByAll(property)) {
    for (const entry of index.all) {
      candidates.add(entry);
    }
  }

  // `all` resets every standard property, so no longhand key can reach the
  // declarations it competes with. A probed `all` therefore walks the index
  // and keeps every declaration it resets, the mirror of the branch above; a
  // custom property survives `all` and stays out.
  if (propertyMatchKey(property) === "all") {
    for (const bucket of index.byProperty.values()) {
      for (const entry of bucket) {
        if (isResetByAll(entry.property)) {
          candidates.add(entry);
        }
      }
    }
  }

  for (const entry of index.logical) {
    if (competeInSomeFlow(entry.property, property)) {
      candidates.add(entry);
    }
  }

  if (self !== undefined) {
    candidates.delete(self);
  }

  return candidates;
}

/**
 * Whether a candidate declaration competes with a probed property for an
 * element in one writing mode and direction.
 *
 * This is the half of the answer the index cannot give. The browser layer
 * calls it once per candidate, with the writing mode and direction read from
 * the element's computed style, alongside the selector match and the
 * condition check the candidate's own fields describe. For a pair of physical
 * properties the answer is the same in every flow and this call is merely
 * consistent; for a logical property on either side it is the whole point.
 */
export function competesInWritingMode(
  candidate: IndexedDeclaration,
  property: string,
  writingMode: WritingMode,
  direction: Direction,
): boolean {
  return propertiesCompete(candidate.property, property, writingMode, direction);
}
