'use strict'

const fs = require('node:fs/promises')
const Module = require('node:module')
const path = require('node:path')

const pacote = require('pacote')
const validateNpmPackageName = require('validate-npm-package-name')

const constants = require('@socketsecurity/registry/lib/constants')
const { pFilter } = require('@socketsecurity/registry/lib/promises')
const { Spinner } = require('@socketsecurity/registry/lib/spinner')

const { abortSignal } = constants

const rootPath = path.resolve(__dirname, '..')
const dataPath = path.join(rootPath, 'data')
const npmDataPath = path.join(dataPath, 'npm')
const npmBuiltinNamesJsonPath = path.join(npmDataPath, 'builtin-names.json')
const npmLegacyNamesJsonPath = path.join(npmDataPath, 'legacy-names.json')

const { compare: alphanumericComparator } = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
})

void (async () => {
  const spinner = new Spinner().start()
  const builtinNames = Module.builtinModules.toSorted(alphanumericComparator)
  const allThePackageNames = [
    ...new Set([
      // Load the 43.1MB names.json file of 'all-the-package-names@2.0.0'
      // which keeps the json file smaller while still covering the changes from:
      // https://blog.npmjs.org/post/168978377570/new-package-moniker-rules.html
      ...require('all-the-package-names/names.json'),
      // Load the 24.7MB names.json from 'all-the-package-names@1.3905.0',
      // the last v1 release, because it has different names resolved by
      // npm's replicate.npmjs.com service.
      ...require('all-the-package-names-v1.3905.0/names.json')
    ])
  ]
  const rawLegacyNames = allThePackageNames
    // Don't simply check validateNpmPackageName(n).validForOldPackages.
    // Instead let registry.npmjs.org be our source of truth to whether a
    // package exists or not.
    .filter(n => !validateNpmPackageName(n).validForNewPackages)
    .sort(alphanumericComparator)
  const seenNames = new Set()
  const invalidNames = new Set()
  const legacyNames =
    // Chunk package names to process them in parallel 3 at a time.
    await pFilter(
      rawLegacyNames,
      3,
      async n => {
        if (!seenNames.has(n)) {
          seenNames.add(n)
          spinner.text = `Checking package ${n}...`
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
      { retries: 3, signal: abortSignal }
    )
  spinner.text = 'Writing json files...'
  await Promise.all(
    [
      { json: builtinNames, path: npmBuiltinNamesJsonPath },
      { json: legacyNames, path: npmLegacyNamesJsonPath }
    ].map(d =>
      fs.writeFile(d.path, `${JSON.stringify(d.json, null, 2)}\n`, 'utf8')
    )
  )
  spinner.stop()
  if (invalidNames.size) {
    console.warn(`⚠️ Removed missing packages:`, [...invalidNames])
  }
})()
