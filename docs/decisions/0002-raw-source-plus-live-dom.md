# Raw source plus live DOM

Status: accepted
Date: 2026-07-25
Issue: CSSC-001

## Context

Annotations are CSS comments, and comments are unavailable through the CSS Object Model. At the same time, only the live document can answer which elements a selector matches and what value the browser resolved for each one.

## Decision

The runtime parses original stylesheet source text for annotations, selectors, and authored values, and queries the live DOM for matching and resolved values. Core never touches the DOM, and the browser layer never reconstructs authored values from the CSS Object Model.

## Alternatives considered

- Read everything through the CSS Object Model. Rejected, because comments do not survive into it, and shorthand serialization loses the authored form.
- Parse source text for values too, emulating the browser. Rejected, because the browser engine is the only trustworthy source of resolved values, and emulation is the false-confidence failure mode.

## Consequences

Source loading becomes a distinct responsibility with its own failure model: inline `<style>` elements, same-origin linked stylesheets fetched as text, and explicit raw sources. Cross-origin stylesheets without CORS access are unreachable, which is accepted and diagnosed rather than worked around.
