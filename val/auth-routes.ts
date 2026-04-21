/**
 * @fileoverview Auth routes — request code, verify code, check session,
 * logout. Registers handlers on a provided Hono app so the entry point
 * can compose modules without circular imports.
 */

import type { Hono, Next, Context } from 'npm:hono@4'
import { sqlite } from 'https://esm.town/v/std/sqlite/main.ts'
import { email as sendEmail } from 'https://esm.town/v/std/email'

import { generateCode, sha256Hex, signJwt, verifyJwt } from './crypto.ts'
import {
  emailDomain,
  isValidCode,
  isValidEmail,
  normalizeEmail,
} from './validate.ts'
import { renderLoginEmail, renderLoginEmailText } from './email-template.ts'
import {
  ALLOWED_EMAIL_DOMAIN,
  CODE_RATE_LIMIT_PER_IP,
  CODE_TTL_SECONDS,
  EMAIL_FROM,
  EMAIL_REPLY_TO,
  JWT_SIGNING_KEY,
  MAX_BODY_BYTES_AUTH,
  SESSION_TTL_SECONDS,
  VERIFY_RATE_LIMIT_PER_EMAIL,
  VERIFY_WINDOW_SECONDS,
} from './config.ts'
import { cleanOldRows, ensureDb } from './db.ts'
import { audit } from './audit.ts'
import { jsonError, now, readBoundedJson } from './util.ts'
import type { AppEnv } from './types.ts'

export const registerAuthRoutes = (
  app: Hono<AppEnv>,
  hmacKey: CryptoKey,
  requireAuth: (c: Context<AppEnv>, n: Next) => Promise<Response | void>,
): void => {
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
        await sendEmail({
          to: rawEmail,
          from: EMAIL_FROM,
          replyTo: EMAIL_REPLY_TO,
          subject: 'Your Socket walkthrough login code',
          html: renderLoginEmail(code),
          text: renderLoginEmailText(code),
        })
      } catch (err) {
        console.error('[val] email send failed', err)
      }
      await audit(c, 'login_code_sent', { actor: rawEmail, success: true })
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
      return jsonError(
        c,
        429,
        'too many attempts; try again later',
        'rate_limit',
      )
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
      await audit(c, 'login_verify_failed', { actor: email, success: false })
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

  // TEMPORARY diagnostic — DELETE before real users. Gated on a
  // shared-secret query param (first 16 chars of JWT_SIGNING_KEY) so
  // outsiders can't probe it.
  app.get('/debug/email', async c => {
    const secret = c.req.query('s')
    if (secret !== JWT_SIGNING_KEY.slice(0, 16)) {
      return c.json({ error: 'forbidden' }, 403)
    }
    const to = c.req.query('to') || ''
    if (!to) {
      return c.json({ error: 'pass ?to=' }, 400)
    }
    try {
      const result = await sendEmail({
        to,
        from: EMAIL_FROM,
        replyTo: EMAIL_REPLY_TO,
        subject: 'diagnostic',
        text: 'This is a diagnostic email from the Socket walkthrough val.',
      })
      return c.json({ ok: true, result })
    } catch (err) {
      return c.json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
    }
  })
}
