/**
 * Probe inspector: a development tool, not part of the package.
 *
 * Where `inspect-annotations.ts` answers "what did the annotation attach to",
 * this answers the next question: given that it attached, what would
 * css-console actually probe? It runs the compiler over a stylesheet and
 * reports, per rule probe, the flattened selector, the branches a matcher
 * would query, the conditions the rule sits under, and the properties the
 * probe covers with their `var()` dependencies.
 *
 * It exists because the compiler produces nothing a person can look at until
 * CSSC-016 composes it and CSSC-029 makes it loadable in a browser. Being
 * able to point this at real CSS now, while the resolution rules are still
 * cheap to change, is worth more than reading the same answer out of a test.
 *
 * Nothing here is evaluated. Selectors are resolved but never matched,
 * conditions are recorded but never tested, and values are read as authored
 * but never resolved. Where a real browser would decide, this prints what it
 * would be asked.
 *
 * Usage:
 *
 *   node scripts/inspect-probes.ts <file.css> [more.css ...]
 *   vp run inspect:probes -- test/fixtures/representative/card-components.css
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import postcss from "postcss";
import type { Root, Rule } from "postcss";

import { associateAnnotations } from "../src/core/annotations/index.ts";
import type { AssociatedAnnotation } from "../src/core/annotations/index.ts";
import {
  compileDeclarationProbe,
  compileRuleContext,
  compileRuleProbeProperties,
  splitSelectorBranches,
} from "../src/core/compiler/index.ts";
import type {
  CompiledRuleProbe,
  RuleContextEntry,
  StyleRuleTarget,
} from "../src/core/compiler/index.ts";
import { resolveNestedSelector } from "../src/core/nesting/index.ts";
import type { Diagnostic, SourceLocation } from "../src/core/records/index.ts";

/** Formats a location as the line:column pair an editor jumps to. */
function position(source: SourceLocation): string {
  return `${source.start.line}:${source.start.column}`;
}

/** Reports one diagnostic on its own indented line. */
function reportDiagnostic(diagnostic: Diagnostic, indent: string): void {
  const where = diagnostic.source === undefined ? "" : ` at ${position(diagnostic.source)}`;

  console.log(`${indent}[${diagnostic.severity}] ${diagnostic.code}${where}`);
}

/** Renders one context entry the way an author would recognise it. */
function renderContextEntry(entry: RuleContextEntry): string {
  if (entry.kind === "layer") {
    return `@layer ${entry.name ?? "<anonymous>"}`;
  }

  return `@${entry.kind} ${entry.condition}`;
}

/**
 * Finds the rule a style-rule target names. The compiler locates it the same
 * way, by selector plus exact start position, because association records
 * positions rather than node identity.
 */
