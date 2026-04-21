/**
 * @fileoverview HTTP middleware — request-ID, security headers, CORS,
 * and the requireAuth gate used by every protected route.
 */

import type { Context, Next } from 'npm:hono@4'
import { cors } from 'npm:hono@4/cors'
import { verifyJwt } from './crypto.ts'
import { isJtiRevoked } from './db.ts'
import { ALLOWED_ORIGINS } from './config.ts'
import { getIp, jsonError } from './util.ts'
import type { AppEnv } from './types.ts'

// Accept an already-imported HMAC key from the caller — keeps this
// module free of top-level I/O.
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
      return jsonError(c, 401, 'unauthorized', 'revoked')
    }
    c.set('auth', { email: payload.email, jti: payload.jti })
    await next()
  }

export const requestIdMiddleware = async (c: Context<AppEnv>, next: Next) => {
  const reqId =
    c.req.header('x-request-id')?.slice(0, 64) || crypto.randomUUID()
  c.set('reqId', reqId)
  c.set('ip', getIp(c))
  await next()
  c.res.headers.set('x-request-id', reqId)
}

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

export const corsMiddleware = cors({
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
})
