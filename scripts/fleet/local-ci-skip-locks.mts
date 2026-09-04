/*
 * @file Thin pass-through wrapper around Local CI (package: run-local-ci,
 *   binary: local-ci) that guards the one input it cannot handle: a gh-aw
 *   compiled `*.lock.yml`. Local CI parses workflows with GitHub's own
 *   `@actions/workflow-parser` (still a real dependency of run-local-ci, not
 *   replaced by the local emulation layer), whose `convertWorkflowTemplate`
 *   crashes on the gh-aw agent-runtime jobs (the `agent` / `conclusion` /
 *   `detection` jobs reference `inputs.aw_context` and the gh-aw container
 *   steps), so it returns a template with no `.jobs` and Local CI aborts
 *   every task with the cryptic `No jobs found in workflow`. gh-aw workflows
 *   are exercised with `gh aw trial`, an isolated trial repo, never Local CI
 *   — see docs/fleet/agents.md/shared-workflow-cascade.md. This wrapper
 *   makes that boundary legible instead of cryptic:
 *
 *   - An explicit `--workflow <X>.lock.yml` target exits with an informative
 *     error, the verified crash case — the reader is told to use `gh aw
 *     trial`.
 *   - In discovery mode (`--all`), it forwards to Local CI unchanged but first
 *     prints a one-line note for any `*.lock.yml` present in
 *     `.github/workflows/` so a surfaced skip/crash reads as expected, not
 *     mysterious. Everything else (args, stdio, exit code) passes through
 *     verbatim, so the wrapper is a drop-in for the canonical `ci:local`
 *     command.
 */

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { whichLocalBin } from '@socketsecurity/lib-stable/exe/path/which'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from './paths.mts'

const isWin32 = process.platform === 'win32'
const logger = getDefaultLogger()

// Resolve the workspace-local bin first: a bare-PATH lookup outside `pnpm run
// ci:local` can pick a wrong or global local-ci, and `local-ci` is a
// devDependency with no global install, so a missed resolve does not degrade
// to a slower path - it dies `ENOENT`.
//
// `whichLocalBin` is the helper for exactly this: it searches
// <cwd>/node_modules/.bin, returns the platform-correct entry (the .cmd/.exe
// shim on Windows, the symlink on POSIX), and falls back to PATH. The
// hand-rolled version here walked `dirname` twice from this FILE and landed on
// <root>/scripts, whose node_modules/.bin does not exist, so every resolve
// missed silently.
const LOCAL_CI_BIN = whichLocalBin('local-ci', { cwd: REPO_ROOT }) ?? 'local-ci'
const WORKFLOWS_DIR = path.join('.github', 'workflows')
const TRIAL_HINT =
  'gh-aw compiled .lock.yml workflows are not Local-CI-simulatable ' +
  '(GitHub’s @actions/workflow-parser crashes on their agent-runtime jobs). ' +
  'Exercise them with `gh aw trial <workflow>.md` against an isolated trial ' +
  'repo instead. See docs/fleet/agents.md/shared-workflow-cascade.md.'

export function logTrialHint(): void {
  logger.error(TRIAL_HINT)
}

export function isLockYmlTarget(value: string | undefined): boolean {
  return typeof value === 'string' && value.endsWith('.lock.yml')
}

/**
 * Pull the value passed to `--workflow` / `-w`, supporting both `--workflow
 * path` and `--workflow=path` forms.
 */
export function extractWorkflowTarget(argv: string[]): string | undefined {
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--workflow' || arg === '-w') {
      return argv[i + 1]
    }
    if (arg.startsWith('--workflow=')) {
      return arg.slice('--workflow='.length)
    }
    if (arg.startsWith('-w=')) {
      return arg.slice('-w='.length)
    }
  }
  return undefined
}

export function listLockYmls(workflowsDir: string): string[] {
  if (!existsSync(workflowsDir)) {
    return []
  }
  return readdirSync(workflowsDir)
    .filter(name => name.endsWith('.lock.yml'))
    .toSorted()
}

export async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const target = extractWorkflowTarget(argv)

  // Verified crash case: an explicit .lock.yml target. Fail loudly + usefully
  // rather than letting Local CI throw `No jobs found`.
  if (isLockYmlTarget(target)) {
    logger.error(`Local CI cannot run the gh-aw lock file ${target}.`)
    logTrialHint()
    return 1
  }

  // Discovery mode: note any gh-aw locks so a surfaced skip/crash is expected.
  const isDiscovery = argv.includes('--all') || argv.includes('-a')
  if (isDiscovery) {
    const locks = listLockYmls(WORKFLOWS_DIR)
    if (locks.length) {
      logger.warn(
        `Skipping ${locks.length} gh-aw lock file(s) Local CI cannot parse: ` +
          `${locks.join(', ')}.`,
      )
      logger.warn(TRIAL_HINT)
    }
  }

  const result = await spawn(LOCAL_CI_BIN, argv, {
    shell: isWin32,
    stdio: 'inherit',
  })
  return result.code ?? 1
}

if (process.argv[1]?.endsWith('local-ci-skip-locks.mts')) {
  void (async () => {
    process.exitCode = await main()
  })()
}
