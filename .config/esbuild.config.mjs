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
 * Plugin to handle local package aliases.
 * Provides consistent alias resolution across all Socket repos.
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
      // Intercept imports for aliased packages
      for (const [packageName, aliasPath] of Object.entries(aliases)) {
        // Match both exact package name and subpath imports
        build.onResolve(
          { filter: new RegExp(`^${packageName}(/|$)`) },
          args => {
            // Handle subpath imports like '@socketsecurity/lib/spinner'
            const subpath = args.path.slice(packageName.length + 1)
            const resolvedPath = subpath
              ? path.join(aliasPath, subpath)
              : aliasPath
            return { path: resolvedPath, external: true }
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

  // Use plugin for local package aliases (consistent across all Socket repos)
  plugins: [createAliasPlugin()].filter(Boolean),

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
