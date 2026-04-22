/**
 * @fileoverview Read endpoints — list, unresolved, export.
 *
 * All three are read-only queries against the comments table, so they
 * share a file. Each requires auth (no anonymous browsing) but none
 * enforce author-only filters — any authed user can see every comment
 * on the walkthrough.
 */

import type { Context, Hono, Next } from 'npm:hono@4.12.14'
import { sqlite } from 'https://esm.town/v/std/sqlite/main.ts'

import { isValidSlug } from './validate.ts'
import { ensureDb } from './db.ts'
import { jsonError } from './util.ts'
import { rowToComment } from './comments-shared.ts'
import type { AppEnv, CommentRow } from './types.ts'

export const registerCommentReadRoutes = (
  app: Hono<AppEnv>,
  requireAuth: (c: Context<AppEnv>, n: Next) => Promise<Response | void>,
): void => {
  // Unresolved top-level comments, newest first. "Top-level" = rows
  // without a parent_id, so replies don't show up here. Used by the
  // topbar unresolved-count badge.
  app.get('/:slug/api/comments/unresolved', requireAuth, async c => {
    await ensureDb
    const slug = c.req.param('slug')
    if (!isValidSlug(slug)) {
      return jsonError(c, 400, 'invalid slug')
    }
    const result = await sqlite.execute({
      sql: "SELECT id, slug, part, file, line_from, line_to, author, body, parent_id, resolved, created_at FROM comments WHERE slug = :slug AND (parent_id IS NULL OR parent_id = '') AND resolved = 0 ORDER BY created_at DESC",
      args: { slug },
    })
    return c.json((result.rows as unknown as CommentRow[]).map(rowToComment))
  })

  // Dump all (or unresolved-only) comments as a JSON bundle for
  // offline archival / review. Single round-trip, no pagination —
  // walkthroughs are small enough that the full list is fine.
  app.get('/:slug/api/comments/export', requireAuth, async c => {
    await ensureDb
    const slug = c.req.param('slug')
    if (!isValidSlug(slug)) {
      return jsonError(c, 400, 'invalid slug')
    }
    const unresolvedOnly = c.req.query('unresolved') === '1'
    const sql = unresolvedOnly
      ? 'SELECT id, slug, part, file, line_from, line_to, author, body, parent_id, resolved, created_at FROM comments WHERE slug = :slug AND resolved = 0 ORDER BY created_at ASC'
      : 'SELECT id, slug, part, file, line_from, line_to, author, body, parent_id, resolved, created_at FROM comments WHERE slug = :slug ORDER BY created_at ASC'
    const result = await sqlite.execute({ sql, args: { slug } })
    return c.json({
      slug,
      exportedAt: new Date().toISOString(),
      comments: (result.rows as unknown as CommentRow[]).map(rowToComment),
    })
  })

  // List comments for a single walkthrough part. Part ID capped so a
  // malformed query string can't produce an inefficient index scan.
  app.get('/:slug/api/comments', requireAuth, async c => {
    await ensureDb
    const slug = c.req.param('slug')
    if (!isValidSlug(slug)) {
      return jsonError(c, 400, 'invalid slug')
    }
    const part = c.req.query('part')
    if (!part) {
      return jsonError(c, 400, 'part query parameter required')
    }
    const partInt = Number.parseInt(part, 10)
    if (!Number.isFinite(partInt) || partInt < 1 || partInt > 10_000) {
      return jsonError(c, 400, 'invalid part')
    }
    const result = await sqlite.execute({
      sql: 'SELECT id, slug, part, file, line_from, line_to, author, body, parent_id, resolved, created_at FROM comments WHERE slug = :slug AND part = :part ORDER BY created_at ASC',
      args: { slug, part: partInt },
    })
    return c.json((result.rows as unknown as CommentRow[]).map(rowToComment))
  })
}
