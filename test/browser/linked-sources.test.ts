import { expect, test } from "vite-plus/test";

import {
  SOURCE_IDENTITY_ATTRIBUTE,
  createSourceIdentity,
  discoverLinkElements,
  loadLinkedSources,
} from "../../src/browser/sources/index.ts";

/**
 * Linked stylesheet discovery and loading, checked against a real document
 * and, wherever the environment can produce the case, a real network.
 *
 * Everything here runs against headless Chromium 151.0.7922.34 served by the
 * Vitest browser project's Vite dev server, which is what makes most of this
 * suite honest rather than simulated. A relative `href` is resolved by the
 * engine, a 404 is answered by a real server, a cross-origin request to a
 * reserved `.invalid` host is rejected by the real network stack, and an
 * `AbortSignal` cancels a real request in flight. Only one case cannot be
 * observed from inside the page: whether two links to one URL produced one
 * request or two. `performance.getEntriesByName()` reported no entry for a
 * `fetch()` this suite had just awaited, so request counting is done with a
 * counting wrapper around the real `fetch()` passed through
 * `loadLinkedSources()` options. The wrapper still performs the real request;
 * it only records that it was asked to.
 *
 * The fixture stylesheets are the project's own representative fixtures,
 * requested with Vite's `?direct` query. Pinned rather than recalled: a plain
 * request for `/test/fixtures/representative/card-components.css` is answered
 * by the dev server with `content-type: text/javascript` and a JavaScript
 * module wrapping the CSS, because Vite transforms stylesheets into modules;
 * the same path with `?direct` is answered with `content-type: text/css` and
 * the stylesheet text. The loader is indifferent to both, since it never
 * inspects a content type, but a test that asserts on CSS text needs the
 * response that carries it.
 */

/** A representative fixture served as CSS text rather than as a Vite module. */
const FIXTURE_PATH = "test/fixtures/representative/card-components.css?direct";

/** The same fixture as an absolute, same-origin URL. */
const FIXTURE_URL = new URL(FIXTURE_PATH, document.baseURI).href;

/** A second fixture, so that two links can differ in URL. */
const OTHER_PATH = "test/fixtures/representative/nested-card.css?direct";

/** A same-origin path the dev server answers with 404. */
const MISSING_PATH = "test/fixtures/representative/there-is-no-such-file.css";

/**
 * A cross-origin URL that cannot resolve. `.invalid` is reserved by RFC 2606,
 * so this host can never exist, and the request is rejected without reaching
 * a server.
 */
const UNREACHABLE_URL = "https://cssc-025.invalid/x.css";

/** A fixture host appended to the document and removed however the body ends. */
async function withFixture<T>(markup: string, body: (host: HTMLElement) => Promise<T>): Promise<T> {
  const host = document.createElement("div");

  host.innerHTML = markup;
  document.body.append(host);

  try {
    return await body(host);
  } finally {
    host.remove();
  }
}

/** A `fetch()` that performs the real request and records the URLs it is given. */
function countingFetch(): { fetch: typeof globalThis.fetch; calls: string[] } {
  const calls: string[] = [];
  const wrapped: typeof globalThis.fetch = (input, init) => {
    calls.push(input instanceof Request ? input.url : input.toString());

    return globalThis.fetch(input, init);
  };

  return { fetch: wrapped, calls };
}

test("a same-origin link becomes one source carrying its element, resolved URL, and CSS", async () => {
  await withFixture(`<link rel="stylesheet" href="/${FIXTURE_PATH}">`, async (host) => {
    const { sources, diagnostics } = await loadLinkedSources(host, createSourceIdentity());

    expect(diagnostics).toEqual([]);
    expect(sources).toHaveLength(1);

    const source = sources[0];

    if (source === undefined) {
      throw new Error("expected one linked source");
    }

    expect(source.kind).toBe("link-element");
    expect(source.url).toBe(FIXTURE_URL);
    expect(source.id).toBe(FIXTURE_URL);
    expect(source.element).toBe(host.querySelector("link"));
    expect(source.css).toContain("--space-unit");
  });
});

