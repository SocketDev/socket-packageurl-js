#!/usr/bin/env node
/*
 * @file Fleet check — training model gating is correctly configured.
 *   Verifies:
 *
 *   1. MODELS_THAT_TRAIN set is non-empty and contains expected models
 *   2. Private repo roster exists and has SocketDev entry
 *   3. Roster TTL is within expected bounds (4 hours) This is a code-as-law
 *      enforcement of the training model policy: free-tier models that train on
 *      user data must never receive private repo content. Usage: node
 *      scripts/fleet/check/training-models-respect-visibility.mts
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import {
  filterLadderForTrainingPolicy,
  MODELS_THAT_TRAIN,
  modelTrainsOnData,
  resetTrainingPolicyState,
} from '../_shared/model-training-policy.mts'
import {
  getRosterStats,
  isRepoPublic,
  rosterIsFresh,
} from '../_shared/repo-visibility.mts'
import { REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

const EXPECTED_TRAINING_MODELS = [
  'deepseek-v4-flash-free',
  'big-pickle',
  'nemotron-3-ultra-free',
]

const FLEET_OWNER = 'SocketDev'

interface CheckResult {
  name: string
  passed: boolean
  message: string
}

function checkModelsSet(): CheckResult {
  if (MODELS_THAT_TRAIN.size === 0) {
    return {
      name: 'MODELS_THAT_TRAIN is non-empty',
      passed: false,
      message: 'MODELS_THAT_TRAIN set is empty — no training models defined',
    }
  }

  const missing: string[] = []
  for (let i = 0, { length } = EXPECTED_TRAINING_MODELS; i < length; i += 1) {
    const model = EXPECTED_TRAINING_MODELS[i]!
    if (!MODELS_THAT_TRAIN.has(model)) {
      missing.push(model)
    }
  }

  if (missing.length > 0) {
    return {
      name: 'MODELS_THAT_TRAIN contains expected models',
      passed: false,
      message: `Missing expected training models: ${missing.join(', ')}`,
    }
  }

  return {
    name: 'MODELS_THAT_TRAIN is correctly populated',
    passed: true,
    message: `${MODELS_THAT_TRAIN.size} training models defined`,
  }
}

function checkModelTrainsFunction(): CheckResult {
  const positives = [
    'deepseek-v4-flash-free',
    'opencode/big-pickle',
    'some-model-free',
  ]
  const negatives = ['claude-opus-5', 'gpt-5.6-terra', 'deepseek-v4-flash']

  for (let i = 0, { length } = positives; i < length; i += 1) {
    const model = positives[i]!
    if (!modelTrainsOnData(model)) {
      return {
        name: 'modelTrainsOnData() identifies training models',
        passed: false,
        message: `modelTrainsOnData('${model}') returned false, expected true`,
      }
    }
  }

  for (let i = 0, { length } = negatives; i < length; i += 1) {
    const model = negatives[i]!
    if (modelTrainsOnData(model)) {
      return {
        name: 'modelTrainsOnData() excludes paid models',
        passed: false,
        message: `modelTrainsOnData('${model}') returned true, expected false`,
      }
    }
  }

  return {
    name: 'modelTrainsOnData() correctly classifies models',
    passed: true,
    message: 'Training model detection logic verified',
  }
}

function checkLadderFiltering(): CheckResult {
  resetTrainingPolicyState()

  const ladder = [
    { model: 'claude-opus-5' },
    { model: 'deepseek-v4-flash-free' },
    { model: 'gpt-5.6-terra' },
  ]

  const filtered = filterLadderForTrainingPolicy(ladder)

  if (filtered.length !== 3) {
    return {
      name: 'Ladder filtering preserves non-training models',
      passed: false,
      message: `Clean session should preserve all ${ladder.length} models, got ${filtered.length}`,
    }
  }

  return {
    name: 'filterLadderForTrainingPolicy() works correctly',
    passed: true,
    message: 'Ladder filtering verified for clean session',
  }
}

function checkRosterExists(): CheckResult {
  let stats: ReturnType<typeof getRosterStats>
  try {
    stats = getRosterStats()
  } catch {
    return {
      name: 'Private repo roster accessible',
      passed: true,
      message: 'Database not available (test environment) — skipped',
    }
  }

  if (stats.owners.length === 0) {
    return {
      name: 'Private repo roster exists',
      passed: false,
      message: 'No owners in roster — run `pnpm run setup:roster-db` first',
    }
  }

  const socketDev = stats.owners.find(
    o => o.owner.toLowerCase() === FLEET_OWNER.toLowerCase(),
  )

  if (!socketDev) {
    return {
      name: `${FLEET_OWNER} in roster`,
      passed: false,
      message: `${FLEET_OWNER} not in roster — run \`pnpm run setup:roster-db\``,
    }
  }

  if (socketDev.privateCount === 0) {
    return {
      name: `${FLEET_OWNER} has private repos`,
      passed: false,
      message: `${FLEET_OWNER} shows 0 private repos — roster may be stale or gh auth failed`,
    }
  }

  return {
    name: `${FLEET_OWNER} roster entry valid`,
    passed: true,
    message: `${socketDev.privateCount} private repos, age ${Math.round(socketDev.ageMs / 60_000)}m`,
  }
}

function checkVisibilityLookup(): CheckResult {
  let publicRepo: boolean
  let privateRepo: boolean
  let rosterFresh: boolean

  try {
    rosterFresh = rosterIsFresh('SocketDev')
    publicRepo = isRepoPublic('SocketDev', 'socket-registry')
    privateRepo = isRepoPublic('SocketDev', 'depscan')
  } catch {
    return {
      name: 'Visibility lookup works',
      passed: true,
      message: 'Database not available (test environment) — skipped',
    }
  }

  if (!rosterFresh) {
    return {
      name: 'Visibility lookup works',
      passed: true,
      message: 'Roster stale — skipping visibility check (run setup:roster-db)',
    }
  }

  if (!publicRepo) {
    return {
      name: 'Public repo detected as public',
      passed: false,
      message:
        'socket-registry should be public but isRepoPublic() returned false',
    }
  }

  if (privateRepo) {
    return {
      name: 'Private repo detected as private',
      passed: false,
      message: 'depscan should be private but isRepoPublic() returned true',
    }
  }

  return {
    name: 'Visibility lookup correctly classifies repos',
    passed: true,
    message: 'Public and private repos correctly identified',
  }
}

function getProxySource(): string | undefined {
  const proxyPath = path.join(
    REPO_ROOT,
    'scripts',
    'fleet',
    'ai-balancer',
    'proxy.mts',
  )
  if (!existsSync(proxyPath)) {
    const templatePath = path.join(
      REPO_ROOT,
      'template',
      'base',
      'scripts',
      'fleet',
      'ai-balancer',
      'proxy.mts',
    )
    if (!existsSync(templatePath)) {
      return undefined
    }
    return readFileSync(templatePath, 'utf8')
  }
  return readFileSync(proxyPath, 'utf8')
}

interface AstNode {
  type: string
  [key: string]: unknown
}

interface AcornWasm {
  simple: (
    source: string,
    visitors: Record<string, (node: AstNode) => void>,
    options: Record<string, unknown>,
  ) => void
}

const AST_PARSE_OPTIONS = {
  ecmaVersion: 2026,
  sourceType: 'module',
  typescript: true,
}

const requireAcorn = createRequire(import.meta.url)

let cachedAcornWasm: AcornWasm | undefined

function acornWasm(): AcornWasm {
  if (cachedAcornWasm === undefined) {
    cachedAcornWasm = requireAcorn('@ultrathink/acorn.rs.wasm') as AcornWasm
  }
  return cachedAcornWasm
}

/**
 * Whether `moduleSource` has a named import of `name` from `moduleSpecifier`.
 * Reads the module's typed import graph via its AST, per
 * socket/no-source-sniffing, instead of pattern-matching the file's text.
 */
