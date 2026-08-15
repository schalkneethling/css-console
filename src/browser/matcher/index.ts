/**
 * Selector branch matching.
 *
 * The compiler splits an annotated rule's selector list into branches and
 * matches none of them, because matching needs a document (see
 * ../../core/compiler/selector.ts). This module is the other half of that
 * split: it turns compiled branches into live elements, and it is the only
 * place in the pipeline where a selector meets the browser's selector engine.
 *
 * A branch carrying a pseudo-element is matched by its originating selector
 * alone. `SelectorBranch.selector` holds exactly that: `splitSelectorBranches()`
 * pushes `{ authored, selector: originating, pseudo }`, where `originating` is
 * the branch text preceding the pseudo-element, so `.card::before` arrives here
 * as the selector `.card` with the pseudo-element `::before`. The
 * pseudo-element never reaches `querySelectorAll()`; the evaluator passes it to
 * `getComputedStyle()` as its second argument (implementation plan section
 * 5.8), so this module only ever matches originating elements.
 *
 * Branches are queried one at a time rather than joined into one selector
 * list. Joining would be faster and would return document order for free, and
 * it is ruled out anyway: `querySelectorAll()` rejects a whole selector list
 * when any one selector in it is unparseable, so a single branch the engine
 * refuses would silence every valid branch beside it. The failure model
 * requires the opposite, because an invalid branch is a fact about that branch
 * alone (implementation plan section 5.11). Querying per branch also keeps the
 * branch that produced a match attached to it, which the evaluator needs for
 * the pseudo-element and the probe identifier.
 *
 * What the engine does with an unparseable selector was checked rather than
 * recalled. Read in the browser lane against headless Chromium 151.0.7922.34,
 * the version this project's Vitest browser project runs,
 * `document.querySelectorAll(":foo(")` and
 * `document.querySelectorAll(".card:not-a-real-pseudo-class")` both throw a
 * `DOMException` whose `name` is `SyntaxError`. Those values are pinned in
 * test/browser/matcher.test.ts, so an engine that answers differently fails
 * the lane rather than quietly changing what a probe reports.
 *
 * Nothing here writes to the document, which is the read-only guarantee
 * (implementation plan section 5.9). `querySelectorAll()` and
 * `compareDocumentPosition()` are both reads, and the returned matches carry
 * the live elements rather than copies of them.
 */

import { createDiagnostic } from "../../core/diagnostics/index.ts";
import type { Diagnostic } from "../../core/diagnostics/index.ts";
import type { CompiledProbeBranch } from "../../core/compiler/index.ts";

/**
 * One matched element paired with the branch that reached it. The branch
 * travels with the element rather than being looked up again, because the
 * evaluator needs the branch's pseudo-element to call `getComputedStyle()` and
 * its `probeId` to publish the record, and both are decided per branch.
 */
export type BranchMatch = {
  element: Element;
  branch: CompiledProbeBranch;
};

/**
 * The outcome of matching a probe's branches: the matches, in document order,
 * plus the diagnostics matching produced. Matches and diagnostics are returned
 * together rather than one being thrown, mirroring `SelectorSplit` in the
 * compiler, because a branch the engine rejects says nothing about the other
 * branches of the same selector.
 */
export type BranchMatchResult = {
  matches: readonly BranchMatch[];
  diagnostics: readonly Diagnostic[];
};

/**
 * One candidate match before deduplication and ordering. `order` is the index
 * of the branch that produced the match, which decides both attribution and
 * the ordering of two matches on one element.
 */
type CandidateMatch = BranchMatch & { order: number };

/**
 * The deduplication key for a match: the pseudo-element, or the empty string
 * for a branch that carries none. The key pairs with the element in a nested
 * map, so the identity of a match is the element and the pseudo-element
 * together. That is the pair the evaluator reads a declaration for, so
 * reporting it twice would report one box twice, while `.card` and
 * `.card::before` on one element are two boxes and stay two matches. The empty
 * string cannot collide with a pseudo-element, because a normalised
 * pseudo-element always begins with two colons.
 */
