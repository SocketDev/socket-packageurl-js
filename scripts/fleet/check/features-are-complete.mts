#!/usr/bin/env node
/*
 * @file Fleet check — new exports have corresponding tests and check scripts.
 *   Verifies:
 *
 *   1. Every exported function in _shared/*.mts has test coverage
 *   2. Every check script is wired into preflight.mts
 *   3. Coverage thresholds are not dropped This enforces the feature-completeness
 *      rule: a feature is not done until it has code-as-law enforcement, tests,
 *      and preflight wiring.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { globSync } from '@socketsecurity/lib-stable/globs/match'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { loadSocketWheelhouseConfig, REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

interface CheckResult {
  name: string
  passed: boolean
  message: string
  /**
   * The raw offending set, when the criterion has one. Carried so the baseline
   * writer records the same list the criterion measured rather than re-deriving
   * it and risking a different answer.
   */
  untested?: string[] | undefined
}

/**
 * The names a module exports as a top-level `function`, `async function`, or
 * `const`. Pure over the file's text - exported for tests.
 */
export function findExportedFunctions(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf8')
  const exports: string[] = []

  // Matches a top-level `export function` or `export async function`
  // declaration and captures the function name.
  const functionExportRe = /^export\s+(?:async\s+)?function\s+(\w+)/gm
  let match: RegExpExecArray | null
  while ((match = functionExportRe.exec(content)) !== null) {
    exports.push(match[1]!)
  }

  const constExportRe = /^export\s+const\s+(\w+)\s*=/gm
  while ((match = constExportRe.exec(content)) !== null) {
    exports.push(match[1]!)
  }

  return exports
}

/**
 * Every `_shared` module basename some test file imports.
 *
 * Detection is by IMPORT, not by filename, matching what
 * check/tests-are-mirror-named.mts already does. A filename comparison cannot
 * answer this question: the fleet's tests are named for the SOURCE they cover,
 * which is frequently a check or a hook rather than the `_shared` module that
 * check leans on, so a covered module looks untested. Worse, the old heuristic
 * fell back to a substring match (`names.some(n => n.includes(baseName))`),
 * which both passed modules nothing tested — any longer test name containing
 * the module's name satisfied it — and reported 13 covered modules as untested.
 *
 * Pure over the given texts so the arm is testable without a repo walk.
 */
export function importedSharedModules(
  testTexts: readonly string[],
): Set<string> {
  const imported = new Set<string>()
  const importRe = /from '[^']*scripts\/fleet\/_shared\/([\w.-]+)\.mts'/gu
  for (let i = 0, { length } = testTexts; i < length; i += 1) {
    for (const match of testTexts[i]!.matchAll(importRe)) {
      imported.add(match[1]!)
    }
  }
  return imported
}

function readTestTexts(): string[] {
  const testFiles = globSync('test/**/*.test.mts', { cwd: REPO_ROOT })
  const out: string[] = []
  for (let i = 0, { length } = testFiles; i < length; i += 1) {
    try {
      out.push(readFileSync(path.join(REPO_ROOT, testFiles[i]!), 'utf8'))
    } catch {
      // Unreadable test file — the lint gate owns that failure.
    }
  }
  return out
}

/**
 * The grandfathered `_shared` module list from the member config's
 * `sharedModuleTests` section, empty when absent so a repo with no enrollment
 * holds every module to the contract.
 *
 * A ratchet rather than a threshold, matching its sibling
 * `entry-scripts-are-born-tested`: the criterion is binary, so without one a
 * repo carrying pre-contract debt can never pass and the gate stops meaning
 * anything. Recording the current set keeps a NEW untested module failing while
 * the backlog burns down.
 */
export function grandfatheredSharedModules(
  options?: { repoRoot?: string | undefined } | undefined,
): string[] {
  const { repoRoot = REPO_ROOT } = {
    __proto__: null,
    ...options,
  } as { repoRoot?: string | undefined }
  const config = loadSocketWheelhouseConfig(repoRoot)
  const section = config?.value['sharedModuleTests']
  if (typeof section !== 'object' || section === null) {
    return []
  }
  const list = (section as Record<string, unknown>)['grandfathered']
  return Array.isArray(list) ? list.filter(f => typeof f === 'string') : []
}

