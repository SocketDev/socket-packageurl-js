/*
 * @file Compat re-exports over the browser-control modules, so the old
 *   playwright-law.mts import surface (20+ importers) keeps working while
 *   the law's logic lives in its new home. The prose contract stays here:
 *   it is quoted verbatim by agent prompts, and its home is beside the code
 *   that enforces it.
 */

import { browserChannel } from './browser-channel.mts'
import {
  assertBrowserLaunchOptions,
  browserLaunchOptions,
  browserLaunchOptionsForProfile,
  launchViolations,
  REQUIRED_IGNORED_DEFAULT_ARGS,
} from './launch-shape.mts'
import {
  ONE_PASSWORD_EXTENSION_IDS,
  profileHasOnePassword,
} from './one-password.mts'
import { PROFILES } from './profiles.mts'
import {
  clearStaleSingletons,
  markProfileExitedCleanly,
  parseSingletonLockPid,
  profileInUseRefusal,
  SINGLETON_ARTIFACTS,
  SINGLETON_LOCK,
  singletonLockHeld,
} from './singleton-lock.mts'

export {
  assertBrowserLaunchOptions,
  browserChannel,
  browserLaunchOptions,
  browserLaunchOptionsForProfile,
  clearStaleSingletons,
  launchViolations,
  markProfileExitedCleanly,
  ONE_PASSWORD_EXTENSION_IDS,
  parseSingletonLockPid,
  profileHasOnePassword,
  profileInUseRefusal,
  SINGLETON_ARTIFACTS,
  SINGLETON_LOCK,
  singletonLockHeld,
}
export type { BrowserLaunchShape } from './launch-shape.mts'
export { PROFILES, profileById, profileDir } from './profiles.mts'

/**
 * Historical alias for the sign-in profile — the name playwright-law.mts
 * exported first.
 */
export const BROWSER_PROFILE_DIR = PROFILES['fleetSignIn']!.dir

/**
 * Historical alias: the always-sanctioned ignoreDefaultArgs pair.
 */
export const ALLOWED_IGNORED_DEFAULT_ARGS = REQUIRED_IGNORED_DEFAULT_ARGS

/**
 * The sign-in contract as data, one rule per entry — quote these instead of
 * paraphrasing them.
 */
export const SIGN_IN_CONTRACT = Object.freeze([
  'Login is NEVER scripted: the operator signs in once in the headed window; no password, OTP, or cookie passes through the process.',
  'All npm browser tools share the ONE durable profile so a single sign-in covers every tool.',
  'npm auth is decided by the /-/whoami BODY on the website origin, never the HTTP status.',
  'A human-verification challenge PAUSES the run for the operator with a visible countdown and is never retried blindly.',
] as const)

/**
 * The rules as a verbatim prompt block. Any agent prompt that may open a
 * browser must carry this text unedited — paraphrase is how the rules
 * drifted into "the sandbox banner is cosmetic" once already.
 */
export const PLAYWRIGHT_RULES_PROMPT = [
  'Playwright browser law (verbatim, non-negotiable):',
  `- Launch ONLY via acquireBrowserSession (scripts/fleet/_shared/browser-control/acquire.mts) on a registered profile, or openNpmBrowserSession (scripts/fleet/registry-infra/npm/browser-session.mts) on the durable profile ${BROWSER_PROFILE_DIR} for npm sign-in flows.`,
  '- The launch shape is channel + chromiumSandbox: true + headless + the sanctioned ignoreDefaultArgs entries, and nothing else — never an args array, never a sandbox-disabling flag.',
  ...SIGN_IN_CONTRACT.map(rule => `- ${rule}`),
].join('\n')
