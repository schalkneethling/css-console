import { expect, test } from "vite-plus/test";

import { compileSource, guardCandidates } from "../../src/core/compiler/index.ts";
import type {
  CompiledCallSite,
  CompiledFunctionProbe,
  CompiledProbe,
  CompiledSource,
  CompiledValueProbe,
  IndexedDeclaration,
} from "../../src/core/compiler/index.ts";
import type { ProbeRecord } from "../../src/core/records/index.ts";

import { fixtureUrl, loadFixture } from "../support/fixtures.ts";
import type { Equal, Expect } from "./type-level.ts";

/**
 * Source compilation contract tests.
 *
 * CSSC-016 composes every Phase 1 module into one function, so these are
 * contract tests over complete fixtures rather than unit cases over one
 * pass. Each piece is already tested on its own; what is untested until here
 * is whether they compose into something coherent, which is a question only a
 * whole result can answer. The representative fixtures are compiled and the
 * whole outcome asserted at once: probes of every kind, call sites,
 * definition references, the guard index, and diagnostics together.
 *
 * Nothing here evaluates CSS. Selectors are resolved but never matched,
 * conditions are recorded but never tested, and values are read as authored
 * but never resolved, so no test in this suite needs a document.
 *
 * Two invariants are asserted across every fixture rather than case by case,
 * because both are failures that hide behind a result that otherwise looks
 * complete. Every compiled property carries its guard index entry, since a
 * property without one would make the guard report every probe as contested
 * by itself. And no annotation compiles to neither a probe nor a diagnostic,
 * since an annotation that produces nothing at all is indistinguishable from
 * one the compiler never reached.
 */

const INLINE_URL = fixtureUrl("inline");

/** Compiles an inline source under the shared fixture URL. */
function compile(css: string): CompiledSource {
  return compileSource(css, { url: INLINE_URL });
}

/** Compiles a fixture stylesheet under its deterministic fixture URL. */
function compileFixture(set: "representative" | "hardening", name: string): CompiledSource {
  const { css, url } = loadFixture(set, name);

  return compileSource(css, { url });
}

/** The diagnostic codes a compiled source carries, in the order it carries them. */
function codes(compiled: CompiledSource): string[] {
  return compiled.diagnostics.map((diagnostic) => diagnostic.code);
}

/** The start positions a compiled source's diagnostics point at, in order. */
function positions(compiled: CompiledSource): string[] {
  return compiled.diagnostics.map((diagnostic) =>
    diagnostic.source === undefined
      ? "-"
      : `${diagnostic.source.start.line}:${diagnostic.source.start.column}`,
  );
}

/** Narrows to a value probe, failing the test when the probe is another kind. */
function valueProbe(probe: CompiledProbe | undefined): CompiledValueProbe {
  if (probe === undefined || probe.kind !== "value") {
    throw new Error("expected a value probe");
  }

  return probe;
}

/** Narrows to a function probe, failing the test when the probe is another kind. */
function functionProbe(probe: CompiledProbe | undefined): CompiledFunctionProbe {
  if (probe === undefined || probe.kind !== "function") {
    throw new Error("expected a function probe");
  }

  return probe;
}

/** Every fixture that carries at least one annotation, by set and name. */
const ANNOTATED_FIXTURES: readonly (readonly ["representative" | "hardening", string])[] = [
  ["representative", "card-components"],
  ["representative", "custom-functions"],
  ["representative", "nested-card"],
  ["hardening", "at-rule-declarations"],
  ["hardening", "at-rule-targets"],
  ["hardening", "omitted-semicolon"],
  ["hardening", "rule-probe-properties"],
];

