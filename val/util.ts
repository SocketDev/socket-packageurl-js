/**
 * @fileoverview Small helpers used across routes and middleware.
 *
 * `now` — seconds-since-epoch.
 * `getIp` — extract client IP honoring the TRUSTED_PROXY_HOPS setting.
 * `readBoundedJson` — read a request body, reject anything oversized.
 * `jsonError` — standard error envelope.
 */

import type { Context } from 'npm:hono@4'
import { extractClientIp } from './validate.ts'
import { TRUSTED_PROXY_HOPS } from './config.ts'
import type { HttpStatus } from './types.ts'

export const now = (): number => Math.floor(Date.now() / 1000)

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

export const jsonError = (
  c: Context,
  status: HttpStatus,
  error: string,
  code?: string,
) => c.json(code ? { error, code } : { error }, status)
