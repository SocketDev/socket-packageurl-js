/**
 * @file Interactive changelog-review flow using advanced select/input prompts.
 *   Loaded conditionally by the bump CLI when prompts are available.
 */

import colors from 'yoctocolors-cjs'

import { createReadline, logger, runCommandWithOutput } from './bump-lib.mts'

/**
 * Interactive review using advanced prompts. Provides a better user experience
 * with select menus and structured feedback.
 */
export async function interactiveReviewChangelog(
  claudeCmd: string,
  changelogEntry: string,
  prompts: Record<string, (...args: unknown[]) => Promise<unknown>>,
): Promise<string> {
  let currentEntry: string = changelogEntry
  let regenerateCount: number = 0

  while (true) {
    // Show the current changelog
    logger.log('')
    logger.log(colors.cyan('Current Changelog Entry:'))
    logger.log(colors.dim('─'.repeat(60)))
    logger.log(currentEntry)
    logger.log(colors.dim('─'.repeat(60)))
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
