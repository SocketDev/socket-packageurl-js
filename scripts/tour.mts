/**
 * @fileoverview Tour generator + local server wrapper.
 *
 * Ensures the vendored meander submodule is checked out, builds it on first
 * run, then either generates the tour or serves the generated output over
 * HTTP for local preview. The submodule is pinned by commit SHA (via the git
 * superrepo pointer); the human-readable `# name-version` comment in
 * .gitmodules records which upstream version the SHA corresponds to.
 *
 * Generation also runs in CI (.github/workflows/pages.yml).
 */

import { execFileSync } from 'node:child_process'
import { hash as cryptoHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { safeDelete } from '@socketsecurity/lib/fs'

import { transform as esbuildTransform } from 'esbuild'
import { transform as lightningTransform } from 'lightningcss'
import { marked } from 'marked'
import { HTMLElement, parse as parseHtml } from 'node-html-parser'
import { optimize as svgoOptimize } from 'svgo'

import { auditCdnScripts, auditValDeps } from './audit-deps.mts'
import {
  createMermaidRenderer,
  type MermaidRenderer,
} from './render-mermaid.mts'
import { errorMessage } from './utils/error-message.mts'

const MEANDER_PATH = 'upstream/meander'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const meanderDir = path.join(repoRoot, MEANDER_PATH)
const cliEntry = path.join(meanderDir, 'dist', 'cli.js')
const nodeModulesDir = path.join(meanderDir, 'node_modules')
// Final destination of the generated site. `generate()` builds into a
// tmpdir and moves the finished tree here at the very end — `pages/`
// only ever contains a finished, consistent site.
const outputDir = path.join(repoRoot, 'pages')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

function run(cmd: string, args: readonly string[], cwd: string): void {
  execFileSync(cmd, args, { cwd, stdio: 'inherit' })
}

async function isEmptyDir(dir: string): Promise<boolean> {
  if (!existsSync(dir)) {
    return true
  }
  return (await fs.readdir(dir)).length === 0
}

async function ensureMeander(refresh: boolean): Promise<void> {
  if (await isEmptyDir(meanderDir)) {
    run(
      'git',
      ['submodule', 'update', '--init', '--depth=1', MEANDER_PATH],
      repoRoot,
    )
  }

  if (refresh || !existsSync(nodeModulesDir)) {
    run('npm', ['install', '--no-audit', '--no-fund'], meanderDir)
  }

  if (refresh || !existsSync(cliEntry)) {
    run('npm', ['run', 'build'], meanderDir)
  }
}

/**
 * Normalize a base-path argument — enforce a single leading `/`, strip
 * trailing `/`. Empty input means "served at the origin root" (no
 * rewrite needed). Input of just `/` also normalizes to empty.
 */
function normalizeBasePath(raw: string): string {
  let p = raw.trim()
  if (!p || p === '/') {
    return ''
  }
  if (!p.startsWith('/')) {
    p = '/' + p
  }
  if (p.endsWith('/')) {
    p = p.slice(0, -1)
  }
  return p
}

/**
 * Escape a string for safe HTML attribute / text node inclusion.
 * Keeps the renderer's output XSS-safe for values pulled from the
 * tour.json manifest (titles, summaries) without pulling in a
 * full sanitizer dep.
 */
function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Replace every `<pre><code class="language-mermaid">…</code></pre>`
 * in a rendered doc HTML string with a pre-rendered SVG figure.
 * The renderer handles caching + SVGO; we just wrap the result
 * in a `<figure class="wt-mermaid">` so CSS can give it some
 * breathing room in the prose flow.
 *
 * If a block fails to render, leaves the original code block in
 * place with a `.wt-mermaid-error` class so the reader sees the
 * raw source (copyable, fixable) instead of a mystery gap.
 */
/**
 * Walk a marked-lexed token stream. Whenever we find a `code`
 * block whose language is `mermaid`, render the source to an
 * SVG figure and swap the token into an `html` block so marked
 * emits our pre-rendered markup unchanged. Using the tokenizer
 * keeps us out of regex-on-HTML territory — marked already
 * parsed the fence, language attribute, and raw source; we just
 * intercept the one token type we care about.
 */
async function processMermaidTokens(
  markdown: string,
  renderer: MermaidRenderer,
): Promise<string> {
  const tokens = marked.lexer(markdown)
  const visit = async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    list: any[],
  ): Promise<void> => {
    for (let i = 0; i < list.length; i++) {
      const t = list[i]
      if (!t || typeof t !== 'object') {
        continue
      }
      if (t.type === 'code' && t.lang === 'mermaid') {
        const source = String(t.text ?? '').trim()
        try {
          const svg = await renderer.render(source, 'dark')
          list[i] = {
            type: 'html',
            raw: t.raw,
            pre: false,
            text: `<figure class="wt-mermaid">${svg}</figure>`,
          }
        } catch (e) {
          console.warn(
            `[mermaid] render failed: ${errorMessage(e)}\n--- source ---\n${source}\n---`,
          )
          list[i] = {
            type: 'html',
            raw: t.raw,
            pre: false,
            text: `<pre class="wt-mermaid-error"><code>${escapeHtml(source)}</code></pre>`,
          }
        }
        continue
      }
      if (Array.isArray(t.tokens)) {
        await visit(t.tokens)
      }
    }
  }
  await visit(tokens)
  return marked.parser(tokens)
}

/**
 * Emit AI-agent-consumable artifacts alongside the rendered HTML.
 *
 * The `llms.txt` convention (llmstxt.org) is "the robots.txt for
 * AI" — a small curated markdown index an agent can fetch at a
 * known path to understand a site's structure without scraping.
 * We ship three flavors:
 *
 *   /llms.txt          Small: title, one-line description, linked
 *                      index of every part + doc.
 *   /llms-full.txt     Big: every part's objective + every doc's
 *                      full markdown, concatenated. Cheapest way
 *                      for an agent to read the whole site in one
 *                      request (~100KB gzipped for this tour).
 *   /<filename>.md     For docs, ship the raw markdown source
 *                      alongside the rendered .html so a
 *                      content-negotiating agent can prefer .md.
 *
 * All same-origin, covered by CSP `default-src 'self'`. No CSP
 * / SRI interactions — these are static text files.
 */
async function emitAiArtifacts(
  buildDir: string,
  repoRoot: string,
  slug: string,
  title: string,
  docFilenames: ReadonlyMap<string, DocEntry>,
  parts: ReadonlyArray<{
    id: number
    title: string
    filename?: string
    objective?: string
  }>,
): Promise<void> {
  const base = slug ? `/${slug}` : ''
  /* Small llms.txt — short header, title, and a grouped link
   * list. Agents parsing this don't read the rendered HTML. */
  const llmsLines: string[] = []
  llmsLines.push(`# ${title || 'Package tour'}`)
  llmsLines.push('')
  llmsLines.push(
    '> Build-time generated index of this documentation tour. Every entry below is also available as .md (raw markdown) or .html (rendered).',
  )
  llmsLines.push('')
  if (parts.length > 0) {
    llmsLines.push('## Parts (code walkthroughs)')
    llmsLines.push('')
    for (const p of [...parts].sort((a, b) => a.id - b.id)) {
      const name = p.filename ?? `part-${p.id}`
      const bullet = `- [Part ${p.id}: ${p.title}](${base}/${name}.html)`
      const obj = p.objective ? ` — ${p.objective.replace(/`/g, '')}` : ''
      llmsLines.push(bullet + obj)
    }
    llmsLines.push('')
  }
  if (docFilenames.size > 0) {
    llmsLines.push('## Articles')
    llmsLines.push('')
    for (const doc of docFilenames.values()) {
      const bullet = `- [${doc.title}](${base}/${doc.filename}.html)`
      const sum = doc.summary ? ` — ${doc.summary}` : ''
      llmsLines.push(bullet + sum)
    }
    llmsLines.push('')
  }
  await fs.writeFile(path.join(buildDir, 'llms.txt'), llmsLines.join('\n'))

  /* Full llms.txt — include each article's raw markdown
   * concatenated after the index. Agents can pull one file for
   * the whole site. Part-file walkthroughs aren't re-emitted
   * here (the source is the library code itself, which lives
   * under src/; the tour is commentary). */
  const fullLines: string[] = [...llmsLines]
  fullLines.push('---')
  fullLines.push('')
  for (const doc of docFilenames.values()) {
    const sourcePath = path.join(repoRoot, doc.source)
    if (!existsSync(sourcePath)) {
      continue
    }
    try {
      const md = await fs.readFile(sourcePath, 'utf8')
      fullLines.push(`# ${doc.title}`)
      fullLines.push('')
      fullLines.push(md.trimEnd())
      fullLines.push('')
      fullLines.push('---')
      fullLines.push('')
    } catch {
      /* unreadable — skip */
    }
  }
  await fs.writeFile(path.join(buildDir, 'llms-full.txt'), fullLines.join('\n'))

  /* Per-doc .md copies — raw source alongside the rendered
   * .html. Skips parts because parts don't have a hand-authored
   * markdown source; they're generated from the library code. */
  await Promise.all(
    [...docFilenames.values()].map(async doc => {
      const sourcePath = path.join(repoRoot, doc.source)
      if (!existsSync(sourcePath)) {
        return
      }
      try {
        const md = await fs.readFile(sourcePath, 'utf8')
        await fs.writeFile(path.join(buildDir, `${doc.filename}.md`), md)
      } catch {
        /* unreadable — skip */
      }
    }),
  )
}

/**
 * Wrap 1–3 digit numeric tokens (optionally `~`-prefixed) in a
 * `<span class="wt-num">` so counts and approximations pop in
 * accent color — matches the home TOC summary treatment so the
 * rhythm stays consistent between the index and the doc pages.
 * Skips years (≥4 digits) so "2026" stays plain prose.
 *
 * Walks text nodes inside prose-like elements only. Code, pre,
 * links, kbd, samp are left alone so numeric literals in code
 * don't get wrapped.
 */
function highlightProseNumbers(html: string): string {
  const root = parseHtml(html)
  const allowed = new Set([
    'P',
    'LI',
    'TD',
    'TH',
    'BLOCKQUOTE',
    'DD',
    'DT',
    'H1',
    'H2',
    'H3',
    'H4',
  ])
  const skip = new Set(['CODE', 'PRE', 'A', 'KBD', 'SAMP'])
  /* Numeric token regex:
   *   - optional ≥/≤/~ prefix
   *   - one or more digit groups separated by `.` (so 11.0.0 is
   *     one span, not three)
   *   - optional trailing `+` / `%` / `-rc.N` etc. that logically
   *     belong to the number (23+, 95%, 11.0.0-rc.0)
   * Skips digits inside HTML numeric entities (&#39;, &#x27;)
   * via a negative lookbehind for `&#` or `&#x`.
   * Skips numbers that are the bold-marker at the start of a
   * list item — those are conventional enumeration, not counts. */
  const pattern =
    /(?<!&#)(?<!&#x)(?<![\w.-])([≥≤~]?\s?\d+(?:\.\d+)+(?:-[a-z]+(?:\.\d+)*)?[+%]?|[≥≤~]?\s?\d+[+%]?)(?![\w-])(?!\.\s|\.\d)/gi
  const walk = (node: HTMLElement): void => {
    if (skip.has(node.tagName)) {
      return
    }
    const tag = node.tagName
    /* Inside <strong> at the START of an <li>, the number is a
     * manually-bolded list marker ("**1.** Branch"). Don't
     * re-colorize. Detect by: parent is <li>, this is the first
     * <strong> child, text starts with a digit+dot. */
    const parent = node.parentNode as HTMLElement | null
    const isLiStartMarker =
      tag === 'STRONG' &&
      parent?.tagName === 'LI' &&
      parent.firstElementChild === node &&
      /^\d+\./.test(node.text.trim())
    if (isLiStartMarker) {
      return
    }
    const children = Array.from(node.childNodes)
    for (const child of children) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const any = child as any
      if (any.nodeType === 3) {
        if (!allowed.has(tag)) {
          continue
        }
        const text: string = any.rawText ?? ''
        if (!pattern.test(text)) {
          continue
        }
        pattern.lastIndex = 0
        any.rawText = text.replace(pattern, '<span class="wt-num">$1</span>')
      } else if (any.nodeType === 1) {
        walk(any as HTMLElement)
      }
    }
  }
  walk(root as HTMLElement)
  return root.toString()
}

/**
 * Remove any `<h2>Further reading</h2>` section from a rendered
 * doc. The upstream README-style docs close with a "Further
 * reading" list of cross-references to sibling `docs/*.md`
 * files — we don't ship those files under those names (they
 * become `<filename>.html` in the unified Topics nav), so the
 * links 404. Simplest: drop the whole section.
 *
 * Walks the root children, finds the h2, then removes it + every
 * following sibling until the next h2 (or end). Case-insensitive
 * title match so variants ("Further Reading", "Further reading:")
 * get caught too.
 */
function stripFurtherReading(html: string): string {
  const root = parseHtml(html)
  const headings = root.querySelectorAll('h2')
  for (const h of headings) {
    const text = h.text
      .trim()
      .toLowerCase()
      .replace(/[:.…]+$/, '')
    if (text !== 'further reading') {
      continue
    }
    /* Collect every sibling from this h2 until the next h2, then
     * remove them all. parentNode is usually the root or the doc
     * body wrapper marked introduces. */
    const parent = h.parentNode as HTMLElement | null
    if (!parent) {
      continue
    }
    const children = parent.childNodes
    const startIdx = children.indexOf(h)
    if (startIdx < 0) {
      continue
    }
    const toRemove: Array<ReturnType<HTMLElement['childNodes']['at']>> = []
    for (let i = startIdx; i < children.length; i++) {
      const c = children[i]
      if (i > startIdx && (c as HTMLElement).tagName === 'H2') {
        break
      }
      toRemove.push(c)
    }
    for (const n of toRemove) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(n as any).remove?.()
    }
  }
  return root.toString()
}

/**
 * Mark ASCII repo-tree code blocks (ones that draw a directory
 * hierarchy with `├──`, `└──`, `│`) so CSS can style them
 * differently from regular code — dim the drawing glyphs, lift
 * the trailing annotation column, disable hljs auto-highlight.
 * The block stays as real text; we just add a class hook.
 */
function enhanceRepoTrees(html: string): string {
  const root = parseHtml(html)
  const preBlocks = root.querySelectorAll('pre')
  for (const pre of preBlocks) {
    const text = pre.text
    if (!/[├└│]/.test(text)) {
      continue
    }
    const existingClass = pre.getAttribute('class') ?? ''
    pre.setAttribute('class', `${existingClass} wt-repo-tree`.trim())
    for (const code of pre.querySelectorAll('code')) {
      const cc = code.getAttribute('class') ?? ''
      // nohighlight tells hljs to skip this block so the drawing
      // glyphs don't get painted as random tokens.
      code.setAttribute('class', `${cc} nohighlight`.trim())
    }
  }
  return root.toString()
}

/**
 * Give every heading (h2-h4) in rendered doc HTML an `id` slug
 * + a trailing `<a class="wt-heading-anchor">#</a>`. Readers
 * can click the # to copy a permalink to the section. h1 is
 * skipped — it's the page title and already has the URL itself.
 *
 * Slug derivation: lowercase, strip punctuation other than
 * letters / numbers / whitespace, collapse whitespace to `-`.
 * Collisions within a doc get a `-2`, `-3`, … suffix.
 */
function anchorifyHeadings(html: string): string {
  const root = parseHtml(html)
  const used = new Set<string>()
  const headings = root.querySelectorAll('h2, h3, h4')
  for (const h of headings) {
    if (h.getAttribute('id')) {
      continue
    }
    const text = h.text.trim()
    if (!text) {
      continue
    }
    const baseSlug = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]+/gu, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
    if (!baseSlug) {
      continue
    }
    let slug = baseSlug
    let n = 2
    while (used.has(slug)) {
      slug = `${baseSlug}-${n++}`
    }
    used.add(slug)
    h.setAttribute('id', slug)
    h.insertAdjacentHTML(
      'beforeend',
      ` <a class="wt-heading-anchor" href="#${slug}" aria-label="Permalink to this section">#</a>`,
    )
  }
  return root.toString()
}

/**
 * Wrap parenthetical asides in prose with <em> so "(extra info)"
 * reads as a quiet aside rather than inline copy. Only touches
 * text inside paragraphs, list items, table cells, and
 * blockquotes — <code>, <pre>, headings, and their descendants
 * are left alone, so `function(x)`, URLs with `?q=1`, and code
 * annotations stay untouched.
 *
 * The regex matches `(…)` when the contents are at least 2 chars
 * and contain no parens/tags/quotes, so nested or complex
 * expressions fall through without being mangled.
 */
