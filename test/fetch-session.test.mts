import { it } from 'vitest'
import { assertCliHelp } from './utils/cli-help.mts'

it('prints command usage without running its work', () => {
  assertCliHelp('bootstrap/fetch-session', { usage: 'Usage:' })
})
