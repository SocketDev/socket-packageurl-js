import { describe, expect, it } from 'vitest'

import { PackageURL } from '../../src/package-url.mjs'
import { brewNormalize } from '../../src/purl-types/brew.mjs'
import { UrlConverter } from '../../src/url-converter.mjs'

describe('Homebrew package URLs', () => {
  it('uses the registered brew type for repository URL conversion', () => {
    const parsed = PackageURL.fromString('pkg:brew/Wget')
    expect(UrlConverter.supportsRepositoryUrl('brew')).toBe(true)
    expect(UrlConverter.toRepositoryUrl(parsed)?.url).toBe(
      'https://formulae.brew.sh/formula/wget',
    )
  })
  it('normalizes tap and formula casing through parsing and construction', () => {
    const parsed = PackageURL.fromString(
      'pkg:brew/Homebrew/Core/SQLite@ReleaseA',
    )
    const built = new PackageURL(
      'brew',
      'Homebrew/Core',
      'SQLite',
      'ReleaseA',
      undefined,
      undefined,
    )

    expect(parsed.toString()).toBe('pkg:brew/homebrew/core/sqlite@ReleaseA')
    expect(built.toString()).toBe(parsed.toString())
  })

  it('keeps an omitted tap omitted', () => {
    const parsed = PackageURL.fromString('pkg:brew/SQLite')

    expect(parsed.namespace).toBeUndefined()
    expect(parsed.toString()).toBe('pkg:brew/sqlite')
  })

  it('encodes a versioned formula independently from its package version', () => {
    const parsed = PackageURL.fromString('pkg:brew/PostgreSQL%4012@12.17')

    expect(parsed.name).toBe('postgresql@12')
    expect(parsed.version).toBe('12.17')
    expect(parsed.toString()).toBe('pkg:brew/postgresql%4012@12.17')
  })

  it('preserves repository qualifiers and subpath casing', () => {
    const parsed = PackageURL.fromString(
      'pkg:brew/Example/Tap/Widget?repository_url=https:%2F%2Fexample.com%2FTap.git#Docs/Guide.md',
    )

    expect(parsed.qualifiers?.['repository_url']).toBe(
      'https://example.com/Tap.git',
    )
    expect(parsed.subpath).toBe('Docs/Guide.md')
    expect(parsed.namespace).toBe('example/tap')
  })

  it('normalizes the supplied object in place', () => {
    const purl = { name: 'Widget', namespace: 'Example/Tap' }

    expect(brewNormalize(purl)).toBe(purl)
    expect(purl).toEqual({ name: 'widget', namespace: 'example/tap' })
  })
})
