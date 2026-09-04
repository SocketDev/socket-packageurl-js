/**
 * @file `gitDepToPurl(dep)` — convert a git dependency, in any npm-ecosystem
 *   spelling, into a PackageURL. Hosted remotes map to their own purl type;
 *   anything else becomes `pkg:generic` carrying a `vcs_url` qualifier.
 */

import { PackageURL } from './package-url.mjs'
import { PurlQualifierNames } from './purl-qualifier-names.mjs'

export interface GitDepLike {
  readonly url: string
  readonly commit?: string | undefined
}

interface HostRule {
  readonly type: string
  readonly hosts: readonly string[]
  readonly shorthand: string
}

const HOST_RULES: readonly HostRule[] = [
  { type: 'github', hosts: ['github.com'], shorthand: 'github:' },
  { type: 'gitlab', hosts: ['gitlab.com'], shorthand: 'gitlab:' },
  { type: 'bitbucket', hosts: ['bitbucket.org'], shorthand: 'bitbucket:' },
]

/** Strip the git-specific protocol prefixes purl has no place for. */
function stripGitProtocol(url: string): string {
  if (url.startsWith('git+')) {
    return url.slice('git+'.length)
  }
  if (url.startsWith('git://')) {
    return `https://${url.slice('git://'.length)}`
  }
  return url
}

interface OwnerRepo {
  readonly owner: string
  readonly repo: string
}

function trimRepo(repo: string): string {
  const noSlash = repo.endsWith('/') ? repo.slice(0, -1) : repo
  return noSlash.endsWith('.git') ? noSlash.slice(0, -'.git'.length) : noSlash
}

/**
 * Owner and repo from a remote URL, covering the `https://host/o/r`, scp-like
 * `git@host:o/r`, and `ssh://git@host/o/r` shapes.
 */
export function ownerRepoFromGitUrl(url: string): OwnerRepo | undefined {
  const match = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim())
  if (!match) {
    return undefined
  }
  return { owner: match[1]!, repo: trimRepo(match[2]!) }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    // scp-like `git@host:o/r` is not a parseable URL.
    const at = url.indexOf('@')
    const colon = url.indexOf(':', at + 1)
    return at >= 0 && colon > at
      ? url.slice(at + 1, colon).toLowerCase()
      : ''
  }
}

function ruleForShorthand(url: string): HostRule | undefined {
  for (const rule of HOST_RULES) {
    if (url.startsWith(rule.shorthand)) {
      return rule
    }
  }
  return undefined
}

function ruleForHost(host: string): HostRule | undefined {
  for (const rule of HOST_RULES) {
    if (rule.hosts.includes(host)) {
      return rule
    }
  }
  return undefined
}

/**
 * Returns undefined when no owner/repo can be recovered, so a malformed remote
 * yields nothing rather than a purl that points somewhere wrong.
 */
export function gitDepToPurl(dep: GitDepLike): PackageURL | undefined {
  const raw = dep.url.trim()
  if (!raw) {
    return undefined
  }
  const version = dep.commit || undefined

  const shorthandRule = ruleForShorthand(raw)
  if (shorthandRule) {
    const path = raw.slice(shorthandRule.shorthand.length)
    const slash = path.indexOf('/')
    if (slash <= 0 || slash === path.length - 1) {
      return undefined
    }
    return new PackageURL(
      shorthandRule.type,
      path.slice(0, slash),
      trimRepo(path.slice(slash + 1)),
      version,
      undefined,
      undefined,
    )
  }

  const url = stripGitProtocol(raw)
  const parts = ownerRepoFromGitUrl(url)
  if (!parts) {
    return undefined
  }
  const hostRule = ruleForHost(hostOf(url))
  if (hostRule) {
    return new PackageURL(
      hostRule.type,
      parts.owner,
      parts.repo,
      version,
      undefined,
      undefined,
    )
  }
  // A self-hosted remote has no purl type of its own, so the location is
  // preserved in the spec's vcs_url qualifier instead of being dropped.
  return new PackageURL(
    'generic',
    undefined,
    parts.repo,
    version,
    { [PurlQualifierNames.VcsUrl]: raw },
    undefined,
  )
}