test("a representative fixture compiles probes of every kind, in source order", () => {
  const compiled = compileFixture("representative", "card-components");

  expect(compiled.url).toBe(fixtureUrl("representative/card-components"));
  expect(compiled.probes.map((probe) => probe.kind)).toEqual(["function", "value", "value"]);
  expect(codes(compiled)).toEqual([]);

  const spacing = functionProbe(compiled.probes[0]);

  expect(spacing.functionName).toBe("--space");
  expect(spacing.logLevel).toBe("log");
  expect(spacing.label).toBe("spacing scale");
  expect(spacing.definition.start.line).toBe(8);
  expect(spacing.callSites.map((callSite) => callSite.property)).toEqual([
    "padding",
    "border-radius",
  ]);
  expect(spacing.callSites.map((callSite) => callSite.arguments)).toEqual([["4"], ["2"]]);
  expect(spacing.callSites.every((callSite) => callSite.soleContribution)).toBe(true);
  expect(spacing.callSites.every((callSite) => callSite.selector === ".card")).toBe(true);
  expect(spacing.definitionReferences).toEqual([]);

  const card = valueProbe(compiled.probes[1]);

  expect(card.label).toBe("cards");
  expect(card.selector).toBe(".card");
  expect(card.context.entries).toEqual([]);
  expect(card.branches.map((branch) => branch.selector)).toEqual([".card"]);
  expect(card.branches.map((branch) => branch.pseudo)).toEqual([null]);
  // The requested order, not source order: `border-radius` is declared
  // between them in the fixture and the annotation did not ask for it.
  expect(card.properties.map((property) => property.name)).toEqual(["padding", "background-color"]);
  expect(card.properties[0]?.authored).toBe("--space(4)");
  expect(card.properties[1]?.customProperties.map((reference) => reference.name)).toEqual([
    "--brand",
    "--surface",
  ]);
});

test("a declaration probe compiles to the same shape as a rule probe property", () => {
  const compiled = compileFixture("representative", "card-components");
  const title = valueProbe(compiled.probes[2]);

  expect(title.kind).toBe("value");
  expect(title.logLevel).toBe("info");
  expect(title.label).toBe("card title color");
  expect(title.selector).toBe(".card__title");
  expect(title.source.start.line).toBe(21);
  expect(title.annotation.start.line).toBe(21);
  expect(title.properties).toHaveLength(1);
  expect(title.properties[0]?.name).toBe("color");
  expect(title.properties[0]?.authored).toBe("var(--brand)");
  expect(title.properties[0]?.important).toBe(false);
  expect(title.properties[0]?.customProperties).toEqual([{ name: "--brand", fallback: null }]);
});

test("a nested fixture compiles resolved selectors and the conditions around them", () => {
  const compiled = compileFixture("representative", "nested-card");

  expect(codes(compiled)).toEqual([]);
  expect(compiled.probes.map((probe) => valueProbe(probe).selector)).toEqual([
    ".card",
    ":is(.card) .card__title",
    ":is(.card) .card__body",
    ".card",
  ]);

  const body = valueProbe(compiled.probes[2]);

  expect(body.context.entries).toEqual([{ kind: "media", condition: "(min-width: 40rem)" }]);
  expect(body.properties.map((property) => property.name)).toEqual(["display", "gap"]);

  // The last annotation is a declaration probe on a declaration authored
  // after the nested rules, which is the ordering CSS Nesting section 3.4
  // permits and the fixture exists to hold.
  const radius = valueProbe(compiled.probes[3]);

  expect(radius.selector).toBe(".card");
  expect(radius.source.start.line).toBe(30);
  expect(radius.properties.map((property) => property.name)).toEqual(["border-radius"]);
});

test("a fixture containing @function compiles call sites and definition references", () => {
  const compiled = compileFixture("representative", "custom-functions");

  expect(codes(compiled)).toEqual([]);
  expect(compiled.probes).toHaveLength(1);

  const probe = functionProbe(compiled.probes[0]);

  expect(probe.callSites.map((callSite) => callSite.property)).toEqual([
    "padding",
    "margin-block",
    "margin-block",
    "margin-block-end",
  ]);
  expect(probe.callSites.map((callSite) => callSite.soleContribution)).toEqual([
    true,
    false,
    false,
    false,
  ]);
  expect(probe.callSites.map((callSite) => callSite.selector)).toEqual([
    ".card",
    ".card",
    ".card",
    ".card .card__title",
  ]);

  // `--space-loose()` calls `--space()` from inside its own body, which is a
  // reference rather than a call site, because only the outer function's
  // result reaches a declaration.
  expect(probe.definitionReferences).toHaveLength(1);
  expect(probe.definitionReferences[0]?.functionName).toBe("--space-loose");
  expect(probe.definitionReferences[0]?.property).toBe("result");
});

