/**
 * Source discovery.
 *
 * A scan needs CSS text and a name for it before anything else can happen.
 * This module supplies both for inline `<style>` elements: it reads a live
 * tree, returns one source object per style element in document order, and
 * writes nothing anywhere. Linked stylesheets arrive with CSSC-025 and
 * explicit raw sources with CSSC-026, so `DiscoveredSource` is a union with
 * one member today and is expected to grow rather than to stay a single
 * shape.
 *
 * Discovery is only discovery. Nothing here compiles, fetches, or decides
 * whether a source applies. A `disabled` style element and a
 * `media="print"` style element are both returned, because whether a source
 * contributes is a question about the browser reading it rather than about
 * the tree containing it, and CSSC-027 answers it in one place for inline
 * and linked sources together. Filtering here would split that decision
 * across two modules and hide the print-media case from the gate that exists
 * to report it.
 *
 * ## The read-only guarantee
 *
 * The scanner never writes to the document (implementation plan section
 * 5.9). Every operation below is a read: `querySelectorAll()`,
 * `getAttribute()`, and `textContent`. That rules out the obvious way to
 * give a style element a stable name, which is to stamp an identifier onto
 * it, so identity is assembled from state the scanner owns and from the
 * content the element already has. test/browser/sources.test.ts asserts the
 * guarantee by serialization equality rather than by checking for the
 * attribute this module knows about, so a future write of any kind fails the
 * lane.
 *
 * ## Identity
 *
 * An identifier survives two different kinds of change, and each half of the
 * scheme handles one of them.
 *
 * A `WeakMap<HTMLStyleElement, string>` handles change within a page. Once an
 * element has been named, that name is reused for as long as the element and
 * the `SourceIdentity` both live, so moving a style element, inserting
 * another before it, or editing its text leaves reports about it comparable
 * across scans. A `WeakMap` is the right container because it holds the
 * element weakly: a style element removed from the document is collectable
 * even though the scanner named it once.
 *
 * A content hash handles change across page loads. A `WeakMap` is empty on
 * the first scan after a reload, and the elements in the new document are
 * different objects from the ones in the old, so nothing carries over except
 * the CSS text itself. Hashing that text means an anonymous style whose
 * content did not change is named the same way it was named before the
 * reload.
 *
 * Precedence is: an author-supplied identity attribute, then a name already
 * recorded for the element, then a generated `style-<hash>`. The attribute
 * wins outright because it is the only identity a human chose, and honoring
 * it below a recorded name would make the answer depend on whether a scan
 * had run before the attribute was read.
 *
 * ## The identity attribute
 *
 * The attribute is `data-css-console-source`. A `data-` attribute is the
 * only prefix HTML reserves for author use, and the project name in the rest
 * keeps it from colliding with another tool's convention. Its value, when
 * present and not empty, becomes the source identity verbatim: it is not
 * trimmed, normalized, prefixed, or hashed, because an author who names a
 * source is naming it for a report they intend to read. An attribute present
 * with an empty value is treated as absent rather than as a request for an
 * empty identifier, which is the reading that leaves a report legible.
 *
 * The attribute is read and never written. This module does not stamp it
 * onto an anonymous element after generating a name, and adding it would
 * break the read-only guarantee above.
 *
 * ## The hash
 *
 * The hash is FNV-1a over the UTF-16 code units of the CSS text, written out
 * here rather than taken from a dependency, because nothing under `src/`
 * imports a package outside the compiler's two parsers and a name for a
 * style element does not justify widening that rule.
 *
 * It is synchronous, which is a requirement and not a convenience. The
 * asynchronous alternative in a browser is `crypto.subtle.digest()`, and
 * awaiting it inside discovery would let the document change between reading
 * a style element's text and naming it, so a source could be named after
 * content it no longer carries. A scan has already awaited its stabilization
 * frame by the time discovery runs (CSSC-028); discovery itself must not
 * yield.
 *
 * The collision posture is stated plainly: this hash names a source so that
 * reports about it stay comparable, and it is not a security boundary and not
 * an integrity check. A collision between two different contents misnames a
 * source in a report; it cannot corrupt a scan, because the source object
 * carries the element and the text directly and nothing downstream looks a
 * source up by hash.
 *
 * Two byte-identical anonymous style elements therefore hash identically,
 * which is documented behavior rather than a defect. They are separated by a
 * counter appended to the second and later collisions, and that counter is
 * positional: it depends on document order within one discovery, so swapping
 * two identical elements swaps which one carries the suffix. Nothing can
 * distinguish them otherwise, because by construction they differ in nothing
 * this module reads. An author who needs them told apart supplies the
 * identity attribute.
 *
 * ## Where the state lives
 *
 * There is no module-level mutable state. The `WeakMap` and the set of names
 * already handed out live in a `SourceIdentity` object created by
 * `createSourceIdentity()`, and the caller passes it in. Two scanner
 * instances observing the same document must not share identity state: one
 * instance's scan would otherwise decide the other's identifiers, and
 * disposing one instance would leave names in a map the other still reads.
 * Making the state an argument also makes the stability claims testable,
 * because a test can create one identity to assert continuity and a second
 * to stand in for a reload.
 *
 * ## The synthesized URL
 *
 * `compileSource()` requires a `url`, and it uses it for diagnostic
 * locations and for probe identifiers. An inline style element has no URL,
 * so discovery synthesizes `inline:<id>`. The `inline:` scheme is not
 * registered and is not fetchable, so a synthesized URL can never be
 * confused with, or collide with, the URL of a linked stylesheet CSSC-025
 * fetches. Deriving it from the identifier rather than from the position
 * means the URL inherits every stability property the identifier has, which
 * is what keeps a diagnostic location comparable between two scans.
 */