test("a relative href is resolved against the document, because the loader reads link.href", async () => {
  await withFixture(`<link rel="stylesheet" href="${FIXTURE_PATH}">`, async (host) => {
    const link = host.querySelector("link");

    // Pinned rather than recalled: `href` is a URL-reflecting IDL attribute,
    // so the engine resolves it against the element's base URL, while
    // `getAttribute()` returns the authored string unchanged. Reading the
    // attribute would make the loader reimplement base-URL resolution,
    // including the `<base>` element, and it would fetch a path relative to
    // whatever the fetch call happened to resolve against instead.
    expect(link?.getAttribute("href")).toBe(FIXTURE_PATH);
    expect(link?.href).toBe(FIXTURE_URL);

    const { sources } = await loadLinkedSources(host, createSourceIdentity());

    expect(sources[0]?.url).toBe(FIXTURE_URL);
    expect(sources[0]?.css).toContain("--space-unit");
  });
});

test("an HTTP error status is reported as SOURCE_HTTP_ERROR carrying the status", async () => {
  await withFixture(`<link rel="stylesheet" href="/${MISSING_PATH}">`, async (host) => {
    const { sources, diagnostics } = await loadLinkedSources(host, createSourceIdentity());

    expect(sources).toEqual([]);
    expect(diagnostics).toHaveLength(1);

    const diagnostic = diagnostics[0];

    if (diagnostic === undefined) {
      throw new Error("expected one diagnostic");
    }

    expect(diagnostic.code).toBe("SOURCE_HTTP_ERROR");
    expect(diagnostic.severity).toBe("error");
    expect(diagnostic.details?.status).toBe(404);
    expect(diagnostic.details?.url).toBe(new URL(MISSING_PATH, document.baseURI).href);
    // A transport failure has no CSS position, so no location is synthesized;
    // the URL travels in `details` instead.
    expect(diagnostic.source).toBeUndefined();
  });
});

test("a rejected fetch is reported as SOURCE_LOAD_FAILED without attributing a cause", async () => {
  await withFixture(`<link rel="stylesheet" href="${UNREACHABLE_URL}">`, async (host) => {
    const { sources, diagnostics } = await loadLinkedSources(host, createSourceIdentity());

    expect(sources).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SOURCE_LOAD_FAILED");
    expect(diagnostics[0]?.details?.url).toBe(UNREACHABLE_URL);
    expect(diagnostics[0]?.details?.error).toBe("TypeError");
    expect(diagnostics[0]?.source).toBeUndefined();
  });
});

test("a blocked request rejects with a TypeError, which is why no cause is attributed", async () => {
  // The claim the SOURCE_LOAD_FAILED wording rests on, pinned against the
  // engine rather than recalled: a request that cannot be made surfaces as a
  // rejected `TypeError` with no detail, by design, so that cross-origin
  // state does not leak to page JavaScript. A CORS refusal and a Content
  // Security Policy refusal arrive the same way, and the loader therefore
  // cannot tell a reader which one happened.
  const error = await globalThis.fetch(UNREACHABLE_URL).then(
    () => null,
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(TypeError);
  expect((error as Error).name).toBe("TypeError");
});

test("two links to one URL become two sources sharing text, fetched once", async () => {
  await withFixture(
    `<link rel="stylesheet" href="/${FIXTURE_PATH}">
     <link rel="stylesheet" href="/${FIXTURE_PATH}">`,
    async (host) => {
      const counting = countingFetch();
      const { sources, diagnostics } = await loadLinkedSources(host, createSourceIdentity(), {
        fetch: counting.fetch,
      });

      expect(diagnostics).toEqual([]);
      // One source per link, so a report can attribute a finding to the link
      // element that carried it, and one request per unique URL, so the
      // network is not hit twice for one stylesheet.
      expect(sources).toHaveLength(2);
      expect(counting.calls).toEqual([FIXTURE_URL]);
      expect(sources[0]?.css).toBe(sources[1]?.css);
      expect(sources[0]?.element).not.toBe(sources[1]?.element);

      // Identity must still distinguish them, because two sources sharing one
      // identifier would collapse into one in every report.
      expect(sources[0]?.id).toBe(FIXTURE_URL);
      expect(sources[1]?.id).toBe(`${FIXTURE_URL}-2`);
      expect(sources[0]?.url).toBe(FIXTURE_URL);
      expect(sources[1]?.url).toBe(FIXTURE_URL);
    },
  );
});

test("a link to a resource that is not CSS is loaded like any other, because content type is not checked", async () => {
  await withFixture(`<link rel="stylesheet" href="/package.json">`, async (host) => {
    const { sources, diagnostics } = await loadLinkedSources(host, createSourceIdentity());

    expect(diagnostics).toEqual([]);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.css).toContain('"name"');
  });
});