function checkSharedModulesHaveTests(): CheckResult {
  const sharedDir = path.join(REPO_ROOT, 'scripts', 'fleet', '_shared')
  if (!existsSync(sharedDir)) {
    const templateSharedDir = path.join(
      REPO_ROOT,
      'template',
      'base',
      'scripts',
      'fleet',
      '_shared',
    )
    if (!existsSync(templateSharedDir)) {
      return {
        name: '_shared modules have tests',
        passed: true,
        message: 'No _shared directory found — skipped',
      }
    }
  }

  const imported = importedSharedModules(readTestTexts())
  // One entry per MODULE, not per copy on disk. The live tree and template/base
  // hold the same module list (the cascade keeps them byte-identical), so
  // globbing both and not deduping double-counted every finding — 14 uncovered
  // modules reported as 28.
  const byModule = new Map<string, string>()
  for (const pattern of [
    'scripts/fleet/_shared/*.mts',
    'template/base/scripts/fleet/_shared/*.mts',
  ]) {
    for (const rel of globSync(pattern, { cwd: REPO_ROOT })) {
      const baseName = path.basename(rel, '.mts')
      if (baseName !== 'index' && !byModule.has(baseName)) {
        byModule.set(baseName, rel)
      }
    }
  }

  const grandfathered = new Set(grandfatheredSharedModules())
  const untestedModules: string[] = []
  const untestedBaseNames: string[] = []
  for (const [baseName, rel] of byModule) {
    if (imported.has(baseName) || grandfathered.has(baseName)) {
      continue
    }
    const exports = findExportedFunctions(path.join(REPO_ROOT, rel))
    if (exports.length > 0) {
      untestedModules.push(`${baseName} (${exports.length} exports)`)
      untestedBaseNames.push(baseName)
    }
  }
  const sharedFiles = [...byModule.keys()]

  if (untestedModules.length > 0) {
    return {
      name: '_shared modules have tests',
      passed: false,
      message: `Untested modules: ${untestedModules.slice(0, 5).join(', ')}${untestedModules.length > 5 ? ` (+${untestedModules.length - 5} more)` : ''}`,
      // The bare module names, not the "(N exports)" display strings.
      untested: untestedBaseNames,
    }
  }

  return {
    name: '_shared modules have tests',
    passed: true,
    message: `All ${sharedFiles.length} _shared modules have test coverage`,
  }
}

function checkCheckScriptsInPreflight(): CheckResult {
  const preflightPath = path.join(
    REPO_ROOT,
    'scripts',
    'fleet',
    'preflight.mts',
  )
  const templatePreflightPath = path.join(
    REPO_ROOT,
    'template',
    'base',
    'scripts',
    'fleet',
    'preflight.mts',
  )

  const actualPath = existsSync(preflightPath)
    ? preflightPath
    : templatePreflightPath

  if (!existsSync(actualPath)) {
    return {
      name: 'Check scripts wired in preflight',
      passed: true,
      message: 'No preflight.mts found — skipped',
    }
  }

  const preflightContent = readFileSync(actualPath, 'utf8')

  const checkDir = path.join(REPO_ROOT, 'scripts', 'fleet', 'check')
  const templateCheckDir = path.join(
    REPO_ROOT,
    'template',
    'base',
    'scripts',
    'fleet',
    'check',
  )

  const checkScripts = [
    ...(existsSync(checkDir) ? readdirSync(checkDir) : []),
    ...(existsSync(templateCheckDir) ? readdirSync(templateCheckDir) : []),
  ].filter(f => f.endsWith('.mts'))

  const criticalChecks = [
    'training-models-respect-visibility.mts',
    'coverage-thresholds-are-ratcheted.mts',
  ]

  const unwiredCritical: string[] = []
  for (let i = 0, { length } = criticalChecks; i < length; i += 1) {
    const check = criticalChecks[i]!
    if (checkScripts.includes(check)) {
      if (!preflightContent.includes(check)) {
        unwiredCritical.push(check)
      }
    }
  }

  if (unwiredCritical.length > 0) {
    return {
      name: 'Critical check scripts wired in preflight',
      passed: false,
      message: `Unwired critical checks: ${unwiredCritical.join(', ')}`,
    }
  }

  return {
    name: 'Critical check scripts wired in preflight',
    passed: true,
    message: 'All critical checks are wired',
  }
}

