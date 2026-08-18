/**
 * The scan lifecycle.
 *
 * Everything before this module answers one question at a time: what the
 * sources are, what they compile to, and what the engine resolves for them.
 * This module owns the order those answers happen in, and the moments they
 * happen at. `createScanner()` returns one instance holding one identity
 * state and one subscriber list; `scan()` runs the whole pipeline once and
 * resolves with the summary; `dispose()` ends the instance.
 *
 * ## What one scan does, in order
 *
 * 1. Waits for the document to be ready. A document whose `readyState` is
 *    `"loading"` has not finished parsing, so scanning it would report a
 *    page that does not exist yet; the scan waits for `DOMContentLoaded`.
 *    Verified against a real loading document rather than a stub: an iframe
 *    whose document is opened and written but not closed reports
 *    `readyState === "loading"` in headless Chromium 151.0.7922.34, and
 *    closing it fires `DOMContentLoaded` (pinned in the browser suite).
 * 2. Waits for `document.fonts.ready` when `waitForFonts` is set. Font
 *    metrics move layout, so a caller who wants values after fonts settle
 *    opts in; the default is off, matching the plan's configuration example.
 * 3. Waits one animation frame. The stabilization frame means a scan reads
 *    the document after the rendering the caller can see rather than between
 *    a mutation and its recalculation. One frame, not two: the point is to
 *    let pending work land, not to guarantee a paint.
 * 4. Discovers and loads sources: inline style elements, linked stylesheets,
 *    and the raw sources the instance was constructed with. Excluded links
 *    are never fetched; `loadLinkedSources()` applies the exclude patterns
 *    before requesting anything.
 * 5. Gates what arrived. Inactive sources, the ones the browser is not
 *    reading right now, contribute nothing; excluded sources were the
 *    caller's own decision; duplicate identities among the sources that will
 *    compile are diagnosed.
 * 6. Compiles and evaluates each active source in discovery order, delivering
 *    every event to subscribers as it is produced.
 * 7. Emits the summary as the final event and resolves with it.
 *
 * ## Serialization
 *
 * Scans are serialized per instance: a second `scan()` call waits for the
 * first to settle, and neither merges with nor cancels the other
 * (implementation plan, CSSC-028 decision). Serialization is what keeps the
 * event stream legible: interleaving two scans would put one scan's records
 * between another scan's probe boundaries, and no subscriber could
 * reassemble which scan a record belonged to.
 *
 * ## Abort
 *
 * The signal a caller passes to `scan()` is checked at every stage boundary
 * and travels into the network requests, so an abort during a pending load
 * cancels the requests themselves. An aborted scan rejects with the engine's
 * own `AbortError` and emits no summary; events already delivered stay
 * delivered, because they described work that really happened. An abort is
 * the caller's decision, not a finding about the document, so it produces no
 * diagnostic, matching how `loadLinkedSources()` treats it.
 *
 * ## Dispose
 *
 * `dispose()` clears the subscriber list and marks the instance ended:
 * later `scan()` and `subscribe()` calls throw, and a second `dispose()` is
 * a no-op. A scan in flight when `dispose()` is called runs to completion
 * and its promise still settles, because the caller holding that promise
 * asked for that scan before disposing; it simply has no subscribers left to
 * tell.
 *
 * ## Subscriber isolation
 *
 * A throwing subscriber cannot break a scan or starve the subscribers after
 * it. Delivery wraps each subscriber call, because a subscriber is consumer
 * code and the failure model isolates faults to where they happen; the same
 * rule isolates the console adapter in Phase 4.
 *
 * ## What the summary counts
 *
 * The summary's `sources` buckets partition every candidate the scan saw:
 * `discovered` counts inline style elements, stylesheet link elements, and
 * raw inputs alike; `excluded` counts the candidates the caller's patterns
 * removed; `failed` counts the candidates that produced nothing compilable,
 * which is a link whose request failed, a raw input with an empty identity,
 * and a source whose text did not parse as CSS; `compiled` counts the
 * sources that produced a tree. The difference between `discovered` and the
 * other three buckets is the inactive sources, the ones the browser is not
 * reading at scan time.
 *
 * `probes.skipped` counts the probes evaluation answered without asking the
 * engine anything: a value probe whose rule context is inactive at scan
 * time, a function probe in an engine without `CSSFunctionRule`, and a
 * function probe whose every call site sits in an inactive context. All
 * still emit their boundary events, so the count is visible in the stream as
 * well as in the summary. The scanner reads the same live predicates
 * evaluation reads (`isContextActive()`, `supportsCustomFunctions()`), so
 * the count and the behavior can only disagree if the world changes between
 * two reads within one synchronous pass.
 *
 * `matches` sums the per-probe totals, so the limiting `maxElements` applied
 * stays visible: `total` minus `evaluated` is what the limit omitted.
 * `records` and `diagnostics` carry everything the events carried, source
 * failures included, so a consumer that never subscribed still sees every
 * finding (implementation plan section 3.6).
 */