/** The attribute an author sets to name an inline source. Read, never written. */
export const SOURCE_IDENTITY_ATTRIBUTE = "data-css-console-source";

/** The prefix of a generated inline source identifier. */
const GENERATED_IDENTITY_PREFIX = "style-";

/** The FNV-1a 32-bit offset basis. */
const FNV_OFFSET_BASIS = 0x81_1c_9d_c5;

/** The FNV-1a 32-bit prime. */
const FNV_PRIME = 0x01_00_01_93;

/** The radix generated identifiers render the hash in. */
const HASH_RADIX = 36;

/**
 * A discovered inline `<style>` element, named and ready for compilation.
 *
 * The element is the live node rather than a copy of it, so a later pass can
 * read its `media` and `disabled` state without searching the tree again.
 * The `css` field is the text as it read at the moment of discovery, which
 * is the text the identifier was computed from.
 */
export type StyleElementSource = {
  readonly kind: "style-element";
  readonly id: string;
  readonly url: string;
  readonly css: string;
  readonly element: HTMLStyleElement;
};

/**
 * Any source a scan can compile. One member today; CSSC-025 adds linked
 * stylesheets and CSSC-026 adds explicit raw sources, and the `kind` field
 * is what a consumer discriminates on.
 */
export type DiscoveredSource = StyleElementSource;

/**
 * The identity state one scanner instance owns. Created by
 * `createSourceIdentity()`, passed to every discovery that instance runs,
 * and shared with no other instance; see the module doc comment for why the
 * state is not module-level.
 */
export type SourceIdentity = {
  /** Names already given to elements this identity has seen. */
  readonly names: WeakMap<HTMLStyleElement, string>;
};

/**
 * Creates the identity state for one scanner instance.
 *
 * Each call returns independent state, so two scanners observing the same
 * document name its style elements without either one affecting the other.
 */
export function createSourceIdentity(): SourceIdentity {
  return { names: new WeakMap<HTMLStyleElement, string>() };
}

/**
 * FNV-1a over the UTF-16 code units of a string, as an unsigned 32-bit
 * value rendered in base 36.
 *
 * Code units rather than bytes: the input is already a JavaScript string,
 * and hashing code units avoids an encoding step that would change nothing
 * about how well the result distinguishes two stylesheets. The result names
 * a source and secures nothing, as the module doc comment states.
 */
function hashText(text: string): string {
  let hash = FNV_OFFSET_BASIS;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    // `Math.imul()` keeps the multiplication in 32 bits. A plain `*` would
    // exceed the exactly representable range of a double and silently lose
    // low-order bits, which is the difference between FNV-1a and something
    // that merely resembles it.
    hash = Math.imul(hash, FNV_PRIME);
  }

  return (hash >>> 0).toString(HASH_RADIX);
}

/**
 * The identity an author supplied for an element, or `undefined` when the
 * author supplied none. An attribute present with an empty value counts as
 * none.
 */
function authoredIdentity(element: HTMLStyleElement): string | undefined {
  const value = element.getAttribute(SOURCE_IDENTITY_ATTRIBUTE);

  return value === null || value === "" ? undefined : value;
}

/**
 * The first identifier of the `base`, `base-2`, `base-3` sequence that no
 * other source in this discovery has taken.
 *
 * The counter starts at two rather than one so that the common case, a style
 * element whose content is unique on the page, is named by its hash alone.
 */
function disambiguate(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) {
    return base;
  }

  let counter = 2;

  while (taken.has(`${base}-${counter}`)) {
    counter += 1;
  }

  return `${base}-${counter}`;
}

/**
 * Discovers every `<style>` element under `root`, in document order, and
 * names each one.
 *
 * The tree is read twice on purpose. The first pass reserves the identifiers
 * that are already decided, which are the author-supplied ones and the ones
 * this identity recorded on an earlier discovery, and the second pass
 * generates the rest around them. One pass would let an anonymous element
 * take the hash that a later element in the list already owns, and the
 * earlier element would then win the name that was not its to take.
 *
 * `root` is searched with `querySelectorAll()`, which reports descendants
 * only, so a `root` that is itself a style element is not among the results.
 * A scan passes a `Document`, where the distinction cannot arise.
 *
 * Every style element is returned, including disabled and print-media ones.
 * Gating is CSSC-027.
 */
export function discoverStyleSources(
  root: Document | ParentNode,
  identity: SourceIdentity,
): readonly StyleElementSource[] {
  const elements = [...root.querySelectorAll("style")];
  const resolved = new Map<HTMLStyleElement, string>();
  const taken = new Set<string>();

  for (const element of elements) {
    const decided = authoredIdentity(element) ?? identity.names.get(element);

    if (decided !== undefined) {
      resolved.set(element, decided);
      taken.add(decided);
    }
  }

  return elements.map((element) => {
    const css = element.textContent ?? "";
    let id = resolved.get(element);

    if (id === undefined) {
      id = disambiguate(`${GENERATED_IDENTITY_PREFIX}${hashText(css)}`, taken);
      taken.add(id);
      identity.names.set(element, id);
    }

    return { kind: "style-element", id, url: `inline:${id}`, css, element } as const;
  });
}
