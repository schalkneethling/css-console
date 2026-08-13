/**
 * Probe compilation, and the composition that turns one source into probes.
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
 *
 * `compileSource()`, at the foot of this module, is the composition every
 * other module in core exists to serve: one CSS source in, and everything the
 * browser layer needs out. It lives here rather than in a module of its own
 * because it composes the two probe compilers this file already holds, and a
 * separate file would have to import them back from this one.
 */

export { splitSelectorBranches } from "./selector.ts";
export type { SelectorBranch, SelectorSplit } from "./selector.ts";

export { compileRuleContext } from "./rule-context.ts";
export type { RuleContext, RuleContextEntry, RuleContextResolution } from "./rule-context.ts";

export { resolveProbePlacement } from "./placement.ts";
export type { ProbePlacement } from "./placement.ts";

export {
  buildGuardIndex,
  competesInWritingMode,
  guardCandidates,
  indexedDeclarationOf,
} from "./guard-index.ts";
export type { GuardIndex, IndexedDeclaration } from "./guard-index.ts";

export {
  composeFunctionRecordProbeId,
  computeCallSiteIds,
  computeFunctionProbeId,
  computeValueProbeId,
  hashProbeParts,
  portableSource,
} from "./probe-id.ts";
export type { CallSiteIdentity, FunctionProbeIdentity, ValueProbeIdentity } from "./probe-id.ts";

import postcss from "postcss";
import type { AtRule, Declaration, Root, Rule } from "postcss";

import { createDiagnostic } from "../diagnostics/index.ts";
import type { Diagnostic } from "../diagnostics/index.ts";
import type { CallSite, LogLevel, SourceLocation } from "../records/index.ts";

import { associateAnnotations } from "../annotations/index.ts";
import type { AnnotationTarget, AssociatedAnnotation } from "../annotations/associate.ts";

import { propertyMatchKey } from "../expansion/index.ts";

import { resolveCallSites } from "../functions/index.ts";
import type { DefinitionReference, FunctionTarget } from "../functions/index.ts";

import { buildGuardIndex, indexedDeclarationOf } from "./guard-index.ts";
import type { GuardIndex, IndexedDeclaration } from "./guard-index.ts";
import { resolveProbePlacement } from "./placement.ts";
import type { ProbePlacement } from "./placement.ts";
import {
  composeFunctionRecordProbeId,
  computeCallSiteIds,
  computeFunctionProbeId,
  computeValueProbeId,
} from "./probe-id.ts";
import { compileRuleContext } from "./rule-context.ts";
import type { RuleContext } from "./rule-context.ts";
import { splitSelectorBranches } from "./selector.ts";
import type { SelectorBranch, SelectorSplit } from "./selector.ts";

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
 * The key a property name matches under, shared with property expansion so
 * that the compiler and the guard cannot key names differently. The compiled
 * property's `name` always carries the declaration's own authored spelling,
 * never this key.
 */
const matchKey = propertyMatchKey;

/**
 * Finds the rule a style-rule target names within a parsed tree. Matching by
 * selector alone is not enough, because CSS nesting can repeat a selector at
 * different depths, so the target's own source position disambiguates. The
 * position is exact rather than approximate, because association records the
 * position PostCSS reported for this exact rule.
 *
 * Exported because every caller that needs the rule behind a target needs it
 * found the same way. `compileSource()` resolves the rule's placement before
 * compiling its properties, and the probe inspector reports it; a second
 * spelling of "the rule this target names" would be free to disagree with
 * this one about a repeated selector, which is the case the position exists
 * to settle.
 */
