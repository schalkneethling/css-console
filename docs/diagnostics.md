# Diagnostics

css-console reports every condition it detects through a diagnostic: an annotation the grammar rejects, an at-rule outside the supported target set, or a source that failed to load. The three-way scope split, recorded in [0008-three-way-scope-split.md](decisions/0008-three-way-scope-split.md), and the three-tier at-rule target model, recorded in [0009-three-tier-at-rule-target-model.md](decisions/0009-three-tier-at-rule-target-model.md), both depend on diagnostics staying distinguishable: a browser gap, a postponed feature, and a by-design rejection never share one code.

The diagnostic registry in `src/core/diagnostics/index.ts` is the source of truth for the codes this page documents. Each registry entry names a severity, a category, a default message, and the documentation anchor on this page. This page documents exactly the codes the registry defines, in both directions: a code without a section on this page, or a section without a matching code, is a defect.

## RESERVED_PENDING_SUPPORT

This diagnostic fires when an annotation targets a construct whose specification exists and whose contract css-console already designed, but the current browser does not yet implement it. It tells you that the annotation is valid and the tool understands it, but no record is produced until the browser ships support. There is nothing to fix in the annotation. Watch the linked follow-up issue, or check the browser's release notes, for when support lands.

## NOT_A_TARGET

This diagnostic fires when an annotation precedes a grouping construct, such as `@media`, `@supports`, or `@layer`, that groups other rules rather than declaring one. It tells you that the annotation has no rule of its own to attach to. Move the annotation to each rule inside the grouping construct instead of leaving it on the construct itself.

## OUTSIDE_SUPPORTED_TARGET_SET

This diagnostic fires when an annotation precedes an at-rule that css-console does not treat as an annotation target at all, such as `@keyframes` or `@container`. It tells you that the limitation is a tool-scope decision rather than a browser gap: the construct may be fully supported by the browser, but css-console does not compile a probe for it. Remove the annotation, or move it to a supported target such as a style rule or an `@function` definition.

## WATCH_RESERVED

This diagnostic fires when an annotation names the `watch` log level. It tells you that `watch` is reserved for a future live mode and is not evaluated in this release. Use `log`, `info`, `warn`, or `error` instead.

## SOURCE_LOAD_FAILED

This diagnostic fires when a linked stylesheet fails to load. It tells you that css-console could not fetch the source, but not why: a cross-origin request without CORS access, a Content Security Policy restriction, and a network failure all surface as the same rejected fetch, so the underlying cause cannot be attributed with certainty. Check the network panel in developer tools for the specific failure, confirm that the stylesheet's origin grants CORS access if it is cross-origin, and confirm that no Content Security Policy directive blocks the request.

## SOURCE_HTTP_ERROR

This diagnostic fires when a linked stylesheet's request completes but the response carries an HTTP error status. Unlike `SOURCE_LOAD_FAILED`, this failure is distinguishable: the request reached the server and the server answered. It tells you the resource was reachable, and that css-console rejected it because the response status reports an error rather than success. Check that the URL is correct, that the resource exists at that URL, and what the reported status indicates about the request or the resource.

## SOURCE_PARSE_FAILED

This diagnostic fires when a source fails to parse as CSS, such as an unclosed block or a stray closing brace. It tells you that fault isolation is by source: css-console reports the failure and continues with the rest of the scan rather than throwing, matching the failure model in the implementation plan section 5.11, so an unparseable source produces a diagnostic and an empty compilation rather than stopping every other source from being scanned. The `details` field carries the parser's own reason string, and the diagnostic's source location points at the position PostCSS reported for the failure. Correct the malformed CSS at that location; an unclosed block, an unmatched bracket, and an unexpected closing brace are the common causes.

## DUPLICATE_SOURCE_IDENTITY

This diagnostic fires when more than one source, discovered or explicit, carries the same identity. It tells you that a report naming this identifier is ambiguous: an author-supplied `data-css-console-source` attribute repeated on two style elements, two explicit raw sources given the same `id`, or any other combination of inline, linked, and raw sources that ends up sharing one identifier all produce this diagnostic, because a report cannot tell the sources apart once they share a name. It carries warning rather than error severity, because a duplicate identity does not stop a scan from running; it only makes the report about the affected sources ambiguous. The `details` field carries the shared `identity` and the `holders` count, so you can find every source that needs a distinct name. Rename the sources so that each identity belongs to exactly one of them.

