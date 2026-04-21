/**
 * @fileoverview Socket walkthrough comment backend (Val Town).
 *
 * HTTP entry point wiring pure modules (crypto, validate, email-template) to
 * Val Town's SQLite and email primitives. Pure modules are testable under
 * Node via node:test; this file is Val Town-runtime only.
 *
 * Endpoints:
 *   POST /auth/request { email }            → emails a 6-digit code
 *   POST /auth/verify  { email, code }      → returns a 1-day JWT
 *   GET  /auth/check   (Bearer <jwt>)       → { ok, email }
 *   POST /auth/logout  (Bearer <jwt>)       → revokes current JWT
 *   GET  /:slug/api/comments?part=N         → list (JWT)
 *   POST /:slug/api/comments                → create (JWT)
 *   PATCH  /:slug/api/comments/:id          → resolve/unresolve (JWT + author)
 *   DELETE /:slug/api/comments/:id          → delete (JWT + author)
 *   GET  /:slug/api/comments/unresolved     → list open (JWT)
 *   GET  /:slug/api/comments/export         → download JSON (JWT)
 *   GET  /health                            → liveness + DB probe
 *
 * Env vars (Val Town secrets):
 *   JWT_SIGNING_KEY         ≥ 32 raw bytes, required
 *   ALLOWED_EMAIL_DOMAIN    default "socket.dev"
 *   ALLOWED_ORIGINS_PROD    comma-separated, default "https://socketdev.github.io"
 *   ALLOWED_ORIGINS_DEV     comma-separated, active when NODE_ENV=development
 *   TRUSTED_PROXY_HOPS      default 1 (Val Town edge)
 */

import { Hono, type Context, type Next } from 'npm:hono@4'
import { cors } from 'npm:hono@4/cors'
import { sqlite } from 'https://esm.town/v/std/sqlite/main.ts'
import { email as sendEmail } from 'https://esm.town/v/std/email'

import {
  generateCode,
  importHmacKey,
  sha256Hex,
  signJwt,
  verifyJwt,
  type JwtPayload,
} from './crypto.ts'
import {
  emailDomain,
  extractClientIp,
  isValidEmail,
  isValidSlug,
  isValidUuid,
  isValidCode,
  normalizeEmail,
  scrubIp,
  validateCommentInput,
} from './validate.ts'
import { renderLoginEmail, renderLoginEmailText } from './email-template.ts'

// eslint-disable-next-line @typescript-eslint/no-namespace
declare const Deno: { env: { get(name: string): string | undefined } }

/* ------------------------------------------------------------------ */
/*  Config                                                              */
/* ------------------------------------------------------------------ */

const ALLOWED_EMAIL_DOMAIN = (
  Deno.env.get('ALLOWED_EMAIL_DOMAIN') || 'socket.dev'
).toLowerCase()
const JWT_SIGNING_KEY = Deno.env.get('JWT_SIGNING_KEY') || ''
const ENVIRONMENT = (Deno.env.get('NODE_ENV') || 'production').toLowerCase()
const TRUSTED_PROXY_HOPS = Math.max(
  1,
  Number.parseInt(Deno.env.get('TRUSTED_PROXY_HOPS') || '1', 10) || 1,
)

const PROD_ORIGINS = (
  Deno.env.get('ALLOWED_ORIGINS_PROD') || 'https://socketdev.github.io'
)
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
const DEV_ORIGINS =
  ENVIRONMENT === 'development'
    ? (
        Deno.env.get('ALLOWED_ORIGINS_DEV') ||
        'http://127.0.0.1:8080,http://localhost:8080'
      )
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : []
const ALLOWED_ORIGINS = new Set([...PROD_ORIGINS, ...DEV_ORIGINS])

const CODE_TTL_SECONDS = 60 * 10
const SESSION_TTL_SECONDS = 60 * 60 * 24
const CODE_RATE_LIMIT_PER_IP = 20
const VERIFY_RATE_LIMIT_PER_EMAIL = 10
const VERIFY_WINDOW_SECONDS = 10 * 60
const MAX_BODY_BYTES_AUTH = 4 * 1024
const MAX_BODY_BYTES_COMMENT = 64 * 1024
const AUDIT_RETENTION_SECONDS = 60 * 60 * 24 * 90 // 90 days
const LOGIN_CODE_RETENTION_SECONDS = 60 * 60 * 24

if (!JWT_SIGNING_KEY) {
  throw new Error(
    'JWT_SIGNING_KEY env var must be set ' +
      '(generate with `openssl rand -base64 32`)',
  )
}

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

