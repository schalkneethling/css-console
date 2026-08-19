/**
 * Source discovery and loading.
 *
 * A scan needs CSS text and a name for it before anything else can happen.
 * This module supplies both, for inline `<style>` elements and for
 * `<link rel="stylesheet">` elements: it reads a live tree, returns one
 * source object per element in document order, and writes nothing anywhere.
 * Explicit raw sources arrive with CSSC-026, so `DiscoveredSource` is a union
 * with two members today and is expected to grow rather than to settle.
 *
 * Discovery is only discovery. Nothing here compiles or decides whether a
 * source applies. A `disabled` style element and a `media="print"` style
 * element are both returned, because whether a source contributes is a
 * question about the browser reading it rather than about the tree
 * containing it, and CSSC-027 answers it in one place for inline and linked
 * sources together. Filtering here would split that decision across two
 * modules and hide the print-media case from the gate that exists to report
 * it.
 *
 * Fetching is separate from discovery for the same reason discovery is
 * separate from gating. `discoverLinkElements()` is synchronous and answers
 * which elements are stylesheet links; `loadLinkedSources()` is asynchronous
 * and answers what those links contain. Keeping the two apart means the gate
 * that CSSC-027 adds can decide against a link before anything is requested
 * for it, and it means the selection rule can be tested without a network at
 * all.
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
 * recorded for the element, then a generated one. The attribute wins outright
 * because it is the only identity a human chose, and honoring it below a
 * recorded name would make the answer depend on whether a scan had run before
 * the attribute was read. The generated name is where the two source kinds
 * differ: an inline style is named `style-<hash>` and a linked stylesheet is
 * named by its resolved URL, which needs no hash because it is already stable
 * across reloads by construction.
 *
 * A decided identifier is never rewritten, and that includes two elements
 * that decided on the same one: two style elements carrying the same
 * attribute value both keep it, verbatim. Suffixing the second claimant
 * would silently rename an identity a human chose, and which element lost
 * its name would depend on document order, so a report would attribute
 * findings to a name no author wrote without anyone being told. A duplicate
 * is an ambiguity to report rather than repair, and detecting one is a
 * check over the combined source set rather than a naming concern, so it is
 * a separate pass (CSSC-026). Only generated identifiers pass through
 * disambiguation, because an anonymous element has no chosen name to
 * preserve.
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
 * confused with, or collide with, the URL of a linked stylesheet. Deriving it
 * from the identifier rather than from the position means the URL inherits
 * every stability property the identifier has, which is what keeps a
 * diagnostic location comparable between two scans. A linked source needs no
 * synthesis: its URL is the URL it was fetched from.
 *
 * ## Which links are stylesheet links
 *
 * A link is selected when its `rel` attribute carries a `stylesheet` token
 * and its `href` attribute is present and not blank.
 *
 * The token comparison is ASCII case-insensitive and is done here rather than
 * through `relList`, and that is a correction of an assumption rather than a
 * preference. `DOMTokenList.contains()` matches a token exactly, so
 * `relList.contains("stylesheet")` answers `false` for `rel="StyleSheet"`,
 * while the engine applies that link: in headless Chromium 151.0.7922.34 a
 * `<link rel="StyleSheet">` pointing at a fixture stylesheet fires `load` and
 * exposes a `sheet` with the fixture's rules. Link relationship keywords are
 * ASCII case-insensitive, so `relList` is the wrong instrument for this
 * question and the tokens are lowercased here instead.
 * test/browser/linked-sources.test.ts pins both halves.
 *
 * `rel="alternate stylesheet"` is selected, because it carries the token.
 * Whether an alternate stylesheet is applied is a question about the browser
 * reading it rather than about the tree containing it, which is exactly the
 * question CSSC-027 owns for `disabled` and `media` alike, so refusing it
 * here would hide it from the gate that exists to report it.
 *
 * A blank `href` is skipped, and skipping it matters more than it looks.
 * Pinned rather than recalled: with no `href` attribute at all, the `href`
 * IDL attribute is the empty string, but with `href=""` it is the document's
 * own URL, so a loader that trusted the IDL attribute alone would request the
 * very page it is scanning and hand the resulting HTML to the compiler.
 *
 * ## Resolving a link's URL
 *
 * The URL comes from the `href` IDL attribute rather than from
 * `getAttribute("href")`. `href` is a URL-reflecting attribute, so the engine
 * has already resolved it against the element's base URL, including any
 * `<base>` element in the document; `getAttribute()` returns the authored
 * string unchanged. Reading the attribute would mean reimplementing base-URL
 * resolution, or leaving the resolution to whatever `fetch()` happened to
 * resolve a relative string against, which is the document of the realm the
 * call was made in rather than the document the link belongs to.
 *
 * ## Duplicate URLs
 *
 * Two links to one URL produce two sources and one request. The two halves of
 * that answer serve different readers. A report attributes a finding to the
 * link element that carried it, so collapsing two links into one source would
 * name the wrong element in half the reports; the network sees one URL
 * requested once, so fetching it twice would make the tool's cost depend on
 * duplication in the page. The two sources share their CSS text, and identity
 * separates them with the same positional counter inline discovery uses, so
 * the second is named `<url>-2`.
 *
 * ## Content type is not checked
 *
 * A `rel="stylesheet"` link pointing at something that is not CSS is loaded
 * like any other link, and this is a deliberate posture rather than an
 * omission. The recalled rule, that a browser in standards mode refuses to
 * apply a stylesheet whose `Content-Type` is not `text/css`, does not
 * describe what this engine does for a same-origin response: in headless
 * Chromium 151.0.7922.34, with `document.compatMode` reporting `CSS1Compat`,
 * a link to a same-origin `application/json` response fires `load` and
 * produces a `CSSStyleSheet` with zero rules.
 *
 * A loader that refused that response on content type would therefore report
 * a source the engine had accepted as one that failed, which is a worse
 * answer than loading it. Loading it costs nothing: a body that is not CSS
 * carries no annotation, so it compiles to no probe, and a body that is not
 * parseable as CSS is already reported by `compileSource()` as
 * `SOURCE_PARSE_FAILED` with a location. Whether the engine applied a
 * stylesheet at all is a gating question, and CSSC-027 is where it belongs.
 *
 * ## Reporting a failure
 *
 * Two codes cover the two failures that are worth telling apart.
 *
 * `SOURCE_HTTP_ERROR` reports a response that arrived and carried an error
 * status. That is a fact about a server that answered, so the diagnostic
 * carries the status and the status text in `details` and the reader knows
 * what to check.
 *
 * `SOURCE_LOAD_FAILED` reports a request that produced no response, and it
 * names likely causes rather than claiming one. A cross-origin request
 * without CORS access, a Content Security Policy refusal, and an unreachable
 * host all reject with a bare `TypeError`, by design, so that cross-origin
 * state does not leak to page JavaScript. Pinned rather than recalled: in
 * headless Chromium 151.0.7922.34, `fetch("https://cssc-025.invalid/x.css")`
 * rejects with a `TypeError` whose message is `Failed to fetch`, and the
 * error carries nothing else. Attributing one cause from that would be a
 * guess printed as a fact.
 *
 * Neither diagnostic carries a source location. `SOURCE_PARSE_FAILED` does,
 * because a parse failure happens at a position in text that exists; a
 * transport failure has no position, and synthesizing line 1 column 1 would
 * assert that a file was read as far as its first character when nothing was
 * read at all. The URL travels in `details` instead, where a reader can find
 * it and where nothing claims it points into CSS.
 *
 * A failure is reported once per URL rather than once per link, matching the
 * one-request-per-URL rule above: the diagnostic describes a request, and one
 * request was made.
 *
 * ## Fault isolation and abort
 *
 * Fault isolation is by source (implementation plan section 5.11). Every
 * request runs concurrently, one link's failure becomes a diagnostic in the
 * result, and no failure rejects the returned promise or keeps another link
 * or an inline style from loading.
 *
 * An abort is the exception, and it is not a failure of the page. When the
 * caller's `AbortSignal` fires, the returned promise rejects with the
 * `AbortError` the engine produced, and no `SOURCE_LOAD_FAILED` is reported
 * for the cancelled requests. Reporting the caller's own decision as a defect
 * in the document being scanned would put an error in a report for a scan
 * that the caller had already abandoned. An already-aborted signal rejects
 * before anything is requested. Pinned rather than recalled: in headless
 * Chromium 151.0.7922.34, a `fetch()` cancelled before it is issued and one
 * cancelled in flight both reject with an error whose `name` is
 * `AbortError`, which is what the abort check reads. It reads `name` rather
 * than using `instanceof`, following the same reasoning the compiler uses for
 * `CssSyntaxError`: an error that crossed a realm boundary, such as one from
 * an injected `fetch()` defined in another window, fails `instanceof` while
 * still carrying its name.
 *
 * ## The injectable fetch
 *
 * `loadLinkedSources()` accepts a `fetch` option, and the browser suite uses
 * it for one thing only: counting how many requests a load made. Everything
 * else there runs against the real network the Vitest dev server provides,
 * because a real 404, a real rejected cross-origin request, and a real abort
 * are evidence about the engine, while an injected response is evidence that
 * a fake and the implementation agree. The option exists because the page
 * cannot observe its own request count;
 * `performance.getEntriesByName()` reported no entry for a `fetch()` the
 * suite had just awaited, so resource timing could not answer it.
 */