function checkCoverageNotDropped(): CheckResult {
  const coverageConfigPath = path.join(
    REPO_ROOT,
    '.config',
    'repo',
    'coverage.json',
  )
  if (!existsSync(coverageConfigPath)) {
    return {
      name: 'Coverage thresholds maintained',
      passed: true,
      message: 'No coverage config found — skipped',
    }
  }

  let config: {
    thresholds?:
      | { lines?: number | undefined; branches?: number | undefined }
      | undefined
  }
  try {
    config = JSON.parse(readFileSync(coverageConfigPath, 'utf8'))
  } catch {
    return {
      name: 'Coverage thresholds maintained',
      passed: true,
      message: 'Coverage config not parseable — skipped',
    }
  }

  const lines = config.thresholds?.lines ?? 0
  const branches = config.thresholds?.branches ?? 0

  if (lines < 80) {
    return {
      name: 'Coverage thresholds maintained',
      passed: false,
      message: `Line coverage threshold (${lines}%) is below 80% target`,
    }
  }

  return {
    name: 'Coverage thresholds maintained',
    passed: true,
    message: `Lines: ${lines}%, Branches: ${branches}%`,
  }
}

/**
 * Rewrite `sharedModuleTests.grandfathered` to exactly the currently-untested
 * set. The enrollment run and the ratchet are one operation, so re-running it
 * after adding tests SHRINKS the list rather than needing a separate prune.
 *
 * Returns the written list, or undefined when the repo has no config to hold
 * it.
 */
export function updateSharedModuleBaseline(
  options?: { repoRoot?: string | undefined } | undefined,
): string[] | undefined {
  const { repoRoot = REPO_ROOT } = {
    __proto__: null,
    ...options,
  } as { repoRoot?: string | undefined }
  const config = loadSocketWheelhouseConfig(repoRoot)
  if (!config) {
    return undefined
  }
  // Re-measure with no baseline applied, so the write records the real set
  // rather than the set minus whatever is already recorded.
  const previous = config.value['sharedModuleTests']
  delete (config.value as Record<string, unknown>)['sharedModuleTests']
  const result = checkSharedModulesHaveTests()
  if (previous !== undefined) {
    ;(config.value as Record<string, unknown>)['sharedModuleTests'] = previous
  }
  const grandfathered = (result.untested ?? []).toSorted()
  const next = { ...config.value, sharedModuleTests: { grandfathered } }
  writeFileSync(config.location.path, `${JSON.stringify(next, null, 2)}\n`)
  return grandfathered
}

export function featuresAreComplete(): {
  passed: boolean
  results: CheckResult[]
} {
  const results: CheckResult[] = [
    checkSharedModulesHaveTests(),
    checkCheckScriptsInPreflight(),
    checkCoverageNotDropped(),
  ]

  const passed = results.every(r => r.passed)
  return { passed, results }
}

async function main(): Promise<void> {
  if (process.argv.includes('--update-baseline')) {
    const written = updateSharedModuleBaseline()
    logger.info(
      written === undefined
        ? 'features-are-complete: no repo config to hold the baseline.'
        : `features-are-complete: baseline updated - ${written.length} grandfathered _shared module(s).`,
    )
    return
  }
  const quiet = process.argv.includes('--quiet')
  const { passed, results } = featuresAreComplete()

  if (!quiet) {
    for (const result of results) {
      const icon = result.passed ? '✓' : '✗'
      logger.info(`  ${icon} ${result.name}: ${result.message}`)
    }
  }

  if (!passed) {
    const failed = results.filter(r => !r.passed)
    if (quiet) {
      logger.error(`features-are-complete: ${failed.length} check(s) failed`)
    }
    process.exitCode = 1
    return
  }

  if (!quiet) {
    logger.info('features-are-complete: all checks passed')
  }
}

const SCRIPT_META: ScriptMeta = {
  describe: 'Verify features have tests, checks, and coverage',
  help: 'Checks _shared modules have tests, critical checks are in preflight',
}

if (isMainModule(import.meta.url)) {
  void runMain(main, SCRIPT_META)
}
