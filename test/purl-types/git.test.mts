import { describe, expect, it } from 'vitest'

import { PurlError, PurlInjectionError } from '../../src/error.mjs'
import { PackageURL } from '../../src/package-url.mjs'
import { gitValidate } from '../../src/purl-types/git.mjs'

describe('Git package URLs', () => {
  it('preserves host, owner, repository, reference, and subpath casing', () => {
    const input =
      'pkg:git/Code.Example/Example/Widget.git@ReleaseA#Docs/Guide.md'
    const parsed = PackageURL.fromString(input)
    const built = new PackageURL(
      'git',
      'Code.Example/Example',
      'Widget.git',
      'ReleaseA',
      undefined,
      'Docs/Guide.md',
    )

    expect(parsed.toString()).toBe(input)
    expect(built.toString()).toBe(input)
  })

  it('does not collapse distinct repository names', () => {
    const upper = PackageURL.fromString('pkg:git/code.example/Example/Widget')
    const lower = PackageURL.fromString('pkg:git/code.example/example/widget')

    expect(upper.toString()).not.toBe(lower.toString())
  })

  it('rejects missing host paths through parsing and construction', () => {
    expect(() => PackageURL.fromString('pkg:git/Widget')).toThrow(PurlError)
    expect(
      () =>
        new PackageURL(
          'git',
          undefined,
          'Widget',
          undefined,
          undefined,
          undefined,
        ),
    ).toThrow(PurlError)
    expect(gitValidate({ name: 'Widget' })).toBe(false)
    expect(gitValidate({ name: 'Widget', namespace: '' })).toBe(false)
  })

  it('accepts complete paths without a version', () => {
    expect(
      gitValidate({ name: 'Widget.git', namespace: 'code.example/Example' }),
    ).toBe(true)
    expect(
      PackageURL.fromString('pkg:git/code.example/Example/Widget.git').version,
    ).toBeUndefined()
  })

  it.each([
    { name: 'Widget', namespace: 'code.example/Example;command' },
    { name: 'Widget;command', namespace: 'code.example/Example' },
  ])(
    'rejects injection characters with either error mode: $name, $namespace',
    purl => {
      expect(gitValidate(purl)).toBe(false)
      expect(() => gitValidate(purl, { throws: true })).toThrow(
        PurlInjectionError,
      )
    },
  )
})