import { createDiagnostic } from "../../core/diagnostics/index.ts";
import type { Diagnostic } from "../../core/diagnostics/index.ts";

/** The attribute an author sets to name a source. Read, never written. */
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
 * A loaded `<link rel="stylesheet">` element, named and ready for
 * compilation.
 *
 * The fields carry the same meanings they carry for an inline source, so a
 * consumer that has one shape has both. The element is the live node, so a
 * later pass can read its `media` and `disabled` state without searching the
 * tree again, and `css` is the response body as it read at the moment of
 * loading. `url` is the resolved absolute URL the body was fetched from,
 * which two sources share when two links point at one URL.
 */
export type LinkedSource = {
  readonly kind: "link-element";
  readonly id: string;
  readonly url: string;
  readonly css: string;
  readonly element: HTMLLinkElement;
};

/**
 * Any source a scan can compile. Two members today; CSSC-026 adds explicit
 * raw sources, and the `kind` field is what a consumer discriminates on.
 */
export type DiscoveredSource = StyleElementSource | LinkedSource;

/**
 * The options `loadLinkedSources()` accepts.
 *
 * `fetch` replaces the global used to request a stylesheet. It exists so that
 * a caller, in practice a test, can observe requests it cannot otherwise see;
 * see the module doc comment on why the browser suite uses the real network
 * for everything else.
 *
 * `signal` cancels requests that are in flight. An abort rejects the returned
 * promise rather than producing diagnostics.
 */
