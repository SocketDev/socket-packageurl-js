/**
 * @file Tests for stringify.mts — stringify and related utilities.
 */
import { describe, expect, it } from 'vitest'

import type { PackageURL } from '../src/package-url.mjs'
import { stringify } from '../src/stringify.mjs'

describe('stringify edge cases', () => {
  it('omits the type segment when type is empty', () => {
    const purl = {
      type: '',
      name: 'lodash',
      namespace: undefined,
      version: '1.0.0',
      qualifiers: undefined,
      subpath: undefined,
    } as PackageURL

    expect(stringify(purl)).toBe('pkg:/lodash@1.0.0')
  })
})
