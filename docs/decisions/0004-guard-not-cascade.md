# Guard rather than cascade feature

Status: accepted
Date: 2026-07-25
Issue: CSSC-001

## Context

Pairing an authored value with a resolved value implies a causal relationship that holds only when the annotated declaration actually produced that value. Presenting the pair without qualification is the tool's most dangerous failure mode, because it is silent and points the reader at the wrong declaration. Full cascade provenance fails the litmus test, because developer tools already answer which declaration won.

## Decision

The tool ships a guard, not a cascade engine. The guard answers one boolean question: may something other than the annotated source have produced this value? It reports `contested` with a list of reasons: `competing-declaration`, `inline-style`, `important`, `animation-or-transition`, and `unresolved-variable`. It produces no counts, locations, specificity, or ranking. When the guard fires, the remediation is the live element in the console, one click from developer tools.

## Alternatives considered

- Full cascade provenance in v0. Rejected by the litmus test; it is documented in the out-of-reach list as work only the engine can do well.
- No guard at all. Rejected, because the false-causation failure mode is silent and common on real pages.

## Consequences

Competition detection needs shorthand, `all`, and logical-property expansion to be reliable on ordinary CSS, and expansion stays boolean in shape. The guard index stores only what a boolean answer needs. Full cascade provenance remains on the post-v0 horizon as CSSC-106 in the previous plan revision and as engine-level work in the capability write-up.
