/**
 * @fileoverview Version bump script with AI-powered changelog generation.
 * Creates version bump commits with package.json, lockfile, and changelog updates.
 * Includes interactive mode for reviewing and refining AI-generated changelogs.
 */

import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

import semver from 'semver'
import colors from 'yoctocolors-cjs'

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { printFooter, printHeader } from '@socketsecurity/lib/stdio/header'

const logger = getDefaultLogger()

const rootPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const WIN32 = process.platform === 'win32'

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

let promptsPath = null
if (existsSync(localPromptsPath)) {
  promptsPath = localPromptsPath
} else if (existsSync(packagePromptsPath)) {
  promptsPath = packagePromptsPath
}

const hasInteractivePrompts = !!promptsPath

// Conditionally import interactive prompts
let prompts = null
if (hasInteractivePrompts) {
  try {
    prompts = await import(promptsPath)
  } catch {
    // Fall back to basic prompts if import fails
  }
}

/**
 * Create readline interface for user input.
 */
function createReadline() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
}

/**
 * Prompt user for input.
 */
async function prompt(question, defaultValue = '') {
  const rl = createReadline()
  return new Promise(resolve => {
    const displayDefault = defaultValue ? ` (${defaultValue})` : ''
    rl.question(`${question}${displayDefault}: `, answer => {
      rl.close()
      resolve(answer.trim() || defaultValue)
    })
  })
}

/**
 * Prompt user for yes/no confirmation.
 */
async function confirm(question, defaultYes = true) {
  const defaultHint = defaultYes ? 'Y/n' : 'y/N'
  const answer = await prompt(
    `${question} [${defaultHint}]`,
    defaultYes ? 'y' : 'n',
  )
  return answer.toLowerCase().startsWith('y')
}

async function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      cwd: rootPath,
      ...(WIN32 && { shell: true }),
      ...options,
    })

    child.on('exit', code => {
      resolve(code || 0)
    })

    child.on('error', error => {
      reject(error)
    })
  })
}

