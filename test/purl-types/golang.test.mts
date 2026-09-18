import { describe, expect, it } from 'vitest'

import { PackageURL } from '../../src/package-url.mjs'
import {
  decodeGolangProxyPath,
  encodeGolangProxyPath,
} from '../../src/purl-types/golang.mjs'
import { UrlConverter } from '../../src/url-converter.mjs'

describe('Go case-sensitive module identity', () => {
  it.each([
    ['example.org/ExampleOrg', 'ExampleModule'],
    ['example.org/exampleorg', 'examplemodule'],
  ])(
    'preserves %s/%s through parse, construction, and proxy transport',
    (namespace, name) => {
      const text = `pkg:golang/${namespace}/${name}@v1.0.0-RC1`
      const parsed = PackageURL.fromString(text)
      expect(parsed.toString()).toBe(text)
      expect(
        new PackageURL(
          'golang',
          namespace,
          name,
          'v1.0.0-RC1',
          undefined,
          undefined,
        ).toString(),
      ).toBe(text)
      const path = `${namespace}/${name}`
      expect(decodeGolangProxyPath(encodeGolangProxyPath(path))).toBe(path)
      const url = `https://proxy.golang.org/${encodeGolangProxyPath(path)}/@v/v1.0.0-!r!c1.zip`
      expect(UrlConverter.fromUrl(url)?.toString()).toBe(text)
    },
  )

  it('does not collapse distinct module names', () => {
    const upper = PackageURL.fromString(
      'pkg:golang/example.org/ExampleOrg/ExampleModule',
    )
    const lower = PackageURL.fromString(
      'pkg:golang/example.org/exampleorg/examplemodule',
    )
    expect(upper.toString()).not.toBe(lower.toString())
  })
})
