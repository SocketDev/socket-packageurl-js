/**
 * @fileoverview Comment CRUD routes.
 *
 * Every mutation requires auth; author identity is bound to the JWT
 * email — clients cannot spoof it. PATCH and DELETE are
 * author-only (403 when another authed user tries to mutate someone
 * else's comment).
 */

import type { Context, Hono, Next } from 'npm:hono@4.12.14'
import { sqlite } from 'https://esm.town/v/std/sqlite/main.ts'

import { isValidSlug, isValidUuid, validateCommentInput } from './validate.ts'
import { MAX_BODY_BYTES_AUTH, MAX_BODY_BYTES_COMMENT } from './config.ts'
import { ensureDb } from './db.ts'
import { audit } from './audit.ts'
import { jsonError, readBoundedJson } from './util.ts'
import type { AppEnv, CommentRow } from './types.ts'

const rowToComment = (row: CommentRow) => ({
  id: row.id,
  slug: row.slug,
  part: row.part,
  file: row.file,
  lineFrom: row.line_from,
  lineTo: row.line_to,
  author: row.author,
  body: row.body,
  parentId: row.parent_id || null,
  resolved: !!row.resolved,
  createdAt: row.created_at,
})

export const registerCommentRoutes = (
  app: Hono<AppEnv>,
  requireAuth: (c: Context<AppEnv>, n: Next) => Promise<Response | void>,
): void => {
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

  app.post('/:slug/api/comments', requireAuth, async c => {
    await ensureDb
    const slug = c.req.param('slug')
    if (!isValidSlug(slug)) {
      return jsonError(c, 400, 'invalid slug')
    }
    const auth = c.get('auth')
    const body = await readBoundedJson<Record<string, unknown>>(
      c,
      MAX_BODY_BYTES_COMMENT,
    )
    if (!body) {
      return jsonError(c, 400, 'invalid or too-large body')
    }
    const v = validateCommentInput(body)
    if (!v.ok) {
      return jsonError(c, 400, v.error)
    }

    const author = auth.email
    const id = crypto.randomUUID()
    await sqlite.execute({
      sql: 'INSERT INTO comments (id, slug, part, file, line_from, line_to, author, body, parent_id) VALUES (:id, :slug, :part, :file, :lineFrom, :lineTo, :author, :body, :parentId)',
      args: {
        id,
        slug,
        part: v.value.part,
        file: v.value.file,
        lineFrom: v.value.lineFrom,
        lineTo: v.value.lineTo,
        author,
        body: v.value.body,
        parentId: v.value.parentId,
      },
    })

    await audit(c, 'comment_create', {
      actor: author,
      target: id,
      slug,
      success: true,
    })

    return c.json(
      {
        id,
        slug,
        part: v.value.part,
        file: v.value.file,
        lineFrom: v.value.lineFrom,
        lineTo: v.value.lineTo,
        author,
        body: v.value.body,
        parentId: v.value.parentId,
        resolved: false,
        createdAt: new Date().toISOString(),
      },
      201,
    )
  })

  app.patch('/:slug/api/comments/:id', requireAuth, async c => {
    await ensureDb
    const slug = c.req.param('slug')
    const id = c.req.param('id')
    if (!isValidSlug(slug) || !isValidUuid(id)) {
      return jsonError(c, 400, 'invalid slug or id')
    }
    const auth = c.get('auth')
    const body = await readBoundedJson<{ resolved?: unknown }>(
      c,
      MAX_BODY_BYTES_AUTH,
    )
    if (!body || typeof body.resolved !== 'boolean') {
      return jsonError(c, 400, 'resolved (boolean) required')
    }
    const existing = await sqlite.execute({
      sql: 'SELECT author FROM comments WHERE id = :id AND slug = :slug',
      args: { id, slug },
    })
    if (existing.rows.length === 0) {
      return jsonError(c, 404, 'not found')
    }
    if ((existing.rows[0] as { author: string }).author !== auth.email) {
      await audit(c, 'comment_resolve_forbidden', {
        actor: auth.email,
        target: id,
        slug,
        success: false,
      })
      return jsonError(c, 403, 'forbidden')
    }
    await sqlite.execute({
      sql: 'UPDATE comments SET resolved = :resolved WHERE id = :id',
      args: { id, resolved: body.resolved ? 1 : 0 },
    })
    await audit(c, body.resolved ? 'comment_resolve' : 'comment_unresolve', {
      actor: auth.email,
      target: id,
      slug,
      success: true,
    })
    return c.json({ ok: true })
  })

  app.delete('/:slug/api/comments/:id', requireAuth, async c => {
    await ensureDb
    const slug = c.req.param('slug')
    const id = c.req.param('id')
    if (!isValidSlug(slug) || !isValidUuid(id)) {
      return jsonError(c, 400, 'invalid slug or id')
    }
    const auth = c.get('auth')
    const existing = await sqlite.execute({
      sql: 'SELECT author FROM comments WHERE id = :id AND slug = :slug',
      args: { id, slug },
    })
    if (existing.rows.length === 0) {
      return jsonError(c, 404, 'not found')
    }
    if ((existing.rows[0] as { author: string }).author !== auth.email) {
      await audit(c, 'comment_delete_forbidden', {
        actor: auth.email,
        target: id,
        slug,
        success: false,
      })
      return jsonError(c, 403, 'forbidden')
    }
    await sqlite.execute({
      sql: 'DELETE FROM comments WHERE id = :id',
      args: { id },
    })
    await audit(c, 'comment_delete', {
      actor: auth.email,
      target: id,
      slug,
      success: true,
    })
    return c.json({ ok: true })
  })
}
