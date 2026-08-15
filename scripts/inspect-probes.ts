/**
 * Probe inspector: a development tool, not part of the package.
 *
 * Where `inspect-annotations.ts` answers "what did the annotation attach to",
 * this answers the next question: given that it attached, what would
 * css-console actually probe? It reports, per probe, the resolved selector,
 * the branches a matcher would query, the conditions the rule sits under, the
 * properties the probe covers with their `var()` dependencies, and, for a
 * function probe, every call site and definition reference.
 *
 * It calls `compileSource()` (CSSC-016) rather than composing the compiler by
 * hand. Until that function existed this script was a parallel implementation
 * of the same composition, which meant it could agree with itself while
 * disagreeing with the package; now what it prints is what a consumer gets,
 * and a defect it shows is a defect in the real API.
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

import { compileSource } from "../src/core/compiler/index.ts";
import type {
  CompiledFunctionProbe,
  CompiledSource,
  CompiledValueProbe,
  RuleContextEntry,
} from "../src/core/compiler/index.ts";
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

/** Reports one value probe: where the browser would look, and for what. */
function reportValueProbe(probe: CompiledValueProbe): void {
  console.log(`    resolved selector: ${probe.selector}`);

  if (probe.context.entries.length > 0) {
    console.log(`    conditions: ${probe.context.entries.map(renderContextEntry).join(" > ")}`);
  }

  for (const branch of probe.branches) {
    const pseudo = branch.pseudo === null ? "" : `  pseudo ${branch.pseudo}`;

    console.log(`    query: ${branch.selector}${pseudo}  ${branch.probeId}`);
  }

  for (const property of probe.properties) {
    const important = property.important ? " !important" : "";
    const references = property.customProperties.map((reference) => reference.name).join(", ");
    const depends = references === "" ? "" : `   depends on ${references}`;
    // A value may span many lines in the source, which reads as broken
    // indentation here. The authored text is preserved in the compiled
    // record; only this report collapses it onto one line.
    const authored = property.authored.replace(/\s+/gu, " ").trim();

    console.log(`    property ${property.name}: ${authored}${important}${depends}`);
  }
}

/** Reports one function probe: every call of it, and every reference to it. */
function reportFunctionProbe(probe: CompiledFunctionProbe): void {
  console.log(`    function: ${probe.functionName}  ${probe.probeId}`);

  for (const callSite of probe.callSites) {
    const sole = callSite.soleContribution ? "sole contribution" : "one contribution among others";

    console.log(
      `    call: ${callSite.selector} { ${callSite.property}: ` +
        `${probe.functionName}(${callSite.arguments.join(", ")}) }  ${sole}`,
    );
  }

  for (const reference of probe.definitionReferences) {
    console.log(
      `    reference: inside ${reference.functionName}, as ${reference.property}, at ` +
        `${position(reference.source)}`,
    );
  }
}

/** Reports one compiled source, returning the number of errors reported. */
function report(path: string, compiled: CompiledSource): number {
  console.log(`\n${path}`);

  let errors = 0;

  for (const diagnostic of compiled.diagnostics) {
    reportDiagnostic(diagnostic, "  ");
    errors += diagnostic.severity === "error" ? 1 : 0;
  }

  if (compiled.probes.length === 0) {
    console.log("  no probes compiled");
    return errors;
  }

  for (const probe of compiled.probes) {
    const label = probe.label === undefined ? "" : `  label ${probe.label}`;
    const kind = probe.kind === "value" ? "value" : "function";

    console.log(`\n  ${position(probe.annotation)}  ${kind} probe${label}`);

    if (probe.kind === "value") {
      reportValueProbe(probe);
      continue;
    }

    reportFunctionProbe(probe);
  }

  return errors;
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

  try {
    return report(path, compileSource(css, { url: pathToFileURL(path).href }));
  } catch (error) {
    // Malformed CSS is ordinary input for an inspection tool, so report it
    // the way an unreadable file is reported and carry on to the next path
    // rather than ending the run with a stack trace.
    console.error(`\n${path}\n  could not be compiled: ${(error as Error).message}`);
    return 1;
  }
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
