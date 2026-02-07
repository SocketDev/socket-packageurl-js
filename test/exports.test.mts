/**
 * @fileoverview Tests for package exports from main index
 */

import { describe, expect, it } from 'vitest'

import {
  PackageURL,
  PurlBuilder,
  PurlComponent,
  PurlError,
  PurlQualifierNames,
  PurlType,
  ResultUtils,
  UrlConverter,
  compare,
  equals,
  parseNpmSpecifier,
  stringify,
} from '../src/index.js'

describe('Package exports', () => {
  describe('core exports', () => {
    it('should export PackageURL class', () => {
      expect(PackageURL).toBeDefined()
      expect(typeof PackageURL).toBe('function')
      expect(PackageURL.name).toBe('PackageURL')

      // Test it can be instantiated
      const purl = new PackageURL(
        'npm',
        undefined,
        'test',
        '1.0.0',
        undefined,
        undefined,
      )
      expect(purl).toBeInstanceOf(PackageURL)
    })

    it('should export PurlBuilder class', () => {
      expect(PurlBuilder).toBeDefined()
      expect(typeof PurlBuilder).toBe('function')
      expect(PurlBuilder.name).toBe('PurlBuilder')

      // Test it can be instantiated
      const builder = new PurlBuilder()
      expect(builder).toBeInstanceOf(PurlBuilder)
    })

    it('should export PurlError class', () => {
      expect(PurlError).toBeDefined()
      expect(typeof PurlError).toBe('function')
      expect(PurlError.name).toBe('PurlError')

      // Test it can be instantiated
      const error = new PurlError('test message')
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('test message')
    })

    it('should export PurlComponent object', () => {
      expect(PurlComponent).toBeDefined()
      expect(typeof PurlComponent).toBe('object')
      expect(PurlComponent).toHaveProperty('type')
      expect(PurlComponent).toHaveProperty('namespace')
      expect(PurlComponent).toHaveProperty('name')
    })

    it('should export PurlQualifierNames object', () => {
      expect(PurlQualifierNames).toBeDefined()
      expect(typeof PurlQualifierNames).toBe('object')
    })

    it('should export PurlType object', () => {
      expect(PurlType).toBeDefined()
      expect(typeof PurlType).toBe('object')
    })

    it('should export ResultUtils object', () => {
      expect(ResultUtils).toBeDefined()
      expect(typeof ResultUtils).toBe('object')
    })

    it('should export UrlConverter class', () => {
      expect(UrlConverter).toBeDefined()
      expect(typeof UrlConverter).toBe('function')
      expect(UrlConverter.name).toBe('UrlConverter')
    })
  })

  describe('modular utility exports', () => {
    it('should export compare function', () => {
      expect(compare).toBeDefined()
      expect(typeof compare).toBe('function')
      expect(compare.name).toBe('compare')

      // Test it works
      const purl1 = new PackageURL(
        'npm',
        undefined,
        'a',
        '1.0.0',
        undefined,
        undefined,
      )
      const purl2 = new PackageURL(
        'npm',
        undefined,
        'b',
        '1.0.0',
        undefined,
        undefined,
      )
      expect(compare(purl1, purl2)).toBe(-1)
    })

    it('should export equals function', () => {
      expect(equals).toBeDefined()
      expect(typeof equals).toBe('function')
      expect(equals.name).toBe('equals')

      // Test it works
      const purl1 = new PackageURL(
        'npm',
        undefined,
        'test',
        '1.0.0',
        undefined,
        undefined,
      )
      const purl2 = new PackageURL(
        'npm',
        undefined,
        'test',
        '1.0.0',
        undefined,
        undefined,
      )
      expect(equals(purl1, purl2)).toBe(true)
    })

    it('should export parseNpmSpecifier function', () => {
      expect(parseNpmSpecifier).toBeDefined()
      expect(typeof parseNpmSpecifier).toBe('function')
      expect(parseNpmSpecifier.name).toBe('parseNpmSpecifier')

      // Test it works
      const result = parseNpmSpecifier('lodash@4.17.21')
      expect(result).toEqual({
        namespace: undefined,
        name: 'lodash',
        version: '4.17.21',
      })
    })

    it('should export stringify function', () => {
      expect(stringify).toBeDefined()
      expect(typeof stringify).toBe('function')
      expect(stringify.name).toBe('stringify')

      // Test it works
      const purl = new PackageURL(
        'npm',
        undefined,
        'test',
        '1.0.0',
        undefined,
        undefined,
      )
      expect(stringify(purl)).toBe('pkg:npm/test@1.0.0')
    })
  })

  describe('PurlError functionality', () => {
    it('should create PurlError with message', () => {
      const error = new PurlError('test error message')
      expect(error.message).toContain('test error message')
      expect(error).toBeInstanceOf(Error)
    })

    it('should support error cause', () => {
      const cause = new Error('underlying error')
      const error = new PurlError('wrapper error', { cause })
      expect(error.cause).toBe(cause)
      expect(error.message).toContain('wrapper error')
    })

    it('should be throwable and catchable', () => {
      expect(() => {
        throw new PurlError('test throw')
      }).toThrow('test throw')

      try {
        throw new PurlError('test catch')
      } catch (e) {
        expect(e).toBeInstanceOf(Error)
        expect((e as Error).message).toContain('test catch')
      }
    })
  })
})