function italicizeParentheticals(html: string): string {
  const root = parseHtml(html)
  const allowed = new Set(['P', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'DD', 'DT'])
  const walk = (node: HTMLElement): void => {
    const tag = node.tagName
    if (
      tag === 'CODE' ||
      tag === 'PRE' ||
      tag === 'KBD' ||
      tag === 'SAMP' ||
      tag === 'A'
    ) {
      return
    }
    // eslint-disable-next-line unicorn/no-useless-spread
    for (const child of [...node.childNodes]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const any = child as any
      if (any.nodeType === 3) {
        if (!allowed.has(tag)) {
          continue
        }
        const text: string = any.rawText ?? ''
        if (!/\([^()<>"'`]{2,}\)/.test(text)) {
          continue
        }
        const rewritten = text.replace(
          /\(([^()<>"'`]{2,})\)/g,
          (_, inner) => `(<em>${inner}</em>)`,
        )
        if (rewritten !== text) {
          any.rawText = rewritten
        }
      } else if (any.nodeType === 1) {
        walk(any as HTMLElement)
      }
    }
  }
  walk(root as HTMLElement)
  return root.toString()
}

/**
 * First "significant" word of a title — the first token that
 * isn't an article / stopword. Used to label a topic pill with
 * one word when the full title is too long:
 *   "Anatomy of a PURL"              → "Anatomy"
 *   "Building & Stringifying PURLs"  → "Building"
 *   "Security Primitives & VERS"     → "Security"
 * Ampersands stay intact inside multi-word first tokens but
 * aren't counted as their own word.
 */
function firstSignificantWord(title: string): string {
  const stop = new Set([
    'a',
    'an',
    'the',
    'and',
    'or',
    'of',
    'for',
    'to',
    'in',
    'on',
    'with',
    '&',
  ])
  const words = title.split(/\s+/)
  for (const w of words) {
    const cleaned = w.replace(/[,:;.!?]+$/, '')
    if (cleaned && !stop.has(cleaned.toLowerCase())) {
      return cleaned
    }
  }
  return words[0] ?? title
}

type DocEntry = {
  filename: string
  title: string
  source: string
  summary?: string | undefined
}

/**
 * Map a raw line count to a content-size tier badge label. Tiers
 * are tuned for this tour's reading rhythm:
 *
 *   x-small (≤ 100)    ∼ 1 min — a quick look
 *   small   (101–400)  ∼ 5 min — coffee break
 *   medium  (401–1000) ∼ 15 min — short session
 *   large   (1001–2500) ∼ 30 min — deep dive
 *   x-large (2501+)    45+ min — half-day
 *
 * Thresholds match 4-file-stacks of typical TypeScript (150-400
 * LOC each) to the "medium" tier, so the smallest visible tier
 * on this tour is usually "small" and the largest is "x-large"
 * for parts that sweep many ecosystem handlers. Returned label
 * is lowercase to pair cleanly with an uppercase `wt-contents-
 * badge-tier-<tier>` CSS class that colors it.
 */
function sizeTier(lines: number): {
  label: string
  key: 'x-small' | 'small' | 'medium' | 'large' | 'x-large'
} {
  if (lines <= 100) {
    return { label: 'x-small', key: 'x-small' }
  }
  if (lines <= 400) {
    return { label: 'small', key: 'small' }
  }
  if (lines <= 1000) {
    return { label: 'medium', key: 'medium' }
  }
  if (lines <= 2500) {
    return { label: 'large', key: 'large' }
  }
  return { label: 'x-large', key: 'x-large' }
}

/**
 * Validate the `docs` array in tour.json and build a filename
 * → entry map. Same shape / same error doctrine as
 * validatePartFilenames, plus a cross-check against the part
 * filenames: docs and parts share the same output directory, so a
 * collision between (say) part "security" and a doc "security" would
 * overwrite one with the other. Detecting it here is strictly better
 * than discovering it when the wrong page ships.
 */
function validateDocFilenames(
  docs: readonly DocEntry[],
  partFilenames: ReadonlyMap<number, string>,
  configPath: string,
): Map<string, DocEntry> {
  const errors: string[] = []
  const seen = new Map<string, DocEntry>()
  const partFilenameSet = new Set(partFilenames.values())
  for (const d of docs) {
    if (!d.filename) {
      errors.push(
        `${configPath}: doc "${d.title ?? '<untitled>'}" is missing "filename". Add a single-word lowercase filename (e.g. "architecture") to this doc.`,
      )
      continue
    }
    if (!/^[a-z]+$/.test(d.filename)) {
      errors.push(
        `${configPath}: doc "${d.title}" has filename "${d.filename}" but filenames must match [a-z]+ (lowercase ASCII letters only — no digits, hyphens, or dots). Rewrite "${d.filename}" as a single lowercase word.`,
      )
      continue
    }
    if (!d.source) {
      errors.push(
        `${configPath}: doc "${d.title}" (filename "${d.filename}") is missing "source". Add the path to the markdown file (e.g. "docs/architecture.md").`,
      )
      continue
    }
    if (partFilenameSet.has(d.filename)) {
      errors.push(
        `${configPath}: filename "${d.filename}" is used by both a part and the doc "${d.title}". Parts and docs share the same output directory — rename the doc to a distinct filename.`,
      )
      continue
    }
    const prior = seen.get(d.filename)
    if (prior) {
      errors.push(
        `${configPath}: filename "${d.filename}" is used by doc "${prior.title}" and doc "${d.title}". Filenames must be unique — rename one of the two.`,
      )
      continue
    }
    seen.set(d.filename, d)
  }
  if (errors.length > 0) {
    throw new Error(
      `tour.json has ${errors.length} invalid doc(s):\n  - ${errors.join('\n  - ')}`,
    )
  }
  return seen
}

/**
 * Render the tour.json `docs` entries into HTML pages in the
 * output directory. Called AFTER meander writes the parts but BEFORE
 * the per-file post-process loop, so the emitted doc pages pick up
 * the same chrome (favicons, preloads, SW register, footer, CSP, SRI)
 * as part pages with no special-casing in the loop.
 *
 * Template contract for each doc:
 *
 *   - <title> is `{doc.title} — Socket PackageURL.js`
 *   - topbar has a `.topic-nav` row with pills for every doc (current
 *     doc gets `class="active"`); post-process injects the home link
 *     at the front of this nav, mirroring what it does for `.part-nav`.
 *   - body is rendered markdown wrapped in `<main class="doc-body">`.
 *
 * Rendering is fanned out across docs via Promise.allSettled. Reject
 * paths surface all failures at once so editing errors in every doc
 * show up in one build, not one-per-build.
 */
/**
 * SVG home icon used in every page's nav. Defined once so the docs
 * renderer and the part-page post-processor emit the same bytes (CSP
 * hash stable across both). Single path, hard-coded stroke — no
 * external sprite or font dep.
 */
const HOME_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9.5 12 3l9 6.5V22h-6v-7h-6v7H3z"/></svg>'

const buildHomeLinkHtml = (active: boolean): string =>
  `<a class="wt-home-link${active ? ' active' : ''}" href="/" aria-label="Back to the table of contents" title="Back to the table of contents"${active ? ' aria-current="page"' : ''}>${HOME_ICON_SVG}</a>`

/**
 * Render the "[home] Topics: 1 2 3 … 8 Architecture Builders …"
 * pill row. Same HTML shape meander emits for its own part-nav —
 * classes and hrefs match so the CSS + post-process pill-enrichment
 * paths in this file apply uniformly.
 *
 * Numbered Part pills come first (reading order across the tour),
 * then doc pills (supporting articles — architecture, contributing,
 * etc.). Matches the unified "Topics" TOC on the index, so there's
 * exactly one vocabulary across the site: every page is a "topic,"
 * some are code walkthroughs (numbered parts) and some are articles
 * (named docs).
 *
 * The home icon is ALWAYS rendered so the nav layout stays identical
 * between the index and part pages (no visual jump when navigating
 * between them). On the index, it's marked `.active` — the same
 * selected-state treatment the current part pill gets on a part page
 * — so users see the home icon as their current location.
 */
function renderPartsPillRow(
  slug: string,
  partFilenames: ReadonlyMap<number, string>,
  homeActive: boolean = false,
  docs?: ReadonlyMap<string, DocEntry>,
  activeDocFilename?: string,
): string {
  const ids = [...partFilenames.keys()].sort((a, b) => a - b)
  const partPills = ids
    .map(id => `<a href="/${slug}/part/${id}">Part ${id}</a>`)
    .join('\n      ')
  const docPills = docs
    ? [...docs.values()]
        .map(d => {
          const activeCls = d.filename === activeDocFilename ? ' active' : ''
          return `<a class="wt-topic-doc${activeCls}" href="/${d.filename}.html" title="${escapeHtml(d.title)}" aria-label="${escapeHtml(d.title)}">${escapeHtml(d.title)}</a>`
        })
        .join('\n      ')
    : ''
  const pills = docPills ? `${partPills}\n      ${docPills}` : partPills
  return (
    `    <div class="part-nav">${buildHomeLinkHtml(homeActive)}<span class="wt-parts-label">Topics:</span>\n` +
    `      ${pills}\n` +
    `    </div>`
  )
}

/**
 * Render the "Topics: A B C … Z" pill row. Mirrors the parts row
 * shape so the same CSS styles both. `activeFilename` marks the
 * current doc's pill with class="active"; pass `undefined` from part
 * pages so no pill is active.
 */
function renderTopicsPillRow(
  docs: ReadonlyMap<string, DocEntry>,
  activeFilename: string | undefined,
): string {
  const pills = [...docs.values()]
    .map(d => {
      const cls = d.filename === activeFilename ? 'active' : ''
      const ariaLabel = d.summary
        ? ` aria-label="${escapeHtml(d.title)}: ${escapeHtml(d.summary)}"`
        : ''
      return `<a class="${cls}" href="/${d.filename}.html" title="${escapeHtml(d.title)}"${ariaLabel}>${escapeHtml(d.title)}</a>`
    })
    .join('\n      ')
  return (
    `    <div class="part-nav wt-topics-nav"><span class="wt-parts-label">Topics:</span>\n` +
    `      ${pills}\n` +
    `    </div>`
  )
}

type RenderDocsOptions = {
  mermaidRenderer?: MermaidRenderer | undefined
}

async function renderDocs(
  docs: ReadonlyMap<string, DocEntry>,
  slug: string,
  partFilenames: ReadonlyMap<number, string>,
  repoRoot: string,
  tourDir: string,
  options?: RenderDocsOptions | undefined,
): Promise<void> {
  const opts = { __proto__: null, ...options } as RenderDocsOptions
  const mermaidRenderer = opts.mermaidRenderer
  if (docs.size === 0) {
    return
  }
  // Configure marked for GFM + single-line breaks. `gfm: true` is the
  // default in marked 18, kept explicit for readers.
  marked.setOptions({ gfm: true, breaks: false })

  const entries = [...docs.values()]

  const renderOne = async (doc: DocEntry): Promise<void> => {
    const sourcePath = path.join(repoRoot, doc.source)
    if (!existsSync(sourcePath)) {
      throw new Error(
        `${doc.source}: source markdown file not found for doc "${doc.title}" (filename "${doc.filename}"). Either create the file, correct the "source" path in tour.json, or remove this doc entry.`,
      )
    }
    const markdown = await fs.readFile(sourcePath, 'utf8')
    /* Parse the markdown through marked's tokenizer so we can
     * intercept fenced `mermaid` blocks and swap in pre-rendered
     * SVG before the HTML is assembled. Falls back to plain
     * marked.parse when no renderer is available (e.g. in tests
     * that don't need diagram support). */
    const withDiagrams = mermaidRenderer
      ? await processMermaidTokens(markdown, mermaidRenderer)
      : await marked.parse(markdown)
    /* Strip "Further reading" sections. The docs we inherited
     * from the repo's READMEs include cross-reference lists that
     * point at sibling docs/*.md files — but we render these to
     * html + expose them via the unified Topics nav, not the
     * original filenames. Rather than rewrite every link by hand,
     * drop the whole section. Removes every `<h2>Further
     * reading</h2>` and all following siblings until the next h2
     * (or end of document). */
    const withoutFurtherReading = stripFurtherReading(withDiagrams)
    /* Italicize parenthetical asides inside prose. Walk only text
     * nodes inside <p>/<li>/<td>/<blockquote> — skip <code>, <pre>,
     * and their descendants so `function(x)` in a code block or a
     * URL's query string doesn't get treated as prose. Matches
     * (two-or-more-char parentheticals that aren't purely symbols)
     * and wraps them in <em>, leaving the parens visible. */
    /* Lift counts + approximations (`41`, `~95%`, `28 tests`)
     * in accent color inside prose. Same treatment the home TOC
     * uses so the rhythm is consistent across the site. */
    const withNumbers = highlightProseNumbers(withoutFurtherReading)
    const italicized = italicizeParentheticals(withNumbers)
    /* Give every heading an id + a hover-visible `#` anchor link
     * so readers can deep-link any section of a doc. Same UX
     * pattern GitHub renders READMEs with. */
    const anchored = anchorifyHeadings(italicized)
    /* Detect ASCII repo-tree code blocks (contain `├──` or `└──`)
     * and mark them up so CSS can dim the drawing characters and
     * lift the annotation column. Keeps the tree as real text
     * (copyable, selectable) while looking less like a raw
     * preformatted dump. */
    const body = enhanceRepoTrees(anchored)
    /* Unified Topics row — parts (numbered) + docs (named). The
     * current doc gets `.active` so its pill reads as "you are
     * here," matching the same treatment a current part pill
     * gets on a part page. */
    const partsRow = renderPartsPillRow(
      slug,
      partFilenames,
      false,
      docs,
      doc.filename,
    )
    const summaryLine = doc.summary
      ? `    <p>${escapeHtml(doc.summary)}</p>\n`
      : ''
    const html =
      `<!doctype html>\n` +
      `<html lang="en">\n` +
      `<head>\n` +
      `  <meta charset="utf-8" />\n` +
      `  <meta name="viewport" content="width=device-width, initial-scale=1" />\n` +
      `  <title>${escapeHtml(doc.title)} — Socket PackageURL.js</title>\n` +
      /* Raw markdown companion — agents that negotiate content
       * type can follow this link and get the source instead of
       * the rendered HTML. Emitted alongside by emitAiArtifacts. */
      `  <link rel="alternate" type="text/markdown" href="/${doc.filename}.md" />\n` +
      `  <link rel="stylesheet" href="/style.css" />\n` +
      // Syntax highlighting — unconditionally load github-dark to
      // match the part pages (which don't media-gate). Our dark
      // panels (.doc-body pre, .code-section) look right with this
      // palette across every theme we ship; a light hljs stylesheet
      // inside a dark panel reads washed out.
      `  <link rel="stylesheet" href="https://unpkg.com/@highlightjs/cdn-assets@11.10.0/styles/github-dark.min.css" />\n` +
      `</head>\n` +
      `<body data-slug="${escapeHtml(slug)}" data-doc="${escapeHtml(doc.filename)}">\n` +
      `  <header class="topbar">\n` +
      `    <h1>${escapeHtml(doc.title)}</h1>\n` +
      summaryLine +
      `${partsRow}\n` +
      `  </header>\n` +
      `\n` +
      `  <main class="doc-body">\n` +
      `${body}\n` +
      `  </main>\n` +
      // highlight.js — loaded at the bottom so code blocks are in the
      // DOM by the time it runs. The SRI + CSP pipeline pass hashes
      // both the <script src> tag and the inline init block later.
      /* `defer` on both so neither blocks HTML parsing. Deferred
       * scripts execute in document order, so by the time the
       * inline init runs `window.hljs` is defined. The init only
       * touches blocks with an explicit `language-*` class —
       * plain unlabeled fenced blocks (like a PURL canonical form
       * sample: `pkg:type/namespace/name@version?q=v#sub`) would
       * get mis-colored by hljs's auto-detection (guessing Ruby
       * or Perl from the `:` and `@`), so we opt them out. The
       * `.wt-repo-tree` exclusion is redundant now but kept as a
       * belt-and-suspenders guard for any future block that
       * happens to land with a language class. */
      /* highlight.min.js ships the "common" bundle — includes JS,
       * bash, shell, json, xml, etc. — but NOT typescript. Load
       * the typescript language pack as a separate deferred
       * script; deferred scripts execute in document order.
       * The init itself MUST wait for DOMContentLoaded — `defer`
       * on an inline <script> is ignored by the HTML spec, so
       * without the listener the init would run at parse time
       * (before the deferred externals execute, so window.hljs
       * would be undefined and the short-circuit `&&` silently
       * skipped). DOMContentLoaded fires AFTER all deferred
       * scripts finish, guaranteeing hljs + the TS grammar are
       * both registered when we query blocks. */
      `  <script src="https://unpkg.com/@highlightjs/cdn-assets@11.10.0/highlight.min.js" defer></script>\n` +
      `  <script src="https://unpkg.com/@highlightjs/cdn-assets@11.10.0/languages/typescript.min.js" defer></script>\n` +
      `  <script>document.addEventListener('DOMContentLoaded',function(){if(!window.hljs)return;document.querySelectorAll('pre:not(.wt-repo-tree) code[class*="language-"]').forEach(function(b){window.hljs.highlightElement(b)})})</script>\n` +
      `</body>\n` +
      `</html>\n`
    await fs.writeFile(path.join(tourDir, `${doc.filename}.html`), html)
  }

  const results = await Promise.allSettled(entries.map(renderOne))
  const failures: string[] = []
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!
    if (r.status === 'rejected') {
      failures.push(
        `${entries[i]!.filename}.html: ${String((r.reason as Error)?.message ?? r.reason)}`,
      )
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `doc rendering failed for ${failures.length} doc(s):\n  - ${failures.join('\n  - ')}`,
    )
  }
}

/**
 * Rewrite index.html's TOC into a single unified Topics list covering
 * parts + docs.
 *
 * Meander emits `<h3>Parts</h3>` with an unadorned list; an earlier
 * version of this script appended a separate `<h3>Topics</h3>`
 * section for the configured docs. Design feedback was that the
 * two-section split looked jumbled and the Parts rows lacked the
 * "what's behind this link" context the Topics rows carried. One
 * unified list under a single "Topics" heading: each row shows title
 * + muted one-liner (section count for parts, summary for docs). CSS
 * styles the rest.
 *
 * Uses node-html-parser to avoid the regex-brittleness of reaching
 * into meander's output — selector queries + element replacement let
 * this survive a future meander output whitespace change.
 *
 * Runs as part of generate()'s post-meander fix-ups. Idempotent via a
 * class marker on the replaced block.
 */
async function rewriteIndexContents(
  partFilenames: ReadonlyMap<number, string>,
  partTitles: ReadonlyMap<number, string>,
  partObjectives: ReadonlyMap<number, string>,
  partCounts: ReadonlyMap<number, number>,
  partLineCounts: ReadonlyMap<number, number>,
  docLineCounts: ReadonlyMap<string, number>,
  docs: ReadonlyMap<string, DocEntry>,
  slug: string,
  tourDir: string,
): Promise<void> {
  const indexPath = path.join(tourDir, 'index.html')
  if (!existsSync(indexPath)) {
    return
  }
  const html = await fs.readFile(indexPath, 'utf8')
  if (html.includes('<div class="wt-contents">')) {
    // Idempotent — an earlier run already rewrote.
    return
  }
  const root = parseHtml(html)

  // Find every annotation-card wrapping a <h3>Parts</h3> or
  // <h3>Topics</h3>. Selector can't express "h3 text equals X," so
  // walk the h3s and climb to their wrapping annotation-card.
  const cardsToRemove = new Set<ReturnType<typeof parseHtml>>()
  for (const h3 of root.querySelectorAll('.annotation-card h3')) {
    const label = h3.text.trim()
    if (label === 'Parts' || label === 'Topics') {
      const card = h3.closest('.annotation-card')
      if (card) {
        cardsToRemove.add(card as unknown as ReturnType<typeof parseHtml>)
      }
    }
  }

  // Build unified rows in stable order: parts 1..N first, then docs
  // in manifest order. Each row is a flat <div> carrying the same
  // shape — title link + muted description on the left (capped reading
  // width via CSS), optional section-count badge on the right. Using
  // <div>s (not <ul>/<li>) sidesteps the browser-default bullet
  // rendering that made the old list look off-tempo.
  /* Wrap small numeric tokens (optionally prefixed with ~) in a
   * styled span so counts and approximations pop visually against
   * the body text. Only 1–3 digit integers qualify — that scope
   * covers every count this tour uses (part numbers, ecosystem
   * counts, section counts) while excluding years like "2026"
   * which should read as plain prose, not quantity emphasis. */
  const highlightNumbers = (escaped: string): string =>
    escaped.replace(/(~?\b\d{1,3}\b)/g, '<span class="wt-num">$1</span>')

  /* Render markdown-style *italic* spans. Runs on already-escaped
   * prose — the escape pass can't emit literal '*' from entities,
   * so every '*' we see is a user-authored italic marker. */
  const renderItalics = (escaped: string): string =>
    escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>')

  /* Render markdown-style [label](href) links. Runs on already-
   * HTML-escaped prose. Only https/http/relative URLs are allowed —
   * anything else (javascript:, data:, …) is left as literal text
   * so a tour.json typo can't inject an unsafe href. External URLs
   * open in a new tab with noopener; bare "/" paths stay same-tab. */
  const renderLinks = (escaped: string): string =>
    escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const safeHref = /^(https?:\/\/|\/)/.test(href) ? href : null
      if (!safeHref) {
        return `[${label}](${href})`
      }
      const external = safeHref.startsWith('http')
      const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : ''
      return `<a class="wt-toc-link" href="${safeHref}"${attrs}>${label}</a>`
    })

  /* Compose the non-code decorations: links first (so their label
   * text can still receive italic + numeric treatment), then
   * italics, then numeric highlights. Each pass is idempotent on
   * already-decorated output. */
  const decoratePlain = (escaped: string): string =>
    highlightNumbers(renderItalics(renderLinks(escaped)))

  /* Render inline markdown-style `backtick` spans as <code> while
   * keeping every other character HTML-escaped. Supports a single
   * level of backtick-delimited spans; no nested backticks. Italics
   * + numeric highlights apply only OUTSIDE code spans. */
  const renderInlineCode = (text: string): string => {
    const parts = text.split('`')
    if (parts.length === 1) {
      return decoratePlain(escapeHtml(text))
    }
    let out = ''
    for (let i = 0; i < parts.length; i++) {
      const rawSegment = parts[i]!
      const escaped = escapeHtml(rawSegment)
      const isCode = i % 2 === 1
      if (i === parts.length - 1 && !isCode) {
        out += decoratePlain(escaped)
        break
      }
      if (isCode) {
        out += `<code>${escaped}</code>`
      } else {
        out += decoratePlain(escaped)
      }
    }
    return out
  }
  /* Render a TOC row with two badges:
   *   - kind:  "code" for parts (walkthroughs of source files) or
   *            "article" for docs (long-form prose).
   *   - size:  content-size tier from line count — small / medium
   *            / large / x-large. Tells the reader roughly how
   *            much time to set aside for the page. */
  const renderRow = (
    href: string,
    title: string,
    description: string,
    kind: 'code' | 'article',
    lineCount: number | undefined,
  ): string => {
    const badges: string[] = []
    badges.push(
      `<span class="wt-contents-badge wt-badge-kind wt-badge-kind-${kind}">${kind}</span>`,
    )
    if (lineCount !== undefined) {
      const tier = sizeTier(lineCount)
      badges.push(
        `<span class="wt-contents-badge wt-badge-size wt-badge-size-${tier.key}" title="~${lineCount} lines">${escapeHtml(tier.label)}</span>`,
      )
    }
    const badgesHtml = `          <div class="wt-contents-badges">${badges.join('')}</div>\n`
    return (
      `        <div class="wt-contents-row">\n` +
      `          <div class="wt-contents-main">\n` +
      `            <a class="wt-contents-title" href="${href}">${escapeHtml(title)}</a>\n` +
      (description
        ? `            <p class="wt-contents-summary">${renderInlineCode(description)}</p>\n`
        : '') +
      `          </div>\n` +
      badgesHtml +
      `        </div>`
    )
  }
  const rows: string[] = []
  for (const [id, filename] of [...partFilenames.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    const title = partTitles.get(id) ?? `Part ${id}`
    const description = partObjectives.get(id) ?? ''
    const lineCount = partLineCounts.get(id)
    rows.push(
      renderRow(`/${filename}.html`, title, description, 'code', lineCount),
    )
  }
  for (const d of docs.values()) {
    const docLineCount = docLineCounts.get(d.filename)
    rows.push(
      renderRow(
        `/${d.filename}.html`,
        d.title,
        d.summary ?? '',
        'article',
        docLineCount,
      ),
    )
  }
  /* Intro block: the npm package name. The tour title
   * ("Socket PackageURL.js") is a product name — the actual npm
   * coordinates live in @socketregistry/packageurl-js, a Socket
   * Optimized override of the upstream packageurl-js package.
   * Showing install coordinates above the TOC answers the first
   * question a new visitor asks without making them chase through
   * docs for it. */
  const introHtml =
    `    <div class="wt-intro">\n` +
    `      <p class="wt-intro-line">` +
    `Published on npm as ` +
    `<a class="wt-intro-pkg" href="https://socket.dev/npm/package/@socketregistry/packageurl-js" target="_blank" rel="noopener noreferrer">` +
    `<code>@socketregistry/packageurl-js</code></a>` +
    ` — a <a class="wt-intro-link" href="https://socket.dev/blog/introducing-socket-optimize" target="_blank" rel="noopener noreferrer">Socket Optimized</a> override of the upstream ` +
    `<a class="wt-intro-link" href="https://socket.dev/npm/package/packageurl-js" target="_blank" rel="noopener noreferrer"><code>packageurl-js</code></a>.` +
    `</p>\n` +
    `      <pre class="wt-intro-install"><code>npm install @socketregistry/packageurl-js</code></pre>\n` +
    `    </div>`
  const blockHtml =
    introHtml +
    '\n' +
    `    <div class="wt-contents">\n` +
    `      <h3>Topics</h3>\n` +
    `${rows.join('\n')}\n` +
    `    </div>`

  // Place the new block where the first Parts/Topics card was, then
  // remove the rest. This preserves visual position for any existing
  // surrounding content (e.g. a future Documents card).
  const firstCard = [...cardsToRemove][0]
  if (firstCard) {
    // replaceWith takes a plain string on node-html-parser.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(firstCard as any).replaceWith(blockHtml)
    for (const card of cardsToRemove) {
      if (card !== firstCard) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(card as any).remove()
      }
    }
  } else {
    // No existing card to replace — append inside <main>.
    const main = root.querySelector('main')
    if (main) {
      main.insertAdjacentHTML('beforeend', `\n${blockHtml}\n`)
    }
  }

  // Inject the Parts pill row below the topbar on the index. Part
  // pages already carry this row (meander emits it inside their
  // topbar, and the per-page post-process below will lift it out);
  // the index page is structurally different (it IS the TOC) so
  // meander leaves the row out. Adding it here makes the chrome
  // consistent between index and part pages. No home link — the
  // index IS home — and no pill is `active` (you can't be "on" a
  // part from the TOC). Inserted as a sibling AFTER the topbar so
  // it spans the full width without competing with the wordmark.
  const indexTopbar = root.querySelector('.topbar')
  if (indexTopbar && !root.querySelector('.part-nav')) {
    /* On the index, show the full unified Topics row (parts +
     * docs), with the home icon active. No single doc is active
     * since we're on home. */
    indexTopbar.insertAdjacentHTML(
      'afterend',
      '\n' + renderPartsPillRow(slug, partFilenames, true, docs),
    )
  }

  // Meander emits a hard-coded `style="padding: 16px; max-width:
  // 900px;"` on the index page's <main>. Our strict CSP blocks
  // inline style attributes (style-src 'self', no 'unsafe-hashes'),
  // so the browser rejects it and logs a violation every page load.
  // The width constraint is also wrong for our design — the TOC
  // should use the full viewport with internal centering handled by
  // our stylesheet. Strip the attribute entirely.
  const indexMain = root.querySelector('main')
  if (indexMain) {
    indexMain.removeAttribute('style')
  }

  // Restructure the topbar wordmark. Meander emits a flat <h1>
  // carrying tour.json's title; we split it into:
  //   <h1>
  //     <code class="wt-product">packageurl-js</code>
  //     <span class="wt-descriptor">override by Socket</span>
  //   </h1>
  // Rationale:
  //   - Product is the npm package the tour documents
  //     (packageurl-js) — styled as <code> so it reads as a literal
  //     package coordinate, not a marketing name.
  //   - "override by Socket" is a descriptor line in a sly purple,
  //     spelling out what we maintain (the @socketregistry
  //     override). No ambiguous "Socket PackageURL" branding.
  // Only the index's topbar carries this wordmark — part/doc pages
  // substitute their own title (the part name) there.
  const topbarH1 = root.querySelector('.topbar h1')
  if (topbarH1) {
    const text = topbarH1.text
    const wordmarkMatch = text.match(/^(packageurl-js) override by (Socket)$/)
    if (wordmarkMatch) {
      /* "Socket" in the descriptor is an <a.wt-src-link> pointing
       * at socket.dev — same Cmd/Ctrl-click-to-reveal affordance
       * the source-code links in part pages use, so it stays
       * visually invisible until the reader holds the modifier
       * key. Consistent "hidden link" pattern across the site. */
      topbarH1.set_content(
        `<code class="wt-product">${escapeHtml(wordmarkMatch[1]!)}</code>` +
          `<span class="wt-descriptor">override by ` +
          `<a class="wt-src-link" data-link-type="url" href="https://socket.dev" target="_blank" rel="noopener noreferrer">${escapeHtml(wordmarkMatch[2]!)}</a>` +
          `</span>`,
      )
    }
  }

  await fs.writeFile(indexPath, root.toString())
}

/**
 * Validate the `filename` field on every tour.json part, then
 * build the part-id → filename map the post-processor uses to rename
 * emitted HTML and rewrite hrefs.
 *
 * Invariants:
 *   - every part has `filename` set
 *   - `filename` is [a-z]+ (lowercase ASCII letters, no digits, no
 *     hyphens, no dots). Single-word nouns keep public URLs short and
 *     speakable — see .claude/skills/content-filename-from-title.
 *   - `filename` is unique across all parts
 *
 * Errors follow the ERROR MESSAGES doctrine in CLAUDE.md: what rule,
 * where, saw-vs-wanted, fix. Collects all violations before throwing
 * so the build reports every broken part in one pass, not just the
 * first one found.
 */
function validatePartFilenames(
  parts: ReadonlyArray<{ id: number; title: string; filename?: string }>,
  configPath: string,
): Map<number, string> {
  const errors: string[] = []
  const seen = new Map<string, number>()
  for (const p of parts) {
    if (!p.filename) {
      errors.push(
        `${configPath}: part ${p.id} ("${p.title}") is missing "filename". Add a single-word lowercase filename (e.g. "anatomy") to this part — one per part is required to route /<slug>/part/${p.id} at publish time.`,
      )
      continue
    }
    if (!/^[a-z]+$/.test(p.filename)) {
      errors.push(
        `${configPath}: part ${p.id} ("${p.title}") has filename "${p.filename}" but filenames must match [a-z]+ (lowercase ASCII letters only — no digits, hyphens, or dots). Rewrite "${p.filename}" as a single lowercase word.`,
      )
      continue
    }
    const prior = seen.get(p.filename)
    if (prior !== undefined) {
      errors.push(
        `${configPath}: filename "${p.filename}" is used by both part ${prior} and part ${p.id} ("${p.title}"). Filenames must be unique — rename one of the two to a distinct single-word lowercase filename.`,
      )
      continue
    }
    seen.set(p.filename, p.id)
  }
  if (errors.length > 0) {
    throw new Error(
      `tour.json has ${errors.length} invalid part filename(s):\n  - ${errors.join('\n  - ')}`,
    )
  }
  const map = new Map<number, string>()
  for (const p of parts) {
    map.set(p.id, p.filename!)
  }
  return map
}

/**
 * Rewrite a parsed document for hosting under `basePath`. Three
 * categories of URL get prefixed, mutating the DOM in place:
 *
 *   1. Val-Town-shaped part links (/<slug>/part/<n>) — these don't
 *      exist as files; rewrite to the real flat HTML name
 *      (<partFilenames[n]>.html, e.g. "anatomy.html") and prefix with
 *      basePath.
 *   2. Root-relative asset URLs on [href] and [src] attributes.
 *   3. ServiceWorker `register('/path')` calls inside inline scripts.
 *
 * Operates via node-html-parser selectors + attribute reads/writes,
 * so attribute-order and quoting style in the source don't matter.
 */
function applyBasePath(
  root: HTMLElement,
  basePath: string,
  slug: string,
  partFilenames: ReadonlyMap<number, string>,
): void {
  if (!basePath) {
    return
  }
  const partLinkPrefix = `/${slug}/part/`
  // 1. Flat part link — rewrite first so step 2 doesn't double-prefix.
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? ''
    if (!href.startsWith(partLinkPrefix)) {
      continue
    }
    const rest = href.slice(partLinkPrefix.length).replace(/\/$/, '')
    const n = Number(rest)
    if (!Number.isFinite(n)) {
      continue
    }
    const filename = partFilenames.get(n)
    if (!filename) {
      continue
    }
    a.setAttribute('href', `${basePath}/${filename}.html`)
  }
  // 2. Root-relative asset URLs. Walk any element carrying href/src
  // and prefix same-origin absolute paths.
  const prefixAttr = (el: HTMLElement, attr: 'href' | 'src'): void => {
    const value = el.getAttribute(attr)
    if (!value || !value.startsWith('/')) {
      return
    }
    if (value.startsWith(basePath + '/') || value === basePath) {
      return
    }
    if (value.startsWith(partLinkPrefix)) {
      // Part links handled above — don't double-prefix if the step 1
      // branch dropped through (no matching filename entry).
      return
    }
    el.setAttribute(attr, `${basePath}${value}`)
  }
  for (const el of root.querySelectorAll('[href]')) {
    prefixAttr(el, 'href')
  }
  for (const el of root.querySelectorAll('[src]')) {
    prefixAttr(el, 'src')
  }
  // 3. ServiceWorker register — rewrite .register('/sw.js') inside
  // inline scripts. The register call lives inside the swRegisterTag
  // inline block, so mutate the script's text content directly.
  const swRegisterRe = /\.register\('(\/[^']+)'/g
  for (const script of root.querySelectorAll('script')) {
    if (script.getAttribute('src')) {
      continue
    }
    const text = script.text
    if (!text.includes('.register(')) {
      continue
    }
    const updated = text.replace(swRegisterRe, (_m, url) =>
      url.startsWith(basePath + '/')
        ? `.register('${url}'`
        : `.register('${basePath}${url}'`,
    )
    if (updated !== text) {
      script.set_content(updated)
    }
  }
}

