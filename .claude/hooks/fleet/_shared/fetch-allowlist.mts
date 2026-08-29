/**
 * @file Single source of truth for the fleet's host allowlist: ONE list, read
 *   through ONE reader, under ONE name. Every consumer imports from here — the
 *   fetch-allowlist-is-respected-at-edit Claude hook (PreToolUse, blocks a
 *   fetch/download to an off-allowlist host), the commit-time
 *   fetch-allowlist-is-respected-at-commit check, and the
 *   fetch-allowlist-is-gh-aw-subset containment gate — so no two of them can
 *   disagree about which hosts are granted (code is law, DRY). Schema v2:
 *   `.config/fleet/fetch-allowlist.json` holds a single `hosts[]` array whose
 *   entries each carry `scopes`. A scope selects the consumer, not a second
 *   list. `"runtime"` is a host a local agent run may reach at runtime and is
 *   what the containment gate compares against gh-aw's CI firewall; `"fetch"`
 *   is a host an agent's own curl/wget/fetch may target and is what the guard
 *   and the commit-time check enforce. The two are independent — a fetch-only
 *   host is a deliberate category for traffic that never runs inside a
 *   gh-aw-fenced session, and promoting one to `"runtime"` needs its own
 *   evidence. That JSON's header carries the rule. TWO derived copies exist,
 *   neither hand-edited, both kept honest by
 *   check/fetch-allowlist-derived-copies-are-current.mts (`--fix` rewrites
 *   them): `allowDomains` in the JSON, the pre-v2 key a member on an older
 *   bundled hook still reads, and SNAPSHOT_HOSTS below. Read fresh per repo
 *   root, not imported as a static constant, because a hook process's cwd is
 *   not stable across callers (see repo-root.mts's header) — every consumer
 *   passes its own resolved repo root, or the loader falls back to the hook's
 *   own project path. Fails CLOSED, never OPEN, never a total block: a missing
 *   or unparseable JSON falls back to SNAPSHOT_HOSTS with a loud stderr warning
 *   naming the failure, so the guard still enforces SOMETHING every run. The
 *   allowlist holds ONLY public package-registry and public CDN hosts — the
 *   canonical registries every ecosystem advertises (crates.io, pypi.org, …)
 *   plus the browser CDNs a front-end's CSP already exposes. These are public
 *   knowledge, so the list is not sensitive: it is an allowlist, not a secret,
 *   and the enforcement, not the secrecy of the list, is the value. 🚨 NEVER
 *   add an internal host here. A naive `https://` grep of a Socket service repo
 *   surfaces `*.svc.cluster.local` Kubernetes service names (artifact-search,
 *   github-interposer, metadata, nats, pgbouncer, pipeline-gateway, svix,
 *   typosquat, …). Those are infra topology — a public-surface-hygiene
 *   violation if committed. Seed this list from the typed ecosystem-registry
 *   CONSTANTS that name fetch targets, never from a blanket URL grep, and keep
 *   it to public registries / public CDNs only.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { resolveProjectPath } from './paths.mts'
import { resolveRepoRoot } from './repo-root.mts'
import { findInvocation } from './shell-command.mts'

export const ALLOWLIST_REL = '.config/fleet/fetch-allowlist.json'

/**
 * Which consumer an entry is granted for. See the file header.
 */
export type AllowlistScope = 'fetch' | 'runtime'

export const ALLOWLIST_SCOPES: readonly AllowlistScope[] = ['fetch', 'runtime']

interface HostEntry {
  host?: unknown | undefined
  scopes?: unknown | undefined
}

interface AllowlistV2 {
  hosts?: unknown | undefined
}

export interface ScopedHosts {
  readonly hosts: readonly string[]
  readonly wildcards: readonly string[]
}

/**
 * Last-known-good host set per scope — the fail-closed fallback when the live
 * JSON is missing or malformed.
 *
 * DERIVED from `.config/fleet/fetch-allowlist.json`, never hand-edited:
 * `node scripts/fleet/check/fetch-allowlist-derived-copies-are-current.mts
 * --fix` regenerates it, and that gate fails when it drifts. It is inlined
 * rather than read at load time because the fallback's whole job is to work
 * when that read has already failed.
 */
