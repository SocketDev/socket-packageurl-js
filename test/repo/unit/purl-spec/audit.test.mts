import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PackageURL } from '../../../../src/package-url.mjs'
import {
  auditPurlCases,
  main,
} from '../../../../scripts/repo/purl-spec/audit.mts'
import type { PurlSpecCase } from '../../../../scripts/repo/purl-spec/load.mts'

const sourceMocks = vi.hoisted(() => ({
  readFile: vi.fn(async () => ''),
  spawn: vi.fn<
    (
      command: string,
      args: string[],
      options: {
        cwd?: string | undefined
        stdioString?: boolean | undefined
      },
    ) => Promise<{ code: number; stdout: string; stderr: string }>
  >(),
  load: vi.fn(async (): Promise<PurlSpecCase[]> => []),
}))

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    default: { ...actual, readFile: sourceMocks.readFile },
  }
})
vi.mock('@socketsecurity/lib-stable/process/spawn/child', () => ({
  spawn: sourceMocks.spawn,
}))
vi.mock('../../../../scripts/repo/purl-spec/load.mts', () => ({
  loadPurlSpecCases: sourceMocks.load,
}))

const entry: PurlSpecCase = {
  source: 'spec/fixture.json',
  index: 0,
  test: {
    description: 'generic identity',
    expected_failure: false,
    expected_output: 'pkg:generic/widget',
    input: 'pkg:generic/widget',
    test_group: 'required',
    test_type: 'roundtrip',
  },
}

describe('auditPurlCases', () => {
  it('reports raw differences and counts every evaluated case', () => {
    const mismatch = {
      ...entry,
      index: 1,
      test: { ...entry.test, expected_output: 'pkg:generic/other' },
    }
    expect(auditPurlCases([entry, mismatch], PackageURL)).toMatchObject({
      total: 2,
      passed: 1,
      differences: [
        {
          source: entry.source,
          index: 1,
          result: {
            passed: false,
            actual: 'pkg:generic/widget',
            expected: 'pkg:generic/other',
          },
        },
      ],
    })
  })
})

describe('main source verification', () => {
  const ref = '0123456789012345678901234567890123456789'
  const modules = ['upstream/purl-spec', 'upstream/purl-spec-draft']
    .map(name => `[submodule "${name}"]\npath = ${name}\nref = ${ref}`)
    .join('\n')

  beforeEach(() => {
    vi.resetAllMocks()
    sourceMocks.readFile.mockResolvedValue(modules)
    sourceMocks.load.mockResolvedValue([entry])
    sourceMocks.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
    sourceMocks.spawn.mockResolvedValueOnce({
      code: 0,
      stdout: ref,
      stderr: '',
    })
    sourceMocks.spawn.mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
    sourceMocks.spawn.mockResolvedValueOnce({
      code: 0,
      stdout: ref,
      stderr: '',
    })
  })

  it('checks both pinned corpora without building or evaluating fixtures', async () => {
    sourceMocks.load.mockResolvedValue([
      { ...entry, test: { ...entry.test, expected_output: 'raw-difference' } },
    ])
    expect(await main({ argv: ['--verify-sources', '--json'] })).toEqual({
      exitCode: 0,
      data: [
        { source: 'upstream/purl-spec', ref, total: 1 },
        { source: 'upstream/purl-spec-draft', ref, total: 1 },
      ],
    })
    expect(sourceMocks.load).toHaveBeenCalledTimes(2)
    expect(sourceMocks.spawn.mock.calls).toHaveLength(4)
    expect(sourceMocks.spawn.mock.calls.every(call => call[0] === 'git')).toBe(
      true,
    )
  })

  it('rejects missing pins before reading fixtures', async () => {
    sourceMocks.readFile.mockResolvedValue('')
    await expect(main({ argv: ['--verify-sources'] })).rejects.toThrow()
    expect(sourceMocks.load).not.toHaveBeenCalled()
  })

  it.each([
    { code: 1, stdout: '', stderr: 'checkout unavailable' },
    { code: 0, stdout: 'different-revision', stderr: '' },
  ])('rejects an unavailable or mismatched checkout: %j', async head => {
    sourceMocks.spawn.mockReset()
    sourceMocks.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
    sourceMocks.spawn.mockResolvedValueOnce(head)
    await expect(main({ argv: ['--verify-sources'] })).rejects.toThrow()
    expect(sourceMocks.load).not.toHaveBeenCalled()
  })

  it.each([
    { code: 1, stdout: '', stderr: 'status unavailable' },
    { code: 0, stdout: ' M tests/types/git-test.json', stderr: '' },
  ])('rejects an unreadable or dirty checkout: %j', async status => {
    sourceMocks.spawn.mockReset()
    sourceMocks.spawn.mockResolvedValueOnce({
      code: 0,
      stdout: ref,
      stderr: '',
    })
    sourceMocks.spawn.mockResolvedValueOnce(status)
    await expect(main({ argv: ['--verify-sources'] })).rejects.toThrow()
    expect(sourceMocks.load).not.toHaveBeenCalled()
  })

  it('propagates malformed or missing corpus failures', async () => {
    sourceMocks.load.mockRejectedValue(new SyntaxError('invalid corpus'))
    await expect(main({ argv: ['--verify-sources'] })).rejects.toThrow(
      SyntaxError,
    )
    expect(sourceMocks.spawn.mock.calls).toHaveLength(2)
  })

  it('rejects unknown options before reading sources', async () => {
    await expect(main({ argv: ['--verify-source'] })).rejects.toThrow()
    expect(sourceMocks.readFile).not.toHaveBeenCalled()
  })
})
