/* oxlint-disable socket/prefer-cached-for-loop -- one-shot validation script, not a hot path. */
/**
 * @fileoverview Validates that the bundler configuration has
 * minify: false. Minification breaks ESM/CJS interop and makes
 * debugging harder.
 */

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import type { RolldownOptions } from 'rolldown'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

import { errorMessage } from '../utils/error-message.mts'

type RolldownConfigModule = {
  configs?: readonly RolldownOptions[] | undefined
  default?: readonly RolldownOptions[] | undefined
}

type MinifyViolation = {
  config: string
  value: unknown
  message: string
  location: string
}

const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..', '..')

export async function validateMinify(): Promise<MinifyViolation[]> {
  const configPath = path.join(rootPath, '.config/rolldown.config.mts')

  try {
    // oxlint-disable-next-line socket/no-dynamic-import-outside-bundle -- loads the build config module at runtime.
    const mod = (await import(configPath)) as RolldownConfigModule
    const configs = mod.configs ?? mod.default

    if (!configs || !Array.isArray(configs)) {
      logger.fail(
        `Failed to read configs from ${configPath} — expected named export "configs" or default export.`,
      )
      process.exitCode = 1
      return []
    }

    const violations: MinifyViolation[] = []

    for (const [index, cfg] of configs.entries()) {
      const out = cfg.output
      if (!out || Array.isArray(out)) {
        continue
      }
      const minify = (out as { minify?: unknown | undefined }).minify
      if (minify !== false) {
        violations.push({
          config: `configs[${index}].output`,
          value: minify,
          message: `configs[${index}].output.minify must be false`,
          location: configPath,
        })
      }
    }

    return violations
  } catch (e) {
    logger.fail(`Failed to load rolldown config: ${errorMessage(e)}`)
    process.exitCode = 1
    return []
  }
}

async function main(): Promise<void> {
  const violations = await validateMinify()

  if (violations.length === 0) {
    logger.success('Bundler minify validation passed')
    process.exitCode = 0
    return
  }

  logger.fail('Bundler minify validation failed')

  for (let i = 0, { length } = violations; i < length; i += 1) {
    const violation = violations[i]
    logger.log(`  ${violation.message}`)
    logger.log(`  Found: minify: ${String(violation.value)}`)
    logger.log('  Expected: minify: false')
    logger.log(`  Location: ${violation.location}`)
    logger.log('')
  }

  logger.log('Minification breaks ESM/CJS interop and makes debugging harder.')

  process.exitCode = 1
}

main().catch((error: unknown) => {
  logger.fail(`Validation failed: ${errorMessage(error)}`)
  process.exitCode = 1
})
