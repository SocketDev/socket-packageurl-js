/**
 * @fileoverview Database init + retention cleanup.
 *
 * `ensureDb` is an awaitable module-level Promise that creates tables
 * if missing. Route handlers `await ensureDb` at the top so cold
 * starts build the schema before the first query.
 *
 * `cleanOldRows` purges expired login codes, verify-attempt history,
 * stale revocations, and old audit log entries. Called from
 * `/auth/request` (low frequency) so we don't need a separate cron.
 */

import { sqlite } from 'https://esm.town/v/std/sqlite/main.ts'
import {
  AUDIT_RETENTION_SECONDS,
  LOGIN_CODE_RETENTION_SECONDS,
} from './config.ts'
import { now } from './util.ts'

export const ensureDb = (async () => {
  try {
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS login_codes (
        email      TEXT NOT NULL,
        code_hash  TEXT NOT NULL,
        ip         TEXT,
        expires_at INTEGER NOT NULL,
        consumed   INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      )
    `)
    await sqlite.execute(
      `CREATE INDEX IF NOT EXISTS idx_login_codes_email ON login_codes(email, created_at)`,
    )
    await sqlite.execute(
      `CREATE INDEX IF NOT EXISTS idx_login_codes_ip ON login_codes(ip, created_at)`,
    )
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS verify_attempts (
        email      TEXT NOT NULL,
        ip         TEXT,
        success    INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      )
    `)
    await sqlite.execute(
      `CREATE INDEX IF NOT EXISTS idx_verify_email ON verify_attempts(email, created_at)`,
    )
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS comments (
        id         TEXT PRIMARY KEY,
        slug       TEXT NOT NULL,
        part       INTEGER NOT NULL,
        file       TEXT NOT NULL,
        line_from  INTEGER NOT NULL,
        line_to    INTEGER NOT NULL,
        author     TEXT NOT NULL,
        body       TEXT NOT NULL,
        parent_id  TEXT,
        resolved   INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    await sqlite.execute(
      `CREATE INDEX IF NOT EXISTS idx_comments_slug_part ON comments(slug, part)`,
    )
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS revoked_jtis (
        jti        TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      )
    `)
    await sqlite.execute(
      `CREATE INDEX IF NOT EXISTS idx_revoked_jtis_exp ON revoked_jtis(expires_at)`,
    )
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id         TEXT PRIMARY KEY,
        ts         INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        actor      TEXT,
        action     TEXT NOT NULL,
        target     TEXT,
        slug       TEXT,
        ip_prefix  TEXT,
        req_id     TEXT,
        success    INTEGER NOT NULL,
        meta       TEXT
      )
    `)
    await sqlite.execute(
      `CREATE INDEX IF NOT EXISTS idx_audit_actor_ts ON audit_log(actor, ts)`,
    )
    await sqlite.execute(
      `CREATE INDEX IF NOT EXISTS idx_audit_action_ts ON audit_log(action, ts)`,
    )
  } catch (e) {
    console.error('[val] ensureDb failed', e)
    throw e
  }
})()

export const cleanOldRows = async (): Promise<void> => {
  const auditCutoff = now() - AUDIT_RETENTION_SECONDS
  const authCutoff = now() - LOGIN_CODE_RETENTION_SECONDS
  try {
    await sqlite.execute({
      sql: 'DELETE FROM login_codes WHERE created_at < :c',
      args: { c: authCutoff },
    })
    await sqlite.execute({
      sql: 'DELETE FROM verify_attempts WHERE created_at < :c',
      args: { c: authCutoff },
    })
    await sqlite.execute({
      sql: 'DELETE FROM revoked_jtis WHERE expires_at < :c',
      args: { c: now() },
    })
    await sqlite.execute({
      sql: 'DELETE FROM audit_log WHERE ts < :c',
      args: { c: auditCutoff },
    })
  } catch (e) {
    console.warn('[val] cleanup failed', e)
  }
}

export const isJtiRevoked = async (jti: string): Promise<boolean> => {
  const r = await sqlite.execute({
    sql: 'SELECT 1 FROM revoked_jtis WHERE jti = :jti AND expires_at > :now LIMIT 1',
    args: { jti, now: now() },
  })
  return r.rows.length > 0
}
