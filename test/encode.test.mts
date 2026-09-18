/**
 * @file Tests for encode.mts — encodeQualifiers and related utilities.
 */
import { describe, expect, it } from 'vitest'

import {
  encodeName,
  encodeNamespace,
  encodePurlComponent,
  encodeQualifiers,
  encodeSubpath,
  encodeVersion,
} from '../src/encode.mjs'
import { PackageURL } from '../src/package-url.mjs'

describe('encode edge cases', () => {
  it('toString returns no qualifiers segment when qualifiers are null', () => {
    const purl = new PackageURL(
      'npm',
      undefined,
      'lodash',
      '1.0.0',
      undefined,
      undefined,
    )
    const str = purl.toString()
    expect(str).not.toContain('?')
  })
})

describe('encodeQualifiers edge case', () => {
  it('returns empty string for non-object input', () => {
    const result = encodeQualifiers(undefined)
    expect(result).toBe('')
  })
})

describe('PURL percent encoding', () => {
  it.each([
    ['!', '%21'],
    ["'", '%27'],
    ['(', '%28'],
    [')', '%29'],
    ['*', '%2A'],
  ])('encodes reserved data %s', (value, expected) => {
    expect(encodePurlComponent(value)).toBe(expected)
    expect(encodeName(value)).toBe(expected)
    expect(encodeVersion(value)).toBe(expected)
    expect(encodeNamespace(`group/${value}`)).toBe(`group/${expected}`)
    expect(encodeSubpath(`folder/${value}`)).toBe(`folder/${expected}`)
    expect(encodeQualifiers({ value })).toBe(`value=${expected}`)
  })

  it('preserves unreserved data and component separators', () => {
    expect(encodeName('Name-._~:')).toBe('Name-._~:')
    expect(encodeSubpath('folder/file:name')).toBe('folder/file:name')
    expect(encodeVersion('release/Candidate')).toBe('release%2FCandidate')
  })

  it.each([
    [' ', '%20'],
    ['+', '%2B'],
    ['%20', '%2520'],
    ['%2B', '%252B'],
    ['%2520', '%252520'],
  ])('preserves distinct qualifier data %s', (value, expected) => {
    expect(encodeQualifiers({ value })).toBe(`value=${expected}`)
    expect(new URLSearchParams(encodeQualifiers({ value })).get('value')).toBe(
      value,
    )
    const parsed = PackageURL.fromString(
      `pkg:generic/example?value=before${expected}after`,
    )
    expect(parsed.qualifiers?.['value']).toBe(`before${value}after`)
    expect(parsed.toString()).toBe(
      `pkg:generic/example?value=before${expected}after`,
    )
  })
})
