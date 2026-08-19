import { expect, test } from "vite-plus/test";

import {
  SOURCE_IDENTITY_ATTRIBUTE,
  createSourceIdentity,
  discoverStyleSources,
} from "../../src/browser/sources/index.ts";

/**
 * Inline source discovery, checked against a real document.
 *
 * Discovery reads `<style>` elements out of a live tree and names each one,
 * so it belongs in the browser lane and nowhere else: a simulated DOM would
 * assert that the simulation agrees with the implementation rather than that
 * the engine does. Everything here runs against headless Chromium
 * 151.0.7922.34, the version this project's Vitest browser project runs.
 *
 * Two properties carry most of the suite. The first is that discovery is a
 * read: the markup a fixture starts with is the markup it ends with, asserted
 * by serialization equality rather than by inspecting the attributes the
 * implementation happens to know about (implementation plan section 5.9). The
 * second is that identity is stable in the two directions a report needs it
 * to be stable: within one `SourceIdentity` an element keeps its identifier
 * when the document around it changes, and across two identities an unchanged
 * anonymous style hashes to the same identifier, which is what makes a
 * reload comparable to the scan before it.
 *
 * Gating is not tested here because it does not exist here. Discovery returns
 * every style element, including `disabled` and `media="print"` ones; CSSC-027
 * decides which of them a scan reads.
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

/** The identifiers a discovery produced, in the order it produced them. */
function idsOf(host: HTMLElement): readonly string[] {
  return discoverStyleSources(host, createSourceIdentity()).map((source) => source.id);
}

test("one style element becomes one source carrying its element, text, and synthesized URL", () => {
  withFixture(`<style>.card { color: rgb(1 2 3); }</style>`, (host) => {
    const sources = discoverStyleSources(host, createSourceIdentity());

    expect(sources).toHaveLength(1);

    const source = sources[0];

    if (source === undefined) {
      throw new Error("expected one discovered source");
    }

    expect(source.kind).toBe("style-element");
    expect(source.css).toBe(".card { color: rgb(1 2 3); }");
    expect(source.element).toBe(host.querySelector("style"));
    expect(source.url).toBe(`inline:${source.id}`);
  });
});

test("several style elements are discovered in document order rather than insertion order", () => {
  withFixture(
    `<style>.a { color: rgb(1 1 1); }</style>
     <div><style>.b { color: rgb(2 2 2); }</style></div>
     <style>.c { color: rgb(3 3 3); }</style>`,
    (host) => {
      // The third element is moved to the front of the tree after parsing, so
      // an implementation that reported insertion order or held its own list
      // would report `.a`, `.b`, `.c` and fail here. Only reading the tree at
      // discovery time produces the order below.
      const last = host.querySelectorAll("style")[2];

      if (last === undefined) {
        throw new Error("expected three style elements");
      }

      host.prepend(last);

      const sources = discoverStyleSources(host, createSourceIdentity());

      expect(sources.map((source) => source.css)).toEqual([
        ".c { color: rgb(3 3 3); }",
        ".a { color: rgb(1 1 1); }",
        ".b { color: rgb(2 2 2); }",
      ]);
    },
  );
});

test("an empty style element is a source carrying empty text rather than being skipped", () => {
  withFixture(`<style></style>`, (host) => {
    const sources = discoverStyleSources(host, createSourceIdentity());

    expect(sources).toHaveLength(1);
    expect(sources[0]?.css).toBe("");
    // Pinned rather than recalled: an element with no child nodes reports
    // `textContent` as the empty string, not `null`, so discovery needs no
    // special case to keep an empty style element in the list.
    expect(host.querySelector("style")?.textContent).toBe("");
  });
});

