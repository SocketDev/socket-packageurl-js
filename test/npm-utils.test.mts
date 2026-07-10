/**
 * @file Tests for npm-utils.mts — npmExists and related utilities.
 */
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { npmExists } from '../src/purl-types/npm-utils.mjs'

describe('npmExists omits latestVersion edge cases', () => {
  beforeEach(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  it('omits latestVersion when there is no dist-tags entry and the requested version is missing', async () => {
    nock('https://registry.npmjs.org')
      .get('/gapcase-pkg')
      .reply(200, {
        versions: { '1.0.0': {} },
      })

    const result = await npmExists('gapcase-pkg', undefined, '2.0.0')

    expect(result.exists).toBe(false)
    expect(result.error).toContain('Version 2.0.0 not found')
    expect(result.latestVersion).toBeUndefined()
  })
})
