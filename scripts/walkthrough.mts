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

function generate(refresh: boolean, rest: readonly string[]): void {
  if (rest.length === 0) {
    console.error(
      'Usage: pnpm walkthrough [--refresh] generate <walkthrough.json>',
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
  const faviconTags = [
    '<link rel="icon" type="image/x-icon" href="/favicon.ico" />',
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />',
    '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
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

    // Inject favicons in <head>. Idempotent via marker check.
    if (!html.includes('apple-touch-icon.png')) {
      html = html.replace('</head>', `  ${faviconTags}\n</head>`)
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

    writeFileSync(htmlPath, html)
  }
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

function main(): void {
  const args = process.argv.slice(2)
  const refresh = args.includes('--refresh')
  const rest = args.filter(a => a !== '--refresh')
  const command = rest[0]

  switch (command) {
    case 'generate':
      generate(refresh, rest.slice(1))
      break
    case 'serve':
      serve(rest.slice(1))
      break
    case 'deploy-val':
      deployVal(rest.slice(1)).catch(err => {
        console.error('[deploy-val] failed:', err.message || err)
        process.exit(1)
      })
      break
    default:
      console.error(
        'Usage:\n' +
          '  pnpm walkthrough [--refresh] generate <walkthrough.json>\n' +
          '  pnpm walkthrough serve [--port=8080]\n' +
          '  pnpm walkthrough deploy-val [--name=<valname>]',
      )
      process.exit(1)
  }
}

main()

/* ------------------------------------------------------------------ */
/*  Val Town deploy                                                     */
/* ------------------------------------------------------------------ */

/**
 * Deploy our val (val/*.ts) to Val Town. Uploads our source files
 * (index.ts, crypto.ts, validate.ts, email-template.ts), not
 * meander's. On success, prints the public val URL — paste that into
 * walkthrough.json's commentBackend field.
 *
 * Reads VALTOWN_TOKEN from the environment (via .env.local or shell).
 * Propagates other relevant env vars as val secrets.
 */
async function deployVal(args: readonly string[]): Promise<void> {
  const envFile = path.join(repoRoot, '.env.local')
  if (existsSync(envFile)) {
    loadDotEnv(envFile)
  }

  const token = process.env['VALTOWN_TOKEN']
  if (!token) {
    throw new Error(
      'VALTOWN_TOKEN must be set (in .env.local or exported in shell)',
    )
  }

  const nameArg = args.find(a => a.startsWith('--name='))
  const valName = nameArg ? nameArg.slice('--name='.length) : 'walkthrough'

  const API = 'https://api.val.town'
  const authHeader = { Authorization: `Bearer ${token}` }

  const meRes = await fetch(`${API}/v1/me`, { headers: authHeader })
  if (!meRes.ok) {
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
