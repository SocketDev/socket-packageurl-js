/**
 * @file Shared helpers for the version bump script. Covers version
 *   calculation, package.json I/O, git checks, command execution,
 *   changelog I/O, and basic readline prompts.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

import semver from '@socketsecurity/lib-stable/external/semver'
import colors from 'yoctocolors-cjs'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import type { Logger } from '@socketsecurity/lib-stable/logger/types'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import type {
  SpawnOptions,
  SpawnResult,
} from '@socketsecurity/lib-stable/process/spawn/types'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

export type CommandResult = {
  exitCode: number
  stderr: string
  stdout: string
}

export type PackageJson = Record<string, unknown> & {
  name?: string | undefined
  version?: string | undefined
}

export const logger: Logger = getDefaultLogger()

export const rootPath: string = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
export const WIN32: boolean = process.platform === 'win32'

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
 * inclusive-language: external-api — `master` is a real branch name in legacy
 * repos.
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
  const promptText = `Generate a changelog entry for ${packageName} version ${newVersion}.

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

  await fs.writeFile(promptPath, promptText)

  // Call Claude to generate the changelog
  logger.progress('Asking Claude to generate changelog')

  const claudeResult = await runCommandWithOutput(claudeCmd, [], {
    input: promptText,
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
 * Check if this is the registry package.
 */
export function isRegistryPackage(): boolean {
  return existsSync(path.join(rootPath, 'registry', 'package.json'))
}

/**
 * Prompt user for input.
 */
export function promptUser(
  question: string,
  defaultValue: string = '',
): Promise<string> {
  return prompt(question, defaultValue)
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
 * Review and refine changelog with user feedback. Uses interactive prompts if
 * available, falls back to basic readline prompts.
 */
export async function reviewChangelog(
  claudeCmd: string,
  changelogEntry: string,
  interactive: boolean = false,
  interactiveReviewFn?: (
    claudeCmd: string,
    changelogEntry: string,
  ) => Promise<string>,
): Promise<string> {
  logger.log('')
  logger.log(`${colors.blue('━'.repeat(60))}`)
  logger.log(colors.blue('Proposed Changelog Entry:'))
  logger.log(colors.blue('━'.repeat(60)))
  logger.log(changelogEntry)
  logger.log(`${colors.blue('━'.repeat(60))}`)
  logger.log('')

  // Use interactive prompts if available and requested
  if (interactive && interactiveReviewFn) {
    return await interactiveReviewFn(claudeCmd, changelogEntry)
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
      shell: WIN32,
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
      shell: WIN32,
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

/**
 * Prompt user for input (internal readline helper).
 */
function prompt(question: string, defaultValue: string = ''): Promise<string> {
  const rl = createReadline()
  return new Promise<string>(resolve => {
    const displayDefault = defaultValue ? ` (${defaultValue})` : ''
    rl.question(`${question}${displayDefault}: `, (answer: string) => {
      rl.close()
      resolve(answer.trim() || defaultValue)
    })
  })
}
