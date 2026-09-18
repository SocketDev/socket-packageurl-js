import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import { PURL_SPEC_FIXTURE_DIR } from '../../../scripts/repo/paths.mts'
import {
  applySuite,
  diffSuite,
  selectSoakedRelease,
  parsePurlSpecPin,
} from '../../../scripts/repo/sync-purl-spec.mts'

const tmpDirs: string[] = []

function makeCheckout(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'purl-spec-sync-'))
  tmpDirs.push(root)
  cpSync(PURL_SPEC_FIXTURE_DIR, path.join(root, 'tests'), { recursive: true })
  return root
}

afterAll(async () => {
  for (const dir of tmpDirs) await safeDelete(dir)
})

describe('diffSuite', () => {
  it('accepts a byte-identical pinned suite', () => {
    expect(diffSuite(makeCheckout())).toEqual([])
  })

  it('reports and applies changed, missing, and stale fixtures', async () => {
    const checkout = makeCheckout()
    const vendored = path.join(checkout, 'vendored')
    cpSync(PURL_SPEC_FIXTURE_DIR, vendored, { recursive: true })
    const name = 'specification-test.json'
    const originalPath = path.join(checkout, 'tests', 'spec', name)
    const content = readFileSync(originalPath, 'utf8')
    writeFileSync(originalPath, `${content}\n`)
    writeFileSync(path.join(checkout, 'tests', 'spec', 'new.json'), content)
    writeFileSync(path.join(vendored, 'spec', 'stale.json'), content)
    const drift = diffSuite(checkout, vendored)
    expect(drift).toEqual(
      expect.arrayContaining([
        { kind: 'changed', relPath: path.join('spec', name) },
        { kind: 'missing', relPath: path.join('spec', 'new.json') },
        { kind: 'stale', relPath: path.join('spec', 'stale.json') },
      ]),
    )
    await applySuite(checkout, drift, { fixtureDir: vendored })
    expect(diffSuite(checkout, vendored)).toEqual([])
  })

  it('restores all fixtures when finalizing the pin fails', async () => {
    const checkout = makeCheckout()
    const vendored = path.join(checkout, 'vendored')
    cpSync(PURL_SPEC_FIXTURE_DIR, vendored, { recursive: true })
    const fixture = path.join(
      checkout,
      'tests',
      'spec',
      'specification-test.json',
    )
    writeFileSync(fixture, `${readFileSync(fixture, 'utf8')}\n`)
    const drift = diffSuite(checkout, vendored)
    await expect(
      applySuite(checkout, drift, {
        fixtureDir: vendored,
        finalize() {
          throw new Error('simulated pin write failure')
        },
      }),
    ).rejects.toThrow()
    expect(diffSuite(checkout, vendored)).toEqual(drift)
  })

  it('rejects absent and empty upstream directories', async () => {
    const checkout = makeCheckout()
    await safeDelete(path.join(checkout, 'tests', 'spec'))
    expect(() => diffSuite(checkout)).toThrow()
    mkdirSync(path.join(checkout, 'tests', 'spec'))
    expect(() => diffSuite(checkout)).toThrow()
  })

  it('rejects malformed fixtures before proposing deletions', () => {
    const checkout = makeCheckout()
    writeFileSync(
      path.join(checkout, 'tests', 'spec', 'specification-test.json'),
      '{}',
    )
    expect(() => diffSuite(checkout)).toThrow()
  })

  it('rejects unsafe drift paths before writing any file', async () => {
    const checkout = makeCheckout()
    const vendored = path.join(checkout, 'vendored')
    cpSync(PURL_SPEC_FIXTURE_DIR, vendored, { recursive: true })
    const preservedPath = path.join(vendored, 'spec', 'specification-test.json')
    const original = readFileSync(preservedPath, 'utf8')
    await expect(
      applySuite(
        checkout,
        [
          {
            kind: 'stale',
            relPath: path.join('spec', 'specification-test.json'),
          },
          { kind: 'stale', relPath: '../outside.json' },
        ],
        { fixtureDir: vendored },
      ),
    ).rejects.toThrow()
    expect(readFileSync(preservedPath, 'utf8')).toBe(original)
  })
})

describe('selectSoakedRelease', () => {
  const now = Date.parse('2026-09-18T00:00:00Z')
  const stable = {
    tag_name: 'v1.0.1',
    published_at: '2026-09-11T00:00:00Z',
    draft: false,
    prerelease: false,
  }

  it('selects the highest published version at the soak boundary', () => {
    expect(
      selectSoakedRelease([stable, { ...stable, tag_name: 'v1.0.0' }], now),
    ).toBe('v1.0.1')
  })

  it('excludes recent, draft, prerelease, and malformed releases', () => {
    expect(
      selectSoakedRelease(
        [
          { ...stable, published_at: '2026-09-11T00:00:01Z' },
          { ...stable, draft: true },
          { ...stable, prerelease: true },
          { ...stable, tag_name: 'invalid' },
          null,
        ],
        now,
      ),
    ).toBeUndefined()
    expect(() => selectSoakedRelease({})).toThrow()
  })
})

describe('parsePurlSpecPin', () => {
  const entry = `# purl-spec-draft sha256:${'c'.repeat(64)}
[submodule "upstream/purl-spec"]
  path = upstream/purl-spec
  url = https://github.com/package-url/purl-spec.git
  ref = ${'d'.repeat(40)}
  shallow = true
  sparse-checkout = tests types schemas docs`

  it('reads the complete pin from the canonical submodule declaration', () => {
    expect(parsePurlSpecPin(entry)).toEqual({
      ref: 'd'.repeat(40),
      repository: 'https://github.com/package-url/purl-spec.git',
      sparse: 'tests types schemas docs',
    })
  })

  it.each([
    '',
    entry.replace('shallow = true', 'shallow = false'),
    entry.replace(`ref = ${'d'.repeat(40)}`, 'ref = main'),
    entry.replace(`sha256:${'c'.repeat(64)}`, ''),
    entry.replace('sparse-checkout = tests types schemas docs', ''),
    `${entry}\n${entry}`,
  ])('rejects an incomplete or duplicate declaration %#', text => {
    expect(() => parsePurlSpecPin(text)).toThrow()
  })
})
