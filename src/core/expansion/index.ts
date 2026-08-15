/**
 * Property expansion tables.
 *
 * The guard (implementation plan, section 3.4) answers one boolean question:
 * does anything else declare this property. Literal property-name matching
 * misses the two most ordinary conflicts in real stylesheets, an annotated
 * `margin-left` beside a competing `margin`, and an annotated `inline-size`
 * beside a competing `width`, so this module closes that gap. It is sized for
 * that one question, not for presentation: no specificity, no counts, no
 * property syntax, no initial values, nothing beyond the name relationships
 * the guard reads.
 *
 * Data source and regeneration. Section 5.7 of the implementation plan left
 * the data source open, contingent on the CSSC-002 parser decision, and
 * decision record 0013 recorded the default: PostCSS carries no syntax
 * database, so these tables are hand-authored in core rather than derived
 * from mdn-data at build time. Every entry was verified against the
 * installed Chromium (checked with Playwright, following AGENTS.md) rather
 * than recalled from memory or copied from a specification's prose, because
 * a shorthand's exact longhand set is a browser behavior, not a naming
 * convention: `border` was confirmed to reset the `border-image-*`
 * longhands alongside width, style, and color, and `background` was
 * confirmed to split into `background-position-x` and
 * `background-position-y` rather than a single position longhand. To
 * regenerate or check a shorthand's longhand set, set it through
 * `HTMLElement.style.setProperty()` on a fresh element and read
 * `style.item(i)` for `0 <= i < style.length`; the browser's own CSSOM
 * serialization enumerates exactly the longhands the shorthand expanded to.
 * To check a logical property's physical mapping, set `writing-mode` and
 * `direction` on the element first, then read the resolved physical
 * longhand back through `getComputedStyle()`, because a logical property is
 * not expanded in the inline `style` object the way a physical shorthand is.
 *
 * Scope decisions, recorded here because they bound what a reader might
 * expect this module to answer:
 *
 * - The shorthand table covers the fourteen families the plan names (margin,
 *   padding, border, border-width, background, font, flex, grid,
 *   grid-template, inset, gap, overflow, place-items, and transition) plus
 *   the sub-shorthands CSSC-041 closed: `background-position`; the four
 *   single-edge `border-top`/`border-right`/`border-bottom`/`border-left`
 *   shorthands; `border-color`, `border-style`, and `border-image`; and
 *   `font-variant`. Each of these is itself a member of a family already in
 *   the table, so leaving it unexpanded left a silent gap: `background: red`
 *   beside `background-position: center` touches the same longhands but
 *   neither named the other. Other shorthands exist, such as `border-radius`
 *   or `outline`, and are added when a guard scenario needs them rather than
 *   up front, because an exhaustive shorthand database is a general-purpose
 *   CSS metadata project this issue is not scoped to become.
 * - Sub-shorthand membership, the fact that setting `border` also resets
 *   `border-top`, is recorded two different ways depending on direction.
 *   Longhand-to-shorthand lookup (`border-top-width` reporting `border-top`,
 *   `border-width`, and `border`) is computed by inverting
 *   `SHORTHAND_LONGHANDS`, the same mechanism CSSC-012 already used for the
 *   plain shorthand/longhand case: because every table entry lists terminal
 *   physical longhands rather than intermediate shorthand names, a longhand
 *   shared by `border`, `border-width`, and `border-top` simply appears in
 *   all three entries' arrays, and the inversion finds it at whatever depth
 *   without a second pass. Shorthand-to-shorthand lookup (`border-top`
 *   itself reporting that `border` resets it) is a short, explicit,
 *   hand-authored list, `SUB_SHORTHAND_PARENTS`, rather than a generic
 *   computation over every pair of table entries whose longhand sets happen
 *   to nest. A generic subset computation would also catch relationships
 *   this module has deliberately not exposed, such as `grid-template`
 *   nesting inside `grid` or `border-width` nesting inside `border`; both
 *   are CSSC-012 entries with their own established, tested behavior, and
 *   neither is named as a CSSC-041 target, so widening them here would be an
 *   unscoped change riding along with this issue. The explicit list costs a
 *   line per family added and never disagrees with a computation nobody
 *   asked for.
 * - Custom properties never expand. `expandProperty()` returns an empty
 *   array for any name starting with `--`, because two custom properties
 *   compete only when they share an exact, case-sensitive name, which the
 *   guard's own literal index already answers.
 * - An unrecognized standard property passes through unchanged: it maps to
 *   itself rather than to an empty array. This is deliberately distinct from
 *   the custom-property case. A custom property is categorically excluded
 *   from expansion; an unrecognized standard property might belong to a
 *   shorthand family this table has not been taught yet, so returning the
 *   name itself keeps the guard's literal-match behavior rather than
 *   silently asserting the property has no competitors.
 * - Vendor-prefixed properties, such as `-webkit-transform`, are not
 *   expanded and pass through unchanged, the same as any other unrecognized
 *   name. They are non-standard by definition, most have no standardized
 *   longhand decomposition to verify against a specification, and the
 *   guard's literal index already matches a repeated vendor-prefixed
 *   declaration without this table's help.
 * - The logical table covers the flow-relative box-edge properties, margin,
 *   padding, border-width, border-style, border-color, and inset, each
 *   across all four of `-inline-start`, `-inline-end`, `-block-start`, and
 *   `-block-end`, plus the six sizing properties `inline-size`,
 *   `block-size`, and their `min-`/`max-` forms. It does not cover logical
 *   border-radius corners, which the guard has not needed yet; that remains
 *   an addition for a later issue.
 * - The two-value logical shorthands `margin-inline`, `padding-inline`, and
 *   `inset-inline`, with their `-block` counterparts, resolve to a *pair* of
 *   physical properties rather than one, so `LogicalResolver`'s
 *   single-name-returning shape cannot express them; CSSC-012 excluded them
 *   for exactly this reason. Rather than widen `LogicalResolver` itself to
 *   return an array, which would force every existing caller of
 *   `resolveLogicalProperty()` (there is exactly one physical name at each
 *   call site today) to handle a case that can never occur for them, this
 *   module adds a second, parallel resolver type, `LogicalPairResolver`,
 *   and a second lookup, `resolveLogicalPropertyPair()`. The two tables stay
 *   independent: a property is in one or the other, never both, and a
 *   caller that only ever deals in single physical names is unaffected by
 *   the pair case existing. `margin-inline`'s first value maps to the same
 *   physical side as `margin-inline-start` and its second to the same side
 *   as `margin-inline-end`, verified in Chromium by setting
 *   `margin-inline: 5px 9px` across every writing-mode and direction
 *   combination and reading all four physical margin longhands back through
 *   `getComputedStyle()`; the pair resolvers therefore reuse the same
 *   `inlineStartSide()`/`inlineEndSide()`/`blockStartSide()`/
 *   `blockEndSide()` functions the single-value resolvers use, rather than
 *   encoding the mapping a second time. `sideways-lr`'s inline axis, which
 *   runs opposite to the other vertical writing modes, was re-checked for
 *   the pair case rather than assumed to follow from the single-value case,
 *   per AGENTS.md, and produced the same inversion.
 */

