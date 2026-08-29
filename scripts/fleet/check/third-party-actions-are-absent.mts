#!/usr/bin/env node
/*
 * @file CI gate: no workflow in the repo uses a third-party GitHub Action.
 *   Every `uses:` ref must be a local composite (`./.github/actions/...`) or a
 *   container image (`docker://...`); a `uses: <owner>/<repo>@<sha>` is a
 *   third-party action the fleet replaced with an inline port, and this check
 *   refuses it. Wheelhouse-repo-only is NOT enough — the check cascades and
 *   runs in every member, so a member that re-introduces a third-party action
 *   goes red.
 *
 *   Auto-discovered from scripts/fleet/check/ by `check --all`.
 *   Exit codes: 0 — every `uses:` is local or a container image; 1 — a
 *   third-party action ref is present.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { gitSync } from '../_shared/git-exec.mts'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

/**
 * Tracked `.github/workflows/*.yml` files. These are the workflows that
 * actually run. Uses `git ls-files` so untracked draft workflows are not
 * scanned.
 */
export function trackedWorkflowFiles(cwd: string): string[] {
  const result = gitSync(['ls-files', '-z', '.github/workflows'], {
    cwd,
  })
  if (result.status !== 0) {
    return []
  }
  return String(result.stdout ?? '')
    .split('\0')
    .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
}

/**
 * The `uses:` refs in a workflow file's text. Pure over the file content.
 */
export function extractUsesRefs(content: string): string[] {
  const refs: string[] = []
  const lines = content.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const m = /^\s*uses:\s*(\S+)\s*$/.exec(lines[i]!)
    if (m) {
      refs.push(m[1]!)
    }
  }
  return refs
}

/**
 * True when a `uses:` ref is allowed: a local composite (`./...`) or a
 * container image (`docker://...`). Everything else is a third-party action.
 */
export function isAllowedRef(ref: string): boolean {
  return ref.startsWith('./') || ref.startsWith('docker://')
}

/**
 * Violations in one workflow file: the `uses:` refs that are not local and not
 * a container image. Pure over the injected content.
 */
export function scanWorkflow(content: string, file: string): string[] {
  const refs = extractUsesRefs(content)
  const violations: string[] = []
  for (const ref of refs) {
    if (!isAllowedRef(ref)) {
      violations.push(
        `${file}: uses: ${ref} - third-party action; use a fleet inline composite under .github/actions/fleet/ instead.`,
      )
    }
  }
  return violations
}

export function main(): void {
  const cwd = '.'
  const files = trackedWorkflowFiles(cwd)
  const violations: string[] = []
  for (const file of files) {
    let content: string
    try {
      content = readFileSync(path.join(cwd, file), 'utf8')
    } catch {
      continue
    }
    violations.push(...scanWorkflow(content, file))
  }
  if (violations.length > 0) {
    for (let i = 0, { length } = violations; i < length; i += 1) {
      logger.fail(violations[i]!)
    }
    logger.error('')
    logger.error(
      `${violations.length} third-party action ref(s) found. The fleet replaces every action with an inline port under .github/actions/fleet/.`,
    )
    process.exitCode = 1
    return
  }
  logger.log(
    'no-third-party-actions: every workflow uses: ref is local or a container image.',
  )
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'refuses any third-party GitHub Action ref in a workflow (every uses: must be a local composite or docker://)',
  help: `Usage: node scripts/fleet/check/no-third-party-actions.mts

Scans .github/workflows/*.yml for \`uses:\` refs that are not local composites
(./...) or container images (docker://). A third-party \`uses: <owner>/<repo>@<sha>\`
is a violation. Auto-discovered by \`check --all\`.`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
