# 0016 — Live probes as an option, not a log level

This record decides the authoring surface for live mode, ahead of any implementation: liveness is expressed through a `live="..."` annotation option, the reserved `watch` log level is retired without an alias, and `live="all"` is the starting vocabulary.

## Status

Accepted, 2026-08-31. Decided in issue [#68](https://github.com/schalkneethling/css-console/issues/68), raised during the Phase 4 usability validation.

## Context

Live mode is deferred by choice, not absent: the implementation plan reserves a live scan scheduler (CSSC-110), mutation-driven watches (CSSC-111), resize-driven watches (CSSC-112), media-query watches (CSSC-113), and value diffs (CSSC-114). Since the grammar was designed, the `watch` log level has been the reserved spelling for it, producing the `WATCH_RESERVED` diagnostic in v0.

Two facts collided when the validation pass asked for live updates on a container-unit probe. First, the published record contract states that log levels map onto Console API methods and carry no assertion or control-flow semantics, and record 0007 leans on that purity: a level answers "which console method renders this" and nothing else. A `watch` level would be control flow — it changes when scanning happens — so shipping it would amend a promise three published surfaces make. Second, a level occupies the slot that chooses the rendering method, so a `watch` level could never compose with `warn` or `error`: every live probe would render through whichever single method the adapter picked for `watch`, forever, and a live watch on a contested value rendered through `console.warn()` is precisely the kind of combination live mode exists for.

The grammar today defines exactly one named option, `label="..."`, and the project holds the grammar deliberately small. Any addition has to reuse the shape that exists rather than invent a second one.

## Decision

Liveness is an annotation option in the `label="..."` shape:

- `live="all"` is the starting vocabulary. It requests every trigger the installed release implements, and that is a deliberately growing promise: an annotation carrying `live="all"` written when resize and media-query watches exist also opts into mutation watches when those ship. "All" means all, across versions, and an author who wants less names less.
- The value expands into a comma-separated trigger list as the machinery lands: `live="resize"`, `live="media"`, and `live="resize, media"` name the watches of CSSC-112 and CSSC-113, and `live="mutation"` names CSSC-111. Trigger tokens are validated against a registry at compile time, an unknown token is a diagnostic rather than a silent no-op, and a repeated `live` option is already `DUPLICATE_OPTION`.
- The option composes with every log level, because the level keeps answering only "which console method renders this": `error font-size live="all"` is a live probe that renders loudly, and nothing about liveness constrains the level or the reverse.
- The `watch` log level is retired, not aliased. There is no backwards-compatible story to honor — nothing has shipped — so keeping a second spelling would spend grammar budget on sugar. `WATCH_RESERVED` leaves the diagnostic registry, `watch` becomes an unknown log level like any other, and the log-level documentation drops the reservation. The retirement is a small change that must land before the first live-mode implementation, so that no release ever accepts `watch`.
- Until CSSC-110 lands, `live="..."` needs no reservation machinery of its own: the grammar already rejects unknown options with `UNKNOWN_OPTION`, so the spelling fails loudly today, exactly as `watch` did.

The rendering of repeated reports is out of scope here and belongs to CSSC-114: a live probe re-rendering a full group on every resize would flood the console, and "changed from X to Y" is the useful shape of a live report. This syntax decision constrains none of that; it only guarantees the annotation surface will not need to change again when diff rendering arrives.

## Alternatives considered

**`watch` as a log level**, the original reservation. Rejected because it breaks the published promise that levels carry no control-flow semantics, because it confiscates the rendering-method choice from every live probe, and because one keyword cannot name which trigger an author wants once the watch kinds differentiate — a trigger option would become necessary anyway, at which point the level bought nothing.

**`watch` as sugar expanding to a default level plus the option.** Rejected with the retirement: two spellings for one behavior against a deliberately small grammar, justified only by a compatibility story that does not exist yet.

**A bare `live` flag.** Rejected because the grammar has no bare-flag shape — `label="..."` is a quoted `name="value"` option — and introducing one is a larger grammar change than the feature needs. The quoted form also provides the value slot the trigger list requires.

**`live=true` as a boolean.** Rejected because "true" says nothing about scope and would need a deprecation story the moment trigger tokens arrive. `live="all"` is the same length, carries meaning, and is already the shape the trigger list needs.

## Consequences

- The `LogLevel` contract and record 0007 stand unamended, and the adapter's level-to-method mapping never gains a special case.
- The grammar gains its second named option when live mode lands, in the shape the first one established, and the option registry becomes the place trigger vocabulary grows.
- `WATCH_RESERVED` must be removed from the registry, its documentation section retired, and the grammar tests updated, before any live-mode work ships — a standalone change, small enough to land at any point before CSSC-110.
- `live="all"` written against v0 produces `UNKNOWN_OPTION`, which is correct and requires no code until CSSC-110; the usage documentation should name the decided spelling when it next changes, so authors reading ahead learn the future syntax from the docs rather than from this record.
- An annotation carrying `live="all"` changes behavior across releases as triggers ship. That is the documented meaning of "all", and an author who needs version-stable behavior names explicit triggers instead.
