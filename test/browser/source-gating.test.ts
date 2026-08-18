import { page } from "vite-plus/test/browser/context";
import { expect, test } from "vite-plus/test";

import { compileSource, guardCandidates } from "../../src/core/compiler/index.ts";
import type { IndexedDeclaration } from "../../src/core/compiler/index.ts";
import {
  createSourceIdentity,
  discoverStyleSources,
  gateSources,
  isSourceActive,
  loadLinkedSources,
} from "../../src/browser/sources/index.ts";

/**
 * Source gating, checked against the engine that decides it.
 *
 * Whether a source contributes is a question about the browser reading it
 * rather than about the tree containing it, so every case here runs against
 * headless Chromium 151.0.7922.34, the version this project's Vitest browser
 * project runs. Nothing is stubbed: `matchMedia()` answers the media
 * questions, the engine's own `disabled` property answers the disabled ones,
 * and a computed value read off a live element says whether the engine agreed
 * with the gate.
 *
 * The exclude matcher is pure string logic and is pinned exhaustively in
 * test/unit/source-exclusion.test.ts. It appears here only where it composes
 * with a real link, a real request, and the real compiler.
 */

/** A representative fixture served as CSS text rather than as a Vite module. */
const FIXTURE_PATH = "test/fixtures/representative/card-components.css?direct";

/** A second fixture, so that one link can be excluded and one kept. */
const OTHER_PATH = "test/fixtures/representative/nested-card.css?direct";

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

/** The same, for a body that awaits a request. */
async function withAsyncFixture<T>(
  markup: string,
  body: (host: HTMLElement) => Promise<T>,
): Promise<T> {
  const host = document.createElement("div");

  host.innerHTML = markup;
  document.body.append(host);

  try {
    return await body(host);
  } finally {
    host.remove();
  }
}

/** The resolved `color` of a fresh element carrying `className`. */
function resolvedColor(className: string): string {
  const element = document.createElement("div");

  element.className = className;
  document.body.append(element);

  try {
    return getComputedStyle(element).color;
  } finally {
    element.remove();
  }
}

/** The color the fixture styles declare, as the engine serializes it. */
const DECLARED_COLOR = "rgb(1, 2, 3)";

/** The color an element has when no fixture style applies to it. */
const UNSTYLED_COLOR = "rgb(0, 0, 0)";

test("a print-media style element contributes nothing and a screen-media one contributes", () => {
  withFixture(
    `<style media="print">.gated-print { color: rgb(1 2 3); }</style>
     <style media="screen">.gated-screen { color: rgb(1 2 3); }</style>`,
    (host) => {
      // The engine's own answer first, so the gate is checked against what the
      // browser did rather than against a restatement of the gate.
      expect(matchMedia("print").matches).toBe(false);
      expect(matchMedia("screen").matches).toBe(true);
      expect(resolvedColor("gated-print")).toBe(UNSTYLED_COLOR);
      expect(resolvedColor("gated-screen")).toBe(DECLARED_COLOR);

      const gate = gateSources(discoverStyleSources(host, createSourceIdentity()));

      expect(gate.active.map((source) => source.css)).toEqual([
        ".gated-screen { color: rgb(1 2 3); }",
      ]);
      expect(gate.inactive.map((source) => source.css)).toEqual([
        ".gated-print { color: rgb(1 2 3); }",
      ]);
      expect(gate.excluded).toEqual([]);
    },
  );
});

test("a style element with no media attribute is active, and so is an empty one", () => {
  withFixture(
    `<style>.gated-absent { color: rgb(1 2 3); }</style>
     <style media="">.gated-empty { color: rgb(1 2 3); }</style>`,
    (host) => {
      // Pinned rather than recalled: the `media` IDL attribute is the empty
      // string in both cases, and `matchMedia("")` matches, because an empty
      // query is the universal query. The gate therefore needs no special
      // case for an absent attribute; it feeds the empty string through the
      // same path a real query takes.
      const [absent, empty] = [...host.querySelectorAll("style")];

      expect(absent?.media).toBe("");
      expect(empty?.media).toBe("");
      expect(matchMedia("").matches).toBe(true);
      expect(resolvedColor("gated-absent")).toBe(DECLARED_COLOR);
      expect(resolvedColor("gated-empty")).toBe(DECLARED_COLOR);

      const gate = gateSources(discoverStyleSources(host, createSourceIdentity()));

      expect(gate.active).toHaveLength(2);
      expect(gate.inactive).toEqual([]);
    },
  );
});

