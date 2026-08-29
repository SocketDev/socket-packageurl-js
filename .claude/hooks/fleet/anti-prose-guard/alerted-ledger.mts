/*
 * @file Per-session record of the banned tokens this guard has already named,
 *   so one token produces one alert instead of one per tool call.
 *
 *   The reply scan reads the whole assistant turn since the last user message
 *   (`readLastAssistantTurnText`), and PostToolUse fires on every tool result.
 *   A token in already-shipped prose therefore stays inside the scan window for
 *   the rest of the turn, so the guard re-blocks on it at each later tool call.
 *   Text the agent can no longer edit cannot be rewritten in response, which
 *   makes every repeat unactionable — and a block cancels the whole command
 *   chain it interrupts, so a chained commit or push silently does not run.
 *
 *   Keyed on the transcript path, which identifies the session, and on the
 *   exact matched token. A token is announced once per session; a DIFFERENT
 *   banned token in the same session still alerts.
 *
 *   Split like the other ledgers so tests run IO-free:
 *   1. Pure ops (`sessionKey`, `unalertedTokens`).
 *   2. Thin fs shell (`readAlerted`, `recordAlerted`) over a dep-0 runtime
 *      store at `.cache/fleet/socket-prose-alerts/` — never tracked.
 *
 *   Fail-open contract: an unreadable or unwritable store reports the token as
 *   NOT yet alerted, so a broken ledger costs a duplicate alert and never
 *   swallows a first one.
 */

import crypto from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { resolveRepoRoot } from '../_shared/repo-root.mts'

const STORE_NAME = 'socket-prose-alerts'

// Long enough to span a working session, short enough that a stale file never
// silences a genuine alert weeks later.
export const ALERT_TTL_MS = 24 * 60 * 60 * 1000

/**
 * A filesystem-safe key for the session a transcript belongs to. Hashed rather
 * than sanitized: a transcript path carries directory separators and a session
 * uuid, and a hash keeps the filename short and collision-free without encoding
 * anything about the user's layout.
 */
export function sessionKey(transcriptPath: string | undefined): string {
  return crypto
    .createHash('sha256')
    .update(transcriptPath ?? 'no-transcript')
    .digest('hex')
    .slice(0, 16)
}

/**
 * The tokens in `tokens` that `alerted` has not already recorded. Compares the
 * exact token, so a near-miss variant is still its own alert. Pure.
 */
export function unalertedTokens(
  alerted: readonly string[],
  tokens: readonly string[],
): string[] {
  const seen = new Set(alerted)
  const out: string[] = []
  for (let i = 0, { length } = tokens; i < length; i += 1) {
    const token = tokens[i]!
    if (!seen.has(token)) {
      seen.add(token)
      out.push(token)
    }
  }
  return out
}

/**
 * Resolve the store root: `<repo root>/.cache/fleet/<store>` when a project dir
 * is available, else the OS temp dir. The git-toplevel anchor keeps every
 * caller on ONE store rather than a `.cache/` per cwd.
 */
export function resolveStoreRoot(projectDir: string | undefined): string {
  if (projectDir) {
    return path.join(resolveRepoRoot(projectDir), '.cache', 'fleet', STORE_NAME)
  }
  return path.join(
    process.env['TMPDIR'] ??
      process.env['TMP'] ??
      process.env['TEMP'] ??
      '/tmp',
    STORE_NAME,
  )
}

export function alertFilePath(storeRoot: string, key: string): string {
  return path.join(storeRoot, `${key}.json`)
}

interface AlertRecord {
  readonly at: number
  readonly tokens: readonly string[]
}

/**
 * Tokens already alerted for this session, or an empty list when the store is
 * absent, unreadable, malformed, or older than the TTL.
 */
export function readAlerted(
  projectDir: string | undefined,
  transcriptPath: string | undefined,
  now: number,
): string[] {
  try {
    const file = alertFilePath(
      resolveStoreRoot(projectDir),
      sessionKey(transcriptPath),
    )
    if (!existsSync(file)) {
      return []
    }
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as AlertRecord
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      !Array.isArray(parsed.tokens) ||
      typeof parsed.at !== 'number' ||
      now - parsed.at > ALERT_TTL_MS
    ) {
      return []
    }
    return parsed.tokens.filter(token => typeof token === 'string')
  } catch {
    return []
  }
}

/**
 * Add `tokens` to this session's record. Silent on any IO failure — a lost
 * write costs a duplicate alert next time, which is the safe direction.
 */
export function recordAlerted(
  projectDir: string | undefined,
  transcriptPath: string | undefined,
  tokens: readonly string[],
  now: number,
): void {
  try {
    const storeRoot = resolveStoreRoot(projectDir)
    mkdirSync(storeRoot, { recursive: true })
    const existing = readAlerted(projectDir, transcriptPath, now)
    const record: AlertRecord = {
      at: now,
      tokens: [...new Set([...existing, ...tokens])],
    }
    writeFileSync(
      alertFilePath(storeRoot, sessionKey(transcriptPath)),
      `${JSON.stringify(record)}\n`,
    )
  } catch {
    // Fail-open: a broken store must never block or silence a tool call.
  }
}
