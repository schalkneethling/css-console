# Architecture decision records

This directory records the architecture decisions behind CSS Console. Each record captures one decision at the time it was made, so that a future reader can see what was decided, why, what else was considered, and what follows from it.

## Format

Each record is one Markdown file with these sections:

- **Status**: `Accepted` with the decision date. A superseded record keeps its file and gains a note pointing to its replacement.
- **Context**: the situation and constraints that made a decision necessary.
- **Decision**: what was decided, stated in full.
- **Alternatives considered**: what else was on the table and why it was not chosen.
- **Consequences**: what the decision commits the project to, both the benefits and the costs.

Records follow the project's writing standards, described in the implementation plan under "Writing standards".

## Numbering

Files are numbered with a zero-padded four-digit prefix followed by a short slug, for example `0001-scope-principle-and-litmus-test.md`. Numbers are assigned in order of creation and are never reused. A new decision takes the next free number, even when it supersedes an earlier record.

## Index

| Record                                                             | Decision                                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------- |
| [0001](./0001-scope-principle-and-litmus-test.md)                  | Scope principle and litmus test                            |
| [0002](./0002-raw-source-plus-live-dom.md)                         | Raw source plus live DOM                                   |
| [0003](./0003-manual-nesting-resolution.md)                        | Manual nesting resolution rather than a transform pre-pass |
| [0004](./0004-guard-as-guard-not-cascade-feature.md)               | Guard as a guard rather than a cascade feature             |
| [0005](./0005-function-probes-as-third-probe-kind.md)              | Function probes as a third probe kind                      |
| [0006](./0006-pseudo-element-probes-in-v0.md)                      | Pseudo-element probes in v0                                |
| [0007](./0007-console-api-as-first-class-target.md)                | Console API as a first-class rendering target              |
| [0008](./0008-three-way-scope-split.md)                            | Three-way scope split                                      |
| [0009](./0009-three-tier-at-rule-target-model.md)                  | Three-tier at-rule target model                            |
| [0010](./0010-single-package-with-compiler-enforced-boundaries.md) | Single package with compiler-enforced boundaries           |
| [0011](./0011-type-rather-than-interface.md)                       | `type` rather than `interface` for public contracts        |
| [0012](./0012-relationship-to-css-expect.md)                       | Relationship to css-expect                                 |

The parser selection, PostCSS or css-tree, is deliberately absent. It is decided by the CSSC-002 spike and will be recorded here when that spike concludes.