/**
 * Build the `sha512-<base64>` SRI attribute value for a byte stream.
 *
 * Fleet convention (see @socketsecurity/lib/dlx/integrity): integrity
 * is sha512 SRI, matching what the npm registry returns; checksum is
 * sha256 hex. We only produce integrity here — browser SRI + CSP want
 * SRI format.
 */
function computeIntegrity(bytes: Uint8Array): string {
  return `sha512-${cryptoHash('sha512', bytes, 'base64')}`
}

/**
 * Build a `<meta http-equiv="Content-Security-Policy">` tag for a
 * specific HTML page. Inline `<script>` blocks (meander's hljs
 * bootstrap, our SW register, __defIndex, socketWalkthrough config)
 * are individually sha256-hashed and allowlisted so we can avoid
 * `'unsafe-inline'`. All remaining directives are tight:

 *   script-src    self + unpkg + per-script hashes
 *   style-src     self + unpkg (no inline styles generated)
 *   connect-src   self + val backend (when configured)
 *   img-src       self + data: (CSS validity icons use data URIs)
 *   font-src      self (self-hosted Geist + Geist Mono)
 *   worker-src    self (service worker)
 *   base-uri, form-action   self
 *   frame-ancestors         none (clickjacking protection)
 *   default-src             self (fallback for anything not listed)
 */
