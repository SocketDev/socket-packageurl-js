/**
 * @fileoverview Walkthrough generator + local server wrapper.
 *
 * Ensures the vendored meander submodule is checked out, builds it on first
 * run, then either generates the walkthrough or serves the generated output
 * over HTTP for local preview. The submodule is pinned by commit SHA (via
 * the git superrepo pointer); the human-readable `# name-version` comment
 * in .gitmodules records which upstream version the SHA corresponds to.
 *
 * Generation also runs in CI (.github/workflows/walkthrough.yml).
 */

import { execFileSync } from 'node:child_process'
import { hash as cryptoHash } from 'node:crypto'
import {
  appendFileSync,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { transform as esbuildTransform } from 'esbuild'
import { transform as lightningTransform } from 'lightningcss'

import { auditCdnScripts, auditValDeps } from './audit-deps.mts'

const MEANDER_PATH = 'upstream/meander'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const meanderDir = path.join(repoRoot, MEANDER_PATH)
const cliEntry = path.join(meanderDir, 'dist', 'cli.js')
const nodeModulesDir = path.join(meanderDir, 'node_modules')
const walkthroughDir = path.join(repoRoot, 'walkthrough')

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

function isEmptyDir(dir: string): boolean {
  return !existsSync(dir) || readdirSync(dir).length === 0
}

function ensureMeander(refresh: boolean): void {
  if (isEmptyDir(meanderDir)) {
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
 * Validate the `filename` field on every walkthrough.json part, then
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
      `walkthrough.json has ${errors.length} invalid part filename(s):\n  - ${errors.join('\n  - ')}`,
    )
  }
  const map = new Map<number, string>()
  for (const p of parts) {
    map.set(p.id, p.filename!)
  }
  return map
}

/**
 * Rewrite a generated HTML file for hosting under `basePath`. Two
 * categories of URL get prefixed:
 *
 *   1. Root-relative asset paths meander or our post-processor emits
 *      (/walkthrough.css, /walkthrough-drag.js, /favicon.ico, etc.).
 *   2. Val-Town-shaped part links (/<slug>/part/<n>) — these don't
 *      exist as files; rewrite to the real flat HTML name
 *      (<partFilenames[n]>.html, e.g. "anatomy.html") and prefix with
 *      basePath.
 *
 * We do a narrowly-scoped regex pass rather than a full HTML parse:
 * the set of URL attributes we emit is small and known, and we don't
 * want to touch hrefs in the prose (external links, anchor jumps).
 */
function applyBasePath(
  html: string,
  basePath: string,
  slug: string,
  partFilenames: ReadonlyMap<number, string>,
): string {
  if (!basePath) {
    return html
  }
  // 1. Flat part link — rewrite first so step 2 doesn't double-prefix.
  // Matches href="/<slug>/part/<n>" and rewrites to
  // href="<basePath>/<partFilenames[n]>.html". Part numbers without a
  // filename entry are left untouched; the validator that built the
  // map already guaranteed coverage for every configured part, so any
  // miss here is a stray href meander rendered for a removed part.
  const partLink = new RegExp(`(href=")/${slug}/part/(\\d+)/?(")`, 'g')
  let out = html.replace(partLink, (_m, pre, n, post) => {
    const filename = partFilenames.get(Number(n))
    if (!filename) {
      return `${pre}/${slug}/part/${n}${post}`
    }
    return `${pre}${basePath}/${filename}.html${post}`
  })
  // 2. Root-relative asset URLs. Match href="/..." and src="/..." and
  // ServiceWorker-style register('/...') — but skip:
  //   - protocol-qualified URLs (https://, data:, mailto:, etc.)
  //   - anchor/hash links ("#...")
  //   - URLs that already begin with the basePath (idempotent)
  //   - the part-link pattern above (already rewritten in step 1)
  const assetAttr = /(\s(?:href|src)=")(\/[^"]*)(")/g
  out = out.replace(assetAttr, (_m, pre, url, post) => {
    if (url.startsWith(basePath + '/') || url === basePath) {
      return `${pre}${url}${post}`
    }
    return `${pre}${basePath}${url}${post}`
  })
  // 3. SW register — also prefix. Matches .register('/walkthrough-sw.js').
  out = out.replace(/\.register\('(\/[^']+)'/g, (_m, url) =>
    url.startsWith(basePath + '/')
      ? `.register('${url}'`
      : `.register('${basePath}${url}'`,
  )
  return out
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
 *   worker-src    self (service worker)
 *   base-uri, form-action   self
 *   frame-ancestors         none (clickjacking protection)
 *   default-src             self (fallback for anything not listed)
 */