test("a malformed media attribute makes a source inactive, because it serializes to not all", () => {
  withFixture(
    `<style media="not a real query">.gated-bad { color: rgb(1 2 3); }</style>`,
    (host) => {
      const element = host.querySelector("style");

      // Media Queries Level 4 section 3.1 replaces a malformed query with `not
      // all`, and the engine agrees twice over: the attached sheet reports its
      // media as `not all`, and the declaration does not reach the element.
      expect(element?.media).toBe("not a real query");
      expect(element?.sheet?.media.mediaText).toBe("not all");
      expect(resolvedColor("gated-bad")).toBe(UNSTYLED_COLOR);

      const gate = gateSources(discoverStyleSources(host, createSourceIdentity()));

      expect(gate.active).toEqual([]);
      expect(gate.inactive).toHaveLength(1);
    },
  );
});

test("a style element disabled through the IDL property is excluded entirely", () => {
  withFixture(`<style>.gated-idl { color: rgb(1 2 3); }</style>`, (host) => {
    const element = host.querySelector("style");

    if (element === null) {
      throw new Error("expected a style element");
    }

    expect(resolvedColor("gated-idl")).toBe(DECLARED_COLOR);
    const before = discoverStyleSources(host, createSourceIdentity())[0];

    if (before === undefined) {
      throw new Error("expected one discovered source");
    }

    expect(isSourceActive(before)).toBe(true);

    element.disabled = true;

    // The engine stopped applying the sheet, and the gate agrees.
    expect(resolvedColor("gated-idl")).toBe(UNSTYLED_COLOR);

    const gate = gateSources(discoverStyleSources(host, createSourceIdentity()));

    expect(gate.active).toEqual([]);
    expect(gate.inactive).toHaveLength(1);
  });
});

test("a disabled content attribute on a style element disables nothing, and the gate says so", () => {
  withFixture(`<style disabled>.gated-attribute { color: rgb(1 2 3); }</style>`, (host) => {
    const element = host.querySelector("style");

    // The surprise, pinned rather than recalled. `<style disabled>` looks
    // like it turns a stylesheet off and does not: the content attribute is
    // present, the `disabled` IDL property still reports `false`, the sheet
    // is attached and enabled, and the declaration reaches the element. HTML
    // gives `<style>` no `disabled` content attribute at all; the IDL
    // property is the `LinkStyle` one, which reflects the associated sheet's
    // own `disabled` state rather than any attribute. A gate that read the
    // attribute would report a source the engine was applying as excluded.
    expect(element?.getAttribute("disabled")).toBe("");
    expect(element?.disabled).toBe(false);
    expect(element?.sheet?.disabled).toBe(false);
    expect(resolvedColor("gated-attribute")).toBe(DECLARED_COLOR);

    const gate = gateSources(discoverStyleSources(host, createSourceIdentity()));

    expect(gate.active).toHaveLength(1);
    expect(gate.inactive).toEqual([]);
  });
});

test("setting the disabled IDL property on a style element does not write the attribute", () => {
  withFixture(`<style>.gated-no-write { color: rgb(1 2 3); }</style>`, (host) => {
    const element = host.querySelector("style");

    if (element === null) {
      throw new Error("expected a style element");
    }

    element.disabled = true;

    // The other half of the same surprise: the property and the attribute are
    // unrelated in both directions, so neither one can be read as a proxy for
    // the other.
    expect(element.getAttribute("disabled")).toBeNull();
    expect(element.disabled).toBe(true);
  });
});

test("a disabled link element is excluded entirely, and it never even loaded a sheet", async () => {
  await withAsyncFixture(
    `<link rel="stylesheet" disabled href="/${FIXTURE_PATH}">`,
    async (host) => {
      const link = host.querySelector("link");

      // A link is the opposite of a style element here, pinned rather than
      // recalled: the `disabled` content attribute does set the `disabled` IDL
      // property, and the engine does not even attach a sheet for the link.
      expect(link?.getAttribute("disabled")).toBe("");
      expect(link?.disabled).toBe(true);
      expect(link?.sheet).toBeNull();

      const { sources, diagnostics } = await loadLinkedSources(host, createSourceIdentity());

      expect(diagnostics).toEqual([]);

      const gate = gateSources(sources);

      expect(gate.active).toEqual([]);
      expect(gate.inactive).toHaveLength(1);
    },
  );
});

test("a print-media link element is inactive while a screen-media one is active", async () => {
  await withAsyncFixture(
    `<link rel="stylesheet" media="print" href="/${FIXTURE_PATH}">
     <link rel="stylesheet" media="screen" href="/${OTHER_PATH}">`,
    async (host) => {
      const { sources } = await loadLinkedSources(host, createSourceIdentity());

      expect(sources).toHaveLength(2);

      const gate = gateSources(sources);

      expect(gate.active.map((source) => source.url)).toEqual([
        new URL(OTHER_PATH, document.baseURI).href,
      ]);
      expect(gate.inactive.map((source) => source.url)).toEqual([
        new URL(FIXTURE_PATH, document.baseURI).href,
      ]);
    },
  );
});

