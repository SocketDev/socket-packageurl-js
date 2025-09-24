import Module from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import pacote from 'pacote'
import semver from 'semver'
import validateNpmPackageName from 'validate-npm-package-name'

import constants from '@socketsecurity/registry/lib/constants'
import { writeJson } from '@socketsecurity/registry/lib/fs'
import { logger } from '@socketsecurity/registry/lib/logger'
import { pFilter } from '@socketsecurity/registry/lib/promises'
import { confirm } from '@socketsecurity/registry/lib/prompts'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'

const { abortSignal } = constants

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const rootPath = path.resolve(__dirname, '..')
const dataPath = path.join(rootPath, 'data')
const npmDataPath = path.join(dataPath, 'npm')
const npmBuiltinNamesJsonPath = path.join(npmDataPath, 'builtin-names.json')
const npmLegacyNamesJsonPath = path.join(npmDataPath, 'legacy-names.json')

void (async () => {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start()

  // Lazily access constants.maintainedNodeVersions.
  const { next } = constants.maintainedNodeVersions
  const nodeVersion = process.version.slice(1)
  const isGteNext = semver.gte(nodeVersion, next)
  if (
    await confirm({
      message: `Update builtin package names?${isGteNext ? '' : ` (Requires Node >=${next})`}`,
      default: true,
    })
  ) {
    if (isGteNext) {
      const builtinNames = Module.builtinModules
        // Node 23 introduces 'node:sea', 'node:sqlite', 'node:test', and 'node:test/reporters'
        // that have no unprefixed version so we skip them.
        .filter(n => !n.startsWith('node:'))
        .sort(naturalCompare)
      await writeJson(npmBuiltinNamesJsonPath, builtinNames, { spaces: 2 })
    } else {
      spinner.warn(`Skipping... (Running ${nodeVersion})`)
    }
  }

  if (
    !(await confirm({
      message: 'Update npm package names data?',
      default: false,
    }))
  ) {
    spinner.stop()
    return
  }
  const allThePackageNamesData = await import('all-the-package-names/names.json', {
    with: { type: 'json' }
  })
  const allThePackageNamesV1Data = await import('all-the-package-names-v1.3905.0/names.json', {
    with: { type: 'json' }
  })

  const allThePackageNames = [
    ...new Set([
      // Load the 43.1MB names.json file of 'all-the-package-names@2.0.0'
      // which keeps the json file smaller while still covering the changes from:
      // https://blog.npmjs.org/post/168978377570/new-package-moniker-rules.html
      ...allThePackageNamesData.default,
      // Load the 24.7MB names.json from 'all-the-package-names@1.3905.0',
      // the last v1 release, because it has different names resolved by
      // npm's replicate.npmjs.com service.
      ...allThePackageNamesV1Data.default,
    ]),
  ]
  const rawLegacyNames = allThePackageNames
    // Don't simply check validateNpmPackageName(n).validForOldPackages.
    // Instead let registry.npmjs.org be our source of truth to whether a
    // package exists or not.
    .filter(n => !validateNpmPackageName(n).validForNewPackages)
    .sort(naturalCompare)
  const seenNames = new Set()
  const invalidNames = new Set()
  const legacyNames =
    // Chunk package names to process them in parallel 3 at a time.
    await pFilter(
      rawLegacyNames,
      async n => {
        if (!seenNames.has(n)) {
          seenNames.add(n)
          spinner.setText(`Checking package ${n}...`)
        }
        try {
          await pacote.manifest(`${n}@latest`)
          invalidNames.delete(n)
          return true
        } catch {
          invalidNames.add(n)
        }
        return false
      },
      { concurrency: 3, retries: 4, signal: abortSignal },
    )
  await writeJson(npmLegacyNamesJsonPath, legacyNames, { spaces: 2 })
  spinner.stop()
  if (invalidNames.size) {
    logger.warn('Removed missing packages:', [...invalidNames])
  }
})()