test("a compiled function probe's call sites carry the rule context they were resolved from", () => {
  const compiled = compile(`/* css-console: log */
@function --space(--multiplier) {
  result: calc(var(--multiplier) * 0.25rem);
}

.card {
  padding: --space(4);
}

@media (width > 40em) {
  .card {
    margin: --space(2);
  }
}`);

  const probe = functionProbe(compiled.probes[0]);

  expect(probe.callSites.map((callSite) => callSite.context.entries)).toEqual([
    [],
    [{ kind: "media", condition: "(width > 40em)" }],
  ]);
});

test("a compiled call site nested inside its rule carries the nested condition through compileSource", () => {
  const compiled = compile(`/* css-console: log */
@function --space(--multiplier) {
  result: calc(var(--multiplier) * 0.25rem);
}

.card {
  @media (width > 40em) {
    padding: --space(4);
  }
}`);

  const probe = functionProbe(compiled.probes[0]);

  expect(probe.callSites.map((callSite) => callSite.context.entries)).toEqual([
    [{ kind: "media", condition: "(width > 40em)" }],
  ]);
});

test("a compiled call site carries the guard index entry of its own declaration", () => {
  const compiled = compile(`/* css-console: log */
@function --space(--multiplier) {
  result: calc(var(--multiplier) * 0.25rem);
}

.card {
  padding: --space(4);
}`);

  const probe = functionProbe(compiled.probes[0]);
  const callSite = probe.callSites[0];

  expect(callSite?.indexed?.property).toBe("padding");
  expect(callSite?.indexed?.selector).toBe(".card");
  expect(callSite?.indexed?.important).toBe(false);

  // The entry is the index's own entry rather than a copy of it, so passing
  // it as `self` excludes the call site's declaration from its own guard
  // candidates by identity.
  const candidates = guardCandidates(
    compiled.guardIndex,
    "padding",
    callSite?.indexed ?? undefined,
  );

  expect(callSite?.indexed === undefined || callSite.indexed === null).toBe(false);
  expect([...candidates]).not.toContain(callSite?.indexed);
});

test("a call site whose declaration the guard index excludes carries a null entry", () => {
  // The guard index holds only declarations authored directly in a probeable
  // rule, so a declaration nested inside a conditional at-rule within the
  // rule is absent from it, and the compiled call site says so with null
  // rather than fabricating an entry.
  const compiled = compile(`/* css-console: log */
@function --space(--multiplier) {
  result: calc(var(--multiplier) * 0.25rem);
}

.card {
  @media (width > 40em) {
    padding: --space(4);
  }
}`);

  const probe = functionProbe(compiled.probes[0]);

  expect(probe.callSites).toHaveLength(1);
  expect(probe.callSites[0]?.indexed).toBeNull();
});

test("a function nothing calls compiles to a probe and an informational diagnostic", () => {
  const compiled = compile(`/* css-console: log */
@function --unused(--n) {
  result: calc(var(--n) * 1px);
}

.card {
  padding: 1rem;
}`);

  const probe = functionProbe(compiled.probes[0]);

  expect(probe.callSites).toEqual([]);
  expect(probe.definitionReferences).toEqual([]);
  expect(codes(compiled)).toEqual(["NO_CALL_SITES"]);
});

test("a value probe identifies per branch, because identity includes the pseudo-element", () => {
  const compiled = compile(`/* css-console: log color */
.card::before,
.card,
.card::after {
  color: red;
}`);

  const probe = valueProbe(compiled.probes[0]);

  expect(probe.branches.map((branch) => branch.pseudo)).toEqual(["::before", null, "::after"]);
  expect(probe.branches.every((branch) => branch.selector === ".card")).toBe(true);
  expect(new Set(probe.branches.map((branch) => branch.probeId)).size).toBe(3);
  expect(probe.branches.every((branch) => branch.probeId.startsWith("value-"))).toBe(true);
});

