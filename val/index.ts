/**
 * @fileoverview Socket walkthrough comment backend — HTTP entry point.
 *
 * Composes modules:
 *   config          — env vars + constants
 *   crypto          — JWT sign/verify, sha256, code generation
 *   validate        — input validators (email, slug, UUID, comment body)
 *   email-template  — login-code email HTML + text
 *   db              — SQLite schema + retention cleanup
 *   audit           — audit-log writer
 *   middleware      — request-ID, security headers, CORS, requireAuth
 *   auth-routes     — /auth/request, /verify, /check, /logout
 *   comment-routes  — /:slug/api/comments/*
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

import { Hono } from 'npm:hono@4.12.14'
import { sqlite } from 'https://esm.town/v/std/sqlite/main.ts'

import { importHmacKey } from './crypto.ts'
import { JWT_SIGNING_KEY } from './config.ts'
import {
  corsMiddleware,
  makeRequireAuth,
  requestIdMiddleware,
  securityHeadersMiddleware,
} from './middleware.ts'
import { registerAuthRoutes } from './auth-routes.ts'
import { registerCommentRoutes } from './comment-routes.ts'
import type { AppEnv } from './types.ts'

const hmacKey = await importHmacKey(JWT_SIGNING_KEY).catch(err => {
  console.error('[val] hmac key import failed', err)
  throw err
})
const requireAuth = makeRequireAuth(hmacKey)

const app = new Hono<AppEnv>()

// Middleware order: request-ID first (so downstream sees reqId + ip),
// then security headers (applied via try/finally), then CORS.
app.use('*', requestIdMiddleware)
app.use('*', securityHeadersMiddleware)
app.use('*', corsMiddleware)

app.get('/health', async c => {
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

registerAuthRoutes(app, hmacKey, requireAuth)
registerCommentRoutes(app, requireAuth)

export default app.fetch
