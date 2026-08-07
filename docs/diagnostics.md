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

This diagnostic fires when an annotation names the `watch` level. It tells you that `watch` is reserved for a future live mode and is not evaluated in this release. Use `log`, `info`, `warn`, or `error` instead.

## SOURCE_LOAD_FAILED

This diagnostic fires when a linked stylesheet fails to load. It tells you that css-console could not fetch the source, but not why: a cross-origin request without CORS access, a Content Security Policy restriction, and a network failure all surface as the same rejected fetch, so the underlying cause cannot be attributed with certainty. Check the network panel in developer tools for the specific failure, confirm that the stylesheet's origin grants CORS access if it is cross-origin, and confirm that no Content Security Policy directive blocks the request.

## SOURCE_HTTP_ERROR

This diagnostic fires when a linked stylesheet's request completes but the response carries an HTTP error status. Unlike `SOURCE_LOAD_FAILED`, this failure is distinguishable: the request reached the server and the server answered. It tells you the resource was reachable, and that css-console rejected it because the response status reports an error rather than success. Check that the URL is correct, that the resource exists at that URL, and what the reported status says about why the server refused it.

## NO_TARGET

This diagnostic fires when a css-console annotation comment has nothing to attach to: no style rule, no `@function` definition, and no declaration follows it in a position the grammar recognizes. It tells you the annotation is orphaned. Place it immediately before a style rule or an `@function` at-rule, or as a trailing comment after a declaration on the same line.

## UNKNOWN_LEVEL

This diagnostic fires when an annotation names a level outside the valid set `log`, `info`, `warn`, and `error`. It tells you the annotation was rejected before compilation. Replace the level with one of the four valid names.

## UNKNOWN_OPTION

This diagnostic fires when an annotation includes an option the grammar does not define. It tells you the annotation was rejected before compilation. The valid options are a property list and a `label`; remove or correct the unrecognized option.

## PROPERTY_LIST_ON_DECLARATION_PROBE

This diagnostic fires when a trailing declaration probe carries a property list. It tells you the property list is rejected as ambiguous, because a declaration probe already names its one property through its position in the source. Remove the property list from the annotation.

## PROPERTY_LIST_ON_FUNCTION_PROBE

This diagnostic fires when an annotation preceding an `@function` definition carries a property list. It tells you the property list is rejected because the function's call sites, not the annotation, determine which properties are reported. Remove the property list from the annotation.

## NO_CALL_SITES

This diagnostic fires when an annotated function has zero call sites across the scanned sources. It carries informational severity rather than warning or error severity, because a function with no call sites is not a mistake in the annotation; it tells you that the function you are probing is unused in the sources css-console scanned, which is itself a useful debugging answer.
