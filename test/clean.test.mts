import { it } from 'vitest'
import { assertCliHelp } from './utils/cli-help.mts'

it('clean help parses flags and prints usage', () => {
  assertCliHelp('clean')
})
