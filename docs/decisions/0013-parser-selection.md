# Parser selection: PostCSS

Status: accepted
Date: 2026-07-25
Issue: CSSC-002

## Context

Annotation association lives or dies on comment fidelity, and the decisive case is the trailing comment on a final declaration with the semicolon omitted, as in `.note { color: red /* css-console: log */ }`. A parser that absorbs that comment into declaration raws cannot support declaration probes without workarounds. The candidates were PostCSS, which retains comment nodes with source positions, and css-tree, which offers a full value AST, a lexer, and mdn-data-backed syntax definitions that could serve call-site resolution and property expansion.

## Evidence

The spike in `scripts/parser-spike/` parses one fixture covering a rule-level comment, a trailing comment, a trailing comment after a multi-line value, and the omitted-semicolon case with both parsers. Run it with `node scripts/parser-spike/postcss.mjs` and `node scripts/parser-spike/csstree.mjs`.

PostCSS emits a first-class comment node for all four cases, each with exact start and end positions. In the decisive case the comment is a sibling of the declaration inside the rule, the declaration raws stay clean, and the rule carries `semicolon: false`. Association rules such as "immediately preceding comment" and "next non-whitespace token after the declaration end" operate on real tree structure.

css-tree keeps comments out of the tree entirely. They arrive only through the `onComment` parse callback as text plus a start position, so association would mean correlating a separate comment list against node locations. The three association rules become positional heuristics rather than tree facts, and the risk concentrates in exactly the decisive case.

Both parsers accept `@function` as a generic at-rule.

## Decision

The project parses with PostCSS.

## Alternatives considered

- css-tree, using `onComment` correlation for association. Rejected, because the hard requirement is comment fidelity inside the tree, and css-tree cannot provide it.
- A hybrid from the start: PostCSS for structure plus a value parser for declaration values. Deferred to CSSC-013 without commitment, because call-site resolution is the first consumer of value structure, and that issue should choose between postcss-value-parser and re-evaluating css-tree on the evidence of the parser work that precedes it.

## Consequences

The property expansion tables are hand-authored and versioned rather than derived from mdn-data, and CSSC-012 records how they are regenerated. css-tree remains part of the sibling vocabulary through css-property-type-validator, and the spike scripts stay in the repository as executable evidence. The loser cost is real: PostCSS declaration values are strings, so CSSC-013 must solve value parsing before call-site resolution.