/**
 * The shorthand-to-longhand table. Each key is a shorthand property name,
 * and each value is every longhand the browser's CSSOM reports when that
 * shorthand is set, in the order the browser reports them. See the module
 * doc comment for the verification method and the source of this data.
 */
export const SHORTHAND_LONGHANDS: Readonly<Record<string, readonly string[]>> = {
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  border: [
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "border-top-style",
    "border-right-style",
    "border-bottom-style",
    "border-left-style",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
    "border-image-source",
    "border-image-slice",
    "border-image-width",
    "border-image-outset",
    "border-image-repeat",
  ],
  "border-width": [
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
  ],
  // The four single-edge shorthands. Verified in Chromium: setting each
  // through style.setProperty() and enumerating style.item(i) reports
  // exactly that edge's width, style, and color longhands, no border-image
  // component.
  "border-top": ["border-top-width", "border-top-style", "border-top-color"],
  "border-right": ["border-right-width", "border-right-style", "border-right-color"],
  "border-bottom": ["border-bottom-width", "border-bottom-style", "border-bottom-color"],
  "border-left": ["border-left-width", "border-left-style", "border-left-color"],
  "border-color": [
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
  ],
  "border-style": [
    "border-top-style",
    "border-right-style",
    "border-bottom-style",
    "border-left-style",
  ],
  // Verified in Chromium: the order matches the border-image-* slice of the
  // border shorthand's own longhand set above.
  "border-image": [
    "border-image-source",
    "border-image-slice",
    "border-image-width",
    "border-image-outset",
    "border-image-repeat",
  ],
  background: [
    "background-image",
    "background-position-x",
    "background-position-y",
    "background-size",
    "background-repeat",
    "background-attachment",
    "background-origin",
    "background-clip",
    "background-color",
  ],
  // Verified in Chromium: setting background-position alone splits into the
  // same two axis longhands the background shorthand splits into above.
  "background-position": ["background-position-x", "background-position-y"],
  font: [
    "font-style",
    "font-variant-caps",
    "font-variant-ligatures",
    "font-variant-numeric",
    "font-variant-east-asian",
    "font-variant-alternates",
    "font-size-adjust",
    "font-language-override",
    "font-kerning",
    "font-optical-sizing",
    "font-feature-settings",
    "font-variation-settings",
    "font-variant-position",
    "font-variant-emoji",
    "font-weight",
    "font-stretch",
    "font-size",
    "line-height",
    "font-family",
  ],
  // Verified in Chromium: the reported order differs from the font-variant-*
  // slice of the font shorthand's own list above, because the two shorthands
  // enumerate their CSSOM longhands independently, but the set of seven
  // names is identical.
  "font-variant": [
    "font-variant-ligatures",
    "font-variant-numeric",
    "font-variant-east-asian",
    "font-variant-caps",
    "font-variant-alternates",
    "font-variant-position",
    "font-variant-emoji",
  ],
  flex: ["flex-grow", "flex-shrink", "flex-basis"],
  grid: [
    "grid-template-columns",
    "grid-template-rows",
    "grid-template-areas",
    "grid-auto-flow",
    "grid-auto-columns",
    "grid-auto-rows",
  ],
  "grid-template": ["grid-template-rows", "grid-template-columns", "grid-template-areas"],
  inset: ["top", "right", "bottom", "left"],
  gap: ["row-gap", "column-gap"],
  overflow: ["overflow-x", "overflow-y"],
  "place-items": ["align-items", "justify-items"],
  transition: [
    "transition-behavior",
    "transition-duration",
    "transition-timing-function",
    "transition-delay",
    "transition-property",
  ],
};

