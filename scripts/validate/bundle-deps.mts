/**
 * @fileoverview Validates that bundled vs external dependencies are correctly declared in package.json.
 *
 * Rules:
 * - Bundled packages (code copied into dist/) should be in devDependencies
 * - External packages (require() calls in dist/) should be in dependencies or peerDependencies
 * - Packages used only for building should be in devDependencies
 *
 * This ensures consumers install only what they need.
 */

import { promises as fs } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

import { errorMessage } from '../utils/error-message.mts'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..', '..')

// Node.js builtins to ignore (including node: prefix variants)
/**
 * `node:smol-*` modules are runtime-conditional builtins provided by
 * socket-btm's smol Node binary. Stock Node won't have them, but the
 * fleet's lazy-load pattern (`isBuiltin('node:smol-X') && require(...)`)
 * leaves the require call in the bundle for the smol-Node code path.
 * Treat them as builtins for the purpose of dependency validation.
 *
 * Source of truth: `socket-btm/packages/node-smol-builder/additions/
 * source-patched/lib/smol-*.js`. When socket-btm adds a new smol module
 * (`additions/source-patched/lib/smol-<name>.js` lands), append it here.
 */
const SMOL_BUILTIN_MODULES = [
  'node:smol-ffi',
  'node:smol-http',
  'node:smol-https',
  'node:smol-ilp',
  'node:smol-manifest',
  'node:smol-power',
  'node:smol-primordial',
  'node:smol-purl',
  'node:smol-sql',
  'node:smol-util',
  'node:smol-versions',
  'node:smol-vfs',
]

const BUILTIN_MODULES = new Set([
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`),
  ...SMOL_BUILTIN_MODULES,
])

type PackageJsonLike = {
  dependencies?: Record<string, string> | undefined
  devDependencies?: Record<string, string> | undefined
  peerDependencies?: Record<string, string> | undefined
}

type BundleDependencyMessage = {
  type: 'bundled-in-deps' | 'bundled-not-declared' | 'external-not-in-deps'
  package: string
  message: string
  fix: string
}

type BundleDependencyResult = {
  violations: BundleDependencyMessage[]
  warnings: BundleDependencyMessage[]
}

/**
 * Extract bundled package names from node_modules paths in comments and code.
 */
export async function extractBundledPackages(
  filePath: string,
): Promise<Set<string>> {
  const content = await fs.readFile(filePath, 'utf8')
  const bundled = new Set<string>()

  // Match node_modules paths in comments: node_modules/.pnpm/@scope+package@version/...
  // or node_modules/@scope/package/...
  // or node_modules/package/...
  const nodeModulesPattern =
    /node_modules\/(?:\.pnpm\/)?(@[^/]+\+[^@/]+|@[^/]+\/[^/]+|[^/@]+)/g

  let match
  while ((match = nodeModulesPattern.exec(content)) !== null) {
    let packageName = match[1]

    // Handle pnpm path format: @scope+package -> @scope/package
    if (packageName.includes('+')) {
      packageName = packageName.replace('+', '/')
    }

    // Filter out invalid package names (contains special chars, code fragments, etc.)
    if (
      packageName.includes('"') ||
      packageName.includes("'") ||
      packageName.includes('`') ||
      packageName.includes('${') ||
      packageName.includes('\\') ||
      packageName.includes(';') ||
      packageName.includes('\n') ||
      packageName.includes('function') ||
      packageName.includes('const') ||
      packageName.includes('let') ||
      packageName.includes('var') ||
      packageName.includes('=') ||
      packageName.includes('{') ||
      packageName.includes('}') ||
      packageName.includes('[') ||
      packageName.includes(']') ||
      packageName.includes('(') ||
      packageName.includes(')') ||
      // Filter out common false positives (strings that appear in code but aren't packages)
      packageName === 'bin' ||
      packageName === '.bin' ||
      packageName === 'npm' ||
      packageName === 'node' ||
      packageName === 'pnpm' ||
      packageName === 'yarn' ||
      packageName.length === 0 ||
      // npm package name max length
      packageName.length > 214
    ) {
      continue
    }

    bundled.add(packageName)
  }

  return bundled
}

/**
 * Extract external package names from require() and import statements in built files.
 */
