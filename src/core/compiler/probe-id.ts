/**
 * Deterministic probe identifiers.
 *
 * `ValueRecord.probeId` and `FunctionRecord.probeId` are published contracts
 * (src/core/records/index.ts): a stable label a console consumer can read
 * off one record and, later, use to correlate the same probe across
 * separate scans. This module is where that label is computed.
 *
 * ## The identity contract
 *
 * The hard part is deciding what a probe's identity actually *is* before
 * hashing anything, because an identifier that changes for the wrong reason
 * is worse than useless: it tells a consumer two things are different that
 * are not. Two rules follow from that.
 *
 * A value probe's identity is its source file, its *resolved* selector, its
 * pseudo-element (or its absence), and the set of properties it reports, in
 * the order it reports them. A function probe's identity is its source file
 * and its function name alone; every call site of that function has its own
 * identity within the probe, described below.
 *
 * None of those identities include a source position. Line and column shift
 * every time an unrelated line is added above the probe, and an identifier
 * that shifts with unrelated edits cannot be used for anything that persists
 * across them, which is the whole reason this module exists. They also
 * exclude the annotation's own log level and label: those describe how a
 * probe reports, not what it observes, and changing how a probe logs is not
 * the same probe becoming a different one.
 *
 * `selector` must be the selector nesting resolution produced
 * (`resolveNestedSelector()` / `resolveProbePlacement()`), never the
 * authored selector `AnnotationTarget` carries. A nested rule and its
 * flattened equivalent select the same elements and must identify the same
 * probe; only the resolved form makes that true, since `& .title` and
 * `:is(.card) .title` share nothing textually.
 *
 * ## Call sites: one stable identifier, one stable family of sub-identifiers
 *
 * A function probe's identifier must survive a call site being added or
 * removed anywhere else in the source, which is why it never depends on call
 * sites at all: `computeFunctionProbeId()` takes only the definition's file
 * and function name. Each call site then gets its own sub-identifier from
 * `computeCallSiteIds()`, keyed on that call's own property, resolved
 * selector, and arguments, so a call's sub-identifier depends on what it
 * calls with, not on where its neighbours are. Two calls that happen to be
 * byte-identical in property, selector, and arguments are disambiguated by
 * an ordinal counted in the order they are encountered; inserting a further
 * identical call after the ones already counted leaves their ordinals alone,
 * inserting one before it does not, and that asymmetry is a known,
 * documented edge rather than a hidden one. `composeFunctionRecordProbeId()`
 * joins a function's identifier to one call site's sub-identifier into the
 * single string a `FunctionRecord.probeId` publishes.
 *
 * ## Path portability
 *
 * "Machine-specific" is a property of `file:` URLs and bare filesystem
 * paths, not of URLs in general, and `portableSource()` branches on that
 * rather than reducing every location the same way.
 *
 * At runtime a `SourceLocation.url` is normally an `http:` or `https:` URL,
 * because this tool fetches linked stylesheets: `https://example.test/
 * styles/card.css` is the same string on every machine that can reach it, so
 * nothing about the portability requirement justifies discarding its origin
 * or its directory. Doing so would only lose the information that tells two
 * probes apart: `styles/card.css` and `vendor/card.css` are ordinarily two
 * different files in one design system, and `one.test/card.css` and
 * `two.test/card.css` are two different sites. For these schemes the whole
 * URL participates, apart from a query string or fragment, which are
 * dropped because they identify a request, such as a cache-busting version
 * parameter, rather than the source file the probe was compiled from.
 *
 * A `file:` URL is the opposite case, and it is where the machine-specific
 * problem actually lives: `file:///Users/someone/project/app.css` (the
 * shape `pathToFileURL()` in scripts/inspect-probes.ts produces) encodes a
 * home directory or checkout root that is different on every machine
 * serving byte-identical CSS, even though nothing about the CSS changed.
 * Everything up to the final path segment is that machine-specific prefix,
 * and core has no notion of a "project root" to normalise against instead,
 * so only the final segment, the file's own name, survives. A bare
 * filesystem path with no scheme at all, or a Windows drive letter such as
 * `C:\Users\...`, is reduced the same way, for the same reason.
 *
 * Reducing to one segment rather than two or three is a choice, not the only
 * defensible one; keeping more would collide less often between
 * differently-named local files, at the cost of being more willing to guess
 * which of a `file:` path's remaining segments are project-relative rather
 * than still machine-specific. One segment is the only amount this module
 * can justify without guessing, so that is what it keeps. The cost is named
 * rather than hidden: two distinct local files that share a name in
 * different directories now also share a portable source, and can no longer
 * be told apart by path alone. That is a collision this reduction adds on
 * top of the hash's own 32-bit collision space, and it is why the reduction
 * is scoped to the one case that actually forces it rather than applied
 * everywhere.
 *
 * ## The hash: FNV-1a, 32-bit
 *
 * `node:crypto` is forbidden under the parser selection record's import
 * boundary, and `crypto.subtle` is both asynchronous and unavailable in
 * core, which is pinned to `types: []` with no ambient globals. Core
 * therefore needs a hash it can write itself, in a few lines of pure integer
 * arithmetic.
 *
 * FNV-1a is chosen over, say, djb2, not because either would fail here —
 * this is a legibility label, not a security boundary, and either
 * non-cryptographic string hash clears that bar — but because FNV-1a has a
 * single published reference (Fowler/Noll/Vo,
 * isthe.com/chongo/tech/comp/fnv) with fixed constants and published test
 * vectors, so a reviewer can check this implementation against the
 * specification rather than trust an ad hoc constant nobody can look up.
 * `hashProbeParts()` is pinned against two of those vectors in the test
 * suite: the 32-bit offset basis for zero-length input, and the hash of the
 * single byte `"a"`.
 *
 * The arithmetic runs entirely in 32-bit integers, via `Math.imul()` and the
 * unsigned right shift, never through floating point. That is what keeps the
 * result identical on every run and every engine: nothing here reads object
 * key order, calls `Math.random()`, or reads the clock, which are the three
 * ways a hash quietly stops being deterministic. Hashing walks UTF-16 code
 * units through `charCodeAt()` rather than UTF-8 bytes, which needs no
 * encoding step, because a JavaScript string is UTF-16 internally on every
 * engine; two engines reading the same string always read the same code
 * units.
 *
 * Multiple parts are joined with a delimiter, `"\u0000"`, that legitimate
 * input (a selector, a property name, a URL) will not contain, rather than
 * being concatenated directly. Without a delimiter, the parts `["ab", "c"]`
 * and `["a", "bc"]` hash identically, which is exactly the kind of collision
 * a boundary is supposed to prevent.
 *
 * ## On collision
 *
 * A 32-bit digest has a finite space, so a collision between two genuinely
 * different probes is possible and is not treated as though it cannot
 * happen. When it does, two distinct probes present the same `probeId`,
 * which is confusing but not unsafe: `probeId` is a label, not a lookup key
 * this module promises to be injective, and every record carrying one also
 * carries its own `selector`, `source`, and `label`, which is what a
 * consumer should fall back to when two records claim the same identifier.
 * Anything built later that correlates probes by `probeId` alone should
 * treat a match as a strong hint, not a proof.
 */