/**
 * The key a property name matches under.
 *
 * Standard property names are ASCII case-insensitive, verified against a real
 * browser: `COLOR: red` and `PADDING-TOP: 5px` both apply and compute. Custom
 * property names are not; `--Custom` and `--custom` name two distinct
 * properties, also verified. Folding a custom property name here would
 * silently merge two properties an author deliberately kept separate, so only
 * the standard-property half is normalised.
 *
 * This key is for matching only. Every caller reports the authored spelling,
 * never this key.
 *
 * It lives here, and is exported, because the compiler and the guard must key
 * property names identically: the compiler decides which declaration a probe
 * covers, and expansion decides which other properties could compete with it.
 * Two copies that agree today are two copies that can disagree later, and the
 * failure would be silent, so there is one.
 */
export function propertyMatchKey(name: string): string {
  return name.startsWith("--") ? name : name.toLowerCase();
}

/**
 * True for a custom property name: one starting with the two-hyphen prefix
 * that makes it a custom property rather than a standard or vendor-prefixed
 * one.
 */
function isCustomProperty(name: string): boolean {
  return name.startsWith("--");
}

/**
 * The inverse of `SHORTHAND_LONGHANDS`: every longhand mapped to the
 * shorthand or shorthands that reset it, built once at module load. A
 * longhand reset by more than one shorthand, such as `border-top-width`
 * under both `border` and the narrower `border-width`, lists every
 * shorthand that resets it, in the order `SHORTHAND_LONGHANDS` defines them.
 */
const LONGHAND_SHORTHANDS: ReadonlyMap<string, readonly string[]> = (() => {
  const inverse = new Map<string, string[]>();

  for (const [shorthand, longhands] of Object.entries(SHORTHAND_LONGHANDS)) {
    for (const longhand of longhands) {
      const key = propertyMatchKey(longhand);
      const existing = inverse.get(key);

      if (existing === undefined) {
        inverse.set(key, [shorthand]);
      } else {
        existing.push(shorthand);
      }
    }
  }

  return inverse;
})();