test("a style element inserted before the scan is discovered like any other", () => {
  withFixture(`<style>.a { color: rgb(1 1 1); }</style>`, (host) => {
    const inserted = document.createElement("style");

    inserted.textContent = ".b { color: rgb(2 2 2); }";
    host.append(inserted);

    const sources = discoverStyleSources(host, createSourceIdentity());

    expect(sources.map((source) => source.element)).toEqual([
      host.querySelector("style"),
      inserted,
    ]);
  });
});

test("inserting a style element before existing ones leaves the existing identifiers unchanged", () => {
  withFixture(
    `<style>.a { color: rgb(1 1 1); }</style>
     <style>.b { color: rgb(2 2 2); }</style>`,
    (host) => {
      const identity = createSourceIdentity();
      const before = discoverStyleSources(host, identity);
      const inserted = document.createElement("style");

      inserted.textContent = ".inserted { color: rgb(9 9 9); }";
      host.prepend(inserted);

      const after = discoverStyleSources(host, identity);

      expect(after).toHaveLength(3);
      // The two original elements moved from positions zero and one to
      // positions one and two, and kept the identifiers the first discovery
      // gave them. That is the `WeakMap` half of the scheme: a positional
      // identifier would renumber both of them here.
      expect(after.slice(1).map((source) => source.id)).toEqual(before.map((source) => source.id));
    },
  );
});

test("an element keeps its identifier within one identity even after its text changes", () => {
  withFixture(`<style>.a { color: rgb(1 1 1); }</style>`, (host) => {
    const identity = createSourceIdentity();
    const element = host.querySelector("style");

    if (element === null) {
      throw new Error("expected a style element");
    }

    const first = discoverStyleSources(host, identity)[0]?.id;

    element.textContent = ".a { color: rgb(4 4 4); }";

    expect(discoverStyleSources(host, identity)[0]?.id).toBe(first);
  });
});

test("an unchanged anonymous style hashes to the same identifier under a fresh identity", () => {
  const markup = `<style>.a { color: rgb(1 1 1); }</style>`;
  // Two fixtures built and torn down in turn, each read by its own identity,
  // stand in for the same page loaded twice. Nothing survives between them
  // except the text of the style element, so an identifier that agrees can
  // only have come from the content hash.
  const first = withFixture(markup, idsOf);
  const second = withFixture(markup, idsOf);

  expect(second).toEqual(first);
});

test("styles with different text receive different identifiers", () => {
  withFixture(
    `<style>.a { color: rgb(1 1 1); }</style>
     <style>.b { color: rgb(2 2 2); }</style>`,
    (host) => {
      const [first, second] = idsOf(host);

      expect(first).not.toBe(second);
    },
  );
});

test("two byte-identical anonymous styles share a hash and are separated by a positional counter", () => {
  withFixture(
    `<style>.same { color: rgb(1 1 1); }</style>
     <style>.same { color: rgb(1 1 1); }</style>`,
    (host) => {
      const [first, second] = idsOf(host);

      if (first === undefined || second === undefined) {
        throw new Error("expected two discovered sources");
      }

      // Documented behavior rather than a defect: identical content hashes
      // identically, so the second element is distinguished by its position
      // among the collisions and by nothing else.
      expect(second.startsWith(first)).toBe(true);
      expect(second).not.toBe(first);
      expect(new Set([first, second]).size).toBe(2);
    },
  );
});

test("an author-supplied identity attribute becomes the identifier verbatim", () => {
  withFixture(
    `<style ${SOURCE_IDENTITY_ATTRIBUTE}="theme-tokens">.a { color: rgb(1 1 1); }</style>`,
    (host) => {
      const sources = discoverStyleSources(host, createSourceIdentity());

      expect(sources[0]?.id).toBe("theme-tokens");
      expect(sources[0]?.url).toBe("inline:theme-tokens");
    },
  );
});

