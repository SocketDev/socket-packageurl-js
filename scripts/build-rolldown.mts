/**
 * @fileoverview Parallel rolldown build runner used during the
 * esbuild → rolldown migration. Once the migration cuts over,
 * scripts/build.mts replaces this and this file is deleted.
 * See docs/rolldown-migration.md.
 */

import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { rolldown } from 'rolldown'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { printFooter } from '@socketsecurity/lib/stdio/footer'
import { printHeader } from '@socketsecurity/lib/stdio/header'

import { configs } from '../.config/rolldown.config.mts'

const logger = getDefaultLogger()
const rootPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)

async function buildWithRolldown(): Promise<number> {
  printHeader('Build Runner (rolldown)')
  logger.step('Building with rolldown')

  const startTime = Date.now()

  try {
    for (const config of configs) {
      const bundle = await rolldown(config)
      const output = config.output
      if (!output || Array.isArray(output)) {
        throw new Error('Expected single output config')
      }
      await bundle.write(output)
      await bundle.close()
    }

    const buildTime = Date.now() - startTime
    logger.success(`Build complete in ${buildTime}ms`)

    // Report bundle sizes for comparison with esbuild baseline.
    const distPath = path.join(rootPath, 'dist')
    const indexPath = path.join(distPath, 'index.js')
    const existsPath = path.join(distPath, 'exists.js')

    if (existsSync(indexPath)) {
      const bytes = statSync(indexPath).size
      logger.info(`dist/index.js: ${(bytes / 1024).toFixed(2)} KB`)
    }
    if (existsSync(existsPath)) {
      const bytes = statSync(existsPath).size
      logger.info(`dist/exists.js: ${(bytes / 1024).toFixed(2)} KB`)
    }

    printFooter()
    return 0
  } catch (e) {
    logger.error('Rolldown build failed')
    console.error(e)
    return 1
  }
}

const exitCode = await buildWithRolldown()
process.exitCode = exitCode
