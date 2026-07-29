# 0004 — Guard as a guard rather than a cascade feature

This record explains why cascade awareness exists only as a boolean honesty check and never as cascade resolution.

## Status

Accepted, 2026-07-26.

## Context

A probe reads a resolved value from `getComputedStyle()` and presents it beside an annotated declaration. Nothing in that read proves the annotated declaration produced the value. An inline style, an `!important` flag, a competing rule, a running animation, or an unresolved custom property can all mean the value arrived from somewhere else. Presenting such a value as though the annotation produced it would be misleading. At the same time, the litmus test rejects reimplementing cascade resolution, specificity ranking, and layer ordering, which developer tools already do and which page JavaScript cannot fully observe anyway.

## Decision

The guard exists so the tool never presents a value as though the annotated source produced it when something else may have. It does not resolve the cascade, rank declarations, or name a winner. When it fires, the remediation is the live element in the console, one click from developer tools.

The contract is deliberately small:

```ts
type GuardReason =
  | "competing-declaration"
  | "inline-style"
  | "important"
  | "animation-or-transition"
  | "unresolved-variable";

type ValueGuard = {
  contested: boolean;
  reasons: readonly GuardReason[];
};
```

`competing-declaration` requires shorthand and logical expansion to be reliable, because a guard that misses `margin` beating `margin-left`, or `width` beating `inline-size`, fails on ordinary CSS. It requires nothing beyond a boolean answer, so no counts, locations, or ranking are produced. `unresolved-variable` is checked directly, and the check accounts for fallbacks: for an authored value referencing `var(--x)` with no fallback, an empty result from `getPropertyValue("--x")` on that element means the reference fails and the declaration is invalid at computed-value time, so the value arrived by inheritance or from the initial value rather than from this declaration. A fallback changes the answer only when it saves the declaration: `color: var(--x, red)` with `--x` unset substitutes `red` and stays valid, while `color: var(--x, 10px)` is invalid at computed-value time despite its fallback, so the reported color arrives by inheritance or from the initial value all the same. Clearing the reason therefore requires verifying that the substituted fallback yields a valid value for the destination property, for example with `CSS.supports()` against the value after substitution, rather than observing that a fallback exists. CSSC-021 documents and tests the exact semantics the specification requires, including nested fallback chains.

## Alternatives considered

Full cascade resolution was rejected by the litmus test: it reimplements developer tools, and full cascade provenance is out of reach from page JavaScript in any case, because user-agent stylesheets, presentational hints, and origin ordering are not observable.

A richer guard reporting competitor counts, locations, or a ranked list was rejected because any ranking is a claim about the cascade, and a partially correct claim is worse than a handoff. The guard index accordingly stores what a boolean needs and nothing more.

No guard at all was rejected because a value presented as though the annotation produced it is the tool's central credibility risk, named as such in the risk table.

## Consequences

- Core builds property expansion tables, because competition detection on literal names misses shorthand and logical conflicts. Matching is bidirectional, and logical mapping resolves per element at evaluation time.
- Acceptance for guard evaluation states that no specificity, layer, or order comparison is performed anywhere.
- The usability checkpoint records whether anyone reads a contested guard as a claim about the cascade, and a misreading blocks the exit decision.
- The deliberately small guard also limits exposure to `@apply`, which will inject declarations absent from source text and is revisited under CSSC-101.