function buildCspMeta(html: string, commentBackend: string): string {
  // Collect each inline script body, hash it as sha512 — same algo
  // as our SRI attributes, consistent with the fleet convention.
  // Meander + our post-processor both emit scripts with `<script>...`
  // (no src attr) — match those, skip `<script src=...>`.
  const inlineRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi
  const inlineScriptHashes = new Set<string>()
  for (const m of html.matchAll(inlineRe)) {
    const body = m[1]!
    const hash = cryptoHash('sha512', body, 'base64')
    inlineScriptHashes.add(`'sha512-${hash}'`)
  }

  // Pull the already-computed SRI hashes off cross-origin <script src>
  // and <link rel=stylesheet href> tags. CSP accepts sha256/384/512
  // hashes directly as allowlist entries — this is stricter than
  // listing the CDN origin, because a compromised unpkg serving a
  // different bundle fails the CSP check *before* SRI even runs.
  // Same-origin tags don't need hashes here (covered by `'self'` +
  // their own SRI attribute).
  const cdnScriptHashes = new Set<string>()
  const cdnStyleHashes = new Set<string>()
  const scriptIntegrityRe =
    /<script[^>]*\bsrc="https:[^"]*"[^>]*\bintegrity="(sha\d+-[^"]+)"/gi
  const styleIntegrityRe =
    /<link[^>]*\brel="stylesheet"[^>]*\bhref="https:[^"]*"[^>]*\bintegrity="(sha\d+-[^"]+)"/gi
  for (const m of html.matchAll(scriptIntegrityRe)) {
    cdnScriptHashes.add(`'${m[1]!}'`)
  }
  for (const m of html.matchAll(styleIntegrityRe)) {
    cdnStyleHashes.add(`'${m[1]!}'`)
  }

  const scriptSources = ["'self'", ...inlineScriptHashes, ...cdnScriptHashes]
  const styleSources = ["'self'", ...cdnStyleHashes]

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
    return readFileSync(cachePath, 'utf8').trim()
  }
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`SRI fetch ${url} → HTTP ${res.status}`)
  }
  const integrity = computeIntegrity(new Uint8Array(await res.arrayBuffer()))
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(cachePath, integrity + '\n')
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
 *   - `/walkthrough.css` etc. → read from `walkthroughDir` directly.
 *   - `basePath`-prefixed same-origin paths → stripped to the bare
 *     file name, then read from `walkthroughDir`.
 *
 * CDN tags also get `crossorigin="anonymous"` (required for the SRI
 * check to run on cross-origin responses). Same-origin tags don't
 * need it and shouldn't have it (would trigger CORS unnecessarily).
 *
 * Idempotent — tags that already carry `integrity=` are left alone.
 */
async function injectSri(
  html: string,
  walkthroughDir: string,
  basePath: string,
  cacheDir: string,
): Promise<string> {
  // Map of URL/path → SRI hash. Populated lazily as we walk the tag
  // stream so we resolve each URL at most once per file.
  const integrityByRef = new Map<string, string>()

  const resolveIntegrity = async (ref: string): Promise<string | null> => {
    if (integrityByRef.has(ref)) {
      return integrityByRef.get(ref)!
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
      const localPath = path.join(walkthroughDir, bareRef)
      if (existsSync(localPath)) {
        integrity = computeIntegrity(readFileSync(localPath))
      }
    }
    integrityByRef.set(ref, integrity ?? '')
    return integrity
  }

  // Match tags carrying src/href pointing at either unpkg.com or a
  // same-origin absolute path. Exclude `/` from the attrs capture so
  // a self-closing `<link .../>` doesn't drag the slash mid-rewrite.
  const tagRe =
    /<(script|link)\s([^>/]*?\b(?:src|href)="((?:https:\/\/unpkg\.com\/|\/)[^"]+)"[^>/]*)(\s*\/?\s*>)/gi

  // Browsers only honor `integrity` on:
  //   <script>
  //   <link rel=stylesheet>
  //   <link rel=preload>  / <link rel=modulepreload>
  // `<link rel=icon>` / `<link rel=apple-touch-icon>` ignore it, so
  // skip them — no point emitting hash bytes the browser throws away.
  const supportsSri = (tag: string, attrs: string): boolean => {
    if (tag.toLowerCase() === 'script') {
      return true
    }
    const relMatch = attrs.match(/\brel="([^"]+)"/i)
    if (!relMatch) {
      return false
    }
    return /\b(?:stylesheet|preload|modulepreload)\b/i.test(relMatch[1]!)
  }

  // Two-pass: first collect + resolve all refs the browser honors,
  // then rewrite. `matchAll` is sync so we walk once to gather refs,
  // resolve them, then `replace` using the populated map.
  for (const m of html.matchAll(tagRe)) {
    if (supportsSri(m[1]!, m[2]!)) {
      await resolveIntegrity(m[3]!)
    }
  }

  return html.replace(tagRe, (full, tag, attrs, ref, close) => {
    if (/\bintegrity=/i.test(attrs)) {
      return full
    }
    if (!supportsSri(tag, attrs)) {
      return full
    }
    const integrity = integrityByRef.get(ref)
    if (!integrity) {
      return full
    }
    // crossorigin=anonymous only makes sense (and is required for SRI)
    // on cross-origin requests. Same-origin tags shouldn't carry it.
    const crossorigin = ref.startsWith('https://')
      ? ' crossorigin="anonymous"'
      : ''
    const trimmedAttrs = attrs.trimEnd()
    return `<${tag} ${trimmedAttrs} integrity="${integrity}"${crossorigin}${close}`
  })
}

