/**
 * @file Version bump script with AI-powered changelog generation. Creates
 *   version bump commits with package.json, lockfile, and changelog updates.
 *   Includes interactive mode for reviewing and refining AI-generated
 *   changelogs.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { printFooter } from '@socketsecurity/lib-stable/stdio/footer'
import { printHeader } from '@socketsecurity/lib-stable/stdio/header'
import { errorMessage } from '../utils/error-message.mts'
import {
  checkClaude,
  checkGitBranch,
  checkGitStatus,
  confirm,
  generateChangelog,
  getCurrentVersion,
  getNewVersion,
  getPackageName,
  logger,
  readPackageJson,
  reviewChangelog,
  rootPath,
  runCommand,
  updateChangelog,
  writePackageJson,
} from './bump-lib.mts'
import { interactiveReviewChangelog } from './bump-interactive.mts'

// Check if prompts are available for interactive mode
// First check for local registry build, then check for installed package
const localPromptsPath = path.join(
  rootPath,
  'registry',
  'dist',
  'lib',
  'cli',
  'prompts.js',
)
const packagePromptsPath = path.join(
  rootPath,
  'node_modules',
  '@socketsecurity',
  'registry',
  'dist',
  'lib',
  'cli',
  'prompts.js',
)

let promptsPath: string | null = undefined
if (existsSync(localPromptsPath)) {
  promptsPath = localPromptsPath
} else if (existsSync(packagePromptsPath)) {
  promptsPath = packagePromptsPath
}

const hasInteractivePrompts: boolean = !!promptsPath

// Conditionally import interactive prompts
let prompts:
  | Record<string, (...args: unknown[]) => Promise<unknown>>
  | undefined
if (hasInteractivePrompts) {
  try {
    // oxlint-disable-next-line socket/no-dynamic-import-outside-bundle -- optional dependency path resolved at runtime.
    // socket-lint: allow top-level-await -- bump.mts is a pure-ESM CLI run via `node scripts/repo/bump.mts`; it is never CJS-bundled.
    prompts = (await import(promptsPath!)) as typeof prompts
  } catch {
    // Fall back to basic prompts if import fails
  }
}

async function main(): Promise<void> {
  try {
    // Parse arguments
    const { values } = parseArgs({
      options: {
        help: {
          type: 'boolean',
          default: false,
        },
        bump: {
          type: 'string',
          default: 'patch',
        },
        interactive: {
          type: 'boolean',
          // Default to true when prompts are available
          default: hasInteractivePrompts,
        },
        'no-interactive': {
          type: 'boolean',
          default: false,
        },
        'skip-changelog': {
          type: 'boolean',
          default: false,
        },
        'skip-checks': {
          type: 'boolean',
          default: false,
        },
        'no-push': {
          type: 'boolean',
          default: false,
        },
        force: {
          type: 'boolean',
          default: false,
        },
      },
      allowPositionals: false,
      strict: false,
    })

    // Show help if requested
    if (values.help) {
      logger.log('')
      logger.log('Usage: pnpm bump [options]')
      logger.log('')
      logger.log('Options:')
      logger.log('  --help           Show this help message')
      logger.log('  --bump <type>    Version bump type (default: patch)')
      logger.log(
        '                   Can be: major, minor, patch, premajor, preminor,',
      )
      logger.log(
        '                   prepatch, prerelease, or a specific version',
      )
      logger.log('  --interactive    Force interactive changelog review')
      logger.log('  --no-interactive Disable interactive mode')
      logger.log('  --skip-changelog Skip changelog generation with Claude')
      logger.log('  --skip-checks    Skip git status/branch checks')
      logger.log('  --no-push        Do not push changes to remote')
      logger.log('  --force          Force bump even with warnings')
      logger.log('')
      logger.log('Examples:')
      logger.log(
        '  pnpm bump                    # Bump patch (interactive by default)',
      )
      logger.log('  pnpm bump --bump=minor       # Bump minor version')
      logger.log('  pnpm bump --no-interactive   # Use basic prompts')
      logger.log('  pnpm bump --bump=2.0.0       # Set specific version')
      logger.log(
        '  pnpm bump --skip-changelog   # Skip AI changelog generation',
      )
      logger.log('')
      logger.log('Requires:')
      logger.log('  - claude-console (or claude) CLI tool installed')
      logger.log('  - Clean git working directory')
      logger.log('  - Main/master branch (unless --force)') // inclusive-language: external-api — `master` is a real branch name in legacy repos.
      if (hasInteractivePrompts) {
        logger.log('')
        logger.success('Interactive mode: Available (default)')
      } else {
        logger.log('')
        logger.log('Interactive mode: Not available')
        logger.log(
          '  (install @socketsecurity/lib-stable or build local registry)',
        )
      }
      process.exitCode = 0
      return
    }

    printHeader('Version Bump', { width: 56, borderChar: '=' })

    // Handle interactive mode conflicts
    if (values['no-interactive']) {
      values.interactive = false
    }

    // Check git status unless skipped
    if (!values['skip-checks']) {
      logger.step('Checking prerequisites')

      logger.progress('Checking git status')
      const gitClean = await checkGitStatus()
      if (!gitClean && !values.force) {
        logger.failed('Git working directory is not clean')
        process.exitCode = 1
        return
      }
      logger.done('Git status clean')

      logger.progress('Checking git branch')
      const onMainBranch = await checkGitBranch()
      if (!onMainBranch && !values.force) {
        logger.failed('Not on main/master branch') // inclusive-language: external-api — `master` is a real branch name in legacy repos.
        process.exitCode = 1
        return
      }
      logger.done('On main/master branch') // inclusive-language: external-api — `master` is a real branch name in legacy repos.
    }

    // Check for Claude if not skipping changelog
    let claudeCmd: string | false | null = undefined
    if (!values['skip-changelog']) {
      logger.progress('Checking for Claude CLI')
      claudeCmd = await checkClaude()
      if (!claudeCmd) {
        logger.failed('claude-console not found')
        logger.error(
          'Please install claude-console: https://github.com/anthropics/claude-console',
        )
        logger.info('Install with: npm install -g @anthropic/claude-console')
        logger.info('Or use --skip-changelog to skip AI-generated changelog')
        process.exitCode = 1
        return
      }
      logger.done(`Found Claude CLI: ${claudeCmd}`)
    }

    // Get current version
    const currentVersion = await getCurrentVersion()
    logger.info(`Current version: ${currentVersion}`)

    // Calculate new version
    const newVersion = getNewVersion(currentVersion, values.bump)
    if (!newVersion) {
      logger.error('Failed to calculate new version')
      process.exitCode = 1
      return
    }
    logger.info(`New version: ${newVersion}`)

    // Confirm version bump
    if (
      !(await confirm(`Bump version from ${currentVersion} to ${newVersion}?`))
    ) {
      logger.info('Version bump cancelled')
      process.exitCode = 0
      return
    }

    // Update package.json
    logger.step('Updating version')
    logger.progress('Updating package.json')
    const pkgJson = await readPackageJson()
    pkgJson.version = newVersion
    await writePackageJson(pkgJson)
    logger.done('Updated package.json')

    // Update lockfile
    logger.progress('Updating lockfile')
    await runCommand('pnpm', ['install', '--lockfile-only'], { stdio: 'pipe' })
    logger.done('Updated lockfile')

    // Check for interactive mode availability
    // Only warn if explicitly requested via --interactive flag
    const explicitlyRequestedInteractive =
      process.argv.includes('--interactive')
    if (values.interactive && !hasInteractivePrompts) {
      if (explicitlyRequestedInteractive) {
        logger.warn('Interactive mode requested but prompts not available')
        logger.info(
          'To enable: install @socketsecurity/lib-stable or build local registry',
        )
      }
      values.interactive = false
    }

    // Generate and review changelog
    let changelogEntry = undefined
    if (!values['skip-changelog'] && claudeCmd) {
      changelogEntry = await generateChangelog(
        claudeCmd,
        currentVersion,
        newVersion,
      )

      const interactiveFn =
        values.interactive && prompts
          ? (cmd: string, entry: string) =>
              interactiveReviewChangelog(cmd, entry, prompts!)
          : undefined

      changelogEntry = await reviewChangelog(
        claudeCmd,
        changelogEntry,
        values.interactive,
        interactiveFn,
      )

      logger.progress('Updating CHANGELOG.md')
      await updateChangelog(changelogEntry)
      logger.done('Updated CHANGELOG.md')
    }

    // Create commit
    logger.step('Creating commit')
    const packageName = await getPackageName()
    const commitMessage =
      packageName === 'registry package'
        ? `Bump registry package to v${newVersion}`
        : `Bump to v${newVersion}`

    logger.progress('Staging changes')
    await runCommand('git', ['add', 'package.json', 'pnpm-lock.yaml'])
    if (changelogEntry) {
      await runCommand('git', ['add', 'CHANGELOG.md'])
    }
    logger.done('Changes staged')

    logger.progress('Creating commit')
    await runCommand('git', ['commit', '-m', commitMessage])
    logger.done(`Created commit: ${commitMessage}`)

    // Create tag
    logger.progress('Creating tag')
    const tagName = `v${newVersion}`
    await runCommand('git', ['tag', tagName, '-m', `Release ${tagName}`])
    logger.done(`Created tag: ${tagName}`)

    // Push to remote
    if (!values['no-push']) {
      if (await confirm('Push changes to remote?')) {
        logger.step('Pushing to remote')

        logger.progress('Pushing commits')
        await runCommand('git', ['push'])
        logger.done('Pushed commits')

        logger.progress('Pushing tags')
        await runCommand('git', ['push', '--tags'])
        logger.done('Pushed tags')
      }
    }

    printFooter(`Version bumped to ${newVersion}!`)

    logger.error('')
    logger.info('Next steps:')
    logger.substep('1. Run `pnpm release` to publish to npm')
    logger.substep('2. Create GitHub release if needed')

    process.exitCode = 0
  } catch (e) {
    const message = errorMessage(e)
    logger.error(`Version bump failed: ${message}`)
    process.exitCode = 1
  }
}

main().catch((e: unknown) => {
  logger.error(e)
  process.exitCode = 1
})
