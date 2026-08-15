/**
 * Match limiting.
 *
 * A scan that reads every property of every matched element on a page with
 * thousands of nodes would be slow enough to defeat the tool's purpose, so
 * the public API caps how many matches a probe evaluates (implementation
 * plan section 3.7, `maxElements`, default 50). This module holds the two
 * halves of that cap: validating the configured limit, and applying a
 * validated limit to a list of matches.
 *
 * The cap never hides the fact that it fired. `limitMatches()` reports the
 * total match count alongside the evaluated subset, so a summary carries
 * `{ total, evaluated, omitted }` (implementation plan section 3.6) rather
 * than a truncated count masquerading as the whole answer. That is the
 * distinction the issue title draws: enforcing the limit must never lose the
 * total.
 */

/**
 * The default value of the `maxElements` option (implementation plan section
 * 3.7). Fifty elements is enough to characterize a component's variants on a
 * typical page without reading every node of a large one.
 */
export const DEFAULT_MAX_ELEMENTS = 50;

/**
 * Validates a `maxElements` option value, returning it when it is a
 * non-negative integer and throwing otherwise.
 *
 * Configuration errors fail construction (implementation plan section 5.11),
 * so this function is meant to run once, at the point a scanner or evaluator
 * is constructed from user-supplied options. Nothing in this branch calls it
 * yet, because the scanner that owns construction is CSSC-028; it is exported
 * now so that later work has one place to validate the option rather than
 * reimplementing the check.
 *
 * The thrown error type follows the reason the value is rejected, matching
 * how JavaScript's own built-ins split the two failures: a value that is not
 * an integer at all, including `NaN`, `Infinity`, a fractional number, or a
 * value that is not a number, throws `TypeError`, the same type
 * `Number.isInteger()`-style validation throws for a wrong kind of value
 * elsewhere in the platform, such as `Array(-1)` throwing `RangeError` versus
 * a non-numeric `Array` argument coercing instead. Here, "wrong kind of
 * value" covers non-integers together with non-numbers, because both mean the
 * input is not the integer the option requires. A value that is an integer
 * but falls outside the allowed range, meaning it is negative, throws
 * `RangeError`, matching built-ins such as `String.prototype.repeat()`,
 * which throws `RangeError` for a negative count. Zero is not out of range:
 * `maxElements: 0` is a valid instruction to evaluate no matches while still
 * counting all of them.
 */
export function validateMaxElements(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`maxElements must be an integer, received ${String(value)}`);
  }

  if (value < 0) {
    throw new RangeError(`maxElements must be a non-negative integer, received ${String(value)}`);
  }

  return value;
}

/**
 * The result of limiting a list of matches: the subset to evaluate, the total
 * number of matches before limiting, and how many were left out.
 *
 * `total` and `omitted` exist so that a limit never loses information: a
 * consumer that truncates at fifty matches still learns that one hundred and
 * twenty existed and that seventy were left out, which is the fact the issue
 * title requires.
 */
export type MatchLimitResult<T> = {
  evaluated: readonly T[];
  total: number;
  omitted: number;
};

/**
 * Applies a match limit to a list of matches, keeping the earliest entries.
 *
 * `matches` is generic over the matched type so that this one primitive
 * serves both a matcher's `BranchMatch` list and a call site's per-element
 * evaluation list; neither shape matters here, only the count and the order.
 *
 * The kept matches are the first `maxElements` entries of `matches`, in the
 * order given. The matcher already guarantees that order is document order
 * (see ./index.ts), so keeping a prefix keeps the earliest elements in the
 * document rather than an arbitrary subset. An author who reads "3 of 5
 * evaluated" expects those three to be the first three encountered scanning
 * top to bottom, and truncating anywhere but the end would silently break
 * that expectation.
 *
 * `maxElements` is not validated here. Validation happens once, at
 * construction, through `validateMaxElements()`; this function only applies
 * an already-validated limit, and it stays correct for the validated edge
 * case of zero, which slices to an empty `evaluated` list while `total` and
 * `omitted` still report the full count.
 */
export function limitMatches<T>(matches: readonly T[], maxElements: number): MatchLimitResult<T> {
  const evaluated = matches.slice(0, maxElements);

  return {
    evaluated,
    total: matches.length,
    omitted: matches.length - evaluated.length,
  };
}