## EMPTY_SOURCE_IDENTITY

This diagnostic fires when an explicit raw source is supplied with an empty `id`. It tells you that the input produced no source at all, rather than a source with an illegible name: css-console never generates a fallback identity for a raw source the way it does for an anonymous `<style>` element. The content-hash fallback exists to name a document node that has no author-chosen name, where a generated name is exactly as legible as a chosen one. A raw source has no associated DOM node, so css-console deliberately does not derive an identity by hashing the caller-supplied `css`: the caller is naming their own object, not a node discovery found, and an empty string is not a name. It carries error severity rather than warning severity, because unlike `DUPLICATE_SOURCE_IDENTITY` the input is dropped entirely and produces nothing to report on, matching how `SOURCE_PARSE_FAILED` is an error for a source that produces nothing. The `details` field carries the `index` of the failing input in the list supplied to `acceptRawSources()`, since an empty `id` cannot itself name which input failed. Supply a non-empty `id` for this source.

## NO_TARGET

This diagnostic fires when a css-console annotation comment has nothing to attach to: no style rule, no `@function` definition, and no declaration follows it in a position the grammar recognizes. It tells you the annotation is orphaned. Place it immediately before a style rule or an `@function` at-rule, or as a trailing comment after a declaration on the same line.

## UNKNOWN_LOG_LEVEL

This diagnostic fires when an annotation names a log level outside the valid set `log`, `info`, `warn`, and `error`. It tells you the annotation was rejected before compilation. Replace the log level with one of the four valid names.

## MISSING_LOG_LEVEL

This diagnostic fires when an annotation names the directive and the colon but no log level, as in `/* css-console: */` or `/* css-console: label="cards" */`. It tells you the annotation was rejected before compilation, and it is distinct from `UNKNOWN_LOG_LEVEL`, which fires when a log level is present but is not one of the four valid names. The log level is required and always comes first. Add `log`, `info`, `warn`, or `error` immediately after the colon.

## UNKNOWN_OPTION

This diagnostic fires when an annotation includes an option the grammar does not define. It tells you the annotation was rejected before compilation. The valid options are a property list and a `label`; remove or correct the unrecognized option.

## DUPLICATE_OPTION

This diagnostic fires when an annotation names the same option twice, such as two `label` options or two property lists. It tells you the annotation was rejected before compilation, because the intended value cannot be determined from a repeated option and guessing at one would report a probe you did not ask for. Remove the repeated option, keeping the one you meant.

## PROPERTY_LIST_ON_DECLARATION_PROBE

This diagnostic fires when a trailing declaration probe carries a property list. It tells you the property list is rejected as ambiguous, because a declaration probe already names its one property through its position in the source. Remove the property list from the annotation.

## PROPERTY_LIST_ON_FUNCTION_PROBE

This diagnostic fires when an annotation preceding an `@function` definition carries a property list. It tells you the property list is rejected because the function's call sites, not the annotation, determine which properties are reported. Remove the property list from the annotation.

## NO_CALL_SITES

This diagnostic fires when an annotated function has zero call sites across the scanned sources. It carries informational severity rather than warning or error severity, because a function with no call sites is not a mistake in the annotation; it tells you that the function you are probing is unused in the sources css-console scanned, which is itself a useful debugging answer.

## NO_PROBED_PROPERTIES

This diagnostic fires when an annotated rule declares no properties of its own, either because the rule is empty or because everything in it is a nested rule. It carries informational severity rather than warning or error severity, because it is not a mistake: it tells you that the probe compiled and covers nothing, which is a different answer from the probe never compiling at all. A probe on a rule whose declarations all live in nested rules is usually a sign the annotation belongs on one of those rules instead.

## MISSING_REQUESTED_PROPERTY

This diagnostic fires when a rule probe's property list names a property the rule does not declare. It carries warning rather than error severity, because the rest of the requested properties still compile and report; only the missing one is skipped. Check the property name for a typo, or confirm that the rule you annotated is the one that declares it.

## REPEATED_DECLARATION

This diagnostic fires when a property a rule probe covers is declared more than once in the same rule. It carries informational severity rather than warning or error severity, because the repeat is not a mistake in the annotation: the probe reports the last authored value, which is what the cascade resolves to within one rule. Check the rule if the repeat was unintentional.

## DEFERRED_PSEUDO_ELEMENT