import { compileSource } from "../../core/compiler/index.ts";
import type { Diagnostic, ProbeSummary } from "../../core/records/index.ts";

import { isContextActive } from "../conditions/index.ts";
import { supportsCustomFunctions } from "../evaluator/index.ts";
import { DEFAULT_MAX_ELEMENTS, validateMaxElements } from "../matcher/index.ts";
import { evaluateSource } from "../records/index.ts";
import type { BrowserProbeRecord, BrowserScanEvent, BrowserScanSummary } from "../records/index.ts";
import {
  acceptRawSources,
  createSourceIdentity,
  diagnoseDuplicateIdentities,
  discoverLinkElements,
  discoverStyleSources,
  gateSources,
  loadLinkedSources,
} from "../sources/index.ts";
import type { RawSourceInput } from "../sources/index.ts";

/** The options `createScanner()` accepts. Configuration errors throw here. */
export type ScannerOptions = {
  /**
   * The tree sources are discovered in and probes are matched against,
   * defaulting to the document. A narrower root confines a scan to a
   * subtree, which is how the test suite isolates fixtures.
   */
  readonly root?: Document | ParentNode;

  /** Explicit raw sources scanned beside the discovered ones. */
  readonly rawSources?: readonly RawSourceInput[];

  /**
   * Whether the scan discovers document sources at all. On by default; a
   * caller scanning only explicit raw sources turns it off, and the raw
   * probes still match the live document, because what is scanned and what
   * is matched are different questions.
   */
  readonly discover?: boolean;

  /** URL patterns of sources to exclude, in the gate's grammar. */
  readonly exclude?: readonly string[];

  /**
   * The maximum matches one probe evaluates, validated at construction by
   * `validateMaxElements()` and defaulting to `DEFAULT_MAX_ELEMENTS`.
   */
  readonly maxElements?: number;

  /** Whether a scan waits for `document.fonts.ready`. Off by default. */
  readonly waitForFonts?: boolean;

  /** The clock records read timestamps from, defaulting to `performance.now()`. */
  readonly clock?: () => number;

  /** The fetch linked stylesheets are requested with. Injectable for tests. */
  readonly fetch?: typeof globalThis.fetch;
};

/** The options one `scan()` call accepts. */
export type ScanOptions = {
  /** Aborts the scan at the next stage boundary and cancels pending loads. */
  readonly signal?: AbortSignal;
};

/** One scanner instance: serialized scans, one subscriber list, one identity. */
export type Scanner = {
  scan(options?: ScanOptions): Promise<BrowserScanSummary>;
  subscribe(subscriber: (event: BrowserScanEvent) => void): () => void;
  dispose(): void;
};

/**
 * The document a root belongs to, for the lifecycle waits that are document
 * facts rather than subtree facts: readiness, fonts, and animation frames.
 *
 * The check reads `nodeType` rather than using `instanceof Document`,
 * following the same reasoning the compiler applies to `CssSyntaxError` and
 * the loader applies to `AbortError`: a document from another realm, such as
 * an iframe's, is a real document that is not an instance of this realm's
 * `Document` constructor. The browser suite scans an iframe document, so the
 * cross-realm case is pinned rather than theoretical.
 */