type AuthContext = { email: string; jti: string }

type CommentRow = {
  id: string
  slug: string
  part: number
  file: string
  line_from: number
  line_to: number
  author: string
  body: string
  parent_id: string | null
  resolved: number
  created_at: string
}

type AppEnv = {
  Variables: {
    auth: AuthContext
    reqId: string
    ip: string
  }
}

type HttpStatus = 400 | 401 | 403 | 404 | 429 | 500 | 503

/* ------------------------------------------------------------------ */
/*  Crypto key                                                          */
/* ------------------------------------------------------------------ */

const hmacKey = await importHmacKey(JWT_SIGNING_KEY).catch(err => {
  console.error('[val] hmac key import failed', err)
  throw err
})

/* ------------------------------------------------------------------ */
/*  DB                                                                  */
/* ------------------------------------------------------------------ */

const ensureDb = (async () => {
  try {
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS login_codes (
        email      TEXT NOT NULL,
        code_hash  TEXT NOT NULL,
        ip         TEXT,
        expires_at INTEGER NOT NULL,
        consumed   INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      )
    `)
    await sqlite.execute(
      `CREATE INDEX IF NOT EXISTS idx_login_codes_email ON login_codes(email, created_at)`,
    )
    await sqlite.execute(
      `CREATE INDEX IF NOT EXISTS idx_login_codes_ip ON login_codes(ip, created_at)`,
    )
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS verify_attempts (
        email      TEXT NOT NULL,
        ip         TEXT,
        success    INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      )
    `)
    await sqlite.execute(
      `CREATE INDEX IF NOT EXISTS idx_verify_email ON verify_attempts(email, created_at)`,
    )
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS comments (
        id         TEXT PRIMARY KEY,
        slug       TEXT NOT NULL,
        part       INTEGER NOT NULL,
        file       TEXT NOT NULL,
        line_from  INTEGER NOT NULL,
        line_to    INTEGER NOT NULL,
        author     TEXT NOT NULL,
        body       TEXT NOT NULL,
        parent_id  TEXT,
        resolved   INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    await sqlite.execute(
      `CREATE INDEX IF NOT EXISTS idx_comments_slug_part ON comments(slug, part)`,
    )
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS revoked_jtis (
        jti        TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      )
    `)
    await sqlite.execute(
      `CREATE INDEX IF NOT EXISTS idx_revoked_jtis_exp ON revoked_jtis(expires_at)`,
    )
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id         TEXT PRIMARY KEY,
        ts         INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        actor      TEXT,
        action     TEXT NOT NULL,
        target     TEXT,
        slug       TEXT,
        ip_prefix  TEXT,
        req_id     TEXT,
        success    INTEGER NOT NULL,
        meta       TEXT
      )
    `)
    await sqlite.execute(
      `CREATE INDEX IF NOT EXISTS idx_audit_actor_ts ON audit_log(actor, ts)`,
    )
    await sqlite.execute(
      `CREATE INDEX IF NOT EXISTS idx_audit_action_ts ON audit_log(action, ts)`,
    )
  } catch (err) {
    console.error('[val] ensureDb failed', err)
    throw err
  }
})()

/* ------------------------------------------------------------------ */
/*  Utilities                                                           */
/* ------------------------------------------------------------------ */

const now = (): number => Math.floor(Date.now() / 1000)

const getIp = (c: Context): string =>
  extractClientIp(
    {
      get: name =>
        name.toLowerCase() === 'x-forwarded-for'
          ? c.req.header('x-forwarded-for') || null
          : c.req.header(name) || null,
    },
    TRUSTED_PROXY_HOPS,
  )

