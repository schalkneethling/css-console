/**
 * Annotation association.
 *
 * This module answers one question per annotation comment: what does it
 * attach to? It implements the next-sibling half of the association rule the
 * parser selection record describes, which covers rule probes and function
 * probes. The previous-sibling half, which carries declaration probes, is
 * CSSC-007, so a trailing comment on a declaration is left untouched here
 * rather than reported as having no target: reporting it would be wrong, and
 * would have to be unreported one issue later.
 *
 * At-rule targets fall into three tiers, and the tiers are the reason this
 * module reports rather than simply skips. A browser gap, a tool-scope
 * limitation, and a by-design rejection are three different messages to an
 * author, and collapsing any two of them would tell someone to change CSS
 * that is already correct.
 */

import postcss from "postcss";
import type { AnyNode, ChildNode, Comment, Container, Document, Root } from "postcss";

import { createDiagnostic } from "../diagnostics/index.ts";
import type { Diagnostic, DiagnosticCode } from "../diagnostics/index.ts";
import type { SourceLocation } from "../records/index.ts";

import { parseAnnotation } from "./index.ts";
import type { ParsedAnnotation } from "./index.ts";

/**
 * At-rules whose specification exists and whose contract css-console has
 * designed, but which the current browser does not yet implement. An
 * annotation on one of these parses and then reports the browser gap.
 */
const RESERVED_AT_RULES = new Set(["mixin", "apply", "contents", "env"]);

/**
 * Grouping at-rules, which group other rules rather than declaring one.
 * These are not annotation targets by design, and the diagnostic carries the
 * remediation: annotate the rules inside.
 */
const GROUPING_AT_RULES = new Set(["media", "supports", "layer"]);

/** The one at-rule css-console compiles to a probe. */
const FUNCTION_AT_RULE = "function";

/**
 * What an annotation attached to. A style rule carries its selector as
 * authored, because nesting resolution is CSSC-010 and an unresolved selector
 * is the honest thing to carry until then. A function carries the name the
 * call sites will be matched against.
 */
export type AnnotationTarget =
  | { kind: "style-rule"; selector: string; source: SourceLocation }
  | { kind: "function"; functionName: string; source: SourceLocation };

/**
 * One annotation paired with the target it attached to. `source` is the
 * location of the annotation comment itself, which is what a diagnostic or a
 * console group needs to point at, while the target carries its own location.
 */
export type AssociatedAnnotation = {
  annotation: ParsedAnnotation;
  target: AnnotationTarget;
  source: SourceLocation;
};

/**
 * The outcome of associating every annotation in one source: the annotations
 * that attached, in source order, and every diagnostic the pass produced,
 * whether from the grammar or from an unusable target.
 */
export type AssociationResult = {
  annotations: readonly AssociatedAnnotation[];
  diagnostics: readonly Diagnostic[];
};

/** The options `associateAnnotations()` accepts. */
export type AssociateAnnotationsOptions = {
  url: string;
};

/**
 * Builds a source location for a node from its parser positions. PostCSS
 * reports one-based lines and columns, which is the convention the published
 * `SourcePosition` contract already follows, so the positions pass through
 * unchanged. A node with no end position falls back to its start, which
 * keeps the location usable rather than absent.
 */
function locationOf(node: AnyNode, url: string): SourceLocation {
  const start = node.source?.start ?? { line: 1, column: 1 };
  const end = node.source?.end ?? start;

  return {
    url,
    start: { line: start.line, column: start.column },
    end: { line: end.line, column: end.column },
  };
}

/**
 * Returns the node that follows a comment among its parent's children, or
 * undefined when the comment is the last child. Whitespace is not a node in
 * PostCSS, so whitespace-only separation needs no special handling: blank
 * lines between an annotation and its target simply do not appear here.
 */
function nextSibling(comment: Comment): ChildNode | undefined {
  const parent: Container | Document | undefined = comment.parent;

  if (parent === undefined) {
    return undefined;
  }

  const index = parent.index(comment);

  return parent.nodes?.at(index + 1);
}