function documentOf(root: Document | ParentNode): Document {
  if (root.nodeType === Node.DOCUMENT_NODE) {
    return root as Document;
  }

  const owner = root.ownerDocument;

  if (owner === null) {
    throw new Error("the scan root belongs to no document");
  }

  return owner;
}

/**
 * Resolves when the document has finished parsing. A document past
 * `"loading"` resolves immediately; a loading one waits for
 * `DOMContentLoaded`, and an abort during the wait rejects with the
 * signal's reason.
 */
function whenReady(target: Document, signal: AbortSignal | undefined): Promise<void> {
  if (target.readyState !== "loading") {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const onReady = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      target.removeEventListener("DOMContentLoaded", onReady);
      reject(signal?.reason);
    };

    target.addEventListener("DOMContentLoaded", onReady, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Resolves when `waited` settles, or rejects with the signal's reason if
 * the signal aborts first. The fonts stage needs this because
 * `document.fonts.ready` is a promise the engine owns: it cannot be
 * cancelled and it settles only when font loading does, so awaiting it
 * bare would leave an aborted scan pending until the engine decided
 * otherwise, unlike every other stage. The engine's promise keeps running
 * after an abort wins the race; the scan just stops waiting for it.
 */
function abortableWait(waited: Promise<unknown>, signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) {
    return waited.then(() => undefined);
  }

  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);

      return;
    }

    const onAbort = () => {
      reject(signal.reason);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    waited.then(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      },
      (reason: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(reason);
      },
    );
  });
}

/**
 * Resolves after one animation frame in the document's own window. The
 * frame is requested from the root document's view rather than from the
 * global one, so a scan of an iframe document stabilizes against the frames
 * that document actually renders in.
 */
function afterFrame(target: Document): Promise<void> {
  const view = target.defaultView ?? globalThis;

  return new Promise((resolve) => {
    view.requestAnimationFrame(() => {
      resolve();
    });
  });
}

/** Zeroed summary counters, built fresh per scan. */
function emptyCounts(): {
  sources: BrowserScanSummary["sources"];
  probes: BrowserScanSummary["probes"];
  matches: BrowserScanSummary["matches"];
} {
  return {
    sources: { discovered: 0, compiled: 0, failed: 0, excluded: 0 },
    probes: { compiled: 0, evaluated: 0, skipped: 0 },
    matches: { total: 0, evaluated: 0, omitted: 0 },
  };
}

/**
 * Creates one scanner instance.
 *
 * Configuration errors fail here rather than at scan time (implementation
 * plan section 5.11): an invalid `maxElements` throws the `TypeError` or
 * `RangeError` that `validateMaxElements()` defines before any scan can be
 * asked for.
 */
