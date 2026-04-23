/**
 * Build-time Mermaid → SVG renderer.
 *
 * Why build-time, not client-side:
 *   - Zero client JS. The page ships finished SVG; no 1MB+ mermaid
 *     bundle, no render flash, no layout shift.
 *   - CSP stays tight. No extra script-src entry, no SRI for a
 *     library we only ever use to make pictures.
 *   - SVGO can shrink each diagram to a few KB of whitespace-free,
 *     group-flattened markup.
 *
 * How it works:
 *   1. Spin up one puppeteer browser per build (shared across every
 *      diagram in every doc so we pay the Chromium boot once).
 *   2. For each diagram: hash the source text + theme. If the
 *      `.cache/mermaid/<hash>.svg` file exists, reuse it —
 *      re-rendering an unchanged diagram is pure cycles.
 *   3. Otherwise: open a blank page, load mermaid from
 *      node_modules, call `mermaid.render()`, grab the SVG string.
 *   4. Pipe through SVGO to strip comments, collapse groups,
 *      quantize path precision. Write to cache + return.
 *
 * Cache key includes the mermaid version + theme + source so a
 * mermaid bump or theme change invalidates stale output
 * automatically.
 */

import { hash as cryptoHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import puppeteer from 'puppeteer'
import { optimize as svgoOptimize } from 'svgo'

import type { Browser } from 'puppeteer'

type MermaidTheme = 'default' | 'dark' | 'neutral' | 'forest'

export type MermaidRenderer = {
  render: (source: string, theme: MermaidTheme) => Promise<string>
  close: () => Promise<void>
}

/* Minimal SVGO pipeline — keep IDs (mermaid uses them for
 * edge-to-node links), drop comments + XML prolog, collapse
 * useless groups, quantize numeric precision. We deliberately
 * skip `removeUnknownsAndDefaults` because mermaid emits some
 * non-default attrs SVGO's defaults list considers redundant
 * but browsers actually render (e.g. preserveAspectRatio). */
const svgoConfig = {
  multipass: true,
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          cleanupIds: false,
          removeViewBox: false,
          removeUnknownsAndDefaults: false,
        },
      },
    },
  ],
} as const

export type MermaidRendererConfig = {
  repoRoot: string
  cacheDir: string
}

/**
 * Create a renderer backed by a shared puppeteer browser. Call
 * `close()` when the build is done — leaving the browser open
 * leaks a Chromium process.
 *
 * `repoRoot` is where we find `node_modules/mermaid/dist/…`.
 * `cacheDir` is where rendered SVGs persist across builds.
 */
export async function createMermaidRenderer(
  config: MermaidRendererConfig,
): Promise<MermaidRenderer> {
  const { repoRoot, cacheDir } = config
  const mermaidJsPath = path.join(
    repoRoot,
    'node_modules',
    'mermaid',
    'dist',
    'mermaid.min.js',
  )
  if (!existsSync(mermaidJsPath)) {
    throw new Error(
      `mermaid dependency not installed — ${mermaidJsPath} not found. Run pnpm install to restore.`,
    )
  }
  const mermaidJs = await fs.readFile(mermaidJsPath, 'utf8')
  // Embed mermaid version in the cache key so a dep bump invalidates
  // cached SVGs automatically (otherwise a mermaid update that
  // changes rendering output would silently serve stale diagrams).
  const mermaidPkgPath = path.join(
    repoRoot,
    'node_modules',
    'mermaid',
    'package.json',
  )
  const mermaidVersion = existsSync(mermaidPkgPath)
    ? ((
        JSON.parse(await fs.readFile(mermaidPkgPath, 'utf8')) as {
          version?: string
        }
      ).version ?? '0')
    : '0'

  await fs.mkdir(cacheDir, { recursive: true })

  /* Lazy-launch puppeteer — only pay the Chromium boot cost
   * (~1-2s) if we actually have a cache miss. A build where every
   * diagram is unchanged returns pure file reads and never starts
   * the browser. */
  let browser: Browser | null = null
  const ensureBrowser = async (): Promise<Browser> => {
    if (!browser) {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
    }
    return browser
  }

  const render = async (
    source: string,
    theme: MermaidTheme,
  ): Promise<string> => {
    const key = cryptoHash(
      'sha256',
      `${mermaidVersion}\n${theme}\n${source}`,
      'hex',
    )
    const cachePath = path.join(cacheDir, `${key}.svg`)
    if (existsSync(cachePath)) {
      return fs.readFile(cachePath, 'utf8')
    }

    const activeBrowser = await ensureBrowser()
    const page = await activeBrowser.newPage()
    try {
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><script>${mermaidJs}</script></head><body><div id="out"></div></body></html>`,
      )
      // Expose source + theme as window vars so the page-side
      // script reads the exact inputs without string interpolation
      // into mermaid source (which could break on backticks or
      // other quote-like chars in the diagram).
      await page.evaluate(
        async (src: string, themeArg: string) => {
          // @ts-expect-error — mermaid attaches to window at runtime.
          const mermaid = (window as any).mermaid
          mermaid.initialize({
            startOnLoad: false,
            theme: themeArg,
            securityLevel: 'strict',
            flowchart: { htmlLabels: false, curve: 'basis' },
          })
          const { svg } = await mermaid.render('diagram', src)
          const out = document.getElementById('out')
          if (out) {
            out.innerHTML = svg
          }
        },
        source,
        theme,
      )
      const rawSvg = (await page.$eval(
        '#out svg',
        el => el.outerHTML,
      )) as string
      /* Pipe through SVGO when possible, but mermaid emits
       * `<foreignObject>` with HTML-flavored self-closing tags
       * (e.g. `<br/>`) that trip SVGO's stricter parser. On
       * parse failure keep the raw mermaid SVG — it's still
       * visually correct, just larger. Inline `style="…"` attrs
       * are preserved; the caller collects the CSP hashes it
       * needs from the final SVG so styles actually apply. */
      let finalSvg: string
      try {
        const optimized = svgoOptimize(rawSvg, svgoConfig)
        finalSvg = optimized.data
      } catch {
        finalSvg = rawSvg
      }
      await fs.writeFile(cachePath, finalSvg)
      return finalSvg
    } finally {
      await page.close()
    }
  }

  const close = async (): Promise<void> => {
    if (browser) {
      await browser.close()
      browser = null
    }
  }

  return { render, close }
}
