/**
 * Type-level assertion helpers for the public contract tests.
 *
 * These helpers are checked by the compiler rather than executed. The
 * `typecheck` script builds tsconfig.test.json, which includes the test tree,
 * so a failed assertion surfaces as a compile error in the merge gate rather
 * than as a passing runtime test. The helpers carry no runtime code, so the
 * file exports types only.
 */

/**
 * Passes only when the argument resolves to the literal type `true`. A wrong
 * assertion resolves to `false`, which does not satisfy the constraint, so the
 * compiler reports the error at the point of use.
 */
export type Expect<T extends true> = T;

/**
 * Resolves to `true` only when the two types are identical in both directions,
 * including readonly modifiers and optionality that a plain conditional would
 * miss.
 */
export type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/**
 * Resolves to `true` when the first type is assignable to the second.
 */
export type Extends<A, B> = A extends B ? true : false;
