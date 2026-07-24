/**
 * @file Tests for scripts/repo/check/dist-entries-are-requirable.mts. Covers
 *   both arms of every exported function: runtime-target collection from an
 *   exports map, child-process load probing of good and crashing modules, and
 *   the full runCheck pass over this repo's real built dist.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import { REPO_ROOT } from '../scripts/fleet/paths.mts'
import {
  collectRuntimeTargets,
  probeEntry,
  runCheck,
} from '../scripts/repo/check/dist-entries-are-requirable.mts'

const tmpDirs: string[] = []

function makeTmpDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dist-entries-gate-'))
  tmpDirs.push(dir)
  return dir
}

afterAll(async () => {
  for (let i = 0, { length } = tmpDirs; i < length; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- teardown of a handful of dirs; sequential is fine.
    await safeDelete(tmpDirs[i])
  }
})

describe('collectRuntimeTargets', () => {
  it('collects default condition targets and main, skipping types and source', () => {
    const targets = collectRuntimeTargets({
      exports: {
        '.': {
          source: './src/index.mts',
          types: './dist/index.d.mts',
          default: './dist/index.js',
        },
        './exists': {
          source: './src/exists.mts',
          types: './dist/exists.d.mts',
          default: './dist/exists.js',
        },
        './package.json': './package.json',
      },
      main: './dist/index.js',
    })
    expect(targets).toEqual([
      './dist/exists.js',
      './dist/index.js',
      './package.json',
    ])
  })

  it('collects nested require/import condition targets', () => {
    const targets = collectRuntimeTargets({
      exports: {
        '.': {
          node: {
            require: './dist/index.cjs',
            import: './dist/index.mjs',
          },
          default: './dist/index.js',
        },
      },
    })
    expect(targets).toEqual([
      './dist/index.cjs',
      './dist/index.js',
      './dist/index.mjs',
    ])
  })

  it('skips declaration files appearing as bare values', () => {
    const targets = collectRuntimeTargets({
      exports: { './types': './dist/types.d.ts' },
    })
    expect(targets).toEqual([])
  })

  it('returns [] when there is no exports map and no main', () => {
    expect(collectRuntimeTargets({})).toEqual([])
  })
})

describe('probeEntry', () => {
  it('passes for a module that loads cleanly', () => {
    const dir = makeTmpDir()
    const file = path.join(dir, 'ok.js')
    writeFileSync(file, 'module.exports = { ok: true }\n')
    expect(probeEntry(file)).toEqual([])
  })

  it('fails both require and import probes for a module that throws at load', () => {
    const dir = makeTmpDir()
    const file = path.join(dir, 'crash.js')
    // The 1.4.5 defect class: a module-scope call on a clobbered binding.
    writeFileSync(
      file,
      'const node = class {}\nconst useNative = node.satisfies(">=16.7.0")\nmodule.exports = { useNative }\n',
    )
    const failures = probeEntry(file)
    expect(failures.map(f => f.mode).toSorted()).toEqual(['import', 'require'])
    for (const failure of failures) {
      expect(failure.stderr).toContain('node.satisfies is not a function')
    }
  })

  it('probes JSON targets via require only', () => {
    const dir = makeTmpDir()
    const file = path.join(dir, 'data.json')
    writeFileSync(file, '{"ok": true}\n')
    expect(probeEntry(file)).toEqual([])
  })
})

describe('runCheck', () => {
  it('skips cleanly when dist/ is not built', () => {
    const dir = makeTmpDir()
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        exports: { '.': { default: './dist/index.js' } },
      }),
    )
    expect(runCheck(dir, { quiet: true })).toBe(0)
  })

  it('fails when a declared entry crashes at load', () => {
    const dir = makeTmpDir()
    mkdirSync(path.join(dir, 'dist'))
    writeFileSync(
      path.join(dir, 'dist', 'index.js'),
      'throw new Error("boom at module scope")\n',
    )
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        exports: { '.': { default: './dist/index.js' } },
      }),
    )
    expect(runCheck(dir, { quiet: true })).toBe(1)
  })

  it('fails when a declared entry file is missing from a built dist', () => {
    const dir = makeTmpDir()
    mkdirSync(path.join(dir, 'dist'))
    writeFileSync(path.join(dir, 'dist', 'index.js'), 'module.exports = {}\n')
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        exports: {
          '.': { default: './dist/index.js' },
          './exists': { default: './dist/exists.js' },
        },
      }),
    )
    expect(runCheck(dir, { quiet: true })).toBe(1)
  })

  it("passes over this repo's real built dist", () => {
    expect(runCheck(REPO_ROOT, { quiet: true })).toBe(0)
  })
})
