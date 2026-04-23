/**
 * Build-time Mermaid → SVG renderer.
 *
 * Why build-time, not client-side:
 *   - Zero client JS. The page ships finished SVG; no 1MB+
 *     mermaid bundle, no render flash, no layout shift.
 *   - CSP stays tight. No extra script-src entry, no SRI for a
 *     library we only ever use to make pictures.
 *   - SVGO shrinks each diagram to a few KB.
 *
 * How it works:
 *   1. Spin up one puppeteer browser per build (shared across
 *      every diagram — Chromium boot paid once).
 *   2. For each diagram: hash the source + theme + mermaid
 *      version. If the cache has that hash, return its SVG.
 *   3. Otherwise: open a blank page, load mermaid from
 *      node_modules, wait for fonts, render into a real
 *      DOM-attached container (mermaid-cli's pattern), grab
 *      the SVG string.
 *   4. Pipe through SVGO. Write to cache + return.
 *
 * Cache key embeds the mermaid version so a dep bump invalidates
 * stale output automatically.
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

/* SVGO config — preset-default with two overrides disabled:
 *   - cleanupIds: mermaid uses IDs for edge-to-node linking, so
 *     collapsing them breaks arrow rendering.
 *   - removeUnknownsAndDefaults: mermaid emits attrs the default
 *     list wants to strip (preserveAspectRatio variants) that
 *     browsers actually use.
 * removeViewBox was moved out of preset-default in SVGO v4, so
 * there's nothing to toggle there; viewBox survives by default. */
const svgoConfig = {
  multipass: true,
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          cleanupIds: false,
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
 * `close()` when the build is done.
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
   * (~1-2s) when we actually have a cache miss. A build where
   * every diagram is unchanged returns pure file reads. */
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
      /* Helvetica ships with every macOS + most Linux distros;
       * Windows has Arial. With `htmlLabels: false` mermaid uses
       * real SVG <text>/<tspan>, so the viewing browser measures
       * with the same Helvetica/Arial metric family the headless
       * browser used at render time. */
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>
          body { margin: 0; padding: 20px; font-family: Helvetica, Arial, sans-serif; }
          #out { width: 1200px; }
        </style><script>${mermaidJs}</script></head><body><div id="out"></div></body></html>`,
      )
      await page.setViewport({ width: 1400, height: 900 })
      await page.evaluate(
        async (src: string, themeArg: string) => {
          // @ts-expect-error — mermaid attaches to window at runtime.
          const mermaid = (window as any).mermaid
          /* mermaid-cli + mermaid-isomorphic both wait for fonts
           * before calling render(). Without this, mermaid measures
           * labels against whatever fallback font is ready, then
           * the real font paints wider + overflows node boxes. */
          await document.fonts.ready
          /* allSettled so a single @font-face failure doesn't skip
           * the rest of the loading pass. */
          await Promise.allSettled(
            Array.from(document.fonts, (f: FontFace) => f.load()),
          )
          /* Real DOM-attached container, handed to render() as the
           * third arg. getBBox() on a detached node returns zero
           * or stale metrics. max-height:0 + opacity:0 hides it
           * visually without unmounting — the mermaid-isomorphic
           * pattern. */
          const container = document.createElement('div')
          Object.assign(container.style, {
            maxHeight: '0',
            opacity: '0',
            overflow: 'hidden',
          })
          container.setAttribute('aria-hidden', 'true')
          document.body.append(container)
          mermaid.initialize({
            startOnLoad: false,
            theme: themeArg,
            securityLevel: 'strict',
            /* MUST be top-level in mermaid 11.12.3+. The nested
             * flowchart.htmlLabels was deprecated in PR #6995 and
             * is silently ignored — leaving it nested makes
             * mermaid emit <foreignObject> labels, which hit a
             * max-width:200px clipping bug (mermaid #5785). Top-
             * level htmlLabels:false forces pure SVG <text>. */
            htmlLabels: false,
            flowchart: {
              curve: 'basis',
              useMaxWidth: false,
              nodeSpacing: 80,
              rankSpacing: 80,
              padding: 30,
            },
            fontFamily: 'Helvetica, Arial, sans-serif',
            fontSize: 14,
            themeVariables: {
              fontFamily: 'Helvetica, Arial, sans-serif',
              fontSize: '14px',
            },
          })
          const { svg } = await mermaid.render('diagram', src, container)
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
      /* SVGO pass — shrinks each diagram by ~30%. Kept in a
       * try/catch because mermaid still occasionally emits a
       * construct SVGO's parser dislikes; raw SVG on failure is
       * visually correct. */
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
