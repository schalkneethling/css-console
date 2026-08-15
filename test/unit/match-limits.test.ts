import { expect, test } from "vite-plus/test";

import {
  DEFAULT_MAX_ELEMENTS,
  limitMatches,
  validateMaxElements,
} from "../../src/browser/matcher/limits.ts";

/**
 * Match limit validation and application, checked as pure data logic with no
 * DOM dependency.
 *
 * Validation and limiting are exercised separately, mirroring the division
 * of responsibility documented in ../../src/browser/matcher/limits.ts:
 * `validateMaxElements()` runs once at construction, and `limitMatches()`
 * trusts an already-validated value.
 */

test("the default maxElements constant is 50", () => {
  expect(DEFAULT_MAX_ELEMENTS).toBe(50);
});

test("validateMaxElements accepts zero", () => {
  expect(validateMaxElements(0)).toBe(0);
});

test("validateMaxElements accepts one", () => {
  expect(validateMaxElements(1)).toBe(1);
});

test("validateMaxElements accepts a whole number written with a fractional literal", () => {
  // 50.0 and 50 are the same JavaScript number, and Number.isInteger(50.0) is
  // true, so this pins that the validator judges the value rather than the
  // literal form it was written with.
  expect(Number.isInteger(50.0)).toBe(true);
  expect(validateMaxElements(50.0)).toBe(50);
});

test("validateMaxElements rejects a negative integer with RangeError", () => {
  expect(() => validateMaxElements(-1)).toThrow(RangeError);
  expect(() => validateMaxElements(-1)).toThrow(/maxElements/);
  expect(() => validateMaxElements(-1)).toThrow(/-1/);
});

test("validateMaxElements rejects a fractional number with TypeError", () => {
  expect(() => validateMaxElements(1.5)).toThrow(TypeError);
  expect(() => validateMaxElements(1.5)).toThrow(/maxElements/);
  expect(() => validateMaxElements(1.5)).toThrow(/1\.5/);
});

test("validateMaxElements rejects NaN with TypeError", () => {
  expect(() => validateMaxElements(Number.NaN)).toThrow(TypeError);
  expect(() => validateMaxElements(Number.NaN)).toThrow(/maxElements/);
});

test("validateMaxElements rejects Infinity with TypeError", () => {
  expect(() => validateMaxElements(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  expect(() => validateMaxElements(Number.POSITIVE_INFINITY)).toThrow(/maxElements/);
});

test("validateMaxElements rejects a string with TypeError", () => {
  expect(() => validateMaxElements("50")).toThrow(TypeError);
  expect(() => validateMaxElements("50")).toThrow(/maxElements/);
  expect(() => validateMaxElements("50")).toThrow(/50/);
});

test("validateMaxElements rejects null with TypeError", () => {
  expect(() => validateMaxElements(null)).toThrow(TypeError);
  expect(() => validateMaxElements(null)).toThrow(/maxElements/);
});

test("validateMaxElements rejects undefined with TypeError", () => {
  expect(() => validateMaxElements(undefined)).toThrow(TypeError);
  expect(() => validateMaxElements(undefined)).toThrow(/maxElements/);
});

test("limitMatches at a limit of zero evaluates nothing while still counting everything", () => {
  const result = limitMatches(["a", "b", "c"], 0);

  expect(result.evaluated).toEqual([]);
  expect(result.total).toBe(3);
  expect(result.omitted).toBe(3);
});

test("limitMatches at a limit of one keeps only the first match", () => {
  const result = limitMatches(["a", "b", "c"], 1);

  expect(result.evaluated).toEqual(["a"]);
  expect(result.total).toBe(3);
  expect(result.omitted).toBe(2);
});

test("limitMatches at a limit equal to the match count keeps every match and omits none", () => {
  const result = limitMatches(["a", "b", "c"], 3);

  expect(result.evaluated).toEqual(["a", "b", "c"]);
  expect(result.total).toBe(3);
  expect(result.omitted).toBe(0);
});

test("limitMatches one below the match count truncates the last match", () => {
  const result = limitMatches(["a", "b", "c"], 2);

  expect(result.evaluated).toEqual(["a", "b"]);
  expect(result.total).toBe(3);
  expect(result.omitted).toBe(1);
});

test("limitMatches above the match count performs no truncation", () => {
  const result = limitMatches(["a", "b", "c"], 10);

  expect(result.evaluated).toEqual(["a", "b", "c"]);
  expect(result.total).toBe(3);
  expect(result.omitted).toBe(0);
});

test("limitMatches on an empty input reports zero total and zero omitted regardless of the limit", () => {
  const result = limitMatches([], 50);

  expect(result.evaluated).toEqual([]);
  expect(result.total).toBe(0);
  expect(result.omitted).toBe(0);
});
