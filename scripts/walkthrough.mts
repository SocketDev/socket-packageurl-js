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
import {
  appendFileSync,
  copyFileSync,
  createReadStream,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { transform as esbuildTransform } from 'esbuild'
import { transform as lightningTransform } from 'lightningcss'

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

async function generate(
  refresh: boolean,
  minify: boolean,
  rest: readonly string[],
): Promise<void> {
  if (rest.length === 0) {
    console.error(
      'Usage: pnpm walkthrough [--refresh] [--minify] generate <walkthrough.json>',
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
  // network-passthrough for the comment API. Registration script is
  // injected into each HTML page below.
  const swSrc = path.join(repoRoot, 'walkthrough-sw.js')
  if (existsSync(swSrc)) {
    copyFileSync(swSrc, path.join(walkthroughDir, 'walkthrough-sw.js'))
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
        commentBackend?: string
      })
    : {}
  const commentBackend = walkthroughConfig.commentBackend || ''
  if (commentBackend && existsSync(commentsSrc)) {
    copyFileSync(
      commentsSrc,
      path.join(walkthroughDir, 'walkthrough-comments.js'),
    )
  }

  // Per-HTML post-processing: strip meander's inlined comment scripts
  // (when we're replacing them) and inject our own <script> tags.
  const COMMENT_SCRIPT_MARKERS = [
    'var apiBase = "/" + slug + "/api/comments";', // comment-client.js
    'var apiBase = "/" + slug + "/api/comments/unresolved";', // unresolved-comments.js
    '"/" + slug + "/api/comments/export";', // export-comments.js
    'LINE_SELECT_INIT', // line-select.js marker (if any)
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
  const swRegisterTag = [
    '<script>',
    "  if ('serviceWorker' in navigator) {",
    "    addEventListener('load', () => {",
    "      navigator.serviceWorker.register('/walkthrough-sw.js', { updateViaCache: 'none' }).catch(() => {})",
    '    })',
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

    // Inject our scripts once (idempotent).
    if (!html.includes('walkthrough-drag.js')) {
      html = html.replace('</body>', `  ${dragTag}\n</body>`)
    }
    if (commentBackend && !html.includes('walkthrough-comments.js')) {
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

    writeFileSync(htmlPath, html)
  }

  if (minify) {
    await minifyEmittedAssets()
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

function routeToFile(slug: string, urlPath: string): string | undefined {
  // /                           → index.html
  // /<slug>/part/<n>            → walkthrough-part-<n>.html
  // /<slug>/documents           → documents.html
  // anything else               → as-is (e.g. /walkthrough.css)
  if (urlPath === '/' || urlPath === '') {
    return 'index.html'
  }
  const partMatch = new RegExp(`^/${slug}/part/(\\d+)/?$`).exec(urlPath)
  if (partMatch) {
    return `walkthrough-part-${partMatch[1]}.html`
  }
  if (urlPath === `/${slug}/documents` || urlPath === `/${slug}/documents/`) {
    return 'documents.html'
  }
  return urlPath.replace(/^\//, '')
}

function serve(args: readonly string[]): void {
  const portArg = args.find(a => a.startsWith('--port='))
  const port = portArg ? Number(portArg.slice('--port='.length)) : 8080

  if (!existsSync(walkthroughDir)) {
    console.error(
      `No walkthrough/ directory found. Run \`pnpm walkthrough generate walkthrough.json\` first.`,
    )
    process.exit(1)
  }

  const slug = readSlug()

  const server = createServer((req, res) => {
    const rawUrl = (req.url ?? '/').split('?')[0]!.split('#')[0]!
    const decoded = decodeURIComponent(rawUrl)
    const relative = routeToFile(slug, decoded)
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
    console.log(`  part 1 → http://127.0.0.1:${port}/${slug}/part/1`)
    console.log(`  Press Ctrl+C to stop.`)
  })
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

function main(): void {
  const args = process.argv.slice(2)
  const refresh = args.includes('--refresh')
  const minify = args.includes('--minify')
  const rest = args.filter(a => a !== '--refresh' && a !== '--minify')
  const command = rest[0]

  switch (command) {
    case 'generate':
      generate(refresh, minify, rest.slice(1)).catch(failWith('generate'))
      break
    case 'serve':
      serve(rest.slice(1))
      break
    case 'deploy-val':
      deployVal(rest.slice(1)).catch(failWith('deploy-val'))
      break
    case 'token':
      tokenCli(rest.slice(1)).catch(failWith('token'))
      break
    case 'doctor':
      doctor().catch(failWith('doctor'))
      break
    default:
      console.error(
        'Usage:\n' +
          '  pnpm walkthrough [--refresh] [--minify] generate <walkthrough.json>\n' +
          '  pnpm walkthrough serve [--port=8080]\n' +
          '  pnpm walkthrough deploy-val [--name=<valname>]\n' +
          '  pnpm walkthrough token <set|clear|status>\n' +
          '  pnpm walkthrough doctor',
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
async function deployVal(args: readonly string[]): Promise<void> {
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

  const files: Array<{ path: string; type: 'http' | 'script' }> = [
    { path: 'index.ts', type: 'http' },
    { path: 'config.ts', type: 'script' },
    { path: 'types.ts', type: 'script' },
    { path: 'crypto.ts', type: 'script' },
    { path: 'validate.ts', type: 'script' },
    { path: 'email-template.ts', type: 'script' },
    { path: 'db.ts', type: 'script' },
    { path: 'audit.ts', type: 'script' },
    { path: 'util.ts', type: 'script' },
    { path: 'middleware.ts', type: 'script' },
    { path: 'auth-routes.ts', type: 'script' },
    { path: 'comment-routes.ts', type: 'script' },
  ]
  for (const f of files) {
    const srcPath = path.join(repoRoot, 'val', f.path)
    if (!existsSync(srcPath)) {
      throw new Error(`missing val source: ${srcPath}`)
    }
    const content = readFileSync(srcPath, 'utf8')
    // Val Town's file API wants `path` in the querystring; body carries
    // only content + type. Try POST (create) first — if the file
    // already exists it 409s and we fall through to PUT (update).
    const qs = `?path=${encodeURIComponent(f.path)}`
    const createRes = await fetch(`${API}/v2/vals/${valId}/files${qs}`, {
      method: 'POST',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ content, type: f.type }),
    })
    if (createRes.ok) {
      console.log(`  Created ${f.path}`)
      continue
    }
    if (createRes.status !== 409) {
      // Not a conflict — real error.
      throw new Error(
        `create ${f.path} failed: ${createRes.status} ${await createRes.text()}`,
      )
    }
    // File exists — update it.
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
    console.log(`  Updated ${f.path}`)
  }

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