// <generated:snapshot-hosts>
export const SNAPSHOT_HOSTS: Readonly<
  Record<AllowlistScope, readonly string[]>
> = {
  fetch: [
    'api.anthropic.com',
    'api.fireworks.ai',
    'api.github.com',
    'api.openai.com',
    'api.synthetic.new',
    'astral.sh',
    'avatars.githubusercontent.com',
    'badge.socket.dev',
    'claude.ai',
    'code.claude.com',
    'crates.io',
    'dl.google.com',
    'github.com',
    'go.dev',
    'nodejs.org',
    'pypi.org',
    'registry.npmjs.org',
    'sh.rustup.rs',
    'socketusercontent.com',
    'static.rust-lang.org',
  ],
  runtime: [
    '*.githubusercontent.com',
    'anthropic.com',
    'api.anthropic.com',
    'api.github.com',
    'avatars.githubusercontent.com',
    'codeload.github.com',
    'ghcr.io',
    'github-cloud.githubusercontent.com',
    'github.com',
    'lfs.github.com',
    'objects.githubusercontent.com',
    'pypi.org',
    'raw.githubusercontent.com',
    'registry.npmjs.org',
    'statsig.anthropic.com',
  ],
}
// </generated:snapshot-hosts>

function splitHostsAndWildcards(hosts: readonly string[]): ScopedHosts {
  const exact: string[] = []
  const wildcards: string[] = []
  for (let i = 0, { length } = hosts; i < length; i += 1) {
    const h = hosts[i]!
    if (h.startsWith('*.')) {
      wildcards.push(h)
    } else {
      exact.push(h)
    }
  }
  return { hosts: exact, wildcards }
}

// One parsed result per (scope, repo root) — a hook process is short-lived,
// but the guard and the check both call this more than once per run.
const CACHE = new Map<string, ScopedHosts>()

/**
 * Every host in `hosts[]` carrying `scope`, in file order. Pure — the parse
 * step, split out so the gate and the tests can drive it without I/O.
 */
export function hostsForScope(
  parsed: unknown,
  scope: AllowlistScope,
): string[] | undefined {
  const entries = (parsed as AllowlistV2 | undefined)?.hosts
  if (!Array.isArray(entries)) {
    return undefined
  }
  const out: string[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i] as HostEntry
    if (
      entry &&
      typeof entry.host === 'string' &&
      Array.isArray(entry.scopes) &&
      entry.scopes.includes(scope)
    ) {
      out.push(entry.host)
    }
  }
  return out
}

/**
 * The `scope`-granted hosts (exact + wildcard, split) for `repoRoot`, read
 * from `.config/fleet/fetch-allowlist.json`. Falls back to that scope's
 * `SNAPSHOT_HOSTS` — with a stderr warning naming why — on a missing file,
 * invalid JSON, or a `hosts` field that isn't an array of `{ host, scopes }`
 * objects. Never throws, never returns an empty set on failure (that would
 * fail OPEN).
 */