/**
 * The shorthand-to-shorthand half of sub-shorthand membership: a shorthand
 * whose own longhand set nests inside a larger shorthand's, so that setting
 * the larger one resets the smaller one too. See the module doc comment for
 * why this is a short, explicit, hand-authored list rather than a generic
 * subset computation over `SHORTHAND_LONGHANDS`.
 */
const SUB_SHORTHAND_PARENTS: Readonly<Record<string, readonly string[]>> = {
  "border-top": ["border"],
  "border-right": ["border"],
  "border-bottom": ["border"],
  "border-left": ["border"],
  "border-color": ["border"],
  "border-style": ["border"],
  "border-image": ["border"],
  "background-position": ["background"],
  "font-variant": ["font"],
};

/**
 * Answers the guard's shorthand and longhand question for one property:
 * which other property names could compete with it, considering only
 * shorthand and longhand relationships. Logical-to-physical competition is a
 * separate question, answered by `resolveLogicalProperty()`, because it
 * cannot be answered without an element's writing mode and direction.
 *
 * A shorthand name returns its longhands. A longhand name returns the
 * shorthand or shorthands that reset it, so the lookup is bidirectional: an
 * annotated `margin-left` reports `["margin"]`, and an annotated `margin`
 * reports its four physical longhands. A shorthand that is itself a member
 * of a larger family, such as `border-top` inside `border`, reports both:
 * its own longhands and the enclosing shorthand, so `expandProperty
 * ("border-top")` is `["border-top-width", "border-top-style",
 * "border-top-color", "border"]`. A custom property always returns an empty
 * array, because two custom properties compete only under an exact,
 * case-sensitive name match, which needs no expansion. Any other name,
 * including an unrecognized standard property and a vendor-prefixed
 * property, passes through unchanged as a single-element array containing
 * itself, which is a deliberately different answer from the custom-property
 * case: see the module doc comment.
 */
export function expandProperty(property: string): readonly string[] {
  if (isCustomProperty(property)) {
    return [];
  }

  const key = propertyMatchKey(property);
  const longhands = SHORTHAND_LONGHANDS[key];

  if (longhands !== undefined) {
    const parents = SUB_SHORTHAND_PARENTS[key];

    return parents === undefined ? longhands : [...longhands, ...parents];
  }

  const shorthands = LONGHAND_SHORTHANDS.get(key);

  if (shorthands !== undefined) {
    return shorthands;
  }

  return [property];
}

/**
 * The properties the CSS Cascade specification excludes from `all`:
 * `direction` and `unicode-bidi`. Verified in Chromium: setting
 * `direction: rtl` and then `all: initial` on the same element leaves
 * `getComputedStyle().direction` at `"rtl"`, and the same holds for
 * `unicode-bidi`. Custom properties are excluded too, but that exclusion is
 * categorical rather than a named property, so `isResetByAll()` checks it
 * directly instead of listing every possible custom property name here.
 */
export const ALL_EXCLUDED_PROPERTIES: ReadonlySet<string> = new Set(["direction", "unicode-bidi"]);

/**
 * Answers whether an `all` declaration resets `property`.
 *
 * This is a predicate rather than an enumerated longhand table, unlike
 * `SHORTHAND_LONGHANDS`, because `all` resets every standard CSS property
 * that exists, not a fixed, enumerable family the way `margin` resets four
 * named longhands. Hand-authoring that full property list would turn this
 * module into the general-purpose CSS metadata library the issue's judgment
 * guidance warns against building, and it would still be wrong the day a
 * browser ships a new property, whereas the exclusion rule the specification
 * states is stable: every property is reset except `direction`,
 * `unicode-bidi`, and custom properties. Verified in Chromium for the custom
 * property case: setting `--brand: red` and then `all: initial` on the same
 * element leaves `getComputedStyle().getPropertyValue("--brand")` reporting
 * `"red"`.
 */
export function isResetByAll(property: string): boolean {
  if (isCustomProperty(property)) {
    return false;
  }

  return !ALL_EXCLUDED_PROPERTIES.has(propertyMatchKey(property));
}