export type LoadLinkedSourcesOptions = {
  readonly fetch?: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
};

/**
 * What one load produced: a source per link that loaded, in document order,
 * and a diagnostic per URL that did not.
 */
export type LinkedSourceLoad = {
  readonly sources: readonly LinkedSource[];
  readonly diagnostics: readonly Diagnostic[];
};

/**
 * The identity state one scanner instance owns. Created by
 * `createSourceIdentity()`, passed to every discovery that instance runs,
 * and shared with no other instance; see the module doc comment for why the
 * state is not module-level.
 */
export type SourceIdentity = {
  /** Names already given to elements this identity has seen. */
  readonly names: WeakMap<HTMLStyleElement | HTMLLinkElement, string>;
};

/**
 * Creates the identity state for one scanner instance.
 *
 * Each call returns independent state, so two scanners observing the same
 * document name its style elements without either one affecting the other.
 */
export function createSourceIdentity(): SourceIdentity {
  return { names: new WeakMap<HTMLStyleElement | HTMLLinkElement, string>() };
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
function authoredIdentity(element: Element): string | undefined {
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

/**
 * The name an error carries, or `"unknown"` for a thrown value that carries
 * none.
 *
 * The name is read from the value rather than derived from `instanceof`,
 * because an error thrown by code in another realm, such as an injected
 * `fetch()` defined in a different window, is not an instance of this
 * realm's `Error` while still reporting its own name. The compiler reads
 * `CssSyntaxError` the same way and for the same reason.
 */
function errorName(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error) {
    const { name } = error as { name: unknown };

    if (typeof name === "string") {
      return name;
    }
  }

  return "unknown";
}

/**
 * Whether a link is a stylesheet link this module loads: a `rel` attribute
 * carrying a `stylesheet` token, compared ASCII case-insensitively, and an
 * `href` attribute that is present and not blank.
 *
 * See the module doc comment for why the comparison is not `relList.contains()`
 * and why a blank `href` is skipped rather than resolved.
 */
function isStylesheetLink(link: HTMLLinkElement): boolean {
  const rel = link.getAttribute("rel");
  const href = link.getAttribute("href");

  if (rel === null || href === null || href.trim() === "") {
    return false;
  }

  return rel.split(/\s+/).some((token) => token.toLowerCase() === "stylesheet");
}

/**
 * Discovers every `<link rel="stylesheet">` element under `root`, in document
 * order.
 *
 * This is a read and nothing else: no request is made, and a caller that only
 * wants to know which links a scan would consider can ask without touching
 * the network. `root` is searched with `querySelectorAll()`, which reports
 * descendants only.
 *
 * Every stylesheet link is returned, including `disabled` and
 * `media="print"` ones, and including alternate stylesheets. Gating is
 * CSSC-027.
 */
export function discoverLinkElements(root: Document | ParentNode): readonly HTMLLinkElement[] {
  return [...root.querySelectorAll("link")].filter((link) => isStylesheetLink(link));
}

/** One discovered link with the URL it resolves to and the name it was given. */
type NamedLink = {
  readonly element: HTMLLinkElement;
  readonly url: string;
  readonly id: string;
};

/**
 * Names every discovered link, following the precedence in the module doc
 * comment: an author-supplied identity attribute, then a name this identity
 * already recorded for the element, then the resolved URL.
 *
 * The list is read twice for the same reason inline discovery reads its list
 * twice. The first pass reserves the identifiers that are already decided,
 * and the second generates the rest around them, so a link cannot take a URL
 * as its name when a later link already owns that name.
 *
 * A recorded name outranks the URL, so a link whose `href` changes between
 * two scans keeps the name reports already used for it, exactly as an inline
 * style element keeps its name when its text is edited. Its `url` follows the
 * new `href`, because the URL says where the CSS came from rather than what
 * the source is called.
 */
function nameLinkElements(
  links: readonly HTMLLinkElement[],
  identity: SourceIdentity,
): readonly NamedLink[] {
  const resolved = new Map<HTMLLinkElement, string>();
  const taken = new Set<string>();

  for (const link of links) {
    const decided = authoredIdentity(link) ?? identity.names.get(link);

    if (decided !== undefined) {
      resolved.set(link, decided);
      taken.add(decided);
    }
  }

  return links.map((link) => {
    const url = link.href;
    let id = resolved.get(link);

    if (id === undefined) {
      id = disambiguate(url, taken);
      taken.add(id);
      identity.names.set(link, id);
    }

    return { element: link, url, id };
  });
}

/**
 * What requesting one URL produced: the CSS text, a diagnostic describing why
 * there is none, or the abort the caller asked for.
 *
 * An abort is a separate member rather than a diagnostic because it is not a
 * finding about the document. It travels back so that the whole load can
 * reject with it once every request has settled.
 */
type LoadOutcome =
  | { readonly kind: "loaded"; readonly url: string; readonly css: string }
  | { readonly kind: "failed"; readonly url: string; readonly diagnostic: Diagnostic }
  | { readonly kind: "aborted"; readonly url: string; readonly error: unknown };

/**
 * Requests one stylesheet and classifies the result.
 *
 * A response that arrived with an error status is `SOURCE_HTTP_ERROR`
 * carrying the status; a request that produced no response at all is
 * `SOURCE_LOAD_FAILED`, which names likely causes rather than claiming one.
 * Neither diagnostic carries a source location, because a transport failure
 * has no position in any text. The module doc comment records the evidence
 * behind both decisions.
 */
async function loadOneUrl(
  url: string,
  request: typeof globalThis.fetch,
  signal: AbortSignal | undefined,
): Promise<LoadOutcome> {
  try {
    const response = await request(url, { signal });

    if (!response.ok) {
      return {
        kind: "failed",
        url,
        diagnostic: createDiagnostic("SOURCE_HTTP_ERROR", {
          details: { url, status: response.status, statusText: response.statusText },
        }),
      };
    }

    return { kind: "loaded", url, css: await response.text() };
  } catch (error) {
    if (errorName(error) === "AbortError") {
      return { kind: "aborted", url, error };
    }

    return {
      kind: "failed",
      url,
      diagnostic: createDiagnostic("SOURCE_LOAD_FAILED", {
        details: { url, error: errorName(error) },
      }),
    };
  }
}

/**
 * Loads every `<link rel="stylesheet">` element under `root` and names each
 * one.
 *
 * One source is returned per link that loaded, in document order, and one
 * diagnostic per URL that did not. Two links to one URL produce two sources
 * and one request, so a report attributes a finding to the link that carried
 * it while the network sees the stylesheet requested once.
 *
 * Requests run concurrently, and a failure never rejects: fault isolation is
 * by source (implementation plan section 5.11), so one unreachable stylesheet
 * leaves every other link, and every inline style, unaffected. The one
 * rejection is an abort, which is the caller's own decision rather than a
 * finding about the document; an already-aborted signal rejects before
 * anything is requested.
 *
 * Nothing here inspects a response's content type. The module doc comment
 * records what the engine itself does with a non-CSS stylesheet link and why
 * refusing one here would report a source the engine accepted as failed.
 */
export async function loadLinkedSources(
  root: Document | ParentNode,
  identity: SourceIdentity,
  options: LoadLinkedSourcesOptions = {},
): Promise<LinkedSourceLoad> {
  const { signal } = options;
  // Bound to the global object, because `fetch()` throws when it is called
  // with a `this` that is not the window it came from.
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  const links = nameLinkElements(discoverLinkElements(root), identity);
  const urls = [...new Set(links.map((link) => link.url))];

  signal?.throwIfAborted();

  const outcomes = await Promise.all(urls.map((url) => loadOneUrl(url, request, signal)));
  const aborted = outcomes.find((outcome) => outcome.kind === "aborted");

  if (aborted !== undefined && aborted.kind === "aborted") {
    throw aborted.error;
  }

  const loaded = new Map<string, string>();
  const diagnostics: Diagnostic[] = [];

  // The outcomes are in the order the URLs were discovered rather than the
  // order the network answered in, so a report is the same on a fast
  // connection and a slow one.
  for (const outcome of outcomes) {
    if (outcome.kind === "loaded") {
      loaded.set(outcome.url, outcome.css);
    } else if (outcome.kind === "failed") {
      diagnostics.push(outcome.diagnostic);
    }
  }

  const sources = links.flatMap((link) => {
    const css = loaded.get(link.url);

    return css === undefined
      ? []
      : [{ kind: "link-element", id: link.id, url: link.url, css, element: link.element } as const];
  });

  return { sources, diagnostics };
}
