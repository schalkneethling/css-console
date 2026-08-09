/**
 * Rule probe compilation.
 *
 * A rule probe names a style rule and, optionally, the properties on it
 * worth reporting. This module turns that pairing into the declarations a
 * later evaluation phase reads: no CSS is evaluated here, no selector is
 * matched against anything, and no value is resolved. The input is a parsed
 * tree, and the output is a compiled description of what to look up once a
 * browser is available.
 *
 * The declarations considered are the ones authored directly in the rule.
 * CSS nesting lets a rule contain further rules as children, and a probe on
 * the outer rule is not a probe on the inner ones; those are their own
 * targets, resolved separately by nesting resolution (CSSC-010).
 *
 * The other half of compiling a rule probe is its selector, which splits into
 * independently matched branches. That lives in ./selector.ts and is
 * re-exported here, so that the compiler presents one entry point.
 */

export { splitSelectorBranches } from "./selector.ts";
export type { SelectorBranch, SelectorSplit } from "./selector.ts";

export { compileRuleContext } from "./rule-context.ts";
export type { RuleContext, RuleContextEntry, RuleContextResolution } from "./rule-context.ts";

import type { AtRule, Declaration, Root, Rule } from "postcss";

import { createDiagnostic } from "../diagnostics/index.ts";
import type { Diagnostic } from "../diagnostics/index.ts";
import type { SourceLocation } from "../records/index.ts";

import type { AnnotationTarget } from "../annotations/associate.ts";

import { compileRuleContext } from "./rule-context.ts";

/** The style-rule target shape a rule probe compiles from. */
export type StyleRuleTarget = Extract<AnnotationTarget, { kind: "style-rule" }>;

/**
 * One `var()` reference found in an authored value. `fallback` is the raw
 * text after the reference's first comma, kept as authored rather than
 * parsed further, because validating a fallback requires a destination
 * property and an element, neither of which exists at compile time.
 * `fallback` is `null` when the reference carries none.
 */
export type CustomPropertyReference = {
  name: string;
  fallback: string | null;
};

/**
 * One property the compiled probe covers. `authored` is the value exactly as
 * written, with any trailing `!important` removed and reported separately
 * through `important`, matching how PostCSS itself splits the two.
 * `customProperties` lists every `var()` reference the value contains,
 * including references nested inside another reference's fallback, because
 * the evaluator and the guard both need to know which custom properties a
 * declaration depends on.
 */
export type CompiledRuleProbeProperty = {
  name: string;
  authored: string;
  important: boolean;
  source: SourceLocation;
  customProperties: readonly CustomPropertyReference[];
};

/**
 * The outcome of compiling one rule probe: the properties it covers, in the
 * order the probe should report them, plus any diagnostics compilation
 * produced along the way. A requested property the rule never declares does
 * not prevent the others from compiling, which is why the diagnostic carries
 * warning severity rather than discarding the probe.
 */
export type CompiledRuleProbe =
  | {
      properties: readonly [CompiledRuleProbeProperty, ...CompiledRuleProbeProperty[]];
      diagnostics: readonly Diagnostic[];
    }
  | {
      properties: readonly [];
      diagnostics: readonly [Diagnostic, ...Diagnostic[]];
    };

/**
 * Explains why a declaration inside an at-rule cannot be probed, in terms of
 * that at-rule rather than in one message covering all of them.
 *
 * `@page` is called out separately because it is the case an author is most
 * likely to think should work, and the reason it does not is different. A
 * page box is not an element, so there is no `getComputedStyle()` to call:
 * the CSSOM exposes `CSSPageRule.style`, which is the declared style. That
 * is not nothing, since Chromium serialises `margin: calc(1cm + 2mm)` there
 * as `calc(45.3543px)`, but it cannot answer which page a `:left` rule
 * actually applied to, which is the question worth asking. Probing it is
 * recorded as deferred work rather than refused outright.
 */
