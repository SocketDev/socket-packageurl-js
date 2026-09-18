import { describe, expect, it } from 'vitest'

import { PurlError } from '../../src/error.mjs'
import { PackageURL } from '../../src/package-url.mjs'
import {
  huggingfaceValidate,
  normalize,
} from '../../src/purl-types/huggingface.mjs'
import { UrlConverter } from '../../src/url-converter.mjs'

describe('Hugging Face repository identities', () => {
  it.each(['100B', 'ReleaseCandidate', 'A'.repeat(39), 'Z'.repeat(40)])(
    'preserves case-sensitive revision %s',
    version => {
      const text = `pkg:huggingface/ExampleOrg/ExampleModel@${version}`
      const parsed = PackageURL.fromString(text)
      expect(parsed.toString()).toBe(text)
      expect(
        new PackageURL(
          'huggingface',
          'ExampleOrg',
          'ExampleModel',
          version,
          undefined,
          undefined,
        ).toString(),
      ).toBe(text)
    },
  )

  it('normalizes a full hexadecimal commit without changing repository case', () => {
    const parsed = PackageURL.fromString(
      `pkg:huggingface/ExampleOrg/ExampleModel@${'AB'.repeat(20)}`,
    )
    expect(parsed.toString()).toBe(
      `pkg:huggingface/ExampleOrg/ExampleModel@${'ab'.repeat(20)}`,
    )
  })

  it.each([undefined, 'model', 'dataset', 'space'])(
    'accepts repository type %s without inserting a default qualifier',
    type => {
      const suffix = type ? `?type=${type}` : ''
      const text = `pkg:huggingface/ExampleOrg/ExampleRepo${suffix}`
      const parsed = PackageURL.fromString(text)
      expect(parsed.toString()).toBe(text)
      expect(parsed.qualifiers?.['type']).toBe(type)
      expect(PackageURL.fromString(parsed.toString()).toString()).toBe(text)
    },
  )

  it('preserves repository URLs and optional namespaces', () => {
    const parsed = new PackageURL(
      'huggingface',
      undefined,
      'ExampleModel',
      undefined,
      { repository_url: 'https://models.example.test', type: 'model' },
      undefined,
    )
    expect(parsed.namespace).toBeUndefined()
    expect(PackageURL.fromString(parsed.toString()).qualifiers).toEqual(
      parsed.qualifiers,
    )
    expect(normalize({ name: 'ExampleModel' })).toEqual({
      name: 'ExampleModel',
    })
  })

  it.each(['models', 'Dataset', 'code'])(
    'rejects unsupported repository type %s',
    type => {
      const input = { name: 'ExampleModel', qualifiers: { type } }
      expect(huggingfaceValidate(input)).toBe(false)
      expect(() => huggingfaceValidate(input, { throws: true })).toThrow(
        PurlError,
      )
      expect(() =>
        PackageURL.fromString(
          `pkg:huggingface/ExampleOrg/ExampleModel?type=${type}`,
        ),
      ).toThrow(PurlError)
    },
  )

  it.each([
    { name: 'ExampleModel', namespace: 'Example;Org' },
    { name: 'Example;Model', namespace: 'ExampleOrg' },
  ])('keeps injection validation for %o', input => {
    expect(huggingfaceValidate(input)).toBe(false)
    expect(() => huggingfaceValidate(input, { throws: true })).toThrow(
      PurlError,
    )
  })
})

describe('Hugging Face repository URLs', () => {
  it.each([
    ['', undefined],
    ['datasets/', 'dataset'],
    ['spaces/', 'space'],
  ] as const)('converts %s repositories in both directions', (prefix, type) => {
    const url = `https://huggingface.co/${prefix}ExampleOrg/ExampleRepo`
    const parsed = UrlConverter.fromUrl(`${url}/tree/100B`)
    expect(parsed?.version).toBe('100B')
    expect(parsed?.qualifiers?.['type']).toBe(type)
    expect(UrlConverter.toRepositoryUrl(parsed!)?.url).toBe(url)
  })

  it.each(['tree', 'commit', 'resolve', 'blob'])(
    'decodes the revision in a %s URL',
    action => {
      const parsed = UrlConverter.fromUrl(
        `https://huggingface.co/datasets/ExampleOrg/ExampleRepo/${action}/release%2FCandidate`,
      )
      expect(parsed?.version).toBe('release/Candidate')
      expect(parsed?.qualifiers?.['type']).toBe('dataset')
    },
  )

  it.each([
    'spaces/ExampleOrg',
    'datasets',
    'docs/guide',
    'ExampleOrg/ExampleRepo/tree/%ZZ',
  ])('rejects incomplete or malformed URL %s', path =>
    expect(
      UrlConverter.fromUrl(`https://huggingface.co/${path}`),
    ).toBeUndefined(),
  )
})