/**
 * The five writing modes the logical table resolves against. `tb-rl` is the
 * deprecated pre-standard spelling and is not supported; `sideways-rl` and
 * `sideways-lr` are its standardized replacements alongside `vertical-rl`
 * and `vertical-lr`.
 *
 * The list is a value rather than only a type because a caller that has no
 * element in hand, such as the guard index deciding whether a logical
 * declaration could ever address a given physical property, has to consider
 * every writing mode at once. Deriving `WritingMode` from the array rather
 * than declaring the two separately means the enumeration and the type
 * cannot drift apart.
 */
export const WRITING_MODES = [
  "horizontal-tb",
  "vertical-rl",
  "vertical-lr",
  "sideways-rl",
  "sideways-lr",
] as const;

export type WritingMode = (typeof WRITING_MODES)[number];

/** The two directions the logical table resolves against. */
export const DIRECTIONS = ["ltr", "rtl"] as const;

export type Direction = (typeof DIRECTIONS)[number];

/**
 * A function that resolves a logical property to the physical longhand it
 * addresses for one writing mode and direction. This is the shape the
 * logical table publishes, deliberately never a resolved property name,
 * because resolution needs the element's writing mode and direction, which
 * do not exist at compile time; the browser layer calls this once it holds
 * the element's computed style.
 */
export type LogicalResolver = (writingMode: WritingMode, direction: Direction) => string;

/** One of the four physical edges a box-edge property can resolve to. */
type PhysicalSide = "top" | "right" | "bottom" | "left";

const OPPOSITE_SIDE: Readonly<Record<PhysicalSide, PhysicalSide>> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

/**
 * The physical side `block-start` addresses in each writing mode,
 * independent of `direction`. Verified in Chromium: setting
 * `margin-block-start` and reading the four physical margin longhands back
 * through `getComputedStyle()` gives the same physical side under `ltr` and
 * `rtl` alike, for every writing mode, because `direction` affects only the
 * inline axis.
 */
const BLOCK_START_SIDE: Readonly<Record<WritingMode, PhysicalSide>> = {
  "horizontal-tb": "top",
  "vertical-rl": "right",
  "vertical-lr": "left",
  "sideways-rl": "right",
  "sideways-lr": "left",
};

/**
 * The physical side `inline-start` addresses in each writing mode under
 * `ltr`; `rtl` flips it to the opposite side. Verified in Chromium the same
 * way as `BLOCK_START_SIDE`. `sideways-lr` is the one writing mode whose
 * base inline direction is inverted relative to the other three
 * vertical-axis modes: its inline progression runs bottom-to-top rather
 * than top-to-bottom, which is why its base side is `bottom` while
 * `vertical-rl`, `vertical-lr`, and `sideways-rl` all base to `top`.
 */
const INLINE_START_SIDE_LTR: Readonly<Record<WritingMode, PhysicalSide>> = {
  "horizontal-tb": "left",
  "vertical-rl": "top",
  "vertical-lr": "top",
  "sideways-rl": "top",
  "sideways-lr": "bottom",
};

function blockStartSide(writingMode: WritingMode): PhysicalSide {
  return BLOCK_START_SIDE[writingMode];
}

function blockEndSide(writingMode: WritingMode): PhysicalSide {
  return OPPOSITE_SIDE[blockStartSide(writingMode)];
}

function inlineStartSide(writingMode: WritingMode, direction: Direction): PhysicalSide {
  const base = INLINE_START_SIDE_LTR[writingMode];

  return direction === "ltr" ? base : OPPOSITE_SIDE[base];
}

function inlineEndSide(writingMode: WritingMode, direction: Direction): PhysicalSide {
  return OPPOSITE_SIDE[inlineStartSide(writingMode, direction)];
}

/** The four flow-relative edges a box-edge logical property can name. */
type LogicalEdge = "inline-start" | "inline-end" | "block-start" | "block-end";

/**
 * Builds a `LogicalResolver` for one flow-relative edge, given how that
 * edge's family names a physical side, such as `(side) => "margin-" +
 * side` for the margin family or the identity function for `inset`, whose
 * physical longhands carry no prefix.
 */