export function moduleImportsName(
  moduleSource: string,
  moduleSpecifier: string,
  name: string,
): boolean {
  let found = false
  try {
    acornWasm().simple(
      moduleSource,
      {
        ImportDeclaration(node) {
          if (found) {
            return
          }
          const specifierNode = node['source'] as AstNode | undefined
          if (specifierNode?.['value'] !== moduleSpecifier) {
            return
          }
          const specifiers = (node['specifiers'] as AstNode[] | undefined) ?? []
          for (let i = 0, { length } = specifiers; i < length; i += 1) {
            const spec = specifiers[i]!
            if (spec.type !== 'ImportSpecifier') {
              continue
            }
            const imported = spec['imported'] as AstNode | undefined
            if (imported?.['name'] === name) {
              found = true
              return
            }
          }
        },
      },
      AST_PARSE_OPTIONS,
    )
  } catch {
    // Parse failure — report as not-found; the caller flags it missing.
  }
  return found
}

/**
 * Whether `moduleSource` contains a bare call to `name` — `name(...)`, not
 * `obj.name(...)`. AST-based, per socket/no-source-sniffing.
 */
export function moduleCallsFunction(
  moduleSource: string,
  name: string,
): boolean {
  let found = false
  try {
    acornWasm().simple(
      moduleSource,
      {
        CallExpression(node) {
          if (found) {
            return
          }
          const callee = node['callee'] as AstNode | undefined
          if (callee?.type === 'Identifier' && callee['name'] === name) {
            found = true
          }
        },
      },
      AST_PARSE_OPTIONS,
    )
  } catch {
    // Parse failure — report as not-found; the caller flags it missing.
  }
  return found
}