function buildCspMeta(root: HTMLElement, commentBackend: string): string {
  // Collect each inline script body, hash it as sha512 — same algo
  // as our SRI attributes, consistent with the fleet convention.
  // Meander + our post-processor both emit inline scripts (no src
  // attr) that need per-hash allowlisting; `<script src>` scripts are
  // covered by the SRI hash below.
  const inlineScriptHashes = new Set<string>()
  const cdnScriptHashes = new Set<string>()
  const cdnStyleHashes = new Set<string>()

  for (const script of root.querySelectorAll('script')) {
    const src = script.getAttribute('src')
    if (src) {
      // Pull the already-computed SRI hash off cross-origin script
      // tags. CSP accepts sha256/384/512 hashes directly as allowlist
      // entries — stricter than listing the CDN origin, because a
      // compromised unpkg serving a different bundle fails the CSP
      // check *before* SRI even runs. Same-origin tags don't need
      // hashes here (covered by 'self' + their own SRI attribute).
      if (src.startsWith('https:')) {
        const integrity = script.getAttribute('integrity')
        if (integrity) {
          cdnScriptHashes.add(`'${integrity}'`)
        }
      }
      continue
    }
    const body = script.text
    const hash = cryptoHash('sha512', body, 'base64')
    inlineScriptHashes.add(`'sha512-${hash}'`)
  }

  for (const link of root.querySelectorAll('link')) {
    if (link.getAttribute('rel') !== 'stylesheet') {
      continue
    }
    const href = link.getAttribute('href')
    if (!href || !href.startsWith('https:')) {
      continue
    }
    const integrity = link.getAttribute('integrity')
    if (integrity) {
      cdnStyleHashes.add(`'${integrity}'`)
    }
  }

  /* Collect SHA-256 hashes of every inline `style="…"` attribute
   * in the page (primarily Mermaid-emitted SVG styles) so CSP can
   * allow them individually. Needs 'unsafe-hashes' alongside —
   * per-style hashes are gated on that keyword per CSP3 spec. */
  const inlineStyleAttrHashes = new Set<string>()
  const collectInlineStyles = (node: HTMLElement): void => {
    /* Include empty-string `style=""` too — CSP still checks it
     * against the hash list, and the empty string hashes to a
     * known sha256. Without this, elements with `style=""`
     * (Mermaid emits these on some shape primitives) get blocked. */
    const style = node.getAttribute('style')
    if (style !== null && style !== undefined) {
      const hash = cryptoHash('sha256', style, 'base64')
      inlineStyleAttrHashes.add(`'sha256-${hash}'`)
    }
    for (const child of node.childNodes) {
      if ((child as HTMLElement).nodeType === 1) {
        collectInlineStyles(child as HTMLElement)
      }
    }
  }
  collectInlineStyles(root)

  /* Also hash <style>…</style> element contents (Mermaid SVGs
   * inline a stylesheet block; CSP's style-src with 'self'
   * doesn't cover inline element bodies). */
  const inlineStyleElementHashes = new Set<string>()
  for (const style of root.querySelectorAll('style')) {
    const body = style.text
    if (body) {
      const hash = cryptoHash('sha256', body, 'base64')
      inlineStyleElementHashes.add(`'sha256-${hash}'`)
    }
  }

  const scriptSources = ["'self'", ...inlineScriptHashes, ...cdnScriptHashes]
  const styleSources = [
    "'self'",
    ...cdnStyleHashes,
    ...inlineStyleElementHashes,
    ...(inlineStyleAttrHashes.size > 0
      ? ["'unsafe-hashes'", ...inlineStyleAttrHashes]
      : []),
  ]

  const connectSources = ["'self'"]
  if (commentBackend) {
    const origin = new URL(commentBackend).origin
    connectSources.push(origin)
  }
  // Note: `frame-ancestors` and `sandbox` are ignored when CSP is
  // delivered via <meta http-equiv> (spec-level — browsers may have
  // already begun rendering a framed page by the time they parse
  // meta tags). We'd get a console warning for emitting them here,
  // with no actual clickjacking protection to show for it. When/if
  // this deploy moves to a host that can set response headers
  // (Cloudflare Workers, Netlify `_headers`, Val Town routing),
  // add `frame-ancestors 'none'` as a real HTTP header.
  const directives = [
    `default-src 'self'`,
    `script-src ${scriptSources.join(' ')}`,
    `style-src ${styleSources.join(' ')}`,
    `img-src 'self' data:`,
    `connect-src ${connectSources.join(' ')}`,
    `font-src 'self'`,
    `worker-src 'self'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ]
  const content = directives.join('; ')
  return `<meta http-equiv="Content-Security-Policy" content="${content}" />`
}

/**
 * Compute / look up the SRI hash for a CDN URL. Disk-cached under
 * `.cache/sri/<base64url(url)>.txt` so repeat builds don't refetch.
 * Version bumps invalidate automatically since the cache key is the
 * full URL (including the @version segment).
 *
 * Returns a ready-to-paste `sha384-<base64>` string.
 */
async function sriForUrl(url: string, cacheDir: string): Promise<string> {
  const key = Buffer.from(url).toString('base64url')
  const cachePath = path.join(cacheDir, `${key}.txt`)
  if (existsSync(cachePath)) {
    return (await fs.readFile(cachePath, 'utf8')).trim()
  }
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`SRI fetch ${url} → HTTP ${res.status}`)
  }
  const integrity = computeIntegrity(new Uint8Array(await res.arrayBuffer()))
  await fs.mkdir(cacheDir, { recursive: true })
  await fs.writeFile(cachePath, integrity + '\n')
  return integrity
}

/**
 * Scan HTML for `<script src=...>`, `<link rel=stylesheet href=...>`,
 * and `<link rel=preload as=script href=...>` tags, hash each resource,
 * and inject `integrity="sha384-..."` so the browser rejects tampered
 * responses (CDN or our own origin).
 *
 * Sources:
 *   - `https://unpkg.com/...` → fetched + disk-cached (see sriForUrl).
 *   - `/style.css` etc. → read from `tourDir` directly.
 *   - `basePath`-prefixed same-origin paths → stripped to the bare
 *     file name, then read from `tourDir`.
 *
 * CDN tags also get `crossorigin="anonymous"` (required for the SRI
 * check to run on cross-origin responses). Same-origin tags don't
 * need it and shouldn't have it (would trigger CORS unnecessarily).
 *
 * Idempotent — tags that already carry `integrity=` are left alone.
 */
async function injectSri(
  root: HTMLElement,
  tourDir: string,
  basePath: string,
  cacheDir: string,
): Promise<void> {
  // Map of URL/path → SRI hash. Populated lazily as we walk the tag
  // list so we resolve each URL at most once per file.
  const integrityByRef = new Map<string, string>()

  const resolveIntegrity = async (ref: string): Promise<string | null> => {
    if (integrityByRef.has(ref)) {
      return integrityByRef.get(ref) || null
    }
    let integrity: string | null = null
    if (ref.startsWith('https://unpkg.com/')) {
      integrity = await sriForUrl(ref, cacheDir)
    } else if (ref.startsWith('/')) {
      // Strip leading basePath if present so we can read the bare
      // filename out of the output dir.
      const bareRef =
        basePath && ref.startsWith(basePath + '/')
          ? ref.slice(basePath.length)
          : ref
      const localPath = path.join(tourDir, bareRef)
      if (existsSync(localPath)) {
        integrity = computeIntegrity(await fs.readFile(localPath))
      }
    }
    integrityByRef.set(ref, integrity ?? '')
    return integrity
  }

  // Browsers only honor `integrity` on:
  //   <script>
  //   <link rel=stylesheet>
  //   <link rel=preload>  / <link rel=modulepreload>
  // `<link rel=icon>` / `<link rel=apple-touch-icon>` ignore it, so
  // skip them — no point emitting hash bytes the browser throws away.
  const getRef = (el: HTMLElement): string | null => {
    if (el.rawTagName.toLowerCase() === 'script') {
      const src = el.getAttribute('src')
      if (!src) {
        return null
      }
      return src.startsWith('https://unpkg.com/') || src.startsWith('/')
        ? src
        : null
    }
    const rel = (el.getAttribute('rel') ?? '').toLowerCase()
    if (!/\b(?:stylesheet|preload|modulepreload)\b/.test(rel)) {
      return null
    }
    const href = el.getAttribute('href')
    if (!href) {
      return null
    }
    return href.startsWith('https://unpkg.com/') || href.startsWith('/')
      ? href
      : null
  }

  const candidates: HTMLElement[] = []
  for (const el of root.querySelectorAll('script,link')) {
    if (el.getAttribute('integrity')) {
      continue
    }
    const ref = getRef(el)
    if (ref) {
      candidates.push(el)
    }
  }

  // Resolve every ref first (may await disk reads + network fetches),
  // then set attributes synchronously. `setAttribute` is non-async so
  // the two-pass lets us keep the DOM writes uncluttered by awaits.
  await Promise.all(
    candidates.map(el => {
      const ref = getRef(el)!
      return resolveIntegrity(ref)
    }),
  )

  for (const el of candidates) {
    const ref = getRef(el)!
    const integrity = integrityByRef.get(ref)
    if (!integrity) {
      continue
    }
    el.setAttribute('integrity', integrity)
    // crossorigin=anonymous only makes sense (and is required for SRI)
    // on cross-origin requests. Same-origin tags shouldn't carry it.
    if (ref.startsWith('https://')) {
      el.setAttribute('crossorigin', 'anonymous')
    }
  }
}

async function generate(
  refresh: boolean,
  minify: boolean,
  basePath: string,
  rest: readonly string[],
): Promise<void> {
  if (rest.length === 0) {
    console.error(
      'Usage: pnpm tour [--refresh] [--minify] [--base-path=/prefix] generate <tour.json>',
    )
    process.exit(1)
  }
  await ensureMeander(refresh)

  // Private scratch directory for this build. Meander writes into
  // <cwd>/walkthrough so we keep cwd=repoRoot (meander needs it to
  // resolve src/ + tour.json), then immediately move its output into
  // buildDir for all post-processing. Same-filesystem rename, so no
  // EXDEV risk. The try/finally at the bottom cleans up buildDir on
  // both success and failure.
  const buildRoot = await fs.mkdtemp(
    path.join(repoRoot, `.tour-build-${randomUUID()}-`),
  )
  const buildDir = path.join(buildRoot, 'walkthrough')
  try {
    run(process.execPath, [cliEntry, 'generate', ...rest], repoRoot)

    // Move meander's freshly-written output into our private scratch
    // area. After this rename, repoRoot/walkthrough no longer exists
    // and all subsequent work happens in buildDir.
    const meanderOut = path.join(repoRoot, 'walkthrough')
    if (!existsSync(meanderOut)) {
      throw new Error(
        `meander did not emit ${meanderOut}. The generator reported success but left no walkthrough/ directory behind — re-run with --refresh to rebuild the submodule.`,
      )
    }
    await fs.rename(meanderOut, buildDir)

    // Replace meander's emitted CSS with ours wholesale. Earlier we
    // appended our overrides to meander's base, then fought for
    // specificity; now we own 100% of the stylesheet. Meander emits
    // the HTML shape (class names, structure); our CSS from scratch
    // decides every visual rule that applies to it. The file gets
    // renamed to style.css below, before minification + SRI.
    const overrideCssPath = path.join(repoRoot, 'overrides.css')
    const emittedCss = path.join(buildDir, 'walkthrough.css')
    if (existsSync(overrideCssPath)) {
      await fs.copyFile(overrideCssPath, emittedCss)
    }

    // Ship the column-splitter JS alongside the generated HTML.
    const dragSrc = path.join(repoRoot, 'drag.js')
    if (existsSync(dragSrc)) {
      await fs.copyFile(dragSrc, path.join(buildDir, 'drag.js'))
    }

    // Ship the service worker — cache-first for same-origin assets,
    // network-first for HTML navigations, network-passthrough for the
    // comment API. The SW file carries a `__CACHE_VERSION__` sentinel
    // that we replace here with the current git HEAD SHA so every
    // deploy flips the SW's bytes → browser detects a new SW →
    // `activate` prunes the old cache. Falls back to timestamp if
    // we're not in a git repo (tarball install, fresh clone pre-init).
    const swSrc = path.join(repoRoot, 'sw.js')
    if (existsSync(swSrc)) {
      let swSource = await fs.readFile(swSrc, 'utf8')
      let cacheVersion: string
      try {
        cacheVersion = execFileSync(
          'git',
          ['rev-parse', '--short=12', 'HEAD'],
          {
            cwd: repoRoot,
            encoding: 'utf8',
          },
        )
          .toString()
          .trim()
      } catch {
        cacheVersion = 'ts-' + Date.now().toString(36)
      }
      swSource = swSource.replaceAll('__CACHE_VERSION__', cacheVersion)
      await fs.writeFile(path.join(buildDir, 'sw.js'), swSource)
    }

    // Ship favicons (self-hosted copy of socket.dev's icons). The emitted
    // HTML doesn't currently carry <link rel="icon"> tags from meander,
    // so we inject them in the post-processor below. Parallelize via
    // Promise.allSettled so one missing favicon doesn't abort the others.
    const faviconSrc = path.join(repoRoot, 'assets', 'favicon')
    const faviconFiles = [
      'favicon.ico',
      'favicon-32x32.png',
      'favicon-16x16.png',
      'apple-touch-icon.png',
    ] as const
    await Promise.allSettled(
      faviconFiles.map(f => {
        const src = path.join(faviconSrc, f)
        if (!existsSync(src)) {
          return Promise.resolve()
        }
        return fs.copyFile(src, path.join(buildDir, f))
      }),
    )

    // Ship self-hosted fonts. Geist + Geist Mono variable woff2 files
    // live under fonts/ at the repo root; copy them into pages/fonts/
    // so the emitted @font-face rules resolve same-origin. Also copy
    // OFL.txt — SIL OFL-1.1 requires the license to ship alongside.
    const fontSrcDir = path.join(repoRoot, 'fonts')
    const fontFiles = ['Geist.woff2', 'GeistMono.woff2', 'OFL.txt'] as const
    if (existsSync(fontSrcDir)) {
      const fontDestDir = path.join(buildDir, 'fonts')
      await fs.mkdir(fontDestDir, { recursive: true })
      await Promise.allSettled(
        fontFiles.map(f => {
          const src = path.join(fontSrcDir, f)
          if (!existsSync(src)) {
            return Promise.resolve()
          }
          return fs.copyFile(src, path.join(fontDestDir, f))
        }),
      )
    }

    // Ship the comment-UI replacement (optional — only when a commentBackend
    // is configured). The shim is loaded instead of meander's inlined comment
    // scripts, which the rewrite below strips.
    const commentsSrc = path.join(repoRoot, 'comments.js')
    const configPath = rest[0]
    const tourConfig = configPath
      ? (JSON.parse(await fs.readFile(path.resolve(configPath), 'utf8')) as {
          slug?: string
          commentBackend?: string
          parts?: Array<{
            id: number
            title: string
            filename?: string
            objective?: string
            files?: string[]
          }>
          docs?: Array<{
            filename?: string | undefined
            title?: string | undefined
            source?: string | undefined
            summary?: string | undefined
          }>
        })
      : {}
    const commentBackend = tourConfig.commentBackend || ''
    const slug = tourConfig.slug || ''
    // Map part-id → title for the post-processor to inject as aria-label
    // on each numbered part pill. Without this, screen readers announce
    // each pill as just "Part 1", "Part 2", …; with it, they get the
    // real section title ("Anatomy of a PURL" etc.).
    const partTitles = new Map<number, string>()
    const partObjectives = new Map<number, string>()
    /* Per-part line-count tally, summed across every source file the
     * part covers. Drives the content-size badge ("small" / "medium"
     * / "large" / "x-large") shown on the index TOC and on doc rows.
     * Line count beats section count because it tracks actual reading
     * effort — a file with 5 long sections isn't the same effort as
     * a file with 5 one-liner sections. */
    const partLineCounts = new Map<number, number>()
    for (const p of tourConfig.parts ?? []) {
      partTitles.set(p.id, p.title)
      if (p.objective) {
        partObjectives.set(p.id, p.objective)
      }
      let lineTotal = 0
      for (const relFile of p.files ?? []) {
        const abs = path.join(repoRoot, relFile)
        if (!existsSync(abs)) {
          continue
        }
        try {
          const src = await fs.readFile(abs, 'utf8')
          lineTotal += src.split('\n').length
        } catch {
          /* unreadable file — skip, the count is advisory */
        }
      }
      if (lineTotal > 0) {
        partLineCounts.set(p.id, lineTotal)
      }
    }

    // Map part-id → filename (e.g. 1 → "anatomy"). Drives both the flat
    // HTML filenames on disk (<filename>.html) and the hrefs we rewrite
    // in applyBasePath(). Validator below enforces presence, shape, and
    // uniqueness — errors follow CLAUDE.md's ERROR MESSAGES doctrine so
    // the build fails with an actionable message, not a cryptic symptom.
    const partFilenames = validatePartFilenames(
      tourConfig.parts ?? [],
      configPath ? path.resolve(configPath) : '<config>',
    )

    // Pull per-part section counts off the emitted index page. Meander
    // computes them while rendering — cheaper + more reliable than
    // re-parsing every part page here. Matches the TOC row shape:
    //   <li><a href="/<slug>/part/<n>">…</a> <span class="ok">(N sections)</span></li>
    // Used below to append "(N)" to each numbered pill so users see
    // section-depth info from any page, not just the TOC.
    const partCounts = new Map<number, number>()
    const indexPath = path.join(buildDir, 'index.html')
    if (existsSync(indexPath)) {
      const indexHtml = await fs.readFile(indexPath, 'utf8')
      const countRe = new RegExp(
        `/${slug}/part/(\\d+)[^<]*</a>\\s*<span[^>]*>\\((\\d+)\\s+sections?\\)`,
        'g',
      )
      for (const m of indexHtml.matchAll(countRe)) {
        partCounts.set(Number(m[1]), Number(m[2]))
      }
    }
    if (commentBackend && existsSync(commentsSrc)) {
      await fs.copyFile(commentsSrc, path.join(buildDir, 'comments.js'))
    }

    // Render the tour.json `docs` entries into flat HTML pages
    // alongside the part files. Runs BEFORE the per-file post-process
    // loop below so docs receive the same treatment as parts (favicons,
    // preloads, drag/SW/comments scripts, CSP, SRI, footer) without
    // per-surface branching.
    const docEntries = (tourConfig.docs ?? []).filter(
      (d): d is DocEntry =>
        typeof d.filename === 'string' &&
        typeof d.title === 'string' &&
        typeof d.source === 'string',
    )
    const docFilenames = validateDocFilenames(
      docEntries,
      partFilenames,
      configPath ? path.resolve(configPath) : '<config>',
    )
    /* Build-time Mermaid renderer — one puppeteer browser shared
     * across every diagram. Cache keyed by sha256(mermaid_version
     * + theme + source) lives under node_modules/.cache/mermaid.
     * Close the browser in finally so we never leak a Chromium
     * process. */
    const mermaidCacheDir = path.join(
      repoRoot,
      'node_modules',
      '.cache',
      'mermaid',
    )
    const mermaidRenderer = await createMermaidRenderer({
      repoRoot,
      cacheDir: mermaidCacheDir,
    })
    try {
      await renderDocs(docFilenames, slug, partFilenames, repoRoot, buildDir, {
        mermaidRenderer,
      })
    } finally {
      await mermaidRenderer.close()
    }

    /* Emit AI-agent-friendly artifacts:
     *   /llms.txt          — index of every doc + part as a plain
     *                        markdown-formatted link list (the
     *                        emerging llms.txt convention).
     *   /llms-full.txt     — the entire site concatenated into one
     *                        long markdown file so an agent can
     *                        consume the project in one request.
     *   /<name>.md         — raw markdown copy alongside each
     *                        rendered HTML doc (agents that
     *                        content-negotiate pick .md over .html).
     * Every path is same-origin so CSP `default-src 'self'` covers
     * it; no additional rules needed. */
    await emitAiArtifacts(
      buildDir,
      repoRoot,
      slug,
      tourConfig.title ?? '',
      docFilenames,
      tourConfig.parts ?? [],
    )
    /* Count lines in each doc's source markdown, same as parts, so
     * the TOC's size-tier badge can show a meaningful estimate for
     * prose pages. Missing/unreadable files just drop out of the
     * map — the badge is advisory, not load-bearing. */
    const docLineCounts = new Map<string, number>()
    for (const doc of docFilenames.values()) {
      const abs = path.join(repoRoot, doc.source)
      if (!existsSync(abs)) {
        continue
      }
      try {
        const src = await fs.readFile(abs, 'utf8')
        docLineCounts.set(doc.filename, src.split('\n').length)
      } catch {
        /* unreadable — skip */
      }
    }
    // Extend index.html with a Topics section pointing at each doc. Runs
    // after docs are rendered (no ordering dependency — the section just
    // links by filename) and before post-process so any hrefs get the
    // base-path rewrite if CI set one.
    await rewriteIndexContents(
      partFilenames,
      partTitles,
      partObjectives,
      partCounts,
      partLineCounts,
      docLineCounts,
      docFilenames,
      slug,
      buildDir,
    )

    // Per-HTML post-processing: strip meander's inlined comment scripts
    // (when we're replacing them) and inject our own <script> tags.
    // Each entry is a unique string present in one of meander's inline
    // scripts — we match on the marker and delete the whole <script>...
    // </script> block. Ordered by the file each marker comes from:
    //   1. comment-client.js
    //   2. unresolved-comments.js
    //   3. export-comments.js
    //   4. line-select.js (if present)
    const COMMENT_SCRIPT_MARKERS = [
      'var apiBase = "/" + slug + "/api/comments";',
      'var apiBase = "/" + slug + "/api/comments/unresolved";',
      '"/" + slug + "/api/comments/export";',
      'LINE_SELECT_INIT',
    ]
    const dragTag = '<script src="/drag.js" defer></script>'
    const commentsTag = '<script src="/comments.js" defer></script>'
    const configTag = commentBackend
      ? `<script>window.socketWalkthrough=${JSON.stringify({ backend: commentBackend })}</script>`
      : ''
    // Service-worker registration. Wrapped in a feature-check and a
    // `load`-event guard so SW install never contends with first-paint
    // work. `updateViaCache:'none'` forces the browser to fetch the SW
    // file itself via HTTP cache (not its own SW cache), so a new
    // deploy's SW is picked up on the next reload.
    // Skip SW registration on localhost / 127.0.0.1 so rapid iteration
    // doesn't get stuck on stale cached HTML/assets served by a prior
    // SW install. If an SW is already registered from a previous load,
    // unregister it so the very next fetch goes to the network. Prod
    // (GH Pages) registers normally — cache-first pays off there.
    const swRegisterTag = [
      '<script>',
      "  if ('serviceWorker' in navigator) {",
      '    var isLocal = /^(localhost|127\\.0\\.0\\.1)$/.test(location.hostname)',
      '    if (isLocal) {',
      '      navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {})',
      '    } else {',
      "      addEventListener('load', () => {",
      "        navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {})",
      '      })',
      '    }',
      '  }',
      '</script>',
    ].join('\n  ')
    const faviconTags = [
      '<link rel="icon" type="image/x-icon" href="/favicon.ico" />',
      '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />',
      '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />',
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
      /* theme-color tints the URL bar on iOS Safari + Chrome
       * Android to match the site's chrome. Two variants for
       * light/dark OS preference so the color flips with the
       * rest of the page. Values match --bg in overrides.css
       * for each palette. */
      '<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />',
      '<meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)" />',
    ].join('\n  ')
    /* Theme-boot: a tiny blocking inline <script> that reads the
     * stored preference and sets <html data-theme="…"> BEFORE the
     * browser paints anything. Without it, the default palette
     * flashes on every navigation for a frame or two until drag.js
     * (defer-loaded) fires and applies the real theme. Runs in
     * under a millisecond; the bytes + SHA-256 hash pair for CSP
     * are a worthwhile tradeoff for eliminating the FOUC. */
    const themeBootScript = `(function(){try{var w=window,t=localStorage.getItem('socket-pages:theme'),r;if(t==='dark'||t==='light'||t==='synthwave')r=t;else if(w.matchMedia&&w.matchMedia('(prefers-color-scheme: dark)').matches)r='dark';else r='light';document.documentElement.setAttribute('data-theme',r)}catch{}})()`
    const themeBootTag = `<script>${themeBootScript}</script>`
    // Preload the shim scripts so the browser starts fetching them in
    // parallel with HTML parsing, ahead of the `defer` discovery. The
    // CSS is already in a `<link rel="stylesheet">` which is inherently
    // render-blocking, so it doesn't need a preload. Comment shim is
    // gated on commentBackend since we only emit the <script> tag then.
    //
    // Fonts are preloaded separately so text flashes minimally on first
    // paint. Each preload carries a sha384 integrity hash so the browser
    // rejects a tampered font before @font-face loads it. `crossorigin`
    // is required for integrity verification even on same-origin fonts
    // (spec quirk — font fetches default to CORS 'anonymous', which
    // browsers treat as cross-origin for SRI purposes).
    const fontPreloads = await Promise.all(
      ['Geist.woff2', 'GeistMono.woff2']
        .map(name => path.join(buildDir, 'fonts', name))
        .filter(p => existsSync(p))
        .map(async p => {
          const bytes = await fs.readFile(p)
          const sha384 = cryptoHash('sha384', bytes, 'base64')
          const href = '/fonts/' + path.basename(p)
          return `<link rel="preload" as="font" type="font/woff2" href="${href}" integrity="sha384-${sha384}" crossorigin="anonymous" />`
        }),
    )
    /* Preconnect to the comment backend origin so the TCP handshake +
     * TLS negotiation happens in parallel with HTML parsing, rather
     * than waiting for comments.js to send its first /health check.
     * Saves ~100 ms on the LCP path for pages that ship the shim. */
    const commentBackendOrigin = commentBackend
      ? new URL(commentBackend).origin
      : ''
    /* Preloads shared by every page (drag.js + fonts). comments.js
     * + the val.run preconnect only belong on part pages — the
     * only surface where comments.js actually runs. `preloadTags`
     * is the base set; `partPreloadTags` adds the comments.js +
     * preconnect pair. Chosen per-page below during post-process. */
    const basePreloads = [
      '<link rel="preload" as="script" href="/drag.js" />',
      ...fontPreloads,
    ]
    const partPreloads = commentBackend
      ? [
          `<link rel="preconnect" href="${commentBackendOrigin}" crossorigin />`,
          '<link rel="preload" as="script" href="/comments.js" />',
          ...basePreloads,
        ]
      : basePreloads
    const preloadTags = basePreloads.join('\n  ')
    const partPreloadTags = partPreloads.join('\n  ')
    // Socket tagline footer — matches the format used on socket.dev
    // marketing pages. The bolt is two overlaid elements:
    //   - <svg class="wt-footer-bolt">       visible glyph
    //   - <span class="wt-footer-bolt-text"> the "⚡" emoji, visually
    //     hidden but NOT display:none, so a user's text selection
    //     still picks it up. Copying "Made with <svg> by Socket Inc"
    //     from the browser lands "Made with ⚡ by Socket Inc" in
    //     their clipboard — round-trips cleanly into Slack, docs,
    //     a commit message, wherever.
    // The wrapping .wt-footer-bolt-wrap stacks the two on top of
    // each other so they occupy the same inline box.
    const footerBoltSvg =
      '<svg class="wt-footer-bolt" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">' +
      '<path d="M20 6 L14 6 L4 16 L11 16 L7 24 L20 13 L13 13 Z"/>' +
      '<path class="wt-footer-spark wt-footer-spark-1" d="M5 2 L5.5 4.5 L8 5 L5.5 5.5 L5 8 L4.5 5.5 L2 5 L4.5 4.5 Z"/>' +
      '<path class="wt-footer-spark wt-footer-spark-2" d="M22 6.5 L22.5 9 L25 9.5 L22.5 10 L22 12.5 L21.5 10 L19 9.5 L21.5 9 Z"/>' +
      '<path class="wt-footer-spark wt-footer-spark-3" d="M3.5 17.5 L4 20 L6.5 20.5 L4 21 L3.5 23.5 L3 21 L0.5 20.5 L3 20 Z"/>' +
      '</svg>'
    const footerBoltBundle =
      '<span class="wt-footer-bolt-wrap">' +
      footerBoltSvg +
      '<span class="wt-footer-bolt-text" aria-hidden="true">⚡</span>' +
      '</span>'
    const footerTag = [
      '<footer class="wt-socket-footer">',
      `  <span>Made with ${footerBoltBundle} by <a class="wt-src-link" data-link-type="url" href="https://socket.dev" target="_blank" rel="noopener noreferrer">Socket Inc</a></span>`,
      '</footer>',
    ].join('\n  ')

    // Per-file HTML post-processor. Hoisted out of the loop so we can
    // fan out across every emitted page with Promise.allSettled instead
    // of walking them serially — each file's transforms are
    // self-contained (no cross-file state beyond the pre-computed maps
    // above). allSettled over all rejects so one broken file doesn't
    // mask the others; we collect rejections and throw a composite
    // after. Every DOM edit uses node-html-parser — no string.replace
    // against HTML — so meander-output whitespace or attribute-order
    // changes don't silently break the pipeline.
    const postProcessEntry = async (entry: string): Promise<void> => {
      const htmlPath = path.join(buildDir, entry)
      const source = await fs.readFile(htmlPath, 'utf8')
      const root = parseHtml(source)

      // Rewrite meander's emitted asset references to their renamed
      // counterparts. Meander bakes `/walkthrough.css` into every page
      // it generates (from its own template), but we rename that file
      // to `style.css` before shipping.
      for (const link of root.querySelectorAll(
        'link[href="/walkthrough.css"]',
      )) {
        link.setAttribute('href', '/style.css')
      }

      // Strip meander's inlined comment scripts when replacing with ours.
      if (commentBackend) {
        stripInlinedCommentScripts(root, COMMENT_SCRIPT_MARKERS)
      }

      const head = root.querySelector('head')
      const body = root.querySelector('body')

      /* Part entries arrive as "walkthrough-part-N" at this point
       * — the rename to user-facing names (anatomy, building, …)
       * happens later. Detect part pages by that prefix + resolve
       * id → metadata. Doc pages arrive already renamed. */
      const filenameBase = entry.replace(/\.html$/, '')
      const partMatch = filenameBase.match(/^walkthrough-part-(\d+)$/)

      /* Inject a meta description so each page has a concrete SEO
       * summary (Lighthouse flags its absence). Parts use
       * "Part N: <title> — <objective>"; docs use their summary;
       * the index uses the intro tagline. Idempotent via the
       * meta[name="description"] probe. */
      if (head && !root.querySelector('meta[name="description"]')) {
        let description = ''
        if (partMatch) {
          const id = Number(partMatch[1])
          const title = partTitles.get(id) ?? ''
          const objective = partObjectives.get(id) ?? ''
          description = objective
            ? `Part ${id}: ${title} — ${objective.replace(/`/g, '')}`
            : `Part ${id}: ${title}`
        }
        if (!description) {
          for (const doc of docFilenames.values()) {
            if (doc.filename === filenameBase) {
              description = doc.summary ?? doc.title
              break
            }
          }
        }
        if (!description && entry === 'index.html') {
          description =
            'A guided walkthrough of @socketregistry/packageurl-js — a Socket Optimized override of the upstream packageurl-js npm package.'
        }
        if (description) {
          head.insertAdjacentHTML(
            'beforeend',
            `\n  <meta name="description" content="${escapeHtml(description)}" />`,
          )
        }
      }

      /* Theme-boot must land AS EARLY AS POSSIBLE — before the
       * stylesheet so the browser doesn't paint with the wrong
       * palette even for a single frame. Inject via afterbegin
       * on <head>. Idempotent via marker probe. */
      if (head && !root.querySelector('script[data-theme-boot]')) {
        head.insertAdjacentHTML(
          'afterbegin',
          `\n  ${themeBootTag.replace('<script>', '<script data-theme-boot>')}`,
        )
      }

      // Inject favicons + preloads in <head>. Idempotent via marker
      // checks. Preloads land last so they're adjacent to the deferred
      // <script> tags they anticipate (a visual-grouping nicety).
      if (head && !root.querySelector('link[href="/apple-touch-icon.png"]')) {
        head.insertAdjacentHTML('beforeend', `\n  ${faviconTags}`)
      }
      if (head && !root.querySelector('link[rel="preload"]')) {
        /* Part pages get the comments.js preload + val.run
         * preconnect; doc + index pages ship only the base set
         * (drag.js + fonts) so doc pages don't burn bandwidth
         * on a comment shim they never exercise. */
        const chosenPreloads = partMatch ? partPreloadTags : preloadTags
        head.insertAdjacentHTML('beforeend', `\n  ${chosenPreloads}`)
      }

      /* Prefetch adjacent part pages so clicking "next" / "prev"
       * feels instant. On Part 1 we prefetch Part 2; on Part N
       * (1 < N < last) we prefetch N-1 and N+1; on the last part
       * we prefetch the one before it. Prefetch is low-priority
       * by default — browsers will defer it until idle, so it
       * doesn't compete with the LCP path. Idempotent via the
       * rel="prefetch" probe. */
      if (head && partMatch && !root.querySelector('link[rel="prefetch"]')) {
        const currentId = Number(partMatch[1])
        const allIds = [...partFilenames.keys()].sort((a, b) => a - b)
        const adjacentIds = [currentId - 1, currentId + 1].filter(n =>
          allIds.includes(n),
        )
        const prefetchTags = adjacentIds
          .map(n => {
            const fname = partFilenames.get(n)
            return fname
              ? `<link rel="prefetch" href="/${fname}.html" as="document" />`
              : ''
          })
          .filter(Boolean)
          .join('\n  ')
        if (prefetchTags) {
          head.insertAdjacentHTML('beforeend', `\n  ${prefetchTags}`)
        }
      }

      // Inject our scripts once (idempotent). The preload tags
      // injected earlier also reference drag.js / comments.js paths,
      // so use the `<script src=...>` selector (not preload's
      // `<link as="script" href=...>`) to pick only real script tags.
      if (body && !root.querySelector('script[src="/drag.js"]')) {
        body.insertAdjacentHTML('beforeend', `\n  ${dragTag}`)
      }
      /* comments.js is only useful on part pages — it binds to
       * per-section `data-part` markers emitted by meander. Doc
       * and index pages ship zero parts, so the script would run
       * its health probe, fetch + parse ~60KB, then bail with
       * partId=NaN. Gate the `<script>`, config, preload, and
       * preconnect emission on partMatch so doc/index pages stay
       * lean. */
      if (
        body &&
        commentBackend &&
        partMatch &&
        !root.querySelector('script[src="/comments.js"]')
      ) {
        body.insertAdjacentHTML(
          'beforeend',
          `\n  ${configTag}\n  ${commentsTag}`,
        )
        /* Mark the body so CSS can discriminate between "this
         * page will hydrate comment-shim buttons" vs "this page
         * never will." The theme-toggle margin push only applies
         * on the latter — see the rule on .topbar-actions in
         * overrides.css. */
        body.setAttribute('data-has-comments', '')
      }
      // Service worker registration — last script before </body> so
      // the page-critical shim scripts start downloading first. The
      // swRegisterTag emits an inline script that calls
      // navigator.serviceWorker.register(...); detect it via a script
      // whose body references 'sw.js'.
      const hasSwRegister = root
        .querySelectorAll('script')
        .some(s => !s.getAttribute('src') && s.text.includes('sw.js'))
      if (body && !hasSwRegister) {
        body.insertAdjacentHTML('beforeend', `\n  ${swRegisterTag}`)
      }

      // Socket tagline footer, injected once before </body>. Idempotent
      // via the wt-socket-footer class marker.
      if (body && !root.querySelector('.wt-socket-footer')) {
        body.insertAdjacentHTML('beforeend', `\n  ${footerTag}`)
      }

      // Normalize part-nav placement across every page. Meander emits
      // `.part-nav` INSIDE `.topbar` for part pages; we need it as a
      // sibling below the topbar so it becomes a thin full-width strip
      // rather than a flex item competing with the wordmark. Lift it
      // out and re-parent after the topbar. Also inject a leading
      // Widen the gap after "Part N:" in the meander-emitted h1 so
      // the colon doesn't crowd the part title. "Part 1: Anatomy"
      // → "Part 1:<en-space>Anatomy". Narrow no-break space (U+2002)
      // so it reads as intentional spacing rather than a double
      // space. Idempotent — the replacement only fires when a
      // regular-space-after-colon is present.
      const partH1 = root.querySelector('h1')
      if (partH1) {
        const current = partH1.text
        const widened = current.replace(
          /^(Part\s+\d+):\s+/,
          (_match, prefix) => `${prefix}:  `,
        )
        if (widened !== current) {
          partH1.set_content(widened)
        }
      }

      // home link so users have a one-click jump back to the TOC;
      // meander leaves that out. Idempotent via .wt-home-link marker.
      // The index page has its own part-nav injected by rewriteIndexContents
      // (already a sibling of the topbar, no home link — you can't go
      // home from home), so skip when the nav is already at the top level.
      const topbar = root.querySelector('.topbar')
      const partNav = root.querySelector('.part-nav')
      if (partNav && topbar && partNav.parentNode === topbar) {
        partNav.remove()
        topbar.insertAdjacentHTML('afterend', '\n  ' + partNav.toString())
      }
      // Add home link + label to meander-emitted part-page nav rows
      // (meander emits neither). The index and doc pages build their
      // nav via renderPartsPillRow, which already ships both the
      // label and — on doc pages only — a home link. The index
      // deliberately omits the home link (you can't go home from
      // home), so skip the branch entirely for index.html. Part
      // pages are detected by the ABSENCE of a Parts: label in the
      // meander-emitted row.
      const isIndex = entry === 'index.html'
      const reparentedPartNav = root.querySelector('.part-nav')
      if (
        !isIndex &&
        reparentedPartNav &&
        !reparentedPartNav.querySelector('.wt-home-link')
      ) {
        const hasLabel = Boolean(
          reparentedPartNav.querySelector('.wt-parts-label'),
        )
        const labelHtml = hasLabel
          ? ''
          : '<span class="wt-parts-label">Topics:</span>'
        reparentedPartNav.insertAdjacentHTML(
          'afterbegin',
          buildHomeLinkHtml(false) + labelHtml,
        )
      }

      /* Append doc pills to the part-page nav so every page shares
       * the same unified Topics row: [home] Topics: 1 2 3 … 8
       * Architecture Builders … Idempotent via the per-doc href
       * probe — skip any doc pill already present. */
      if (
        !isIndex &&
        reparentedPartNav &&
        docFilenames.size > 0 &&
        !reparentedPartNav.querySelector('.wt-topic-doc')
      ) {
        const docPillsHtml = [...docFilenames.values()]
          .map(
            d =>
              `<a class="wt-topic-doc" href="/${d.filename}.html" title="${escapeHtml(d.title)}" aria-label="${escapeHtml(d.title)}">${escapeHtml(d.title)}</a>`,
          )
          .join('\n      ')
        reparentedPartNav.insertAdjacentHTML(
          'beforeend',
          `\n      ${docPillsHtml}\n    `,
        )
      }

      // Enrich each numbered Part pill. Meander emits
      //   <a ... href="/<slug>/part/<n>">Part <n></a>
      // with no accessible context — a screen reader just hears
      // "Part 1, Part 2, …". We rewrite:
      //   1. Add title + aria-label carrying the real section name so
      //      keyboard + AT users get the same info as the tooltip.
      //   2. Replace inner text — strip "Part " (the pill-row has its
      //      own "Parts:" label; each pill just needs the number) and
      //      append "(M)" with the per-part section count.
      // Runs BEFORE the base-path rewrite so the `/part/<n>` shape is
      // still intact. Idempotent via the aria-label probe.
      if (slug && partTitles.size > 0) {
        const partLinkPrefix = `/${slug}/part/`
        for (const a of root.querySelectorAll('a[href]')) {
          if (a.getAttribute('aria-label')) {
            continue
          }
          const href = a.getAttribute('href') ?? ''
          if (!href.startsWith(partLinkPrefix)) {
            continue
          }
          const n = Number(href.slice(partLinkPrefix.length))
          if (!Number.isFinite(n)) {
            continue
          }
          const title = partTitles.get(n)
          if (!title) {
            continue
          }
          /* Pill text: first significant word of the title (e.g.
           * "Anatomy of a PURL" → "Anatomy"). Keeps the row
           * readable and consistent with the doc pills which also
           * show word labels (Architecture, Builders, …).
           * Tooltip + aria-label carry the full topic title for
           * hover / screen-reader context. */
          a.setAttribute('title', title)
          a.setAttribute('aria-label', title)
          a.set_content(escapeHtml(firstSignificantWord(title)))
        }
      }

      // Each file-head gets two dropdowns — a Files menu (the path)
      // and a Sections menu (the count). Together they turn the
      // static header row into a mini-nav: click the path to jump to
      // another file on the same page, click the count to jump to a
      // section within this file. Both dashed-underlined to signal
      // they're interactive.
      //
      // Structure per file-head:
      //   <header class="file-head">
      //     <details class="wt-files-menu">
      //       <summary class="path">src/package-url.ts</summary>
      //       <div class="wt-files-panel">
      //         <a href="#file-src-package-url-ts" class="active">src/package-url.ts</a>
      //         <a href="#file-src-purl-component-ts">src/purl-component.ts</a>
      //         …
      //       </div>
      //     </details>
      //     <details class="wt-sections-menu">
      //       <summary class="count">33 sections</summary>
      //       <div class="wt-sections-panel">
      //         <a href="#ann-1-src-package-url-ts-22">Line 22</a>
      //         …
      //       </div>
      //     </details>
      //   </header>
      //
      // Each .file-block gets a stable anchor id derived from its
      // path so the Files menu entries can target it. Idempotent via
      // the wt-files-menu / wt-sections-menu markers on the header.
      const fileBlocks = root.querySelectorAll('.file-block')
      const pathToAnchor = (p: string): string =>
        'file-' + p.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      // First pass: collect the shared list of files on this page
      // (path + anchor id) so the per-block Files menu can list every
      // sibling. Also assign the anchor id to each block while we
      // have it in hand.
      const fileList: Array<{ path: string; anchor: string }> = []
      for (const block of fileBlocks) {
        const pathSpan = block.querySelector('.file-head .path')
        if (!pathSpan) {
          continue
        }
        const pathText = pathSpan.text.trim()
        const anchor = pathToAnchor(pathText)
        if (!block.getAttribute('id')) {
          block.setAttribute('id', anchor)
        }
        fileList.push({ path: pathText, anchor })
      }
      // Second pass: wrap path + count in <details> dropdowns.
      for (const block of fileBlocks) {
        const head = block.querySelector('.file-head')
        if (!head) {
          continue
        }
        const blockAnchor = block.getAttribute('id') ?? ''
        // Files menu (path → jump-to-file).
        const pathSpan = head.querySelector('.path')
        if (pathSpan && !head.querySelector('.wt-files-menu')) {
          const pathText = pathSpan.text.trim()
          const fileLinks = fileList
            .map(f => {
              const active = f.anchor === blockAnchor ? ' class="active"' : ''
              return `          <a href="#${escapeHtml(f.anchor)}"${active}>${escapeHtml(f.path)}</a>`
            })
            .join('\n')
          const filesHtml =
            `<details class="wt-files-menu">\n` +
            `      <summary class="path">${escapeHtml(pathText)}</summary>\n` +
            `      <div class="wt-files-panel">\n` +
            `${fileLinks}\n` +
            `      </div>\n` +
            `    </details>`
          pathSpan.replaceWith(filesHtml)
        }
        // Build the shared sections list (used by both the file-head
        // sections menu below and the per-code-section dropdowns).
        // Each entry has a stable id (the annotation-card anchor),
        // a display label ("Section N of M"), and the line number
        // for sorting.
        const cards = block.querySelectorAll('.annotation-card[id]')
        type SectionItem = {
          id: string
          label: string
          line: number
          index: number
        }
        const items: SectionItem[] = cards
          .map(card => {
            const id = card.getAttribute('id') ?? ''
            const m = id.match(/-(\d+)$/)
            return {
              id,
              line: m ? Number(m[1]) : Number.POSITIVE_INFINITY,
            }
          })
          .sort((a, b) => a.line - b.line)
          .map((entry, i, arr) => ({
            id: entry.id,
            line: entry.line,
            index: i + 1,
            // Chip summary shows the full "Section N of M" readout;
            // the panel rows are just the index ("1", "2", …) since
            // the dropdown context already tells you what they are.
            label: `Section ${i + 1} of ${arr.length}`,
          }))

        const renderSectionsPanel = (activeId?: string): string => {
          const links = items
            .map(item => {
              const isActive = item.id === activeId ? ' class="active"' : ''
              return `          <a href="#${escapeHtml(item.id)}"${isActive}>${String(item.index)}</a>`
            })
            .join('\n')
          return (
            `      <div class="wt-sections-panel">\n` +
            `${links}\n` +
            `      </div>`
          )
        }

        // File-head sections menu — covers all sections in this
        // file. Summary shows the count ("33 sections"); panel
        // lists every section as "Section N of M".
        const countSpan = head.querySelector('.count')
        if (
          countSpan &&
          items.length > 0 &&
          !head.querySelector('.wt-sections-menu')
        ) {
          const countText = countSpan.text
          const sectionsHtml =
            `<details class="wt-sections-menu">\n` +
            `      <summary class="count">${escapeHtml(countText)}</summary>\n` +
            renderSectionsPanel() +
            `\n    </details>`
          countSpan.replaceWith(sectionsHtml)
        }

        /* Per-code-section dropdown — appears ABOVE each code
         * block (inside .code-section, as the first child) so a
         * reader has a jump-to-section affordance at every chunk.
         *
         * Ship an EMPTY panel with a data-active-id marker; drag.js
         * clones the file-head menu's full list on first open and
         * marks the right row as .active. Saves ~(N-1)*N anchor
         * elements per file — for a 33-section file that's ~1000
         * fewer <a> tags in the HTML. */
        const blockId = block.getAttribute('id') ?? ''
        for (const codeSection of block.querySelectorAll('.code-section[id]')) {
          if (codeSection.querySelector('.wt-section-chip')) {
            continue
          }
          const codeId = codeSection.getAttribute('id') ?? ''
          const cardId = `ann-${codeId}`
          const current = items.find(it => it.id === cardId)
          if (!current) {
            continue
          }
          const chipHtml =
            `<details class="wt-sections-menu wt-section-chip" data-sections-for="${escapeHtml(blockId)}" data-active-id="${escapeHtml(cardId)}">\n` +
            `      <summary class="wt-section-chip-label">${escapeHtml(current.label)}</summary>\n` +
            `      <div class="wt-sections-panel"></div>\n` +
            `    </details>\n`
          codeSection.insertAdjacentHTML('afterbegin', chipHtml)
        }
      }

      // Publish the file list as a data attribute on <body> so
      // drag.js can wire Cmd/Ctrl-click source-code links at
      // runtime. Each entry is a "path → anchor id" pair; the
      // client script scans `.line-code` text for quoted paths
      // matching any entry and wraps them in <a>. Skipped when
      // there are no file blocks on the page (e.g. doc pages).
      if (fileList.length > 0) {
        const body = root.querySelector('body')
        if (body && !body.getAttribute('data-file-anchors')) {
          // Compact JSON — minimal bytes, fine to embed as an attr.
          const payload = JSON.stringify(fileList.map(f => [f.path, f.anchor]))
          body.setAttribute('data-file-anchors', payload)
        }
      }

      // Base-path rewrite — last step so every injected tag above gets
      // prefixed in one pass. No-op when --base-path is empty (local
      // dev, Val Town hosting, etc.).
      if (basePath && slug) {
        applyBasePath(root, basePath, slug, partFilenames)
      }

      const html = root.toString()

      // Rename meander's walkthrough-part-<n>.html to the configured
      // <filename>.html (e.g. walkthrough-part-1.html → anatomy.html).
      // Flat public URLs replace /<slug>/part/<n>-style links once the
      // site is deployed. Other emitted HTML (index.html, documents.html
      // if any) retains its name. `partMatch` was captured at the top
      // of postProcessEntry — reusing it here.
      if (partMatch) {
        const n = Number(partMatch[1])
        const newName = partFilenames.get(n)
        if (!newName) {
          throw new Error(
            `pages/${entry}: no filename configured for part ${n}. Add "filename" to part ${n} in tour.json (e.g. "anatomy") — the validator should have caught this, so meander may have rendered a part that isn't in tour.json.`,
          )
        }
        const newPath = path.join(buildDir, `${newName}.html`)
        await fs.writeFile(newPath, html)
        if (newPath !== htmlPath) {
          await safeDelete(htmlPath)
        }
        return
      }

      await fs.writeFile(htmlPath, html)
    }

    const entries = await fs.readdir(buildDir)
    const htmlEntries = entries.filter(e => e.endsWith('.html'))
    const postProcessResults = await Promise.allSettled(
      htmlEntries.map(postProcessEntry),
    )
    const postProcessFailures: string[] = []
    for (let i = 0; i < postProcessResults.length; i++) {
      const r = postProcessResults[i]!
      if (r.status === 'rejected') {
        postProcessFailures.push(
          `${htmlEntries[i]}: ${String((r.reason as Error)?.message ?? r.reason)}`,
        )
      }
    }
    if (postProcessFailures.length > 0) {
      throw new Error(
        `tour post-processing failed for ${postProcessFailures.length} file(s):\n  - ${postProcessFailures.join('\n  - ')}`,
      )
    }

    // Socket.dev malware audit on CDN scripts (marked, highlight.js)
    // that meander's generated HTML loads via `<script src=unpkg...>`.
    // Runs before minification so a failure aborts early. Skip the
    // audit via SKIP_AUDIT=1 for offline dev; CI must not set this.
    if (!process.env['SKIP_AUDIT']) {
      await auditCdnScripts(buildDir)
    } else {
      console.warn('[audit-deps] SKIP_AUDIT=1 — CDN audit SKIPPED')
    }

    // Rename meander's emitted shared stylesheet to its served name
    // before minification + SRI. Meander writes `walkthrough.css`; we
    // ship it as `style.css`. The URL rewrites in post-process above
    // already point every <link> at `/style.css`, so the final file
    // on disk has to match.
    const legacyCssPath = path.join(buildDir, 'walkthrough.css')
    const renamedCssPath = path.join(buildDir, 'style.css')
    if (existsSync(legacyCssPath)) {
      await fs.rename(legacyCssPath, renamedCssPath)
    }

    if (minify) {
      await minifyEmittedAssets(buildDir)
      await shrinkInlineSvgs(buildDir)
    }

    // Subresource Integrity pass — runs LAST so the local-file hashes
    // we compute match the exact bytes that ship (post-minify). CDN
    // hashes are disk-cached under .cache/sri/; local ones hash the
    // files in `buildDir` directly. Any `<script>` / `<link>`
    // (CDN or same-origin) ends up with `integrity="sha384-..."`.
    const sriCacheDir = path.join(repoRoot, '.cache', 'sri')
    const sriEntries = (await fs.readdir(buildDir)).filter(e =>
      e.endsWith('.html'),
    )
    const sriResults = await Promise.allSettled(
      sriEntries.map(async entry => {
        const htmlPath = path.join(buildDir, entry)
        const source = await fs.readFile(htmlPath, 'utf8')
        const root = parseHtml(source)
        await injectSri(root, buildDir, basePath, sriCacheDir)
        // CSP meta — must run AFTER SRI injection so the hash of each
        // inline <script> reflects its final body (no further rewrites).
        // Per-file because __defIndex varies per-part; pages also differ
        // in which inline blocks land (index vs part pages).
        if (!root.querySelector('meta[http-equiv="Content-Security-Policy"]')) {
          const cspTag = buildCspMeta(root, commentBackend)
          const head = root.querySelector('head')
          if (head) {
            head.insertAdjacentHTML('beforeend', `\n  ${cspTag}`)
          }
        }
        const html = root.toString()
        if (html !== source) {
          await fs.writeFile(htmlPath, html)
        }
      }),
    )
    const sriFailures: string[] = []
    for (let i = 0; i < sriResults.length; i++) {
      const r = sriResults[i]!
      if (r.status === 'rejected') {
        sriFailures.push(
          `${sriEntries[i]}: ${String((r.reason as Error)?.message ?? r.reason)}`,
        )
      }
    }
    if (sriFailures.length > 0) {
      throw new Error(
        `SRI/CSP injection failed for ${sriFailures.length} file(s):\n  - ${sriFailures.join('\n  - ')}`,
      )
    }

    // Final publish — atomic swap of buildDir into outputDir. Wipe
    // any previous pages/ output so the new tree is authoritative, then
    // rename buildDir into place. Same-filesystem (both live under
    // repoRoot), so the rename is atomic.
    await safeDelete(outputDir)
    await fs.rename(buildDir, outputDir)
  } finally {
    // Always clean up the private scratch root, regardless of
    // success/failure. Absent buildDir (already renamed on success)
    // is a no-op under safeDelete.
    await safeDelete(buildRoot)
  }
}

