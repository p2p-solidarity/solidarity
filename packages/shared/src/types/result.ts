/**
 * Result<T, E> — mirrors Swift's `CardResult<T>` (success/failure enum).
 * Swift services consistently return `Result` instead of throwing; we
 * preserve that convention so port sites read identically.
 *
 * Helpers (`ok`, `err`, `map`, `flatMap`) mirror the Swift methods most
 * commonly used in the codebase. Use `unwrap()` only in tests; in app
 * code prefer `match()` or explicit narrowing on `r.ok`.
 */
import type { CardError } from './cardError';

export type Result<T, E = CardError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export function map<T, U, E>(r: Result<T, E>, f: (t: T) => U): Result<U, E> {
  return r.ok ? ok(f(r.value)) : r;
}

export function flatMap<T, U, E>(
  r: Result<T, E>,
  f: (t: T) => Result<U, E>
): Result<U, E> {
  return r.ok ? f(r.value) : r;
}

export function match<T, E, R>(
  r: Result<T, E>,
  arms: { readonly ok: (t: T) => R; readonly err: (e: E) => R }
): R {
  return r.ok ? arms.ok(r.value) : arms.err(r.error);
}

/** Test-only — throws on failure with stringified error. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw new Error(`unwrap on Err: ${JSON.stringify(r.error)}`);
}
