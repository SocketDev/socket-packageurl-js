import { existsSync } from 'node:fs'
import path from 'node:path'

import colors from 'yoctocolors-cjs'

import constants from '@socketsecurity/registry/lib/constants'
import { logger } from '@socketsecurity/registry/lib/logger'
import { parseArgs } from '@socketsecurity/registry/lib/parse-args'
import { indentString } from '@socketsecurity/registry/lib/strings'

import { getCodeCoverage } from '@socketsecurity/registry/lib/cover/code'
import { getTypeCoverage } from '@socketsecurity/registry/lib/cover/type'

/**
 * Logs coverage percentage data including code and type coverage metrics.
 * Supports multiple output formats: default (formatted), JSON, and simple.
 */
async function logCoveragePercentage(argv) {
  const { spinner } = constants

  // Check if coverage data exists to determine whether to generate or read it
  const coverageJsonPath = path.join(
    process.cwd(),
    'coverage',
    'coverage-final.json',
  )

  // Get code coverage metrics (statements, branches, functions, lines)
  let codeCoverage
  try {
    // Only show spinner in default output mode (not JSON or simple)
    if (!argv.json && !argv.simple) {
      if (!existsSync(coverageJsonPath)) {
        spinner.start('Generating coverage data...')
      } else {
        spinner.start('Reading coverage data...')
      }
    }

    codeCoverage = await getCodeCoverage()

    if (!argv.json && !argv.simple) {
      spinner.stop()
    }
  } catch (error) {
    if (!argv.json && !argv.simple) {
      spinner.stop()
    }
    logger.error('Failed to get code coverage:', error.message)
    throw error
  }

  // Get type coverage (optional - if it fails, we continue without it)
  let typeCoveragePercent = null
  try {
    typeCoveragePercent = await getTypeCoverage()
  } catch (error) {
    logger.error('Failed to get type coverage:', error.message)
    // Continue without type coverage - it's not critical
  }

  // Calculate overall percentage (average of all metrics including type coverage if available)
  const codeCoverageMetrics = [
    parseFloat(codeCoverage.statements.percent),
    parseFloat(codeCoverage.branches.percent),
    parseFloat(codeCoverage.functions.percent),
    parseFloat(codeCoverage.lines.percent),
  ]

  let overall
  if (typeCoveragePercent !== null) {
    // Include type coverage in the overall calculation
    const allMetrics = [...codeCoverageMetrics, typeCoveragePercent]
    overall = (
      allMetrics.reduce((a, b) => a + b, 0) / allMetrics.length
    ).toFixed(2)
  } else {
    // Fallback to just code coverage metrics when type coverage is unavailable
    overall = (
      codeCoverageMetrics.reduce((a, b) => a + b, 0) /
      codeCoverageMetrics.length
    ).toFixed(2)
  }

  // Select an emoji based on overall coverage percentage for visual feedback
  const overallNum = parseFloat(overall)
  let emoji = ''
  if (overallNum >= 99) {
    // Excellent coverage
    emoji = ' 🚀'
  } else if (overallNum >= 95) {
    // Great coverage
    emoji = ' 🎯'
  } else if (overallNum >= 90) {
    // Very good coverage
    emoji = ' ✨'
  } else if (overallNum >= 80) {
    // Good coverage
    emoji = ' 💪'
  } else if (overallNum >= 70) {
    // Decent coverage
    emoji = ' 📈'
  } else if (overallNum >= 60) {
    // Fair coverage
    emoji = ' ⚡'
  } else if (overallNum >= 50) {
    // Needs improvement
    emoji = ' 🔨'
  } else {
    // Low coverage warning
    emoji = ' ⚠️'
  }

  // Output the coverage data in the requested format
  if (argv.json) {
    // JSON format: structured output for programmatic consumption
    const jsonOutput = {
      statements: codeCoverage.statements,
      branches: codeCoverage.branches,
      functions: codeCoverage.functions,
      lines: codeCoverage.lines,
    }

    if (typeCoveragePercent !== null) {
      jsonOutput.types = {
        percent: typeCoveragePercent.toFixed(2),
      }
    }

    jsonOutput.overall = overall

    console.log(JSON.stringify(jsonOutput, null, 2))
  } else if (argv.simple) {
    // Simple format: just the statement coverage percentage
    console.log(codeCoverage.statements.percent)
  } else {
    // Default format: human-readable formatted output
    const summaryLines = [
      `Statements: ${codeCoverage.statements.percent}% (${codeCoverage.statements.covered}/${codeCoverage.statements.total})`,
      `Branches:   ${codeCoverage.branches.percent}% (${codeCoverage.branches.covered}/${codeCoverage.branches.total})`,
      `Functions:  ${codeCoverage.functions.percent}% (${codeCoverage.functions.covered}/${codeCoverage.functions.total})`,
      `Lines:      ${codeCoverage.lines.percent}% (${codeCoverage.lines.covered}/${codeCoverage.lines.total})`,
    ]

    if (typeCoveragePercent !== null) {
      summaryLines.push(`Types:      ${typeCoveragePercent.toFixed(2)}%`)
    }

    logger.info(`Coverage Summary:`)
    logger.info(indentString(summaryLines.join('\n'), 2))
    logger.info('')
    logger.info(colors.bold(`Current coverage: ${overall}% overall!${emoji}`))
  }
}

// Main entry point - parse command line arguments and display coverage
async function main() {
  const { values } = parseArgs({
    options: {
      json: {
        type: 'boolean',
        short: 'j',
        default: false,
      },
      simple: {
        type: 'boolean',
        short: 's',
        default: false,
      },
    },
  })
  await logCoveragePercentage(values)
}

main().catch(console.error)