async function runCommandWithOutput(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''

    const child = spawn(command, args, {
      cwd: rootPath,
      ...(WIN32 && { shell: true }),
      ...options,
    })

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
 * Check if claude-console is available.
 */
async function checkClaude() {
  const checkCommand = WIN32 ? 'where' : 'which'
  const result = await runCommandWithOutput(checkCommand, ['claude-console'])

  if (result.exitCode !== 0) {
    // Also check common aliases
    const aliasResult = await runCommandWithOutput(checkCommand, ['claude'])
    if (aliasResult.exitCode !== 0) {
      return false
    }
    return 'claude'
  }
  return 'claude-console'
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
 * Write package.json to the project.
 */
async function writePackageJson(pkgJson, pkgPath = rootPath) {
  const packageJsonPath = path.join(pkgPath, 'package.json')
  await fs.writeFile(packageJsonPath, `${JSON.stringify(pkgJson, null, 2)}\n`)
}

/**
 * Get the current version from package.json.
 */
async function getCurrentVersion(pkgPath = rootPath) {
  const pkgJson = await readPackageJson(pkgPath)
  return pkgJson.version
}

/**
 * Determine the new version based on bump type.
 */
function getNewVersion(currentVersion, bumpType) {
  // Check if bumpType is a valid semver version
  if (semver.valid(bumpType)) {
    return bumpType
  }

  // Otherwise treat as release type
  const validTypes = [
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

  return semver.inc(currentVersion, bumpType)
}

/**
 * Check if the working directory is clean.
 */
async function checkGitStatus() {
  const result = await runCommandWithOutput('git', ['status', '--porcelain'])
  if (result.stdout.trim()) {
    logger.error('Working directory is not clean')
    logger.info('Uncommitted changes:')
    console.log(result.stdout)
    return false
  }
  return true
}

/**
 * Check if we're on the main/master branch.
 */
async function checkGitBranch() {
  const result = await runCommandWithOutput('git', [
    'rev-parse',
    '--abbrev-ref',
    'HEAD',
  ])
  const branch = result.stdout.trim()
  if (branch !== 'main' && branch !== 'master') {
    logger.warn(`Not on main/master branch (current: ${branch})`)
    return false
  }
  return true
}

/**
 * Get the last few commits for context.
 */
async function getRecentCommits(count = 20) {
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
function isRegistryPackage() {
  return existsSync(path.join(rootPath, 'registry', 'package.json'))
}

/**
 * Get package name for commit message.
 */
async function getPackageName() {
  if (isRegistryPackage()) {
    return 'registry package'
  }
  const pkgJson = await readPackageJson()
  return pkgJson.name || 'package'
}

/**
 * Generate changelog using Claude.
 */
async function generateChangelog(claudeCmd, currentVersion, newVersion) {
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
  try {
    await fs.unlink(promptPath)
  } catch {}

  if (claudeResult.exitCode !== 0) {
    logger.failed('Claude failed to generate changelog')
    throw new Error('Claude failed to generate changelog')
  }

  logger.done('Changelog generated')
  return claudeResult.stdout.trim()
}

/**
 * Update CHANGELOG.md with new entry.
 */
async function updateChangelog(changelogEntry) {
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
 * Review and refine changelog with user feedback.
 * Uses interactive prompts if available, falls back to basic readline prompts.
 */
async function reviewChangelog(claudeCmd, changelogEntry, interactive = false) {
  console.log(`\n${colors.blue('━'.repeat(60))}`)
  console.log(colors.blue('Proposed Changelog Entry:'))
  console.log(colors.blue('━'.repeat(60)))
  console.log(changelogEntry)
  console.log(`${colors.blue('━'.repeat(60))}\n`)

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

        console.log(`\n${colors.blue('━'.repeat(60))}`)
        console.log(colors.blue('Refined Changelog Entry:'))
        console.log(colors.blue('━'.repeat(60)))
        console.log(changelogEntry)
        console.log(`${colors.blue('━'.repeat(60))}\n`)
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

/**
 * Interactive review using advanced prompts.
 * Provides a better user experience with select menus and structured feedback.
 */
async function interactiveReviewChangelog(claudeCmd, changelogEntry) {
  let currentEntry = changelogEntry
  let regenerateCount = 0

  while (true) {
    // Show the current changelog
    console.log(`\n${colors.cyan('Current Changelog Entry:')}`)
    console.log(colors.dim('─'.repeat(60)))
    console.log(currentEntry)
    console.log(`${colors.dim('─'.repeat(60))}\n`)

    // Offer action choices
    const action = await prompts.select({
      message: 'What would you like to do?',
      choices: [
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
      console.log(
        '\nEnter the changelog manually (paste and press Enter twice when done):',
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

async function main() {
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
      console.log('\nUsage: pnpm bump [options]')
      console.log('\nOptions:')
      console.log('  --help           Show this help message')
      console.log('  --bump <type>    Version bump type (default: patch)')
      console.log(
        '                   Can be: major, minor, patch, premajor, preminor,',
      )
      console.log(
        '                   prepatch, prerelease, or a specific version',
      )
      console.log('  --interactive    Force interactive changelog review')
      console.log('  --no-interactive Disable interactive mode')
      console.log('  --skip-changelog Skip changelog generation with Claude')
      console.log('  --skip-checks    Skip git status/branch checks')
      console.log('  --no-push        Do not push changes to remote')
      console.log('  --force          Force bump even with warnings')
      console.log('\nExamples:')
      console.log(
        '  pnpm bump                    # Bump patch (interactive by default)',
      )
      console.log('  pnpm bump --bump=minor       # Bump minor version')
      console.log('  pnpm bump --no-interactive   # Use basic prompts')
      console.log('  pnpm bump --bump=2.0.0       # Set specific version')
      console.log(
        '  pnpm bump --skip-changelog   # Skip AI changelog generation',
      )
      console.log('\nRequires:')
      console.log('  - claude-console (or claude) CLI tool installed')
      console.log('  - Clean git working directory')
      console.log('  - Main/master branch (unless --force)')
      if (hasInteractivePrompts) {
        console.log('\nInteractive mode: Available ✓ (default)')
      } else {
        console.log('\nInteractive mode: Not available')
        console.log('  (install @socketsecurity/lib or build local registry)')
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
        logger.failed('Not on main/master branch')
        process.exitCode = 1
        return
      }
      logger.done('On main/master branch')
    }

    // Check for Claude if not skipping changelog
    let claudeCmd = null
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
          'To enable: install @socketsecurity/lib or build local registry',
        )
      }
      values.interactive = false
    }

    // Generate and review changelog
    let changelogEntry = null
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

    logger.info('\nNext steps:')
    logger.substep('1. Run `pnpm publish` to publish to npm')
    logger.substep('2. Create GitHub release if needed')

    process.exitCode = 0
  } catch (error) {
    logger.error(`Version bump failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(e => {
  logger.error(e)
  process.exitCode = 1
})