test("a media attribute becoming active is re-evaluated on the next scan", async () => {
  // The caching mutant this case exists to kill: an implementation that
  // remembered its first answer for a source, or that compiled the media
  // query once into a stored `MediaQueryList`, would repeat the first answer
  // after the resize and fail the second assertion. Nothing is memoized, so
  // the same source list gated twice around a real viewport change answers
  // differently, matching the liveness posture of the conditions module.
  await withAsyncFixture(
    `<style media="(min-width: 600px)">.gated-live { color: rgb(1 2 3); }</style>`,
    async (host) => {
      const identity = createSourceIdentity();

      await page.viewport(400, 300);

      const narrow = gateSources(discoverStyleSources(host, identity));

      expect(narrow.active).toEqual([]);
      expect(narrow.inactive).toHaveLength(1);

      const gated = narrow.inactive[0];

      if (gated === undefined) {
        throw new Error("expected one gated source");
      }

      await page.viewport(800, 300);

      const wide = gateSources(discoverStyleSources(host, identity));

      expect(wide.active).toHaveLength(1);
      expect(wide.inactive).toEqual([]);
      // The same source object, not merely an equal one, answers differently
      // on either side of the resize.
      expect(isSourceActive(gated)).toBe(true);
    },
  );
});

test("an exclude pattern removes a linked source by URL", async () => {
  await withAsyncFixture(
    `<link rel="stylesheet" href="/${FIXTURE_PATH}">
     <link rel="stylesheet" href="/${OTHER_PATH}">`,
    async (host) => {
      const { sources } = await loadLinkedSources(host, createSourceIdentity());
      const gate = gateSources(sources, { exclude: ["**/card-components.css**"] });

      expect(gate.excluded.map((source) => source.url)).toEqual([
        new URL(FIXTURE_PATH, document.baseURI).href,
      ]);
      expect(gate.active.map((source) => source.url)).toEqual([
        new URL(OTHER_PATH, document.baseURI).href,
      ]);
      expect(gate.inactive).toEqual([]);
    },
  );
});

test("an excluded source contributes neither probes nor guard candidates", async () => {
  await withAsyncFixture(
    `<link rel="stylesheet" href="/${FIXTURE_PATH}">
     <link rel="stylesheet" href="/${OTHER_PATH}">`,
    async (host) => {
      const { sources } = await loadLinkedSources(host, createSourceIdentity());
      const excludedUrl = new URL(FIXTURE_PATH, document.baseURI).href;

      // The real pipeline, composed the way a scan composes it: only the
      // sources the gate returned as active are compiled, so an excluded
      // source's CSS never reaches `compileSource()` at all.
      const gate = gateSources(sources, { exclude: ["**/card-components.css**"] });
      const compiled = gate.active.map((source) => compileSource(source.css, { url: source.url }));

      const labels = compiled.flatMap((source) => source.probes.map((probe) => probe.label));

      expect(labels).toContain("card surface");
      // Every label the excluded stylesheet carries is absent, and so is
      // every location pointing into it.
      expect(labels).not.toContain("cards");
      expect(labels).not.toContain("spacing scale");
      expect(labels).not.toContain("card title color");

      expect(compiled.map((source) => source.url)).not.toContain(excludedUrl);

      const candidates = new Set<IndexedDeclaration>();

      for (const source of compiled) {
        for (const candidate of guardCandidates(source.guardIndex, "padding")) {
          candidates.add(candidate);
        }
      }

      // Both stylesheets declare `padding` on `.card`, so a gate that let the
      // excluded source through would produce two candidates here rather than
      // the one the kept stylesheet contributes.
      expect([...candidates].map((candidate) => candidate.selector)).toEqual([".card"]);
    },
  );
});

test("an excluded source is reported as excluded rather than as inactive", async () => {
  await withAsyncFixture(
    `<link rel="stylesheet" media="print" href="/${FIXTURE_PATH}">`,
    async (host) => {
      // Exclusion is the caller's own policy and inactivity is a fact about
      // the browser, so a source that is both is reported as excluded:
      // attributing the caller's decision to the engine would misreport why
      // the source is missing from a summary.
      const { sources } = await loadLinkedSources(host, createSourceIdentity());
      const gate = gateSources(sources, { exclude: ["**/card-components.css**"] });

      expect(gate.excluded).toHaveLength(1);
      expect(gate.inactive).toEqual([]);
      expect(gate.active).toEqual([]);
    },
  );
});