export async function extractExternalPackages(
  filePath: string,
): Promise<Set<string>> {
  const raw = await fs.readFile(filePath, 'utf8')
  const content = stripComments(raw)
  const externals = new Set<string>()

  // Match require('package') / require("package").
  const requirePattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  // Match `from 'package'` / `from "package"` / `import 'package'`. Anchor
  // to a non-identifier prefix so attribute strings (e.g. inside
  // `User-Agent: "@socketregistry/packageurl-js"`) aren't matched.
  const importPattern = /(?:[\s;,({[]|^)(?:from|import)\s+['"]([^'"]+)['"]/g
  // Dynamic import() calls.
  const dynamicImportPattern = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g

  let match

  while ((match = requirePattern.exec(content)) !== null) {
    const specifier = match[1]
    if (specifier.includes('/external/')) {
      continue
    }
    if (isValidPackageSpecifier(specifier)) {
      externals.add(specifier)
    }
  }

  while ((match = importPattern.exec(content)) !== null) {
    const specifier = match[1]
    if (specifier.includes('/external/')) {
      continue
    }
    if (isValidPackageSpecifier(specifier)) {
      externals.add(specifier)
    }
  }

  while ((match = dynamicImportPattern.exec(content)) !== null) {
    const specifier = match[1]
    if (specifier.includes('/external/')) {
      continue
    }
    if (isValidPackageSpecifier(specifier)) {
      externals.add(specifier)
    }
  }

  return externals
}

/**
 * Find all JavaScript files in dist directory.
 */
export async function findDistFiles(distPath: string): Promise<string[]> {
  const files: string[] = []

  try {
    const entries = await fs.readdir(distPath, { withFileTypes: true })

    for (let i = 0, { length } = entries; i < length; i += 1) {
      const entry = entries[i]
      const fullPath = path.join(distPath, entry.name)

      if (entry.isDirectory()) {
        files.push(...(await findDistFiles(fullPath)))
      } else if (
        entry.name.endsWith('.js') ||
        entry.name.endsWith('.mjs') ||
        entry.name.endsWith('.cjs')
      ) {
        files.push(fullPath)
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
    return []
  }

  return files
}

/**
 * Get package name from a module specifier (strip subpaths).
 */
export function getPackageName(specifier: string): string | null {
  // Relative imports are not packages
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return undefined
  }

  // Subpath imports (Node.js internal imports starting with #)
  if (specifier.startsWith('#')) {
    return undefined
  }

  // Filter out template strings, boolean strings, and other non-package patterns
  if (
    specifier.includes('${') ||
    specifier.includes('"}') ||
    specifier.includes('`') ||
    specifier === 'true' ||
    specifier === 'false' ||
    specifier === 'null' ||
    specifier === 'undefined' ||
    specifier.length === 0 ||
    // Filter out strings that look like code fragments
    specifier.includes('\n') ||
    specifier.includes(';') ||
    specifier.includes('function') ||
    specifier.includes('const ') ||
    specifier.includes('let ') ||
    specifier.includes('var ') ||
    // Filter out common non-package strings
    specifier.includes('"') ||
    specifier.includes("'") ||
    specifier.includes('\\')
  ) {
    return undefined
  }

  // Scoped package: @scope/package or @scope/package/subpath
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`
    }
    return undefined
  }

  // Regular package: package or package/subpath
  const parts = specifier.split('/')
  return parts[0]
}

/**
 * Check if a string is a valid package specifier.
 */
export function isValidPackageSpecifier(specifier: string): boolean {
  // Relative imports
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return false
  }

  // Subpath imports (Node.js internal imports starting with #)
  if (specifier.startsWith('#')) {
    return false
  }

  // Filter out invalid patterns
  if (
    specifier.includes('${') ||
    specifier.includes('"}') ||
    specifier.includes('`') ||
    specifier === 'true' ||
    specifier === 'false' ||
    specifier === 'null' ||
    specifier === 'undefined' ||
    specifier === 'name' ||
    specifier === 'dependencies' ||
    specifier === 'devDependencies' ||
    specifier === 'peerDependencies' ||
    specifier === 'version' ||
    specifier === 'description' ||
    specifier.length === 0 ||
    // Filter out strings that look like code fragments
    specifier.includes('\n') ||
    specifier.includes(';') ||
    specifier.includes('function') ||
    specifier.includes('const ') ||
    specifier.includes('let ') ||
    specifier.includes('var ')
  ) {
    return false
  }

  return true
}

/**
 * Read and parse package.json.
 */
export async function readPackageJson(): Promise<PackageJsonLike> {
  const packageJsonPath = path.join(rootPath, 'package.json')
  const content = await fs.readFile(packageJsonPath, 'utf8')
  return JSON.parse(content)
}

/**
 * Strip /* ... *\/ block comments and leading // line comments so the
 * import/require regex below doesn't match specifiers that appear
 * inside JSDoc examples or doc comments. Rolldown preserves JSDoc in
 * its output (esbuild stripped it), so the comment-aware pre-pass is
 * load-bearing for accurate dep extraction.
 */
export function stripComments(source: string): string {
  // Remove /* ... */ blocks (greedy across lines).
  let out = source.replace(/\/\*[\s\S]*?\*\//g, '')
  // Remove leading whitespace + // line comments.
  out = out.replace(/^\s*\/\/.*$/gm, '')
  return out
}

/**
 * Validate bundle dependencies.
 */
export async function validateBundleDeps(): Promise<BundleDependencyResult> {
  const distPath = path.join(rootPath, 'dist')
  const pkg = await readPackageJson()

  const dependencies = new Set(Object.keys(pkg.dependencies || {}))
  const devDependencies = new Set(Object.keys(pkg.devDependencies || {}))
  const peerDependencies = new Set(Object.keys(pkg.peerDependencies || {}))

  // Find all dist files
  const distFiles = await findDistFiles(distPath)

  if (distFiles.length === 0) {
    logger.log('ℹ No dist files found - run build first')
    return { violations: [], warnings: [] }
  }

  // Collect all external and bundled packages
  const allExternals = new Set<string>()
  const allBundled = new Set<string>()

  for (let i = 0, { length } = distFiles; i < length; i += 1) {
    const file = distFiles[i]
    const externals = await extractExternalPackages(file)
    const bundled = await extractBundledPackages(file)

    for (let i = 0, { length } = externals; i < length; i += 1) {
      const ext = externals[i]
      const packageName = getPackageName(ext)
      if (packageName && !BUILTIN_MODULES.has(packageName)) {
        allExternals.add(packageName)
      }
    }

    for (let i = 0, { length } = bundled; i < length; i += 1) {
      const bun = bundled[i]
      allBundled.add(bun)
    }
  }

  const violations: BundleDependencyMessage[] = []
  const warnings: BundleDependencyMessage[] = []

  // Validate external packages are in dependencies or peerDependencies
  for (let i = 0, { length } = allExternals; i < length; i += 1) {
    const packageName = allExternals[i]
    if (!dependencies.has(packageName) && !peerDependencies.has(packageName)) {
      violations.push({
        type: 'external-not-in-deps',
        package: packageName,
        message: `External package "${packageName}" is marked external but not in dependencies`,
        fix: devDependencies.has(packageName)
          ? `RECOMMENDED: Remove "${packageName}" from esbuild's "external" array to bundle it (keep in devDependencies)\n  OR: Move "${packageName}" to dependencies if it must stay external`
          : `RECOMMENDED: Remove "${packageName}" from esbuild's "external" array to bundle it\n  OR: Add "${packageName}" to dependencies if it must stay external`,
      })
    }
  }

  // Validate bundled packages are in devDependencies (not dependencies)
  for (let i = 0, { length } = allBundled; i < length; i += 1) {
    const packageName = allBundled[i]
    if (dependencies.has(packageName)) {
      violations.push({
        type: 'bundled-in-deps',
        package: packageName,
        message: `Bundled package "${packageName}" should be in devDependencies, not dependencies`,
        fix: `Move "${packageName}" from dependencies to devDependencies (code is bundled into dist/)`,
      })
    }

    if (!devDependencies.has(packageName) && !dependencies.has(packageName)) {
      warnings.push({
        type: 'bundled-not-declared',
        package: packageName,
        message: `Bundled package "${packageName}" is not declared in devDependencies`,
        fix: `Add "${packageName}" to devDependencies`,
      })
    }
  }

  return { violations, warnings }
}

async function main(): Promise<void> {
  try {
    const { violations, warnings } = await validateBundleDeps()

    if (violations.length === 0 && warnings.length === 0) {
      logger.success('Bundle dependencies validation passed')
      process.exitCode = 0
      return
    }

    if (violations.length > 0) {
      logger.fail('Bundle dependencies validation failed')
      logger.error('')

      for (let i = 0, { length } = violations; i < length; i += 1) {
        const violation = violations[i]
        logger.fail(`  ${violation.message}`)
        logger.fail(`  ${violation.fix}`)
        logger.fail('')
      }
    }

    if (warnings.length > 0) {
      logger.warn('Warnings:')
      logger.error('')

      for (let i = 0, { length } = warnings; i < length; i += 1) {
        const warning = warnings[i]
        logger.log(`  ${warning.message}`)
        logger.log(`  ${warning.fix}`)
        logger.log('')
      }
    }

    // Only fail on violations, not warnings
    process.exitCode = violations.length > 0 ? 1 : 0
  } catch (e) {
    const message = errorMessage(e)
    logger.fail('Validation failed:', message)
    process.exitCode = 1
  }
}

main()