This diagnostic fires when a branch of an annotated rule's selector carries a pseudo-element css-console does not probe in v0: `::part()` and `::slotted()`, which need shadow DOM, a chain such as `::before::marker`, a pseudo-element followed by anything else such as `::before:hover`, and any pseudo-element outside the supported set of `::before`, `::after`, `::marker`, `::first-line`, `::first-letter`, `::placeholder`, `::selection`, and `::backdrop`. It tells you the limitation is a tool-scope decision rather than a browser gap: the selector is valid CSS the browser applies, and only css-console's probe is postponed. The branch is skipped and the other branches of the same selector still report, so a rule listing both `.badge` and `.badge::part(label)` still reports `.badge`. The legacy single-colon spellings `:before`, `:after`, `:first-line`, and `:first-letter` are supported and do not fire this diagnostic; they are normalised to the double-colon form.

## MALFORMED_SELECTOR_LIST

This diagnostic fires when an annotated rule's selector list contains an empty branch, as in `.a, , .b` or a list left with a trailing comma. It carries error severity, and no branch of the list is probed at all. That is not a stricter reading than the browser's: a selector list is not forgiving, so one empty branch invalidates the entire list and the browser discards the whole rule, which means none of the branches that look well formed ever apply to anything either. Reporting them would attribute computed values to a rule that never ran. Remove the stray comma.

## INVALID_NESTING_SELECTOR

This diagnostic fires when a nested rule places something after the nesting selector that cannot continue a compound selector. The common case is the one the specification calls out by name: `&Bar` reads as string concatenation in a preprocessor, and in CSS it is invalid, because `Bar` is a type selector and a type selector must come first in its compound selector. It carries error severity, and the rule is not resolved at all, because the browser discards it: Chromium keeps `.foo { }` and drops the nested rule for `.foo { &Bar { } }`, and drops it for `.foo { &Bar, .baz { } }` too, so the well-formed branch beside it never applies to anything either. Write `Bar&` instead, and note that it does not mean what `&Bar` means in a preprocessor: nesting matches the elements the parent selector matches rather than joining the two names into one. The check applies only outside functional pseudo-classes, because a forgiving selector list absorbs the invalid argument on its own; Chromium keeps `.foo { :is(&div, .bar) { } }` and still matches `.bar`.

## DEFERRED_SCOPE_NESTING

This diagnostic fires when a rule sits inside `@scope`. It tells you the limitation is a tool-scope decision rather than a browser gap or invalid CSS. Inside `@scope` the nesting selector means something else: it behaves as `:where(:scope)`, and a nested rule with no nesting selector is prefixed with `:scope` rather than with the ancestor rule's selector. Both meanings depend on the scoping root, which cannot be written into the flat selector `querySelectorAll()` takes, so resolving as though `@scope` were absent would report values for elements the rule never styled. Move the annotation to a rule outside `@scope`, or wait for `@scope` support to land.

## INVALID_FUNCTION_BODY_RULE

This diagnostic fires when a style rule is authored inside an `@function` body, as in `@function --f() returns <color> { .inner { color: red; } result: blue; }`. It carries error severity, and the rule is not resolved at all, because the browser discards it: parsing that example in Chromium and reading the serialized `@function` rule back from the CSSOM shows `.inner` gone entirely, leaving only the empty body plus `result`. A function body declares custom properties, and may nest `@media` or `@supports` conditionals around further declarations, but a style rule has no element to match against inside a function, so there is nothing there for a probe to attach to. Move the rule outside the `@function` body.

## UNPARSEABLE_SELECTOR_BRANCH

This diagnostic fires when the browser's selector engine rejects a selector branch that the compiler accepted. Compile-time validation of a branch is textual, because the compiler has no document and therefore no selector engine to ask, so a branch such as `.card:not-a-real-pseudo-class` passes compilation and fails at match time: `querySelectorAll()` throws a `SyntaxError` `DOMException` for a selector it cannot parse, verified in Chromium 151.0.7922.34. It differs from `MALFORMED_SELECTOR_LIST`, which reports an empty branch found while parsing the selector list and discards the whole rule; this diagnostic reports one branch the engine refused, and every other branch of the same selector still matches. The `details` field names the branch as authored. Correct the branch, remembering that an unknown pseudo-class or an unclosed functional pseudo-class makes a selector unparseable rather than merely unmatched.
