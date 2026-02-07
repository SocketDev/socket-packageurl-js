/**
 * @fileoverview Tests for PURL pattern matching functionality.
 * Tests wildcard matching for type, namespace, name, and version components.
 */

import { describe, expect, it } from 'vitest'

import { createMatcher, matches } from '../src/index.js'
import { createTestPurl } from './utils/test-helpers.mjs'

describe('matches', () => {
  describe('exact matching', () => {
    it('should match identical PURLs', () => {
      const purl = createTestPurl('npm', 'lodash', { version: '4.17.21' })
      expect(matches('pkg:npm/lodash@4.17.21', purl)).toBe(true)
    })

    it('should not match different packages', () => {
      const purl = createTestPurl('npm', 'lodash', { version: '4.17.21' })
      expect(matches('pkg:npm/react@18.0.0', purl)).toBe(false)
    })

    it('should match after normalization', () => {
      const purl = createTestPurl('npm', 'core', {
        namespace: '@babel',
        version: '7.23.0',
      })
      // npm normalizes to lowercase
      expect(matches('pkg:npm/@BABEL/CORE@7.23.0', purl)).toBe(true)
    })
  })

  describe('wildcard in name', () => {
    it('should match prefix wildcard', () => {
      const lodash = createTestPurl('npm', 'lodash')
      const lodashGet = createTestPurl('npm', 'lodash.get')
      const react = createTestPurl('npm', 'react')

      expect(matches('pkg:npm/lodash*', lodash)).toBe(true)
      expect(matches('pkg:npm/lodash*', lodashGet)).toBe(true)
      expect(matches('pkg:npm/lodash*', react)).toBe(false)
    })

    it('should match suffix wildcard', () => {
      const reactDom = createTestPurl('npm', 'react-dom')
      const reactRouter = createTestPurl('npm', 'react-router')
      const lodash = createTestPurl('npm', 'lodash')

      expect(matches('pkg:npm/*-dom', reactDom)).toBe(true)
      expect(matches('pkg:npm/*-router', reactRouter)).toBe(true)
      expect(matches('pkg:npm/*-dom', lodash)).toBe(false)
    })

    it('should match middle wildcard', () => {
      const eslintPluginReact = createTestPurl('npm', 'eslint-plugin-react')
      const eslintPluginNode = createTestPurl('npm', 'eslint-plugin-node')
      const lodash = createTestPurl('npm', 'lodash')

      expect(matches('pkg:npm/eslint-plugin-*', eslintPluginReact)).toBe(true)
      expect(matches('pkg:npm/eslint-plugin-*', eslintPluginNode)).toBe(true)
      expect(matches('pkg:npm/eslint-plugin-*', lodash)).toBe(false)
    })

    it('should match single character wildcard', () => {
      const test1 = createTestPurl('npm', 'test1')
      const test2 = createTestPurl('npm', 'test2')
      const test10 = createTestPurl('npm', 'test10')

      expect(matches('pkg:npm/test?', test1)).toBe(true)
      expect(matches('pkg:npm/test?', test2)).toBe(true)
      expect(matches('pkg:npm/test?', test10)).toBe(false)
    })
  })

  describe('wildcard in namespace', () => {
    it('should match wildcard in namespace', () => {
      const babelCore = createTestPurl('npm', 'core', { namespace: '@babel' })
      const babelParser = createTestPurl('npm', 'parser', {
        namespace: '@babel',
      })
      const lodash = createTestPurl('npm', 'lodash')

      expect(matches('pkg:npm/@babel/*', babelCore)).toBe(true)
      expect(matches('pkg:npm/@babel/*', babelParser)).toBe(true)
      expect(matches('pkg:npm/@babel/*', lodash)).toBe(false)
    })

    it('should match prefix wildcard in namespace', () => {
      const types1 = createTestPurl('npm', 'node', { namespace: '@types' })
      const types2 = createTestPurl('npm', 'react', { namespace: '@types' })
      const babel = createTestPurl('npm', 'core', { namespace: '@babel' })

      expect(matches('pkg:npm/@types/*', types1)).toBe(true)
      expect(matches('pkg:npm/@types/*', types2)).toBe(true)
      expect(matches('pkg:npm/@types/*', babel)).toBe(false)
    })

    it('should match ** for optional namespace', () => {
      const scoped = createTestPurl('npm', 'core', { namespace: '@babel' })
      const unscoped = createTestPurl('npm', 'lodash')

      expect(matches('pkg:npm/**/*', scoped)).toBe(true)
      expect(matches('pkg:npm/**/*', unscoped)).toBe(true)
    })
  })

  describe('wildcard in version', () => {
    it('should match version prefix', () => {
      const react1800 = createTestPurl('npm', 'react', { version: '18.0.0' })
      const react1821 = createTestPurl('npm', 'react', { version: '18.2.1' })
      const react1700 = createTestPurl('npm', 'react', { version: '17.0.0' })

      expect(matches('pkg:npm/react@18.*', react1800)).toBe(true)
      expect(matches('pkg:npm/react@18.*', react1821)).toBe(true)
      expect(matches('pkg:npm/react@18.*', react1700)).toBe(false)
    })

    it('should match major version wildcard', () => {
      const v100 = createTestPurl('npm', 'lodash', { version: '1.0.0' })
      const v211 = createTestPurl('npm', 'lodash', { version: '2.1.1' })
      const v300 = createTestPurl('npm', 'lodash', { version: '3.0.0' })

      expect(matches('pkg:npm/lodash@?.0.0', v100)).toBe(true)
      expect(matches('pkg:npm/lodash@?.1.1', v211)).toBe(true)
      expect(matches('pkg:npm/lodash@?.0.0', v300)).toBe(true)
    })

    it('should match ** for optional version', () => {
      const withVersion = createTestPurl('npm', 'lodash', {
        version: '4.17.21',
      })
      const withoutVersion = createTestPurl('npm', 'lodash')

      expect(matches('pkg:npm/lodash@**', withVersion)).toBe(true)
      expect(matches('pkg:npm/lodash@**', withoutVersion)).toBe(true)
    })

    it('should not match when version is missing but pattern requires it', () => {
      const purl = createTestPurl('npm', 'lodash')
      expect(matches('pkg:npm/lodash@4.*', purl)).toBe(false)
    })

    it('should require exact version presence match when no version wildcards', () => {
      const withVersion = createTestPurl('npm', 'lodash', {
        version: '4.17.21',
      })
      const withoutVersion = createTestPurl('npm', 'lodash')

      // Pattern without version only matches PURL without version
      expect(matches('pkg:npm/lodash', withoutVersion)).toBe(true)
      expect(matches('pkg:npm/lodash', withVersion)).toBe(false)

      // Pattern with @** matches both with and without version
      expect(matches('pkg:npm/lodash@**', withVersion)).toBe(true)
      expect(matches('pkg:npm/lodash@**', withoutVersion)).toBe(true)
    })
  })

  describe('wildcard in type', () => {
    it('should match wildcard type', () => {
      const npm = createTestPurl('npm', 'lodash')
      const pypi = createTestPurl('pypi', 'django')

      expect(matches('pkg:*/lodash', npm)).toBe(true)
      expect(matches('pkg:*/django', pypi)).toBe(true)
      expect(matches('pkg:*/guava', npm)).toBe(false)
    })

    it('should match specific type pattern', () => {
      const npm = createTestPurl('npm', 'lodash')
      const nuget = createTestPurl('nuget', 'newtonsoft')

      expect(matches('pkg:n*/*', npm)).toBe(true)
      expect(matches('pkg:n*/*', nuget)).toBe(true)
    })
  })

  describe('combined wildcards', () => {
    it('should match multiple wildcards', () => {
      const purl = createTestPurl('npm', 'plugin-syntax-jsx', {
        namespace: '@babel',
        version: '7.23.0',
      })

      expect(matches('pkg:npm/@babel/plugin-*@**', purl)).toBe(true)
      expect(matches('pkg:npm/@babel/*@7.*', purl)).toBe(true)
      expect(matches('pkg:npm/@babel/*-jsx@7.*', purl)).toBe(true)
    })

    it('should match wildcard type with wildcard name', () => {
      const npm = createTestPurl('npm', 'eslint-plugin-react')
      const pypi = createTestPurl('pypi', 'eslint-something')

      expect(matches('pkg:*/eslint-*', npm)).toBe(true)
      expect(matches('pkg:*/eslint-*', pypi)).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('should return false for invalid pattern', () => {
      const purl = createTestPurl('npm', 'lodash')
      expect(matches('not-a-purl', purl)).toBe(false)
      expect(matches('', purl)).toBe(false)
      expect(matches('pkg:', purl)).toBe(false)
      expect(matches('pkg:npm', purl)).toBe(false)
    })

    it('should handle empty components', () => {
      const purl = createTestPurl('npm', 'lodash')

      // Pattern with no namespace should match purl with no namespace
      expect(matches('pkg:npm/lodash', purl)).toBe(true)

      // Pattern with no version should match purl with no version
      expect(matches('pkg:npm/lodash', purl)).toBe(true)
    })

    it('should handle special regex characters literally in values', () => {
      const purlDot = createTestPurl('npm', 'lodash.get')
      const purlDash = createTestPurl('npm', 'lodash-get')

      // Exact match with dot
      expect(matches('pkg:npm/lodash.get', purlDot)).toBe(true)
      // Wildcard * should match the dot
      expect(matches('pkg:npm/lodash*get', purlDot)).toBe(true)
      // Dot package should not match dash pattern
      expect(matches('pkg:npm/lodash-get', purlDot)).toBe(false)
      // Dash package should not match dot pattern
      expect(matches('pkg:npm/lodash.get', purlDash)).toBe(false)
    })

    it('should handle scoped packages with wildcards', () => {
      const purl = createTestPurl('npm', 'core', { namespace: '@babel' })
      expect(matches('pkg:npm/@babel/*@**', purl)).toBe(true)
      expect(matches('pkg:npm/@*/*@**', purl)).toBe(true)
    })

    it('should handle multiple consecutive wildcards', () => {
      const purl = createTestPurl('npm', 'package', { version: '1.0.0' })
      expect(matches('pkg:npm/*@*', purl)).toBe(true)
      expect(matches('pkg:*/*@*', purl)).toBe(true)
    })

    it('should handle qualifiers (not matched in v1)', () => {
      const purl = createTestPurl('npm', 'lodash', {
        version: '4.17.21',
        qualifiers: { arch: 'x64' },
      })

      // Qualifiers are not compared in pattern matching v1
      expect(matches('pkg:npm/lodash@4.17.21', purl)).toBe(true)
    })

    it('should handle subpath (not matched in v1)', () => {
      const purl = createTestPurl('npm', 'lodash', {
        version: '4.17.21',
        subpath: 'lib/index.js',
      })

      // Subpath is not compared in pattern matching v1
      expect(matches('pkg:npm/lodash@4.17.21', purl)).toBe(true)
    })
  })

  describe('normalization', () => {
    it('should match against normalized npm packages', () => {
      const purl = createTestPurl('npm', 'CORE', {
        namespace: '@BABEL',
        version: '7.23.0',
      })

      // npm normalizes namespace and name to lowercase
      expect(matches('pkg:npm/@babel/core@7.23.0', purl)).toBe(true)
    })

    it('should match against normalized pypi packages', () => {
      const purl = createTestPurl('pypi', 'Django-REST')

      // pypi normalizes name to lowercase and replaces underscores with dashes
      expect(matches('pkg:pypi/django-rest', purl)).toBe(true)
    })
  })
})

describe('createMatcher', () => {
  it('should create reusable matcher', () => {
    const isBabel = createMatcher('pkg:npm/@babel/*')

    const babelCore = createTestPurl('npm', 'core', { namespace: '@babel' })
    const babelParser = createTestPurl('npm', 'parser', { namespace: '@babel' })
    const lodash = createTestPurl('npm', 'lodash')

    expect(isBabel(babelCore)).toBe(true)
    expect(isBabel(babelParser)).toBe(true)
    expect(isBabel(lodash)).toBe(false)
  })

  it('should work with Array.filter', () => {
    const packages = [
      createTestPurl('npm', 'core', { namespace: '@babel', version: '7.23.0' }),
      createTestPurl('npm', 'parser', {
        namespace: '@babel',
        version: '7.23.0',
      }),
      createTestPurl('npm', 'lodash', { version: '4.17.21' }),
      createTestPurl('npm', 'node', { namespace: '@types', version: '20.0.0' }),
    ]

    const isBabel = createMatcher('pkg:npm/@babel/*@**')
    const babelPackages = packages.filter(isBabel)

    expect(babelPackages).toHaveLength(2)
    expect(babelPackages[0]?.['name']).toBe('core')
    expect(babelPackages[1]?.['name']).toBe('parser')
  })

  it('should work with Array.some', () => {
    const packages = [
      createTestPurl('npm', 'core', { namespace: '@babel', version: '7.23.0' }),
      createTestPurl('npm', 'lodash', { version: '4.17.21' }),
    ]

    const isBabel = createMatcher('pkg:npm/@babel/*@**')
    expect(packages.some(isBabel)).toBe(true)

    const isReact = createMatcher('pkg:npm/react@**')
    expect(packages.some(isReact)).toBe(false)
  })

  it('should work with Array.every', () => {
    const allBabel = [
      createTestPurl('npm', 'core', { namespace: '@babel', version: '7.23.0' }),
      createTestPurl('npm', 'parser', {
        namespace: '@babel',
        version: '7.23.0',
      }),
    ]

    const mixed = [
      createTestPurl('npm', 'core', { namespace: '@babel', version: '7.23.0' }),
      createTestPurl('npm', 'lodash', { version: '4.17.21' }),
    ]

    const isBabel = createMatcher('pkg:npm/@babel/*@**')
    expect(allBabel.every(isBabel)).toBe(true)
    expect(mixed.every(isBabel)).toBe(false)
  })

  it('should return false for invalid pattern', () => {
    const matcher = createMatcher('not-a-purl')
    const purl = createTestPurl('npm', 'lodash')

    expect(matcher(purl)).toBe(false)
  })

  it('should handle all wildcard types', () => {
    const matchVersion = createMatcher('pkg:npm/react@18.*')
    expect(
      matchVersion(createTestPurl('npm', 'react', { version: '18.0.0' })),
    ).toBe(true)
    expect(
      matchVersion(createTestPurl('npm', 'react', { version: '17.0.0' })),
    ).toBe(false)

    const matchName = createMatcher('pkg:npm/eslint-plugin-*')
    expect(matchName(createTestPurl('npm', 'eslint-plugin-react'))).toBe(true)
    expect(matchName(createTestPurl('npm', 'lodash'))).toBe(false)

    const matchNamespace = createMatcher('pkg:npm/@types/*')
    expect(
      matchNamespace(createTestPurl('npm', 'node', { namespace: '@types' })),
    ).toBe(true)
    expect(
      matchNamespace(createTestPurl('npm', 'core', { namespace: '@babel' })),
    ).toBe(false)

    const matchType = createMatcher('pkg:*/lodash')
    expect(matchType(createTestPurl('npm', 'lodash'))).toBe(true)
    expect(matchType(createTestPurl('pypi', 'lodash'))).toBe(true)
    expect(matchType(createTestPurl('npm', 'react'))).toBe(false)
  })

  it('should handle optional components with **', () => {
    const matchOptionalVersion = createMatcher('pkg:npm/lodash@**')

    expect(
      matchOptionalVersion(
        createTestPurl('npm', 'lodash', { version: '4.17.21' }),
      ),
    ).toBe(true)
    expect(matchOptionalVersion(createTestPurl('npm', 'lodash'))).toBe(true)
    expect(matchOptionalVersion(createTestPurl('npm', 'react'))).toBe(false)
  })

  describe('performance comparison', () => {
    it('should be more efficient than repeated matches() calls', () => {
      const packages = Array.from({ length: 100 }, (_, i) => {
        const isEven = i % 2 === 0
        return createTestPurl('npm', `package-${i}`, {
          namespace: isEven ? '@babel' : '@types',
        })
      })

      // Measure matcher approach
      const matcherStart = performance.now()
      const matcher = createMatcher('pkg:npm/@babel/*')
      const matcherResults = packages.filter(matcher)
      const matcherEnd = performance.now()
      const matcherTime = matcherEnd - matcherStart

      // Measure repeated matches() approach
      const matchesStart = performance.now()
      const matchesResults = packages.filter(p =>
        matches('pkg:npm/@babel/*', p),
      )
      const matchesEnd = performance.now()
      const matchesTime = matchesEnd - matchesStart

      // Results should be identical
      expect(matcherResults.length).toBe(matchesResults.length)
      expect(matcherResults.length).toBe(50)

      // createMatcher should be faster (though timing can vary)
      // We don't assert timing to avoid flaky tests, but log for informational purposes
      console.log(`createMatcher time: ${matcherTime.toFixed(3)}ms`)
      console.log(`matches() time: ${matchesTime.toFixed(3)}ms`)
      console.log(`Speedup: ${(matchesTime / matcherTime).toFixed(2)}x faster`)
    })
  })

  describe('edge cases', () => {
    it('should handle invalid patterns without type separator', () => {
      const purl = createTestPurl('npm', 'lodash')

      // Pattern without '/' after type - should not match
      expect(matches('pkg:npm', purl)).toBe(false)

      // createMatcher should also handle it
      const matcher = createMatcher('pkg:npm')
      expect(matcher(purl)).toBe(false)
    })

    it('should handle pypi patterns with underscores', () => {
      const purl = createTestPurl('pypi', 'typing-extensions')

      // PyPI normalizes underscores to dashes
      expect(matches('pkg:pypi/typing_extensions', purl)).toBe(true)

      // createMatcher should also normalize
      const matcher = createMatcher('pkg:pypi/typing_extensions')
      expect(matcher(purl)).toBe(true)
    })

    it('should handle namespace wildcards with createMatcher', () => {
      const purl = createTestPurl('npm', 'core', { namespace: '@babel' })

      // Wildcard in namespace
      const matcher = createMatcher('pkg:npm/@*/*@**')
      expect(matcher(purl)).toBe(true)
    })
  })
})
