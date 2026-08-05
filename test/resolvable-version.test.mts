/**
 * @file Specs for the resolvable-version predicate. The cases that matter are
 *   the ones a leading-operator check alone misses — wildcards and dist tags —
 *   and the inverse: real versions that merely LOOK like one of those and must
 *   stay resolvable.
 */

import assert from 'node:assert/strict'

import { describe, it } from 'vitest'

import {
  describeUnresolvableVersion,
  isResolvableVersion,
} from '../src/resolvable-version.mts'

describe('isResolvableVersion', () => {
  it('accepts concrete versions', () => {
    for (const v of [
      '1.2.3',
      '0.0.1',
      '1.0.0-beta.1',
      '2.0.0-rc.3',
      '1.0.0+build.5',
      '1.0.0-alpha.x1',
      '20240101.1',
    ]) {
      assert.equal(isResolvableVersion(v), true, v)
    }
  })

  it('rejects a leaked dependency-specifier tail', () => {
    for (const v of [
      '1.17.0 ; python_version >= "3.12"',
      '1.2.3 - 2.0.0',
      '1.0.0 ',
    ]) {
      assert.equal(isResolvableVersion(v), false, v)
    }
  })

  it('rejects a leading range operator', () => {
    for (const v of ['^1.2.3', '~1.2', '>=1.0.0', '<2.0.0', '=1.0.0']) {
      assert.equal(isResolvableVersion(v), false, v)
    }
  })

  it('rejects wildcards, which a leading-operator check misses', () => {
    for (const v of ['*', '1.x', '1.2.x', '1.2.*', '1.X']) {
      assert.equal(isResolvableVersion(v), false, v)
    }
  })

  it('rejects dist tags, which a leading-operator check misses', () => {
    for (const v of ['latest', 'next', 'canary', 'beta', 'RC', 'stable']) {
      assert.equal(isResolvableVersion(v), false, v)
    }
  })

  it('keeps a real version that merely contains a tag word', () => {
    // The whole point of matching dist tags WHOLE: these are releases.
    for (const v of ['1.0.0-beta.1', '2.0.0-rc.1', '0.1.0-canary.20240101']) {
      assert.equal(isResolvableVersion(v), true, v)
    }
  })

  it('treats an absent version as unresolvable', () => {
    // A purl with no version names a package, not a release.
    assert.equal(isResolvableVersion(''), false)
  })
})

describe('describeUnresolvableVersion', () => {
  it('is undefined for a resolvable version', () => {
    assert.equal(describeUnresolvableVersion('1.2.3'), undefined)
  })

  it('names the specific pattern that matched', () => {
    assert.match(
      describeUnresolvableVersion('1.17.0 ; python_version >= "3.12"')!,
      /dependency-specifier tail/,
    )
    assert.match(describeUnresolvableVersion('^1.2.3')!, /range operator/)
    assert.match(describeUnresolvableVersion('1.x')!, /wildcard/)
    assert.match(describeUnresolvableVersion('latest')!, /dist tag/)
  })

  it('quotes the offending version so the caller can echo it', () => {
    assert.match(describeUnresolvableVersion('^1.2.3')!, /'\^1\.2\.3'/)
  })
})
