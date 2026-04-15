/**
 * @fileoverview esbuild configuration for fast builds with smaller bundles
 */

import { builtinModules } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const srcPath = path.join(rootPath, 'src')
const distPath = path.join(rootPath, 'dist')

/**
 * Extract package info from a pnpm node_modules path.
 * @returns {{ packageName: string, version: string, subpath: string } | null}
 */
function extractPackageInfo(longPath) {
  // Scoped: node_modules/.pnpm/@scope+pkg@version/node_modules/@scope/pkg/path
  const scopedMatch = longPath.match(
    /node_modules\/\.pnpm\/@[^+/]+\+[^@/]+@([^/]+)\/node_modules\/(@[^/]+\/[^/]+)\/(.+)/,
  )
  if (scopedMatch) {
    const [, version, packageName, subpath] = scopedMatch
    return { packageName, version, subpath }
  }

  // Non-scoped: node_modules/.pnpm/pkg@version/node_modules/pkg/path
  const match = longPath.match(
    /node_modules\/\.pnpm\/[^@/]+@([^/]+)\/node_modules\/([^/]+)\/(.+)/,
  )
  if (match) {
    const [, version, packageName, subpath] = match
    return { packageName, version, subpath }
  }

  return null
}

/**
 * Build a map from original paths to shortened paths.
 * When multiple versions of a package exist, includes version in path.
 * @param {Set<string>} modulePaths
 * @returns {Map<string, string>}
 */
function buildPathMap(modulePaths) {
  // Group paths by their shortened form to detect conflicts
  // Map<shortPath, Array<{longPath, info}>>
  const shortPathGroups = new Map()

  for (const longPath of modulePaths) {
    const info = extractPackageInfo(longPath)
    if (!info) {
      continue
    }

    const shortPath = `${info.packageName}/${info.subpath}`
    if (!shortPathGroups.has(shortPath)) {
      shortPathGroups.set(shortPath, [])
    }
    shortPathGroups.get(shortPath).push({ longPath, info })
  }

  // Build final path map - include version only when there are conflicts
  const pathMap = new Map()
  for (const [shortPath, entries] of shortPathGroups) {
    if (entries.length === 1) {
      // No conflict - use clean short path
      pathMap.set(entries[0].longPath, shortPath)
    } else {
      // Conflict - include version for all conflicting paths
      for (const { longPath, info } of entries) {
        const versionedPath = `${info.packageName}@${info.version}/${info.subpath}`
        pathMap.set(longPath, versionedPath)
      }
    }
  }

  return pathMap
}

/**
 * Plugin to shorten module paths in bundled output with conflict detection.
 * Uses @babel/parser and magic-string for precise AST-based modifications.
 *
 * When multiple versions of a package exist, includes version in the path:
 * - Single version: `lodash/lib/foo.js`
 * - Multiple versions: `lodash@4.17.21/lib/foo.js`, `lodash@4.17.20/lib/foo.js`
 */
function createPathShorteningPlugin() {
  return {
    name: 'shorten-module-paths',
    setup(build) {
      build.onEnd(async result => {
        if (!result.outputFiles && result.metafile) {
          // Dynamic imports to avoid adding to production dependencies
          const fs = await import('node:fs/promises')
          const { parse } = await import('@babel/parser')
          const MagicString = (await import('magic-string')).default

          const outputs = Object.keys(result.metafile.outputs).filter(f =>
            f.endsWith('.js'),
          )

          for (const outputPath of outputs) {
            const content = await fs.readFile(outputPath, 'utf8')

            try {
              const ast = parse(content, {
                sourceType: 'module',
                plugins: [],
              })

              // Pass 1: Collect all module paths
              const modulePaths = new Set()

              for (const comment of ast.comments || []) {
                if (
                  comment.type === 'CommentLine' &&
                  comment.value.includes('node_modules')
                ) {
                  modulePaths.add(comment.value.trim())
                }
              }

              function collectPaths(node) {
                if (!node || typeof node !== 'object') {
                  return
                }

                if (
                  node.type === 'StringLiteral' &&
                  node.value?.includes('node_modules')
                ) {
                  modulePaths.add(node.value)
                }

                for (const key of Object.keys(node)) {
                  if (key === 'start' || key === 'end' || key === 'loc') {
                    continue
                  }
                  const value = node[key]
                  if (Array.isArray(value)) {
                    for (const item of value) {
                      collectPaths(item)
                    }
                  } else {
                    collectPaths(value)
                  }
                }
              }
              collectPaths(ast.program)

              // Pass 2: Build path map with conflict resolution
              const pathMap = buildPathMap(modulePaths)

              // Pass 3: Apply replacements
              const magicString = new MagicString(content)

              for (const comment of ast.comments || []) {
                if (
                  comment.type === 'CommentLine' &&
                  comment.value.includes('node_modules')
                ) {
                  const originalPath = comment.value.trim()
                  const shortPath = pathMap.get(originalPath)
                  if (shortPath && shortPath !== originalPath) {
                    magicString.overwrite(
                      comment.start,
                      comment.end,
                      `// ${shortPath}`,
                    )
                  }
                }
              }

              function applyReplacements(node) {
                if (!node || typeof node !== 'object') {
                  return
                }

                if (
                  node.type === 'StringLiteral' &&
                  node.value?.includes('node_modules')
                ) {
                  const originalPath = node.value
                  const shortPath = pathMap.get(originalPath)
                  if (shortPath && shortPath !== originalPath) {
                    magicString.overwrite(
                      node.start + 1,
                      node.end - 1,
                      shortPath,
                    )
                  }
                }

                for (const key of Object.keys(node)) {
                  if (key === 'start' || key === 'end' || key === 'loc') {
                    continue
                  }
                  const value = node[key]
                  if (Array.isArray(value)) {
                    for (const item of value) {
                      applyReplacements(item)
                    }
                  } else {
                    applyReplacements(value)
                  }
                }
              }
              applyReplacements(ast.program)

              await fs.writeFile(outputPath, magicString.toString(), 'utf8')
            } catch (e) {
              console.error(
                `Failed to shorten paths in ${outputPath}:`,
                e.message,
              )
              // Continue without failing the build
            }
          }
        }
      })
    },
  }
}