/**
 * Minify the JS + CSS assets in the output directory in-place.
 *
 *   - JS: esbuild transform, target `es2022` so optional chaining,
 *     logical assignment, and `Map.groupBy` are preserved (we rely on
 *     modern-browser runtimes anyway).
 *   - CSS: lightningcss transform — better than esbuild for CSS
 *     (color-mix folding, nesting lowering, dead-rule pruning). Same
 *     browserslist target so the output stays compatible with the
 *     same runtimes the authored code assumes.
 *
 * No sourcemaps — the user opted out explicitly. Authored files live
 * at the repo root unchanged; this only touches the emitted copies.
 */
/**
 * Pass every inline `<svg>` in every emitted HTML file through
 * SVGO. Scope: handwritten chrome SVGs (home icon, theme icons,
 * footer bolt + sparks) + anything else that landed inline.
 * Mermaid-rendered SVGs already went through SVGO during their
 * render() path, but re-running preset-default here is a no-op
 * or near-no-op on already-optimized markup — safe to blanket.
 *
 * Only runs under the minify flag so dev builds stay readable
 * (authored SVG source in drag.js / tour.mts stays intact; just
 * the emitted .html copies get shrunk).
 */
async function shrinkInlineSvgs(buildDir: string): Promise<void> {
  const htmlFiles = (await fs.readdir(buildDir)).filter(e =>
    e.endsWith('.html'),
  )
  /* SVGO v4 moved removeViewBox out of preset-default — override
   * the three plugins we want disabled inside preset-default's
   * overrides, leave removeViewBox off entirely (it's no longer
   * in preset-default so nothing to disable). */
  const config = {
    multipass: true,
    plugins: [
      {
        name: 'preset-default',
        params: {
          overrides: {
            /* Keep IDs — edge-to-node links in mermaid SVGs and
             * aria-labelledby refs in hand-written chrome icons. */
            cleanupIds: false,
            /* Mermaid emits attributes SVGO's default list
             * considers redundant but browsers read (various
             * preserveAspectRatio forms). */
            removeUnknownsAndDefaults: false,
          },
        },
      },
    ],
  } as const
  await Promise.all(
    htmlFiles.map(async name => {
      const p = path.join(buildDir, name)
      const source = await fs.readFile(p, 'utf8')
      if (!source.includes('<svg')) {
        return
      }
      /* Walk the DOM via node-html-parser instead of a regex —
       * nested <svg> elements, attributes with > inside quoted
       * values, and SVGs with children containing </svg>-looking
       * text would all confuse a regex. The parser handles those
       * correctly and returns us the exact subtree to pass to
       * SVGO. */
      const root = parseHtml(source)
      const svgs = root.querySelectorAll('svg')
      if (svgs.length === 0) {
        return
      }
      let changed = false
      for (const svg of svgs) {
        const before = svg.toString()
        let after: string
        try {
          after = svgoOptimize(before, config).data
        } catch {
          /* One malformed SVG shouldn't fail the whole pass;
           * keep the un-optimized original if SVGO chokes on it. */
          continue
        }
        if (after && after !== before) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(svg as any).replaceWith(after)
          changed = true
        }
      }
      if (changed) {
        await fs.writeFile(p, root.toString())
      }
    }),
  )
}

