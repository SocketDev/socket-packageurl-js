#!/usr/bin/env node
/**
 * @file One-shot fleet action: dismiss every open Dependabot alert whose
 *   `dependency.manifest_path` no longer exists on disk. A "go-thin"
 *   untrack, a deleted vendored tree, or a removed tool directory leaves the
 *   vulnerable file gone from the repo — but GitHub does not auto-close the
 *   alert for a plain path deletion in every manifest shape, so it sits open
 *   forever unless something dismisses it. This script does exactly that one
 *   job, deterministically, via the GitHub REST API — it does NOT touch an
 *   alert whose manifest still exists; those go through the AI-driven
 *   classify/fix/override pipeline in the `updating-security` skill instead.
 *   Dry run by default, printing what it would dismiss; `--apply` writes the
 *   dismissal. Gated to fleet-roster members via `gateWriteDest` — run this
 *   from inside the target repo's own checkout (each member has its own
 *   cascaded copy of this script, same as `janus.mts` /
 *   `external-tools/edit.mts`).
 *   Usage: node scripts/fleet/dismiss-stale-dependabot-alerts.mts [--apply]
 *   [--allow-non-member --reason <why>]
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import {
  gateWriteDest,
  parseNonMemberOverride,
} from './_shared/fleet-membership.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { REPO_ROOT } from './paths.mts'
import { runMain } from './_shared/run-main.mts'

import type { ScriptMeta } from './_shared/run-main.mts'

const logger = getDefaultLogger()

// GitHub's documented enum (repos/{owner}/{repo}/dependabot/alerts PATCH).
// `not_used` is the closest fit for "the vulnerable file is gone" — the
// vulnerable code is, by construction, not used.
const STALE_DISMISSAL_REASON = 'not_used'

export interface DependabotAlert {
  readonly number: number
  readonly dependency: {
    readonly manifest_path: string
    readonly package: { readonly ecosystem: string; readonly name: string }
  }
  readonly security_advisory: { readonly ghsa_id: string }
}

interface GhAnswer {
  readonly ok: boolean
  readonly stdout: string
  readonly stderr: string
}

// One `gh` call, exit code + both streams preserved. Sync: this is a
// straight-line CLI script with no concurrent work to overlap.
// oxlint-disable-next-line socket/prefer-async-spawn -- sync CLI
function gh(args: readonly string[]): GhAnswer {
  const result = spawnSync('gh', args as string[], { encoding: 'utf8' })
  return {
    ok: result.status === 0,
    stderr: String(result.stderr ?? ''),
    stdout: String(result.stdout ?? ''),
  }
}

/**
 * The `{owner, repo}` GitHub identifies the current checkout as, or
 * `undefined` when `gh` can't answer (not a GitHub remote, not authed).
 */
export function resolveOwnerRepo():
  | { readonly owner: string; readonly repo: string }
  | undefined {
  const answer = gh(['repo', 'view', '--json', 'owner,name'])
  if (!answer.ok) {
    return undefined
  }
  try {
    const parsed = JSON.parse(answer.stdout) as {
      name: string
      owner: { login: string }
    }
    return { owner: parsed.owner.login, repo: parsed.name }
  } catch {
    return undefined
  }
}

/**
 * Every open Dependabot alert on `owner/repo`, or `[]` on any read failure —
 * a failed read must never read as "no alerts."
 */
export function fetchOpenAlerts(
  owner: string,
  repo: string,
): DependabotAlert[] {
  const answer = gh([
    'api',
    `repos/${owner}/${repo}/dependabot/alerts?state=open`,
    '--paginate',
  ])
  if (!answer.ok) {
    throw new Error(
      `Where: gh api repos/${owner}/${repo}/dependabot/alerts\n` +
        `  Saw: ${answer.stderr.trim() || 'non-zero exit'}\n` +
        '  Wanted: the open-alerts JSON array\n' +
        '  Fix: `gh auth status`; confirm the token has security_events:read.',
    )
  }
  return JSON.parse(answer.stdout) as DependabotAlert[]
}

