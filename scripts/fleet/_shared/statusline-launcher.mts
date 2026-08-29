/**
 * @file Resolve the matching prebuilt statusline-render binary for the current
 *   host, or undefined when none is staged (the caller falls back to the Node
 *   statusline script). Mirrors the launcher-variant resolver but with the
 *   musl split (perry binaries link libc dynamically, so glibc and musl need
 *   separate builds unlike the static dispatch-launcher).
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  STATUSLINE_RENDER,
  STATUSLINE_RENDER_REL_DIR,
} from './statusline-render.mts'

/**
 * Detect whether the host Linux runs musl libc. On non-Linux hosts, returns
 * false. The detection is best-effort: `ldd --version` mentions musl on musl
 * systems, and `/proc/self/maps` references `ld-musl` on Alpine.
 */
function hostIsMusl(): boolean {
  if (process.platform !== 'linux') {
    return false
  }
  try {
    const result = spawnSync('ldd', ['--version'], { timeout: 2000 })
    const out = typeof result.stdout === 'string' ? result.stdout : ''
    return /musl/i.test(out)
  } catch {
    try {
      const maps = readFileSync('/proc/self/maps', 'utf8')
      return /ld-musl/.test(maps)
    } catch {
      return false
    }
  }
}

/**
 * The absolute path to the matching prebuilt statusline-render binary for this
 * host, or undefined when none is staged. The `statusLine.command` uses this to
 * run the native binary when available, falling back to Node otherwise.
 */
export function resolveStatuslineRender(
  projectDir: string,
): string | undefined {
  const platform = process.platform
  const arch = process.arch
  const libc = platform === 'linux' && hostIsMusl() ? 'musl' : undefined
  for (const entry of STATUSLINE_RENDER) {
    if (
      entry.platform === platform &&
      entry.arch === arch &&
      (entry.libc ?? undefined) === (libc ?? undefined)
    ) {
      const candidate = path.join(
        projectDir,
        STATUSLINE_RENDER_REL_DIR,
        entry.fileName,
      )
      if (existsSync(candidate)) {
        return candidate
      }
      return undefined
    }
  }
  return undefined
}
