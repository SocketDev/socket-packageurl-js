/**
 * @fileoverview POST /auth/verify — step 2 of email-login.
 *
 * User submits the email + the 6-digit code they received. We check
 * the hash matches a pending login_codes row that hasn't expired or
 * been used yet. If so, we mint a JWT and mark the code consumed so
 * it can't be re-used.
 */

import type { Hono } from 'npm:hono@4.12.14'
import { sqlite } from 'https://esm.town/v/std/sqlite/main.ts'

import { sha256Hex, signJwt } from './crypto.ts'
import { isValidCode, isValidEmail, normalizeEmail } from './validate.ts'
import {
  MAX_BODY_BYTES_AUTH,
  SESSION_TTL_SECONDS,
  VERIFY_RATE_LIMIT_PER_EMAIL,
  VERIFY_WINDOW_SECONDS,
} from './config.ts'
import { ensureDb } from './db.ts'
import { audit } from './audit.ts'
import { jsonError, now, readBoundedJson } from './util.ts'
import type { AppEnv } from './types.ts'

export const registerAuthVerify = (
  app: Hono<AppEnv>,
  hmacKey: CryptoKey,
): void => {
  app.post('/auth/verify', async c => {
    await ensureDb
    const body = await readBoundedJson<{ email?: unknown; code?: unknown }>(
      c,
      MAX_BODY_BYTES_AUTH,
    )
    const email = normalizeEmail(body?.email)
    const code = typeof body?.code === 'string' ? body.code.trim() : ''

    // Shape check first. isValidCode rejects anything that isn't
    // exactly 6 digits. We deliberately return the same 400 for both
    // bad email and bad code so attackers can't distinguish.
    if (!isValidEmail(email) || !isValidCode(code)) {
      return jsonError(c, 400, 'email and 6-digit code required')
    }

    // Rate-limit by email (not IP) to block credential-stuffing: an
    // attacker trying many codes against one email hits this cap even
    // if they rotate source IPs. Counts only *failed* attempts so a
    // legitimate user doesn't lock themselves out after one success.
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
      return jsonError(
        c,
        429,
        'too many attempts; try again later',
        'rate_limit',
      )
    }

    // Hash the submitted email+code and look for a row that matches.
    // `consumed = 0` ensures each code is single-use (next request has
    // already been marked consumed). `expires_at > :now` filters out
    // codes the user took too long to redeem.
    const codeHash = await sha256Hex(`${email}:${code}`)
    const result = await sqlite.execute({
      sql: 'SELECT rowid FROM login_codes WHERE email = :email AND code_hash = :codeHash AND consumed = 0 AND expires_at > :now ORDER BY created_at DESC LIMIT 1',
      args: { email, codeHash, now: nowSec },
    })
    if (result.rows.length === 0) {
      // Log the failed attempt — feeds into the rate-limit counter
      // above on the next call from the same email.
      await sqlite.execute({
        sql: 'INSERT INTO verify_attempts (email, ip, success) VALUES (:email, :ip, 0)',
        args: { email, ip: c.get('ip') },
      })
      await audit(c, 'login_verify_failed', { actor: email, success: false })
      return jsonError(c, 401, 'invalid or expired code')
    }

    // Success. Consume the code so it can't be re-used, log the
    // attempt for the rate-limit window, and mint the JWT.
    await sqlite.execute({
      sql: 'UPDATE login_codes SET consumed = 1 WHERE rowid = :rowid',
      args: { rowid: (result.rows[0] as { rowid: number }).rowid },
    })
    await sqlite.execute({
      sql: 'INSERT INTO verify_attempts (email, ip, success) VALUES (:email, :ip, 1)',
      args: { email, ip: c.get('ip') },
    })

    // `jti` (JWT ID) is a unique token identifier. We stash it in the
    // JWT so we can revoke a specific session later (see auth/logout)
    // without invalidating every session for this user. `exp` is in
    // seconds since epoch — JWT convention, matches iat format.
    const exp = nowSec + SESSION_TTL_SECONDS
    const jti = crypto.randomUUID()
    const jwt = await signJwt(hmacKey, { email, exp, iat: nowSec, jti })
    await audit(c, 'login_success', { actor: email, success: true })
    return c.json({ token: jwt, email, expiresAt: exp })
  })
}