async function minifyEmittedAssets(buildDir: string): Promise<void> {
  const jsFiles = ['comments.js', 'drag.js', 'sw.js']
  const cssFiles = ['style.css']

  // Each minify op is independent — fan out across all files of both
  // kinds in parallel and sum the byte savings afterwards. Use
  // allSettled so a failure on one asset (e.g. lightningcss rejecting
  // invalid CSS) doesn't hide any other savings we'd otherwise report.
  const jsTasks = jsFiles.map(async f => {
    const p = path.join(buildDir, f)
    if (!existsSync(p)) {
      return 0
    }
    const before = await fs.readFile(p, 'utf8')
    const out = await esbuildTransform(before, {
      loader: 'js',
      minify: true,
      target: 'es2022',
      legalComments: 'none',
    })
    await fs.writeFile(p, out.code)
    return before.length - out.code.length
  })
  const cssTasks = cssFiles.map(async f => {
    const p = path.join(buildDir, f)
    if (!existsSync(p)) {
      return 0
    }
    const before = await fs.readFile(p, 'utf8')
    const out = lightningTransform({
      filename: f,
      code: Buffer.from(before),
      minify: true,
    })
    await fs.writeFile(p, out.code)
    return before.length - out.code.length
  })
  const results = await Promise.allSettled([...jsTasks, ...cssTasks])
  let savedBytes = 0
  const failures: string[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') {
      savedBytes += r.value
    } else {
      failures.push(String((r.reason as Error)?.message ?? r.reason))
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `minification failed for ${failures.length} asset(s):\n  - ${failures.join('\n  - ')}`,
    )
  }

  console.log(`Minified assets — saved ${(savedBytes / 1024).toFixed(1)} KB`)
}