/**
 * Reports whether a comment trails a declaration on that declaration's own
 * end line, which makes it a declaration probe and therefore CSSC-007's to
 * associate. This is the previous-sibling half of the association rule, and
 * it is recognised here only so those comments can be left alone: this module
 * deliberately does not attach them.
 */
function trailsDeclaration(comment: Comment): boolean {
  const parent: Container | Document | undefined = comment.parent;

  if (parent === undefined) {
    return false;
  }

  const previous = parent.nodes?.at(parent.index(comment) - 1);

  if (previous === undefined || previous.type !== "decl") {
    return false;
  }

  const declarationEnd = previous.source?.end?.line;
  const commentStart = comment.source?.start?.line;

  return (
    declarationEnd !== undefined && commentStart !== undefined && declarationEnd === commentStart
  );
}

/**
 * Reads the function name from an `@function` at-rule's parameters, which
 * are the name followed by the parameter list, as in `--space(--multiplier)`.
 */
function functionNameOf(params: string): string {
  const open = params.indexOf("(");

  return (open === -1 ? params : params.slice(0, open)).trim();
}

/**
 * Returns the diagnostic code an at-rule target produces, or undefined when
 * the at-rule is a supported target and therefore produces a probe instead.
 * An at-rule the target table does not name falls outside the supported set:
 * css-console does not compile a probe for it, which is a tool-scope
 * limitation rather than a browser gap.
 *
 * At-keywords are ASCII case-insensitive in CSS and PostCSS preserves the
 * case the author wrote, so the lookup normalises. Only the lookup: the name
 * a diagnostic reports stays exactly as authored, because an author searching
 * their stylesheet for what a diagnostic named should find it.
 */
function codeForAtRule(rawName: string): DiagnosticCode | undefined {
  const name = rawName.toLowerCase();

  if (name === FUNCTION_AT_RULE) {
    return undefined;
  }

  if (RESERVED_AT_RULES.has(name)) {
    return "RESERVED_PENDING_SUPPORT";
  }

  if (GROUPING_AT_RULES.has(name)) {
    return "NOT_A_TARGET";
  }

  return "OUTSIDE_SUPPORTED_TARGET_SET";
}

/**
 * Associates every annotation comment in one source with the target that
 * follows it.
 *
 * Comments that are not annotations are ignored, comments whose grammar the
 * parser rejects carry their diagnostic through with the comment's location
 * attached, and comments that trail a declaration are left for CSSC-007.
 * Everything else either attaches to a style rule or an `@function`
 * definition, or produces the diagnostic its target tier dictates.
 */
export function associateAnnotations(
  css: string,
  options: AssociateAnnotationsOptions,
): AssociationResult {
  const { url } = options;
  const root: Root = postcss.parse(css, { from: url });

  const annotations: AssociatedAnnotation[] = [];
  const diagnostics: Diagnostic[] = [];

  root.walkComments((comment) => {
    const parsed = parseAnnotation(comment.text, { source: locationOf(comment, url) });

    if (!parsed.ok) {
      if (parsed.reason === "rejected") {
        diagnostics.push(...parsed.diagnostics);
      }

      return;
    }

    if (trailsDeclaration(comment)) {
      // A declaration probe. CSSC-007 owns the previous-sibling rule, so
      // this comment is neither attached nor reported here.
      return;
    }

    const source = locationOf(comment, url);
    const target = nextSibling(comment);

    if (target === undefined || target.type === "comment" || target.type === "decl") {
      diagnostics.push(createDiagnostic("NO_TARGET", { source }));
      return;
    }

    if (target.type === "rule") {
      annotations.push({
        annotation: parsed.annotation,
        target: { kind: "style-rule", selector: target.selector, source: locationOf(target, url) },
        source,
      });

      return;
    }

    const code = codeForAtRule(target.name);

    if (code !== undefined) {
      diagnostics.push(createDiagnostic(code, { source, details: { atRule: target.name } }));
      return;
    }

    annotations.push({
      annotation: parsed.annotation,
      target: {
        kind: "function",
        functionName: functionNameOf(target.params),
        source: locationOf(target, url),
      },
      source,
    });
  });

  return { annotations, diagnostics };
}
