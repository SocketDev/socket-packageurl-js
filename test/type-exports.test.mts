/**
 * @fileoverview Tests for TypeScript type exports accessibility
 */

import { describe, expect, it } from 'vitest'

import { PackageURL } from '../src/index.js'

import type {
  ComponentEncoder,
  ComponentNormalizer,
  ComponentValidator,
  DownloadUrl,
  NpmPackageComponents,
  PackageURLComponentValue,
  PackageURLObject,
  ParsedPurlComponents,
  QualifiersObject,
  QualifiersValue,
  RepositoryUrl,
  Result,
} from '../src/index.js'

describe('Type exports accessibility', () => {
  it('should export PackageURLObject type', () => {
    const obj: PackageURLObject = {
      type: 'npm',
      name: 'test',
      version: '1.0.0',
    }
    expect(obj).toBeDefined()
  })

  it('should export PackageURLComponentValue type', () => {
    const value1: PackageURLComponentValue = 'string'
    const value2: PackageURLComponentValue = undefined
    const value3: PackageURLComponentValue = { key: 'value' }
    expect(value1).toBeDefined()
    expect(value2).toBeUndefined()
    expect(value3).toBeDefined()
  })

  it('should export ParsedPurlComponents type', () => {
    const components: ParsedPurlComponents = [
      'npm',
      undefined,
      'test',
      '1.0.0',
      undefined,
      undefined,
    ]
    expect(components).toHaveLength(6)
  })

  it('should export NpmPackageComponents type', () => {
    const components: NpmPackageComponents = {
      namespace: undefined,
      name: 'test',
      version: '1.0.0',
    }
    expect(components.name).toBe('test')
  })

  it('should export QualifiersObject type', () => {
    const qualifiers: QualifiersObject = {
      arch: 'x86_64',
      os: 'linux',
    }
    expect(qualifiers.arch).toBe('x86_64')
  })

  it('should export QualifiersValue type', () => {
    const value1: QualifiersValue = 'string'
    const value2: QualifiersValue = 123
    const value3: QualifiersValue = true
    const value4: QualifiersValue = null
    const value5: QualifiersValue = undefined
    expect(value1).toBe('string')
    expect(value2).toBe(123)
    expect(value3).toBe(true)
    expect(value4).toBeNull()
    expect(value5).toBeUndefined()
  })

  it('should export ComponentEncoder type', () => {
    const encoder: ComponentEncoder = (value: unknown) => String(value)
    expect(encoder('test')).toBe('test')
  })

  it('should export ComponentNormalizer type', () => {
    const normalizer: ComponentNormalizer = (value: string) =>
      value.toLowerCase()
    expect(normalizer('TEST')).toBe('test')
  })

  it('should export ComponentValidator type', () => {
    const validator: ComponentValidator = (value: unknown, throws: boolean) => {
      if (throws && !value) {
        throw new Error('Invalid')
      }
      return Boolean(value)
    }
    expect(validator('test', false)).toBe(true)
    expect(validator('', false)).toBe(false)
  })

  it('should export RepositoryUrl type', () => {
    const url: RepositoryUrl = {
      type: 'git',
      url: 'https://github.com/user/repo',
    }
    expect(url.url).toContain('github.com')
    expect(url.type).toBe('git')
  })

  it('should export DownloadUrl type', () => {
    const url: DownloadUrl = {
      type: 'tarball',
      url: 'https://registry.npmjs.org/package/-/package-1.0.0.tgz',
    }
    expect(url.url).toContain('registry.npmjs.org')
    expect(url.type).toBe('tarball')
  })

  it('should export Result type', () => {
    const success: Result<string> = { kind: 'ok', value: 'test' } as Result<
      string,
      Error
    >
    const failure: Result<string> = {
      kind: 'err',
      error: new Error('failed'),
    } as Result<string, Error>
    expect(success.kind).toBe('ok')
    expect(failure.kind).toBe('err')
  })

  it('should use ParsedPurlComponents with PackageURL.parseString', () => {
    const components: ParsedPurlComponents =
      PackageURL.parseString('pkg:npm/test@1.0.0')
    // type
    expect(components[0]).toBe('npm')
    // name
    expect(components[2]).toBe('test')
    // version
    expect(components[3]).toBe('1.0.0')
  })

  it('should use PackageURLObject with toObject()', () => {
    const purl = new PackageURL(
      'npm',
      undefined,
      'test',
      '1.0.0',
      undefined,
      undefined,
    )
    const obj: PackageURLObject = purl.toObject()
    expect(obj.type).toBe('npm')
    expect(obj.name).toBe('test')
    expect(obj.version).toBe('1.0.0')
  })
})
