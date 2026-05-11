/**
 * @fileoverview Validates that no package.json files contain link: dependencies.
 * Link dependencies are prohibited - use workspace: or catalog: instead.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..', '..')

type DependencyField =
  | 'dependencies'
  | 'devDependencies'
  | 'peerDependencies'
  | 'optionalDependencies'

type PackageJsonLike = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

type LinkDependencyViolation = {
  file: string
  field: DependencyField
  package: string
  value: string
}

/**
 * Check if a package.json contains link: dependencies.
 */
export async function checkPackageJson(
  filePath: string,
): Promise<LinkDependencyViolation[]> {
  const content = await fs.readFile(filePath, 'utf8')
  const pkg = JSON.parse(content) as PackageJsonLike

  const violations: LinkDependencyViolation[] = []

  // Check dependencies.
  if (pkg.dependencies) {
    for (const [name, version] of Object.entries(pkg.dependencies)) {
      if (typeof version === 'string' && version.startsWith('link:')) {
        violations.push({
          file: filePath,
          field: 'dependencies',
          package: name,
          value: version,
        })
      }
    }
  }

  // Check devDependencies.
  if (pkg.devDependencies) {
    for (const [name, version] of Object.entries(pkg.devDependencies)) {
      if (typeof version === 'string' && version.startsWith('link:')) {
        violations.push({
          file: filePath,
          field: 'devDependencies',
          package: name,
          value: version,
        })
      }
    }
  }

  // Check peerDependencies.
  if (pkg.peerDependencies) {
    for (const [name, version] of Object.entries(pkg.peerDependencies)) {
      if (typeof version === 'string' && version.startsWith('link:')) {
        violations.push({
          file: filePath,
          field: 'peerDependencies',
          package: name,
          value: version,
        })
      }
    }
  }

  // Check optionalDependencies.
  if (pkg.optionalDependencies) {
    for (const [name, version] of Object.entries(pkg.optionalDependencies)) {
      if (typeof version === 'string' && version.startsWith('link:')) {
        violations.push({
          file: filePath,
          field: 'optionalDependencies',
          package: name,
          value: version,
        })
      }
    }
  }

  return violations
}

/**
 * Find all package.json files in the repository.
 */
export async function findPackageJsonFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    // Skip node_modules, .git, and build directories.
    if (
      entry.name === 'node_modules' ||
      entry.name === '.git' ||
      entry.name === 'build' ||
      entry.name === 'dist'
    ) {
      continue
    }

    if (entry.isDirectory()) {
      files.push(...(await findPackageJsonFiles(fullPath)))
    } else if (entry.name === 'package.json') {
      files.push(fullPath)
    }
  }

  return files
}

async function main(): Promise<void> {
  const packageJsonFiles = await findPackageJsonFiles(rootPath)
  const allViolations: LinkDependencyViolation[] = []

  for (const file of packageJsonFiles) {
    const violations = await checkPackageJson(file)
    allViolations.push(...violations)
  }

  if (allViolations.length > 0) {
    logger.fail('Found link: dependencies (prohibited)')
    logger.fail('')
    logger.fail(
      'Use workspace: protocol for monorepo packages or catalog: for centralized versions.',
    )
    logger.fail('')

    for (const violation of allViolations) {
      const relativePath = path.relative(rootPath, violation.file)
      logger.fail(`  ${relativePath}`)
      logger.fail(
        `    ${violation.field}.${violation.package}: "${violation.value}"`,
      )
    }

    logger.fail('')
    logger.fail('Replace link: with:')
    logger.fail('  - workspace: for monorepo packages')
    logger.fail('  - catalog: for centralized version management')
    logger.fail('')

    process.exitCode = 1
  } else {
    logger.success('No link: dependencies found')
  }
}

main().catch((error: unknown) => {
  logger.fail('Validation failed:', error)
  process.exitCode = 1
})
