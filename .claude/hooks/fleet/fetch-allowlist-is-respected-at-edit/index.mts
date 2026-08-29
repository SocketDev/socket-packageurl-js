/**
 * @file Claude Code PreToolUse(Bash) hook —
 *   fetch-allowlist-is-respected-at-edit. Blocks a `curl` / `wget` / `fetch` to
 *   a host that isn't on the fleet's public-CDN / package-registry allowlist.
 *   Fetching from an arbitrary host mid-task is a supply-chain + exfiltration
 *   surface; the fleet pins fetches to approved public registries (crates.io,
 *   pypi.org, …) and public CDNs. All allowlist logic lives in
 *   _shared/fetch-allowlist.mts — the SAME module the commit-time check
 *   consumes, so the two never drift (code is law, DRY). The allowlist holds
 *   ONLY public hosts; an internal `*.svc.cluster.local` host is never on it,
 *   and a fetch to one is correctly blocked. AST-parses the command via
 *   shell-command.mts/findInvocation, per the no-command-regex-in-hooks rule to
 *   detect the fetch binary, then scans the command's URLs. Bypass: `Allow
 *   fetch-allowlist bypass` in a recent user turn. Exit codes: 0 — pass; 2 —
 *   block. Fails open on any throw.
 */

import { findDisallowedFetch } from '../_shared/fetch-allowlist.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { resolveProjectPath } from '../_shared/paths.mts'
import { resolveRepoRoot } from '../_shared/repo-root.mts'
import { verdictLine } from '../_shared/verdict.mts'

export const check = bashGuard((command, payload) => {
  const repoRoot = resolveRepoRoot(resolveProjectPath(payload.cwd))
  const hit = findDisallowedFetch(command, repoRoot)
  if (!hit) {
    return undefined
  }
  return block(
    [
      verdictLine(
        'block',
        'fetch-allowlist-is-respected-at-edit',
        `fetch to off-allowlist host \`${hit.host}\` - supply-chain + exfil surface.`,
      ),
      `URL: ${hit.url}`,
      'Fix: fetch from an allowlisted registry/CDN, or add a PUBLIC "fetch"-scoped host to .config/fleet/fetch-allowlist.json.',
      '',
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['fetch-allowlist'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
