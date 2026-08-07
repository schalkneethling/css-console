/**
 * Deterministic fixture builders.
 *
 * These helpers build the source locations, positions, and diagnostics the
 * unit suites need without hard-coding a URL or a line and column pair in
 * every test. Every builder is a pure function of its arguments, so calling
 * one twice with the same input returns equal values. This file lives under
 * test/, where node imports are allowed, so `loadFixture()` reads a fixture
 * file synchronously with `node:fs` rather than through a bundler asset
 * pipeline.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createDiagnostic } from "../../src/core/diagnostics/index.ts";
import type {
  CreateDiagnosticOptions,
  Diagnostic,
  DiagnosticCode,
} from "../../src/core/diagnostics/index.ts";
import type { SourceLocation, SourcePosition } from "../../src/core/records/index.ts";

/**
 * The origin every fixture URL is built from. `.invalid` is the domain
 * suffix reserved by RFC 2606 for names that can never resolve to a real
 * host, so a fixture URL can never collide with a live source.
 */
export const FIXTURE_ORIGIN = "https://fixtures.css-console.invalid";

/**
 * The two fixture sets under test/fixtures. A representative fixture reads
 * like real CSS an author would write. A hardening fixture probes a
 * boundary, such as an omitted semicolon or an unusual comment placement,
 * and is kept separate so a reader can tell intended behavior from edge-case
 * coverage, following the fixture philosophy in the implementation plan.
 */
export type FixtureSet = "representative" | "hardening";

/**
 * Builds the deterministic fixture URL for a fixture name. The URL is a pure
 * function of the name: the same name always builds the same URL, appended
 * with the `.css` extension under the reserved fixture origin.
 */
export function fixtureUrl(name: string): string {
  return `${FIXTURE_ORIGIN}/${name}.css`;
}

/**
 * Builds a one-based source position. With no arguments, the position is the
 * documented default origin, line 1 and column 1. Explicit arguments pass
 * through unchanged.
 */
export function fixturePosition(line = 1, column = 1): SourcePosition {
  return { line, column };
}

/**
 * Builds a deterministic source location for a fixture name. With no
 * explicit positions, both the start and end default to the one-based
 * origin. Explicit positions pass through unchanged.
 */
export function fixtureLocation(
  name: string,
  start: SourcePosition = fixturePosition(),
  end: SourcePosition = fixturePosition(),
): SourceLocation {
  return { url: fixtureUrl(name), start, end };
}

/**
 * Builds a diagnostic for a fixture by delegating to `createDiagnostic()`.
 * This helper exists so that fixture-authoring tests read as fixture code
 * while asserting the exact same shape the diagnostic registry produces.
 */
export function fixtureDiagnostic(
  code: DiagnosticCode,
  options?: CreateDiagnosticOptions,
): Diagnostic {
  return createDiagnostic(code, options);
}

/**
 * A fixture stylesheet's contents paired with the deterministic URL
 * `fixtureUrl()` builds for it.
 */
export type LoadedFixture = {
  url: string;
  css: string;
};

/**
 * Reads a fixture stylesheet from test/fixtures/<set>/<name>.css and pairs
 * its contents with the deterministic URL for `<set>/<name>`. The read is
 * synchronous because fixtures are small, local files and the suites that
 * call this helper run outside any timing-sensitive path.
 */
export function loadFixture(set: FixtureSet, name: string): LoadedFixture {
  const path = resolve(import.meta.dirname, "../fixtures", set, `${name}.css`);
  const css = readFileSync(path, "utf8");

  return { url: fixtureUrl(`${set}/${name}`), css };
}