const readBoundedJson = async <T>(
  c: Context,
  maxBytes: number,
): Promise<T | null> => {
  try {
    const text = await c.req.text()
    if (text.length > maxBytes) {
      return null
    }
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

const jsonError = (
  c: Context,
  status: HttpStatus,
  error: string,
  code?: string,
) => c.json(code ? { error, code } : { error }, status)

const cleanOldRows = async (): Promise<void> => {
  const auditCutoff = now() - AUDIT_RETENTION_SECONDS
  const authCutoff = now() - LOGIN_CODE_RETENTION_SECONDS
  try {
    await sqlite.execute({
      sql: 'DELETE FROM login_codes WHERE created_at < :c',
      args: { c: authCutoff },
    })
    await sqlite.execute({
      sql: 'DELETE FROM verify_attempts WHERE created_at < :c',
      args: { c: authCutoff },
    })
    await sqlite.execute({
      sql: 'DELETE FROM revoked_jtis WHERE expires_at < :c',
      args: { c: now() },
    })
    await sqlite.execute({
      sql: 'DELETE FROM audit_log WHERE ts < :c',
      args: { c: auditCutoff },
    })
  } catch (err) {
    console.warn('[val] cleanup failed', err)
  }
}

const audit = async (
  c: Context<AppEnv>,
  action: string,
  opts: {
    actor?: string
    target?: string
    slug?: string
    success: boolean
    meta?: Record<string, unknown>
  },
): Promise<void> => {
  try {
    await sqlite.execute({
      sql: 'INSERT INTO audit_log (id, actor, action, target, slug, ip_prefix, req_id, success, meta) VALUES (:id, :actor, :action, :target, :slug, :ipPrefix, :reqId, :success, :meta)',
      args: {
        id: crypto.randomUUID(),
        actor: opts.actor ?? null,
        action,
        target: opts.target ?? null,
        slug: opts.slug ?? null,
        ipPrefix: scrubIp(c.get('ip')),
        reqId: c.get('reqId'),
        success: opts.success ? 1 : 0,
        meta: opts.meta ? JSON.stringify(opts.meta) : null,
      },
    })
  } catch (err) {
    console.warn('[val] audit write failed', err)
  }
}

const isJtiRevoked = async (jti: string): Promise<boolean> => {
  const r = await sqlite.execute({
    sql: 'SELECT 1 FROM revoked_jtis WHERE jti = :jti AND expires_at > :now LIMIT 1',
    args: { jti, now: now() },
  })
  return r.rows.length > 0
}

/* ------------------------------------------------------------------ */
/*  Middleware                                                          */
/* ------------------------------------------------------------------ */

const requireAuth = async (
  c: Context<AppEnv>,
  next: Next,
): Promise<Response | void> => {
  const header = c.req.header('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    return jsonError(c, 401, 'unauthorized')
  }
  const payload = await verifyJwt(hmacKey, match[1])
  if (!payload) {
    return jsonError(c, 401, 'unauthorized')
  }
  if (await isJtiRevoked(payload.jti)) {
    return jsonError(c, 401, 'unauthorized', 'revoked')
  }
  c.set('auth', { email: payload.email, jti: payload.jti })
  await next()
}

/* ------------------------------------------------------------------ */
/*  App                                                                 */
/* ------------------------------------------------------------------ */

const app = new Hono<AppEnv>()

// Request-ID middleware. Always first so the ID is available for all
// downstream logging and the audit trail.
app.use('*', async (c, next) => {
  const reqId =
    c.req.header('x-request-id')?.slice(0, 64) || crypto.randomUUID()
  c.set('reqId', reqId)
  c.set('ip', getIp(c))
  await next()
  c.res.headers.set('x-request-id', reqId)
})

// Security headers. try/finally so they apply to thrown-handler responses.
app.use('*', async (c, next) => {
  try {
    await next()
  } finally {
    c.res.headers.set('x-content-type-options', 'nosniff')
    c.res.headers.set('referrer-policy', 'strict-origin-when-cross-origin')
    c.res.headers.set('x-frame-options', 'DENY')
    if (c.req.path.startsWith('/auth/')) {
      c.res.headers.set('cache-control', 'no-store')
    }
  }
})

app.use(
  '*',
  cors({
    // Return null to deny (Hono omits the ACAO header, which correctly
    // blocks cross-origin use).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    origin: (origin =>
      origin && ALLOWED_ORIGINS.has(origin) ? origin : null) as any,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['authorization', 'content-type', 'x-request-id'],
    exposeHeaders: ['x-request-id'],
    credentials: false,
    maxAge: 600,
  }),
)

/* ------------------------------------------------------------------ */
/*  Health                                                              */
/* ------------------------------------------------------------------ */

app.get('/health', async c => {
  // DB probe with a timeout so a stuck DB doesn't hang health checks.
  const start = Date.now()
  const probe = sqlite.execute('SELECT 1 AS n')
  const timeout = new Promise<'timeout'>(resolve =>
    setTimeout(() => resolve('timeout'), 2000),
  )
  const winner = await Promise.race([probe, timeout])
  const elapsed = Date.now() - start
  if (winner === 'timeout') {
    return c.json({ ok: false, db: 'timeout', elapsedMs: elapsed }, 503)
  }
  return c.json({ ok: true, db: 'ok', elapsedMs: elapsed })
})

/* ------------------------------------------------------------------ */
/*  Auth routes                                                         */
/* ------------------------------------------------------------------ */

app.post('/auth/request', async c => {
  await ensureDb
  await cleanOldRows()

  const body = await readBoundedJson<{ email?: unknown }>(
    c,
    MAX_BODY_BYTES_AUTH,
  )
  const rawEmail = normalizeEmail(body?.email)
  const emailValid = isValidEmail(rawEmail)
  const domainOk = emailDomain(rawEmail) === ALLOWED_EMAIL_DOMAIN

  const ip = c.get('ip')
  const nowSec = now()
  const windowStart = nowSec - 3600

  const ipCount = await sqlite.execute({
    sql: 'SELECT COUNT(*) AS n FROM login_codes WHERE ip = :ip AND created_at > :since',
    args: { ip, since: windowStart },
  })
  const ipHits = Number((ipCount.rows[0] as { n?: number | bigint })?.n ?? 0)
  const rateLimited = ipHits >= CODE_RATE_LIMIT_PER_IP

  if (emailValid && domainOk && !rateLimited) {
    const code = generateCode()
    const codeHash = await sha256Hex(`${rawEmail}:${code}`)
    const expiresAt = nowSec + CODE_TTL_SECONDS
    await sqlite.execute({
      sql: 'INSERT INTO login_codes (email, code_hash, ip, expires_at) VALUES (:email, :codeHash, :ip, :expiresAt)',
      args: { email: rawEmail, codeHash, ip, expiresAt },
    })
    try {
      // Val Town limits the `from.email` to
      // `<username>.<valname>@valtown.email`; we can control the
      // display name and replyTo. Setting replyTo to security@socket.dev
      // routes "I didn't request this" replies to Socket's security team.
      await sendEmail({
        to: rawEmail,
        from: { name: 'Socket Walkthroughs' },
        replyTo: 'security@socket.dev',
        subject: 'Your Socket walkthrough login code',
        html: renderLoginEmail(code),
        text: renderLoginEmailText(code),
      })
    } catch (err) {
      console.error('[val] email send failed', err)
    }
    await audit(c, 'login_code_sent', {
      actor: rawEmail,
      success: true,
    })
  } else {
    await audit(c, 'login_code_refused', {
      actor: emailValid ? rawEmail : null,
      success: false,
      meta: {
        reason: !emailValid
          ? 'invalid-email'
          : !domainOk
            ? 'domain'
            : 'rate-limit',
      },
    })
  }

  return c.json({ ok: true })
})

app.post('/auth/verify', async c => {
  await ensureDb
  const body = await readBoundedJson<{ email?: unknown; code?: unknown }>(
    c,
    MAX_BODY_BYTES_AUTH,
  )
  const email = normalizeEmail(body?.email)
  const code = typeof body?.code === 'string' ? body.code.trim() : ''

  if (!isValidEmail(email) || !isValidCode(code)) {
    return jsonError(c, 400, 'email and 6-digit code required')
  }

  const nowSec = now()
  const windowStart = nowSec - VERIFY_WINDOW_SECONDS
  const attemptCount = await sqlite.execute({
    sql: 'SELECT COUNT(*) AS n FROM verify_attempts WHERE email = :email AND success = 0 AND created_at > :since',
    args: { email, since: windowStart },
  })
  const attempts = Number(
    (attemptCount.rows[0] as { n?: number | bigint })?.n ?? 0,
  )
  if (attempts >= VERIFY_RATE_LIMIT_PER_EMAIL) {
    await audit(c, 'login_verify_rate_limited', {
      actor: email,
      success: false,
    })
    return jsonError(c, 429, 'too many attempts; try again later', 'rate_limit')
  }

  const codeHash = await sha256Hex(`${email}:${code}`)
  const result = await sqlite.execute({
    sql: 'SELECT rowid FROM login_codes WHERE email = :email AND code_hash = :codeHash AND consumed = 0 AND expires_at > :now ORDER BY created_at DESC LIMIT 1',
    args: { email, codeHash, now: nowSec },
  })
  if (result.rows.length === 0) {
    await sqlite.execute({
      sql: 'INSERT INTO verify_attempts (email, ip, success) VALUES (:email, :ip, 0)',
      args: { email, ip: c.get('ip') },
    })
    await audit(c, 'login_verify_failed', {
      actor: email,
      success: false,
    })
    return jsonError(c, 401, 'invalid or expired code')
  }

  await sqlite.execute({
    sql: 'UPDATE login_codes SET consumed = 1 WHERE rowid = :rowid',
    args: { rowid: (result.rows[0] as { rowid: number }).rowid },
  })
  await sqlite.execute({
    sql: 'INSERT INTO verify_attempts (email, ip, success) VALUES (:email, :ip, 1)',
    args: { email, ip: c.get('ip') },
  })

  const exp = nowSec + SESSION_TTL_SECONDS
  const jti = crypto.randomUUID()
  const jwt = await signJwt(hmacKey, { email, exp, iat: nowSec, jti })
  await audit(c, 'login_success', { actor: email, success: true })
  return c.json({ token: jwt, email, expiresAt: exp })
})

app.get('/auth/check', requireAuth, c => {
  const auth = c.get('auth')
  return c.json({ ok: true, email: auth.email })
})

app.post('/auth/logout', requireAuth, async c => {
  await ensureDb
  const auth = c.get('auth')
  // Read the current JWT to get its exp for revocation-row retention.
  const header = c.req.header('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    return jsonError(c, 401, 'unauthorized')
  }
  const payload = await verifyJwt(hmacKey, match[1])
  if (!payload) {
    return jsonError(c, 401, 'unauthorized')
  }
  await sqlite.execute({
    sql: 'INSERT OR IGNORE INTO revoked_jtis (jti, expires_at) VALUES (:jti, :exp)',
    args: { jti: payload.jti, exp: payload.exp },
  })
  await audit(c, 'logout', { actor: auth.email, success: true })
  return c.json({ ok: true })
})

/* ------------------------------------------------------------------ */
/*  Comment routes                                                      */
/* ------------------------------------------------------------------ */

const rowToComment = (row: CommentRow) => ({
  id: row.id,
  slug: row.slug,
  part: row.part,
  file: row.file,
  lineFrom: row.line_from,
  lineTo: row.line_to,
  author: row.author,
  body: row.body,
  parentId: row.parent_id || null,
  resolved: !!row.resolved,
  createdAt: row.created_at,
})

app.get('/:slug/api/comments/unresolved', requireAuth, async c => {
  await ensureDb
  const slug = c.req.param('slug')
  if (!isValidSlug(slug)) {
    return jsonError(c, 400, 'invalid slug')
  }
  const result = await sqlite.execute({
    sql: "SELECT id, slug, part, file, line_from, line_to, author, body, parent_id, resolved, created_at FROM comments WHERE slug = :slug AND (parent_id IS NULL OR parent_id = '') AND resolved = 0 ORDER BY created_at DESC",
    args: { slug },
  })
  return c.json((result.rows as unknown as CommentRow[]).map(rowToComment))
})

app.get('/:slug/api/comments/export', requireAuth, async c => {
  await ensureDb
  const slug = c.req.param('slug')
  if (!isValidSlug(slug)) {
    return jsonError(c, 400, 'invalid slug')
  }
  const unresolvedOnly = c.req.query('unresolved') === '1'
  const sql = unresolvedOnly
    ? 'SELECT id, slug, part, file, line_from, line_to, author, body, parent_id, resolved, created_at FROM comments WHERE slug = :slug AND resolved = 0 ORDER BY created_at ASC'
    : 'SELECT id, slug, part, file, line_from, line_to, author, body, parent_id, resolved, created_at FROM comments WHERE slug = :slug ORDER BY created_at ASC'
  const result = await sqlite.execute({ sql, args: { slug } })
  return c.json({
    slug,
    exportedAt: new Date().toISOString(),
    comments: (result.rows as unknown as CommentRow[]).map(rowToComment),
  })
})

app.get('/:slug/api/comments', requireAuth, async c => {
  await ensureDb
  const slug = c.req.param('slug')
  if (!isValidSlug(slug)) {
    return jsonError(c, 400, 'invalid slug')
  }
  const part = c.req.query('part')
  if (!part) {
    return jsonError(c, 400, 'part query parameter required')
  }
  const partInt = Number.parseInt(part, 10)
  if (!Number.isFinite(partInt) || partInt < 1 || partInt > 10_000) {
    return jsonError(c, 400, 'invalid part')
  }
  const result = await sqlite.execute({
    sql: 'SELECT id, slug, part, file, line_from, line_to, author, body, parent_id, resolved, created_at FROM comments WHERE slug = :slug AND part = :part ORDER BY created_at ASC',
    args: { slug, part: partInt },
  })
  return c.json((result.rows as unknown as CommentRow[]).map(rowToComment))
})

app.post('/:slug/api/comments', requireAuth, async c => {
  await ensureDb
  const slug = c.req.param('slug')
  if (!isValidSlug(slug)) {
    return jsonError(c, 400, 'invalid slug')
  }
  const auth = c.get('auth')
  const body = await readBoundedJson<Record<string, unknown>>(
    c,
    MAX_BODY_BYTES_COMMENT,
  )
  if (!body) {
    return jsonError(c, 400, 'invalid or too-large body')
  }
  const v = validateCommentInput(body)
  if (!v.ok) {
    return jsonError(c, 400, v.error)
  }

  const author = auth.email
  const id = crypto.randomUUID()
  await sqlite.execute({
    sql: 'INSERT INTO comments (id, slug, part, file, line_from, line_to, author, body, parent_id) VALUES (:id, :slug, :part, :file, :lineFrom, :lineTo, :author, :body, :parentId)',
    args: {
      id,
      slug,
      part: v.value.part,
      file: v.value.file,
      lineFrom: v.value.lineFrom,
      lineTo: v.value.lineTo,
      author,
      body: v.value.body,
      parentId: v.value.parentId,
    },
  })

  await audit(c, 'comment_create', {
    actor: author,
    target: id,
    slug,
    success: true,
  })

  return c.json(
    {
      id,
      slug,
      part: v.value.part,
      file: v.value.file,
      lineFrom: v.value.lineFrom,
      lineTo: v.value.lineTo,
      author,
      body: v.value.body,
      parentId: v.value.parentId,
      resolved: false,
      createdAt: new Date().toISOString(),
    },
    201,
  )
})

app.patch('/:slug/api/comments/:id', requireAuth, async c => {
  await ensureDb
  const slug = c.req.param('slug')
  const id = c.req.param('id')
  if (!isValidSlug(slug) || !isValidUuid(id)) {
    return jsonError(c, 400, 'invalid slug or id')
  }
  const auth = c.get('auth')
  const body = await readBoundedJson<{ resolved?: unknown }>(
    c,
    MAX_BODY_BYTES_AUTH,
  )
  if (!body || typeof body.resolved !== 'boolean') {
    return jsonError(c, 400, 'resolved (boolean) required')
  }
  const existing = await sqlite.execute({
    sql: 'SELECT author FROM comments WHERE id = :id AND slug = :slug',
    args: { id, slug },
  })
  if (existing.rows.length === 0) {
    return jsonError(c, 404, 'not found')
  }
  if ((existing.rows[0] as { author: string }).author !== auth.email) {
    await audit(c, 'comment_resolve_forbidden', {
      actor: auth.email,
      target: id,
      slug,
      success: false,
    })
    return jsonError(c, 403, 'forbidden')
  }
  await sqlite.execute({
    sql: 'UPDATE comments SET resolved = :resolved WHERE id = :id',
    args: { id, resolved: body.resolved ? 1 : 0 },
  })
  await audit(c, body.resolved ? 'comment_resolve' : 'comment_unresolve', {
    actor: auth.email,
    target: id,
    slug,
    success: true,
  })
  return c.json({ ok: true })
})

app.delete('/:slug/api/comments/:id', requireAuth, async c => {
  await ensureDb
  const slug = c.req.param('slug')
  const id = c.req.param('id')
  if (!isValidSlug(slug) || !isValidUuid(id)) {
    return jsonError(c, 400, 'invalid slug or id')
  }
  const auth = c.get('auth')
  const existing = await sqlite.execute({
    sql: 'SELECT author FROM comments WHERE id = :id AND slug = :slug',
    args: { id, slug },
  })
  if (existing.rows.length === 0) {
    return jsonError(c, 404, 'not found')
  }
  if ((existing.rows[0] as { author: string }).author !== auth.email) {
    await audit(c, 'comment_delete_forbidden', {
      actor: auth.email,
      target: id,
      slug,
      success: false,
    })
    return jsonError(c, 403, 'forbidden')
  }
  await sqlite.execute({
    sql: 'DELETE FROM comments WHERE id = :id',
    args: { id },
  })
  await audit(c, 'comment_delete', {
    actor: auth.email,
    target: id,
    slug,
    success: true,
  })
  return c.json({ ok: true })
})

export default app.fetch
