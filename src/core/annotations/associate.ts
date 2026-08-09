/**
 * Annotation association.
 *
 * This module answers one question per annotation comment: what does it
 * attach to? It implements both halves of the association rule the parser
 * selection record describes. The next sibling carries rule probes and
 * function probes; the previous sibling, on the annotation's own line,
 * carries declaration probes.
 *
 * One pass over the comments serves both, which is what keeps the two rules
 * from disagreeing about the same comment. A comment that trails a
 * declaration is a declaration probe and is never also read as preceding
 * whatever follows it.
 *
 * At-rule targets fall into three tiers, and the tiers are the reason this
 * module reports rather than simply skips. A browser gap, a tool-scope
 * limitation, and a by-design rejection are three different messages to an
 * author, and collapsing any two of them would tell someone to change CSS
 * that is already correct.
 */

import postcss from "postcss";
import type { AnyNode, ChildNode, Comment, Container, Declaration, Document, Root } from "postcss";

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
 * call sites will be matched against. A declaration carries the one property
 * it names, which is why a declaration probe rejects a property list.
 */
export type AnnotationTarget =
  | { kind: "style-rule"; selector: string; source: SourceLocation }
  | { kind: "function"; functionName: string; source: SourceLocation }
  | { kind: "declaration"; property: string; source: SourceLocation };

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
 * Returns the declaration a comment trails, or undefined when it trails none.
 *
 * This is the previous-sibling half of the association rule: the annotation
 * must be the next non-whitespace token after the declaration's end position,
 * on the same line as that end position. The end position is the terminating
 * semicolon where one exists and the final token of the value where it does
 * not, and PostCSS reports both the same way, so the omitted-semicolon case
 * needs no handling of its own.
 *
 * Requiring the previous sibling to be the declaration is what makes "next
 * token" true rather than approximately true: an unrelated comment between
 * the declaration and the annotation takes that position instead, and the
 * annotation no longer trails anything.
 *
 * The line comparison is what separates a probe from a comment about the
 * declaration below it. A value spanning many lines still ends on one line,
 * so a multi-line value needs no handling of its own either.
 */
function trailedDeclaration(comment: Comment): Declaration | undefined {
  const parent: Container | Document | undefined = comment.parent;

  if (parent === undefined) {
    return undefined;
  }

  const previous = parent.nodes?.at(parent.index(comment) - 1);

  if (previous === undefined || previous.type !== "decl") {
    return undefined;
  }

  const declarationEnd = previous.source?.end?.line;
  const commentStart = comment.source?.start?.line;

  if (declarationEnd === undefined || commentStart === undefined) {
    return undefined;
  }

  return declarationEnd === commentStart ? previous : undefined;
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
 * Comments that are not annotations are ignored, and comments whose grammar
 * the parser rejects carry their diagnostic through with the comment's
 * location attached. A comment that trails a declaration on that
 * declaration's own line attaches to it; everything else attaches to the node
 * that follows it, or produces the diagnostic its target dictates.
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

    const source = locationOf(comment, url);
    const declaration = trailedDeclaration(comment);

    if (declaration !== undefined) {
      if (parsed.annotation.properties.length > 0) {
        // A declaration probe already names its one property through its
        // position in the source, so a property list cannot be honoured
        // without guessing which of the two the author meant.
        diagnostics.push(createDiagnostic("PROPERTY_LIST_ON_DECLARATION_PROBE", { source }));
        return;
      }

      annotations.push({
        annotation: parsed.annotation,
        target: {
          kind: "declaration",
          property: declaration.prop,
          source: locationOf(declaration, url),
        },
        source,
      });

      return;
    }

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