/**
 * Strip `<script>...</script>` blocks containing any of the given marker
 * substrings. Meander inlines its comment-related JS directly in each HTML
 * file; this removes those blocks so our replacement script has no
 * collisions. Mutates the DOM in place; walks inline scripts and removes
 * the ones whose body matches.
 */
function stripInlinedCommentScripts(
  root: HTMLElement,
  markers: readonly string[],
): void {
  for (const script of root.querySelectorAll('script')) {
    if (script.getAttribute('src')) {
      continue
    }
    const body = script.text
    if (markers.some(m => body.includes(m))) {
      script.remove()
    }
  }
}

async function readSlug(): Promise<string> {
  // Meander bakes Val-Town-shaped links (/<slug>/part/<n>) into the HTML even
  // though it writes flat file names. Read the slug from manifest.json so we
  // can route those URLs to the right file.
  const manifestPath = path.join(outputDir, 'manifest.json')
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
    slug: string
  }
  return manifest.slug
}

/**
 * Read the part-id → filename map from tour.json at the repo
 * root. The dev server uses this to translate /<slug>/part/<n> URLs
 * to the renamed <filename>.html files on disk. Mirrors the rename
 * applied by the generate pipeline, so a build + serve round-trips
 * URLs to files correctly. Returns an empty map when tour.json
 * isn't present (e.g. invoked from a fresh checkout without the
 * source config) — the route table falls back to the legacy shape.
 */
async function readPartFilenames(): Promise<Map<number, string>> {
  const configPath = path.join(repoRoot, 'tour.json')
  if (!existsSync(configPath)) {
    return new Map()
  }
  const config = JSON.parse(await fs.readFile(configPath, 'utf8')) as {
    parts?: Array<{ id: number; filename?: string }>
  }
  const map = new Map<number, string>()
  for (const p of config.parts ?? []) {
    if (p.filename) {
      map.set(p.id, p.filename)
    }
  }
  return map
}

function routeToFile(
  slug: string,
  urlPath: string,
  partFilenames: ReadonlyMap<number, string>,
): string | undefined {
  // /                           → index.html
  // /<slug>  or  /<slug>/       → index.html (slug-prefixed root, same as the
  //                               URL GH Pages serves the site at; matches
  //                               the flat file name emitted by meander)
  // /<slug>/part/<n>            → <partFilenames[n]>.html (e.g. anatomy.html)
  // /<slug>/documents           → documents.html
  // anything else               → as-is (e.g. /style.css)
  if (urlPath === '/' || urlPath === '') {
    return 'index.html'
  }
  if (urlPath === `/${slug}` || urlPath === `/${slug}/`) {
    return 'index.html'
  }
  const partMatch = new RegExp(`^/${slug}/part/(\\d+)/?$`).exec(urlPath)
  if (partMatch) {
    const filename = partFilenames.get(Number(partMatch[1]))
    if (filename) {
      return `${filename}.html`
    }
    return undefined
  }
  if (urlPath === `/${slug}/documents` || urlPath === `/${slug}/documents/`) {
    return 'documents.html'
  }
  return urlPath.replace(/^\//, '')
}

async function serve(basePath: string, args: readonly string[]): Promise<void> {
  const portArg = args.find(a => a.startsWith('--port='))
  const port = portArg ? Number(portArg.slice('--port='.length)) : 8080

  if (!existsSync(outputDir)) {
    console.error(
      `No pages/ directory found. Run \`pnpm tour generate tour.json\` first.`,
    )
    process.exit(1)
  }

  const slug = await readSlug()
  const partFilenames = await readPartFilenames()

  const server = createServer(async (req, res) => {
    const rawUrl = (req.url ?? '/').split('?')[0]!.split('#')[0]!
    let decoded = decodeURIComponent(rawUrl)
    // Strip the base-path prefix so `routeToFile` sees the shape it
    // expects. Mirrors the generate-side `--base-path` rewrite so
    // `pnpm tour --base-path=/X serve` + a build with the
    // same flag round-trips correctly.
    if (basePath && decoded.startsWith(basePath + '/')) {
      decoded = decoded.slice(basePath.length)
    } else if (basePath && decoded === basePath) {
      decoded = '/'
    }
    const relative = routeToFile(slug, decoded, partFilenames)
    if (relative === undefined) {
      res.writeHead(400).end('bad request')
      return
    }

    const target = path.resolve(outputDir, relative)
    if (target !== outputDir && !target.startsWith(outputDir + path.sep)) {
      res.writeHead(400).end('bad request')
      return
    }

    // existsSync stays sync per the fs-guidelines exception; stat uses
    // the async promise API to avoid a blocking call inside the
    // request handler. If the target doesn't exist or fails to stat,
    // respond 404 rather than throwing.
    let resolvedTarget = target
    let stats: Awaited<ReturnType<typeof fs.stat>>
    try {
      stats = await fs.stat(resolvedTarget)
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
      return
    }
    if (stats.isDirectory()) {
      resolvedTarget = path.join(resolvedTarget, 'index.html')
      try {
        stats = await fs.stat(resolvedTarget)
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
        return
      }
    }
    if (!stats.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
      return
    }

    const ext = path.extname(resolvedTarget).toLowerCase()
    const type = MIME[ext] ?? 'application/octet-stream'
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' })
    createReadStream(resolvedTarget).pipe(res)
  })

  server.listen(port, '127.0.0.1', () => {
    console.log(`Serving ${outputDir} (slug: ${slug})`)
    console.log(`  index  → http://127.0.0.1:${port}/`)
    const firstFilename = partFilenames.get(1)
    if (firstFilename) {
      console.log(
        `  part 1 → http://127.0.0.1:${port}/${slug}/part/1  (alias of /${firstFilename}.html)`,
      )
    } else {
      console.log(`  part 1 → http://127.0.0.1:${port}/${slug}/part/1`)
    }
    console.log(`  Press Ctrl+C to stop.`)
  })
}

/**
 * Watch mode — generate once, start the server, then debounced
 * regenerate when any source file (shim, CSS, SW, tour.json,
 * the annotated source tree) changes. Uses Node's built-in fs.watch
 * — no chokidar dep — and debounces at 200 ms so an editor's
 * multi-save-in-quick-succession writes only trigger one rebuild.
 */
async function watch(
  refresh: boolean,
  minify: boolean,
  basePath: string,
  rest: readonly string[],
): Promise<void> {
  if (rest.length === 0) {
    console.error('Usage: pnpm tour watch <tour.json>')
    process.exit(1)
  }

  // Import fs.watch lazily so we don't pay the import cost on other
  // subcommands. Node 20+ supports `recursive: true` on all platforms.
  const { watch: fsWatch } = await import('node:fs')

  // Initial build before we start the server. This also populates
  // outputDir so `serve` has something to serve on first request.
  await generate(refresh, minify, basePath, rest)

  // Start the server. `serve` blocks on its own createServer; since
  // we're about to install watchers on the main loop, kicking it off
  // first keeps the process alive without explicit setInterval.
  // Fire-and-forget await — the server listen is non-blocking after
  // setup, and any startup error surfaces via the unhandledrejection
  // path so watch mode halts fast rather than silently dropping.
  void serve(basePath, [])

  // Files/directories that should trigger a rebuild when they change.
  // Keep this narrow — watching the entire repo would catch noise
  // from test output, node_modules, pages/ itself, etc.
  const configArg = rest[0]!
  const sourcesToWatch: string[] = [
    path.join(repoRoot, configArg),
    path.join(repoRoot, 'comments.js'),
    path.join(repoRoot, 'drag.js'),
    path.join(repoRoot, 'overrides.css'),
    path.join(repoRoot, 'sw.js'),
    path.join(repoRoot, 'src'),
  ]

  let debounceTimer: NodeJS.Timeout | undefined
  let building = false
  let dirtyWhileBuilding = false

  const rebuild = async () => {
    if (building) {
      dirtyWhileBuilding = true
      return
    }
    building = true
    try {
      await generate(refresh, minify, basePath, rest)
      console.log(`[watch] rebuilt at ${new Date().toLocaleTimeString()}`)
    } catch (e) {
      console.error(`[watch] rebuild failed:`, errorMessage(e))
    } finally {
      building = false
      if (dirtyWhileBuilding) {
        dirtyWhileBuilding = false
        // Another change landed while we were busy — queue a fresh pass.
        scheduleRebuild()
      }
    }
  }

  const scheduleRebuild = (): void => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined
      rebuild()
    }, 200)
  }

  for (const target of sourcesToWatch) {
    if (!existsSync(target)) {
      continue
    }
    fsWatch(target, { recursive: true }, (_event, filename) => {
      // Ignore writes to the output directory itself — the final move
      // lands at pages/, which would otherwise loop-trigger.
      if (filename && filename.startsWith('pages/')) {
        return
      }
      scheduleRebuild()
    })
  }

  console.log(
    `[watch] watching ${sourcesToWatch.length} source targets — Ctrl+C to stop.`,
  )
}

// Shared fail-handler for async subcommands. `err.message || err` was
// duplicated at every call site; a named helper also guarantees the
// prefix format and exit code stay in sync across commands.
const failWith =
  (scope: string) =>
  (err: unknown): never => {
    const msg = errorMessage(err)
    console.error(`[${scope}] failed:`, msg)
    process.exit(1)
  }

// Preset shorthand — sets minify + base-path in one flag.
//   --prod  ≈  --minify --base-path=/socket-packageurl-js (GH Pages layout)
//   --dev   ≈  plain, no minify, no base-path (local-friendly)
// Explicit --minify / --base-path= still work and override the preset.
// No preset given? Auto-pick based on `CI` in process.env:
//   CI set (GitHub Actions, GitLab, etc.) → prod
//   CI unset (local machine)              → dev
const PROD_BASE_PATH = '/socket-packageurl-js'

function main(): void {
  const args = process.argv.slice(2)
  const refresh = args.includes('--refresh')

  // Explicit flags.
  const wantDev = args.includes('--dev')
  const wantProd = args.includes('--prod')
  const explicitMinify = args.includes('--minify')
  const basePathArg = args.find(a => a.startsWith('--base-path='))
  const explicitBasePath = basePathArg
    ? normalizeBasePath(basePathArg.slice('--base-path='.length))
    : undefined

  // Resolve preset. Explicit --dev / --prod wins; otherwise CI env var
  // picks prod. `'CI' in process.env` covers any CI that exports it
  // (GitHub Actions, GitLab CI, CircleCI, most).
  const preset: 'dev' | 'prod' = wantProd
    ? 'prod'
    : wantDev
      ? 'dev'
      : 'CI' in process.env
        ? 'prod'
        : 'dev'

  // Final knobs — explicit flag beats preset default.
  const minify = explicitMinify || preset === 'prod'
  const basePath =
    explicitBasePath !== undefined
      ? explicitBasePath
      : preset === 'prod'
        ? PROD_BASE_PATH
        : ''

  const rest = args.filter(
    a =>
      a !== '--refresh' &&
      a !== '--minify' &&
      a !== '--dev' &&
      a !== '--prod' &&
      !a.startsWith('--base-path='),
  )
  const command = rest[0]

  const HELP_TEXT = [
    'pnpm tour — tour generator for the Socket pilot',
    '',
    'Subcommands:',
    '  generate <tour.json>   Build the tour HTML/CSS/JS.',
    '  serve [--port=8080]           Start the local dev server.',
    '  watch <tour.json>      Build + serve + rebuild on source change.',
    '  valtown [--name=<valname>]    Deploy val/ to Val Town.',
    '  token <set|clear|status>      Manage the Val Town API token.',
    '  doctor                        Check external-tool prerequisites.',
    '',
    'Presets (apply to build/serve/watch):',
    '  --dev    Local-friendly: no minify, no base-path.',
    `  --prod   GH Pages-shaped: --minify + --base-path=${PROD_BASE_PATH}.`,
    '  Default: `prod` when the `CI` env var is set, else `dev`.',
    '',
    'Explicit knobs (override presets piecewise):',
    '  --minify                 Minify emitted JS/CSS.',
    '  --base-path=/prefix      Subdir URL prefix for assets + part links.',
    '  --refresh                Force-rebuild the meander submodule.',
    '',
    'Show this help: pnpm tour --help  (or -h)',
  ].join('\n')

  switch (command) {
    case undefined:
    case '--help':
    case '-h':
      // POSIX convention: --help is a successful request. Stdout, exit 0 —
      // so `pnpm tour --help > help.txt` works and shell checks
      // can detect availability by capturing stdout.
      console.log(HELP_TEXT)
      return
    case 'generate':
      generate(refresh, minify, basePath, rest.slice(1)).catch(
        failWith('generate'),
      )
      break
    case 'serve':
      serve(basePath, rest.slice(1)).catch(failWith('serve'))
      break
    case 'watch':
      watch(refresh, minify, basePath, rest.slice(1)).catch(failWith('watch'))
      break
    case 'valtown':
      deployValtown(rest.slice(1)).catch(failWith('valtown'))
      break
    case 'token':
      tokenCli(rest.slice(1)).catch(failWith('token'))
      break
    case 'doctor':
      doctor().catch(failWith('doctor'))
      break
    default:
      // Unknown command — stderr + non-zero exit, with a pointer to
      // --help rather than dumping the full usage block here.
      console.error(
        `Unknown command: ${command}\n\nRun \`pnpm tour --help\` for usage.`,
      )
      process.exit(1)
  }
}

/* ------------------------------------------------------------------ */
/*  Val Town deploy                                                     */
/* ------------------------------------------------------------------ */

/**
 * Deploy our val (val/*.ts) to Val Town. Uploads our source files
 * (index.ts, crypto.ts, validate.ts, email-template.ts), not
 * meander's. On success, prints the public val URL — paste that into
 * tour.json's commentBackend field.
 *
 * Resolves VALTOWN_TOKEN via:
 *   1. macOS Keychain (service: socket-walkthrough-valtown)
 *   2. VALTOWN_TOKEN env var
 *   3. .env.local VALTOWN_TOKEN entry
 *
 * Other val secrets (JWT_SIGNING_KEY, ALLOWED_EMAIL_DOMAIN, …) still
 * come from .env.local / env — those aren't Val Town API creds and
 * are safe to leave in .env.local.
 */

type DeployReceiptRow = {
  path: string
  type: 'http' | 'script'
  sha256: string
  action: 'created' | 'updated'
  bytes: number
}

/**
 * Print a table of uploaded files with content hashes so the deploy
 * record is readable from both the CLI and a GitHub Actions run
 * summary. The summary is written to `$GITHUB_STEP_SUMMARY` when
 * present, and always to stdout.
 */
async function printDeployReceipt(
  valName: string,
  valId: string,
  receipts: readonly DeployReceiptRow[],
): Promise<void> {
  const total = receipts.reduce((sum, r) => sum + r.bytes, 0)
  const lines = [
    `## Deploy receipt — ${valName} (${valId})`,
    '',
    '| file | type | action | bytes | sha256 |',
    '|---|---|---|---|---|',
    ...receipts.map(
      r =>
        `| \`${r.path}\` | ${r.type} | ${r.action} | ${r.bytes} | \`${r.sha256}\` |`,
    ),
    `| **total** | | | **${total}** | |`,
  ]
  const summary = lines.join('\n')
  console.log('\n' + summary)
  const summaryPath = process.env['GITHUB_STEP_SUMMARY']
  if (summaryPath) {
    try {
      await fs.appendFile(summaryPath, summary + '\n')
    } catch (e) {
      console.warn(
        '[valtown] could not write GITHUB_STEP_SUMMARY:',
        (e as Error).message,
      )
    }
  }
}

