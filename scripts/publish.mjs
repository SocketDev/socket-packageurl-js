/**
 * @fileoverview Publish runner for Socket packageurl-js.
 * Validates build artifacts exist, then publishes to npm.
 * Build and checks should be run separately (e.g., via ci:validate).
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import { printFooter, printHeader } from '@socketsecurity/lib/stdio/header'

const logger = getDefaultLogger()

const rootPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const WIN32 = process.platform === 'win32'

async function runCommand(command, args = [], options = {}) {
  try {
    const result = await spawn(command, args, {
      cwd: rootPath,
      stdio: 'inherit',
      ...(WIN32 && { shell: true }),
      ...options,
    })
    return result.code
  } catch (error) {
    // spawn() throws on non-zero exit
    if (error && typeof error === 'object' && 'code' in error) {
      return error.code
    }
    throw error
  }
}

async function runCommandWithOutput(command, args = [], options = {}) {
  try {
    const result = await spawn(command, args, {
      cwd: rootPath,
      stdio: 'pipe',
      stdioString: true,
      ...(WIN32 && { shell: true }),
      ...options,
    })
    return {
      exitCode: result.code,
      stderr: result.stderr,
      stdout: result.stdout,
    }
  } catch (error) {
    // spawn() throws on non-zero exit
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      'stdout' in error &&
      'stderr' in error
    ) {
      return {
        exitCode: error.code,
        stderr: error.stderr,
        stdout: error.stdout,
      }
    }
    throw error
  }
}

/**
 * Read package.json from the project.
 */
async function readPackageJson(pkgPath = rootPath) {
  const packageJsonPath = path.join(pkgPath, 'package.json')
  const content = await fs.readFile(packageJsonPath, 'utf8')
  return JSON.parse(content)
}

/**
 * Get the current version from package.json.
 */
async function getCurrentVersion(pkgPath = rootPath) {
  const pkgJson = await readPackageJson(pkgPath)
  return pkgJson.version
}

/**
 * Check if a version exists on npm.
 */
async function versionExists(packageName, version) {
  const result = await runCommandWithOutput(
    'npm',
    ['view', `${packageName}@${version}`, 'version'],
    { stdio: 'pipe' },
  )

  return result.exitCode === 0
}

/**
 * Validate that build artifacts exist based on package.json exports.
 */
async function validateBuildArtifacts() {
  logger.step('Validating build artifacts')

  const pkgJson = await readPackageJson()
  const missing = []

  // Check exports from package.json.
  if (pkgJson.exports) {
    for (const [exportPath, exportValue] of Object.entries(pkgJson.exports)) {
      // Skip package.json export.
      if (exportPath === './package.json') {
        continue
      }

      // Handle both string and object export values.
      const files =
        typeof exportValue === 'string'
          ? [exportValue]
          : Object.values(exportValue).filter(v => typeof v === 'string')

      for (const file of files) {
        const filePath = path.join(rootPath, file)
        if (!existsSync(filePath)) {
          missing.push(file)
        }
      }
    }
  }

  // Check main entry point.
  if (pkgJson.main) {
    const mainPath = path.join(rootPath, pkgJson.main)
    if (!existsSync(mainPath)) {
      missing.push(pkgJson.main)
    }
  }

  // Check types entry point.
  if (pkgJson.types) {
    const typesPath = path.join(rootPath, pkgJson.types)
    if (!existsSync(typesPath)) {
      missing.push(pkgJson.types)
    }
  }

  if (missing.length > 0) {
    logger.error('Missing build artifacts:')
    for (const file of missing) {
      logger.substep(`  ${file}`)
    }
    return false
  }

  logger.success('Build artifacts validated')
  return true
}

/**
 * Publish a single package.
 */
async function publishPackage(options = {}) {
  const { access = 'public', dryRun = false, otp, tag = 'latest' } = options

  const pkgJson = await readPackageJson()
  const packageName = pkgJson.name
  const version = pkgJson.version

  logger.step(`Publishing ${packageName}@${version}`)

  // Check if version already exists.
  logger.progress('Checking npm registry')
  const exists = await versionExists(packageName, version)
  if (exists) {
    logger.warn(`Version ${version} already exists on npm`)
    if (!options.force) {
      return false
    }
  }
  logger.done('Version check complete')

  // Prepare publish args.
  const publishArgs = ['publish', '--access', access, '--tag', tag]

  // Add provenance by default (works with trusted publishers).
  if (!dryRun) {
    publishArgs.push('--provenance')
  }

  if (dryRun) {
    publishArgs.push('--dry-run')
  }

  if (otp) {
    publishArgs.push('--otp', otp)
  }

  // Publish.
  logger.progress(dryRun ? 'Running dry-run publish' : 'Publishing to npm')
  const publishCode = await runCommand('npm', publishArgs)

  if (publishCode !== 0) {
    logger.failed('Publish failed')
    return false
  }

  if (dryRun) {
    logger.done('Dry-run publish complete')
  } else {
    logger.done(`Published ${packageName}@${version} to npm`)
  }

  return true
}

