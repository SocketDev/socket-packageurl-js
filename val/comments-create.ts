/**
 * @fileoverview POST /:slug/api/comments — create a new comment.
 *
 * Author is set from the JWT email (not from request body) so clients
 * cannot spoof identity. Comment body is validated for shape + length
 * before insertion; slug is validated against the path param regex.
 */

import type { Context, Hono, Next } from 'npm:hono@4.12.14'
import { sqlite } from 'https://esm.town/v/std/sqlite/main.ts'

import { isValidSlug, validateCommentInput } from './validate.ts'
import { MAX_BODY_BYTES_COMMENT } from './config.ts'
import { ensureDb } from './db.ts'
import { audit } from './audit.ts'
import { jsonError, readBoundedJson } from './util.ts'
import type { AppEnv } from './types.ts'

export const registerCommentCreateRoute = (
  app: Hono<AppEnv>,
  requireAuth: (c: Context<AppEnv>, n: Next) => Promise<Response | void>,
): void => {
  app.post('/:slug/api/comments', requireAuth, async c => {
    await ensureDb
    const slug = c.req.param('slug')
    if (!isValidSlug(slug)) {
      return jsonError(c, 400, 'invalid slug')
    }
    const auth = c.get('auth')
    // Read the body through the bounded reader so a client can't OOM
    // the val by streaming an enormous JSON blob. 64 KB is plenty for
    // a code-review comment — long comments are still allowed, but
    // not novel-length pastes.
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

    // `author` is taken from the authenticated session, never from
    // the request body. This is the primary guarantee that comments
    // can't be attributed to someone else.
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

    // Return the new row echoed back (not a re-SELECT) so the client
    // can render optimistically without a second round-trip. 201 is
    // the canonical created-response status.
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
}