export function findAnnotatedRule(root: Root, target: StyleRuleTarget): Rule | undefined {
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
  const rule = findAnnotatedRule(root, target);

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
export function findAnnotatedDeclaration(
  root: Root,
  target: DeclarationTarget,
): Declaration | undefined {
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
  const declaration = findAnnotatedDeclaration(root, target);

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

/**
 * One property a compiled probe covers, paired with the guard index entry for
 * the declaration it was compiled from.
 *
 * `indexed` is what lets the guard exclude a probe from itself. The index
 * holds one entry per declaration and `guardCandidates()` removes a named
 * entry from the candidate set by identity, so without the entry travelling
 * with the property, every probe would find its own declaration among its
 * competitors and report `contested` for a property nothing else declares.
 * The index is keyed on the parsed declaration node, which the browser layer
 * never sees, so the tie has to be made here or not at all.
 *
 * `null` means the declaration is absent from the index. Nothing in the
 * current pipeline reaches that state, because a probe is compiled only for a
 * rule `resolveProbePlacement()` accepts and the index holds every
 * declaration of every such rule, and the contract tests assert it stays
 * unreachable across the fixtures. It is typed rather than thrown because an
 * unreachable throw cannot be tested, and a field a test can check is worth
 * more than an exception nobody can trigger.
 */
export type CompiledProbeProperty = CompiledRuleProbeProperty & {
  indexed: IndexedDeclaration | null;
};

/**
 * One selector branch of a compiled value probe, carrying the probe
 * identifier the records matched through it publish.
 *
 * The identifier sits on the branch rather than on the probe because a value
 * probe's identity includes its pseudo-element (CSSC-015), and branches are
 * exactly where a pseudo-element is decided: `.card::before, .card` is one
 * probe with two branches that report against different boxes, so they are
 * two identities. The resolved selector, on the other hand, is the whole
 * flattened selector list rather than the branch's own text, matching the
 * identity contract, which names the selector nesting resolution produced.
 */
export type CompiledProbeBranch = SelectorBranch & {
  probeId: string;
};

/**
 * A compiled rule or declaration probe: where to look, under what conditions,
 * and for which properties.
 *
 * Both probe kinds compile to this one shape, which is the point CSSC-040
 * settled: a declaration probe is a rule probe whose single property is fixed
 * by position rather than chosen by a list, and nothing downstream should
 * have to ask which annotation produced a property. `kind` is `"value"`
 * because that is what the record it becomes is called (`ValueRecord`), so
 * the compiled discriminant and the published one are the same word.
 *
 * `annotation` is the location of the comment the author wrote, and `source`
 * the location of what it attached to: the rule for a rule probe and the
 * declaration for a declaration probe. Both are kept, because a console group
 * points at the annotation while a diagnostic about the target points at the
 * target.
 *
 * `branches` and `properties` are non-empty by construction. A probe with
 * neither an element to match nor a property to read is indistinguishable
 * from a probe the compiler never reached, which is the failure this project
 * has already paid for three times, so an annotation that compiles to
 * nothing produces diagnostics and no probe at all.
 */
export type CompiledValueProbe = {
  kind: "value";
  logLevel: LogLevel;
  label?: string;
  annotation: SourceLocation;
  source: SourceLocation;
  selector: string;
  branches: readonly [CompiledProbeBranch, ...CompiledProbeBranch[]];
  context: RuleContext;
  properties: readonly [CompiledProbeProperty, ...CompiledProbeProperty[]];
};

/**
 * One call site of a compiled function probe, carrying the identifier the
 * record for that call publishes. The identifier is the composed form
 * `FunctionRecord.probeId` publishes, function probe plus call site, so that
 * nothing downstream has to know the two halves exist.
 */
export type CompiledCallSite = CallSite & {
  probeId: string;
};

/**
 * A compiled function probe: the annotated definition, every call of it, and
 * every reference to it from inside another function's body.
 *
 * `callSites` may be empty, and this is the one compiled array that may be.
 * A function nothing calls is a useful debugging answer rather than a failure
 * (CSSC-013), and the `NO_CALL_SITES` diagnostic accompanying it is what
 * keeps the empty array from reading as silence.
 */
export type CompiledFunctionProbe = {
  kind: "function";
  probeId: string;
  logLevel: LogLevel;
  label?: string;
  functionName: string;
  annotation: SourceLocation;
  definition: SourceLocation;
  callSites: readonly CompiledCallSite[];
  definitionReferences: readonly DefinitionReference[];
};

/**
 * Every probe kind in one union, discriminated on `kind` with the same two
 * words `ProbeRecord` uses, so that a consumer switching over compiled probes
 * and a consumer switching over records switch over the same discriminant.
 */
export type CompiledProbe = CompiledValueProbe | CompiledFunctionProbe;

/**
 * The compiled form of one CSS source: every probe it carries, the guard
 * index over all of its declarations, and every diagnostic compiling it
 * produced.
 *
 * This is deliberately not a `ScanSummary`. A summary is the outcome of a
 * scan: it spans many sources, counts matches and evaluations, carries
 * records that hold live elements, and reports a duration. None of those are
 * compile-time facts. Compilation happens once per source, matches nothing,
 * evaluates nothing, and produces no records at all; a `durationMs` here
 * would time a parse, and `matches` would have to be zero. The browser layer
 * turns a set of these into a summary once it has a document, which is where
 * every one of those fields becomes answerable.
 */
export type CompiledSource = {
  url: string;
  probes: readonly CompiledProbe[];
  guardIndex: GuardIndex;
  diagnostics: readonly Diagnostic[];
};

/** The options `compileSource()` accepts. */
export type CompileSourceOptions = {
  url: string;
};

/** The outcome of compiling one annotation: a probe or nothing, plus why. */
type ProbeCompilation = {
  probe: CompiledProbe | null;
  diagnostics: readonly Diagnostic[];
};

/**
 * The key a declaration is found under when a compiled property is matched
 * back to the parsed declaration it came from. Property name plus exact start
 * position, which is the same disambiguation `findAnnotatedRule()` and
 * `findAnnotatedDeclaration()` use, because a property may be declared more
 * than once in one rule and the position is what tells the repeats apart.
 */
function declarationKey(property: string, start: { line: number; column: number }): string {
  return `${property} ${start.line}:${start.column}`;
}

/**
 * Pairs each compiled property with its guard index entry. See
 * `CompiledProbeProperty` for why the pairing has to happen here.
 */
function withGuardEntries(
  rule: Rule,
  index: GuardIndex,
  properties: readonly CompiledRuleProbeProperty[],
): CompiledProbeProperty[] {
  const declarations = new Map<string, Declaration>();

  for (const node of rule.nodes) {
    if (node.type !== "decl") {
      continue;
    }

    const start = node.source?.start;

    if (start !== undefined) {
      declarations.set(declarationKey(node.prop, start), node);
    }
  }

  return properties.map((property) => {
    const declaration = declarations.get(declarationKey(property.name, property.source.start));
    const indexed =
      declaration === undefined ? undefined : indexedDeclarationOf(index, declaration);

    return { ...property, indexed: indexed ?? null };
  });
}

/**
 * Assembles a value probe from the parts the two probe kinds compile to.
 *
 * The probe is dropped when it has no property or no branch, because a probe
 * that reads nothing or matches nothing tells an author nothing. Neither case
 * is silent: an empty property list arrives with the diagnostics
 * `CompiledRuleProbe` guarantees, and an empty branch list arrives with the
 * `MALFORMED_SELECTOR_LIST` or `DEFERRED_PSEUDO_ELEMENT` diagnostic that
 * emptied it.
 */
function assembleValueProbe(
  associated: AssociatedAnnotation,
  rule: Rule,
  index: GuardIndex,
  placement: Extract<ProbePlacement, { probed: true }>,
  split: SelectorSplit,
  compiled: CompiledRuleProbe,
  diagnostics: readonly Diagnostic[],
): ProbeCompilation {
  const [firstProperty, ...restProperties] = withGuardEntries(rule, index, compiled.properties);
  const names = compiled.properties.map((property) => property.name);
  const { url } = associated.target.source;

  const branches = split.branches.map((branch) => ({
    ...branch,
    probeId: computeValueProbeId({
      url,
      selector: placement.selector,
      pseudo: branch.pseudo,
      properties: names,
    }),
  }));

  const [firstBranch, ...restBranches] = branches;

  if (firstProperty === undefined || firstBranch === undefined) {
    return { probe: null, diagnostics };
  }

  const probe: CompiledValueProbe = {
    kind: "value",
    logLevel: associated.annotation.logLevel,
    annotation: associated.source,
    source: associated.target.source,
    selector: placement.selector,
    branches: [firstBranch, ...restBranches],
    context: placement.context,
    properties: [firstProperty, ...restProperties],
  };

  if (associated.annotation.label !== undefined) {
    probe.label = associated.annotation.label;
  }

  return { probe, diagnostics };
}

/**
 * Compiles a rule probe.
 *
 * Placement is resolved before anything else is compiled, which is what keeps
 * a rule this release cannot probe from producing a probe, and what keeps one
 * exclusion from being reported by two passes over the same rule. A rule
 * inside `@container` reports the exclusion once and compiles nothing.
 */
function compileStyleRuleProbe(
  root: Root,
  index: GuardIndex,
  associated: AssociatedAnnotation,
  target: StyleRuleTarget,
): ProbeCompilation {
  const { url } = target.source;
  const rule = findAnnotatedRule(root, target);

  if (rule === undefined) {
    throw new Error(
      `compileSource: no rule found for selector "${target.selector}" at ` +
        `${url}:${target.source.start.line}:${target.source.start.column}. The target and ` +
        "the parsed tree must come from the same source.",
    );
  }

  const placement = resolveProbePlacement(rule, url);

  if (!placement.probed) {
    return { probe: null, diagnostics: placement.diagnostics };
  }

  const compiled = compileRuleProbeProperties(root, target, associated.annotation.properties);
  const split = splitSelectorBranches(placement.selector, target.source);

  return assembleValueProbe(associated, rule, index, placement, split, compiled, [
    ...compiled.diagnostics,
    ...split.diagnostics,
  ]);
}

/**
 * Compiles a declaration probe.
 *
 * A declaration whose container is not a style rule, such as one inside
 * `@font-face` or `@property`, has no placement to resolve, so the
 * declaration compiler answers for it: it explains the descriptor at-rule in
 * terms an author can act on, which a rule-context diagnostic cannot.
 * Everything else resolves placement first, for the same reason a rule probe
 * does.
 */
function compileDeclarationTargetProbe(
  root: Root,
  index: GuardIndex,
  associated: AssociatedAnnotation,
  target: DeclarationTarget,
): ProbeCompilation {
  const { url } = target.source;
  const declaration = findAnnotatedDeclaration(root, target);

  if (declaration === undefined) {
    throw new Error(
      `compileSource: no declaration found for property "${target.property}" at ` +
        `${url}:${target.source.start.line}:${target.source.start.column}. The target and ` +
        "the parsed tree must come from the same source.",
    );
  }

  const parent = declaration.parent;

  if (parent === undefined || parent.type !== "rule") {
    return { probe: null, diagnostics: compileDeclarationProbe(root, target).diagnostics };
  }

  const rule = parent as Rule;
  const placement = resolveProbePlacement(rule, url);

  if (!placement.probed) {
    return { probe: null, diagnostics: placement.diagnostics };
  }

  const compiled = compileDeclarationProbe(root, target);
  const split = splitSelectorBranches(placement.selector, target.source);

  return assembleValueProbe(associated, rule, index, placement, split, compiled, [
    ...compiled.diagnostics,
    ...split.diagnostics,
  ]);
}

/**
 * Compiles a function probe.
 *
 * The probe is produced even when nothing calls the function, because "this
 * function has no call sites" is an answer rather than an absence, and the
 * `NO_CALL_SITES` diagnostic resolution already produced says so out loud.
 */
function compileFunctionProbe(
  root: Root,
  associated: AssociatedAnnotation,
  target: FunctionTarget,
): ProbeCompilation {
  const { url } = target.source;
  const resolution = resolveCallSites(root, target);
  const probeId = computeFunctionProbeId({ url, functionName: target.functionName });
  const callSiteIds = computeCallSiteIds(resolution.callSites);

  const callSites = resolution.callSites.map((callSite, position) => {
    const callSiteId = callSiteIds.at(position);

    return {
      ...callSite,
      probeId:
        callSiteId === undefined ? probeId : composeFunctionRecordProbeId(probeId, callSiteId),
    };
  });

  const probe: CompiledFunctionProbe = {
    kind: "function",
    probeId,
    logLevel: associated.annotation.logLevel,
    functionName: target.functionName,
    annotation: associated.source,
    definition: target.source,
    callSites,
    definitionReferences: resolution.definitionReferences,
  };

  if (associated.annotation.label !== undefined) {
    probe.label = associated.annotation.label;
  }

  return { probe, diagnostics: resolution.diagnostics };
}

/** Compiles one associated annotation, whichever kind of target it attached to. */
function compileAnnotation(
  root: Root,
  index: GuardIndex,
  associated: AssociatedAnnotation,
): ProbeCompilation {
  const { target } = associated;

  if (target.kind === "style-rule") {
    return compileStyleRuleProbe(root, index, associated, target);
  }

  if (target.kind === "declaration") {
    return compileDeclarationTargetProbe(root, index, associated, target);
  }

  return compileFunctionProbe(root, associated, target);
}

/**
 * Orders two diagnostics by where in the source they point.
 *
 * A diagnostic with no source describes the source as a whole rather than a
 * place in it, so it sorts ahead of every located one instead of being
 * ordered against a position it does not have.
 */
function bySourcePosition(first: Diagnostic, second: Diagnostic): number {
  const firstSource = first.source;
  const secondSource = second.source;

  if (firstSource === undefined) {
    return secondSource === undefined ? 0 : -1;
  }

  if (secondSource === undefined) {
    return 1;
  }

  return (
    firstSource.start.line - secondSource.start.line ||
    firstSource.start.column - secondSource.start.column
  );
}

/**
 * A key that is equal for two diagnostics a reader could not tell apart:
 * same code, same message, same location, same details. Details are keyed in
 * sorted order rather than by serialising the object directly, because two
 * modules building the same details from different literals would otherwise
 * produce different keys for the same fact.
 */
function diagnosticKey(diagnostic: Diagnostic): string {
  const { source, details } = diagnostic;
  const where =
    source === undefined
      ? ""
      : `${source.url}:${source.start.line}:${source.start.column}-${source.end.line}:${source.end.column}`;
  const detail =
    details === undefined
      ? ""
      : Object.keys(details)
          .sort()
          .map((key) => `${key}=${JSON.stringify(details[key])}`)
          .join(",");

  return [diagnostic.code, where, diagnostic.message, detail].join(" ");
}

/**
 * Orders a source's diagnostics for a consumer to print, and drops the
 * entries that repeat one another exactly.
 *
 * ## Order
 *
 * Source order, by the position each diagnostic points at, with ties left in
 * the order compilation produced them. `Array.prototype.sort()` is required
 * to be stable by ECMAScript, so equal positions keep that order rather than
 * an arbitrary one.
 *
 * The alternative was module order, which is what collecting them without
 * sorting would give: every annotation diagnostic, then every probe's, in the
 * order the compiler happens to run its passes. That order is an
 * implementation detail no author can predict, and it separates two
 * complaints about the same line by however many probes lie between them.
 * Grouping by probe was rejected for the same reason plus one more: a
 * diagnostic that prevents a probe from compiling has no probe to be grouped
 * under. An author reads a stylesheet from the top, and a list a consumer
 * prints should read the same way.
 *
 * ## Duplication
 *
 * De-duplication here is exact and narrow: an entry is dropped only when its
 * code, message, location, and details are all equal to an earlier entry's.
 * Two such entries are indistinguishable in any output a consumer can
 * produce, so keeping both prints one sentence twice.
 *
 * That case is real rather than hypothetical, and it is not the case that
 * usually gets raised. Several rules under one unresolvable ancestor are
 * *not* duplicates: `@container` wrapping three annotated rules reports three
 * `OUTSIDE_SUPPORTED_TARGET_SET` entries at three positions naming three
 * selectors, which are three distinct facts, and filtering them would hide
 * two rules an author asked about. The genuine duplicate comes from two
 * probes reaching one rule: two annotated functions both called from a rule
 * inside `@scope`, or a rule probe on a rule that also calls an annotated
 * function. Each pass reports that one rule's exclusion, at one position,
 * with identical details, and the rule is excluded once however many probes
 * discover it.
 *
 * The first entry is kept rather than the last, so the surviving diagnostic
 * is the one the earliest pass produced.
 */
function orderDiagnostics(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  const ordered = [...diagnostics].sort(bySourcePosition);
  const seen = new Set<string>();
  const unique: Diagnostic[] = [];

  for (const diagnostic of ordered) {
    const key = diagnosticKey(diagnostic);

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(diagnostic);
    }
  }

  return unique;
}

/**
 * Compiles one CSS source into everything the browser layer needs: every
 * probe the source's annotations produce, the guard index over all of its
 * declarations, and every diagnostic compiling it produced.
 *
 * This is the composition Phase 1 builds towards. Nothing here evaluates CSS:
 * selectors are resolved but never matched, conditions are recorded but never
 * tested, and values are read as authored but never resolved. What comes back
 * describes what a browser will be asked, not what it answered.
 *
 * The source is parsed once, and annotation association is handed the same
 * tree everything else compiles from, so the positions one pass records name
 * nodes another pass can find.
 *
 * A source PostCSS cannot parse throws, and the throw is deliberate. Fault
 * isolation is by source (implementation plan section 5.11), and the caller
 * that owns a set of sources is the one that can carry on with the rest;
 * there is no registered diagnostic for a malformed source, and inventing one
 * here would be guessing at the reporting Phase 3 has yet to specify.
 */
export function compileSource(css: string, options: CompileSourceOptions): CompiledSource {
  const { url } = options;
  const root = postcss.parse(css, { from: url });
  const association = associateAnnotations(css, { url, root });
  const guardIndex = buildGuardIndex(root, url);

  const probes: CompiledProbe[] = [];
  const diagnostics: Diagnostic[] = [...association.diagnostics];

  for (const associated of association.annotations) {
    const compilation = compileAnnotation(root, guardIndex, associated);

    if (compilation.probe !== null) {
      probes.push(compilation.probe);
    }

    diagnostics.push(...compilation.diagnostics);
  }

  return { url, probes, guardIndex, diagnostics: orderDiagnostics(diagnostics) };
}
