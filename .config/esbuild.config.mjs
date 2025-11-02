/**
 * @fileoverview esbuild configuration for fast builds with smaller bundles
 */

import { builtinModules } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getLocalPackageAliases } from '../scripts/utils/get-local-package-aliases.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const srcPath = path.join(rootPath, 'src')
const distPath = path.join(rootPath, 'dist')

/**
 * Plugin to shorten module paths in bundled output with conflict detection.
 * Uses @babel/parser and magic-string for precise AST-based modifications.
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
            const magicString = new MagicString(content)

            // Track module paths and their shortened versions
            // Map<originalPath, shortenedPath>
            const pathMap = new Map()
            // Track shortened paths to detect conflicts
            // Map<shortenedPath, originalPath>
            const conflictDetector = new Map()

            /**
             * Shorten a module path and detect conflicts.
             */
            function shortenPath(longPath) {
              if (pathMap.has(longPath)) {
                return pathMap.get(longPath)
              }

              let shortPath = longPath

              // Handle pnpm scoped packages
              // node_modules/.pnpm/@scope+pkg@version/node_modules/@scope/pkg/dist/file.js
              // -> @scope/pkg/dist/file.js
              const scopedPnpmMatch = longPath.match(
                /node_modules\/\.pnpm\/@([^+/]+)\+([^@/]+)@[^/]+\/node_modules\/(@[^/]+\/[^/]+)\/(.+)/,
              )
              if (scopedPnpmMatch) {
                const [, _scope, _pkg, packageName, subpath] = scopedPnpmMatch
                shortPath = `${packageName}/${subpath}`
              } else {
                // Handle pnpm non-scoped packages
                // node_modules/.pnpm/pkg@version/node_modules/pkg/dist/file.js
                // -> pkg/dist/file.js
                const pnpmMatch = longPath.match(
                  /node_modules\/\.pnpm\/([^@/]+)@[^/]+\/node_modules\/([^/]+)\/(.+)/,
                )
                if (pnpmMatch) {
                  const [, _pkgName, packageName, subpath] = pnpmMatch
                  shortPath = `${packageName}/${subpath}`
                }
              }

              // Detect conflicts
              if (conflictDetector.has(shortPath)) {
                const existingPath = conflictDetector.get(shortPath)
                if (existingPath !== longPath) {
                  // Conflict detected - keep original path
                  console.warn(
                    `⚠ Path conflict detected:\n  "${shortPath}"\n  Maps to: "${existingPath}"\n  Also from: "${longPath}"\n  Keeping original paths to avoid conflict.`,
                  )
                  shortPath = longPath
                }
              } else {
                conflictDetector.set(shortPath, longPath)
              }

              pathMap.set(longPath, shortPath)
              return shortPath
            }

            // Parse AST to find all string literals containing module paths
            try {
              const ast = parse(content, {
                sourceType: 'module',
                plugins: [],
              })

              // Walk through all comments (esbuild puts module paths in comments)
              for (const comment of ast.comments || []) {
                if (
                  comment.type === 'CommentLine' &&
                  comment.value.includes('node_modules')
                ) {
                  const originalPath = comment.value.trim()
                  const shortPath = shortenPath(originalPath)

                  if (shortPath !== originalPath) {
                    // Replace in comment
                    const commentStart = comment.start
                    const commentEnd = comment.end
                    magicString.overwrite(
                      commentStart,
                      commentEnd,
                      `// ${shortPath}`,
                    )
                  }
                }
              }

              // Walk through all string literals in __commonJS calls
              function walk(node) {
                if (!node || typeof node !== 'object') {
                  return
                }

                // Check for string literals containing node_modules paths
                if (
                  node.type === 'StringLiteral' &&
                  node.value &&
                  node.value.includes('node_modules')
                ) {
                  const originalPath = node.value
                  const shortPath = shortenPath(originalPath)

                  if (shortPath !== originalPath) {
                    // Replace the string content (keep quotes)
                    magicString.overwrite(
                      node.start + 1,
                      node.end - 1,
                      shortPath,
                    )
                  }
                }

                // Recursively walk all properties
                for (const key of Object.keys(node)) {
                  if (key === 'start' || key === 'end' || key === 'loc') {
                    continue
                  }
                  const value = node[key]
                  if (Array.isArray(value)) {
                    for (const item of value) {
                      walk(item)
                    }
                  } else {
                    walk(value)
                  }
                }
              }

              walk(ast.program)

              // Write the modified content
              await fs.writeFile(outputPath, magicString.toString(), 'utf8')
            } catch (error) {
              console.error(
                `Failed to shorten paths in ${outputPath}:`,
                error.message,
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
 * Plugin to handle local package aliases.
 * Provides consistent alias resolution across all Socket repos.
 * Note: Does not externalize @socketsecurity/lib - that should be bundled.
 */
function createAliasPlugin() {
  const aliases = getLocalPackageAliases(rootPath)

  // Only create plugin if we have local aliases
  if (Object.keys(aliases).length === 0) {
    return null
  }

  return {
    name: 'local-package-aliases',
    setup(build) {
      // Intercept imports for aliased packages (except @socketsecurity/lib which should be bundled)
      for (const [packageName, _aliasPath] of Object.entries(aliases)) {
        // Skip @socketsecurity/lib - it should be bundled, not externalized
        if (packageName === '@socketsecurity/lib') {
          continue
        }

        // Match both exact package name and subpath imports
        build.onResolve(
          { filter: new RegExp(`^${packageName}(/|$)`) },
          args => {
            // Mark as external using the original package name to avoid absolute paths in output.
            // This ensures require('@socketsecurity/lib') instead of require('/absolute/path/to/socket-lib/dist').
            return { path: args.path, external: true }
          },
        )
      }
    },
  }
}

// Build configuration for CommonJS output
export const buildConfig = {
  entryPoints: [`${srcPath}/index.ts`],
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

  // Use plugins for local package aliases and path shortening
  plugins: [createPathShorteningPlugin(), createAliasPlugin()].filter(Boolean),

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
