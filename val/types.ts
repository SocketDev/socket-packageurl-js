/**
 * @fileoverview Shared types for the val.
 *
 * Keeps type signatures near the boundary so route modules and
 * middleware can share them without circular imports.
 */

export type AuthContext = { email: string; jti: string }

export type CommentRow = {
  id: string
  slug: string
  part: number
  file: string
  line_from: number
  line_to: number
  author: string
  body: string
  parent_id: string | null
  resolved: number
  created_at: string
}

export type AppEnv = {
  Variables: {
    auth: AuthContext
    reqId: string
    ip: string
  }
}

export type HttpStatus = 400 | 401 | 403 | 404 | 429 | 500 | 503