/**
 * The 32-bit FNV-1a offset basis and prime, taken from the Fowler/Noll/Vo
 * reference rather than re-derived, because the whole point of choosing a
 * named, published algorithm is that its constants are looked up rather than
 * invented.
 */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * The delimiter `hashProbeParts()` joins its parts with. A NUL code unit
 * never occurs in a selector, a property name, a function name, or a URL, so
 * it never appears inside one part and can safely separate them.
 */
const PART_SEPARATOR = "\u0000";

/**
 * The 32-bit FNV-1a hash of a string, as an unsigned integer. `Math.imul()`
 * performs the multiplication in 32-bit integer arithmetic directly, and
 * `>>> 0` converts the final signed result to unsigned, so no step here ever
 * touches a floating-point value wide enough to lose precision.
 */
function fnv1a32(input: string): number {
  let hash = FNV_OFFSET_BASIS;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }

  return hash >>> 0;
}

/** Renders an unsigned 32-bit integer as fixed-width lowercase hex. */
function toHex(value: number): string {
  return value.toString(16).padStart(8, "0");
}

/**
 * Hashes an ordered list of parts into a fixed-width hex digest. See the
 * module doc comment for the algorithm, why it was chosen, the delimiter
 * that keeps parts from colliding across their own boundaries, and what a
 * collision means for a caller.
 */
export function hashProbeParts(parts: readonly string[]): string {
  return toHex(fnv1a32(parts.join(PART_SEPARATOR)));
}

/**
 * Matches a URI scheme at the start of a string: one letter, then any run of
 * letters, digits, `+`, `.`, or `-`, then `:`.
 */
const SCHEME_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*):/u;

/**
 * The lowercased scheme a location opens with, or `null` when none is
 * present, which covers both an ordinary relative or absolute filesystem
 * path and a Windows drive letter.
 *
 * A scheme of exactly one letter is treated as absent rather than matched,
 * because that shape is indistinguishable from a Windows drive letter
 * (`C:\Users\...`) without a host to disambiguate it, and every scheme this
 * module treats specially, `http`, `https`, and `file`, is at least two
 * characters. The WHATWG URL parser special-cases the same ambiguity when
 * parsing a Windows path for the same reason.
 */
