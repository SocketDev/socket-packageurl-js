import { describe, expect, it } from 'vitest'

import { createHelpersNamespaceObject } from '../src/helpers.js'

describe('Helpers utilities', () => {
  describe('createHelpersNamespaceObject', () => {
    it('should organize helpers by property names', () => {
      const helpers = {
        helper1: { prop1: 'value1', prop2: 'value2' },
        helper2: { prop1: 'value3', prop3: 'value4' },
      }
      const result = createHelpersNamespaceObject(helpers)

      expect(result.prop1).toEqual({
        helper1: 'value1',
        helper2: 'value3',
      })
      expect(result.prop2).toEqual({ helper1: 'value2' })
      expect(result.prop3).toEqual({ helper2: 'value4' })
      expect(Object.keys(result)).toEqual(['prop1', 'prop2', 'prop3'])
    })

    it('should handle defaults and undefined values', () => {
      const helpers = {
        helper1: { prop1: 'value1', prop2: undefined },
        helper2: { prop1: undefined, prop2: 'value2' },
      }
      const defaults = { helper1: 'default1', helper2: 'default2' }
      const result = createHelpersNamespaceObject(helpers, defaults)

      expect(result.prop1).toEqual({
        helper1: 'value1',
        helper2: 'default2',
      })
      expect(result.prop2).toEqual({
        helper1: 'default1',
        helper2: 'value2',
      })
    })

    it('should support custom comparator and null prototype', () => {
      const helper1 = Object.create(null)
      helper1.zProp = 'z'
      helper1.aProp = 'a'

      const helpers = { helper1 }
      const comparator = (a: string, b: string) => b.localeCompare(a)
      const result = createHelpersNamespaceObject(helpers, { comparator })

      expect(Object.keys(result)).toEqual(['zProp', 'aProp'])
      expect(result.aProp).toEqual({ helper1: 'a' })
    })

    it('should handle edge cases', () => {
      expect(createHelpersNamespaceObject({})).toEqual({})

      const withUndefinedDefault = createHelpersNamespaceObject(
        { helper1: { prop1: 'value1' } },
        { helper1: undefined },
      )
      expect(withUndefinedDefault.prop1).toEqual({ helper1: 'value1' })
    })
  })
})
