/**
 * @fileoverview Small helpers used across routes and middleware.
 *
 * `now` — seconds-since-epoch.
 * `getIp` — extract client IP honoring the TRUSTED_PROXY_HOPS setting.
 * `readBoundedJson` — read a request body, reject anything oversized.
 * `jsonError` — standard error envelope.
 */

import type { Context } from 'npm:hono@4.12.14'
import { extractClientIp } from './validate.ts'
import { TRUSTED_PROXY_HOPS } from './config.ts'
import type { HttpStatus } from './types.ts'

// Seconds-since-epoch (UNIX time). Most of our DB columns + JWT
// fields use seconds; Date.now() returns milliseconds so we divide.
export const now = (): number => Math.floor(Date.now() / 1000)

// The direct client IP on a forwarded request is always Val Town's
// edge proxy. `extractClientIp` walks the x-forwarded-for header and
// picks the N-th-from-the-right address, where N = TRUSTED_PROXY_HOPS.
// We wrap it so routes/middleware don't have to know about the header
// extraction shape.
export const getIp = (c: Context): string =>
  extractClientIp(
    {
      get: name =>
        name.toLowerCase() === 'x-forwarded-for'
          ? c.req.header('x-forwarded-for') || null
          : c.req.header(name) || null,
    },
    TRUSTED_PROXY_HOPS,
  )

// Read a JSON body with a hard byte cap. A client can't DOS us by
// streaming an enormous request — anything over `maxBytes` returns
// null and the caller emits 400. Returns null on parse errors too so
// call sites only check for one failure mode.
export const readBoundedJson = async <T>(
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

// Standard error envelope. Clients that want a machine-readable
// reason pass `code` (e.g. 'rate_limit'); the human message always
// goes in `error`.
export const jsonError = (
  c: Context,
  status: HttpStatus,
  error: string,
  code?: string,
) => c.json(code ? { error, code } : { error }, status)