function schemeOf(location: string): string | null {
  const match = SCHEME_PATTERN.exec(location);

  if (match === null) {
    return null;
  }

  const [, scheme] = match;

  return scheme.length === 1 ? null : scheme.toLowerCase();
}

/**
 * Reduces a URL or filesystem path to its final path segment, understanding
 * both `/` and `\` as separators so a Windows-style absolute path reduces
 * the same way a POSIX one does, and so that a `file:` URL's `file://`
 * prefix and empty authority fall out as empty segments rather than as part
 * of the result.
 */
function lastPathSegment(location: string): string {
  const normalized = location.replaceAll("\\", "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);

  return segments.at(-1) ?? normalized;
}

/** Drops a trailing query string or fragment from a URL, in either order. */
function withoutQueryAndFragment(location: string): string {
  const [withoutFragment = location] = location.split("#");
  const [withoutQuery = withoutFragment] = withoutFragment.split("?");

  return withoutQuery;
}

/**
 * The portable part of a source location. See the module doc comment for why
 * `http:` and `https:` keep their full URL, apart from a query string or
 * fragment, while `file:` and every other shape reduce to the final path
 * segment.
 */
export function portableSource(url: string): string {
  const scheme = schemeOf(url);

  if (scheme === "http" || scheme === "https") {
    return withoutQueryAndFragment(url);
  }

  return lastPathSegment(url);
}

/** The inputs that make up a value probe's identity. See the module doc comment. */
export type ValueProbeIdentity = {
  /** The location of the source the probe was compiled from. */
  url: string;
  /** The resolved (post-nesting-resolution) selector the probe matches. */
  selector: string;
  /** The pseudo-element the probe reports against, or `null` for the element itself. */
  pseudo: string | null;
  /** The properties the probe reports, in the order it reports them. */
  properties: readonly string[];
};

/**
 * Computes the deterministic identifier for a value probe (a rule probe or a
 * declaration probe; both compile to the same shape, so both identify the
 * same way). The `value-` prefix keeps a value probe's identifier
 * distinguishable from a function probe's at a glance in console output,
 * which is where these are read.
 */
export function computeValueProbeId(identity: ValueProbeIdentity): string {
  return `value-${hashProbeParts([
    portableSource(identity.url),
    identity.selector,
    identity.pseudo ?? "",
    ...identity.properties,
  ])}`;
}

/** The inputs that make up a function probe's identity. See the module doc comment. */
export type FunctionProbeIdentity = {
  /** The location of the `@function` definition the probe was compiled from. */
  url: string;
  /** The function's name, exactly as authored; matching a call site is case-sensitive. */
  functionName: string;
};

/**
 * Computes the deterministic identifier for a function probe. Deliberately
 * independent of every call site, so it stays stable as call sites are added
 * to or removed from the source; see the module doc comment.
 */
export function computeFunctionProbeId(identity: FunctionProbeIdentity): string {
  return `fn-${hashProbeParts([portableSource(identity.url), identity.functionName])}`;
}

/**
 * The fields of a call site that feed its sub-identifier: its destination
 * property, its resolved selector, and its authored arguments. A structural
 * subset of `CallSite` (src/core/records/index.ts) rather than that type
 * itself, so `computeCallSiteIds()` accepts a `CallSiteResolution`'s
 * `callSites` array directly without this module depending on the browser
 * generic `CallSite` carries.
 */
export type CallSiteIdentity = {
  property: string;
  selector: string;
  arguments: readonly string[];
};

/**
 * Computes one stable sub-identifier per call site, in the order the call
 * sites are given.
 *
 * Two calls with the same property, resolved selector, and arguments hash to
 * the same key and are told apart by an ordinal counted in encounter order,
 * so identical-looking duplicate calls still get distinct sub-identifiers.
 * See the module doc comment for what that means when a further duplicate is
 * inserted ahead of the ones already counted.
 */
export function computeCallSiteIds(callSites: readonly CallSiteIdentity[]): readonly string[] {
  const occurrences = new Map<string, number>();

  return callSites.map((callSite) => {
    const key = hashProbeParts([callSite.selector, callSite.property, ...callSite.arguments]);
    const occurrence = occurrences.get(key) ?? 0;

    occurrences.set(key, occurrence + 1);

    return occurrence === 0 ? `call-${key}` : `call-${key}-${occurrence}`;
  });
}

/**
 * Joins a function probe's identifier to one call site's sub-identifier into
 * the single string a `FunctionRecord.probeId` publishes.
 */
export function composeFunctionRecordProbeId(functionProbeId: string, callSiteId: string): string {
  return `${functionProbeId}::${callSiteId}`;
}
