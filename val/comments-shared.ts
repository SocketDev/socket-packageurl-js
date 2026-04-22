/**
 * @fileoverview Shared helpers for the comment-route modules.
 *
 * `rowToComment` translates a raw sqlite row (snake_case column names,
 * 0/1 ints for booleans) into the camelCase JSON shape clients expect.
 * Kept in its own module so each route file (read/create/mutate)
 * doesn't have to redefine it.
 */

import type { CommentRow } from './types.ts'

export const rowToComment = (row: CommentRow) => ({
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
