/* max-file-lines: legitimate -- single-purpose CLI script; splitting would obscure the linear command flow. */
/**
 * @fileoverview Version bump script with AI-powered changelog generation.
 * Creates version bump commits with package.json, lockfile, and changelog updates.
 * Includes interactive mode for reviewing and refining AI-generated changelogs.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

import semver from 'semver'
import colors from 'yoctocolors-cjs'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { safeDelete } from '@socketsecurity/lib-stable/fs'
import type { Logger } from '@socketsecurity/lib-stable/logger'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import type { SpawnOptions, SpawnResult } from '@socketsecurity/lib-stable/spawn'
import { spawn } from '@socketsecurity/lib-stable/spawn'
import { printFooter } from '@socketsecurity/lib-stable/stdio/footer'
import { printHeader } from '@socketsecurity/lib-stable/stdio/header'
import { errorMessage } from './utils/error-message.mts'

type CommandResult = {
  exitCode: number
  stderr: string
  stdout: string
}

type PackageJson = Record<string, unknown> & {
  name?: string | undefined
  version?: string | undefined
}

const logger: Logger = getDefaultLogger()

const rootPath: string = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const WIN32: boolean = process.platform === 'win32'

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
    prompts = (await import(promptsPath!)) as typeof prompts
  } catch {
    // Fall back to basic prompts if import fails
  }
}

/**
 * Check if claude-console is available.
 */
export async function checkClaude(): Promise<string | false> {
  const checkCommand: string = WIN32 ? 'where' : 'which'
  const result: CommandResult = await runCommandWithOutput(checkCommand, [
    'claude-console',
  ])

  if (result.exitCode !== 0) {
    // Also check common aliases
    const aliasResult: CommandResult = await runCommandWithOutput(
      checkCommand,
      ['claude'],
    )
    if (aliasResult.exitCode !== 0) {
      return false
    }
    return 'claude'
  }
  return 'claude-console'
}

/**
 * Check if we're on the main branch (with `master` fallback for legacy repos).
 * inclusive-language: external-api — `master` is a real branch name in legacy repos.
 */
export async function checkGitBranch(): Promise<boolean> {
  const result = await runCommandWithOutput('git', [
    'rev-parse',
    '--abbrev-ref',
    'HEAD',
  ])
  const branch = result.stdout.trim()
  // oxlint-disable-next-line socket/inclusive-language -- inclusive-language: external-api — legacy branch name reference.
  if (branch !== 'main' && branch !== 'master') {
    // oxlint-disable-next-line socket/inclusive-language -- inclusive-language: external-api — legacy branch name reference.
    logger.warn(`Not on main/master branch (current: ${branch})`)
    return false
  }
  return true
}

/**
 * Check if the working directory is clean.
 */
export async function checkGitStatus(): Promise<boolean> {
  const result = await runCommandWithOutput('git', ['status', '--porcelain'])
  if (result.stdout.trim()) {
    logger.error('Working directory is not clean')
    logger.info('Uncommitted changes:')
    logger.log(result.stdout)
    return false
  }
  return true
}

/**
 * Prompt user for yes/no confirmation.
 */
export async function confirm(
  question: string,
  defaultYes: boolean = true,
): Promise<boolean> {
  const defaultHint: string = defaultYes ? 'Y/n' : 'y/N'
  const answer: string = await prompt(
    `${question} [${defaultHint}]`,
    defaultYes ? 'y' : 'n',
  )
  return answer.toLowerCase().startsWith('y')
}

/**
 * Create readline interface for user input.
 */
export function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
}

/**
 * Generate changelog using Claude.
 */
