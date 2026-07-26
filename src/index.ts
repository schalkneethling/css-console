/**
 * CSS Console turns inert, source-local CSS comments into live,
 * element-specific value probes for development debugging.
 *
 * The core is not implemented yet; this module exposes the planned public
 * API shape as a typed stub. See plans/implementation.md for the full
 * design contract.
 */

/** Options accepted by {@link createCSSConsole}. */
export interface CSSConsoleOptions {
  /**
   * CSS sources to scan. Use `"document"` to scan the current document's
   * inline `<style>` elements and same-origin linked stylesheets, or pass
   * an array of explicit raw CSS source texts or same-origin stylesheet
   * URLs.
   */
  sources: "document" | string[];
  /** Maximum number of matched elements reported per probe. Defaults to 50. */
  maxElements?: number;
  /** Whether to wait for web fonts before reading resolved values. Defaults to false. */
  waitForFonts?: boolean;
}

/** A running CSS Console instance. */
export interface CSSConsole {
  /**
   * Subscribe to scan events. The listener receives probe records,
   * diagnostics, and the scan summary. Returns an unsubscribe function.
   */
  subscribe(listener: (event: unknown) => void): () => void;
  /**
   * Run a one-shot scan. Resolves with the scan summary even when
   * individual sources or probes fail; rejects on fatal configuration
   * errors.
   */
  scan(): Promise<unknown>;
  /** Release all resources held by this instance. */
  dispose(): void;
}

/**
 * Create a CSS Console instance.
 *
 * The returned instance is a stub until the core lands: `scan()` rejects
 * and `subscribe()` throws with a not-implemented error, while `dispose()`
 * is a no-op because no resources are held yet.
 */
export function createCSSConsole(options: CSSConsoleOptions): CSSConsole {
  void options;

  return {
    subscribe() {
      throw new Error("css-console subscribe() is not implemented yet.");
    },
    scan() {
      return Promise.reject(new Error("css-console scan() is not implemented yet."));
    },
    dispose() {
      // No resources are held yet.
    },
  };
}
