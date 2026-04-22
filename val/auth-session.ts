/**
 * @fileoverview Session endpoints — /auth/check and /auth/logout.
 *
 * Both operate on an existing JWT. `requireAuth` middleware has
 * already validated the bearer token by the time our handler runs;
 * we just echo info (check) or revoke it (logout).
 */

import type { Hono, Next, Context } from 'npm:hono@4.12.14'
import { sqlite } from 'https://esm.town/v/std/sqlite/main.ts'

import { verifyJwt } from './crypto.ts'
import { ensureDb } from './db.ts'
import { audit } from './audit.ts'
import { jsonError } from './util.ts'
import type { AppEnv } from './types.ts'

export const registerAuthSession = (
  app: Hono<AppEnv>,
  hmacKey: CryptoKey,
  requireAuth: (c: Context<AppEnv>, n: Next) => Promise<Response | void>,
): void => {
  // Client-facing "am I still logged in?" probe. The middleware
  // already verified the JWT; if control reaches the handler, yes.
  app.get('/auth/check', requireAuth, c => {
    const auth = c.get('auth')
    return c.json({ ok: true, email: auth.email })
  })

  // Revoke this JWT's jti so a leaked token can't be re-used. The
  // revoked_jtis table is checked on every protected request (via
  // isJtiRevoked in middleware), and rows expire with their token.
  app.post('/auth/logout', requireAuth, async c => {
    await ensureDb
    const auth = c.get('auth')
    // Re-read the raw Authorization header. We need the original jti
    // + exp to write the revocation row — those live in the JWT
    // payload, not in c.get('auth') which only exposes email + jti.
    // (The middleware could expose exp too, but the verify call here
    // is cheap and keeps the middleware contract narrow.)
    const header = c.req.header('authorization') || ''
    const match = header.match(/^Bearer\s+(.+)$/i)
    if (!match) {
      return jsonError(c, 401, 'unauthorized')
    }
    const payload = await verifyJwt(hmacKey, match[1])
    if (!payload) {
      return jsonError(c, 401, 'unauthorized')
    }
    // INSERT OR IGNORE: if the jti is already revoked (double-logout,
    // network retry) we just treat it as a no-op.
    await sqlite.execute({
      sql: 'INSERT OR IGNORE INTO revoked_jtis (jti, expires_at) VALUES (:jti, :exp)',
      args: { jti: payload.jti, exp: payload.exp },
    })
    await audit(c, 'logout', { actor: auth.email, success: true })
    return c.json({ ok: true })
  })
}