export function loadScopedHosts(
  scope: AllowlistScope,
  repoRoot: string,
): ScopedHosts {
  const cacheKey = `${scope} ${repoRoot}`
  const cached = CACHE.get(cacheKey)
  if (cached) {
    return cached
  }
  const settle = (result: ScopedHosts): ScopedHosts => {
    CACHE.set(cacheKey, result)
    return result
  }
  const fallback = (why: string): ScopedHosts => {
    process.stderr.write(`[fetch-allowlist] ${why}; using the snapshot.\n`)
    return settle(splitHostsAndWildcards(SNAPSHOT_HOSTS[scope]))
  }
  const filePath = path.join(repoRoot, ALLOWLIST_REL)
  let text: string
  try {
    text = readFileSync(filePath, 'utf8')
  } catch (e) {
    return fallback(`could not read ${ALLOWLIST_REL} at ${repoRoot} (${e})`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return fallback(`could not parse ${ALLOWLIST_REL} (${e})`)
  }
  const scoped = hostsForScope(parsed, scope)
  if (!scoped) {
    return fallback(`${ALLOWLIST_REL} has no "hosts" array`)
  }
  return settle(splitHostsAndWildcards(scoped))
}

/**
 * The runtime-scoped hosts for `repoRoot`, flat — what the gh-aw containment
 * gate compares against CI's firewall. Wildcards are included: a `*.suffix`
 * grant has to be contained too.
 */
export function loadRuntimeHosts(repoRoot: string): readonly string[] {
  const { hosts, wildcards } = loadScopedHosts('runtime', repoRoot)
  return [...hosts, ...wildcards]
}

// True when a hostname can only ever resolve to this machine. The guard exists
// to stop a fetch reaching an unvetted REMOTE host; a loopback name reaches
// nothing but a local process, so it is neither a supply-chain nor an
// exfiltration surface. `.localhost` is reserved for loopback by RFC 6761 and
// is how portless addresses local servers.
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]'
  )
}

/**
 * True when `hostname` exactly matches a fetch-scoped allowed host, or
 * matches an allowed wildcard suffix (`*.example.com` matches `a.example.com`
 * and `a.b.example.com`, but not the bare `example.com`). Compares
 * case-insensitively. Pass a bare hostname, not a URL. `repoRoot` defaults to
 * the hook's own project path for a caller with no better cwd signal —
 * pass the tool call's own resolved cwd when one is available (see the guard).
 */
export function isAllowedFetchHost(
  hostname: string,
  repoRoot: string = resolveRepoRoot(resolveProjectPath()),
): boolean {
  const host = hostname.toLowerCase()
  if (isLoopbackHost(host)) {
    return true
  }
  const { hosts, wildcards } = loadScopedHosts('fetch', repoRoot)
  for (let i = 0, { length } = hosts; i < length; i += 1) {
    if (host === hosts[i]) {
      return true
    }
  }
  for (let i = 0, { length } = wildcards; i < length; i += 1) {
    const suffix = wildcards[i]!.slice(1)
    if (host.endsWith(suffix) && host.length > suffix.length) {
      return true
    }
  }
  return false
}

// Extract the hostname from a URL string, or undefined when it doesn't parse.
export function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

// Find the first http(s) URL in a Bash command whose host is NOT fetch-
// allowed, returning { url, host }. Used by the guard. Only flags
// fetch/download tools (curl / wget / fetch) so unrelated URL mentions don't
// trip it. AST-matched binary detection, no regex on the command, then a URL
// scan of the string.
export interface DisallowedFetchHit {
  url: string
  host: string
}

const FETCH_BINARIES: readonly string[] = [
  'curl',
  'wget',
  'fetch',
  'http',
  'https',
]

const URL_RE = /https?:\/\/[^\s"'`)>\]]+/g

/**
 * `repoRoot` defaults to the hook's own project path; the guard passes the tool
 * call's own resolved cwd (see fetch-allowlist-is-respected-at-edit/index.mts)
 * since a hook process's cwd is not a reliable repo-root signal on its own.
 */
export function findDisallowedFetch(
  command: string,
  repoRoot: string = resolveRepoRoot(resolveProjectPath()),
): DisallowedFetchHit | undefined {
  let invokesFetch = false
  for (let i = 0, { length } = FETCH_BINARIES; i < length; i += 1) {
    if (findInvocation(command, { binary: FETCH_BINARIES[i]! })) {
      invokesFetch = true
      break
    }
  }
  if (!invokesFetch) {
    return undefined
  }
  const matches = command.match(URL_RE)
  if (!matches) {
    return undefined
  }
  for (let i = 0, { length } = matches; i < length; i += 1) {
    const url = matches[i]!
    const host = hostnameOf(url)
    if (host && !isAllowedFetchHost(host, repoRoot)) {
      return { url, host }
    }
  }
  return undefined
}