test("the engine itself applies a same-origin JSON response as an empty stylesheet", async () => {
  // The reason the loader does not filter on content type, pinned rather than
  // recalled. A `<link rel="stylesheet">` pointing at a same-origin
  // `application/json` response fires `load` in Chromium 151.0.7922.34 with
  // the document in standards mode, and the engine builds a stylesheet from
  // it that contains no rules. The engine is therefore not refusing every
  // response that is not `text/css`, so a loader that refused one would
  // report a source the engine had accepted as missing. What a non-CSS body
  // costs is nothing: it carries no annotation, so it compiles to no probe.
  await withFixture(`<link rel="stylesheet" href="/package.json">`, async (host) => {
    const link = host.querySelector("link");

    if (link === null) {
      throw new Error("expected a link element");
    }

    const event = await new Promise<string>((resolve) => {
      link.addEventListener("load", () => {
        resolve("load");
      });
      link.addEventListener("error", () => {
        resolve("error");
      });
    });

    expect(document.compatMode).toBe("CSS1Compat");
    expect(event).toBe("load");
    expect(link.sheet?.cssRules).toHaveLength(0);
  });
});

test("an aborted load rejects with the AbortError rather than reporting a diagnostic", async () => {
  await withFixture(`<link rel="stylesheet" href="/${FIXTURE_PATH}">`, async (host) => {
    const controller = new AbortController();
    const pending = loadLinkedSources(host, createSourceIdentity(), {
      signal: controller.signal,
    });

    controller.abort();

    // A caller that asked for the abort is told the load did not finish. A
    // SOURCE_LOAD_FAILED diagnostic would report the caller's own decision as
    // a failure of the page being scanned.
    const error = await pending.then(
      () => null,
      (reason: unknown) => reason,
    );

    expect((error as Error).name).toBe("AbortError");
  });
});

test("a signal already aborted rejects without requesting anything", async () => {
  await withFixture(`<link rel="stylesheet" href="/${FIXTURE_PATH}">`, async (host) => {
    const controller = new AbortController();

    controller.abort();

    const counting = countingFetch();
    const error = await loadLinkedSources(host, createSourceIdentity(), {
      fetch: counting.fetch,
      signal: controller.signal,
    }).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect((error as Error).name).toBe("AbortError");
    expect(counting.calls).toEqual([]);
  });
});

test("one failing link does not prevent another link from loading", async () => {
  await withFixture(
    `<link rel="stylesheet" href="${UNREACHABLE_URL}">
     <link rel="stylesheet" href="/${FIXTURE_PATH}">
     <link rel="stylesheet" href="/${MISSING_PATH}">
     <link rel="stylesheet" href="/${OTHER_PATH}">`,
    async (host) => {
      const { sources, diagnostics } = await loadLinkedSources(host, createSourceIdentity());

      expect(sources.map((source) => source.url)).toEqual([
        FIXTURE_URL,
        new URL(OTHER_PATH, document.baseURI).href,
      ]);
      // Diagnostics follow document order even though the requests ran
      // concurrently and finished in whatever order the network produced.
      expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        "SOURCE_LOAD_FAILED",
        "SOURCE_HTTP_ERROR",
      ]);
    },
  );
});

test("two links to one failing URL report the failure once", async () => {
  await withFixture(
    `<link rel="stylesheet" href="${UNREACHABLE_URL}">
     <link rel="stylesheet" href="${UNREACHABLE_URL}">`,
    async (host) => {
      const { diagnostics } = await loadLinkedSources(host, createSourceIdentity());

      // The diagnostic describes a request, and one request was made.
      expect(diagnostics).toHaveLength(1);
    },
  );
});

test("discovery selects stylesheet links by an ASCII case-insensitive rel token", async () => {
  await withFixture(
    `<link rel="StyleSheet" href="/${FIXTURE_PATH}">
     <link rel="preload alternate stylesheet" href="/${OTHER_PATH}">
     <link rel="icon" href="/${FIXTURE_PATH}">
     <link rel="preload" href="/${FIXTURE_PATH}">
     <link rel="stylesheetish" href="/${FIXTURE_PATH}">`,
    async (host) => {
      const links = host.querySelectorAll("link");
      const mixedCase = links[0];

      if (mixedCase === undefined) {
        throw new Error("expected a link element");
      }

      // Pinned rather than recalled, and the reason discovery does not use
      // `relList`: `DOMTokenList.contains()` matches a token exactly, so it
      // answers false for `rel="StyleSheet"`, while the engine treats that
      // link as a stylesheet and applies it. Link relationship keywords are
      // ASCII case-insensitive, so discovery lowercases each token itself.
      expect(mixedCase.relList.contains("stylesheet")).toBe(false);

      const discovered = discoverLinkElements(host);

      expect(discovered).toHaveLength(2);
      expect(discovered[0]).toBe(links[0]);
      expect(discovered[1]).toBe(links[1]);
    },
  );
});

