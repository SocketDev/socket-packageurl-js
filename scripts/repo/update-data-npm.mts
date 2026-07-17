import Module from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import allThePackageNamesData from 'all-the-package-names/names.json' with { type: 'json' }
import allThePackageNamesV1Data from 'all-the-package-names-v1.3905.0/names.json' with { type: 'json' }
import pacote from 'pacote'
import semver from '@socketsecurity/lib-stable/external/semver'
import validateNpmPackageName from 'validate-npm-package-name'

import { arrayUnique } from '@socketsecurity/lib-stable/arrays/unique'
import { getMaintainedNodeVersions } from '@socketsecurity/lib-stable/constants/node'
import { getAbortSignal } from '@socketsecurity/lib-stable/process/abort'
import { writeJson } from '@socketsecurity/lib-stable/fs/write-json'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { pFilter } from '@socketsecurity/lib-stable/promises/iterate'
import { naturalCompare } from '@socketsecurity/lib-stable/sorts/natural'
import { getDefaultSpinner } from '@socketsecurity/lib-stable/spinner/default'
import { confirm } from '@socketsecurity/lib-stable/stdio/prompts'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const rootPath = path.join(__dirname, '../..')
const dataPath = path.join(rootPath, 'data')
const npmDataPath = path.join(dataPath, 'npm')
const npmBuiltinNamesJsonPath = path.join(npmDataPath, 'builtin-names.json')
const npmLegacyNamesJsonPath = path.join(npmDataPath, 'legacy-names.json')

async function main(): Promise<void> {
  const spinner = getDefaultSpinner()
  spinner.start()

  const { next } = getMaintainedNodeVersions()
  const nodeVersion: string = process.version.slice(1)
  const isGteNext: boolean = semver.gte(nodeVersion, next)
  if (
    await confirm({
      message: `Update builtin package names?${isGteNext ? '' : ` (Requires Node >=${next})`}`,
      default: true,
    })
  ) {
    if (isGteNext) {
      const builtinNames: string[] = Module.builtinModules
        // Node 23 introduces 'node:sea', 'node:sqlite', 'node:test', and 'node:test/reporters'
        // that have no unprefixed version so we skip them
        .filter(n => !n.startsWith('node:'))
        // oxlint-disable-next-line unicorn/no-array-sort -- engines.node is < 20, so Array#toSorted is unavailable at the supported floor.
        .sort(naturalCompare)
      await writeJson(npmBuiltinNamesJsonPath, builtinNames, { spaces: 2 })
    } else {
      spinner.warn(`Skipping… (Running ${nodeVersion})`)
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
  const allThePackageNames: string[] = arrayUnique([
    // Load the 43.1MB names.json file of 'all-the-package-names@2.0.0'
    // which keeps the json file smaller while still covering the changes from:
    // https://blog.npmjs.org/post/168978377570/new-package-moniker-rules.html
    ...allThePackageNamesData,
    // Load the 24.7MB names.json from 'all-the-package-names@1.3905.0',
    // the last v1 release, because it has different names resolved by
    // npm's replicate.npmjs.com service
    ...allThePackageNamesV1Data,
  ])
  const rawLegacyNames: string[] = allThePackageNames
    // Don't simply check validateNpmPackageName(n).validForOldPackages
    // Instead let registry.npmjs.org be our source of truth to whether a
    // package exists or not
    .filter(n => !validateNpmPackageName(n).validForNewPackages)
    // oxlint-disable-next-line unicorn/no-array-sort -- engines.node is < 20, so Array#toSorted is unavailable at the supported floor.
    .sort(naturalCompare)
  const seenNames = new Set<string>()
  const invalidNames = new Set<string>()
  const legacyNames: string[] =
    // Chunk package names to process them in parallel 3 at a time
    await pFilter(
      rawLegacyNames,
      async n => {
        if (!seenNames.has(n)) {
          seenNames.add(n)
          spinner.text(`Checking package ${n}…`)
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
      { concurrency: 3, retries: 4, signal: getAbortSignal() },
    )
  await writeJson(npmLegacyNamesJsonPath, legacyNames, { spaces: 2 })
  spinner.stop()
  if (invalidNames.size) {
    logger.warn('Removed missing packages:', [...invalidNames])
  }
}

main().catch((e: unknown) => {
  logger.error(e)
  process.exitCode = 1
})
