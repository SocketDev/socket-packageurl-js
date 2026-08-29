#!/usr/bin/env node
/*
 * @file PNG optimization using pinned external tools. Image optimization is
 *   an enhancement, not a foundational build step, so every tool tier here is
 *   best-effort: an absent tool is skipped, never a hard failure, and the
 *   whole script only errors when NONE of the three are available. Tries
 *   tools in order of preference:
 *
 *   1. oxipng (Rust, lossless) - cross-platform, gh-asset origin in
 *      external-tools.json, so the fleet always has a binary for it.
 *   2. pngquant (lossy, high quality) - system origin in external-tools.json:
 *      OS-installed only (brew/apt), no maintained cross-platform prebuilt
 *      binary source upstream. Optional; falls back to oxipng when absent.
 *   3. optipng - plain PATH fallback, not declared in external-tools.json at all.
 *      Usage: node scripts/fleet/gen/png-optimize.mts <file.png> node
 *      scripts/fleet/gen/png-optimize.mts --dir assets/ node
 *      scripts/fleet/gen/png-optimize.mts --check # verify tools available
 */

import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { ensureTool } from '../_shared/external-tools.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { defaultCommandExists as commandExists } from '../setup/ecosystems.mts'
import { REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

interface Tool {
  name: string
  check: () => Promise<string | undefined>
  optimize: (
    binPath: string,
    file: string,
    config: OptimizeOptions,
  ) => Promise<boolean>
}

interface OptimizeOptions {
  lossy?: boolean | undefined
  quality?: number | undefined
  strip?: boolean | undefined
}

const TOOLS: Tool[] = [
  {
    name: 'oxipng',
    check: async () => {
      const result = await ensureTool('oxipng')
      if (result.available && result.binPath) {
        return result.binPath
      }
      if (commandExists('oxipng')) {
        return 'oxipng'
      }
      return undefined
    },
    optimize: async (binPath, file, config) => {
      const cfg = { __proto__: null, ...config } as typeof config
      const args = ['-o', '4', '--strip', 'safe']
      if (cfg.strip) {
        args.push('--strip', 'all')
      }
      args.push(file)
      try {
        await spawn(binPath, args, { stdio: 'inherit' })
        return true
      } catch {
        return false
      }
    },
  },
  {
    name: 'pngquant',
    check: async () => {
      const result = await ensureTool('pngquant')
      if (result.available && result.binPath) {
        return result.binPath
      }
      if (commandExists('pngquant')) {
        return 'pngquant'
      }
      return undefined
    },
    optimize: async (binPath, file, config) => {
      const cfg = { __proto__: null, ...config } as typeof config
      const quality = cfg.quality ?? 80
      const args = ['--force', '--ext', '.png', '--quality', `${quality}-100`]
      if (cfg.strip !== false) {
        args.push('--strip')
      }
      args.push(file)
      try {
        await spawn(binPath, args, { stdio: 'inherit' })
        return true
      } catch {
        return false
      }
    },
  },
  {
    name: 'optipng',
    check: async () => {
      if (commandExists('optipng')) {
        return 'optipng'
      }
      return undefined
    },
    optimize: async (binPath, file, config) => {
      const cfg = { __proto__: null, ...config } as typeof config
      const args = ['-o2']
      if (cfg.strip) {
        args.push('-strip', 'all')
      }
      args.push(file)
      try {
        await spawn(binPath, args, { stdio: 'inherit' })
        return true
      } catch {
        return false
      }
    },
  },
]

export async function getAvailableTools(): Promise<
  Array<{ tool: Tool; binPath: string }>
> {
  const available: Array<{ tool: Tool; binPath: string }> = []
  for (let i = 0, { length } = TOOLS; i < length; i += 1) {
    const tool = TOOLS[i]!
    const binPath = await tool.check()
    if (binPath) {
      available.push({ tool, binPath })
    }
  }
  return available
}

export async function optimizePng(
  file: string,
  options: OptimizeOptions = {},
): Promise<{ success: boolean; tool: string | undefined }> {
  const tools = await getAvailableTools()

  if (tools.length === 0) {
    return { success: false, tool: undefined }
  }

  const preferLossy = options.lossy ?? false
  const selected = preferLossy
    ? (tools.find(t => t.tool.name === 'pngquant') ?? tools[0]!)
    : tools[0]!

  const success = await selected.tool.optimize(selected.binPath, file, options)
  return { success, tool: selected.tool.name }
}

export async function optimizeDirectory(
  dir: string,
  options: OptimizeOptions = {},
): Promise<{ processed: number; failed: number; tool: string | undefined }> {
  const tools = await getAvailableTools()
  if (tools.length === 0) {
    return { processed: 0, failed: 0, tool: undefined }
  }

  const files = globSync('**/*.png', { cwd: dir })
  let processed = 0
  let failed = 0
  let usedTool: string | undefined

  for (const file of files) {
    const fullPath = path.join(dir, file)
    const result = await optimizePng(fullPath, options)
    if (result.success) {
      processed += 1
      usedTool = result.tool
    } else {
      failed += 1
    }
  }

  return { processed, failed, tool: usedTool }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.includes('--check')) {
    const tools = await getAvailableTools()
    if (tools.length === 0) {
      logger.error('No PNG optimization tools found.')
      logger.info('Install one of: oxipng (cargo), pngquant (brew), optipng')
      logger.group()
      logger.info('cargo install oxipng')
      logger.info('brew install pngquant')
      logger.info('brew install optipng')
      logger.groupEnd()
      process.exitCode = 1
      return
    }
    logger.info(`Available tools: ${tools.map(t => t.tool.name).join(', ')}`)
    return
  }

  const dirIndex = args.indexOf('--dir')
  if (dirIndex !== -1) {
    const dir = args[dirIndex + 1]
    if (!dir) {
      logger.error('--dir requires a directory path')
      process.exitCode = 1
      return
    }
    const fullDir = path.resolve(REPO_ROOT, dir)
    if (!existsSync(fullDir)) {
      logger.error(`Directory not found: ${dir}`)
      process.exitCode = 1
      return
    }
    const result = await optimizeDirectory(fullDir, {
      lossy: args.includes('--lossy'),
      strip: args.includes('--strip'),
    })
    if (result.tool === undefined) {
      logger.error('No PNG optimization tools available')
      process.exitCode = 1
      return
    }
    logger.info(
      `Optimized ${result.processed} files with ${result.tool}` +
        (result.failed > 0 ? `, ${result.failed} failed` : ''),
    )
    return
  }

  const file = args.find(a => !a.startsWith('--'))
  if (!file) {
    logger.error('Usage: png-optimize.mts <file.png> | --dir <dir> | --check')
    process.exitCode = 1
    return
  }

  const fullPath = path.resolve(REPO_ROOT, file)
  if (!existsSync(fullPath)) {
    logger.error(`File not found: ${file}`)
    process.exitCode = 1
    return
  }

  // Needs the file's byte size (metadata), not just an existence check.
  // oxlint-disable-next-line socket/prefer-exists-sync -- reads size metadata
  const sizeBefore = statSync(fullPath).size
  const result = await optimizePng(fullPath, {
    lossy: args.includes('--lossy'),
    strip: args.includes('--strip'),
  })

  if (result.tool === undefined) {
    logger.error('No PNG optimization tools available')
    logger.info('Install: cargo install oxipng, or brew install pngquant')
    process.exitCode = 1
    return
  }

  if (!result.success) {
    logger.error(`Optimization failed with ${result.tool}`)
    process.exitCode = 1
    return
  }

  // Needs the file's byte size (metadata), not just an existence check.
  // oxlint-disable-next-line socket/prefer-exists-sync -- reads size metadata
  const sizeAfter = statSync(fullPath).size
  const saved = sizeBefore - sizeAfter
  const pct = ((saved / sizeBefore) * 100).toFixed(1)
  logger.info(
    `${path.basename(file)}: ${sizeBefore} → ${sizeAfter} bytes (${pct}% saved) via ${result.tool}`,
  )
}

const SCRIPT_META: ScriptMeta = {
  describe: 'Optimize PNG files using oxipng, pngquant, or optipng',
  help: `Usage:
  png-optimize.mts <file.png>     # optimize single file
  png-optimize.mts --dir <dir>    # optimize directory
  png-optimize.mts --check        # verify tools available

Options:
  --lossy   Prefer lossy compression (pngquant)
  --strip   Strip all metadata`,
}

if (isMainModule(import.meta.url)) {
  void runMain(main, SCRIPT_META)
}