/**
 * Push existing git tag if it exists locally but not remotely.
 * Tags should be created with version bump commits, not by this script.
 */
async function pushExistingTag(version, options = {}) {
  const { force = false } = options

  const tagName = `v${version}`

  logger.step('Checking git tag')

  // Check if tag exists locally.
  logger.progress(`Checking for local tag ${tagName}`)
  const localTagResult = await runCommandWithOutput('git', [
    'tag',
    '-l',
    tagName,
  ])
  if (!localTagResult.stdout.trim()) {
    logger.done('No local tag to push')
    return true
  }
  logger.done(`Local tag ${tagName} exists`)

  // Check if tag exists on remote.
  logger.progress(`Checking remote for tag ${tagName}`)
  const remoteTagResult = await runCommandWithOutput('git', [
    'ls-remote',
    '--tags',
    'origin',
    tagName,
  ])
  if (remoteTagResult.stdout.trim()) {
    logger.done('Tag already exists on remote')
    return true
  }

  // Push existing tag to remote.
  logger.progress(`Pushing tag ${tagName} to remote`)
  const pushArgs = ['push', 'origin', tagName]
  if (force) {
    pushArgs.push('-f')
  }

  const pushCode = await runCommand('git', pushArgs)
  if (pushCode !== 0) {
    logger.failed('Tag push failed')
    return false
  }
  logger.done('Pushed tag to remote')

  return true
}

async function main() {
  try {
    // Parse arguments.
    const { values } = parseArgs({
      options: {
        access: {
          default: 'public',
          type: 'string',
        },
        'dry-run': {
          default: false,
          type: 'boolean',
        },
        force: {
          default: false,
          type: 'boolean',
        },
        help: {
          default: false,
          type: 'boolean',
        },
        otp: {
          type: 'string',
        },
        'skip-tag': {
          default: false,
          type: 'boolean',
        },
        tag: {
          default: 'latest',
          type: 'string',
        },
      },
      allowPositionals: false,
      strict: false,
    })

    // Show help if requested.
    if (values.help) {
      console.log('\nUsage: pnpm publish [options]')
      console.log('\nOptions:')
      console.log('  --help         Show this help message')
      console.log('  --dry-run      Perform a dry-run without publishing')
      console.log('  --force        Force publish even with warnings')
      console.log('  --skip-tag     Skip git tag push')
      console.log('  --tag <tag>    npm dist-tag (default: latest)')
      console.log('  --access <access>  Package access level (default: public)')
      console.log('  --otp <otp>    npm one-time password')
      console.log('\nExamples:')
      console.log(
        '  pnpm publish              # Validate artifacts and publish',
      )
      console.log('  pnpm publish --dry-run    # Dry-run to test')
      console.log('  pnpm publish --otp 123456 # Publish with OTP')
      process.exitCode = 0
      return
    }

    printHeader('Publish Runner', { borderChar: '=', width: 56 })

    // Get current version.
    const version = await getCurrentVersion()
    logger.info(`Current version: ${version}`)

    // Validate that build artifacts exist.
    const artifactsExist = await validateBuildArtifacts()
    if (!artifactsExist && !values.force) {
      logger.error('Build artifacts missing - run pnpm build first')
      process.exitCode = 1
      return
    }

    // Publish.
    const publishSuccess = await publishPackage({
      access: values.access,
      dryRun: values['dry-run'],
      force: values.force,
      otp: values.otp,
      tag: values.tag,
    })

    if (!publishSuccess && !values.force) {
      logger.error('Publish failed')
      process.exitCode = 1
      return
    }

    // Push git tag if it exists.
    // Tags are created by version bump commits, not by this script.
    if (!values['skip-tag'] && !values['dry-run']) {
      await pushExistingTag(version, {
        force: values.force,
      })
    }

    printFooter('Publish completed successfully!', {
      borderChar: '=',
      color: 'green',
      width: 56,
    })
    process.exitCode = 0
  } catch (error) {
    logger.error(`Publish runner failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(e => {
  logger.error(e)
  process.exitCode = 1
})
