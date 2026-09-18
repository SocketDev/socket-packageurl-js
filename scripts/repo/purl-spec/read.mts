import { isPlainObject } from '@socketsecurity/lib-stable/objects/predicates'

export interface SpecComponents {
  type?: string | null | undefined
  namespace?: string | null | undefined
  name?: string | null | undefined
  version?: string | null | undefined
  qualifiers?: Record<string, string> | null | undefined
  subpath?: string | null | undefined
}

export interface SpecTest {
  description: string
  expected_failure: boolean
  expected_output: SpecComponents | string | null | undefined
  input: SpecComponents | string
  test_group: 'required' | 'recommended'
  test_type: 'build' | 'parse' | 'roundtrip' | 'validate'
}

function isComponents(value: unknown): value is SpecComponents {
  if (!isPlainObject(value)) {
    return false
  }
  return Object.entries(value).every(([key, component]) => {
    if (key === 'qualifiers') {
      return (
        component == null ||
        (isPlainObject(component) &&
          Object.values(component).every(item => typeof item === 'string'))
      )
    }
    return (
      ['type', 'namespace', 'name', 'version', 'subpath'].includes(key) &&
      (component == null || typeof component === 'string')
    )
  })
}

function invalidFixture(filename: string, detail: string): never {
  throw new Error(
    `Invalid PURL fixture. Where: ${filename}. Saw: ${detail}; wanted: a supported, complete test suite. Fix: check the upstream schema and fixture reader.`,
  )
}

function normalizeSpecGroup(value: string): SpecTest['test_group'] {
  if (value === 'base') {
    return 'required'
  }
  if (value === 'advanced') {
    return 'recommended'
  }
  return value as SpecTest['test_group']
}

function readPurlSpecCase(
  item: unknown,
  filename: string,
  options: { legacy?: boolean | undefined } = {},
): SpecTest {
  if (!isPlainObject(item)) {
    return invalidFixture(filename, 'test is not an object')
  }
  const {
    description,
    expected_failure = false,
    expected_output,
    input,
    test_group,
    test_type,
  } = item
  if (
    typeof description !== 'string' ||
    !description ||
    typeof expected_failure !== 'boolean'
  ) {
    return invalidFixture(filename, 'test metadata')
  }
  const { legacy = false } = options
  const groups = legacy ? ['base', 'advanced'] : ['required', 'recommended']
  const kinds = legacy
    ? ['build', 'parse', 'roundtrip']
    : ['build', 'parse', 'validate']
  if (typeof test_group !== 'string' || !groups.includes(test_group)) {
    return invalidFixture(filename, 'test group')
  }
  if (typeof test_type !== 'string' || !kinds.includes(test_type)) {
    return invalidFixture(filename, 'test kind')
  }
  validateSpecValues(item, filename, { legacy })
  return {
    description,
    expected_failure,
    expected_output,
    input,
    test_group: normalizeSpecGroup(test_group),
    test_type,
  } as SpecTest
}

function validateSpecValues(
  item: Record<string, unknown>,
  filename: string,
  options: { legacy?: boolean | undefined } = {},
): void {
  const { legacy = false } = options
  const { expected_failure, expected_output, input, test_type } = item
  if (
    expected_failure &&
    !Object.hasOwn(
      item,
      legacy ? 'expected_failure_reason' : 'expected_message',
    )
  ) {
    return invalidFixture(filename, 'missing failure reason')
  }
  const validInput =
    test_type === 'build' ? isComponents(input) : typeof input === 'string'
  if (!validInput) {
    invalidFixture(filename, 'test input')
  }
  const validOutput =
    test_type === 'parse'
      ? isComponents(expected_output)
      : typeof expected_output === 'string'
  if ((!expected_failure || test_type === 'validate') && !validOutput) {
    invalidFixture(filename, 'test output')
  }
}

export function readPurlSpecSuite(
  value: unknown,
  filename: string,
): SpecTest[] {
  if (
    !isPlainObject(value) ||
    !Array.isArray(value['tests']) ||
    value['tests'].length === 0
  ) {
    return invalidFixture(filename, 'missing or empty tests')
  }
  const schema = value['$schema']
  if (
    schema !== 'https://packageurl.org/schemas/purl-test.schema-0.1.json' &&
    schema !== 'https://packageurl.org/schemas/purl-test.schema-0.2.json' &&
    schema !== 'https://packageurl.org/schemas/purl-test.schema-1.0.json'
  ) {
    return invalidFixture(filename, 'unsupported schema')
  }
  return value['tests'].map((item: unknown, index: number) =>
    readPurlSpecCase(item, `${filename} test ${index}`, {
      legacy:
        schema !== 'https://packageurl.org/schemas/purl-test.schema-0.2.json',
    }),
  )
}
