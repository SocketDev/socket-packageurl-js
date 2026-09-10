/**
 * @file Unit tests for gitDepToPurl. Inputs are the git-dependency spellings
 *   npm, yarn, pnpm, bun, and vlt actually write.
 */

import { describe, expect, test } from 'vitest'

import {
  gitDepToPurl,
  hostOf,
  ownerRepoFromGitUrl,
  trimRepo,
} from '../src/git-dep-to-purl.mts'

describe('hosted remotes map to their own purl type', () => {
  test.each([
    ['git+https://github.com/o/r.git', 'pkg:github/o/r@abc123'],
    ['git+ssh://git@github.com/o/r.git', 'pkg:github/o/r@abc123'],
    ['git://github.com/o/r.git', 'pkg:github/o/r@abc123'],
    ['https://github.com/o/r.git', 'pkg:github/o/r@abc123'],
    ['git@github.com:o/r.git', 'pkg:github/o/r@abc123'],
    ['github:o/r', 'pkg:github/o/r@abc123'],
    ['https://gitlab.com/o/r.git', 'pkg:gitlab/o/r@abc123'],
    ['gitlab:o/r', 'pkg:gitlab/o/r@abc123'],
    ['https://bitbucket.org/o/r.git', 'pkg:bitbucket/o/r@abc123'],
  ])('%s', (url, expected) => {
    expect(gitDepToPurl({ url, commit: 'abc123' })!.toString()).toBe(expected)
  })

  test('no commit yields a versionless purl', () => {
    expect(gitDepToPurl({ url: 'github:o/r' })!.toString()).toBe(
      'pkg:github/o/r',
    )
  })

  test('the .git suffix is stripped from the name', () => {
    expect(gitDepToPurl({ url: 'https://github.com/o/r.git' })!.name).toBe('r')
  })
})

describe('self-hosted remotes fall back to generic + vcs_url', () => {
  test('the location is preserved rather than dropped', () => {
    const purl = gitDepToPurl({
      url: 'git+https://git.internal.example/team/tool.git',
      commit: 'abc123',
    })!
    expect(purl.type).toBe('generic')
    expect(purl.name).toBe('tool')
    expect(purl.version).toBe('abc123')
    expect(purl.qualifiers!['vcs_url']).toBe(
      'git+https://git.internal.example/team/tool.git',
    )
  })
})

describe('ownerRepoFromGitUrl', () => {
  test.each([
    ['https://github.com/o/r.git', 'o', 'r'],
    ['https://github.com/o/r', 'o', 'r'],
    ['git@github.com:o/r.git', 'o', 'r'],
    ['ssh://git@github.com/o/r.git', 'o', 'r'],
  ])('%s', (url, owner, repo) => {
    expect(ownerRepoFromGitUrl(url)).toEqual({ owner, repo })
  })
})

describe('malformed input yields nothing rather than a wrong purl', () => {
  test.each(['', '   ', 'github:', 'github:o', 'github:o/', 'not-a-remote'])(
    '%j',
    url => {
      expect(gitDepToPurl({ url })).toBeUndefined()
    },
  )
})

test('malformed remotes have no owner or hostname', () => {
  expect(ownerRepoFromGitUrl('not-a-remote')).toBeUndefined()
  expect(hostOf('not-a-remote')).toBe('')
})

test.each([
  ['example-repo.git/', 'example-repo'],
  ['example-repo/', 'example-repo'],
  ['example-repo.git', 'example-repo'],
  ['example-repo', 'example-repo'],
])('normalizes repository suffixes in %s', (repo, expected) => {
  expect(trimRepo(repo)).toBe(expected)
})
