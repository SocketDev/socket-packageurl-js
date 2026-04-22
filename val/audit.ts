/**
 * @fileoverview Audit-log writer.
 *
 * All "significant" events (logins, comment mutations, forbidden
 * attempts) route through `audit()`. Failures to write are logged
 * but never fail the request.
 */

import { sqlite } from 'https://esm.town/v/std/sqlite/main.ts'
import type { Context } from 'npm:hono@4.12.14'
import { scrubIp } from './validate.ts'
import type { AppEnv } from './types.ts'

export const audit = async (
  c: Context<AppEnv>,
  action: string,
  opts: {
    actor?: string | null
    target?: string
    slug?: string
    success: boolean
    meta?: Record<string, unknown>
  },
): Promise<void> => {
  try {
    await sqlite.execute({
      sql: 'INSERT INTO audit_log (id, actor, action, target, slug, ip_prefix, req_id, success, meta) VALUES (:id, :actor, :action, :target, :slug, :ipPrefix, :reqId, :success, :meta)',
      args: {
        id: crypto.randomUUID(),
        actor: opts.actor ?? null,
        action,
        target: opts.target ?? null,
        slug: opts.slug ?? null,
        ipPrefix: scrubIp(c.get('ip')),
        reqId: c.get('reqId'),
        success: opts.success ? 1 : 0,
        meta: opts.meta ? JSON.stringify(opts.meta) : null,
      },
    })
  } catch (e) {
    console.warn('[val] audit write failed', e)
  }
}