function descriptorMessage(atRule: string): string {
  if (atRule.toLowerCase() === "page") {
    return (
      "This declaration sits inside @page. A page box is not an element, so there is nothing " +
      "to call getComputedStyle() on and no way to ask which page a :left or :right rule " +
      "applied to. Probing @page is deferred rather than rejected; see the diagnostics " +
      "documentation."
    );
  }

  return (
    `This declaration sits inside @${atRule}, which describes a font or a property ` +
    "registration rather than styling an element. Its value is whatever the source says, " +
    "because there is no element to resolve it against. Annotate the declaration that uses " +
    "it on an element instead."
  );
}

/**
 * Builds a compiled probe, reporting `NO_PROBED_PROPERTIES` when compilation
 * found no properties and had nothing else to say.
 *
 * The return type makes an empty probe carrying no diagnostics
 * unrepresentable, and this is where that constraint is honoured. It is not
 * type theatre: the shape had been produced three times by three different
 * paths, each time silently, and twice it took a reviewer to notice. An
 * annotation that yields neither a property nor a diagnostic is
 * indistinguishable from one the compiler never reached, which is the worst
 * thing a debugging tool can tell an author.
 */
function compiledProbe(
  properties: readonly CompiledRuleProbeProperty[],
  diagnostics: readonly Diagnostic[],
  source: SourceLocation,
  details?: Record<string, unknown>,
): CompiledRuleProbe {
  const [first, ...rest] = properties;

  if (first !== undefined) {
    return { properties: [first, ...rest], diagnostics };
  }

  const [firstDiagnostic, ...restDiagnostics] = diagnostics;

  if (firstDiagnostic !== undefined) {
    return { properties: [], diagnostics: [firstDiagnostic, ...restDiagnostics] };
  }

  return {
    properties: [],
    diagnostics: [
      createDiagnostic(
        "NO_PROBED_PROPERTIES",
        details === undefined ? { source } : { source, details },
      ),
    ],
  };
}

/**
 * Finds the matching close parenthesis for an open parenthesis whose
 * argument text starts at `start`, accounting for parentheses nested inside
 * the arguments, such as another function call in a fallback. Returns -1
 * when the value has no matching close, which an author would see as a
 * PostCSS parse error long before this function runs, but the compiler does
 * not assume a well-formed value.
 */
function findMatchingParen(value: string, start: number): number {
  let depth = 1;

  for (let index = start; index < value.length; index += 1) {
    const character = value[index];

    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

/**
 * Finds the first comma in `value` that is not nested inside a parenthesised
 * argument list, which is the comma that separates a `var()` reference's
 * name from its fallback. A fallback may itself contain commas, such as a
 * `color-mix()` call, and those do not count.
 */
function firstTopLevelComma(value: string): number {
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      return index;
    }
  }

  return -1;
}

/**
 * Matches a `var(` function call, case-insensitively because CSS function
 * names are ASCII case-insensitive. The captured reference name is not
 * normalised, because custom property names are case-sensitive, unlike the
 * function name that introduces them.
 *
 * The negative lookbehind requires that no identifier character or hyphen
 * precedes the match, which is what stops `var(` from matching inside a
 * longer name such as the dashed function `--space-var(2)`. Without it,
 * every dashed function whose name happens to end in "var" would be
 * misread as a custom property reference, which matters here more than
 * elsewhere: a dashed function call is exactly the construct this project
 * exists to probe.
 */
const VAR_CALL = /(?<![\w-])var\(/gi;

/**
 * Replaces the contents of every quoted string in a value with spaces,
 * keeping the result the same length so the indices `extractCustomPropertyReferences()`
 * computes against it still line up with the original text. A `var(`
 * inside a string, as in `content: "var(--not-real)"`, is authored text
 * rather than a reference, and masking it out is simpler and more direct
 * than teaching the scanner to reason about quotes at every step.
 */
function maskQuotedStrings(value: string): string {
  const masked = value.split("");
  let quote: string | null = null;
  let escaped = false;

  for (let index = 0; index < masked.length; index += 1) {
    const character = masked[index];

    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }

      masked[index] = " ";
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      masked[index] = " ";
    }
  }

  return masked.join("");
}