function pseudoKey(branch: CompiledProbeBranch): string {
  return branch.pseudo ?? "";
}

/**
 * Compares two elements by document order, which is the order the project
 * reports matches in. `compareDocumentPosition()` is the engine's own answer
 * to the question, so tree order is read from the document rather than
 * reconstructed from a traversal this module would have to keep correct.
 *
 * An ancestor sorts before a descendant, because Chromium sets
 * `DOCUMENT_POSITION_CONTAINED_BY` together with `DOCUMENT_POSITION_FOLLOWING`,
 * which is what tree order means. Two elements with no ordering relationship,
 * which is what a disconnected element would produce, compare as equal and
 * keep the order they were collected in.
 */
function compareDocumentOrder(first: Element, second: Element): number {
  if (first === second) {
    return 0;
  }

  const position = first.compareDocumentPosition(second);

  if ((position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) {
    return -1;
  }

  if ((position & Node.DOCUMENT_POSITION_PRECEDING) !== 0) {
    return 1;
  }

  return 0;
}

/**
 * Matches one probe's selector branches against a live document, returning the
 * matched elements in document order together with any diagnostics matching
 * produced.
 *
 * `root` defaults to `document`, so a scan covers the whole page, and a
 * narrower root restricts matching to that subtree. An element that is not
 * connected to `root` is never matched, and that needs no code: a
 * `querySelectorAll()` call on the document cannot reach a subtree the document
 * does not contain.
 *
 * A branch the engine cannot parse produces `UNPARSEABLE_SELECTOR_BRANCH` and
 * matches nothing, while every other branch still matches. The diagnostic
 * carries no source location, because a compiled branch records the selector
 * text rather than a position in the stylesheet; the branch as authored is what
 * identifies it, and the details field carries that text.
 *
 * One element reached by two branches that carry the same pseudo-element is
 * reported once, attributed to the earlier branch in the probe's branch order.
 * Attribution has to pick one branch, and the earlier branch is the one an
 * author reading the selector list encounters first, so `.card, div.card`
 * reports its match as `.card`. The identifiers the branches carry agree for
 * branches that share a pseudo-element, because a value probe's identity
 * includes its pseudo-element (CSSC-015), so the choice never changes the
 * reported `probeId`.
 */
export function matchBranches(
  branches: readonly CompiledProbeBranch[],
  root: ParentNode = document,
): BranchMatchResult {
  const byElement = new Map<Element, Map<string, CandidateMatch>>();
  const diagnostics: Diagnostic[] = [];

  for (const [order, branch] of branches.entries()) {
    let matched: NodeListOf<Element>;

    try {
      matched = root.querySelectorAll(branch.selector);
    } catch (error) {
      diagnostics.push(
        createDiagnostic("UNPARSEABLE_SELECTOR_BRANCH", {
          details: {
            branch: branch.authored,
            selector: branch.selector,
            reason: error instanceof DOMException ? error.name : String(error),
          },
        }),
      );
      continue;
    }

    for (const element of matched) {
      const byPseudo = byElement.get(element) ?? new Map<string, CandidateMatch>();
      const key = pseudoKey(branch);

      // The earlier branch wins, so a later branch reaching the same element
      // and pseudo-element is dropped rather than overwriting the attribution.
      if (!byPseudo.has(key)) {
        byPseudo.set(key, { element, branch, order });
      }

      byElement.set(element, byPseudo);
    }
  }

  const candidates: CandidateMatch[] = [];

  for (const byPseudo of byElement.values()) {
    candidates.push(...byPseudo.values());
  }

  candidates.sort((first, second) => {
    const byPosition = compareDocumentOrder(first.element, second.element);

    // Two matches on one element differ only in their pseudo-element, and
    // document order cannot separate them, so branch order decides.
    return byPosition === 0 ? first.order - second.order : byPosition;
  });

  return {
    matches: candidates.map(({ element, branch }) => ({ element, branch })),
    diagnostics,
  };
}
