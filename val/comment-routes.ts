/**
 * @fileoverview Comment-route orchestrator.
 *
 * Composes the three comment-route modules (read, create, mutate)
 * onto a shared Hono app. Split by lifecycle: reads are un-restricted
 * for any authed user, create mints a new row with the JWT email as
 * author, mutations (patch/delete) are gated on author-matches-JWT.
 */

import type { Context, Hono, Next } from 'npm:hono@4.12.14'

import { registerCommentCreateRoute } from './comments-create.ts'
import { registerCommentMutateRoutes } from './comments-mutate.ts'
import { registerCommentReadRoutes } from './comments-read.ts'
import type { AppEnv } from './types.ts'

export const registerCommentRoutes = (
  app: Hono<AppEnv>,
  requireAuth: (c: Context<AppEnv>, n: Next) => Promise<Response | void>,
): void => {
  registerCommentReadRoutes(app, requireAuth)
  registerCommentCreateRoute(app, requireAuth)
  registerCommentMutateRoutes(app, requireAuth)
}