/**
 * Extracts every `var()` reference an authored value contains.
 *
 * The scan is a single left-to-right pass over the value for `var(` call
 * openings. A reference nested inside another reference's fallback, as in
 * `var(--a, var(--b, 10px))`, is simply a second `var(` occurring later in
 * the same string, so no recursive descent is needed: each match resolves
 * its own matching close parenthesis independently of any other match.
 *
 * The scan runs against a quote-masked copy of the value, so a `var(`
 * written inside a string is never mistaken for a reference, while the
 * name and fallback text sliced out for each match still come from the
 * original value, so an authored string inside a fallback, such as
 * `var(--label, "default")`, keeps its quotes in the result.
 */
function extractCustomPropertyReferences(value: string): CustomPropertyReference[] {
  const masked = maskQuotedStrings(value);
  const references: CustomPropertyReference[] = [];

  for (const match of masked.matchAll(VAR_CALL)) {
    const argsStart = match.index + match[0].length;
    const argsEnd = findMatchingParen(masked, argsStart);

    if (argsEnd === -1) {
      continue;
    }

    const maskedArgs = masked.slice(argsStart, argsEnd);
    const args = value.slice(argsStart, argsEnd);
    const comma = firstTopLevelComma(maskedArgs);

    if (comma === -1) {
      references.push({ name: args.trim(), fallback: null });
      continue;
    }

    references.push({
      name: args.slice(0, comma).trim(),
      fallback: args.slice(comma + 1).trim(),
    });
  }

  return references;
}

/**
 * Builds a source location for a node from its parser positions, matching
 * the fallback annotation association uses for a node with no end position.
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
 * The key a property name matches under. Standard property names are ASCII
 * case-insensitive, verified against a real browser: `COLOR: red` and
 * `PADDING-TOP: 5px` both apply and compute. Custom property names are not;
 * `--Custom` and `--custom` name two distinct properties, also verified.
 * Folding a custom property name here would silently merge two properties an
 * author deliberately kept separate, so only the standard-property half is
 * normalised. This key is for matching only: the compiled property's `name`
 * always carries the declaration's own authored spelling, never this key.
 */
function matchKey(name: string): string {
  return name.startsWith("--") ? name : name.toLowerCase();
}

/**
 * Finds the rule a style-rule target names within a parsed tree. Matching by
 * selector alone is not enough, because CSS nesting can repeat a selector at
 * different depths, so the target's own source position disambiguates. The
 * position is exact rather than approximate, because association records the
 * position PostCSS reported for this exact rule.
 */
function findRule(root: Root, target: StyleRuleTarget): Rule | undefined {
  let found: Rule | undefined;

  root.walkRules((rule) => {
    if (found !== undefined) {
      return;
    }

    if (
      rule.selector === target.selector &&
      rule.source?.start?.line === target.source.start.line &&
      rule.source?.start?.column === target.source.start.column
    ) {
      found = rule;
    }
  });

  return found;
}

/**
 * Reads the declarations authored directly in a rule, skipping nested rules
 * and at-rules, which are their own targets rather than part of this one.
 * Declarations are returned in source order.
 */
function ownDeclarations(rule: Rule): Declaration[] {
  return rule.nodes.filter((node): node is Declaration => node.type === "decl");
}

/**
 * Returns the declaration that wins among repeats of one property within a
 * single rule.
 *
 * Source order alone does not decide this. Importance is ranked above order,
 * so in `color: red !important; color: blue` the earlier important
 * declaration wins and the browser computes red; Chromium drops the loser
 * from the rule's `cssText` entirely. Taking the last declaration would
 * report `blue` as authored while the browser resolved from `red`, which
 * makes every later comparison of authored against resolved wrong for
 * exactly the declaration an author flagged as mattering most.
 *
 * Among declarations of equal importance the last one wins, which is
 * ordinary source order.
 */
