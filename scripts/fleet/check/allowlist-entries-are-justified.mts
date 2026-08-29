#!/usr/bin/env node
/*
 * @file Every host in `.config/fleet/fetch-allowlist.json` carries a non-empty
 *   `reason` and a valid `scopes` list. An allowlist is a standing grant, and a
 *   grant nobody can explain is one nobody can revoke: the reason is what a
 *   later reader uses to decide whether the host is still needed, and without it
 *   the file only ever grows.
 *
 *   Deliberately NOT enforced: that a `fetch` host is also `egress`. Fetch does
 *   not imply egress. Thirteen hosts are fetch-only on purpose, because nothing
 *   enforces egress while `mode` is `"off"`, and granting egress to make an
 *   invariant tidy would widen a standing grant for no measured reason. Whether
 *   the two scopes should converge is a decision about flipping egress on, not a
 *   schema rule this check can settle.
 *
 *   `--fix` is not offered: a missing reason is knowledge the file cannot
 *   reconstruct, and a machine-written placeholder would satisfy the check while
 *   destroying the thing it exists to protect.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  ALLOWLIST_REL,
  ALLOWLIST_SCOPES,
} from '../../../.claude/hooks/fleet/_shared/fetch-allowlist.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

export interface AllowlistEntryFinding {
  readonly host: string
  readonly reason: string
}

/**
 * One finding per malformed host entry. Pure: the caller supplies the parsed
 * document, so the same function serves the check and its tests.
 */
export function scanAllowlistEntries(parsed: unknown): AllowlistEntryFinding[] {
  if (typeof parsed !== 'object' || parsed === null) {
    return [{ host: '<document>', reason: 'not a JSON object' }]
  }
  const hosts = (parsed as { hosts?: unknown | undefined }).hosts
  if (hosts === undefined) {
    return []
  }
  if (!Array.isArray(hosts)) {
    return [{ host: '<hosts>', reason: 'hosts is not an array' }]
  }
  const findings: AllowlistEntryFinding[] = []
  for (let i = 0, { length } = hosts; i < length; i += 1) {
    const entry = hosts[i] as Record<string, unknown> | undefined
    if (typeof entry !== 'object' || entry === null) {
      findings.push({ host: `hosts[${i}]`, reason: 'entry is not an object' })
      continue
    }
    const named = entry['host']
    const label =
      typeof named === 'string' && named.trim() ? named : `hosts[${i}]`
    if (typeof named !== 'string' || !named.trim()) {
      findings.push({ host: label, reason: 'host is missing or empty' })
    }
    const reason = entry['reason']
    if (typeof reason !== 'string' || !reason.trim()) {
      findings.push({
        host: label,
        reason: 'reason is missing or empty - name why the host is granted',
      })
    }
    const scopes = entry['scopes']
    if (!Array.isArray(scopes) || scopes.length === 0) {
      findings.push({
        host: label,
        reason: `scopes is missing or empty - one or more of ${ALLOWLIST_SCOPES.join(', ')}`,
      })
      continue
    }
    for (
      let j = 0, { length: scopesLength } = scopes;
      j < scopesLength;
      j += 1
    ) {
      const scope = scopes[j]
      if (
        typeof scope !== 'string' ||
        !ALLOWLIST_SCOPES.includes(scope as (typeof ALLOWLIST_SCOPES)[number])
      ) {
        findings.push({
          host: label,
          reason: `unknown scope ${JSON.stringify(scope)} - expected one of ${ALLOWLIST_SCOPES.join(', ')}`,
        })
      }
    }
  }
  return findings
}

function main(): number {
  const allowlistPath = path.join(REPO_ROOT, ALLOWLIST_REL)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(allowlistPath, 'utf8'))
  } catch {
    logger.log(
      `allowlist-entries-are-justified: ${ALLOWLIST_REL} absent or unreadable, nothing to check.`,
    )
    return 0
  }
  const findings = scanAllowlistEntries(parsed)
  if (findings.length === 0) {
    logger.success(
      'allowlist-entries-are-justified: every host carries a reason and valid scopes.',
    )
    return 0
  }
  logger.fail(
    `${findings.length} allowlist entr(ies) are unjustified or malformed:`,
  )
  logger.group()
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const finding = findings[i]!
    logger.error(`${finding.host} — ${finding.reason}`)
  }
  logger.groupEnd()
  logger.group()
  logger.info('What: a standing network grant nobody can explain.')
  logger.info(`Where: ${ALLOWLIST_REL}, the hosts[] entries above.`)
  logger.info(
    'Saw: a missing reason or an unknown scope; wanted every entry to name why it is granted and for which scope.',
  )
  logger.info(
    'Fix: write the reason a reader needs to decide whether the host is still required, by hand. A placeholder passes the check and defeats it.',
  )
  logger.groupEnd()
  return 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'check that every fetch-allowlist host carries a reason and valid scopes',
  help: `Usage: node scripts/fleet/check/allowlist-entries-are-justified.mts

  Reports any hosts[] entry in ${ALLOWLIST_REL} with no reason, no scopes, or an
  unknown scope. No --fix: a reason cannot be machine-written.`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