function edgeResolver(
  edge: LogicalEdge,
  toPhysical: (side: PhysicalSide) => string,
): LogicalResolver {
  return (writingMode, direction) => {
    const side =
      edge === "inline-start"
        ? inlineStartSide(writingMode, direction)
        : edge === "inline-end"
          ? inlineEndSide(writingMode, direction)
          : edge === "block-start"
            ? blockStartSide(writingMode)
            : blockEndSide(writingMode);

    return toPhysical(side);
  };
}

/**
 * One box-edge property family: how its logical property name is built from
 * an edge, and how its physical longhand name is built from a resolved
 * side. `margin-inline-start` and `border-inline-start-width` differ in
 * where the edge slots into the name, which is why this is a function
 * rather than a fixed prefix.
 *
 * `twoValueName`, when present, names the family's two-value logical
 * shorthand, such as `margin-inline`, which CSSC-041 covers alongside the
 * four-way `-start`/`-end` properties above. It is omitted for the
 * border-width/style/color families because this table does not cover a
 * `border-inline-width`-shaped shorthand; no guard scenario has needed it,
 * and CSSC-041 does not name it as a target.
 */
type BoxEdgeFamily = {
  logicalName: (edge: LogicalEdge) => string;
  physicalName: (side: PhysicalSide) => string;
  twoValueName?: (axis: LogicalAxis) => string;
};

const BOX_EDGE_FAMILIES: readonly BoxEdgeFamily[] = [
  {
    logicalName: (edge) => `margin-${edge}`,
    physicalName: (side) => `margin-${side}`,
    twoValueName: (axis) => `margin-${axis}`,
  },
  {
    logicalName: (edge) => `padding-${edge}`,
    physicalName: (side) => `padding-${side}`,
    twoValueName: (axis) => `padding-${axis}`,
  },
  { logicalName: (edge) => `border-${edge}-width`, physicalName: (side) => `border-${side}-width` },
  { logicalName: (edge) => `border-${edge}-style`, physicalName: (side) => `border-${side}-style` },
  { logicalName: (edge) => `border-${edge}-color`, physicalName: (side) => `border-${side}-color` },
  {
    logicalName: (edge) => `inset-${edge}`,
    physicalName: (side) => side,
    twoValueName: (axis) => `inset-${axis}`,
  },
];

const LOGICAL_EDGES: readonly LogicalEdge[] = [
  "inline-start",
  "inline-end",
  "block-start",
  "block-end",
];

/**
 * The logical axis a sizing property names: `inline-size` and its `min`/
 * `max` forms name the inline axis, `block-size` and its forms name the
 * block axis. Whether that axis is physically horizontal or vertical
 * depends on the writing mode only; unlike the box-edge properties, sizing
 * never depends on `direction`, verified in Chromium by confirming
 * `inline-size` resolves to the same physical longhand under both `ltr` and
 * `rtl` for a fixed writing mode.
 */
type LogicalAxis = "inline" | "block";

type SizeFamily = {
  logicalName: string;
  axis: LogicalAxis;
  physicalName: (isHorizontal: boolean) => string;
};

const SIZE_FAMILIES: readonly SizeFamily[] = [
  { logicalName: "inline-size", axis: "inline", physicalName: (h) => (h ? "width" : "height") },
  { logicalName: "block-size", axis: "block", physicalName: (h) => (h ? "width" : "height") },
  {
    logicalName: "min-inline-size",
    axis: "inline",
    physicalName: (h) => (h ? "min-width" : "min-height"),
  },
  {
    logicalName: "max-inline-size",
    axis: "inline",
    physicalName: (h) => (h ? "max-width" : "max-height"),
  },
  {
    logicalName: "min-block-size",
    axis: "block",
    physicalName: (h) => (h ? "min-width" : "min-height"),
  },
  {
    logicalName: "max-block-size",
    axis: "block",
    physicalName: (h) => (h ? "max-width" : "max-height"),
  },
];

function sizeResolver(family: SizeFamily): LogicalResolver {
  return (writingMode) => {
    const inlineIsHorizontal = writingMode === "horizontal-tb";
    const axisIsHorizontal = family.axis === "inline" ? inlineIsHorizontal : !inlineIsHorizontal;

    return family.physicalName(axisIsHorizontal);
  };
}

