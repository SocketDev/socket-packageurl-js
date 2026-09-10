import { expect, it, vi } from 'vitest'
import { assertCliHelp } from './utils/cli-help.mts'

it('prints command usage without running its work', () => {
  assertCliHelp('update-data-npm')
})

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(async () => false),
  start: vi.fn(),
  stop: vi.fn(),
  writeJson: vi.fn(),
}))

vi.mock(import('all-the-package-names/names.json'), () => ({ default: [] }))
vi.mock(import('all-the-package-names-v1.3905.0/names.json'), () => ({
  default: [],
}))

vi.mock(import('@socketsecurity/lib-stable/stdio/prompts'), () => ({
  confirm: mocks.confirm,
}))
vi.mock(
  import('@socketsecurity/lib-stable/spinner/default'),
  async importOriginal => {
    const actual = await importOriginal()
    const spinner = actual.getDefaultSpinner()
    vi.spyOn(spinner, 'start').mockImplementation(mocks.start)
    vi.spyOn(spinner, 'stop').mockImplementation(mocks.stop)
    return { ...actual, getDefaultSpinner: () => spinner }
  },
)
vi.mock(import('@socketsecurity/lib-stable/fs/write-json'), () => ({
  writeJson: mocks.writeJson,
}))

it('initializes maintenance dependencies and stops after declined updates', async () => {
  const { updateNpmData } = await import('../scripts/repo/update-data-npm.mts')
  await updateNpmData()
  expect(mocks.confirm).toHaveBeenCalledTimes(2)
  expect(mocks.start).toHaveBeenCalledOnce()
  expect(mocks.stop).toHaveBeenCalledOnce()
  expect(mocks.writeJson).not.toHaveBeenCalled()
})
