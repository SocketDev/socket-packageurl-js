/*
 * @file The consolidated Socket runtime-state DB — one SQLite file for all
 *   Socket state, replacing the `_state/*.json` files and adding the
 *   active-edits collision ledger. `node:sqlite` (built-in, Node 22+), WAL
 *   mode so many agents in many checkouts write to the same DB without a
 *   writer-lock. File mode 0600, matching `_state/`'s owner-only posture.
 *   Tables:
 *
 *   - `active_edits (checkout, path, actor_id, pid, timestamp)` — the active-
 *     edits collision ledger. `checkout` is `{repo-name}:{branch-or-worktree}`
 *     (e.g. `socket-wheelhouse:main`, `socket-cli:wt-foo`) so two repos at the
 *     same branch never false-collide; `path` is the file relative to the
 *     checkout root.
 *   - `offload_model (model, provider, enabled)` — the offload model lists (each
 *     enabled model is offloadable). `provider` is stored rather than derived
 *     from the id: a provider whose ids are not prefixed with its own name
 *     would otherwise round-trip into the wrong list.
 *   - `offload_model_selection (provider, selection)` — the selected model per
 *     provider. The provider primary key enforces one selected per provider.
 *   - `usage_budget (key, value_json)` — the AI spend budget, as key-value rows.
 *   - `private_repo_roster (owner, fetched_at, private_names_json)` — the private
 *     repo roster, one row per owner.
 */

import { mkdirSync } from 'node:fs'
import nodePath from 'node:path'
import process from 'node:process'

import type { DatabaseSync } from 'node:sqlite'

import { getSocketHomePath } from '../paths.mts'

// The collision window for the active-edits ledger: a file another live actor
// wrote within this window is blocked for editing on the primary checkout.
// One constant, used by every hook that queries the ledger.
export const ACTIVE_EDIT_COLLISION_WINDOW_MS = 5 * 60 * 1000

// One DB handle per process. Opened lazily on first use; the schema is created
// idempotently so a first-run and a re-open produce the same tables.
let cachedDb: DatabaseSync | undefined

function createSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS active_edits (
      checkout    TEXT NOT NULL,
      path        TEXT NOT NULL,
      actor_id    TEXT NOT NULL,
      pid         INTEGER NOT NULL,
      timestamp   INTEGER NOT NULL,
      PRIMARY KEY (checkout, path)
    );
    CREATE INDEX IF NOT EXISTS idx_active_edits_ts ON active_edits(timestamp);
    CREATE TABLE IF NOT EXISTS offload_model (
      model    TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT '',
      enabled  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS offload_model_selection (
      provider  TEXT PRIMARY KEY,
      selection TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usage_budget (
      key        TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS private_repo_roster (
      owner              TEXT PRIMARY KEY,
      fetched_at         INTEGER NOT NULL,
      private_names_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS comment_voice_profile (
      user_id      TEXT PRIMARY KEY,
      rules_json   TEXT NOT NULL,
      collected_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS repo_push_permission (
      repo       TEXT NOT NULL,
      login      TEXT NOT NULL,
      admin      INTEGER NOT NULL,
      maintain   INTEGER NOT NULL,
      checked_at INTEGER NOT NULL,
      PRIMARY KEY (repo, login)
    );
  `)
  migrateOffloadModel(db)
  migratePrivateRepoRoster(db)
}

function ensureColumn(
  db: DatabaseSync,
  table: string,
  column: string,
  ddl: string,
): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all()
  const has = (rows as Array<Record<string, unknown>>).some(
    r => String(r['name']) === column,
  )
  if (!has) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
  }
}

function migrateOffloadModel(db: DatabaseSync): void {
  ensureColumn(
    db,
    'offload_model',
    'provider',
    "provider TEXT NOT NULL DEFAULT ''",
  )
}

function migratePrivateRepoRoster(db: DatabaseSync): void {
  ensureColumn(
    db,
    'private_repo_roster',
    'public_names_json',
    'public_names_json TEXT',
  )
  ensureColumn(
    db,
    'private_repo_roster',
    'version',
    'version INTEGER NOT NULL DEFAULT 1',
  )
}

/**
 * Close the process-cached handle so the NEXT open re-resolves the DB path.
 *
 * The path comes from `getSocketHomePath()`, so a test that redirects it with
 * `setPath('socket-user-dir', …)` and calls this gets a real SQLite file under
 * that temp home rather than the operator's own state. Without the reset the
 * first open would pin the path for the whole process.
 */
export function closeSocketState(): void {
  if (cachedDb) {
    cachedDb.close()
    cachedDb = undefined
  }
}

// `_state` is the fleet home's durable-private-config store, top-level rather
// than under `_wheelhouse`, which holds clones and binaries. Resolved through
// the fleet paths module, so a test's setPath override reaches it; that is the
// redirect closeSocketState exists to re-resolve against.
function dbPath(): string {
  return nodePath.join(getSocketHomePath(), '_state', 'wheelhouse.sqlite')
}

export function openSocketState(): DatabaseSync {
  if (cachedDb) {
    return cachedDb
  }
  const filePath = dbPath()
  // The state dir does not exist until something writes into it; without this
  // the first open throws ENOENT on a fresh machine.
  mkdirSync(nodePath.dirname(filePath), { mode: 0o700, recursive: true })
  // Reached at call time, never at module scope. `node:sqlite`/`bun:sqlite`
  // both carry a native binding, and a V8 startup snapshot cannot serialize
  // one: loading it while --build-snapshot runs fails with "Unknown external
  // reference". Any hook that imports this module goes into the snapshotted
  // pack, so the builtin has to be resolved after deserialization rather than
  // during the build.
  //
  // Bun does not back `node:sqlite` — a caller running in-process under Bun
  // (no subprocess involved, so the e2e tier's node-binary spawn can't reach
  // it) needs `bun:sqlite`'s `Database` instead, which is API-compatible with
  // `DatabaseSync` for every method this file calls (`exec`,
  // `prepare().run/get/all`, `close`).
  const DatabaseSync = process.versions['bun']
    ? (
        process.getBuiltinModule('bun:sqlite') as unknown as {
          Database: new (path: string) => DatabaseSync
        }
      ).Database
    : process.getBuiltinModule('node:sqlite').DatabaseSync
  const db = new DatabaseSync(filePath)
  // WAL so many agents across many checkouts write without a writer-lock.
  db.exec('PRAGMA journal_mode = WAL')
  createSchema(db)
  cachedDb = db
  return db
}

/**
 * One active-edit row: the current editor of a file on a checkout.
 */
export interface ActiveEdit {
  checkout: string
  path: string
  actorId: string
  pid: number
  timestamp: number
}

/**
 * Record that `actorId` (pid `pid`) edited `path` on `checkout` at
 * `timestamp` (ms epoch). `INSERT OR REPLACE` — the latest editor wins.
 */
export function upsertActiveEdit(edit: ActiveEdit): void {
  const db = openSocketState()
  db.prepare(
    'INSERT OR REPLACE INTO active_edits (checkout, path, actor_id, pid, timestamp) VALUES (?, ?, ?, ?, ?)',
  ).run(edit.checkout, edit.path, edit.actorId, edit.pid, edit.timestamp)
}

/**
 * The live editors of `path` on `checkout` whose edit is within `sinceMs`, the
 * ms epoch of the window's start. Empty when no live editor is editing.
 */
export function findActiveEditors(
  checkout: string,
  path: string,
  sinceMs: number,
): ActiveEdit[] {
  const db = openSocketState()
  const rows = db
    .prepare(
      'SELECT checkout, path, actor_id, pid, timestamp FROM active_edits WHERE checkout = ? AND path = ? AND timestamp > ?',
    )
    .all(checkout, path, sinceMs)
  return rows.map((r: Record<string, unknown>) => ({
    actorId: String(r['actor_id']),
    checkout: String(r['checkout']),
    path: String(r['path']),
    pid: Number(r['pid']),
    timestamp: Number(r['timestamp']),
  }))
}

/**
 * Delete active-edit rows older than `beforeMs` (stale entries a dead actor
 * left). Returns the count deleted.
 */
export function reapActiveEdits(beforeMs: number): number {
  const db = openSocketState()
  const info = db
    .prepare('DELETE FROM active_edits WHERE timestamp < ?')
    .run(beforeMs)
  return Number(info.changes)
}

/**
 * The offload model lists: provider → array of enabled model ids.
 */
export function readOffloadModelLists(): Record<string, { ids: string[] }> {
  const db = openSocketState()
  const out: Record<string, { ids: string[] }> = {}
  // The lists live in offload_model (enabled models), not the selection table.
  // Selections are separate; build the lists from offload_model. Insertion
  // order is the cycle order the picker steps through, so rowid ordering is
  // load-bearing, not cosmetic.
  const modelRows = db
    .prepare(
      'SELECT model, provider, enabled FROM offload_model ORDER BY rowid',
    )
    .all()
  for (const r of modelRows as Array<Record<string, unknown>>) {
    const model = String(r['model'])
    const provider = String(r['provider'] ?? '')
    if (!provider) {
      continue
    }
    if (!out[provider]) {
      out[provider] = { ids: [] }
    }
    if (Number(r['enabled']) === 1) {
      out[provider]!.ids.push(model)
    }
  }
  return out
}

/**
 * The offload model selection: provider → the selected model id.
 */
export function readOffloadModelSelection(): Record<string, string> {
  const db = openSocketState()
  const rows = db
    .prepare('SELECT provider, selection FROM offload_model_selection')
    .all()
  const out: Record<string, string> = {}
  for (const r of rows as Array<Record<string, unknown>>) {
    out[String(r['provider'])] = String(r['selection'])
  }
  return out
}

/**
 * The AI usage budget. Returns the full
 * structure.
 */
export function readUsageBudget(): Record<string, unknown> {
  const db = openSocketState()
  const rows = db.prepare('SELECT key, value_json FROM usage_budget').all()
  const out: Record<string, unknown> = {}
  for (const r of rows as Array<Record<string, unknown>>) {
    out[String(r['key'])] = JSON.parse(String(r['value_json']))
  }
  return out
}

/**
 * The private repo roster. Returns
 * `{ owners: { <owner>: { fetchedAt, privateNames } } }`.
 */
export function readPrivateRepoRoster(): {
  owners: Record<
    string,
    {
      fetchedAt: number
      privateNames: string[]
      publicNames?: string[] | undefined
      version?: number | undefined
    }
  >
} {
  const db = openSocketState()
  const rows = db
    .prepare(
      'SELECT owner, fetched_at, private_names_json, public_names_json, version FROM private_repo_roster',
    )
    .all()
  const out: {
    owners: Record<
      string,
      {
        fetchedAt: number
        privateNames: string[]
        publicNames?: string[] | undefined
        version?: number | undefined
      }
    >
  } = { owners: {} }
  for (const r of rows as Array<Record<string, unknown>>) {
    const publicNamesJson = r['public_names_json']
    out.owners[String(r['owner'])] = {
      fetchedAt: Number(r['fetched_at']),
      privateNames: JSON.parse(String(r['private_names_json'])),
      ...(publicNamesJson !== null
        ? { publicNames: JSON.parse(String(publicNamesJson)) }
        : {}),
      version: Number(r['version']),
    }
  }
  return out
}

/**
 * How long a push-permission answer is trusted before it is re-probed.
 *
 * Permission changes are rare and a stale NO costs only a prompt the operator
 * can clear by typing the phrase, while a stale YES is bounded by the server:
 * GitHub still refuses the push. A day keeps the `gh` round trip off the hot
 * path of every push in a session.
 */
export const PUSH_PERMISSION_TTL_MS = 24 * 60 * 60 * 1000

/**
 * A cached answer to "may this operator push to this repo's protected trunk".
 */
export interface RepoPushPermission {
  admin: boolean
  checkedAt: number
  login: string
  maintain: boolean
  repo: string
}

/**
 * The cached permission for `repo` and `login`, or undefined when absent.
 *
 * Keyed by BOTH, because one checkout can be pushed by different accounts (a
 * personal login and a bot) and an answer about one says nothing about the
 * other.
 */
export function readRepoPushPermission(
  repo: string,
  login: string,
): RepoPushPermission | undefined {
  const db = openSocketState()
  const row = db
    .prepare(
      'SELECT repo, login, admin, maintain, checked_at FROM repo_push_permission WHERE repo = ? AND login = ?',
    )
    .get(repo.toLowerCase(), login.toLowerCase()) as
    | Record<string, unknown>
    | undefined
  if (!row) {
    return undefined
  }
  return {
    admin: Number(row['admin']) === 1,
    checkedAt: Number(row['checked_at']),
    login: String(row['login']),
    maintain: Number(row['maintain']) === 1,
    repo: String(row['repo']),
  }
}

/**
 * Record a push-permission probe result.
 */
export function writeRepoPushPermission(permission: RepoPushPermission): void {
  const db = openSocketState()
  db.prepare(
    `INSERT INTO repo_push_permission (repo, login, admin, maintain, checked_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(repo, login) DO UPDATE SET
       admin = excluded.admin,
       maintain = excluded.maintain,
       checked_at = excluded.checked_at`,
  ).run(
    permission.repo.toLowerCase(),
    permission.login.toLowerCase(),
    permission.admin ? 1 : 0,
    permission.maintain ? 1 : 0,
    permission.checkedAt,
  )
}

/**
 * Drop every cached push permission. For tests, and for an operator whose
 * access changed and who does not want to wait out the TTL.
 */
export function clearRepoPushPermissions(): void {
  openSocketState().exec('DELETE FROM repo_push_permission')
}

/**
 * Write the offload model lists into the DB. A list REPLACES that provider's
 * rows.
 */
export function writeOffloadModelLists(
  lists: Record<string, { ids: string[] }>,
): void {
  const db = openSocketState()
  const providers = Object.keys(lists)
  for (let i = 0, { length } = providers; i < length; i += 1) {
    const provider = providers[i]!
    const { ids } = lists[provider]!
    // Replace the provider's rows: a refreshed list that dropped a retired
    // model must not leave it behind for the caret to cycle onto.
    db.prepare('DELETE FROM offload_model WHERE provider = ?').run(provider)
    for (const model of ids) {
      db.prepare(
        'INSERT OR REPLACE INTO offload_model (model, provider, enabled) VALUES (?, ?, ?)',
      ).run(model, provider, 1)
    }
  }
}

/**
 * Write the offload model selection into the DB.
 */
export function writeOffloadModelSelection(
  selection: Record<string, string>,
): void {
  const db = openSocketState()
  for (const [provider, model] of Object.entries(selection)) {
    db.prepare(
      'INSERT OR REPLACE INTO offload_model_selection (provider, selection) VALUES (?, ?)',
    ).run(provider, model)
  }
}

/**
 * Write the AI usage budget into the DB.
 */
export function writeUsageBudget(budget: Record<string, unknown>): void {
  const db = openSocketState()
  for (const [key, value] of Object.entries(budget)) {
    db.prepare(
      'INSERT OR REPLACE INTO usage_budget (key, value_json) VALUES (?, ?)',
    ).run(key, JSON.stringify(value))
  }
}

/**
 * Write the private repo roster into the DB.
 */
export function writePrivateRepoRoster(roster: {
  owners: Record<
    string,
    {
      fetchedAt: number
      privateNames: string[]
      publicNames?: string[] | undefined
      version?: number | undefined
    }
  >
}): void {
  const db = openSocketState()
  for (const [
    owner,
    { fetchedAt, privateNames, publicNames, version },
  ] of Object.entries(roster.owners)) {
    db.prepare(
      'INSERT OR REPLACE INTO private_repo_roster (owner, fetched_at, private_names_json, public_names_json, version) VALUES (?, ?, ?, ?, ?)',
    ).run(
      // Every reader looks the owner up by `owner.toLowerCase()`, and `owner`
      // is the primary key. Storing the caller's casing verbatim writes a row
      // no reader finds, and a mixed-case refresh adds a SECOND row for the
      // same owner rather than replacing the one readers use.
      owner.toLowerCase(),
      fetchedAt,
      JSON.stringify(privateNames),
      // SQL NULL is `null` at the bind API; undefined is not accepted there.
      // oxlint-disable-next-line socket/prefer-undefined-over-null -- sqlite bind value
      publicNames ? JSON.stringify(publicNames) : null,
      version ?? 1,
    )
  }
}

export interface CommentVoiceProfile {
  userId: string
  rules: Record<string, unknown>
  collectedAt: number
}

export function readCommentVoiceProfile(
  userId: string,
): CommentVoiceProfile | undefined {
  const db = openSocketState()
  const row = db
    .prepare(
      'SELECT user_id, rules_json, collected_at FROM comment_voice_profile WHERE user_id = ?',
    )
    .get(userId) as Record<string, unknown> | undefined
  if (
    !row ||
    typeof row['rules_json'] !== 'string' ||
    typeof row['collected_at'] !== 'number'
  ) {
    return undefined
  }
  return {
    collectedAt: Number(row['collected_at']),
    rules: JSON.parse(String(row['rules_json'])),
    userId: String(row['user_id']),
  }
}

export function writeCommentVoiceProfile(profile: CommentVoiceProfile): void {
  const db = openSocketState()
  db.prepare(
    'INSERT OR REPLACE INTO comment_voice_profile (user_id, rules_json, collected_at) VALUES (?, ?, ?)',
  ).run(profile.userId, JSON.stringify(profile.rules), profile.collectedAt)
}