function winningDeclaration(declarations: readonly Declaration[]): Declaration | undefined {
  const important = declarations.filter((declaration) => declaration.important === true);
  const tier = important.length > 0 ? important : declarations;

  return tier[tier.length - 1];
}

/**
 * Compiles one property from its winning declaration, extracting the
 * `var()` references its authored value carries.
 */
function compileProperty(declaration: Declaration, url: string): CompiledRuleProbeProperty {
  return {
    name: declaration.prop,
    authored: declaration.value,
    important: declaration.important === true,
    source: locationOf(declaration, url),
    customProperties: extractCustomPropertyReferences(declaration.value),
  };
}

/**
 * Groups a rule's own declarations by matching key, keeping every
 * declaration in the order authored. A property declared more than once,
 * including a standard property repeated under a different case such as
 * `color` and `COLOR`, keeps its first position in the map, so an author
 * reading the probe finds a repeated property where they first wrote it,
 * while the value reported is still the last one authored, matching how the
 * cascade resolves repeats within one rule.
 */
function groupByProperty(declarations: readonly Declaration[]): Map<string, Declaration[]> {
  const grouped = new Map<string, Declaration[]>();

  for (const declaration of declarations) {
    const key = matchKey(declaration.prop);
    const existing = grouped.get(key);

    if (existing === undefined) {
      grouped.set(key, [declaration]);
    } else {
      existing.push(declaration);
    }
  }

  return grouped;
}

/**
 * Compiles the properties a rule probe covers, given the style-rule target
 * annotation association produced and the requested property list, which is
 * empty for a probe with no explicit list.
 *
 * With no requested list, every property authored directly in the rule is
 * covered, in source order. With a requested list, the compiled order is the
 * requested order rather than source order, because the author chose that
 * order deliberately and a probe that silently reordered it would misreport
 * what was asked for. A requested property the rule never declares produces
 * `MISSING_REQUESTED_PROPERTY` and is otherwise skipped, which is why the
 * diagnostic carries warning rather than error severity: the remaining
 * requested properties are still compiled.
 *
 * A property declared more than once in the rule produces
 * `REPEATED_DECLARATION`, reported once per repeated property with the
 * winning declaration's location, because the last authored value is what
 * the cascade resolves to within a single rule and that is not a mistake to
 * flag as an error.
 *
 * `target` must name a rule that actually exists in `root`, at the position
 * association recorded for it. If it does not, the target and the tree came
 * from different parses, which no CSS an author writes can produce; this
 * throws rather than returning an empty, indistinguishable-from-legitimate
 * probe, because a silent empty result is the shape a caller is least likely
 * to notice went wrong.
 */
export function compileRuleProbeProperties(
  root: Root,
  target: StyleRuleTarget,
  requested: readonly string[],
): CompiledRuleProbe {
  const { url } = target.source;
  const rule = findRule(root, target);

  if (rule === undefined) {
    throw new Error(
      `compileRuleProbeProperties: no rule found for selector "${target.selector}" at ` +
        `${url}:${target.source.start.line}:${target.source.start.column}. The target and ` +
        "the parsed tree must come from the same source.",
    );
  }

  const grouped = groupByProperty(ownDeclarations(rule));
  const names = requested.length > 0 ? requested : [...grouped.keys()];

  const properties: CompiledRuleProbeProperty[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const name of names) {
    const declarations = grouped.get(matchKey(name));

    if (declarations === undefined) {
      diagnostics.push(
        createDiagnostic("MISSING_REQUESTED_PROPERTY", {
          source: target.source,
          details: { property: name },
        }),
      );
      continue;
    }

    const winner = winningDeclaration(declarations);

    if (winner === undefined) {
      continue;
    }

    if (declarations.length > 1) {
      diagnostics.push(
        createDiagnostic("REPEATED_DECLARATION", {
          source: locationOf(winner, url),
          details: { property: name, count: declarations.length },
        }),
      );
    }

    properties.push(compileProperty(winner, url));
  }

  return compiledProbe(properties, diagnostics, target.source, { selector: target.selector });
}

