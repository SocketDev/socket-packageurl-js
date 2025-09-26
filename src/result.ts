/*!
Copyright (c) the purl authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

/**
 * @fileoverview Result type for functional error handling without exceptions.
 */

/**
 * Result type representing either success (Ok) or failure (Err).
 */
export type Result<T, E = Error> = Ok<T> | Err<E>

/**
 * Successful result containing a value.
 */
export class Ok<T> {
  readonly kind: 'ok' = 'ok'
  readonly value: T

  constructor(value: T) {
    this.value = value
  }

  /**
   * Check if this result is successful.
   */
  isOk(): this is Ok<T> {
    return true
  }

  /**
   * Check if this result is an error.
   */
  isErr(): boolean {
    return false
  }

  /**
   * Get the success value or throw if error.
   */
  unwrap(): T {
    return this.value
  }

  /**
   * Get the success value or return default if error.
   */
  unwrapOr(_defaultValue: T): T {
    return this.value
  }

  /**
   * Get the success value or compute from error if error.
   */
  unwrapOrElse(_fn: (_error: never) => T): T {
    return this.value
  }

  /**
   * Transform the success value.
   */
  map<U>(fn: (_value: T) => U): Result<U, never> {
    return new Ok(fn(this.value))
  }

  /**
   * Transform the error (no-op for Ok).
   */
  mapErr<F>(_fn: (_error: never) => F): Result<T, F> {
    return this as any
  }

  /**
   * Chain another result-returning operation.
   */
  andThen<U, F>(fn: (_value: T) => Result<U, F>): Result<U, F> {
    return fn(this.value)
  }

  /**
   * Return this result or the other if error (no-op for Ok).
   */
  orElse<U>(_fn: (_error: never) => Result<U, never>): Result<T | U, never> {
    return this
  }
}

/**
 * Error result containing an error.
 */
export class Err<E = Error> {
  readonly kind: 'err' = 'err'
  readonly error: E

  constructor(error: E) {
    this.error = error
  }

  /**
   * Check if this result is successful.
   */
  isOk(): boolean {
    return false
  }

  /**
   * Check if this result is an error.
   */
  isErr(): this is Err<E> {
    return true
  }

  /**
   * Get the success value or throw if error.
   */
  unwrap(): never {
    if (this.error instanceof Error) {
      throw this.error
    }
    throw new Error(String(this.error))
  }

  /**
   * Get the success value or return default if error.
   */
  unwrapOr<T>(defaultValue: T): T {
    return defaultValue
  }

  /**
   * Get the success value or compute from error if error.
   */
  unwrapOrElse<T>(fn: (_error: E) => T): T {
    return fn(this.error)
  }

  /**
   * Transform the success value (no-op for Err).
   */
  map<U>(_fn: (_value: never) => U): Result<U, E> {
    return this as any
  }

  /**
   * Transform the error.
   */
  mapErr<F>(fn: (_error: E) => F): Result<never, F> {
    return new Err(fn(this.error))
  }

  /**
   * Chain another result-returning operation (no-op for Err).
   */
  andThen<U, F>(_fn: (_value: never) => Result<U, F>): Result<U, E | F> {
    return this as any
  }

  /**
   * Return this result or the other if error.
   */
  orElse<T, F>(fn: (_error: E) => Result<T, F>): Result<T, F> {
    return fn(this.error)
  }
}

/**
 * Create a successful result.
 */
export function ok<T>(value: T): Ok<T> {
  return new Ok(value)
}

/**
 * Create an error result.
 */
export function err<E = Error>(error: E): Err<E> {
  return new Err(error)
}

/**
 * Utility functions for working with Results.
 */
export const ResultUtils = {
  /**
   * Create a successful result.
   */
  ok: ok,

  /**
   * Create an error result.
   */
  err: err,

  /**
   * Wrap a function that might throw into a Result.
   */
  from<T>(fn: () => T): Result<T, Error> {
    try {
      return ok(fn())
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)))
    }
  },

  /**
   * Convert all Results to Ok values or return first error.
   */
  all<T extends readonly Result<any, any>[]>(
    results: T,
  ): Result<
    { [K in keyof T]: T[K] extends Result<infer U, any> ? U : never },
    T[number] extends Result<any, infer E> ? E : never
  > {
    const values: any[] = []
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!
      if (result.isErr()) {
        return result as any
      }
      values.push((result as Ok<unknown>).value)
    }
    return ok(values as any)
  },

  /**
   * Return the first Ok result or the last error.
   */
  any<T extends readonly Result<any, any>[]>(results: T): T[number] {
    let lastError: Result<unknown, unknown> | null = null
    for (const result of results) {
      if (result.isOk()) {
        return result
      }
      lastError = result
    }
    return lastError as T[number]
  },
}
