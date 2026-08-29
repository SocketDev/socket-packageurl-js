/**
 * @file Per-user voice-profile persistence layer for `comment-voice.mts`.
 *   Reads and writes profiles from the shared SQLite state DB via
 *   `socket-state.mts`, and resolves the operator's identity (GitHub login
 *   preferred, fallback to git config user.email). This is a separate module
 *   so `comment-voice.mts` stays pure-diffable against the template scaffold
 *   — only the store layer has DB awareness.
 */

import {
  readCommentVoiceProfile,
  writeCommentVoiceProfile,
} from './socket-state.mts'

import type { CommentVoiceProfile } from './socket-state.mts'

export interface BannedPhrase {
  readonly pattern: string
  readonly reason: string
}

export interface VoiceProfile {
  readonly bannedPhrases?: readonly BannedPhrase[] | undefined
}

/**
 * Resolve the current operator's identity. Tries `gh auth status` for the
 * GitHub login first; falls back to `git config user.email`. Returns
 * `"unknown"` when nothing resolves.
 */
export async function resolveUserIdentity(): Promise<string> {
  const { spawnSync } =
    await import('@socketsecurity/lib-stable/process/spawn/child')
  const result = spawnSync('gh', ['auth', 'status'], {
    stdio: ['ignore', 'pipe', 'ignore'],
    stdioString: true,
    timeout: 5000,
  })
  if (result.status === 0 && result.stdout) {
    const match = result.stdout.match(
      /Logged in to github\.com account ([^\s]+) \(/,
    )
    if (match?.[1]) {
      return match[1]
    }
  }
  const { execSync } = await import('node:child_process')
  try {
    return execSync('git config user.email', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

/**
 * Load the operator's voice profile. Resolution order:
 *
 * 1. Explicit JSON file path (--voice-profile)
 * 2. VOICE_PROFILE_JSON env var
 * 3. Per-user profile in the SQLite state DB
 * 4. Undefined so callers fall back to the hardcoded defaults
 */
export async function loadProfile(
  userId: string,
  options?: { explicitProfilePath?: string | undefined } | undefined,
): Promise<VoiceProfile | undefined> {
  const { explicitProfilePath } = {
    __proto__: null,
    ...options,
  } as NonNullable<typeof options>
  if (explicitProfilePath) {
    const { readFileSync } = await import('node:fs')
    return JSON.parse(readFileSync(explicitProfilePath, 'utf8')) as VoiceProfile
  }
  const envProfile = process.env['VOICE_PROFILE_JSON']
  if (envProfile) {
    return JSON.parse(envProfile) as VoiceProfile
  }
  const saved = readCommentVoiceProfile(userId)
  if (saved) {
    return saved.rules as VoiceProfile
  }
  return undefined
}

/**
 * Save a voice profile to the state DB. Overwrites any existing profile for
 * the same `userId`.
 */
export function saveProfile(userId: string, profile: VoiceProfile): void {
  const now = Date.now()
  writeCommentVoiceProfile({
    collectedAt: now,
    rules: profile,
    userId,
  } as CommentVoiceProfile)
}
