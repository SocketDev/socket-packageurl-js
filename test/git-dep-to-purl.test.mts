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
    [
      'git+https://github.com/example-owner/example-repo.git',
      'pkg:github/example-owner/example-repo@abc123',
    ],
    [
      'git+ssh://git@github.com/example-owner/example-repo.git',
      'pkg:github/example-owner/example-repo@abc123',
    ],
    [
      'git://github.com/example-owner/example-repo.git',
      'pkg:github/example-owner/example-repo@abc123',
    ],
    [
      'https://github.com/example-owner/example-repo.git',
      'pkg:github/example-owner/example-repo@abc123',
    ],
    [
      'git@github.com:example-owner/example-repo.git',
      'pkg:github/example-owner/example-repo@abc123',
    ],
    [
      'github:example-owner/example-repo',
      'pkg:github/example-owner/example-repo@abc123',
    ],
    [
      'https://gitlab.com/example-owner/example-repo.git',
      'pkg:gitlab/example-owner/example-repo@abc123',
    ],
    [
      'gitlab:example-owner/example-repo',
      'pkg:gitlab/example-owner/example-repo@abc123',
    ],
    [
      'https://bitbucket.org/example-owner/example-repo.git',
      'pkg:bitbucket/example-owner/example-repo@abc123',
    ],
  ])('%s', (url, expected) => {
    expect(gitDepToPurl({ url, commit: 'abc123' })!.toString()).toBe(expected)
  })

  test('no commit yields a versionless purl', () => {
    expect(
      gitDepToPurl({ url: 'github:example-owner/example-repo' })!.toString(),
    ).toBe('pkg:github/example-owner/example-repo')
  })

  test('the .git suffix is stripped from the name', () => {
    expect(
      gitDepToPurl({
        url: 'https://github.com/example-owner/example-repo.git',
      })!.name,
    ).toBe('example-repo')
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
    [
      'https://github.com/example-owner/example-repo.git',
      'example-owner',
      'example-repo',
    ],
    [
      'https://github.com/example-owner/example-repo',
      'example-owner',
      'example-repo',
    ],
    [
      'git@github.com:example-owner/example-repo.git',
      'example-owner',
      'example-repo',
    ],
    [
      'ssh://git@github.com/example-owner/example-repo.git',
      'example-owner',
      'example-repo',
    ],
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
