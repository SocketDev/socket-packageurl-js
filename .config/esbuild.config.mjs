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
  minify: true,
  treeShaking: true,
  // For bundle analysis
  metafile: true,
  logLevel: 'info',

  // Preserve module structure for better tree-shaking
  splitting: false,

  // Alias local packages when available (dev mode).
  alias: getLocalPackageAliases(rootPath),

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
