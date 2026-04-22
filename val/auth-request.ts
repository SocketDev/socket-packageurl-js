/**
 * @fileoverview POST /auth/request — step 1 of email-login.
 *
 * User submits their email; we generate a 6-digit code, store a hash
 * of it in sqlite, and email the plaintext code. The response is
 * always `{ok: true}` regardless of whether the email was accepted,
 * so an attacker can't use this endpoint to enumerate which addresses
 * exist in our system.
 */

import type { Hono } from 'npm:hono@4.12.14'
import { sqlite } from 'https://esm.town/v/std/sqlite/main.ts'
import { email as sendEmail } from 'https://esm.town/v/std/email'

import { generateCode, sha256Hex } from './crypto.ts'
import { emailDomain, isValidEmail, normalizeEmail } from './validate.ts'
import { renderLoginEmail, renderLoginEmailText } from './email-template.ts'
import {
  ALLOWED_EMAIL_DOMAIN,
  CODE_RATE_LIMIT_PER_IP,
  CODE_TTL_SECONDS,
  EMAIL_FROM,
  EMAIL_REPLY_TO,
  MAX_BODY_BYTES_AUTH,
} from './config.ts'
import { cleanOldRows, ensureDb } from './db.ts'
import { audit } from './audit.ts'
import { now, readBoundedJson } from './util.ts'
import type { AppEnv } from './types.ts'

export const registerAuthRequest = (app: Hono<AppEnv>): void => {
  app.post('/auth/request', async c => {
    await ensureDb
    // Piggyback retention cleanup on code-request. It's the lowest-
    // frequency auth endpoint, so the extra work rarely lands on a
    // hot path, and we avoid needing a separate cron.
    await cleanOldRows()

    // Cap the body size. Without this, a client could POST a huge JSON
    // blob and OOM the val. 4 KB is plenty for `{ email: "..." }`.
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

    // Rate-limit per IP: how many codes has this IP asked for in the
    // last hour? If it's over the threshold, silently refuse. Makes
    // brute-force + email-flooding impractical.
    const ipCount = await sqlite.execute({
      sql: 'SELECT COUNT(*) AS n FROM login_codes WHERE ip = :ip AND created_at > :since',
      args: { ip, since: windowStart },
    })
    const ipHits = Number((ipCount.rows[0] as { n?: number | bigint })?.n ?? 0)
    const rateLimited = ipHits >= CODE_RATE_LIMIT_PER_IP

    if (emailValid && domainOk && !rateLimited) {
      const code = generateCode()
      // Store a hash of the code, not the code itself. If the DB leaks,
      // an attacker can't read off live codes — they'd have to brute-
      // force sha256. Salt the hash with the email so two users who
      // happen to get the same random code produce different hashes.
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
          subject: 'Your Socket tour login code',
          html: renderLoginEmail(code),
          text: renderLoginEmailText(code),
        })
      } catch (err) {
        // Log-and-swallow. If the email provider hiccups we don't
        // reveal it to the client — the audit log preserves that we
        // tried, and the user realizes when their code doesn't arrive.
        console.error('[val] email send failed', err)
      }
      await audit(c, 'login_code_sent', { actor: rawEmail, success: true })
    } else {
      // Record why we refused so we can spot abuse patterns later, but
      // never tell the client. See the always-`{ok: true}` below.
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

    // Always the same response shape — no info leak about whether the
    // address is known, in the allowed domain, or rate-limited.
    return c.json({ ok: true })
  })
}