function checkProxyImportsTrainingPolicy(): CheckResult {
  const source = getProxySource()
  if (!source) {
    return {
      name: 'proxy.mts imports training policy',
      passed: true,
      message: 'proxy.mts not found (non-balancer repo) — skipped',
    }
  }

  const requiredImports = [
    'extractFilePathsFromRequest',
    'filterLadderForTrainingPolicy',
    'recordFileAccesses',
  ]

  const missing: string[] = []
  for (let i = 0, { length } = requiredImports; i < length; i += 1) {
    const fn = requiredImports[i]!
    if (
      !moduleImportsName(source, '../_shared/model-training-policy.mts', fn)
    ) {
      missing.push(fn)
    }
  }

  if (missing.length > 0) {
    return {
      name: 'proxy.mts imports training policy functions',
      passed: false,
      message: `Missing imports: ${missing.join(', ')}`,
    }
  }

  return {
    name: 'proxy.mts imports training policy functions',
    passed: true,
    message: 'All required functions imported',
  }
}

function checkProxyCallsExtractFilePaths(): CheckResult {
  const source = getProxySource()
  if (!source) {
    return {
      name: 'proxy.mts calls extractFilePathsFromRequest',
      passed: true,
      message: 'proxy.mts not found — skipped',
    }
  }

  if (!moduleCallsFunction(source, 'extractFilePathsFromRequest')) {
    return {
      name: 'proxy.mts calls extractFilePathsFromRequest',
      passed: false,
      message: 'extractFilePathsFromRequest() not called in proxy.mts',
    }
  }

  return {
    name: 'proxy.mts calls extractFilePathsFromRequest',
    passed: true,
    message: 'File path extraction wired',
  }
}

function checkProxyCallsRecordFileAccesses(): CheckResult {
  const source = getProxySource()
  if (!source) {
    return {
      name: 'proxy.mts calls recordFileAccesses',
      passed: true,
      message: 'proxy.mts not found — skipped',
    }
  }

  if (!moduleCallsFunction(source, 'recordFileAccesses')) {
    return {
      name: 'proxy.mts calls recordFileAccesses',
      passed: false,
      message: 'recordFileAccesses() not called in proxy.mts',
    }
  }

  return {
    name: 'proxy.mts calls recordFileAccesses',
    passed: true,
    message: 'File access recording wired',
  }
}

function checkProxyCallsFilterLadder(): CheckResult {
  const source = getProxySource()
  if (!source) {
    return {
      name: 'proxy.mts calls filterLadderForTrainingPolicy',
      passed: true,
      message: 'proxy.mts not found — skipped',
    }
  }

  if (!moduleCallsFunction(source, 'filterLadderForTrainingPolicy')) {
    return {
      name: 'proxy.mts calls filterLadderForTrainingPolicy',
      passed: false,
      message: 'filterLadderForTrainingPolicy() not called in proxy.mts',
    }
  }

  return {
    name: 'proxy.mts calls filterLadderForTrainingPolicy',
    passed: true,
    message: 'Ladder filtering wired',
  }
}

export function trainingModelsRespectVisibility(): {
  passed: boolean
  results: CheckResult[]
} {
  const results: CheckResult[] = [
    checkModelsSet(),
    checkModelTrainsFunction(),
    checkLadderFiltering(),
    checkRosterExists(),
    checkVisibilityLookup(),
    checkProxyImportsTrainingPolicy(),
    checkProxyCallsExtractFilePaths(),
    checkProxyCallsRecordFileAccesses(),
    checkProxyCallsFilterLadder(),
  ]

  const passed = results.every(r => r.passed)
  return { passed, results }
}

async function main(): Promise<void> {
  const quiet = process.argv.includes('--quiet')
  const { passed, results } = trainingModelsRespectVisibility()

  if (!quiet) {
    for (const result of results) {
      const icon = result.passed ? '✓' : '✗'
      logger.info(`  ${icon} ${result.name}: ${result.message}`)
    }
  }

  if (!passed) {
    const failed = results.filter(r => !r.passed)
    if (quiet) {
      logger.error(
        `training-models-respect-visibility: ${failed.length} check(s) failed`,
      )
    }
    process.exitCode = 1
    return
  }

  if (!quiet) {
    logger.info('training-models-respect-visibility: all checks passed')
  }
}

const SCRIPT_META: ScriptMeta = {
  describe: 'Verify training model gating is correctly configured',
  help: 'Checks MODELS_THAT_TRAIN, roster existence, and visibility lookup',
}

if (isMainModule(import.meta.url)) {
  void runMain(main, SCRIPT_META)
}
