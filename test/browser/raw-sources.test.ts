import { expect, test } from "vite-plus/test";

import { compileSource } from "../../src/core/compiler/index.ts";
import { evaluateSource } from "../../src/browser/records/index.ts";
import type { BrowserScanEvent } from "../../src/browser/records/index.ts";
import {
  SOURCE_IDENTITY_ATTRIBUTE,
  acceptRawSources,
  createSourceIdentity,
  diagnoseDuplicateIdentities,
  discoverStyleSources,
} from "../../src/browser/sources/index.ts";

/**
 * Explicit raw sources composed with the rest of the pipeline, checked
 * against a real document and the real evaluator.
 *
 * CSSC-026's red cases are: compile and scan a supplied source object, mix
 * explicit and document sources, and diagnose duplicate identities. The
 * first two are proved here by running the real pipeline,
 * `acceptRawSources()` alongside `discoverStyleSources()`, then
 * `compileSource()` into `evaluateSource()` for every source produced,
 * mirroring how test/browser/events.test.ts composes the same two functions.
 * A raw source's annotation must produce the same kind of event a discovered
 * source's annotation does, because a raw source is not a lesser kind of
 * source, it becomes a source exactly like a discovered one once
 * `acceptRawSources()` has accepted it.
 *
 * The third red case, diagnosing a duplicate identity, is proved twice: once
 * for two `<style>` elements sharing one `data-css-console-source` attribute,
 * which is the CSSC-024 gap this issue closes, and once for a raw source
 * colliding with a discovered one, which only a document-backed test can set
 * up honestly alongside the DOM half of the collision.
 */

/** A fixture host appended to the document and removed however the body ends. */
function withFixture<T>(markup: string, body: (host: HTMLElement) => T): T {
  const host = document.createElement("div");

  host.innerHTML = markup;
  document.body.append(host);

  try {
    return body(host);
  } finally {
    host.remove();
  }
}

/**
 * Applies CSS text to the live document by inserting a `<style>` element,
 * and removes it however the body ends.
 *
 * A raw source's text is not attached to anything the engine reads merely by
 * existing in a `RawSource` object: unlike an inline or linked source, it was
 * never discovered from a tree, so nothing makes the browser apply it. A
 * caller who wants `evaluateSource()` to read live computed values for a raw
 * source's rules, rather than only matching its selectors against elements
 * that happen to carry other styles, is responsible for getting the CSS
 * applied, exactly as a caller using CSS-in-JS or a constructed stylesheet
 * is responsible for inserting or adopting it. This helper stands in for
 * that step so the test can prove the compiled probe reads the value the raw
 * CSS describes.
 */
function withApplied<T>(css: string, body: () => T): T {
  const style = document.createElement("style");

  style.textContent = css;
  document.head.append(style);

  try {
    return body();
  } finally {
    style.remove();
  }
}

test("a raw source compiles and evaluates like a discovered one", () => {
  const css = `/* css-console: log color */
.raw-target { color: rgb(9, 8, 7); }`;

  withFixture(`<p class="raw-target"></p>`, (host) => {
    withApplied(css, () => {
      const { sources } = acceptRawSources([{ id: "css-in-js", css }]);

      expect(sources).toHaveLength(1);

      const source = sources[0];

      if (source === undefined) {
        throw new Error("expected one raw source");
      }

      expect(source.url).toBe("raw:css-in-js");

      const compiled = compileSource(source.css, { url: source.url });
      const events = evaluateSource(compiled, { root: host });

      const records = events.flatMap((event: BrowserScanEvent) =>
        event.kind === "record" ? [event.record] : [],
      );

      expect(events.map((event) => event.kind)).toEqual(["probe-start", "record", "probe-summary"]);
      expect(records).toHaveLength(1);

      const [record] = records;

      expect(record?.kind).toBe("value");

      if (record?.kind === "value") {
        expect(record.values.map((value) => value.name)).toEqual(["color"]);
        expect(record.values[0]?.resolved).toBe("rgb(9, 8, 7)");
      }
    });
  });
});

test("a raw source and a discovered inline source compile and evaluate together in one mixed scan", () => {
  const rawCss = `/* css-console: log color */
.explicit { color: rgb(4, 5, 6); }`;

  withFixture(
    `<style>/* css-console: log color */
     .discovered { color: rgb(1, 2, 3); }</style>
     <p class="discovered"></p>
     <p class="explicit"></p>`,
    (host) => {
      withApplied(rawCss, () => {
        const identity = createSourceIdentity();
        const discovered = discoverStyleSources(host, identity);
        const { sources: raw } = acceptRawSources([{ id: "explicit", css: rawCss }]);

        const combined = [...discovered, ...raw];

        expect(combined.map((source) => source.kind)).toEqual(["style-element", "raw"]);

        const results = combined.map((source) => {
          const compiled = compileSource(source.css, { url: source.url });

          return evaluateSource(compiled, { root: host });
        });

        const resolvedColors = results.map((events) => {
          const record = events.find((event) => event.kind === "record");

          return record?.kind === "record" && record.record.kind === "value"
            ? record.record.values[0]?.resolved
            : undefined;
        });

        expect(resolvedColors).toEqual(["rgb(1, 2, 3)", "rgb(4, 5, 6)"]);
      });
    },
  );
});

test("two style elements sharing one identity attribute are diagnosed as a duplicate", () => {
  // This is the CSSC-024 gap CSSC-026 closes: discoverStyleSources() itself
  // accepts two elements naming the same identity without complaint, because
  // naming is that function's job and a cross-page collision check is a
  // different one. diagnoseDuplicateIdentities() is that different check.
  withFixture(
    `<style ${SOURCE_IDENTITY_ATTRIBUTE}="theme">.a { color: rgb(1 1 1); }</style>
     <style ${SOURCE_IDENTITY_ATTRIBUTE}="theme">.b { color: rgb(2 2 2); }</style>`,
    (host) => {
      const discovered = discoverStyleSources(host, createSourceIdentity());

      expect(discovered.map((source) => source.id)).toEqual(["theme", "theme"]);

      const diagnostics = diagnoseDuplicateIdentities(discovered);

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe("DUPLICATE_SOURCE_IDENTITY");
      expect(diagnostics[0]?.details).toEqual({ identity: "theme", holders: 2 });
    },
  );
});

test("a raw source colliding with a discovered source's identity attribute is diagnosed", () => {
  withFixture(
    `<style ${SOURCE_IDENTITY_ATTRIBUTE}="tokens">.a { color: rgb(1 1 1); }</style>`,
    (host) => {
      const discovered = discoverStyleSources(host, createSourceIdentity());
      const { sources: raw } = acceptRawSources([{ id: "tokens", css: ".b { color: red; }" }]);
      const diagnostics = diagnoseDuplicateIdentities([...discovered, ...raw]);

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.details).toEqual({ identity: "tokens", holders: 2 });
    },
  );
});
