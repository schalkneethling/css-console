/**
 * Annotation inspector: a development tool, not part of the package.
 *
 * Point it at one or more stylesheets and it reports what css-console makes
 * of every annotation in them: which attached and to what, which were
 * rejected and why, and which comments it ignored entirely. It exists so the
 * annotation grammar and the target model can be tried against real CSS now,
 * while both are still cheap to change, rather than after the browser
 * evaluator lands and freezes them.
 *
 * It reports what the parser and the association pass see. No CSS is
 * evaluated, no browser is involved, and no value is resolved: those are
 * Phase 2. A rule probe listed here means the annotation found its target,
 * not that a value was read from an element.
 *
 * Usage:
 *
 *   node scripts/inspect-annotations.ts <file.css> [more.css ...]
 *   vp run inspect:annotations -- test/fixtures/representative/card-components.css
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { associateAnnotations } from "../src/core/annotations/index.ts";
import type { AssociatedAnnotation } from "../src/core/annotations/index.ts";
import type { Diagnostic, SourceLocation } from "../src/core/records/index.ts";

/** Formats a location as the line:column pair an editor jumps to. */
function position(source: SourceLocation): string {
  return `${source.start.line}:${source.start.column}`;
}

/** Describes what an annotation attached to, in the terms the plan uses. */
function describeTarget(associated: AssociatedAnnotation): string {
  const { target } = associated;

  return target.kind === "function"
    ? `function probe on @function ${target.functionName}`
    : `rule probe on ${target.selector}`;
}

/**
 * Describes the annotation itself: the log level it names, the properties it
 * asks for, and its label. A rule probe with no property list selects every
 * declaration in its rule, which is worth saying rather than showing as an
 * empty list.
 */
function describeAnnotation(associated: AssociatedAnnotation): string {
  const { logLevel, properties, label } = associated.annotation;
  const parts = [`level=${logLevel}`];

  parts.push(properties.length > 0 ? `properties=${properties.join(",")}` : "properties=all");

  if (label !== undefined) {
    parts.push(`label=${JSON.stringify(label)}`);
  }

  return parts.join("  ");
}

/**
 * Reports one diagnostic with its severity, code, position, and message. The
 * at-rule a tier diagnostic rejected is named alongside the code, because the
 * registry message describes the tier in general and the reader wants to know
 * which construct in their stylesheet triggered it.
 */
function describeDiagnostic(diagnostic: Diagnostic): string {
  const where = diagnostic.source === undefined ? "" : ` at ${position(diagnostic.source)}`;
  const atRule = diagnostic.details?.["atRule"];
  const subject = typeof atRule === "string" ? ` on @${atRule}` : "";

  return `  [${diagnostic.severity}] ${diagnostic.code}${where}${subject}\n      ${diagnostic.message}`;
}

/**
 * Inspects one stylesheet and prints its report. Returns the number of
 * error-severity diagnostics found, so the caller can set an exit code that
 * is useful in a pipeline without making a warning fail the run.
 */
function inspect(path: string): number {
  let css: string;

  try {
    css = readFileSync(path, "utf8");
  } catch (error) {
    console.error(`\n${path}\n  could not be read: ${(error as Error).message}`);
    return 1;
  }

  // The real runtime works from resolved URLs, so a file path becomes one
  // here rather than being reported as a bare path.
  const url = pathToFileURL(path).href;
  const { annotations, diagnostics } = associateAnnotations(css, { url });

  console.log(`\n${path}`);

  if (annotations.length === 0 && diagnostics.length === 0) {
    console.log("  no css-console annotations found");
    return 0;
  }

  if (annotations.length > 0) {
    console.log(`\n  attached (${annotations.length}):`);

    for (const associated of annotations) {
      console.log(`    ${position(associated.source)}  ${describeTarget(associated)}`);
      console.log(`      ${describeAnnotation(associated)}`);
    }
  }

  if (diagnostics.length > 0) {
    console.log(`\n  reported (${diagnostics.length}):`);

    for (const diagnostic of diagnostics) {
      console.log(describeDiagnostic(diagnostic));
    }
  }

  return diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
}

// `vp run inspect:annotations -- file.css` forwards the separator itself, so
// drop it rather than trying to read a file named "--".
const paths = process.argv.slice(2).filter((argument) => argument !== "--");

if (paths.length === 0) {
  console.error("usage: node scripts/inspect-annotations.ts <file.css> [more.css ...]");
  process.exit(64);
}

let errors = 0;

for (const path of paths) {
  errors += inspect(path);
}

console.log(
  `\nDeclaration probes are not associated yet, so a trailing annotation on a
declaration is silently skipped rather than reported. That lands with CSSC-007.
No CSS is evaluated here: this is the parser's view, not the browser's.`,
);

process.exit(errors > 0 ? 1 : 0);
