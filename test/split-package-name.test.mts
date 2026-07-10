/**
 * @file Tests for the splitPurlPackageName standalone function.
 */

import { describe, expect, it } from 'vitest'

import { splitPurlPackageName } from '../src/split-package-name.mjs'

describe('splitPurlPackageName', () => {
  describe('first-slash namespace types', () => {
    it('splits composer vendor/package', () => {
      expect(splitPurlPackageName('composer', 'laravel/framework')).toEqual({
        namespace: 'laravel',
        name: 'framework',
      })
      expect(
        splitPurlPackageName('composer', 'symfony/http-foundation'),
      ).toEqual({ namespace: 'symfony', name: 'http-foundation' })
    })

    it('splits openvsx and vscode publisher/extension', () => {
      expect(splitPurlPackageName('openvsx', 'meta/pyrefly')).toEqual({
        namespace: 'meta',
        name: 'pyrefly',
      })
      expect(
        splitPurlPackageName('vscode-extension', 'ms-python/python'),
      ).toEqual({ namespace: 'ms-python', name: 'python' })
    })

    it('is case-insensitive on the type', () => {
      expect(splitPurlPackageName('Composer', 'laravel/framework')).toEqual({
        namespace: 'laravel',
        name: 'framework',
      })
    })

    it('returns no namespace when a composer name has no slash', () => {
      expect(splitPurlPackageName('composer', 'monolith')).toEqual({
        namespace: undefined,
        name: 'monolith',
      })
    })
  })

  describe('last-slash namespace types', () => {
    it('splits golang on the last slash (multi-segment namespace)', () => {
      expect(splitPurlPackageName('golang', 'github.com/spf13/cobra')).toEqual({
        namespace: 'github.com/spf13',
        name: 'cobra',
      })
    })

    it('returns no namespace for a single-segment golang name', () => {
      expect(splitPurlPackageName('golang', 'cobra')).toEqual({
        namespace: undefined,
        name: 'cobra',
      })
    })
  })

  describe('maven', () => {
    it('splits on a colon (groupId:artifactId)', () => {
      expect(
        splitPurlPackageName('maven', 'org.apache.commons:commons-lang3'),
      ).toEqual({ namespace: 'org.apache.commons', name: 'commons-lang3' })
    })

    it('splits on the first slash when there is no colon', () => {
      expect(
        splitPurlPackageName('maven', 'org.apache.commons/commons-lang3'),
      ).toEqual({ namespace: 'org.apache.commons', name: 'commons-lang3' })
    })
  })

  describe('npm', () => {
    it('splits a scoped package', () => {
      expect(splitPurlPackageName('npm', '@babel/core')).toEqual({
        namespace: '@babel',
        name: 'core',
      })
    })

    it('gives a bare package no namespace', () => {
      expect(splitPurlPackageName('npm', 'lodash')).toEqual({
        namespace: undefined,
        name: 'lodash',
      })
    })
  })

  describe('namespace-less types', () => {
    it('keeps the whole string as the name for pypi/gem/cargo/nuget', () => {
      for (const type of ['pypi', 'gem', 'cargo', 'nuget']) {
        expect(splitPurlPackageName(type, 'requests')).toEqual({
          namespace: undefined,
          name: 'requests',
        })
      }
    })

    it('does not split an unknown type', () => {
      expect(splitPurlPackageName('madeup', 'a/b')).toEqual({
        namespace: undefined,
        name: 'a/b',
      })
    })
  })

  describe('input validation', () => {
    it('throws on a missing/blank type', () => {
      expect(() => splitPurlPackageName('', 'laravel/framework')).toThrow()
      expect(() =>
        splitPurlPackageName(undefined, 'laravel/framework'),
      ).toThrow()
    })

    it('throws on a non-string or empty package name', () => {
      expect(() => splitPurlPackageName('composer', '')).toThrow()
      expect(() => splitPurlPackageName('composer', undefined)).toThrow()
      expect(() => splitPurlPackageName('composer', 42)).toThrow()
    })
  })
})
