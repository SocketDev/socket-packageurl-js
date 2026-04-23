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
      /* Render page: strict-sans fallback, no other font hints.
       * Mermaid's own <style> block inside the SVG declares
       * Arial-sans (because of our initialize config below), so
       * keep the outer page's font completely unstyled and let
       * mermaid drive. */
      /* Helvetica ships with every macOS and most Linux
       * distributions; Windows has Arial. Since the SVG bakes
       * pixel-exact coordinates at render time (puppeteer), the
       * viewing browser MUST use the same font to avoid clipping.
       * Helvetica, Arial, sans-serif is the safest stack — every
       * mainstream viewer resolves to a metric-compatible font. */
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
          /* Wait for every declared font to actually load in the
           * puppeteer page. Without this, mermaid measures labels
           * against the browser's fallback font during render() —
           * then the real font gets painted later, wider, and
           * overflows the measured box. This is exactly what
           * mermaid-cli and mermaid-isomorphic do:
           *   await document.fonts.ready
           *   await Promise.all(Array.from(document.fonts, f => f.load()))
           * (github.com/mermaid-js/mermaid-cli + remcohaszing/
           *  mermaid-isomorphic — renderDiagrams). */
          await document.fonts.ready
          /* allSettled, not all — if one @font-face fails to fetch
           * (404, wrong MIME, etc.) we still want the others to
           * finish loading so mermaid measures against whatever
           * real fonts ARE available rather than the fallback. */
          await Promise.allSettled(
            Array.from(document.fonts, (f: FontFace) => f.load()),
          )
          /* Create a real DOM-attached scratch container and hand
           * it to mermaid.render() as the third arg. When mermaid
           * renders into a detached scratch node, getBBox() /
           * getBoundingClientRect() calls inside its sizing pass
           * return zero or stale metrics. Attached-but-visually-
           * hidden is the pattern mermaid-isomorphic uses. */
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
            /* htmlLabels MUST be at the top level here — as of
             * mermaid 11.12.3 (PR #6995), the nested
             * flowchart.htmlLabels key is deprecated and silently
             * ignored when a root-level htmlLabels is present, OR
             * when the flowchart renderer decides to use HTML
             * anyway. Setting it at the top level is the
             * documented escape from foreignObject rendering,
             * which in 11.x has a known label-clipping bug
             * (#5785 — max-width:200px on foreignObject divs). */
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
          /* Mimic mermaid-cli's pattern exactly: render with the
           * container, then stuff the returned SVG string back
           * into that same container. The string has mermaid's
           * post-processed output; re-parsing it by setting
           * innerHTML gives the browser-normalized DOM we ship. */
          const { svg } = await mermaid.render('diagram', src, container)
          container.innerHTML = svg
          const out = document.getElementById('out')
          if (out) {
            out.innerHTML = svg
          }
        },
        source,
        theme,
      )
      /* Grab the final SVG after mermaid has finished layout.
       * Then: use page.evaluate to re-measure every foreignObject's
       * inner content box and resize the foreignObject + its parent
       * node rect to fit. Mermaid 11 sometimes ignores
       * htmlLabels:false and emits foreignObjects whose
       * max-width/width doesn't match the rendered text, causing
       * the clipping we were chasing. Measuring the live DOM and
       * patching attributes on the SVG elements fixes it at the
       * source — before serialization. */
      await page.evaluate(() => {
        const svg = document.querySelector('#out svg') as SVGSVGElement | null
        if (!svg) {
          return
        }
        /* Walk every foreignObject under a <g class="label"> — mermaid's
         * text container. Measure the inner <div>'s scrollWidth /
         * scrollHeight (true content size even when CSS clips it)
         * and bump the foreignObject's width/height if the content
         * overflows. Also bump the parent node's <rect> so the
         * label stays inside the drawn box. */
        const labels = svg.querySelectorAll(
          'g.label > foreignObject',
        ) as NodeListOf<SVGForeignObjectElement>
        for (const fo of Array.from(labels)) {
          const div = fo.querySelector(':scope > div') as HTMLElement | null
          if (!div) {
            continue
          }
          // Kill the max-width + width CSS mermaid applied so the
          // browser can give us a true natural width.
          div.style.maxWidth = 'none'
          div.style.width = 'auto'
          div.style.whiteSpace = 'nowrap'
          div.style.display = 'inline-block'
          const rect = div.getBoundingClientRect()
          const naturalW = Math.ceil(rect.width)
          const naturalH = Math.ceil(rect.height)
          const currentW = Number(fo.getAttribute('width') ?? '0')
          const currentH = Number(fo.getAttribute('height') ?? '0')
          if (naturalW > currentW || naturalH > currentH) {
            fo.setAttribute('width', String(naturalW))
            fo.setAttribute('height', String(naturalH))
            /* Recenter the label group — mermaid placed the <g>
             * assuming the old width. Pull it left by half the
             * width delta so the wider text stays centered inside
             * the rect. */
            const parent = fo.parentElement as SVGGElement | null
            if (parent) {
              const xform = parent.getAttribute('transform') ?? ''
              const match = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(xform)
              if (match) {
                const oldX = parseFloat(match[1]!)
                const oldY = parseFloat(match[2]!)
                const newX = oldX - (naturalW - currentW) / 2
                const newY = oldY - (naturalH - currentH) / 2
                parent.setAttribute('transform', `translate(${newX}, ${newY})`)
              }
            }
            /* Also widen the enclosing node rect if needed. The
             * rect has x="-w/2" width="w" convention in mermaid. */
            const nodeG = fo.closest('g.node') as SVGGElement | null
            const nodeRect = nodeG?.querySelector(
              ':scope > rect.label-container',
            ) as SVGRectElement | null
            if (nodeRect) {
              const rw = Number(nodeRect.getAttribute('width') ?? '0')
              const rh = Number(nodeRect.getAttribute('height') ?? '0')
              const labelPadding = 40
              if (naturalW + labelPadding > rw) {
                const newW = naturalW + labelPadding
                nodeRect.setAttribute('width', String(newW))
                nodeRect.setAttribute('x', String(-newW / 2))
              }
              if (naturalH + labelPadding > rh) {
                const newH = naturalH + labelPadding
                nodeRect.setAttribute('height', String(newH))
                nodeRect.setAttribute('y', String(-newH / 2))
              }
            }
          }
        }
      })
      const normalizedSvg = (await page.$eval(
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
      /* SVGO disabled — it was rewriting geometry in subtle ways
       * (transform flattening, numeric precision quantization)
       * that desynced text positions from the node box rectangles
       * mermaid computed. Ship the raw mermaid SVG verbatim. */
      const finalSvg = normalizedSvg
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
