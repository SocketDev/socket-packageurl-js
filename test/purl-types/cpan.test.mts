import { describe, expect, it } from 'vitest'

import { PurlError } from '../../src/error.mjs'
import { PackageURL } from '../../src/package-url.mjs'
import { cpanValidate } from '../../src/purl-types/cpan.mjs'

describe('CPAN package URLs', () => {
  it('accepts a distribution without an author namespace', () => {
    const parsed = PackageURL.fromString('pkg:cpan/Example-Widget@1.2')
    const built = new PackageURL(
      'cpan',
      undefined,
      'Example-Widget',
      '1.2',
      undefined,
      undefined,
    )

    expect(parsed.namespace).toBeUndefined()
    expect(parsed.toString()).toBe('pkg:cpan/Example-Widget@1.2')
    expect(built.toString()).toBe(parsed.toString())
    expect(cpanValidate({ name: 'Example-Widget' })).toBe(true)
  })

  it('preserves the author qualifier without synthesizing a namespace', () => {
    const parsed = PackageURL.fromString(
      'pkg:cpan/Example-Widget?author=EXAMPLE',
    )

    expect(parsed.namespace).toBeUndefined()
    expect(parsed.qualifiers?.['author']).toBe('EXAMPLE')
    expect(parsed.toString()).toBe('pkg:cpan/Example-Widget?author=EXAMPLE')
  })

  it('accepts an uppercase author namespace and preserves distribution casing', () => {
    const parsed = PackageURL.fromString('pkg:cpan/EXAMPLE/Example-Widget')

    expect(parsed.namespace).toBe('EXAMPLE')
    expect(parsed.name).toBe('Example-Widget')
    expect(cpanValidate({ name: 'Example-Widget', namespace: 'EXAMPLE' })).toBe(
      true,
    )
  })

  it('rejects lowercase author namespaces rather than silently normalizing them', () => {
    expect(() =>
      PackageURL.fromString('pkg:cpan/example/Example-Widget'),
    ).toThrow(PurlError)
    expect(cpanValidate({ name: 'Example-Widget', namespace: 'example' })).toBe(
      false,
    )
  })

  it('rejects module separators even when the author namespace is omitted', () => {
    expect(() => PackageURL.fromString('pkg:cpan/Example::Widget')).toThrow(
      PurlError,
    )
    expect(cpanValidate({ name: 'Example::Widget' })).toBe(false)
  })
})