function findRule(root: Root, target: StyleRuleTarget): Rule | undefined {
  let found: Rule | undefined;

  root.walkRules((rule) => {
    if (
      found === undefined &&
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
 * Reports the properties a compiled probe covers, with the custom properties
 * each value depends on, and returns the number of errors reported. Shared by
 * both probe kinds, because they compile to the same property record.
 */
function reportProperties(compiled: CompiledRuleProbe, indent: string): number {
  let errors = 0;

  for (const diagnostic of compiled.diagnostics) {
    reportDiagnostic(diagnostic, indent);
    errors += diagnostic.severity === "error" ? 1 : 0;
  }

  for (const property of compiled.properties) {
    const important = property.important ? " !important" : "";
    const references = property.customProperties.map((reference) => reference.name).join(", ");
    const depends = references === "" ? "" : `   depends on ${references}`;
    // A value may span many lines in the source, which reads as broken
    // indentation here. The authored text is preserved in the compiled
    // record; only this report collapses it onto one line.
    const authored = property.authored.replace(/\s+/gu, " ").trim();

    console.log(`${indent}property ${property.name}: ${authored}${important}${depends}`);
  }

  return errors;
}

/**
 * Reports one rule probe: where the browser would look, under what
 * conditions, and for which properties.
 */
function reportRuleProbe(root: Root, associated: AssociatedAnnotation, url: string): number {
  const target = associated.target as StyleRuleTarget;
  const rule = findRule(root, target);

  console.log(`    authored selector: ${target.selector}`);

  if (rule === undefined) {
    console.log("    (could not be located in the parsed tree)");
    return 0;
  }

  let errors = 0;

  const context = compileRuleContext(rule, url);

  for (const diagnostic of context.diagnostics) {
    reportDiagnostic(diagnostic, "    ");
    errors += diagnostic.severity === "error" ? 1 : 0;
  }

  if (context.context !== null && context.context.entries.length > 0) {
    console.log(`    conditions: ${context.context.entries.map(renderContextEntry).join(" > ")}`);
  }

  const nesting = resolveNestedSelector(rule, url);

  for (const diagnostic of nesting.diagnostics) {
    reportDiagnostic(diagnostic, "    ");
    errors += diagnostic.severity === "error" ? 1 : 0;
  }

  if (nesting.selector !== null) {
    if (nesting.selector !== target.selector) {
      console.log(`    resolved selector: ${nesting.selector}`);
    }

    const split = splitSelectorBranches(nesting.selector, target.source);

    for (const diagnostic of split.diagnostics) {
      reportDiagnostic(diagnostic, "    ");
      errors += diagnostic.severity === "error" ? 1 : 0;
    }

    for (const branch of split.branches) {
      const pseudo = branch.pseudo === null ? "" : `  pseudo ${branch.pseudo}`;
      console.log(`    query: ${branch.selector}${pseudo}`);
    }
  }

  return (
    errors +
    reportProperties(
      compileRuleProbeProperties(root, target, associated.annotation.properties),
      "    ",
    )
  );
}

/** Inspects one stylesheet, returning the number of errors reported. */
function inspect(path: string): number {
  let css: string;

  try {
    css = readFileSync(path, "utf8");
  } catch (error) {
    console.error(`\n${path}\n  could not be read: ${(error as Error).message}`);
    return 1;
  }

  const url = pathToFileURL(path).href;

  let root: Root;
  let associated: ReturnType<typeof associateAnnotations>;

  try {
    root = postcss.parse(css, { from: url });
    associated = associateAnnotations(css, { url });
  } catch (error) {
    // Malformed CSS is ordinary input for an inspection tool, so report it
    // the way an unreadable file is reported and carry on to the next path
    // rather than ending the run with a stack trace.
    console.error(`\n${path}\n  could not be parsed: ${(error as Error).message}`);
    return 1;
  }

  const { annotations, diagnostics } = associated;

  console.log(`\n${path}`);

  let errors = 0;

  for (const diagnostic of diagnostics) {
    reportDiagnostic(diagnostic, "  ");
    errors += diagnostic.severity === "error" ? 1 : 0;
  }

  if (annotations.length === 0) {
    console.log("  no annotations attached");
    return errors;
  }

  for (const associated of annotations) {
    const { target } = associated;
    const label =
      associated.annotation.label === undefined ? "" : `  label ${associated.annotation.label}`;

    console.log(`\n  ${position(associated.source)}  ${target.kind} probe${label}`);

    if (target.kind === "style-rule") {
      errors += reportRuleProbe(root, associated, url);
      continue;
    }

    if (target.kind === "declaration") {
      console.log(`    declaration: ${target.property}`);
      errors += reportProperties(compileDeclarationProbe(root, target), "    ");
      continue;
    }

    // Call-site resolution is CSSC-013, so a function probe still has only
    // its association to show.
    console.log(`    function: ${target.functionName}`);
    console.log("    (call-site resolution has not landed yet)");
  }

  return errors;
}

// `vp run inspect:probes -- file.css` forwards the separator itself.
const paths = process.argv.slice(2).filter((argument) => argument !== "--");

// The exit code is set rather than `process.exit()` called, because stdout is
// written asynchronously when it is a pipe or a file and exiting outright can
// drop output that has not flushed. Letting the process end on its own is the
// difference between a report and a truncated one.
if (paths.length === 0) {
  console.error("usage: node scripts/inspect-probes.ts <file.css> [more.css ...]");
  process.exitCode = 64;
} else {
  let errors = 0;

  for (const path of paths) {
    errors += inspect(path);
  }

  console.log(
    `\nNothing above was evaluated. Selectors are resolved but never matched,
conditions are recorded but never tested, and values are read as authored
rather than resolved. This is what the browser would be asked, not answered.`,
  );

  process.exitCode = errors > 0 ? 1 : 0;
}