async function generate(
  refresh: boolean,
  minify: boolean,
  basePath: string,
  rest: readonly string[],
): Promise<void> {
  if (rest.length === 0) {
    console.error(
      'Usage: pnpm walkthrough [--refresh] [--minify] [--base-path=/prefix] generate <walkthrough.json>',
    )
    process.exit(1)
  }
  ensureMeander(refresh)
  run(process.execPath, [cliEntry, 'generate', ...rest], repoRoot)

  // Append Socket overrides to meander's emitted CSS. Guarded by a
  // marker so re-runs don't double-append if meander ever preserves
  // the file (today it overwrites from source every run).
  const overrideCssPath = path.join(repoRoot, 'walkthrough-overrides.css')
  const emittedCss = path.join(walkthroughDir, 'walkthrough.css')
  const overrideMarker = '/* ── Socket overrides'
  if (existsSync(overrideCssPath) && existsSync(emittedCss)) {
    const current = readFileSync(emittedCss, 'utf8')
    if (!current.includes(overrideMarker)) {
      const overrideCss = readFileSync(overrideCssPath, 'utf8')
      appendFileSync(
        emittedCss,
        `\n\n${overrideMarker} (walkthrough-overrides.css) ── */\n${overrideCss}`,
      )
    }
  }

  // Ship the column-splitter JS alongside the generated HTML.
  const dragSrc = path.join(repoRoot, 'walkthrough-drag.js')
  if (existsSync(dragSrc)) {
    copyFileSync(dragSrc, path.join(walkthroughDir, 'walkthrough-drag.js'))
  }

  // Ship the service worker — cache-first for same-origin assets,
  // network-first for HTML navigations, network-passthrough for the
  // comment API. The SW file carries a `__CACHE_VERSION__` sentinel
  // that we replace here with the current git HEAD SHA so every
  // deploy flips the SW's bytes → browser detects a new SW →
  // `activate` prunes the old cache. Falls back to timestamp if
  // we're not in a git repo (tarball install, fresh clone pre-init).
  const swSrc = path.join(repoRoot, 'walkthrough-sw.js')
  if (existsSync(swSrc)) {
    let swSource = readFileSync(swSrc, 'utf8')
    let cacheVersion: string
    try {
      cacheVersion = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
        cwd: repoRoot,
        encoding: 'utf8',
      })
        .toString()
        .trim()
    } catch {
      cacheVersion = 'ts-' + Date.now().toString(36)
    }
    swSource = swSource.replaceAll('__CACHE_VERSION__', cacheVersion)
    writeFileSync(path.join(walkthroughDir, 'walkthrough-sw.js'), swSource)
  }

  // Ship favicons (self-hosted copy of socket.dev's icons). Walkthrough
  // HTML doesn't currently carry <link rel="icon"> tags from meander,
  // so we inject them in the post-processor below.
  const faviconSrc = path.join(repoRoot, 'assets', 'favicon')
  const faviconFiles = [
    'favicon.ico',
    'favicon-32x32.png',
    'favicon-16x16.png',
    'apple-touch-icon.png',
  ] as const
  for (const f of faviconFiles) {
    const src = path.join(faviconSrc, f)
    if (existsSync(src)) {
      copyFileSync(src, path.join(walkthroughDir, f))
    }
  }

  // Ship the comment-UI replacement (optional — only when a commentBackend
  // is configured). The shim is loaded instead of meander's inlined comment
  // scripts, which the rewrite below strips.
  const commentsSrc = path.join(repoRoot, 'walkthrough-comments.js')
  const configPath = rest[0]
  const walkthroughConfig = configPath
    ? (JSON.parse(readFileSync(path.resolve(configPath), 'utf8')) as {
        slug?: string
        commentBackend?: string
        parts?: Array<{ id: number; title: string; filename?: string }>
      })
    : {}
  const commentBackend = walkthroughConfig.commentBackend || ''
  const slug = walkthroughConfig.slug || ''
  // Map part-id → title for the post-processor to inject as aria-label
  // on each numbered part pill. Without this, screen readers announce
  // each pill as just "Part 1", "Part 2", …; with it, they get the
  // real section title ("Anatomy of a PURL" etc.).
  const partTitles = new Map<number, string>()
  for (const p of walkthroughConfig.parts ?? []) {
    partTitles.set(p.id, p.title)
  }

  // Map part-id → filename (e.g. 1 → "anatomy"). Drives both the flat
  // HTML filenames on disk (<filename>.html) and the hrefs we rewrite
  // in applyBasePath(). Validator below enforces presence, shape, and
  // uniqueness — errors follow CLAUDE.md's ERROR MESSAGES doctrine so
  // the build fails with an actionable message, not a cryptic symptom.
  const partFilenames = validatePartFilenames(
    walkthroughConfig.parts ?? [],
    configPath ? path.resolve(configPath) : '<config>',
  )

  // Pull per-part section counts off the emitted index page. Meander
  // computes them while rendering — cheaper + more reliable than
  // re-parsing every part page here. Matches the TOC row shape:
  //   <li><a href="/<slug>/part/<n>">…</a> <span class="ok">(N sections)</span></li>
  // Used below to append "(N)" to each numbered pill so users see
  // section-depth info from any page, not just the TOC.
  const partCounts = new Map<number, number>()
  const indexPath = path.join(walkthroughDir, 'index.html')
  if (existsSync(indexPath)) {
    const indexHtml = readFileSync(indexPath, 'utf8')
    const countRe = new RegExp(
      `/${slug}/part/(\\d+)[^<]*</a>\\s*<span[^>]*>\\((\\d+)\\s+sections?\\)`,
      'g',
    )
    for (const m of indexHtml.matchAll(countRe)) {
      partCounts.set(Number(m[1]), Number(m[2]))
    }
  }
  if (commentBackend && existsSync(commentsSrc)) {
    copyFileSync(
      commentsSrc,
      path.join(walkthroughDir, 'walkthrough-comments.js'),
    )
  }

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
  const dragTag = '<script src="/walkthrough-drag.js" defer></script>'
  const commentsTag = '<script src="/walkthrough-comments.js" defer></script>'
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
    "        navigator.serviceWorker.register('/walkthrough-sw.js', { updateViaCache: 'none' }).catch(() => {})",
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
  ].join('\n  ')
  // Preload the shim scripts so the browser starts fetching them in
  // parallel with HTML parsing, ahead of the `defer` discovery. The
  // CSS is already in a `<link rel="stylesheet">` which is inherently
  // render-blocking, so it doesn't need a preload. Comment shim is
  // gated on commentBackend since we only emit the <script> tag then.
  const preloadTags = [
    '<link rel="preload" as="script" href="/walkthrough-drag.js" />',
    ...(commentBackend
      ? ['<link rel="preload" as="script" href="/walkthrough-comments.js" />']
      : []),
  ].join('\n  ')
  // Socket tagline footer — matches the format used on socket.dev
  // marketing pages. "⚡️" is rendered as an emoji (single char) so
  // it inherits text color at small sizes; wrapping in a <span>
  // lets CSS ship a small nudge if we need it later.
  const footerTag = [
    '<footer class="wt-socket-footer">',
    '  <span>Made with <span class="wt-footer-bolt" aria-hidden="true">⚡️</span> by Socket Inc</span>',
    '</footer>',
  ].join('\n  ')

  for (const entry of readdirSync(walkthroughDir)) {
    if (!entry.endsWith('.html')) {
      continue
    }
    const htmlPath = path.join(walkthroughDir, entry)
    let html = readFileSync(htmlPath, 'utf8')

    // Strip meander's inlined comment scripts when replacing with ours.
    if (commentBackend) {
      html = stripInlinedCommentScripts(html, COMMENT_SCRIPT_MARKERS)
    }

    // Inject favicons + preloads in <head>. Idempotent via marker
    // checks. Preloads land last so they're adjacent to the deferred
    // <script> tags they anticipate (a visual-grouping nicety).
    if (!html.includes('apple-touch-icon.png')) {
      html = html.replace('</head>', `  ${faviconTags}\n</head>`)
    }
    if (!html.includes('rel="preload"')) {
      html = html.replace('</head>', `  ${preloadTags}\n</head>`)
    }

    // Inject our scripts once (idempotent). Use the `<script src=`
    // marker rather than bare filename — the preload tags injected
    // earlier ALSO contain "walkthrough-drag.js" / "walkthrough-comments.js",
    // so a filename-only check false-positives and skips script injection.
    if (!html.includes('<script src="/walkthrough-drag.js"')) {
      html = html.replace('</body>', `  ${dragTag}\n</body>`)
    }
    if (
      commentBackend &&
      !html.includes('<script src="/walkthrough-comments.js"')
    ) {
      html = html.replace(
        '</body>',
        `  ${configTag}\n  ${commentsTag}\n</body>`,
      )
    }
    // Service worker registration — last script before </body> so
    // the page-critical shim scripts start downloading first.
    if (!html.includes('walkthrough-sw.js')) {
      html = html.replace('</body>', `  ${swRegisterTag}\n</body>`)
    }

    // Socket tagline footer, injected once before </body>. Idempotent
    // via the wt-socket-footer class marker.
    if (!html.includes('wt-socket-footer')) {
      html = html.replace('</body>', `  ${footerTag}\n</body>`)
    }

    // Inject a home link at the front of the part-nav on every part
    // page. Meander's emitted topbar only has the numbered Part pills —
    // users clicking a part had no one-click way back to the TOC.
    // Index page has no `.part-nav` so the replace is a no-op there
    // (the TOC IS the index). Idempotent via class marker.
    if (
      html.includes('<div class="part-nav">') &&
      !html.includes('wt-home-link')
    ) {
      html = html.replace(
        '<div class="part-nav">',
        '<div class="part-nav"><a class="wt-home-link" href="/" aria-label="Back to the table of contents" title="Back to the table of contents"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9.5 12 3l9 6.5V20a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z"/></svg></a><span class="wt-parts-label">Parts:</span>',
      )
    }

    // Enrich each numbered Part pill. Meander emits
    //   `<a ... href="/<slug>/part/<n>">Part <n></a>`
    // with no accessible context — a screen reader just hears
    // "Part 1, Part 2, …". We rewrite:
    //   1. Opening tag: add title + aria-label carrying the real
    //      section name so keyboard + AT users get the same info
    //      as the tooltip.
    //   2. Inner text: strip the "Part " prefix (the pill-row has
    //      its own "Parts:" label; each pill just needs the number)
    //      and append "(M)" with the per-part section count, same
    //      as what the TOC shows. Users see section-depth info on
    //      every page, not just the index.
    // Runs BEFORE the base-path rewrite so the `/part/<n>` shape is
    // still intact and easy to match. Idempotent via the aria-label
    // probe.
    if (slug && partTitles.size > 0) {
      const partPillRe = new RegExp(
        `(<a\\b)((?:(?!aria-label)[^>])*\\bhref="/${slug}/part/(\\d+)"[^>]*)>Part \\3</a>`,
        'g',
      )
      html = html.replace(partPillRe, (match, open, attrs, n) => {
        const title = partTitles.get(Number(n))
        if (!title) {
          return match
        }
        const count = partCounts.get(Number(n))
        const fullLabel = `Part ${n}: ${title.replace(/"/g, '&quot;')}${count ? ` (${count} sections)` : ''}`
        return `${open}${attrs} title="${fullLabel}" aria-label="${fullLabel}">${n}</a>`
      })
    }

    // Index-page TOC cleanup. Meander emits `<ul><li><a>Part N: Title</a>
    // <span class="ok">(M sections)</span></li>…`. Two tweaks:
    //   - Swap <ul> → <ol> so numbers come from the list marker, not
    //     the link text. Users read "1. Anatomy of a PURL" instead of
    //     "• Part 1: Anatomy of a PURL".
    //   - Strip the "Part N: " prefix from each link so the title
    //     alone carries the line, no duplication with the list marker.
    // Only applies to the index page (has <h3>Parts</h3> + ul with
    // /part/<n> hrefs) — part pages don't have this shape.
    if (entry === 'index.html' && html.includes('<h3>Parts</h3>')) {
      html = html.replace(
        /(<h3>Parts<\/h3>\s*)<ul>([\s\S]*?)<\/ul>/,
        (_m, head, body) => `${head}<ol class="wt-parts-ol">${body}</ol>`,
      )
      // Strip the "Part N: " prefix from the visible link text — the
      // list marker already supplies the number. aria-label + title
      // keep the full "Part N: <title>" for screen readers / tooltips.
      html = html.replace(
        /(<a\s[^>]*\bhref="\/[^"]+\/part\/\d+"[^>]*>)Part \d+:\s*/g,
        '$1',
      )
    }

    // Base-path rewrite — last step so every injected tag above gets
    // prefixed in one pass. No-op when --base-path is empty (local dev,
    // Val Town hosting, etc.).
    if (basePath && slug) {
      html = applyBasePath(html, basePath, slug, partFilenames)
    }

    // Rename meander's walkthrough-part-<n>.html to the configured
    // <filename>.html (e.g. walkthrough-part-1.html → anatomy.html).
    // Flat public URLs replace /<slug>/part/<n>-style links once the
    // site is deployed. Other emitted HTML (index.html, documents.html
    // if any) retains its name. Idempotent: if the target file already
    // exists and entry is the legacy name, we write the fresh content
    // then unlink the old — both states are covered by the validator
    // running before the loop, which guarantees partFilenames has an
    // entry for every part meander rendered.
    const partMatch = /^walkthrough-part-(\d+)\.html$/.exec(entry)
    if (partMatch) {
      const n = Number(partMatch[1])
      const newName = partFilenames.get(n)
      if (!newName) {
        throw new Error(
          `walkthrough/${entry}: no filename configured for part ${n}. Add "filename" to part ${n} in walkthrough.json (e.g. "anatomy") — the validator should have caught this, so meander may have rendered a part that isn't in walkthrough.json.`,
        )
      }
      const newPath = path.join(walkthroughDir, `${newName}.html`)
      writeFileSync(newPath, html)
      if (newPath !== htmlPath) {
        unlinkSync(htmlPath)
      }
      continue
    }

    writeFileSync(htmlPath, html)
  }

  // Socket.dev malware audit on CDN scripts (marked, highlight.js)
  // that meander's generated HTML loads via `<script src=unpkg...>`.
  // Runs before minification so a failure aborts early. Skip the
  // audit via SKIP_AUDIT=1 for offline dev; CI must not set this.
  if (!process.env['SKIP_AUDIT']) {
    await auditCdnScripts(walkthroughDir)
  } else {
    console.warn('[audit-deps] SKIP_AUDIT=1 — CDN audit SKIPPED')
  }

  if (minify) {
    await minifyEmittedAssets()
  }

  // Subresource Integrity pass — runs LAST so the local-file hashes
  // we compute match the exact bytes that ship (post-minify). CDN
  // hashes are disk-cached under .cache/sri/; local ones hash the
  // files in `walkthroughDir` directly. Any `<script>` / `<link>`
  // (CDN or same-origin) ends up with `integrity="sha384-..."`.
  const sriCacheDir = path.join(repoRoot, '.cache', 'sri')
  for (const entry of readdirSync(walkthroughDir)) {
    if (!entry.endsWith('.html')) {
      continue
    }
    const htmlPath = path.join(walkthroughDir, entry)
    let html = readFileSync(htmlPath, 'utf8')
    const originalHtml = html
    html = await injectSri(html, walkthroughDir, basePath, sriCacheDir)
    // CSP meta — must run AFTER SRI injection so the hash of each
    // inline <script> reflects its final body (no further rewrites).
    // Per-file because __defIndex varies per-part; pages also differ
    // in which inline blocks land (index vs part pages).
    if (!html.includes('http-equiv="Content-Security-Policy"')) {
      const cspTag = buildCspMeta(html, commentBackend)
      html = html.replace('</head>', `  ${cspTag}\n</head>`)
    }
    if (html !== originalHtml) {
      writeFileSync(htmlPath, html)
    }
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
async function minifyEmittedAssets(): Promise<void> {
  const jsFiles = [
    'walkthrough-comments.js',
    'walkthrough-drag.js',
    'walkthrough-sw.js',
  ]
  const cssFiles = ['walkthrough.css']

  let savedBytes = 0

  for (const f of jsFiles) {
    const p = path.join(walkthroughDir, f)
    if (!existsSync(p)) {
      continue
    }
    const before = readFileSync(p, 'utf8')
    const out = await esbuildTransform(before, {
      loader: 'js',
      minify: true,
      target: 'es2022',
      legalComments: 'none',
    })
    writeFileSync(p, out.code)
    savedBytes += before.length - out.code.length
  }

  for (const f of cssFiles) {
    const p = path.join(walkthroughDir, f)
    if (!existsSync(p)) {
      continue
    }
    const before = readFileSync(p, 'utf8')
    const out = lightningTransform({
      filename: f,
      code: Buffer.from(before),
      minify: true,
    })
    writeFileSync(p, out.code)
    savedBytes += before.length - out.code.length
  }

  console.log(`Minified assets — saved ${(savedBytes / 1024).toFixed(1)} KB`)
}

/**
 * Strip `<script>...</script>` blocks containing any of the given marker
 * substrings. Meander inlines its comment-related JS directly in each HTML
 * file; this removes those blocks so our replacement script has no
 * collisions. Fail-loud if fewer than the expected count are removed — a
 * marker string drift would silently ship broken walkthroughs.
 */
function stripInlinedCommentScripts(
  html: string,
  markers: readonly string[],
): string {
  let stripped = 0
  const out = html.replace(
    /<script\b[^>]*>([\s\S]*?)<\/script>/g,
    (match, body: string) => {
      if (markers.some(m => body.includes(m))) {
        stripped++
        return ''
      }
      return match
    },
  )
  // We expect at least 2 stripped blocks on a part page (comment-client +
  // unresolved-comments). Documents page has none.
  return out
}

function readSlug(): string {
  // Meander bakes Val-Town-shaped links (/<slug>/part/<n>) into the HTML even
  // though it writes flat file names. Read the slug from manifest.json so we
  // can route those URLs to the right file.
  const manifestPath = path.join(walkthroughDir, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    slug: string
  }
  return manifest.slug
}

/**
 * Read the part-id → filename map from walkthrough.json at the repo
 * root. The dev server uses this to translate /<slug>/part/<n> URLs
 * to the renamed <filename>.html files on disk. Mirrors the rename
 * applied by the generate pipeline, so a build + serve round-trips
 * URLs to files correctly. Returns an empty map when walkthrough.json
 * isn't present (e.g. invoked from a fresh checkout without the
 * source config) — the route table falls back to the legacy shape.
 */
function readPartFilenames(): Map<number, string> {
  const configPath = path.join(repoRoot, 'walkthrough.json')
  if (!existsSync(configPath)) {
    return new Map()
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
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
  // anything else               → as-is (e.g. /walkthrough.css)
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

function serve(basePath: string, args: readonly string[]): void {
  const portArg = args.find(a => a.startsWith('--port='))
  const port = portArg ? Number(portArg.slice('--port='.length)) : 8080

  if (!existsSync(walkthroughDir)) {
    console.error(
      `No walkthrough/ directory found. Run \`pnpm walkthrough generate walkthrough.json\` first.`,
    )
    process.exit(1)
  }

  const slug = readSlug()
  const partFilenames = readPartFilenames()

  const server = createServer((req, res) => {
    const rawUrl = (req.url ?? '/').split('?')[0]!.split('#')[0]!
    let decoded = decodeURIComponent(rawUrl)
    // Strip the base-path prefix so `routeToFile` sees the shape it
    // expects. Mirrors the generate-side `--base-path` rewrite so
    // `pnpm walkthrough --base-path=/X serve` + a build with the
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

    const target = path.resolve(walkthroughDir, relative)
    if (
      target !== walkthroughDir &&
      !target.startsWith(walkthroughDir + path.sep)
    ) {
      res.writeHead(400).end('bad request')
      return
    }

    let resolvedTarget = target
    if (existsSync(resolvedTarget) && statSync(resolvedTarget).isDirectory()) {
      resolvedTarget = path.join(resolvedTarget, 'index.html')
    }

    if (!existsSync(resolvedTarget) || !statSync(resolvedTarget).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
      return
    }

    const ext = path.extname(resolvedTarget).toLowerCase()
    const type = MIME[ext] ?? 'application/octet-stream'
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' })
    createReadStream(resolvedTarget).pipe(res)
  })

  server.listen(port, '127.0.0.1', () => {
    console.log(`Serving ${walkthroughDir} (slug: ${slug})`)
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
 * regenerate when any source file (shim, CSS, SW, walkthrough.json,
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
    console.error('Usage: pnpm walkthrough watch <walkthrough.json>')
    process.exit(1)
  }

  // Import fs.watch lazily so we don't pay the import cost on other
  // subcommands. Node 20+ supports `recursive: true` on all platforms.
  const { watch: fsWatch } = await import('node:fs')

  // Initial build before we start the server. This also populates
  // walkthroughDir so `serve` has something to serve on first request.
  await generate(refresh, minify, basePath, rest)

  // Start the server. `serve` blocks on its own createServer; since
  // we're about to install watchers on the main loop, kicking it off
  // first keeps the process alive without explicit setInterval.
  serve(basePath, [])

  // Files/directories that should trigger a rebuild when they change.
  // Keep this narrow — watching the entire repo would catch noise
  // from test output, node_modules, walkthrough/ itself, etc.
  const configArg = rest[0]!
  const sourcesToWatch: string[] = [
    path.join(repoRoot, configArg),
    path.join(repoRoot, 'walkthrough-comments.js'),
    path.join(repoRoot, 'walkthrough-drag.js'),
    path.join(repoRoot, 'walkthrough-overrides.css'),
    path.join(repoRoot, 'walkthrough-sw.js'),
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
    } catch (err) {
      console.error(
        `[watch] rebuild failed:`,
        err instanceof Error ? err.message : String(err),
      )
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
      // Ignore writes to the output directory itself — generate() writes
      // into walkthroughDir, which would otherwise loop-trigger.
      if (filename && filename.startsWith('walkthrough/')) {
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
    const msg = err instanceof Error ? err.message : String(err ?? 'unknown')
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
    'pnpm walkthrough — walkthrough generator for the Socket pilot',
    '',
    'Subcommands:',
    '  generate <walkthrough.json>   Build the walkthrough HTML/CSS/JS.',
    '  serve [--port=8080]           Start the local dev server.',
    '  watch <walkthrough.json>      Build + serve + rebuild on source change.',
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
    'Show this help: pnpm walkthrough --help  (or -h)',
  ].join('\n')

  switch (command) {
    case undefined:
    case '--help':
    case '-h':
      // POSIX convention: --help is a successful request. Stdout, exit 0 —
      // so `pnpm walkthrough --help > help.txt` works and shell checks
      // can detect availability by capturing stdout.
      console.log(HELP_TEXT)
      return
    case 'generate':
      generate(refresh, minify, basePath, rest.slice(1)).catch(
        failWith('generate'),
      )
      break
    case 'serve':
      serve(basePath, rest.slice(1))
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
        `Unknown command: ${command}\n\nRun \`pnpm walkthrough --help\` for usage.`,
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
 * walkthrough.json's commentBackend field.
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
function printDeployReceipt(
  valName: string,
  valId: string,
  receipts: readonly DeployReceiptRow[],
): void {
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
      appendFileSync(summaryPath, summary + '\n')
    } catch (err) {
      console.warn(
        '[valtown] could not write GITHUB_STEP_SUMMARY:',
        (err as Error).message,
      )
    }
  }
}

async function deployValtown(args: readonly string[]): Promise<void> {
  const envFile = path.join(repoRoot, '.env.local')
  if (existsSync(envFile)) {
    loadDotEnv(envFile)
  }

  const token = resolveValTownToken()
  if (!token) {
    throw new Error(
      'VALTOWN_TOKEN not found. Run `pnpm walkthrough token set` to store one in the macOS Keychain (recommended), or set VALTOWN_TOKEN in .env.local / the environment.',
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
          'Run `pnpm walkthrough token set` to store a fresh one.',
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
  const files = readdirSync(valDir)
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
    const content = readFileSync(srcPath, 'utf8')
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
  printDeployReceipt(valName, valId, receipts)

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
  console.log(`Update walkthrough.json: "commentBackend": "${publicUrl}"`)
}

/**
 * Minimal .env parser — handles KEY=VALUE lines, # comments, and
 * surrounding quotes. Does not handle multi-line or escape sequences;
 * for our use case (a few API tokens), that's fine.
 */
function loadDotEnv(filePath: string): void {
  const text = readFileSync(filePath, 'utf8')
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
 * `pnpm walkthrough token <set|clear|status>` — manage the Val Town
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
      console.log('  pnpm walkthrough token set')
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
          'Run `pnpm walkthrough token set` with no args and paste when prompted,\n' +
          'or pipe the token on stdin (e.g. `pbpaste | pnpm walkthrough token set`).\n' +
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
          '       pnpm walkthrough token set\n' +
          '     then paste the token at the prompt and press Enter.\n' +
          "     NOTE: Claude Code's `!` shell prefix does not attach a TTY,\n" +
          "     so the prompt can't read input — run this in your OWN terminal.\n" +
          '\n' +
          "  2. Piped from clipboard (works inside Claude's `!` prefix):\n" +
          '       pbpaste | pnpm walkthrough token set       (macOS)\n' +
          '       xclip -selection clipboard -o | pnpm walkthrough token set   (Linux)\n' +
          '       Get-Clipboard | pnpm walkthrough token set (Windows PowerShell)\n' +
          '\n' +
          '  3. Piped from a file (short-lived):\n' +
          '       cat /path/to/token.txt | pnpm walkthrough token set\n' +
          '       shred -u /path/to/token.txt   # remove it afterwards\n' +
          '\n' +
          'Do NOT pass the token as a command-line argument — it leaks\n' +
          'into shell history and process listings.',
      )
    }
    gitCredentialWrite(token)
    console.log(`Stored via: ${helper}`)
    console.log('To verify: `pnpm walkthrough token status`.')
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
 * `pnpm walkthrough doctor` — reads external-tools.json and reports
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
    readFileSync(manifestPath, 'utf8'),
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
    'All listed tools are optional — the walkthrough script falls back when they are absent.',
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
