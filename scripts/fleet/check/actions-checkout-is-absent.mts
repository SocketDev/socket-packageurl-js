/*
 * @file Fleet policy: no workflow uses the third-party `actions/checkout`
 *   action. The fleet inlines its checkout — a bootstrap git-fetch shell step
 *   (see release-reconcile.yml) before any `./.github/actions/fleet/checkout`
 *   composite, because a local composite cannot run before the repo is checked
 *   out. Reaching for `actions/checkout@<sha>` instead is the regression this
 *   gate prevents: it re-introduces a third-party action the fleet deliberately
 *   ports away from, and on a fresh runner it masks the bootstrap-order bug.
 *   The composite is not found until after a checkout that never runs. Usage:
 *   node scripts/fleet/check/actions-checkout-is-absent.mts.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github', 'workflows')
// `uses: actions/checkout@<sha>` — the third-party action the fleet ports
// away from. The inline bootstrap + `./.github/actions/fleet/checkout`
// composite replace it.
const ACTIONS_CHECKOUT_RE = /^\s*(?:-\s*)?uses:\s+actions\/checkout@/

/**
 * The workflow files that reference `actions/checkout@`, as `file:line`
 * entries. Pure filesystem scan. Empty when the tree is compliant.
 */
export function findActionsCheckoutUses(
  options?: { workflowsDir?: string | undefined } | undefined,
): string[] {
  const { workflowsDir = WORKFLOWS_DIR } = {
    __proto__: null,
    ...options,
  } as NonNullable<typeof options>
  if (!readdirSync(workflowsDir, { withFileTypes: true }).length) {
    return []
  }
  const hits: string[] = []
  const entries = readdirSync(workflowsDir, { withFileTypes: true })
    .filter(
      e => e.isFile() && (e.name.endsWith('.yml') || e.name.endsWith('.yaml')),
    )
    .map(e => e.name)
    .toSorted()
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    const abs = path.join(workflowsDir, name)
    const lines = readFileSync(abs, 'utf8')
      .replace(/\r\n/g, '\n')
      .split(/\r?\n/)
    for (let li = 0, lineCount = lines.length; li < lineCount; li += 1) {
      if (ACTIONS_CHECKOUT_RE.test(lines[li]!)) {
        hits.push(`${name}:${li + 1}`)
      }
    }
  }
  return hits
}

function runCheck(): number {
  const hits = findActionsCheckoutUses()
  if (hits.length === 0) {
    return 0
  }
  logger.fail(
    [
      '[actions-checkout-is-absent] Workships use the third-party actions/checkout.',
      '',
      '  Fleet policy: inline the checkout — a bootstrap git-fetch shell step',
      '  before ./.github/actions/fleet/checkout (see release-reconcile.yml),',
      '  because a local composite cannot run before the repo is checked out.',
      '  Offenders:',
      ...hits.map(h => `    - .github/workflows/${h}`),
    ].join('\n'),
  )
  return 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'fails when any .github/workflows/*.yml uses the third-party actions/checkout action',
  help: 'Usage: node scripts/fleet/check/actions-checkout-is-absent.mts',
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(runCheck, SCRIPT_META)
}
/* c8 ignore stop */
