import { isDeepStrictEqual } from 'node:util'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import type { SpecComponents, SpecTest } from './read.mts'

export interface PurlValue extends Omit<SpecComponents, 'qualifiers'> {
  qualifiers?: Record<string, unknown> | null | undefined
  toString(): string
}

export interface PurlFactory {
  new (
    type: string | undefined,
    namespace: string | undefined,
    name: string | undefined,
    version: string | undefined,
    qualifiers: Record<string, string> | undefined,
    subpath: string | undefined,
  ): PurlValue
  fromString(input: string): PurlValue
}

export interface PurlCaseResult {
  passed: boolean
  actual?: unknown | undefined
  expected?: unknown | undefined
  error?: string | undefined
}

function comparableComponents(value: Omit<PurlValue, 'toString'>) {
  return {
    __proto__: null,
    type: value.type ?? undefined,
    namespace: value.namespace ?? undefined,
    name: value.name ?? undefined,
    version: value.version ?? undefined,
    qualifiers: value.qualifiers ? { ...value.qualifiers } : undefined,
    subpath: value.subpath ?? undefined,
  }
}

export function evaluatePurlCase(
  test: SpecTest,
  factory: PurlFactory,
): PurlCaseResult {
  try {
    const input = test.input as SpecComponents
    const purl =
      test.test_type === 'build'
        ? new factory(
            input.type ?? undefined,
            input.namespace ?? undefined,
            input.name ?? undefined,
            input.version ?? undefined,
            input.qualifiers ?? undefined,
            input.subpath ?? undefined,
          )
        : factory.fromString(test.input as string)
    const actual =
      test.test_type === 'parse' ? comparableComponents(purl) : purl.toString()
    if (test.expected_failure) {
      return { passed: false, actual, expected: 'failure' }
    }
    const expected =
      test.test_type === 'parse'
        ? comparableComponents(test.expected_output as SpecComponents)
        : test.expected_output
    return { passed: isDeepStrictEqual(actual, expected), actual, expected }
  } catch (error) {
    return { passed: test.expected_failure, error: errorMessage(error) }
  }
}