async function deployValtown(args: readonly string[]): Promise<void> {
  const envFile = path.join(repoRoot, '.env.local')
  if (existsSync(envFile)) {
    await loadDotEnv(envFile)
  }

  const token = resolveValTownToken()
  if (!token) {
    throw new Error(
      'VALTOWN_TOKEN not found. Run `pnpm tour token set` to store one in the macOS Keychain (recommended), or set VALTOWN_TOKEN in .env.local / the environment.',
    )
  }

  // Socket.dev malware audit on the val's transitive npm closure.
  // Fails fast before we upload anything — never ship flagged deps.
  // Skip with SKIP_AUDIT=1 for offline dev if the API is unreachable;
  // CI must not set this.
  if (!process.env['SKIP_AUDIT']) {
    await auditValDeps(repoRoot)
  } else {
    console.warn('[audit-deps] SKIP_AUDIT=1 — malware audit SKIPPED')
  }

  const nameArg = args.find(a => a.startsWith('--name='))
  const valName = nameArg ? nameArg.slice('--name='.length) : 'walkthrough'

  const API = 'https://api.val.town'
  const authHeader = { Authorization: `Bearer ${token}` }

  const meRes = await fetch(`${API}/v1/me`, { headers: authHeader })
  if (!meRes.ok) {
    if (meRes.status === 401) {
      throw new Error(
        'stored VALTOWN_TOKEN is unauthorized — token was rotated or revoked. ' +
          'Run `pnpm tour token set` to store a fresh one.',
      )
    }
    throw new Error(`GET /v1/me failed: ${meRes.status} ${await meRes.text()}`)
  }
  const me = (await meRes.json()) as { username?: string }
  const username = me.username
  if (!username) {
    throw new Error('Val Town API returned no username')
  }
  console.log(`Logged in as: ${username}`)

  // Find existing val by name via /me/vals. Alias endpoint uses a
  // lowercased slug form that doesn't always match how Val Town stores
  // the canonical name, so /me/vals is more reliable.
  let valId: string | null = null
  const listRes = await fetch(`${API}/v2/me/vals?limit=100`, {
    headers: authHeader,
  })
  if (listRes.ok) {
    const list = (await listRes.json()) as {
      data?: Array<{ id: string; name: string }>
    }
    const match = list.data?.find(
      v => v.name === valName || v.name.toLowerCase() === valName.toLowerCase(),
    )
    if (match) {
      valId = match.id
      console.log(`Found existing val: ${valId} (name: ${match.name})`)
    }
  }

  if (!valId) {
    console.log(`Creating new val "${valName}"...`)
    const createRes = await fetch(`${API}/v2/vals`, {
      method: 'POST',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: valName,
        privacy: 'unlisted',
        description: 'Socket walkthrough comment backend',
      }),
    })
    if (!createRes.ok) {
      throw new Error(
        `POST /v2/vals failed: ${createRes.status} ${await createRes.text()}`,
      )
    }
    const created = (await createRes.json()) as { id: string }
    valId = created.id
    console.log(`Created val: ${valId}`)
  }

  // Auto-discover `val/*.ts`: filesystem-as-manifest. Any file added
  // to val/ gets uploaded automatically — no hand-maintained list to
  // drift from reality. Skip *.test.ts (unit tests don't run on Val
  // Town; they'd just be dead code + bigger attack surface).
  //   - `index.ts` is the HTTP entry point → type: 'http'.
  //   - everything else is a library module → type: 'script'.
  // Sorted alphabetically so upload order + deploy receipts are stable
  // across runs (useful for diffing run logs).
  const valDir = path.join(repoRoot, 'val')
  const files = (await fs.readdir(valDir))
    .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort()
    .map(p => ({
      path: p,
      type: (p === 'index.ts' ? 'http' : 'script') as 'http' | 'script',
    }))
  if (!files.some(f => f.path === 'index.ts')) {
    throw new Error(
      `val/index.ts missing — cannot deploy without an HTTP entry`,
    )
  }

  type Receipt = {
    path: string
    type: 'http' | 'script'
    sha256: string
    action: 'created' | 'updated'
    bytes: number
  }
  const receipts: Receipt[] = []

  for (const f of files) {
    const srcPath = path.join(valDir, f.path)
    const content = await fs.readFile(srcPath, 'utf8')
    const sha256 = cryptoHash('sha256', content, 'hex')
    // Val Town's file API wants `path` in the querystring; body carries
    // only content + type. Try POST (create) first — if the file
    // already exists it 409s and we fall through to PUT (update).
    const qs = `?path=${encodeURIComponent(f.path)}`
    const createRes = await fetch(`${API}/v2/vals/${valId}/files${qs}`, {
      method: 'POST',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ content, type: f.type }),
    })
    let action: Receipt['action']
    if (createRes.ok) {
      action = 'created'
    } else if (createRes.status === 409) {
      // File exists — PUT to update.
      const updateRes = await fetch(`${API}/v2/vals/${valId}/files${qs}`, {
        method: 'PUT',
        headers: { ...authHeader, 'content-type': 'application/json' },
        body: JSON.stringify({ content, type: f.type }),
      })
      if (!updateRes.ok) {
        throw new Error(
          `update ${f.path} failed: ${updateRes.status} ${await updateRes.text()}`,
        )
      }
      action = 'updated'
    } else {
      throw new Error(
        `create ${f.path} failed: ${createRes.status} ${await createRes.text()}`,
      )
    }
    receipts.push({
      path: f.path,
      type: f.type,
      sha256,
      action,
      bytes: content.length,
    })
    console.log(
      `  ${action} ${f.path} (${content.length}B, sha256:${sha256.slice(0, 12)}…)`,
    )
  }

  // Deploy receipt — table of everything we uploaded with content
  // hashes. Printed to console always; also emitted to GitHub step
  // summary when running under Actions so the workflow run page has
  // the same info as the CLI output.
  await printDeployReceipt(valName, valId, receipts)

  const envVars: Array<[string, string | undefined]> = [
    ['JWT_SIGNING_KEY', process.env['JWT_SIGNING_KEY']],
    ['ALLOWED_EMAIL_DOMAIN', process.env['ALLOWED_EMAIL_DOMAIN']],
    ['ALLOWED_ORIGINS_PROD', process.env['ALLOWED_ORIGINS_PROD']],
    ['ALLOWED_ORIGINS_DEV', process.env['ALLOWED_ORIGINS_DEV']],
    ['TRUSTED_PROXY_HOPS', process.env['TRUSTED_PROXY_HOPS']],
    ['NODE_ENV', process.env['NODE_ENV']],
  ]
  for (const [key, value] of envVars) {
    if (!value) {
      continue
    }
    const putRes = await fetch(
      `${API}/v2/vals/${valId}/environment_variables/${encodeURIComponent(key)}`,
      {
        method: 'PUT',
        headers: { ...authHeader, 'content-type': 'application/json' },
        body: JSON.stringify({ value }),
      },
    )
    if (putRes.ok) {
      console.log(`  Set env ${key}`)
      continue
    }
    const postRes = await fetch(
      `${API}/v2/vals/${valId}/environment_variables`,
      {
        method: 'POST',
        headers: { ...authHeader, 'content-type': 'application/json' },
        body: JSON.stringify({ key, value }),
      },
    )
    if (!postRes.ok) {
      throw new Error(
        `env ${key} failed: ${postRes.status} ${await postRes.text()}`,
      )
    }
    console.log(`  Created env ${key}`)
  }

  // Fetch the HTTP endpoint URL from Val Town — the file-id-based
  // hostname is what actually routes, not the friendly name.
  const fileRes = await fetch(`${API}/v2/vals/${valId}/files?path=index.ts`, {
    headers: authHeader,
  })
  let publicUrl = `https://${username}-${valName.toLowerCase()}.web.val.run`
  if (fileRes.ok) {
    const fileList = (await fileRes.json()) as {
      data?: Array<{ links?: { endpoint?: string } }>
    }
    const endpoint = fileList.data?.[0]?.links?.endpoint
    if (endpoint) {
      publicUrl = endpoint
    }
  }
  console.log('')
  console.log(`Deployed. Public URL:  ${publicUrl}`)
  console.log(`Val ID:                ${valId}`)
  console.log('')
  console.log(`Update tour.json: "commentBackend": "${publicUrl}"`)
}

/**
 * Minimal .env parser — handles KEY=VALUE lines, # comments, and
 * surrounding quotes. Does not handle multi-line or escape sequences;
 * for our use case (a few API tokens), that's fine.
 */
async function loadDotEnv(filePath: string): Promise<void> {
  const text = await fs.readFile(filePath, 'utf8')
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const eq = line.indexOf('=')
    if (eq === -1) {
      continue
    }
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key && !(key in process.env)) {
      process.env[key] = value
    }
  }
}

/* ------------------------------------------------------------------ */
/*  VALTOWN_TOKEN resolution + management                              */
/* ------------------------------------------------------------------ */

// Token is stored via `git credential` — Git's built-in cross-platform
// credential protocol. Works on macOS (osxkeychain helper), Linux
// (libsecret / cache / store), and Windows (Git Credential Manager).
// We use a fake host to namespace our secret.
const CRED_PROTOCOL = 'https'
const CRED_HOST = 'socket-walkthrough-valtown.internal'
const CRED_URL = `${CRED_PROTOCOL}://${CRED_HOST}`

/**
 * Resolve the Val Town API token via git-credential → env → .env.local.
 *
 * git-credential delegates to whatever credential.helper the user has
 * configured (osxkeychain, libsecret, wincred/GCM, …) so storage is
 * always the OS-native secret store — we don't shell out to
 * platform-specific CLIs. Every platform uses the identical commands.
 *
 * Returns empty string when nothing is found so callers can give a
 * purpose-specific error message.
 */
function resolveValTownToken(): string {
  const fromStore = gitCredentialRead()
  if (fromStore) {
    return fromStore
  }
  return process.env['VALTOWN_TOKEN'] || ''
}

/**
 * Read a credential via `git credential fill`. Returns the password,
 * or empty string when no credential is stored (or git errors out).
 */
function gitCredentialRead(): string {
  try {
    // Input is the credential "description" (protocol+host). Output is
    // a set of key=value lines including `password=<token>`. Git will
    // consult every configured helper and fall through silently when
    // none returns a match.
    const out = execFileSync('git', ['credential', 'fill'], {
      input: `protocol=${CRED_PROTOCOL}\nhost=${CRED_HOST}\n\n`,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 5000,
    }).toString()
    const m = out.match(/^password=(.*)$/m)
    return m ? m[1].trim() : ''
  } catch {
    return ''
  }
}

/**
 * Store a credential via `git credential approve`. Git routes it to
 * the first configured helper; absent a helper, this is a no-op
 * (and we warn elsewhere).
 */
function gitCredentialWrite(token: string): void {
  execFileSync('git', ['credential', 'approve'], {
    input: `protocol=${CRED_PROTOCOL}\nhost=${CRED_HOST}\nusername=walkthrough\npassword=${token}\n\n`,
    stdio: ['pipe', 'ignore', 'ignore'],
    timeout: 5000,
  })
}

/**
 * Delete a credential via `git credential reject`. Must include the
 * same username we wrote with, otherwise the helper won't match the
 * entry (tested on osxkeychain — see git-credential(1)). Safe to call
 * when no credential exists.
 */
function gitCredentialClear(): void {
  try {
    execFileSync('git', ['credential', 'reject'], {
      input: `protocol=${CRED_PROTOCOL}\nhost=${CRED_HOST}\nusername=walkthrough\n\n`,
      stdio: ['pipe', 'ignore', 'ignore'],
      timeout: 5000,
    })
  } catch {
    /* no-op */
  }
}

/**
 * Report which credential helper(s) git has configured, so the user
 * knows where the token will actually end up. No helper means
 * git-credential silently succeeds but stores nothing, which is a
 * foot-gun worth flagging up-front.
 */
function describeCredentialHelper(): string {
  try {
    const helpers = execFileSync(
      'git',
      ['config', '--get-all', 'credential.helper'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
    if (helpers.length === 0) {
      return 'no credential.helper configured'
    }
    return helpers.join(', ')
  } catch {
    return 'no credential.helper configured'
  }
}

/**
 * `pnpm tour token <set|clear|status>` — manage the Val Town
 * API token in the macOS Keychain.
 *
 *   set    — prompts for a token on stdin (not shown in terminal,
 *            not stored in shell history), stores it in Keychain
 *            under service "socket-walkthrough-valtown".
 *   clear  — deletes the Keychain entry.
 *   status — reports which resolution source will be used next time
 *            a deploy runs.
 */
async function tokenCli(args: readonly string[]): Promise<void> {
  const sub = args[0] ?? 'status'

  if (sub === 'status') {
    const envFile = path.join(repoRoot, '.env.local')
    if (existsSync(envFile)) {
      loadDotEnv(envFile)
    }
    let source = 'none'
    let hasToken = false
    if (gitCredentialRead()) {
      source = `git credential helper — ${describeCredentialHelper()}`
      hasToken = true
    }
    if (!hasToken && process.env['VALTOWN_TOKEN']) {
      source = 'VALTOWN_TOKEN env var (from shell or .env.local)'
      hasToken = true
    }
    console.log(`Platform:     ${process.platform} (${process.arch})`)
    console.log(`Token source: ${source}`)
    if (!hasToken) {
      console.log('')
      console.log('To store one (recommended):')
      console.log('  pnpm tour token set')
    }
    return
  }

  if (sub === 'set') {
    // Reject positional arg; tokens on the command line leak into
    // shell history, process listings, and any terminal transcript
    // this session is captured in.
    if (args.length > 1) {
      throw new Error(
        'do not pass the token as an argument — that leaks it into shell history.\n' +
          'Run `pnpm tour token set` with no args and paste when prompted,\n' +
          'or pipe the token on stdin (e.g. `pbpaste | pnpm tour token set`).\n' +
          'If the token value was visible anywhere, rotate it at https://val.town/settings/api.',
      )
    }

    // Sanity check: a user with no credential.helper configured would
    // see `git credential approve` silently swallow the secret. Warn.
    const helper = describeCredentialHelper()
    if (helper === 'no credential.helper configured') {
      throw new Error(
        'git has no credential.helper configured. Install one first:\n' +
          '  macOS:   git config --global credential.helper osxkeychain\n' +
          '  Linux:   git config --global credential.helper libsecret   (needs apt install libsecret-tools)\n' +
          '          or `cache` / `store` if you have no desktop secret service\n' +
          '  Windows: Git for Windows bundles Git Credential Manager — no setup needed',
      )
    }

    const token = await readTokenFromStdin()
    if (!token) {
      throw new Error(
        'no token received on stdin — nothing stored.\n' +
          '\n' +
          'Three ways to provide a token:\n' +
          '  1. From an interactive terminal (preferred):\n' +
          '       pnpm tour token set\n' +
          '     then paste the token at the prompt and press Enter.\n' +
          "     NOTE: Claude Code's `!` shell prefix does not attach a TTY,\n" +
          "     so the prompt can't read input — run this in your OWN terminal.\n" +
          '\n' +
          "  2. Piped from clipboard (works inside Claude's `!` prefix):\n" +
          '       pbpaste | pnpm tour token set       (macOS)\n' +
          '       xclip -selection clipboard -o | pnpm tour token set   (Linux)\n' +
          '       Get-Clipboard | pnpm tour token set (Windows PowerShell)\n' +
          '\n' +
          '  3. Piped from a file (short-lived):\n' +
          '       cat /path/to/token.txt | pnpm tour token set\n' +
          '       shred -u /path/to/token.txt   # remove it afterwards\n' +
          '\n' +
          'Do NOT pass the token as a command-line argument — it leaks\n' +
          'into shell history and process listings.',
      )
    }
    gitCredentialWrite(token)
    console.log(`Stored via: ${helper}`)
    console.log('To verify: `pnpm tour token status`.')
    return
  }

  if (sub === 'clear') {
    gitCredentialClear()
    console.log('Cleared (if present) via git credential reject.')
    return
  }

  throw new Error(`Unknown subcommand: ${sub} (use set|clear|status)`)
}

/**
 * Read a token from stdin without echoing to the terminal. When stdin
 * is a TTY we flip the terminal to non-echo raw mode so the paste is
 * invisible; when piped (tests, scripts) we just read the line.
 */
async function readTokenFromStdin(): Promise<string> {
  const stdin = process.stdin
  const isTty = stdin.isTTY === true

  if (!isTty) {
    // Piped input — read everything and strip trailing newlines.
    return await new Promise<string>(resolve => {
      let buf = ''
      stdin.setEncoding('utf8')
      stdin.on('data', chunk => {
        buf += chunk
      })
      stdin.on('end', () => resolve(buf.trim()))
    })
  }

  process.stdout.write('Paste your Val Town token and press Enter: ')
  stdin.setRawMode(true)
  stdin.setEncoding('utf8')

  return await new Promise<string>(resolve => {
    let buf = ''
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        // Enter = done; Ctrl-C = abort.
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.off('data', onData)
          process.stdout.write('\n')
          resolve(buf.trim())
          return
        }
        // Ctrl-C — abort with the conventional exit code.
        const code = ch.charCodeAt(0)
        if (code === 3) {
          stdin.setRawMode(false)
          stdin.pause()
          process.stdout.write('\n')
          process.exit(130)
        }
        // Backspace (DEL 0x7f on most terminals, BS 0x08 elsewhere).
        if (code === 0x7f || code === 0x08) {
          if (buf.length > 0) {
            buf = buf.slice(0, -1)
          }
          continue
        }
        buf += ch
      }
    }
    stdin.on('data', onData)
  })
}

/* ------------------------------------------------------------------ */
/*  External-tools doctor                                              */
/* ------------------------------------------------------------------ */

type ExternalTool = {
  description?: string
  version?: string
  notes?: string | readonly string[]
}

type ExternalToolsManifest = {
  description?: string
  tools: Record<string, ExternalTool>
}

/**
 * `pnpm tour doctor` — reads external-tools.json and reports
 * which listed CLIs are present on PATH. Human-friendly summary per
 * tool: ✓ present / ✗ missing + install notes. Exits 0 regardless;
 * all listed tools are treated as optional (the script itself falls
 * back when a tool is absent).
 */
async function doctor(): Promise<void> {
  const manifestPath = path.join(repoRoot, 'external-tools.json')
  if (!existsSync(manifestPath)) {
    console.log('No external-tools.json found — skipping.')
    return
  }
  const manifest = JSON.parse(
    await fs.readFile(manifestPath, 'utf8'),
  ) as ExternalToolsManifest

  console.log(`Platform: ${process.platform} (${process.arch})`)
  console.log('')

  const entries = Object.entries(manifest.tools)
  const present: string[] = []
  const missing: Array<[string, ExternalTool]> = []

  for (const [name, tool] of entries) {
    if (isOnPath(name)) {
      present.push(name)
    } else {
      missing.push([name, tool])
    }
  }

  for (const name of present) {
    const tool = manifest.tools[name]
    console.log(`  ✓ ${name}${tool.version ? ` (need ${tool.version})` : ''}`)
  }

  if (missing.length === 0) {
    console.log('')
    console.log('All listed tools are on PATH.')
    return
  }

  console.log('')
  console.log('Missing (or not on PATH):')
  for (const [name, tool] of missing) {
    console.log(
      `  ✗ ${name}${tool.description ? ` — ${tool.description}` : ''}`,
    )
    const notes = tool.notes
    if (notes) {
      const lines = Array.isArray(notes) ? notes : [notes]
      for (const line of lines) {
        console.log(`      ${line}`)
      }
    }
  }
  console.log('')
  console.log(
    'All listed tools are optional — the tour script falls back when they are absent.',
  )
}

function isOnPath(cmd: string): boolean {
  // On Windows, `where` is a real binary and works with execFileSync.
  // Elsewhere, `command -v` is a shell builtin, so spawn a shell and
  // pass the command as the single argv (not split — avoids the
  // DEP0190 warning about unescaped array args with shell:true).
  try {
    if (process.platform === 'win32') {
      execFileSync('where', [cmd], {
        stdio: ['ignore', 'ignore', 'ignore'],
      })
    } else {
      // Escape cmd for the shell: allowlist alnum+dash+underscore+dot
      // for tool names. Anything else and we refuse to probe.
      if (!/^[A-Za-z0-9._-]+$/.test(cmd)) {
        return false
      }
      execFileSync('sh', ['-c', `command -v ${cmd}`], {
        stdio: ['ignore', 'ignore', 'ignore'],
      })
    }
    return true
  } catch {
    return false
  }
}

// Kick off the CLI. Kept at the bottom of the file so every helper
// (including module-level consts in the token / credential sections)
// is initialized before main() runs — otherwise the first call into
// a helper that references a later-declared const hits a TDZ error.
main()
