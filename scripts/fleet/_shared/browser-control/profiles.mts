/*
 * @file The profile registry: every Chrome profile any controlled browser
 *   launch may use, declared once as data. Before this module the profile
 *   paths were re-derived per consumer — the sign-in profile in both
 *   playwright-law.mts and browser-session.mts, the CDP scratch dir in
 *   chrome-cdp.mts — and a new surface (the MCP servers' shared profile) had
 *   nowhere canonical to live. Each entry also declares its launch-time
 *   policy so `acquire.mts` can apply it without the caller re-knowing it:
 *   whether the 1Password graft is required, which is what gets vault
 *   autofill into the window; whether the "Restore pages?" bubble is cleared
 *   before launch, since a modal over the page a tool is driving is how a
 *   sign-in gets missed; and whether a crashed Chrome's singleton artifacts
 *   are healed first.
 */

import os from 'node:os'
import path from 'node:path'

import { getSocketWheelhouseDir } from '@socketsecurity/lib-stable/paths/socket'

/**
 * One registered Chrome profile: where it lives and what a launch against it
 * needs. `onePasswordRequired` means the acquire path verifies/refreshes the
 * 1Password graft (warn-only on failure — a session never breaks over the
 * vault); the graft CLI is what surfaces hard failures.
 */
export interface ProfileEntry {
  readonly dir: string
  readonly exitCleanlyMark: boolean
  readonly id: string
  readonly onePasswordRequired: boolean
  readonly singletonHeal: boolean
}

/**
 * The known profiles. `fleetSignIn` is the historical npm sign-in profile —
 * the directory name is kept so profiles already signed in keep working.
 * `mcpShared` is the ONE profile every MCP browser server (playwright,
 * chrome-devtools) uses, in fleet members and non-fleet repos alike: a
 * second per-repo profile means a second 1Password graft and a second set of
 * logins. `cdpScratch` is the throwaway CDP profile and needs no care.
 */
export const PROFILES: Readonly<
  // The profile registry is a frozen config document keyed by profile name.
  // oxlint-disable-next-line socket/prefer-refined-record -- config doc
  Record<string, ProfileEntry>
> = Object.freeze({
  cdpScratch: Object.freeze({
    __proto__: null,
    dir: '/tmp/gh-attach-chrome',
    exitCleanlyMark: false,
    id: 'cdpScratch',
    onePasswordRequired: false,
    singletonHeal: false,
  } as ProfileEntry),
  fleetSignIn: Object.freeze({
    __proto__: null,
    dir: path.join(
      os.homedir(),
      '.config',
      'socket-wheelhouse',
      'staged-browser-profile',
    ),
    exitCleanlyMark: true,
    id: 'fleetSignIn',
    onePasswordRequired: true,
    singletonHeal: true,
  } as ProfileEntry),
  mcpShared: Object.freeze({
    __proto__: null,
    dir: path.join(getSocketWheelhouseDir(), 'mcp-browser-profile'),
    exitCleanlyMark: false,
    id: 'mcpShared',
    onePasswordRequired: true,
    singletonHeal: true,
  } as ProfileEntry),
})

/**
 * The registry entry for `id`, or a throw naming the known ids. An unknown
 * id is a caller bug, not a runtime condition — fail loudly.
 */
export function profileById(id: string): ProfileEntry {
  const entry = PROFILES[id]
  if (entry === undefined) {
    throw new Error(
      `unknown browser profile id "${id}" — known: ${Object.keys(PROFILES).join(', ')}`,
    )
  }
  return entry
}

/**
 * The directory of a registered profile.
 */
export function profileDir(id: string): string {
  return profileById(id).dir
}
