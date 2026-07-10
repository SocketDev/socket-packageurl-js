/**
 * @file Rolldown configuration. Mirrors the esbuild config in
 *   `esbuild.config.mjs` for byte-equivalent output during the migration
 *   dual-build phase. See `docs/rolldown-migration.md`.
 */

import { builtinModules } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import type { Plugin, RolldownOptions } from 'rolldown'

import { REPO_ROOT } from '../../scripts/fleet/paths.mts'
import { createLibStubPlugin } from './rolldown/lib-stub.mts'

const rootPath = REPO_ROOT
const srcPath = path.join(rootPath, 'src')
const distPath = path.join(rootPath, 'dist')

export type PackageInfo = {
  packageName: string
  subpath: string
  version: string
}

/**
 * Build a map from original paths to shortened paths. Includes the version only
 * when multiple versions of the same package would collapse to the same short
 * path.
 */
export function buildPathMap(
  modulePaths: ReadonlySet<string>,
): Map<string, string> {
  const shortPathGroups = new Map<
    string,
    Array<{ info: PackageInfo; longPath: string }>
  >()

  // `modulePaths` is a ReadonlySet — use for...of, not the
  // cached-length for-loop.
  for (const longPath of modulePaths) {
    const info = extractPackageInfo(longPath)
    if (!info) {
      continue
    }
    const shortPath = `${info.packageName}/${info.subpath}`
    let group = shortPathGroups.get(shortPath)
    if (!group) {
      group = []
      shortPathGroups.set(shortPath, group)
    }
    group.push({ info, longPath })
  }

  const pathMap = new Map<string, string>()
  for (const [shortPath, entries] of shortPathGroups) {
    if (entries.length === 1) {
      pathMap.set(entries[0]!.longPath, shortPath)
    } else {
      for (const { info, longPath } of entries) {
        pathMap.set(
          longPath,
          `${info.packageName}@${info.version}/${info.subpath}`,
        )
      }
    }
  }

  return pathMap
}

/**
 * Replace pnpm node_modules paths with short package-relative paths in the
 * rendered bundle. Mirrors esbuild's `createPathShorteningPlugin`.
 *
 * Uses `generateBundle` so the rewrite happens in memory before write. Operates
 * on the rendered chunk text directly (not an AST round-trip) because
 * rolldown's CJS output uses path strings inside string literals + comment
 * markers, both reachable via plain regex/string scanning. Avoiding the AST
 * cost trims build time and keeps the dependency graph lean (no @babel/parser,
 * no magic-string at build time).
 */
export function createPathShorteningPlugin(): Plugin {
  return {
    name: 'shorten-module-paths',
    generateBundle(_options, bundle) {
      const fileNames = Object.keys(bundle)
      for (let i = 0, { length } = fileNames; i < length; i += 1) {
        const fileName = fileNames[i]!
        const asset = bundle[fileName]
        if (!asset || asset.type !== 'chunk') {
          continue
        }

        const code = asset.code
        if (!code.includes('node_modules')) {
          continue
        }

        // Find every pnpm-style module path in the rendered chunk.
        const pathRegex =
          /node_modules\/\.pnpm\/(?:@[^+/]+\+[^@/]+|[^@/]+)@[^/]+\/node_modules\/(?:@[^/]+\/[^/'"`\s]+|[^/'"`\s]+)\/[^'"`\s)]+/g
        const found = new Set<string>()
        for (const match of code.matchAll(pathRegex)) {
          found.add(match[0])
        }

        if (found.size === 0) {
          continue
        }

        const pathMap = buildPathMap(found)
        if (pathMap.size === 0) {
          continue
        }

        // Order longest-first so a longer path containing a shorter
        // prefix doesn't get a partial replacement.
        // oxlint-disable-next-line unicorn/no-array-sort -- engines.node is < 20, so Array#toSorted is unavailable at the supported floor.
        const sortedKeys = [...pathMap.keys()].sort(
          (a, b) => b.length - a.length,
        )
        let next = code
        for (
          let j = 0, keysLength = sortedKeys.length;
          j < keysLength;
          j += 1
        ) {
          const key = sortedKeys[j]!
          const value = pathMap.get(key)!
          if (key === value) {
            continue
          }
          next = next.split(key).join(value)
        }
        asset.code = next
      }
    },
  }
}

/**
 * Extract package info from a pnpm node_modules path.
 */
export function extractPackageInfo(longPath: string): PackageInfo | undefined {
  // Scoped: node_modules/.pnpm/@scope+pkg@version/node_modules/@scope/pkg/path
  const scopedMatch = longPath.match(
    /node_modules\/\.pnpm\/@[^+/]+\+[^@/]+@([^/]+)\/node_modules\/(@[^/]+\/[^/]+)\/(.+)/,
  )
  if (scopedMatch) {
    const [, version, packageName, subpath] = scopedMatch
    if (!version || !packageName || !subpath) {
      return undefined
    }
    return { packageName, subpath, version }
  }

  // Non-scoped: node_modules/.pnpm/pkg@version/node_modules/pkg/path
  const match = longPath.match(
    /node_modules\/\.pnpm\/[^@/]+@([^/]+)\/node_modules\/([^/]+)\/(.+)/,
  )
  if (match) {
    const [, version, packageName, subpath] = match
    if (!version || !packageName || !subpath) {
      return undefined
    }
    return { packageName, subpath, version }
  }

  return undefined
}

const externals = [...builtinModules, ...builtinModules.map(m => `node:${m}`)]

/**
 * Two standalone configs, one per public entry point. Mirrors esbuild's
 * `splitting: false` behavior: each entry gets a self-contained bundle with no
 * shared chunks. socket-packageurl-js publishes `dist/index.js` and
 * `dist/exists.js` as separate require()-able files; consumers shouldn't have
 * to know about a shared chunk in `dist/chunks/`.
 */
const baseConfig = {
  external: externals,
  platform: 'node' as const,
  plugins: [
    createLibStubPlugin({
      stubPattern: /@socketsecurity\/lib\/dist\/(globs|sorts)\.js$/,
    }),
    createPathShorteningPlugin(),
  ],
  treeshake: true,
}

const baseOutput = {
  banner: '/* Socket PackageURL - Built with rolldown */',
  codeSplitting: false,
  dir: distPath,
  entryFileNames: '[name].js',
  format: 'cjs' as const,
  minify: false,
  sourcemap: false,
}

const indexConfig: RolldownOptions = {
  ...baseConfig,
  input: { index: path.join(srcPath, 'index.mts') },
  output: baseOutput,
}

const existsConfig: RolldownOptions = {
  ...baseConfig,
  input: { exists: path.join(srcPath, 'exists.mts') },
  output: baseOutput,
}

export const configs: readonly RolldownOptions[] = [indexConfig, existsConfig]