export function createScanner(options: ScannerOptions = {}): Scanner {
  const maxElements =
    options.maxElements === undefined
      ? DEFAULT_MAX_ELEMENTS
      : validateMaxElements(options.maxElements);
  const clock = options.clock ?? (() => performance.now());
  const rawInputs = options.rawSources ?? [];
  const exclude = options.exclude ?? [];
  const identity = createSourceIdentity();
  const subscribers = new Set<(event: BrowserScanEvent) => void>();

  let disposed = false;
  let tail: Promise<unknown> = Promise.resolve();

  function deliver(event: BrowserScanEvent): void {
    for (const subscriber of subscribers) {
      try {
        subscriber(event);
      } catch {
        // A subscriber defect is the subscriber's own; see the module doc
        // comment on isolation.
      }
    }
  }

  async function performScan(signal: AbortSignal | undefined): Promise<BrowserScanSummary> {
    const root = options.root ?? document;
    const target = documentOf(root);
    const started = clock();

    signal?.throwIfAborted();
    await whenReady(target, signal);
    signal?.throwIfAborted();

    if (options.waitForFonts === true) {
      await abortableWait(target.fonts.ready, signal);
      signal?.throwIfAborted();
    }

    await afterFrame(target);
    signal?.throwIfAborted();

    const discover = options.discover ?? true;
    const styleSources = discover ? discoverStyleSources(root, identity) : [];
    const linkElements = discover ? discoverLinkElements(root) : [];
    const linked = discover
      ? await loadLinkedSources(root, identity, {
          exclude,
          signal,
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        })
      : { sources: [], diagnostics: [], excludedElements: [] };

    signal?.throwIfAborted();

    const raw = acceptRawSources(rawInputs);
    const gate = gateSources([...styleSources, ...linked.sources, ...raw.sources], { exclude });
    const duplicates = diagnoseDuplicateIdentities(gate.active);
    const counts = emptyCounts();
    const records: BrowserProbeRecord[] = [];
    const diagnostics: Diagnostic[] = [];

    counts.sources.discovered = styleSources.length + linkElements.length + rawInputs.length;
    counts.sources.excluded = linked.excludedElements.length + gate.excluded.length;

    // A failed candidate produced nothing compilable: a link whose request
    // failed, and a raw input whose empty identity was rejected. Parse
    // failures join the bucket below, once compilation has seen the text.
    const failedLinks =
      linkElements.length - linked.excludedElements.length - linked.sources.length;
    const failedRawInputs = rawInputs.length - raw.sources.length;

    counts.sources.failed = failedLinks + failedRawInputs;

    function publish(event: BrowserScanEvent): void {
      if (event.kind === "record") {
        records.push(event.record);
      }

      if (event.kind === "diagnostic") {
        diagnostics.push(event.diagnostic);
      }

      if (event.kind === "probe-summary") {
        const matches: ProbeSummary["matches"] = event.summary.matches;

        counts.matches.total += matches.total;
        counts.matches.evaluated += matches.evaluated;
        counts.matches.omitted += matches.omitted;
      }

      deliver(event);
    }

    for (const diagnostic of [...linked.diagnostics, ...raw.diagnostics, ...duplicates]) {
      publish({ kind: "diagnostic", diagnostic });
    }

    const functionsSupported = supportsCustomFunctions();

    for (const source of gate.active) {
      const compiled = compileSource(source.css, { url: source.url });
      const parseFailed = compiled.diagnostics.some(
        (diagnostic) => diagnostic.code === "SOURCE_PARSE_FAILED",
      );

      if (parseFailed) {
        counts.sources.failed += 1;
      } else {
        counts.sources.compiled += 1;
      }

      counts.probes.compiled += compiled.probes.length;

      for (const probe of compiled.probes) {
        // A function probe is skipped when the engine cannot evaluate it, and
        // also when every one of its call sites sits in an inactive context,
        // because the evaluator then evaluates nothing, exactly as it
        // evaluates nothing for a value probe whose own context is inactive.
        // A function with no call sites at all still counts as evaluated: an
        // uncalled function is a debugging answer the evaluator reports, not
        // work it declined.
        const skipped =
          probe.kind === "value"
            ? !isContextActive(probe.context)
            : !functionsSupported ||
              (probe.callSites.length > 0 &&
                probe.callSites.every((callSite) => !isContextActive(callSite.context)));

        if (skipped) {
          counts.probes.skipped += 1;
        } else {
          counts.probes.evaluated += 1;
        }
      }

      for (const event of evaluateSource(compiled, { root, clock, maxElements })) {
        publish(event);
      }
    }

    const summary: BrowserScanSummary = {
      sources: counts.sources,
      probes: counts.probes,
      matches: counts.matches,
      records,
      diagnostics,
      durationMs: clock() - started,
    };

    deliver({ kind: "summary", summary });

    return summary;
  }

  return {
    scan(scanOptions: ScanOptions = {}): Promise<BrowserScanSummary> {
      if (disposed) {
        return Promise.reject(new Error("this scanner is disposed"));
      }

      const run = tail.then(() => performScan(scanOptions.signal));

      // The next scan waits for this one however it settles; a rejection
      // belongs to the caller holding this promise, not to the next scan.
      tail = run.catch(() => {});

      return run;
    },

    subscribe(subscriber: (event: BrowserScanEvent) => void): () => void {
      if (disposed) {
        throw new Error("this scanner is disposed");
      }

      subscribers.add(subscriber);

      return () => {
        subscribers.delete(subscriber);
      };
    },

    dispose(): void {
      disposed = true;
      subscribers.clear();
    },
  };
}