/**
 * The logical property table: every flow-relative box-edge and sizing
 * property css-console resolves, mapped to the `LogicalResolver` function
 * that computes its physical longhand once a writing mode and direction are
 * known. See the module doc comment for the exact scope this table covers
 * and the two-value shorthands and logical border-radius corners it
 * deliberately excludes.
 */
export const LOGICAL_PROPERTIES: Readonly<Record<string, LogicalResolver>> = (() => {
  const table: Record<string, LogicalResolver> = {};

  for (const family of BOX_EDGE_FAMILIES) {
    for (const edge of LOGICAL_EDGES) {
      table[family.logicalName(edge)] = edgeResolver(edge, family.physicalName);
    }
  }

  for (const family of SIZE_FAMILIES) {
    table[family.logicalName] = sizeResolver(family);
  }

  return table;
})();

/**
 * Looks up the `LogicalResolver` for a logical property name, or `undefined`
 * when the name is not one of the logical properties this table covers,
 * including a physical property name, a custom property, or an unrecognized
 * name. Unlike `expandProperty()`, there is no pass-through case: a property
 * this table does not resolve simply has no logical mapping to report, and
 * the guard treats that the same as any other property with no logical
 * competitor.
 */
export function resolveLogicalProperty(property: string): LogicalResolver | undefined {
  return LOGICAL_PROPERTIES[propertyMatchKey(property)];
}

/**
 * A function that resolves a two-value logical shorthand, such as
 * `margin-inline`, to the pair of physical longhands it addresses for one
 * writing mode and direction, first value first. See the module doc
 * comment for why this is a separate type from `LogicalResolver` rather
 * than a widened version of it.
 */
export type LogicalPairResolver = (
  writingMode: WritingMode,
  direction: Direction,
) => readonly [string, string];

/**
 * Builds a `LogicalPairResolver` for a family's two-value inline shorthand,
 * reusing the same `inlineStartSide()`/`inlineEndSide()` functions the
 * single-value `edgeResolver()` uses so the physical mapping is encoded
 * once.
 */
function inlinePairResolver(toPhysical: (side: PhysicalSide) => string): LogicalPairResolver {
  return (writingMode, direction) => [
    toPhysical(inlineStartSide(writingMode, direction)),
    toPhysical(inlineEndSide(writingMode, direction)),
  ];
}

/**
 * Builds a `LogicalPairResolver` for a family's two-value block shorthand,
 * reusing `blockStartSide()`/`blockEndSide()` the same way
 * `inlinePairResolver()` reuses their inline counterparts.
 */
function blockPairResolver(toPhysical: (side: PhysicalSide) => string): LogicalPairResolver {
  return (writingMode) => [
    toPhysical(blockStartSide(writingMode)),
    toPhysical(blockEndSide(writingMode)),
  ];
}

/**
 * The two-value logical shorthand table: `margin-inline`, `padding-inline`,
 * `inset-inline`, and their `-block` counterparts, mapped to the
 * `LogicalPairResolver` that computes the physical longhand pair once a
 * writing mode and direction are known. Built by walking the same
 * `BOX_EDGE_FAMILIES` the single-value logical table walks, filtered to the
 * families that declare a `twoValueName`, so the physical-name mapping for
 * a family is written once and shared by both tables.
 */
export const LOGICAL_PROPERTY_PAIRS: Readonly<Record<string, LogicalPairResolver>> = (() => {
  const table: Record<string, LogicalPairResolver> = {};

  for (const family of BOX_EDGE_FAMILIES) {
    if (family.twoValueName === undefined) {
      continue;
    }

    table[family.twoValueName("inline")] = inlinePairResolver(family.physicalName);
    table[family.twoValueName("block")] = blockPairResolver(family.physicalName);
  }

  return table;
})();

/**
 * Looks up the `LogicalPairResolver` for a two-value logical shorthand
 * name, or `undefined` when the name is not one this table covers. Mirrors
 * `resolveLogicalProperty()`'s pass-through-free behavior: a name this
 * table does not resolve has no pair mapping to report, not a fallback to
 * self.
 */
export function resolveLogicalPropertyPair(property: string): LogicalPairResolver | undefined {
  return LOGICAL_PROPERTY_PAIRS[propertyMatchKey(property)];
}
