/**
 * The public facade.
 *
 * `createCSSConsole()` is the one function a consumer calls (implementation
 * plan section 3.7): construct with configuration, subscribe if live events
 * are wanted, `scan()` for a summary that carries every record and
 * diagnostic, and `dispose()` when done. The facade is a thin naming layer
 * over the scanner, and thinness is the point: every behavior it promises is
 * the scanner's behavior, specified and tested there, so the facade can
 * never disagree with the machinery underneath it.
 *
 * Construction is side-effect free beyond validation. No scan runs, nothing
 * reads the document, and nothing is scheduled; a consumer can construct in
 * module scope of code that also runs on a server, because the first DOM
 * access happens inside `scan()`. Configuration errors fail construction
 * (implementation plan section 5.11), so an invalid `maxElements` throws
 * before any scan exists to fail.
 *
 * `sources` names what a scan collects. `"document"`, the default, discovers
 * inline style elements and linked stylesheets from the page; `"none"`
 * collects nothing from the page, which is the mode for a consumer scanning
 * only the raw sources they supply. `rawSources` are scanned in either mode,
 * and their probes still match the live document, because what is scanned
 * and what is matched are different questions: a raw source describes CSS,
 * and the elements that CSS applies to are wherever the document put them.
 */

import { createScanner } from "../scanner/index.ts";
import type { ScanOptions, Scanner } from "../scanner/index.ts";
import type { RawSourceInput } from "../sources/index.ts";

/**
 * The configuration `createCSSConsole()` accepts, matching the shape the
 * implementation plan's public API example uses.
 */
export type CSSConsoleOptions = {
  /** What a scan collects: the document's sources, or none of them. */
  readonly sources?: "document" | "none";

  /** Explicit raw sources scanned in either mode. */
  readonly rawSources?: readonly RawSourceInput[];

  /** URL patterns of sources to exclude. */
  readonly exclude?: readonly string[];

  /** The maximum matches one probe evaluates, validated at construction. */
  readonly maxElements?: number;

  /** Whether a scan waits for `document.fonts.ready`. Off by default. */
  readonly waitForFonts?: boolean;
};

/**
 * One css-console instance: serialized scans, one subscriber list, and one
 * source identity that keeps reports comparable across its scans.
 */
export type CSSConsole = Scanner;

/**
 * Creates one css-console instance from public configuration.
 *
 * The scanner owns every lifecycle behavior; this function only translates
 * the public option names into the scanner's own. `sources: "none"` becomes
 * `discover: false`, and everything else passes through unchanged.
 */
export function createCSSConsole(options: CSSConsoleOptions = {}): CSSConsole {
  return createScanner({
    discover: options.sources !== "none",
    ...(options.rawSources === undefined ? {} : { rawSources: options.rawSources }),
    ...(options.exclude === undefined ? {} : { exclude: options.exclude }),
    ...(options.maxElements === undefined ? {} : { maxElements: options.maxElements }),
    ...(options.waitForFonts === undefined ? {} : { waitForFonts: options.waitForFonts }),
  });
}

export type { ScanOptions };