/** The declaration target shape a declaration probe compiles from. */
export type DeclarationTarget = Extract<AnnotationTarget, { kind: "declaration" }>;

/**
 * Finds the declaration a declaration target names within a parsed tree.
 * Matching by property alone is not enough, because a property may be
 * declared more than once and may appear in many rules, so the target's own
 * source position disambiguates. The position is exact rather than
 * approximate, because association records the position PostCSS reported for
 * this exact declaration.
 */
function findDeclaration(root: Root, target: DeclarationTarget): Declaration | undefined {
  let found: Declaration | undefined;

  root.walkDecls((declaration) => {
    if (
      found === undefined &&
      declaration.prop === target.property &&
      declaration.source?.start?.line === target.source.start.line &&
      declaration.source?.start?.column === target.source.start.column
    ) {
      found = declaration;
    }
  });

  return found;
}

/**
 * Compiles the one property a declaration probe covers.
 *
 * A declaration probe names its property through its position in the source
 * rather than through a list, which is why the grammar rejects a property
 * list on one. What it compiles to is deliberately the same
 * `CompiledRuleProbeProperty` a rule probe produces: the evaluator, the
 * guard, and the identifier hash should never have to ask which probe kind
 * produced a property.
 *
 * The annotated declaration is what gets compiled, even when a later
 * declaration of the same property wins within the rule. The author pointed
 * at a line, and that line is what the probe reports. That it does not win is
 * a separate fact and worth telling them, because the value the browser
 * resolves will not have come from the line they annotated, so this reports
 * `REPEATED_DECLARATION` rather than quietly compiling the winner instead.
 *
 * A rule context this release does not evaluate excludes the probe entirely,
 * reported with the code rule-context compilation uses, because a probe there
 * would read a value the annotated rule never produced.
 */
export function compileDeclarationProbe(root: Root, target: DeclarationTarget): CompiledRuleProbe {
  const { url } = target.source;
  const declaration = findDeclaration(root, target);

  if (declaration === undefined) {
    throw new Error(
      `compileDeclarationProbe: no declaration found for property "${target.property}" at ` +
        `${url}:${target.source.start.line}:${target.source.start.column}. The target and ` +
        "the parsed tree must come from the same source.",
    );
  }

  const parent = declaration.parent;

  if (parent !== undefined && parent.type === "atrule") {
    // A declaration whose container is an at-rule rather than a style rule,
    // such as `@font-face` or `@property`. These describe a font or a custom
    // property registration rather than styling an element, so there is
    // nothing for a probe to read a computed value from. Reported rather
    // than returned empty, because an annotation that produces neither a
    // probe nor a diagnostic tells the author nothing.
    return {
      properties: [],
      diagnostics: [
        createDiagnostic("OUTSIDE_SUPPORTED_TARGET_SET", {
          message: descriptorMessage((parent as AtRule).name),
          source: locationOf(declaration, url),
          details: { property: declaration.prop, atRule: (parent as AtRule).name },
        }),
      ],
    };
  }

  if (parent === undefined || parent.type !== "rule") {
    return compiledProbe([], [], locationOf(declaration, url), { property: declaration.prop });
  }

  const rule = parent;

  const context = compileRuleContext(rule as Rule, url);

  if (context.context === null) {
    return compiledProbe([], context.diagnostics, locationOf(declaration, url), {
      property: declaration.prop,
    });
  }

  const diagnostics: Diagnostic[] = [];
  const siblings = ownDeclarations(rule as Rule).filter(
    (candidate) => matchKey(candidate.prop) === matchKey(declaration.prop),
  );

  if (winningDeclaration(siblings) !== declaration) {
    diagnostics.push(
      createDiagnostic("REPEATED_DECLARATION", {
        source: locationOf(declaration, url),
        details: { property: declaration.prop, count: siblings.length },
      }),
    );
  }

  return compiledProbe(
    [compileProperty(declaration, url)],
    diagnostics,
    locationOf(declaration, url),
    {
      property: declaration.prop,
    },
  );
}
