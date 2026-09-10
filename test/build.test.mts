import { it } from 'vitest'
import { assertCliHelp } from './utils/cli-help.mts'

it('build help parses flags and prints usage', () => {
  assertCliHelp('build')
})
