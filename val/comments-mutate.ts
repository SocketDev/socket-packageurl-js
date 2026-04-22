/**
 * @fileoverview PATCH + DELETE endpoints on a single comment.
 *
 * Both are author-only: only the person who posted the comment can
 * resolve/unresolve it or delete it. Any other authed user gets 403.
 * The author check is a SELECT + string compare — simple enough to
 * not warrant a stored procedure, low enough frequency that two
 * round-trips per request is fine.
 */

import type { Context, Hono, Next } from 'npm:hono@4.12.14'
import { sqlite } from 'https://esm.town/v/std/sqlite/main.ts'

import { isValidSlug, isValidUuid } from './validate.ts'
import { MAX_BODY_BYTES_AUTH } from './config.ts'
import { ensureDb } from './db.ts'
import { audit } from './audit.ts'
import { jsonError, readBoundedJson } from './util.ts'
import type { AppEnv } from './types.ts'

export const registerCommentMutateRoutes = (
  app: Hono<AppEnv>,
  requireAuth: (c: Context<AppEnv>, n: Next) => Promise<Response | void>,
): void => {
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
    // Load the row first so we can confirm it exists AND that the
    // requester owns it. 404 vs 403 is deliberate: leaking "this id
    // exists but you can't touch it" is fine for a walkthrough — it
    // doesn't expose anything sensitive about the comment contents.
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
    // sqlite doesn't have a native boolean type; store 0 or 1 and let
    // rowToComment coerce back to boolean on read.
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
    // Hard delete — replies to this comment keep their parent_id
    // pointing at the (now-missing) id. That's intentional: the client
    // can render them as "reply to a deleted comment" or filter them
    // out, without us having to cascade.
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