test("a function record identifier composes the probe and the call site", () => {
  const compiled = compileFixture("representative", "custom-functions");
  const probe = functionProbe(compiled.probes[0]);

  expect(probe.probeId).toMatch(/^fn-[\da-f]{8}$/u);

  for (const callSite of probe.callSites) {
    expect(callSite.probeId.startsWith(`${probe.probeId}::call-`)).toBe(true);
  }

  expect(new Set(probe.callSites.map((callSite) => callSite.probeId)).size).toBe(
    probe.callSites.length,
  );
});

test("compiling the same source twice produces the same identifiers", () => {
  const first = compileFixture("representative", "card-components");
  const second = compileFixture("representative", "card-components");

  expect(functionProbe(second.probes[0]).probeId).toBe(functionProbe(first.probes[0]).probeId);
  expect(
    second.probes.map((probe) => (probe.kind === "value" ? probe.branches[0].probeId : "")),
  ).toEqual(first.probes.map((probe) => (probe.kind === "value" ? probe.branches[0].probeId : "")));
});

test("a source with no annotations still contributes a guard index", () => {
  const compiled = compileFixture("hardening", "nested-selectors");

  expect(compiled.probes).toEqual([]);
  expect(codes(compiled)).toEqual([]);
  expect(compiled.guardIndex.byProperty.size).toBeGreaterThan(0);
});

test("every compiled property carries its guard index entry", () => {
  for (const [set, name] of ANNOTATED_FIXTURES) {
    const compiled = compileFixture(set, name);

    for (const probe of compiled.probes) {
      if (probe.kind !== "value") {
        continue;
      }

      for (const property of probe.properties) {
        expect(property.indexed, `${name} ${property.name}`).not.toBeNull();
        expect(property.indexed?.property).toBe(property.name);
        expect(property.indexed?.selector).toBe(probe.selector);
      }
    }
  }
});

test("a probe is never its own guard candidate, and a competitor still is", () => {
  const compiled = compileFixture("hardening", "rule-probe-properties");
  const probe = valueProbe(compiled.probes[0]);
  const color = probe.properties[0];

  expect(color?.name).toBe("color");

  const candidates = guardCandidates(compiled.guardIndex, "color", color?.indexed ?? undefined);

  expect(
    candidates.has(
      color?.indexed ?? { property: "", selector: "", context: { entries: [] }, important: false },
    ),
  ).toBe(false);
  expect([...candidates].map((candidate) => candidate.selector).sort()).toEqual([
    ".widget",
    ":is(.widget) .nested",
  ]);
});

test("an annotation that compiles no probe always says why", () => {
  for (const [set, name] of ANNOTATED_FIXTURES) {
    const compiled = compileFixture(set, name);

    expect(
      compiled.probes.length + compiled.diagnostics.length,
      `${set}/${name} compiled nothing and said nothing`,
    ).toBeGreaterThan(0);
  }
});

test("an at-rule target fixture compiles no probes and three distinguishable tiers", () => {
  const compiled = compileFixture("hardening", "at-rule-targets");

  expect(compiled.probes).toEqual([]);
  expect(codes(compiled)).toEqual([
    "RESERVED_PENDING_SUPPORT",
    "RESERVED_PENDING_SUPPORT",
    "RESERVED_PENDING_SUPPORT",
    "RESERVED_PENDING_SUPPORT",
    "NOT_A_TARGET",
    "NOT_A_TARGET",
    "NOT_A_TARGET",
    "OUTSIDE_SUPPORTED_TARGET_SET",
    "OUTSIDE_SUPPORTED_TARGET_SET",
  ]);
});

test("diagnostics come back in source order, whichever pass produced them", () => {
  const compiled = compile(`/* css-console: nope */
.first { color: red; }

/* css-console: log inset-block-start */
.second { color: blue; }

/* css-console: log */
@media (min-width: 40rem) {
  .third { color: green; }
}`);

  expect(codes(compiled)).toEqual([
    "UNKNOWN_LOG_LEVEL",
    "MISSING_REQUESTED_PROPERTY",
    "NOT_A_TARGET",
  ]);
  expect(positions(compiled)).toEqual(["1:1", "5:1", "7:1"]);
});

