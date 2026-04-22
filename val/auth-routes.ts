/**
 * @fileoverview Auth-route orchestrator.
 *
 * Composes the three auth-endpoint modules onto a shared Hono app so
 * the entry point can register everything with one call. Each module
 * owns its own sqlite + Hono imports — this file is just a dispatcher.
 */

import type { Hono, Next, Context } from 'npm:hono@4.12.14'

import { registerAuthRequest } from './auth-request.ts'
import { registerAuthVerify } from './auth-verify.ts'
import { registerAuthSession } from './auth-session.ts'
import type { AppEnv } from './types.ts'

export const registerAuthRoutes = (
  app: Hono<AppEnv>,
  hmacKey: CryptoKey,
  requireAuth: (c: Context<AppEnv>, n: Next) => Promise<Response | void>,
): void => {
  registerAuthRequest(app)
  registerAuthVerify(app, hmacKey)
  registerAuthSession(app, hmacKey, requireAuth)
}
