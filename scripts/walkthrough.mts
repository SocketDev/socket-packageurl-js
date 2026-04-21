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
    default:
      console.error(
        'Usage:\n' +
          '  pnpm walkthrough [--refresh] generate <walkthrough.json>\n' +
          '  pnpm walkthrough serve [--port=8080]',
      )
      process.exit(1)
  }
}

main()
