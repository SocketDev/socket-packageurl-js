/**
 * @file Bundle-size analysis for the build runner's `--analyze` flag. Walks
 *   the on-disk dist/ output and reports per-file + total sizes. Replaces
 *   esbuild's metafile analyzer — rolldown doesn't ship an equivalent metafile
 *   by default, and the only consumer is the `--analyze` CLI flag, so reading
 *   the produced files directly is enough. Split from build.mts along the
 *   one-domain-per-file seam.
 */

import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type BuildAnalysis = {
  files: Array<{
    name: string
    size: string
  }>
  totalSize: string
}

const rootPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
)
const distPath = path.join(rootPath, 'dist')

/**
 * Walk the built dist/ entries and report file sizes.
 */
export function getBuildAnalysis(): BuildAnalysis {
  const files: Array<{ name: string; size: string }> = []
  let totalBytes = 0

  if (existsSync(distPath)) {
    for (const name of ['index.js', 'exists.js']) {
      const filePath = path.join(distPath, name)
      if (!existsSync(filePath)) {
        continue
      }
      const bytes = statSync(filePath).size
      totalBytes += bytes
      files.push({
        name: path.relative(rootPath, filePath),
        size: `${(bytes / 1024).toFixed(2)} KB`,
      })
    }
  }

  return {
    files,
    totalSize: `${(totalBytes / 1024).toFixed(2)} KB`,
  }
}