/**
 * Plugin to stub heavy @socketsecurity/lib internals that are never reached
 * by our runtime code paths, preventing them from being bundled.
 *
 * Problem:
 *   exists.js imports httpJson from @socketsecurity/lib/http-request, which
 *   imports @socketsecurity/lib/fs (for safeDelete), which statically or
 *   lazily imports:
 *     - sorts.js → external/semver.js → external/npm-pack.js (2.5MB)
 *     - globs.js → external/picomatch.js → external/pico-pack.js (260KB)
 *
 *   esbuild follows require() calls even inside lazy/conditional branches
 *   when bundle:true, so the entire transitive tree gets bundled.
 *
 * Why this is safe:
 *   - sorts.js is only used by innerReadDirNames() (for naturalCompare)
 *   - globs.js is only used by isDirEmptySync() (for getGlobMatcher)
 *   - Neither function is reachable from the httpJson → safeDelete path
 *     that exists.js actually exercises
 *   - safeDelete only needs: del (separate lazy require), pRetry, path utils
 *
 * Impact:
 *   exists.js: ~3,300KB → ~470KB (85% reduction)
 */
function createLibStubPlugin() {
  // Matches the resolved absolute paths to sorts.js and globs.js inside
  // the @socketsecurity/lib dist directory in node_modules.
  const stubPattern = /@socketsecurity\/lib\/dist\/(globs|sorts)\.js$/

  return {
    name: 'stub-unused-lib-internals',
    setup(build) {
      // onLoad (not onResolve) so we intercept after esbuild resolves the
      // relative require("./sorts") in fs.js to its full filesystem path.
      build.onLoad({ filter: stubPattern }, () => ({
        contents: 'module.exports = {}',
        loader: 'js',
      }))
    },
  }
}

// Build configuration for CommonJS output
export const buildConfig = {
  entryPoints: [`${srcPath}/index.ts`, `${srcPath}/exists.ts`],
  outdir: distPath,
  outbase: srcPath,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  // Minimum Node version from package.json
  target: 'node18',
  sourcemap: false,
  minify: false,
  treeShaking: true,
  // For bundle analysis
  metafile: true,
  logLevel: 'info',

  // Preserve module structure for better tree-shaking
  splitting: false,

  // Use plugins for path shortening and stubbing unused lib internals
  plugins: [createLibStubPlugin(), createPathShorteningPlugin()],

  // External dependencies
  external: [
    // Node.js built-ins
    ...builtinModules,
    ...builtinModules.map(m => `node:${m}`),
  ],

  // Banner for generated code
  banner: {
    js: '/* Socket PackageURL - Built with esbuild */',
  },

  // TypeScript configuration
  tsconfig: path.join(rootPath, 'tsconfig.json'),

  // Define constants for optimization
  define: {
    'process.env.NODE_ENV': JSON.stringify(
      process.env.NODE_ENV || 'production',
    ),
  },
}

// Watch configuration for development with incremental builds
// Note: The 'watch' property is extracted in build script before passing to context()
export const watchConfig = {
  ...buildConfig,
  minify: false,
  sourcemap: 'inline',
  logLevel: 'debug',
  watch: {
    // This will be extracted and not passed to context()
    // Rebuild logging is handled via plugin in build script
  },
}

/**
 * Analyze build output for size information
 */
function analyzeMetafile(metafile) {
  const outputs = Object.keys(metafile.outputs)
  let totalSize = 0

  const files = outputs.map(file => {
    const output = metafile.outputs[file]
    totalSize += output.bytes
    return {
      name: path.relative(rootPath, file),
      size: `${(output.bytes / 1024).toFixed(2)} KB`,
    }
  })

  return {
    files,
    totalSize: `${(totalSize / 1024).toFixed(2)} KB`,
  }
}

export { analyzeMetafile }