export async function generateChangelog(
  claudeCmd: string,
  currentVersion: string,
  newVersion: string,
): Promise<string> {
  logger.step('Generating changelog with Claude')

  // Get recent commits for context
  const recentCommits = await getRecentCommits()
  const packageName = await getPackageName()

  // Create a temporary file with the prompt
  const promptPath = path.join(rootPath, '.claude-bump-prompt.tmp')
  const prompt = `Generate a changelog entry for ${packageName} version ${newVersion}.

Current version: ${currentVersion}
New version: ${newVersion}

Recent commits since last release:
${recentCommits}

Generate a changelog entry following the Keep a Changelog format (https://keepachangelogger.com/).
Include only the entry for this version, not the entire file.
Format it like this:

## [${newVersion}] - ${new Date().toISOString().split('T')[0]}

### Added
- New features

### Changed
- Changes in existing functionality

### Fixed
- Bug fixes

### Removed
- Removed features

Only include sections that have actual changes. Focus on user-facing changes.
Be concise but informative. Group related changes together.`

  await fs.writeFile(promptPath, prompt)

  // Call Claude to generate the changelog
  logger.progress('Asking Claude to generate changelog')

  const claudeResult = await runCommandWithOutput(claudeCmd, [], {
    input: prompt,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  // Clean up temp file
  await safeDelete(promptPath)

  if (claudeResult.exitCode !== 0) {
    logger.failed('Claude failed to generate changelog')
    throw new Error('Claude failed to generate changelog')
  }

  logger.done('Changelog generated')
  return claudeResult.stdout.trim()
}

/**
 * Get the current version from package.json.
 */
export async function getCurrentVersion(
  pkgPath: string = rootPath,
): Promise<string | undefined> {
  const pkgJson: PackageJson = await readPackageJson(pkgPath)
  return pkgJson.version
}

/**
 * Determine the new version based on bump type.
 */
export function getNewVersion(
  currentVersion: string,
  bumpType: string,
): string | null {
  // Check if bumpType is a valid semver version
  if (semver.valid(bumpType)) {
    return bumpType
  }

  // Otherwise treat as release type
  const validTypes: string[] = [
    'major',
    'minor',
    'patch',
    'premajor',
    'preminor',
    'prepatch',
    'prerelease',
  ]
  if (!validTypes.includes(bumpType)) {
    throw new Error(
      `Invalid bump type: ${bumpType}. Must be one of: ${validTypes.join(', ')} or a valid semver version`,
    )
  }

  return semver.inc(currentVersion, bumpType as semver.ReleaseType)
}

/**
 * Get package name for commit message.
 */
export async function getPackageName(): Promise<string> {
  if (isRegistryPackage()) {
    return 'registry package'
  }
  const pkgJson = await readPackageJson()
  return pkgJson.name || 'package'
}

/**
 * Get the last few commits for context.
 */
export async function getRecentCommits(count: number = 20): Promise<string> {
  const result = await runCommandWithOutput('git', [
    'log',
    '--oneline',
    '--no-decorate',
    `-${count}`,
  ])
  return result.stdout.trim()
}

/**
 * Interactive review using advanced prompts.
 * Provides a better user experience with select menus and structured feedback.
 */
export async function interactiveReviewChangelog(
  claudeCmd: string,
  changelogEntry: string,
): Promise<string> {
  let currentEntry: string = changelogEntry
  let regenerateCount: number = 0

  while (true) {
    // Show the current changelog
    logger.log('')
    logger.log(`${colors.cyan('Current Changelog Entry:')}`)
    logger.log(colors.dim('─'.repeat(60)))
    logger.log(currentEntry)
    logger.log(`${colors.dim('─'.repeat(60))}`)
    logger.log('')

    // Offer action choices
    const action = await prompts.select({
      message: 'What would you like to do?',
      choices: [
        // oxlint-disable-next-line socket/no-status-emoji -- interactive prompt menu labels need glyphs, not logger calls.
        { value: 'accept', name: '✅ Accept this changelog' },
        {
          value: 'regenerate',
          name: '🔄 Regenerate entirely (fresh perspective)',
        },
        { value: 'refine', name: '✏️  Refine with specific feedback' },
        { value: 'add', name: '➕ Add missing information' },
        { value: 'simplify', name: '📝 Simplify and make more concise' },
        { value: 'technical', name: '🔧 Make more technical/detailed' },
        { value: 'manual', name: '✍️  Write manually' },
        // oxlint-disable-next-line socket/no-status-emoji -- interactive prompt menu label needs glyph, not logger call.
        { value: 'cancel', name: '❌ Cancel' },
      ],
    })

    if (action === 'accept') {
      return currentEntry
    }

    if (action === 'cancel') {
      const confirmCancel = await prompts.confirm({
        message: 'Are you sure you want to cancel the version bump?',
        default: false,
      })
      if (confirmCancel) {
        throw new Error('Version bump cancelled by user')
      }
      continue
    }

    if (action === 'manual') {
      logger.log('')
      logger.log(
        'Enter the changelog manually (paste and press Enter twice when done):',
      )
      const rl = createReadline()
      let manualEntry = ''
      return new Promise((resolve, reject) => {
        rl.on('line', line => {
          if (line === '' && manualEntry.endsWith('\n')) {
            rl.close()
            resolve(manualEntry.trim())
          } else {
            manualEntry += `${line}\n`
          }
        })
        rl.on('close', () => {
          if (manualEntry.trim()) {
            resolve(manualEntry.trim())
          } else {
            reject(new Error('No manual entry provided'))
          }
        })
      })
    }

    // Handle AI-based refinements
    let feedbackPrompt = ''

    if (action === 'regenerate') {
      regenerateCount++
      feedbackPrompt = `Generate a completely different changelog entry. This is attempt #${regenerateCount + 1}.
Try a different perspective or focus on different aspects of the changes.

Original entry for reference:
${changelogEntry}

Generate a fresh changelog entry with the same version information but different wording and potentially different emphasis.`
    } else if (action === 'refine') {
      const feedback = await prompts.input({
        message: 'Describe what changes you want:',
        validate: value => (value.trim() ? true : 'Please provide feedback'),
      })

      feedbackPrompt = `Refine this changelog based on the feedback:

Current entry:
${currentEntry}

Feedback: ${feedback}

Provide the refined changelog entry.`
    } else if (action === 'add') {
      const additions = await prompts.input({
        message: 'What information is missing?',
        validate: value =>
          value.trim() ? true : 'Please describe what to add',
      })

      feedbackPrompt = `Add the following information to the changelog:

Current entry:
${currentEntry}

Information to add: ${additions}

Provide the updated changelog with the new information integrated appropriately.`
    } else if (action === 'simplify') {
      feedbackPrompt = `Simplify and make this changelog more concise:

Current entry:
${currentEntry}

Make it shorter and clearer, focusing only on the most important changes. Remove any redundancy or overly technical details that aren't essential for users.`
    } else if (action === 'technical') {
      feedbackPrompt = `Make this changelog more technical and detailed:

Current entry:
${currentEntry}

Add technical details, specific file changes, implementation details, and any breaking changes or migration notes. Be more precise about what changed internally.`
    }

    // Send to Claude for refinement
    if (feedbackPrompt) {
      logger.progress('Updating changelog with Claude')

      const refineResult = await runCommandWithOutput(claudeCmd, [], {
        input: feedbackPrompt,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      if (refineResult.exitCode === 0) {
        currentEntry = refineResult.stdout.trim()
        logger.done('Changelog updated')
      } else {
        logger.failed('Failed to update changelog')
        const retry = await prompts.confirm({
          message: 'Failed to update. Try again?',
          default: true,
        })
        if (!retry) {
          return currentEntry
        }
      }
    }
  }
}

/**
 * Check if this is the registry package.
 */
export function isRegistryPackage(): boolean {
  return existsSync(path.join(rootPath, 'registry', 'package.json'))
}

/**
 * Prompt user for input.
 */
export async function prompt(
  question: string,
  defaultValue: string = '',
): Promise<string> {
  const rl: readline.Interface = createReadline()
  return new Promise<string>(resolve => {
    const displayDefault: string = defaultValue ? ` (${defaultValue})` : ''
    rl.question(`${question}${displayDefault}: `, (answer: string) => {
      rl.close()
      resolve(answer.trim() || defaultValue)
    })
  })
}

/**
 * Read package.json from the project.
 */
export async function readPackageJson(
  pkgPath: string = rootPath,
): Promise<PackageJson> {
  const packageJsonPath: string = path.join(pkgPath, 'package.json')
  const content: string = await fs.readFile(packageJsonPath, 'utf8')
  return JSON.parse(content) as PackageJson
}

/**
 * Review and refine changelog with user feedback.
 * Uses interactive prompts if available, falls back to basic readline prompts.
 */
export async function reviewChangelog(
  claudeCmd: string,
  changelogEntry: string,
  interactive: boolean = false,
): Promise<string> {
  logger.log('')
  logger.log(`${colors.blue('━'.repeat(60))}`)
  logger.log(colors.blue('Proposed Changelog Entry:'))
  logger.log(colors.blue('━'.repeat(60)))
  logger.log(changelogEntry)
  logger.log(`${colors.blue('━'.repeat(60))}`)
  logger.log('')

  // Use interactive prompts if available and requested
  if (interactive && prompts) {
    return await interactiveReviewChangelog(claudeCmd, changelogEntry)
  }

  // Fall back to basic prompts
  while (true) {
    const response = await prompt('Accept this changelog? (yes/no/edit)', 'yes')

    if (response.toLowerCase().startsWith('y')) {
      return changelogEntry
    }

    if (response.toLowerCase() === 'edit') {
      const feedback = await prompt(
        'Provide feedback for Claude to refine the changelog',
      )

      if (!feedback) {
        continue
      }

      logger.progress('Refining changelog with Claude')

      const refinePrompt = `Please refine this changelog entry based on the following feedback:

Current changelog entry:
${changelogEntry}

Feedback:
${feedback}

Provide the refined changelog entry in the same format.`

      const refineResult = await runCommandWithOutput(claudeCmd, [], {
        input: refinePrompt,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      if (refineResult.exitCode === 0) {
        changelogEntry = refineResult.stdout.trim()
        logger.done('Changelog refined')

        logger.log('')
        logger.log(`${colors.blue('━'.repeat(60))}`)
        logger.log(colors.blue('Refined Changelog Entry:'))
        logger.log(colors.blue('━'.repeat(60)))
        logger.log(changelogEntry)
        logger.log(`${colors.blue('━'.repeat(60))}`)
        logger.log('')
      } else {
        logger.failed('Failed to refine changelog')
      }
    } else if (response.toLowerCase() === 'no') {
      // Allow manual editing
      const manualEntry = await prompt(
        'Enter changelog manually (or press Enter to cancel)',
      )
      if (manualEntry) {
        return manualEntry
      }
      throw new Error('Changelog generation cancelled')
    }
  }
}

export async function runCommand(
  command: string,
  args: string[] = [],
  options: SpawnOptions = {},
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const spawnPromise: SpawnResult = spawn(command, args, {
      stdio: 'inherit',
      cwd: rootPath,
      ...(WIN32 && { shell: true }),
      ...options,
    })

    const child = spawnPromise.process

    child.on('exit', (code: number | null) => {
      resolve(code || 0)
    })

    child.on('error', (e: unknown) => {
      reject(e)
    })
  })
}

export async function runCommandWithOutput(
  command: string,
  args: string[] = [],
  options: SpawnOptions & { input?: string | undefined } = {},
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    let stdout: string = ''
    let stderr: string = ''

    const spawnPromise: SpawnResult = spawn(command, args, {
      cwd: rootPath,
      ...(WIN32 && { shell: true }),
      ...options,
    })

    const child = spawnPromise.process

    if (child.stdout) {
      child.stdout.on('data', data => {
        stdout += data
      })
    }

    if (child.stderr) {
      child.stderr.on('data', data => {
        stderr += data
      })
    }

    child.on('exit', code => {
      resolve({ exitCode: code || 0, stdout, stderr })
    })

    child.on('error', error => {
      reject(error)
    })
  })
}

/**
 * Update CHANGELOG.md with new entry.
 */
export async function updateChangelog(changelogEntry: string): Promise<void> {
  const changelogPath = path.join(rootPath, 'CHANGELOG.md')

  let existingContent = ''
  if (existsSync(changelogPath)) {
    existingContent = await fs.readFile(changelogPath, 'utf8')
  } else {
    // Create new changelog with header
    existingContent = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelogger.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

`
  }

  // Insert new entry after the header but before existing entries
  const headerEnd = existingContent.indexOf('\n## ')
  if (headerEnd > 0) {
    // Insert before first version entry
    existingContent = `${existingContent.slice(0, headerEnd)}\n${changelogEntry}\n${existingContent.slice(headerEnd)}`
  } else {
    // Append to end
    existingContent += `\n${changelogEntry}\n`
  }

  await fs.writeFile(changelogPath, existingContent)
}

/**
 * Write package.json to the project.
 */
export async function writePackageJson(
  pkgJson: PackageJson,
  pkgPath: string = rootPath,
): Promise<void> {
  const packageJsonPath: string = path.join(pkgPath, 'package.json')
  await fs.writeFile(packageJsonPath, `${JSON.stringify(pkgJson, null, 2)}\n`)
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
        logger.log('  (install @socketsecurity/lib-stable or build local registry)')
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
      changelogEntry = await reviewChangelog(
        claudeCmd,
        changelogEntry,
        values.interactive,
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
