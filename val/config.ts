/**
 * @fileoverview Config — env var reading + tunable constants.
 *
 * Single source of truth for everything the val reads from its
 * environment. Fail-closed on missing JWT_SIGNING_KEY so we never
 * accidentally run with a default (forgeable) signing key.
 */

// eslint-disable-next-line @typescript-eslint/no-namespace
declare const Deno: { env: { get(name: string): string | undefined } }

export const ALLOWED_EMAIL_DOMAIN = (
  Deno.env.get('ALLOWED_EMAIL_DOMAIN') || 'socket.dev'
).toLowerCase()

export const JWT_SIGNING_KEY = Deno.env.get('JWT_SIGNING_KEY') || ''

export const ENVIRONMENT = (
  Deno.env.get('NODE_ENV') || 'production'
).toLowerCase()

export const TRUSTED_PROXY_HOPS = Math.max(
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

export const ALLOWED_ORIGINS = new Set([...PROD_ORIGINS, ...DEV_ORIGINS])

// Sender for login emails. Val Town limits from.email to
// <username>.<valname>@valtown.email. Keep in sync with the deploy
// script's default valName.
export const EMAIL_FROM = {
  email: 'socketdev.walkthrough@valtown.email',
  name: 'Socket Walkthroughs',
}
export const EMAIL_REPLY_TO = 'security@socket.dev'

// Timings (all seconds). Multiplication form is kept so the unit is
// visible at the call site without having to consult a comment.
// 10 min — how long a freshly-emailed login code remains valid.
export const CODE_TTL_SECONDS = 60 * 10
// 24 h — JWT session lifetime.
export const SESSION_TTL_SECONDS = 60 * 60 * 24
// 10 min — rolling window for the verify-attempt rate-limit counter.
export const VERIFY_WINDOW_SECONDS = 10 * 60
// 90 days — how long audit-log rows survive before cleanup.
export const AUDIT_RETENTION_SECONDS = 60 * 60 * 24 * 90
// 24 h — how long login_codes + verify_attempts rows survive.
export const LOGIN_CODE_RETENTION_SECONDS = 60 * 60 * 24

// Rate limits
export const CODE_RATE_LIMIT_PER_IP = 20
export const VERIFY_RATE_LIMIT_PER_EMAIL = 10

// Body size caps
export const MAX_BODY_BYTES_AUTH = 4 * 1024
export const MAX_BODY_BYTES_COMMENT = 64 * 1024

// Part / line bounds
export const MAX_PART_ID = 10_000

if (!JWT_SIGNING_KEY) {
  throw new Error(
    'JWT_SIGNING_KEY env var must be set ' +
      '(generate with `openssl rand -base64 32`)',
  )
}