test("the engine applies a mixed-case rel, which is why case-insensitive matching is required", async () => {
  await withFixture(`<link rel="StyleSheet" href="/${FIXTURE_PATH}">`, async (host) => {
    const link = host.querySelector("link");

    if (link === null) {
      throw new Error("expected a link element");
    }

    await new Promise<void>((resolve) => {
      link.addEventListener("load", () => {
        resolve();
      });
      link.addEventListener("error", () => {
        resolve();
      });
    });

    expect(link.sheet?.cssRules.length ?? 0).toBeGreaterThan(0);
  });
});

test("a link with no href, or an empty one, is skipped rather than resolved to the document", async () => {
  await withFixture(
    `<link rel="stylesheet">
     <link rel="stylesheet" href="">
     <link rel="stylesheet" href="   ">`,
    async (host) => {
      const first = host.querySelector("link");

      // Pinned rather than recalled: with no `href` attribute the IDL
      // attribute is the empty string, and with an empty attribute it is the
      // document's own URL, so a loader that trusted `link.href` alone would
      // request the page that is being scanned.
      expect(first?.href).toBe("");
      expect(host.querySelectorAll("link")[1]?.href).toBe(document.baseURI);

      expect(discoverLinkElements(host)).toEqual([]);

      const counting = countingFetch();
      const { sources, diagnostics } = await loadLinkedSources(host, createSourceIdentity(), {
        fetch: counting.fetch,
      });

      expect(sources).toEqual([]);
      expect(diagnostics).toEqual([]);
      expect(counting.calls).toEqual([]);
    },
  );
});

test("discovery is a read: the markup is unchanged, and nothing is requested", async () => {
  await withFixture(
    `<link rel="stylesheet" href="/${FIXTURE_PATH}">
     <link rel="stylesheet" href="/${MISSING_PATH}">`,
    async (host) => {
      const before = host.outerHTML;

      expect(discoverLinkElements(host)).toHaveLength(2);
      await loadLinkedSources(host, createSourceIdentity());

      expect(host.outerHTML).toBe(before);
    },
  );
});

test("an author-supplied identity attribute wins over the resolved URL", async () => {
  await withFixture(
    `<link ${SOURCE_IDENTITY_ATTRIBUTE}="theme-tokens" rel="stylesheet" href="/${FIXTURE_PATH}">`,
    async (host) => {
      const { sources } = await loadLinkedSources(host, createSourceIdentity());

      expect(sources[0]?.id).toBe("theme-tokens");
      // The identifier names the source; the URL stays the URL, because a
      // diagnostic location has to point at something fetchable.
      expect(sources[0]?.url).toBe(FIXTURE_URL);
    },
  );
});

test("a link that changes href keeps the identifier the identity recorded for it", async () => {
  await withFixture(`<link rel="stylesheet" href="/${FIXTURE_PATH}">`, async (host) => {
    const identity = createSourceIdentity();
    const first = await loadLinkedSources(host, identity);

    expect(first.sources[0]?.id).toBe(FIXTURE_URL);

    const link = host.querySelector("link");

    if (link === null) {
      throw new Error("expected a link element");
    }

    link.setAttribute("href", `/${OTHER_PATH}`);

    const second = await loadLinkedSources(host, identity);

    // The element is the same element, so reports about it stay comparable
    // across the change, exactly as an edited inline style element does.
    expect(second.sources[0]?.id).toBe(FIXTURE_URL);
    expect(second.sources[0]?.url).toBe(new URL(OTHER_PATH, document.baseURI).href);
  });
});

test("a fresh identity names a link by its URL alone, so a reload is comparable", async () => {
  await withFixture(`<link rel="stylesheet" href="/${FIXTURE_PATH}">`, async (host) => {
    const first = await loadLinkedSources(host, createSourceIdentity());
    const second = await loadLinkedSources(host, createSourceIdentity());

    expect(second.sources[0]?.id).toBe(first.sources[0]?.id);
  });
});