test("an author-supplied identity survives a move that a generated identifier would also survive", () => {
  withFixture(
    `<style ${SOURCE_IDENTITY_ATTRIBUTE}="theme-tokens">.a { color: rgb(1 1 1); }</style>
     <style>.b { color: rgb(2 2 2); }</style>`,
    (host) => {
      const identity = createSourceIdentity();

      expect(discoverStyleSources(host, identity)[0]?.id).toBe("theme-tokens");

      const authored = host.querySelector("style");

      if (authored === null) {
        throw new Error("expected a style element");
      }

      host.append(authored);

      expect(discoverStyleSources(host, identity)[1]?.id).toBe("theme-tokens");
    },
  );
});

test("an empty identity attribute is treated as absent rather than as an empty identifier", () => {
  withFixture(
    `<style ${SOURCE_IDENTITY_ATTRIBUTE}="">.a { color: rgb(1 1 1); }</style>`,
    (host) => {
      expect(idsOf(host)[0]).not.toBe("");
    },
  );
});

test("a generated identifier never collides with an author-supplied one it would have matched", () => {
  withFixture(`<style>.a { color: rgb(1 1 1); }</style>`, (host) => {
    const generated = idsOf(host)[0];

    if (generated === undefined) {
      throw new Error("expected one discovered source");
    }

    // The author claims the exact identifier the second element would
    // otherwise generate. Reservation happens before generation, so the
    // anonymous element takes the disambiguated form instead.
    const claimed = document.createElement("style");

    claimed.setAttribute(SOURCE_IDENTITY_ATTRIBUTE, generated);
    claimed.textContent = ".unrelated { color: rgb(5 5 5); }";
    host.append(claimed);

    const ids = idsOf(host);

    expect(ids[1]).toBe(generated);
    expect(ids[0]).not.toBe(generated);
    expect(ids[0]?.startsWith(generated)).toBe(true);
  });
});

test("discovery leaves the markup byte-identical, including the identity attribute", () => {
  withFixture(
    `<style>.a { color: rgb(1 1 1); }</style>
     <style ${SOURCE_IDENTITY_ATTRIBUTE}="theme-tokens">.b { color: rgb(2 2 2); }</style>
     <style disabled media="print"></style>`,
    (host) => {
      const before = host.outerHTML;

      discoverStyleSources(host, createSourceIdentity());
      discoverStyleSources(host, createSourceIdentity());

      expect(host.outerHTML).toBe(before);
    },
  );
});

test("disabled and print-media style elements are discovered, because gating is a later pass", () => {
  withFixture(
    `<style media="print">.a { color: rgb(1 1 1); }</style>
     <style disabled>.b { color: rgb(2 2 2); }</style>`,
    (host) => {
      expect(discoverStyleSources(host, createSourceIdentity())).toHaveLength(2);
    },
  );
});

test("two identities name the same element independently, because no state is shared between them", () => {
  withFixture(
    `<style>.a { color: rgb(1 1 1); }</style>
     <style>.b { color: rgb(2 2 2); }</style>`,
    (host) => {
      const first = createSourceIdentity();
      const second = createSourceIdentity();
      const before = discoverStyleSources(host, first).map((source) => source.id);
      const element = host.querySelector("style");

      if (element === null) {
        throw new Error("expected a style element");
      }

      // The first identity has already named this element, so it keeps that
      // name after the move. A second identity, having never seen the tree,
      // names the moved element by content alone. The two answers differ in
      // position and agree in value, which they could not do if the identity
      // state lived in the module rather than in the object.
      host.append(element);

      expect(discoverStyleSources(host, first).map((source) => source.id)).toEqual([
        before[1],
        before[0],
      ]);
      expect(discoverStyleSources(host, second).map((source) => source.id)).toEqual([
        before[1],
        before[0],
      ]);
    },
  );
});

test("a document root discovers the style elements the fixture adds to it", () => {
  withFixture(`<style>.document-root { color: rgb(7 7 7); }</style>`, () => {
    const sources = discoverStyleSources(document, createSourceIdentity());

    expect(sources.some((source) => source.css.includes(".document-root"))).toBe(true);
  });
});