/**
 * Does `manifestPath` exist on disk under `repoRoot`? Checked against the
 * real filesystem, NOT `git cat-file -e HEAD:...` — a fleet dep-0 payload
 * (`.claude/hooks/fleet/setup-security-tools/*`) is untracked-by-default
 * (gitignored, fetched on install) yet genuinely present and vulnerable; a
 * git-tracked check would misclassify every one of those as stale. A
 * missing path on disk is the only signal this script trusts.
 */
export function manifestExistsOnDisk(
  manifestPath: string,
  repoRoot: string,
): boolean {
  return existsSync(path.join(repoRoot, manifestPath))
}

/**
 * GitHub caps `dismissed_comment` at 280 characters. Truncate rather than
 * fail the whole dismissal over a long manifest path.
 */
export function dismissComment(alert: DependabotAlert): string {
  const text =
    `${alert.dependency.manifest_path} no longer exists on disk; the ` +
    'vulnerable dependency is not present. Dismissed as stale by ' +
    'scripts/fleet/dismiss-stale-dependabot-alerts.mts.'
  return text.length > 280 ? `${text.slice(0, 277)}...` : text
}

/**
 * PATCH one alert to `dismissed`. Returns whether the API call succeeded —
 * never throws, so one failed dismissal doesn't abort the rest of the batch.
 */
export function dismissAlert(
  owner: string,
  repo: string,
  alert: DependabotAlert,
): boolean {
  const answer = gh([
    'api',
    '-X',
    'PATCH',
    `repos/${owner}/${repo}/dependabot/alerts/${alert.number}`,
    '-f',
    'state=dismissed',
    '-f',
    `dismissed_reason=${STALE_DISMISSAL_REASON}`,
    '-f',
    `dismissed_comment=${dismissComment(alert)}`,
  ])
  return answer.ok
}

function alertLabel(alert: DependabotAlert): string {
  return (
    `#${alert.number} ${alert.dependency.package.ecosystem}/` +
    `${alert.dependency.package.name} (${alert.dependency.manifest_path})`
  )
}

export async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const apply = argv.includes('--apply')

  const gate = gateWriteDest({
    destDir: REPO_ROOT,
    override: parseNonMemberOverride(argv),
    toolName: 'dismiss-stale-dependabot-alerts',
  })
  if (!gate.allowed) {
    logger.error(gate.message)
    return 1
  }
  if (gate.note) {
    logger.log(gate.note)
  }

  const ownerRepo = resolveOwnerRepo()
  if (!ownerRepo) {
    logger.error(
      'Where: gh repo view --json owner,name\n' +
        '  Saw: gh call failed or returned unparsable JSON\n' +
        '  Wanted: {owner, name}\n' +
        '  Fix: run from inside a GitHub-hosted checkout with `gh auth status` green.',
    )
    return 1
  }
  const { owner, repo } = ownerRepo

  const alerts = fetchOpenAlerts(owner, repo)
  if (alerts.length === 0) {
    logger.log(`${owner}/${repo}: no open Dependabot alerts.`)
    return 0
  }

  const stale = alerts.filter(
    a => !manifestExistsOnDisk(a.dependency.manifest_path, REPO_ROOT),
  )
  if (stale.length === 0) {
    logger.log(
      `${owner}/${repo}: ${alerts.length} open alert(s), none stale. ` +
        'Every manifest still exists on disk.',
    )
    return 0
  }

  let failed = 0
  for (let i = 0, { length } = stale; i < length; i += 1) {
    const alert = stale[i]!
    if (!apply) {
      logger.log(`[dry-run] would dismiss ${alertLabel(alert)}`)
      continue
    }
    const ok = dismissAlert(owner, repo, alert)
    logger.log(`${ok ? 'dismissed' : 'FAILED to dismiss'} ${alertLabel(alert)}`)
    if (!ok) {
      failed += 1
    }
  }
  if (!apply) {
    logger.log('Dry run. Pass --apply to write.')
  }
  return failed > 0 ? 1 : 0
}

export const SCRIPT_META: ScriptMeta = {
  describe:
    'dismiss open Dependabot alerts whose manifest_path no longer exists on disk',
  help: 'Usage: node scripts/fleet/dismiss-stale-dependabot-alerts.mts [--apply] [--allow-non-member --reason <why>]',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
