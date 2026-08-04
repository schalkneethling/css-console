import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { expect, test } from "vite-plus/test";

import { createDiagnostic } from "../../src/core/diagnostics/index.ts";
import {
  FIXTURE_ORIGIN,
  fixtureDiagnostic,
  fixtureLocation,
  fixturePosition,
  fixtureUrl,
  loadFixture,
} from "../support/fixtures.ts";
import type { FixtureSet } from "../support/fixtures.ts";

import type { Equal, Expect } from "./type-level.ts";

/**
 * Fixture builder and fixture convention tests.
 *
 * This suite proves two things. First, the fixture builders are deterministic
 * and carry the documented defaults: the fixture origin is the reserved
 * .invalid domain so a fixture URL can never resolve to a real host, a fixture
 * URL is a pure function of its name, positions and locations default to the
 * one-based origin the record contract uses, and the fixture diagnostic helper
 * delegates to createDiagnostic so the two agree field for field. Second, the
 * fixture conventions from the fixture philosophy hold: a representative set
 * that reads like real CSS and a separately labeled hardening set both exist
 * and are non-empty, every fixture file is a stylesheet, the convention is
 * written down, and loadFixture pairs a file's contents with its deterministic
 * URL. The suite asserts stable properties such as the URL shape and the
 * presence of an annotation rather than snapshotting file contents.
 */

const FIXTURES_ROOT = resolve(import.meta.dirname, "../fixtures");
const FIXTURE_SETS: readonly FixtureSet[] = ["representative", "hardening"];

/**
 * Returns the base names, without the .css extension, of the stylesheet files
 * directly inside one fixture set directory. loadFixture reads a fixture by
 * this base name, so the tests drive it with a name the directory actually
 * carries rather than a hard-coded guess.
 */
function fixtureNames(set: FixtureSet): string[] {
  const directory = join(FIXTURES_ROOT, set);

  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".css"))
    .map((entry) => entry.slice(0, -".css".length))
    .sort();
}

/**
 * Returns every file path under one directory, walking nested directories, so
 * the extension check covers the whole set rather than its top level only.
 */
function filesUnder(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      found.push(...filesUnder(path));
    } else {
      found.push(path);
    }
  }

  return found;
}

test("the fixture origin is the reserved .invalid domain", () => {
  expect(FIXTURE_ORIGIN).toBe("https://fixtures.css-console.invalid");
});

test("a fixture URL is deterministic and built from the origin and the name", () => {
  expect(fixtureUrl("cards")).toBe(`${FIXTURE_ORIGIN}/cards.css`);
  expect(fixtureUrl("cards")).toBe(fixtureUrl("cards"));
  expect(fixtureUrl("cards").endsWith(".css")).toBe(true);
  expect(fixtureUrl("cards").includes(".invalid")).toBe(true);
});

test("a fixture position defaults to the one-based origin and passes overrides through", () => {
  expect(fixturePosition()).toEqual({ line: 1, column: 1 });
  expect(fixturePosition(3, 5)).toEqual({ line: 3, column: 5 });
  expect(fixturePosition()).toEqual(fixturePosition());
});

test("a fixture location carries the matching URL and the documented default span", () => {
  const location = fixtureLocation("cards");

  expect(location.url).toBe(fixtureUrl("cards"));
  expect(location.start).toEqual({ line: 1, column: 1 });
  expect(location.end).toEqual({ line: 1, column: 1 });
  expect(fixtureLocation("cards")).toEqual(fixtureLocation("cards"));
});

test("a fixture location passes explicit positions through", () => {
  const start = { line: 2, column: 3 };
  const end = { line: 2, column: 30 };
  const location = fixtureLocation("cards", start, end);

  expect(location.url).toBe(fixtureUrl("cards"));
  expect(location.start).toEqual(start);
  expect(location.end).toEqual(end);
});

test("the fixture diagnostic helper agrees with createDiagnostic field for field", () => {
  expect(fixtureDiagnostic("NO_TARGET")).toEqual(createDiagnostic("NO_TARGET"));

  const source = fixtureLocation("cards");
  const overrides = { message: "A tailored message.", source, details: { atRule: "@media" } };

  expect(fixtureDiagnostic("OUTSIDE_SUPPORTED_TARGET_SET", overrides)).toEqual(
    createDiagnostic("OUTSIDE_SUPPORTED_TARGET_SET", overrides),
  );
});

test("both fixture sets exist and hold at least one stylesheet", () => {
  for (const set of FIXTURE_SETS) {
    expect(fixtureNames(set).length, set).toBeGreaterThan(0);
  }
});

test("every file under each fixture set is a stylesheet", () => {
  for (const set of FIXTURE_SETS) {
    for (const path of filesUnder(join(FIXTURES_ROOT, set))) {
      expect(path.endsWith(".css"), path).toBe(true);
    }
  }
});

test("the fixture README exists and names both sets", () => {
  const readme = readFileSync(join(FIXTURES_ROOT, "README.md"), "utf8");

  expect(readme.includes("representative")).toBe(true);
  expect(readme.includes("hardening")).toBe(true);
});

test("loadFixture pairs the file contents with the deterministic URL for each set", () => {
  for (const set of FIXTURE_SETS) {
    const [name] = fixtureNames(set);
    const loaded = loadFixture(set, name);

    expect(loaded.url, set).toBe(fixtureUrl(`${set}/${name}`));
    expect(loaded.css.trim().length, set).toBeGreaterThan(0);
  }
});

test("a representative fixture reads like real CSS carrying a css-console annotation", () => {
  const [name] = fixtureNames("representative");
  const loaded = loadFixture("representative", name);

  expect(loaded.css.includes("css-console:")).toBe(true);
});

/**
 * The type-level assertion is checked by the compiler through
 * tsconfig.test.json. The export keeps the unused-local check from flagging it.
 */
export type FixtureTypeAssertions = [Expect<Equal<FixtureSet, "representative" | "hardening">>];