test("several rules under one unresolvable ancestor are several diagnostics", () => {
  const compiled = compile(`@container (min-width: 40rem) {
  /* css-console: log */
  .a { color: red; }

  /* css-console: log */
  .b { color: blue; }

  /* css-console: log */
  .c { color: green; }
}`);

  expect(compiled.probes).toEqual([]);
  expect(codes(compiled)).toEqual([
    "OUTSIDE_SUPPORTED_TARGET_SET",
    "OUTSIDE_SUPPORTED_TARGET_SET",
    "OUTSIDE_SUPPORTED_TARGET_SET",
  ]);
  expect(compiled.diagnostics.map((diagnostic) => diagnostic.details?.["selector"])).toEqual([
    ".a",
    ".b",
    ".c",
  ]);
});

test("one rule excluded once is reported once, however many probes reach it", () => {
  const compiled = compile(`/* css-console: log */
@function --a(--n) { result: calc(var(--n) * 1px); }

/* css-console: log */
@function --b(--n) { result: calc(var(--n) * 2px); }

@scope (.card) {
  .x { padding: --a(1); margin: --b(2); }
}`);

  expect(codes(compiled)).toEqual([
    "NO_CALL_SITES",
    "NO_CALL_SITES",
    "OUTSIDE_SUPPORTED_TARGET_SET",
  ]);
  expect(positions(compiled)).toEqual(["2:1", "5:1", "8:3"]);
});

test("a rule probe and a function probe on one excluded rule report it once", () => {
  const compiled = compile(`/* css-console: log */
@function --space(--n) { result: calc(var(--n) * 4px); }

@container (min-width: 40rem) {
  /* css-console: log */
  .a { padding: --space(2); }
}`);

  expect(compiled.probes.map((probe) => probe.kind)).toEqual(["function"]);
  expect(codes(compiled)).toEqual(["NO_CALL_SITES", "OUTSIDE_SUPPORTED_TARGET_SET"]);
});

test("a probe that would match nothing compiles no probe and says why", () => {
  const malformed = compile(`/* css-console: log */
.a, , .b { color: red; }`);

  expect(malformed.probes).toEqual([]);
  expect(codes(malformed)).toEqual(["MALFORMED_SELECTOR_LIST"]);

  const deferred = compile(`/* css-console: log color */
.card::highlight(x),
.card {
  color: red;
}`);
  const probe = valueProbe(deferred.probes[0]);

  expect(probe.branches.map((branch) => branch.authored)).toEqual([".card"]);
  expect(codes(deferred)).toEqual(["DEFERRED_PSEUDO_ELEMENT"]);
});

test("a declaration inside a descriptor at-rule compiles no probe and explains itself", () => {
  const compiled = compileFixture("hardening", "at-rule-declarations");

  expect(compiled.probes).toEqual([]);
  expect(codes(compiled)).toEqual([
    "OUTSIDE_SUPPORTED_TARGET_SET",
    "OUTSIDE_SUPPORTED_TARGET_SET",
    "OUTSIDE_SUPPORTED_TARGET_SET",
  ]);
  expect(compiled.diagnostics.map((diagnostic) => diagnostic.details?.["atRule"])).toEqual([
    "font-face",
    "property",
    "page",
  ]);
});

test("a source PostCSS cannot parse throws rather than compiling silently", () => {
  expect(() => compile(".a { color: red;")).toThrow();
});

/**
 * The compiled union and the published record union discriminate on the same
 * two words, so a consumer that switches over compiled probes and a consumer
 * that switches over records switch over the same discriminant.
 */
export type CompileSourceTypeAssertions = [
  Expect<Equal<CompiledProbe["kind"], ProbeRecord<unknown>["kind"]>>,
  Expect<Equal<CompiledValueProbe["kind"], "value">>,
  Expect<Equal<CompiledFunctionProbe["kind"], "function">>,

  // A compiled call site carries its guard index entry, or null when the
  // index excluded its declaration, mirroring `CompiledProbeProperty`.
  Expect<Equal<CompiledCallSite["indexed"], IndexedDeclaration | null>>,
];
