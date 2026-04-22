/**
 * @fileoverview Validates that there are no CDN references in the codebase.
 *
 * This is a preventative check to ensure no hardcoded CDN URLs are introduced.
 * The project deliberately avoids CDN dependencies for security and reliability.
 *
 * Blocked CDN domains:
 * - unpkg.com
 * - cdn.jsdelivr.net
 * - esm.sh
 * - cdn.skypack.dev
 * - ga.jspm.io
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import loggerPkg from '@socketsecurity/lib/logger'

const logger = loggerPkg.getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..', '..')

// CDN domains to block
const CDN_PATTERNS = [
  /unpkg\.com/i,
  /cdn\.jsdelivr\.net/i,
  /esm\.sh/i,
  /cdn\.skypack\.dev/i,
  /ga\.jspm\.io/i,
]

// Directories to skip
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.cache',
  'coverage',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.type-coverage',
  '.yarn',
  // Vendored third-party submodule — meander's own code legitimately
  // ships CDN references that we don't control and shouldn't rewrite.
  'upstream',
  // Generated output — the walkthrough HTML loads unpkg bundles for
  // marked + highlight.js by design. Integrity + CSP hashes protect
  // those loads; the bare URL strings are expected.
  'walkthrough',
])

// File extensions to check
const TEXT_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.cts',
  '.jsx',
  '.tsx',
  '.json',
  '.md',
  '.html',
  '.htm',
  '.css',
  '.yml',
  '.yaml',
  '.xml',
  '.svg',
  '.txt',
  '.sh',
  '.bash',
])

type CdnViolation = {
  file: string
  line: number
  content: string
  cdnDomain: string
}

type NodeError = Error & {
  code?: string
}

/**
 * Check if file should be scanned.
 */
function shouldScanFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase()
  return TEXT_EXTENSIONS.has(ext)
}

/**
 * Recursively find all text files to scan.
 */
async function findTextFiles(
  dir: string,
  files: string[] = [],
): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        // Skip certain directories and hidden directories (except .github)
        if (
          !SKIP_DIRS.has(entry.name) &&
          (!entry.name.startsWith('.') || entry.name === '.github')
        ) {
          await findTextFiles(fullPath, files)
        }
      } else if (entry.isFile() && shouldScanFile(entry.name)) {
        files.push(fullPath)
      }
    }
  } catch {
    // Skip directories we can't read
  }

  return files
}

/**
 * Check file contents for CDN references.
 */
// Files that legitimately reference CDN domains as data (regex
// patterns, URL-extraction helpers, doc comments explaining which
// CDN the code is built to handle). These aren't runtime loads — they
// are the build-side tooling that inspects, fetches, hashes, and
// rewrites CDN URLs for SRI + CSP enforcement. The validator's intent
// ("no accidental CDN runtime dependencies") doesn't apply here.
const ALLOWED_FILES = [
  /no-cdn-refs\.(m?[jt]s|cjs)$/, // self-skip
  // Build tooling for the walkthrough pilot — these files enumerate,
  // fetch, hash, and rewrite CDN references so they can ship with
  // integrity + CSP hashes. Any CDN reference in them is in the
  // scanner/rewriter, not a runtime dependency.
  /scripts[\\/]walkthrough\.mts$/,
  /scripts[\\/]audit-deps\.mts$/,
]

async function checkFileForCdnRefs(filePath: string): Promise<CdnViolation[]> {
  if (ALLOWED_FILES.some(re => re.test(filePath))) {
    return []
  }

  try {
    const content = await fs.readFile(filePath, 'utf8')
    const lines = content.split('\n')
    const violations: CdnViolation[] = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineNumber = i + 1

      for (const pattern of CDN_PATTERNS) {
        if (pattern.test(line)) {
          const match: RegExpMatchArray | null = line.match(pattern)
          if (match) {
            violations.push({
              file: path.relative(rootPath, filePath),
              line: lineNumber,
              content: line.trim(),
              cdnDomain: match[0],
            })
          }
        }
      }
    }

    return violations
  } catch (error) {
    const nodeError = error as NodeError
    // Skip files we can't read (likely binary despite extension)
    if (nodeError.code === 'EISDIR' || nodeError.message.includes('ENOENT')) {
      return []
    }
    // For other errors, try to continue
    return []
  }
}

/**
 * Validate all files for CDN references.
 */
async function validateNoCdnRefs(): Promise<CdnViolation[]> {
  const files = await findTextFiles(rootPath)
  const allViolations: CdnViolation[] = []

  for (const file of files) {
    const violations = await checkFileForCdnRefs(file)
    allViolations.push(...violations)
  }

  return allViolations
}

async function main(): Promise<void> {
  try {
    const violations = await validateNoCdnRefs()

    if (violations.length === 0) {
      logger.success('No CDN references found')
      process.exitCode = 0
      return
    }

    logger.fail(`Found ${violations.length} CDN reference(s)`)
    logger.log('')
    logger.log('CDN URLs are not allowed in this codebase for security and')
    logger.log('reliability reasons. Please use npm packages instead.')
    logger.log('')
    logger.log('Blocked CDN domains:')
    logger.log('  - unpkg.com')
    logger.log('  - cdn.jsdelivr.net')
    logger.log('  - esm.sh')
    logger.log('  - cdn.skypack.dev')
    logger.log('  - ga.jspm.io')
    logger.log('')
    logger.log('Violations:')
    logger.log('')

    for (const violation of violations) {
      logger.log(`  ${violation.file}:${violation.line}`)
      logger.log(`    Domain: ${violation.cdnDomain}`)
      logger.log(`    Content: ${violation.content}`)
      logger.log('')
    }

    logger.log('Remove CDN references and use npm dependencies instead.')
    logger.log('')

    process.exitCode = 1
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.fail(`Validation failed: ${message}`)
    process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  logger.fail(`Unexpected error: ${message}`)
  process.exitCode = 1
})
