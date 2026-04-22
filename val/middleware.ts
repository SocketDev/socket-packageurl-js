/**
 * @fileoverview HTTP middleware — request-ID, security headers, CORS,
 * and the requireAuth gate used by every protected route.
 */

import type { Context, Next } from 'npm:hono@4.12.14'
import { cors } from 'npm:hono@4.12.14/cors'
import { verifyJwt } from './crypto.ts'
import { isJtiRevoked } from './db.ts'
import { ALLOWED_ORIGINS } from './config.ts'
import { getIp, jsonError } from './util.ts'
import type { AppEnv } from './types.ts'

// requireAuth is a middleware factory — takes an already-imported
// HMAC key (so this module has no top-level I/O) and returns a Hono
// middleware. The closure gate runs on every protected route:
//   1. Pull a Bearer token out of the Authorization header.
//   2. Verify the JWT signature + expiry via verifyJwt.
//   3. Check the token's jti hasn't been revoked (logout, admin).
//   4. Stash the email + jti on the Hono context so handlers can
//      read c.get('auth') without redoing the work.
// Any failure returns 401 and stops the middleware chain.
export const makeRequireAuth =
  (hmacKey: CryptoKey) =>
  async (c: Context<AppEnv>, next: Next): Promise<Response | void> => {
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
      // Distinct `code: 'revoked'` so the client can distinguish
      // "token expired — sign in again" from "token was revoked
      // (you logged out in another tab) — sign in again" if we ever
      // want to show different UX.
      return jsonError(c, 401, 'unauthorized', 'revoked')
    }
    c.set('auth', { email: payload.email, jti: payload.jti })
    await next()
  }

// Trust the client's x-request-id if provided (for tracing across
// multiple services), otherwise mint a fresh UUID. Capped at 64 chars
// so a misbehaving client can't pollute our logs with a giant string.
// We echo it back on the response so the client can correlate too.
export const requestIdMiddleware = async (c: Context<AppEnv>, next: Next) => {
  const reqId =
    c.req.header('x-request-id')?.slice(0, 64) || crypto.randomUUID()
  c.set('reqId', reqId)
  c.set('ip', getIp(c))
  await next()
  c.res.headers.set('x-request-id', reqId)
}

// Standard hardening headers on every response:
//   nosniff         — stop browsers from guessing content types
//   referrer-policy — leak the minimum needed when users click out
//   x-frame-options — defense in depth against clickjacking (we also
//                     set CSP frame-ancestors on the static site)
// Auth endpoints also get no-store so credentials never land in a
// browser cache. Wrapped in try/finally so the headers apply even
// when a handler throws.
export const securityHeadersMiddleware = async (
  c: Context<AppEnv>,
  next: Next,
) => {
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
}

// CORS allowlist. Origin callback returns the request's origin when
// it's in ALLOWED_ORIGINS, null otherwise. Hono omits the ACAO header
// on null, which correctly blocks cross-origin browsers. Credentials:
// false — we use Bearer tokens, not cookies, so no withCredentials
// path. Preflight cached for 10 min (maxAge:600) so a chatty SPA
// doesn't re-OPTIONS every request.
export const corsMiddleware = cors({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  origin: (origin =>
    origin && ALLOWED_ORIGINS.has(origin) ? origin : null) as any,
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['authorization', 'content-type', 'x-request-id'],
  exposeHeaders: ['x-request-id'],
  credentials: false,
  maxAge: 600,
})
